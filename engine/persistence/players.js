'use strict';

/**
 * El repositorio de jugadores: el puente entre el mundo y la base de datos.
 *
 * La base sabe de filas y el mundo sabe de criaturas, y este archivo traduce entre
 * los dos. Es el único sitio donde se sabe que un `Player` del mundo tiene un
 * `account_id` en una tabla, y por eso es el único que hay que tocar si cambia
 * cualquiera de los dos lados.
 *
 * TRES DECISIONES QUE IMPORTAN
 *
 * 1. GUARDAR ES IDEMPOTENTE Y COMPLETO. No hay "guardar sólo lo que cambió": se
 *    escribe el personaje entero. Un inventario son decenas de filas, así que
 *    comparar para ahorrar escrituras cuesta más de lo que ahorra, y sobre todo
 *    puede desincronizarse. Reescribir no puede desincronizarse.
 *
 * 2. AL ENTRAR SE LIMPIA LA MARCA DE "DENTRO". La marca sólo vale mientras el
 *    proceso vive. Si el servidor se cayó con gente jugando, quedaría puesta para
 *    siempre y esos jugadores no podrían volver a entrar nunca. Es un fallo que se
 *    descubre tarde, en producción, y que se arregla aquí.
 *
 * 3. LA MISMA CUENTA NO ENTRA DOS VECES. Dos cuerpos con el mismo nombre, el
 *    inventario duplicado al guardar y el personaje saltando de un sitio a otro son
 *    las formas en que se manifiesta. Se rechaza la segunda entrada en vez de echar
 *    a la primera: es más predecible y no le rompe la partida a nadie que ya estaba
 *    jugando.
 */

const { Database } = require('./database');

/** Posición por defecto de un personaje nuevo, si el mapa no da otra. */
const DEFAULT_POSITION = { x: 0, y: 0, z: 7 };

class PlayerRepository {
    constructor(options) {
        const opts = options || {};

        this.world = opts.world;
        this.log = opts.logger || null;
        this.config = opts.config || {};
        this.now = opts.now || (() => Date.now());

        /** Dónde aparecen los personajes nuevos. Lo pone el motor con el mapa. */
        this.spawnPosition = opts.spawnPosition || null;

        this.database = opts.database || new Database({
            file: opts.file,
            logger: opts.logger,
            now: opts.now
        });

        this.stats = { logins: 0, logouts: 0, created: 0, autosaves: 0 };
    }

    open() {
        this.database.open();

        // Ningún personaje está dentro cuando el proceso arranca. Ver la cabecera.
        const cleared = this.database.clearOnlineFlags();
        if (cleared > 0 && this.log) {
            this.log.warning('se limpiaron ' + cleared + ' marcas de "dentro" de un ' +
                'arranque anterior: si el servidor se cayo, esos personajes se ' +
                'quedaron marcados');
        }

        return this;
    }

    close() {
        this.saveAll();
        this.database.close();
        return true;
    }

    get isOpen() {
        return this.database.isOpen;
    }

    // -----------------------------------------------------------------------
    // Entrar y salir
    // -----------------------------------------------------------------------

    /**
     * Mete a un personaje en el mundo.
     *
     * @param {Object} credentials { account, password, character }
     * @returns {{player: Player, created: boolean}|{error: string}}
     */
    login(credentials) {
        const accountName = String(credentials.account || '').trim();
        const characterName = String(credentials.character || '').trim();

        if (!accountName || !characterName) {
            return { error: 'faltan la cuenta o el personaje' };
        }

        /*
         * Cuenta que no existe: se crea, si está permitido.
         *
         * Es una comodidad de DESARROLLO y hay que decir en voz alta lo que
         * significa: cualquiera que se conecte puede crearse una cuenta con la
         * contraseña que quiera. En un servidor de verdad las cuentas se crean desde
         * una web, como en Tibia, y esto se apaga.
         *
         * Nótese que la contraseña se verifica DESPUÉS y por el mismo camino que la
         * de una cuenta que ya existía. Crear la cuenta y darla por buena sin pasar
         * por `authenticate` sería un segundo camino de entrada, y los fallos de
         * autenticación se cuelan justo por los segundos caminos.
         */
        let account = this.database.findAccount(accountName);

        if (!account && this.config.autoCreateAccounts) {
            try {
                this.database.createAccount({
                    name: accountName,
                    password: credentials.password
                });
                if (this.log) {
                    this.log.warning('cuenta "' + accountName + '" creada sola: ' +
                        'autoCreateAccounts esta activo, y en un servidor de verdad ' +
                        'no deberia estarlo');
                }
            } catch (error) {
                return { error: error.message };
            }
        }

        // Siempre por el mismo camino, exista la cuenta o se acabe de crear.
        account = this.database.authenticate(accountName, credentials.password);
        if (!account) {
            return { error: 'cuenta o contrasena incorrectas' };
        }

        // El personaje tiene que ser DE ESA CUENTA. Sin esta comprobación, cualquiera
        // con una cuenta válida podría entrar con el personaje de otro con sólo
        // saberse el nombre.
        let row = this.database.findCharacterByName(characterName);

        if (row && row.account_id !== account.id) {
            return { error: 'ese personaje no es de esta cuenta' };
        }

        let created = false;

        if (!row) {
            const spawn = this.spawnPosition || DEFAULT_POSITION;
            try {
                row = this.database.createCharacter(account.id, characterName, {
                    x: spawn.x, y: spawn.y, z: spawn.z
                });
                created = true;
                this.stats.created += 1;
            } catch (error) {
                return { error: error.message };
            }
        }

        if (this.database.isCharacterOnline(row.id)) {
            return { error: 'ese personaje ya esta dentro del mundo' };
        }

        const state = this.database.loadCharacter(row.id);
        if (!state) {
            return { error: 'no se pudo cargar el personaje' };
        }

        const player = this._spawnInWorld(state, account.id);

        this.database.setCharacterOnline(row.id, true);
        this.stats.logins += 1;

        if (this.log) {
            this.log.info('entra ' + player.name + ' (nivel ' + player.level + ')' +
                (created ? ' [personaje nuevo]' : ''));
        }

        return { player: player, created: created };
    }

    /** Crea la criatura en el mundo a partir de lo que había en la base. */
    _spawnInWorld(state, accountId) {
        const row = state.player;

        const player = this.world.createPlayer(row.name, row.position);

        // Se conservan TODOS los campos guardados. Es fácil olvidar uno y que un
        // personaje vuelva con el nivel 1 sin que nada avise.
        player.accountId = accountId;
        player.characterId = row.id;
        player.vocation = row.vocation;
        player.level = row.level;
        player.experience = row.experience;
        player.health = row.health;
        player.maxHealth = row.maxHealth;
        player.direction = row.direction;

        player.inventory = state.items.slice();
        player.storages = new Map(Object.keys(state.storages)
            .map((key) => [key, state.storages[key]]));

        return player;
    }

    /**
     * Saca a un personaje del mundo y lo guarda.
     *
     * El orden importa: guardar ANTES de marcarlo como fuera. Al revés, si el
     * guardado fallara el personaje quedaría marcado como fuera y con el estado
     * viejo, y el jugador perdería lo que hubiera hecho.
     */
    logout(player) {
        if (!player || !player.characterId) {
            return false;
        }

        this.save(player);

        try {
            this.database.setCharacterOnline(player.characterId, false);
        } catch (error) {
            if (this.log) {
                this.log.error('no se pudo marcar como fuera a ' + player.name + ': ' +
                    (error && error.message));
            }
        }

        this.stats.logouts += 1;
        return true;
    }

    // -----------------------------------------------------------------------
    // Guardar
    // -----------------------------------------------------------------------

    /** Guarda a un jugador. */
    save(player) {
        if (!player || !player.characterId) {
            return false;
        }

        const storages = {};
        if (player.storages instanceof Map) {
            player.storages.forEach((value, key) => { storages[key] = value; });
        } else if (player.storages) {
            Object.assign(storages, player.storages);
        }

        return this.database.saveCharacter({
            player: {
                id: player.characterId,
                vocation: player.vocation,
                level: player.level,
                experience: player.experience,
                health: player.health,
                maxHealth: player.maxHealth,
                direction: player.direction,
                position: {
                    x: player.position.x,
                    y: player.position.y,
                    z: player.position.z
                }
            },
            items: player.inventory || [],
            storages: storages
        });
    }

    /**
     * Guarda a todos los que están dentro.
     *
     * Se llama en el guardado periódico y al apagar. Un fallo al guardar a uno NO
     * debe impedir guardar a los demás: perder a uno es malo, perder a todos por
     * culpa de uno es mucho peor.
     */
    saveAll() {
        let saved = 0;
        let failed = 0;

        this.world.players.forEach((player) => {
            try {
                if (this.save(player)) {
                    saved += 1;
                }
            } catch (error) {
                failed += 1;
                if (this.log) {
                    this.log.error('no se pudo guardar a ' + player.name + ': ' +
                        (error && error.message));
                }
            }
        });

        if (saved > 0) {
            this.stats.autosaves += 1;
        }

        return { saved: saved, failed: failed };
    }

    // -----------------------------------------------------------------------
    // Storages: la memoria del contenido
    // -----------------------------------------------------------------------

    /**
     * Guarda un valor en el personaje.
     *
     * Es lo que permite que un módulo de contenido recuerde cosas. Se escribe en el
     * mundo y NO en la base al momento: si cada `setStorageValue` hiciera su propia
     * escritura, un script con un bucle dentro machacaría el disco. El guardado
     * periódico y el de salida se encargan de bajarlo.
     */
    setStorage(player, key, value) {
        if (!player) {
            return false;
        }
        if (!(player.storages instanceof Map)) {
            player.storages = new Map();
        }
        player.storages.set(String(key), Number(value));
        return true;
    }

    getStorage(player, key) {
        if (!player || !(player.storages instanceof Map)) {
            return null;
        }
        const value = player.storages.get(String(key));
        return value === undefined ? null : value;
    }

    // -----------------------------------------------------------------------
    // Cuentas, para las herramientas y las pruebas
    // -----------------------------------------------------------------------

    createAccount(name, password, email) {
        return this.database.createAccount({ name: name, password: password, email: email });
    }

    listCharacters(accountName) {
        const account = this.database.findAccount(accountName);
        return account ? this.database.listCharacters(account.id) : [];
    }

    stats_() {
        return { ...this.database.stats_(), ...this.stats };
    }
}

module.exports = { PlayerRepository, DEFAULT_POSITION };
