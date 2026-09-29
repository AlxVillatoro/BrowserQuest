'use strict';

/**
 * Persistencia: la base de datos de cuentas y personajes.
 *
 * La estructura sigue la de The Forgotten Server —cuentas, personajes, items y
 * *storages*— porque es la que espera cualquiera que venga de ahí, y porque cada una
 * de esas tablas existe por una razón que se descubre al intentar quitarla.
 *
 * POR QUÉ SQLITE Y NO MYSQL. TFS usa MySQL, y su motivo es que atiende a miles de
 * jugadores desde varios procesos. Aquí hay un proceso y la escala es otra, y
 * SQLite viene **dentro de Node** desde la versión 22: cero dependencias, cero
 * servidor que instalar, cero compilación nativa. Es la elección correcta para este
 * proyecto y sería la incorrecta para el que tiene TFS.
 *
 * TRES COSAS QUE HAY QUE CONFIGURAR SIEMPRE, y que se olvidan:
 *
 * 1. `PRAGMA foreign_keys = ON`. SQLite las trae DESACTIVADAS por compatibilidad
 *    hacia atrás. Sin esto, borrar una cuenta deja sus personajes huérfanos y no
 *    pasa nada visible hasta que alguien mira la base y encuentra basura.
 *
 * 2. `PRAGMA journal_mode = WAL`. Sin él, un lector bloquea a un escritor. Con él,
 *    se puede guardar un personaje mientras otro se está cargando.
 *
 * 3. `PRAGMA synchronous = NORMAL`. Es el ajuste recomendado con WAL: sobrevive a
 *    que se caiga el PROCESO, aunque no a que se apague la máquina de golpe. Para un
 *    servidor de juego es el equilibrio correcto; para un banco no lo sería.
 *
 * LO QUE NO HACE, y conviene saberlo: no guarda el mundo (los items del suelo, las
 * criaturas) sino sólo a los jugadores. El mundo se regenera del mapa al arrancar,
 * que es lo que hace TFS.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Versión del esquema. Sube cuando cambie la estructura. */
const SCHEMA_VERSION = 2;

/**
 * Las tablas.
 *
 * El orden importa: las claves ajenas obligan a crear `accounts` antes que
 * `players`, y `players` antes que lo que cuelga de él.
 */
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT    NOT NULL,
        password_salt TEXT    NOT NULL,
        email         TEXT,
        premium_until INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        last_login    INTEGER
    )`,

    `CREATE TABLE IF NOT EXISTS players (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        vocation    TEXT    NOT NULL DEFAULT 'None',
        level       INTEGER NOT NULL DEFAULT 1,
        experience  INTEGER NOT NULL DEFAULT 0,
        health      INTEGER NOT NULL DEFAULT 150,
        max_health  INTEGER NOT NULL DEFAULT 150,
        direction   INTEGER NOT NULL DEFAULT 2,
        pos_x       INTEGER NOT NULL DEFAULT 0,
        pos_y       INTEGER NOT NULL DEFAULT 0,
        pos_z       INTEGER NOT NULL DEFAULT 7,
        created_at  INTEGER NOT NULL,
        last_login  INTEGER,
        online      INTEGER NOT NULL DEFAULT 0
    )`,

    /*
     * Los items del jugador.
     *
     * `slot` es dónde va —`hand`, `ring`, `backpack`— y `position` es el orden
     * dentro de ese sitio. Se separan porque una mochila tiene orden y un anillo no,
     * y meterlos en el mismo campo obligaría a inventar convenciones.
     *
     * `attributes` es JSON en texto. Los items de Tibia llevan atributos propios
     * (cargas, texto escrito, dueño), y hacer una columna por cada uno posible sería
     * un esquema que crece con cada datapack.
     */
    `CREATE TABLE IF NOT EXISTS player_items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        slot       TEXT    NOT NULL,
        position   INTEGER NOT NULL DEFAULT 0,
        item_type  INTEGER NOT NULL,
        count      INTEGER NOT NULL DEFAULT 1,
        attributes TEXT
    )`,

    /*
     * Los *storages*: la memoria de los scripts.
     *
     * Es la tabla que hace posible el contenido. Un módulo de contenido necesita
     * recordar que un jugador ya mató a un dragón o en qué paso va de una misión, y
     * sin esto no tendría dónde. En TFS son claves numéricas; aquí la clave es texto
     * para poder escribir `mision.dragon` en vez de `4021`, pero los números
     * funcionan igual porque en SQLite el texto los admite.
     */
    `CREATE TABLE IF NOT EXISTS player_storages (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        key       TEXT    NOT NULL,
        value     INTEGER NOT NULL,
        PRIMARY KEY (player_id, key)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_players_account ON players(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_player_items_player ON player_items(player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_players_online ON players(online)`
];

/**
 * Los cambios de estructura, uno por versión.
 *
 * EL ESQUEMA DE ARRIBA ES LA VERSIÓN 1 Y NO SE TOCA. Cuando hay que añadir algo, se
 * añade aquí una migración que lleve de la versión anterior a la nueva. Es la forma de
 * que una base que ya tiene personajes se actualice sin perderlos: si en vez de esto
 * se cambiara el `CREATE TABLE`, las bases existentes se quedarían con el esquema
 * viejo y las consultas fallarían con un "no existe la columna" que aparece en
 * producción y no en las pruebas, porque las pruebas crean bases nuevas.
 *
 * Es justo lo que TFS no hace, y por eso actualizar un servidor suyo obliga a ejecutar
 * `ALTER TABLE` a mano y a acordarse de cuáles faltan.
 */
const MIGRATIONS = {
    /**
     * Versión 2: el aspecto de los personajes.
     *
     * Cinco columnas y no una con JSON, siguiendo a TFS: son cinco enteros pequeños y
     * separados se pueden consultar y comparar. Los nombres son los de TFS para que
     * quien venga de ahí reconozca la tabla.
     */
    2: (db) => {
        ['looktype', 'lookhead', 'lookbody', 'looklegs', 'lookfeet', 'lookaddons']
            .forEach((column) => {
                try {
                    db.exec('ALTER TABLE players ADD COLUMN ' + column +
                        ' INTEGER NOT NULL DEFAULT 0');
                } catch (error) {
                    /*
                     * Si la columna YA está, no se hace nada.
                     *
                     * En teoría no puede pasar: la versión dice qué migraciones faltan,
                     * y cada una se aplica una sola vez. En la práctica pasa cuando la
                     * fila de la versión y la estructura real no coinciden —una copia de
                     * seguridad restaurada a medias, alguien tocando la tabla `meta` a
                     * mano— y entonces hay que elegir entre dos males.
                     *
                     * Negarse a arrancar deja al servidor sin bootear y sin más salida
                     * que abrir SQLite a mano, que es justo lo que sabe hacer poca gente.
                     * Tolerarlo deja el resultado que se quería, que es que la columna
                     * esté. Se elige lo segundo, y se avisa.
                     */
                    if (!/duplicate column name/i.test(String(error.message))) {
                        throw error;
                    }
                    if (this.log) {
                        this.log.warning('la columna ' + column + ' ya existia al migrar: ' +
                            'la version de la base y su estructura no coincidian');
                    }
                }
            });
    }
};

/**
 * Deriva la clave de contraseña.
 *
 * TFS usa SHA1 sin sal, que hoy no protege nada: cualquiera con la base puede
 * sacar las contraseñas de sus jugadores. `scrypt` viene en Node, está pensado para
 * resistir ataques con hardware dedicado y apenas cuesta unas líneas más. Es una
 * divergencia deliberada de la referencia.
 */
function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

/** Comparación en tiempo constante, para no filtrar la contraseña por el tiempo. */
function passwordsMatch(expected, actual) {
    const a = Buffer.from(String(expected), 'hex');
    const b = Buffer.from(String(actual), 'hex');

    if (a.length !== b.length) {
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

class Database {
    constructor(options) {
        const opts = options || {};

        this.file = opts.file;
        this.log = opts.logger || null;

        /** Inyectable para las pruebas. */
        this.now = opts.now || (() => Date.now());

        this.db = null;
        this.stats = { saves: 0, loads: 0, transactions: 0 };
    }

    // -----------------------------------------------------------------------
    // Ciclo de vida
    // -----------------------------------------------------------------------

    open() {
        if (this.db) {
            return this;
        }

        // La carpeta puede no existir: es el fallo más tonto y más frecuente al
        // desplegar, y SQLite no la crea por su cuenta.
        const directory = path.dirname(this.file);
        if (directory && directory !== '.' && !fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        const { DatabaseSync } = require('node:sqlite');
        this.db = new DatabaseSync(this.file);

        // Las tres configuraciones que no se pueden olvidar. Ver la cabecera.
        this.db.exec('PRAGMA foreign_keys = ON');
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA synchronous = NORMAL');

        this.migrate();

        if (this.log) {
            this.log.info('base de datos: ' + this.file);
        }
        return this;
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        return true;
    }

    get isOpen() {
        return this.db !== null;
    }

    /**
     * Crea las tablas y lleva la versión del esquema.
     *
     * La versión existe para poder cambiar la estructura más adelante sin adivinar
     * en qué estado está la base de alguien. TFS no la lleva, y eso convierte cada
     * actualización en un `ALTER TABLE` a mano que hay que recordar.
     */
    migrate() {
        this.db.exec('BEGIN');

        try {
            // Las tablas se crean sólo si no existen, así que en una base que ya tiene
            // datos esto no hace nada. Lo que la pone al día es lo de después.
            SCHEMA.forEach((statement) => this.db.exec(statement));

            const row = this.db.prepare('SELECT value FROM meta WHERE key = ?')
                .get('schema_version');

            const current = row ? Number(row.value) : null;

            if (current === null) {
                // Base nueva: las tablas se acaban de crear con el esquema de la
                // versión 1, así que se marca así y las migraciones la llevan al día
                // igual que a una que ya tuviera datos. Es lo que garantiza que el
                // camino de una base nueva y el de una vieja sean EL MISMO: si se
                // marcara directamente en la última versión, una base nueva tendría
                // un esquema que nunca se ha probado a través de las migraciones.
                this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
                    .run('schema_version', '1');
            } else if (current > SCHEMA_VERSION) {
                throw new Error('la base de datos es de una version mas nueva (' +
                    current + ') que este motor (' + SCHEMA_VERSION + ')');
            }

            // Se aplican las migraciones que falten, EN ORDEN y una por una.
            for (let version = (current === null ? 1 : current) + 1;
                version <= SCHEMA_VERSION; version += 1) {

                const migration = MIGRATIONS[version];
                if (!migration) {
                    throw new Error('falta la migracion a la version ' + version +
                        ': la base no se puede poner al dia');
                }

                migration(this.db);
                this.db.prepare('UPDATE meta SET value = ? WHERE key = ?')
                    .run(String(version), 'schema_version');

                if (this.log) {
                    this.log.info('base de datos migrada a la version ' + version);
                }
            }

            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }

        return this;
    }

    /**
     * Ejecuta algo dentro de una transacción.
     *
     * Se usa `BEGIN IMMEDIATE` y no `BEGIN` a secas: el modo diferido empieza a
     * escribir sólo cuando hace falta, y entonces una transacción que empezó
     * leyendo puede fallar al escribir si otro la adelantó. Con `IMMEDIATE` se toma
     * el bloqueo de escritura desde el principio y eso no pasa.
     */
    transaction(work) {
        this.db.exec('BEGIN IMMEDIATE');
        this.stats.transactions += 1;

        try {
            const result = work();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    // -----------------------------------------------------------------------
    // Cuentas
    // -----------------------------------------------------------------------

    /**
     * Crea una cuenta.
     *
     * @returns {Object} { id, name } o lanza si el nombre ya existe
     */
    createAccount(options) {
        const opts = options || {};
        const name = String(opts.name || '').trim();

        if (!name) {
            throw new Error('la cuenta necesita un nombre');
        }
        if (!opts.password) {
            throw new Error('la cuenta necesita una contrasena');
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(opts.password, salt);

        try {
            const result = this.db.prepare(
                `INSERT INTO accounts (name, password_hash, password_salt, email, created_at)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(name, hash, salt, opts.email || null, this.now());

            return { id: Number(result.lastInsertRowid), name: name };
        } catch (error) {
            if (/UNIQUE/i.test(String(error.message))) {
                throw new Error('ya existe una cuenta con el nombre "' + name + '"');
            }
            throw error;
        }
    }

    findAccount(name) {
        return this.db.prepare(
            'SELECT * FROM accounts WHERE name = ? COLLATE NOCASE'
        ).get(String(name)) || null;
    }

    /**
     * Comprueba unas credenciales.
     *
     * Devuelve `null` tanto si la cuenta no existe como si la contraseña está mal, y
     * eso es a propósito: distinguirlos permitiría averiguar qué nombres de cuenta
     * existen probando uno a uno.
     */
    authenticate(name, password) {
        const account = this.findAccount(name);
        if (!account) {
            // Se calcula igualmente una derivación para que el tiempo de respuesta no
            // delate que la cuenta no existe.
            hashPassword(password, 'sal-falsa-para-igualar-el-tiempo');
            return null;
        }

        const expected = hashPassword(password, account.password_salt);
        if (!passwordsMatch(account.password_hash, expected)) {
            return null;
        }

        this.db.prepare('UPDATE accounts SET last_login = ? WHERE id = ?')
            .run(this.now(), account.id);

        return account;
    }

    // -----------------------------------------------------------------------
    // Personajes
    // -----------------------------------------------------------------------

    listCharacters(accountId) {
        return this.db.prepare(
            `SELECT id, name, vocation, level, experience, online
             FROM players WHERE account_id = ? ORDER BY name`
        ).all(Number(accountId));
    }

    findCharacterByName(name) {
        return this.db.prepare(
            'SELECT * FROM players WHERE name = ? COLLATE NOCASE'
        ).get(String(name)) || null;
    }

    /**
     * Crea un personaje.
     *
     * El nombre es único en TODO el servidor y no sólo dentro de la cuenta, porque
     * es como funciona un juego: dos jugadores con el mismo nombre serían
     * indistinguibles al hablar o al comerciar.
     */
    createCharacter(accountId, name, options) {
        const opts = options || {};
        const clean = String(name || '').trim();

        if (!clean) {
            throw new Error('el personaje necesita un nombre');
        }

        try {
            const result = this.db.prepare(
                `INSERT INTO players
                 (account_id, name, vocation, level, experience, health, max_health,
                  direction, pos_x, pos_y, pos_z, created_at)
                 VALUES (?, ?, ?, 1, 0, ?, ?, 2, ?, ?, ?, ?)`
            ).run(
                Number(accountId),
                clean,
                opts.vocation || 'None',
                opts.maxHealth === undefined ? 150 : Number(opts.maxHealth),
                opts.maxHealth === undefined ? 150 : Number(opts.maxHealth),
                opts.x === undefined ? 0 : Number(opts.x),
                opts.y === undefined ? 0 : Number(opts.y),
                opts.z === undefined ? 7 : Number(opts.z),
                this.now()
            );

            return this.db.prepare('SELECT * FROM players WHERE id = ?')
                .get(Number(result.lastInsertRowid));
        } catch (error) {
            if (/UNIQUE/i.test(String(error.message))) {
                throw new Error('ya existe un personaje llamado "' + clean + '"');
            }
            throw error;
        }
    }

    /**
     * ¿Está ese personaje dentro del mundo ya?
     *
     * Existe para impedir que la misma cuenta entre dos veces a la vez, que es un
     * fallo que se manifiesta de formas raras: dos cuerpos con el mismo nombre, el
     * inventario duplicado al guardar, o el personaje saltando de un sitio a otro.
     */
    isCharacterOnline(characterId) {
        const row = this.db.prepare('SELECT online FROM players WHERE id = ?')
            .get(Number(characterId));
        return !!(row && row.online);
    }

    setCharacterOnline(characterId, online) {
        this.db.prepare('UPDATE players SET online = ? WHERE id = ?')
            .run(online ? 1 : 0, Number(characterId));
        return true;
    }

    /**
     * Al arrancar, NINGÚN personaje está dentro.
     *
     * La marca de "dentro" sólo vale mientras el proceso vive. Si el servidor se
     * cayó con gente jugando, quedaría marcada como dentro para siempre y esos
     * jugadores no podrían volver a entrar nunca. Se limpia al abrir.
     */
    clearOnlineFlags() {
        const result = this.db.prepare('UPDATE players SET online = 0 WHERE online = 1').run();
        return Number(result.changes || 0);
    }

    // -----------------------------------------------------------------------
    // Cargar y guardar
    // -----------------------------------------------------------------------

    /**
     * Carga un personaje completo: sus datos, sus items y sus storages.
     *
     * @returns {{player: Object, items: Array, storages: Object}|null}
     */
    loadCharacter(characterId) {
        const row = this.db.prepare('SELECT * FROM players WHERE id = ?')
            .get(Number(characterId));

        if (!row) {
            return null;
        }

        const items = this.db.prepare(
            `SELECT id, slot, position, item_type, count, attributes
             FROM player_items WHERE player_id = ? ORDER BY slot, position`
        ).all(row.id).map((item) => ({
            id: item.id,
            slot: item.slot,
            position: item.position,
            typeId: item.item_type,
            count: item.count,
            attributes: item.attributes ? JSON.parse(item.attributes) : null
        }));

        const storages = {};
        this.db.prepare('SELECT key, value FROM player_storages WHERE player_id = ?')
            .all(row.id).forEach((storage) => {
                storages[storage.key] = storage.value;
            });

        this.stats.loads += 1;

        return {
            player: {
                id: row.id,
                accountId: row.account_id,
                name: row.name,
                vocation: row.vocation,
                level: row.level,
                experience: row.experience,
                health: row.health,
                maxHealth: row.max_health,
                direction: row.direction,
                position: { x: row.pos_x, y: row.pos_y, z: row.pos_z },
                /**
                 * El aspecto. `looktype` a 0 significa que la fila es de ANTES de que
                 * existieran los aspectos, y quien la lea tiene que decidir qué hacer;
                 * aquí se devuelve 0 y es el repositorio el que pone el de por defecto,
                 * porque el valor por defecto es una decisión del juego y no de la base.
                 */
                outfit: {
                    lookType: row.looktype,
                    head: row.lookhead,
                    body: row.lookbody,
                    legs: row.looklegs,
                    feet: row.lookfeet,
                    addons: row.lookaddons
                }
            },
            items: items,
            storages: storages
        };
    }

    /**
     * Guarda un personaje: datos, items y storages, todo o nada.
     *
     * Va en UNA transacción porque las tres cosas son el mismo estado. Guardar el
     * personaje y fallar al guardar los items dejaría a alguien con nivel nuevo y
     * sin la espada que acababa de recoger, y ese fallo es imposible de reconstruir
     * después.
     *
     * Los items se borran y se reinsertan enteros en vez de calcular diferencias.
     * Para un inventario, que son decenas de filas, es más rápido que comparar, y
     * sobre todo es imposible que se desincronice.
     */
    saveCharacter(state) {
        if (!state || !state.player) {
            throw new Error('saveCharacter necesita un personaje');
        }

        const player = state.player;

        this.transaction(() => {
            this.db.prepare(
                `UPDATE players SET
                    vocation = ?, level = ?, experience = ?, health = ?, max_health = ?,
                    direction = ?, pos_x = ?, pos_y = ?, pos_z = ?, last_login = ?,
                    looktype = ?, lookhead = ?, lookbody = ?, looklegs = ?, lookfeet = ?,
                    lookaddons = ?
                 WHERE id = ?`
            ).run(
                player.vocation || 'None',
                Number(player.level || 1),
                Number(player.experience || 0),
                Number(player.health || 0),
                Number(player.maxHealth || 0),
                Number(player.direction || 2),
                Number(player.position.x),
                Number(player.position.y),
                Number(player.position.z),
                this.now(),
                Number(player.outfit && player.outfit.lookType || 0),
                Number(player.outfit && player.outfit.head || 0),
                Number(player.outfit && player.outfit.body || 0),
                Number(player.outfit && player.outfit.legs || 0),
                Number(player.outfit && player.outfit.feet || 0),
                Number(player.outfit && player.outfit.addons || 0),
                Number(player.id)
            );

            this.db.prepare('DELETE FROM player_items WHERE player_id = ?')
                .run(Number(player.id));

            const insertItem = this.db.prepare(
                `INSERT INTO player_items
                 (player_id, slot, position, item_type, count, attributes)
                 VALUES (?, ?, ?, ?, ?, ?)`
            );

            (state.items || []).forEach((item, index) => {
                insertItem.run(
                    Number(player.id),
                    String(item.slot || 'backpack'),
                    item.position === undefined ? index : Number(item.position),
                    Number(item.typeId),
                    Number(item.count || 1),
                    item.attributes ? JSON.stringify(item.attributes) : null
                );
            });

            this.db.prepare('DELETE FROM player_storages WHERE player_id = ?')
                .run(Number(player.id));

            const insertStorage = this.db.prepare(
                'INSERT INTO player_storages (player_id, key, value) VALUES (?, ?, ?)'
            );

            Object.keys(state.storages || {}).forEach((key) => {
                insertStorage.run(Number(player.id), String(key),
                    Number(state.storages[key]));
            });
        });

        this.stats.saves += 1;
        return true;
    }

    // -----------------------------------------------------------------------
    // Storages sueltos
    // -----------------------------------------------------------------------

    getStorage(characterId, key) {
        const row = this.db.prepare(
            'SELECT value FROM player_storages WHERE player_id = ? AND key = ?'
        ).get(Number(characterId), String(key));

        return row ? row.value : null;
    }

    setStorage(characterId, key, value) {
        this.db.prepare(
            `INSERT INTO player_storages (player_id, key, value) VALUES (?, ?, ?)
             ON CONFLICT (player_id, key) DO UPDATE SET value = excluded.value`
        ).run(Number(characterId), String(key), Number(value));

        return true;
    }

    // -----------------------------------------------------------------------
    // Información
    // -----------------------------------------------------------------------

    /** Cuántas filas hay de cada cosa, para el informe de arranque. */
    stats_() {
        const count = (table) =>
            Number(this.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);

        return {
            accounts: count('accounts'),
            players: count('players'),
            items: count('player_items'),
            storages: count('player_storages'),
            saves: this.stats.saves,
            loads: this.stats.loads
        };
    }
}

module.exports = { Database, SCHEMA_VERSION, MIGRATIONS, hashPassword, passwordsMatch };
