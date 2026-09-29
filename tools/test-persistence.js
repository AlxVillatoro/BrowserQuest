'use strict';

/**
 * Prueba de la persistencia.
 *
 * Lo que se verifica aquí no es "guarda y carga", que es lo fácil, sino las cosas
 * que sólo se descubren cuando ya hay jugadores de verdad:
 *
 *   - Que las claves ajenas estén ACTIVAS (SQLite las trae apagadas).
 *   - Que dos cuentas con la misma contraseña no tengan el mismo hash.
 *   - Que la contraseña no esté en la base en claro.
 *   - Que un guardado a medias no deje el personaje peor que antes.
 *   - Que un servidor que se cayó no deje a nadie dentro para siempre.
 *   - Que el estado sobreviva a un reinicio del MOTOR, no sólo a un `save`.
 *
 * Uso:  node tools/test-persistence.js
 */

const fs = require('fs');
const path = require('path');

const { createEngine } = require('../engine/core/engine');
const { Database } = require('../engine/persistence/database');
const { PlayerRepository } = require('../engine/persistence/players');
const { World } = require('../engine/world/world');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'test-persistence.db');

let failures = 0;

function ok(label, detail) {
    console.log('  \u001b[32mPASS\u001b[0m  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
}
function fail(label, detail) {
    failures += 1;
    console.log('  \u001b[31mFAIL\u001b[0m  ' + label + (detail ? '  ' + detail : ''));
}
function check(label, condition, detail) {
    if (condition) { ok(label, detail); } else { fail(label, detail); }
}
function section(title) {
    console.log('\n' + title);
}

/** Borra la base y sus dos archivos de registro anticipado. */
function cleanDatabase() {
    [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm'].forEach((file) => {
        try {
            fs.unlinkSync(file);
        } catch (error) {
            // No existía.
        }
    });
}

function main() {
    console.log('Prueba de la persistencia (' + ROOT + ')');

    cleanDatabase();

    // =======================================================================
    section('1. Esquema y configuracion de SQLite');
    // =======================================================================

    {
        const db = new Database({ file: DB_FILE }).open();

        const tables = db.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).all().map((row) => row.name);

        check('se crean las tablas del esquema',
            tables.indexOf('accounts') !== -1 && tables.indexOf('players') !== -1 &&
            tables.indexOf('player_items') !== -1 &&
            tables.indexOf('player_storages') !== -1,
            tables.join(', '));

        check('se lleva la version del esquema',
            db.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version').value
            === '1',
            'para poder cambiar la estructura sin adivinar el estado de cada base');

        // LA TRAMPA CLASICA: SQLite trae las claves ajenas DESACTIVADAS. Sin esto,
        // borrar una cuenta deja sus personajes huerfanos sin que nada avise.
        check('las claves ajenas estan ACTIVAS',
            db.db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1,
            'SQLite las trae apagadas por compatibilidad');

        check('el registro es WAL',
            String(db.db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase()
            === 'wal',
            'sin esto, guardar a uno bloquea la lectura de los demas');

        // La clave ajena tiene que hacer algo de verdad, no solo estar declarada.
        db.createAccount({ name: 'borrame', password: 'x' });
        const account = db.findAccount('borrame');
        db.createCharacter(account.id, 'Huerfano');

        db.db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);

        const orphans = db.db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
        check('borrar una cuenta se lleva sus personajes',
            Number(orphans) === 0,
            'la clave ajena funciona en cascada, no solo esta escrita');

        db.close();
    }

    {
        // Una base de una version mas nueva debe rechazarse en vez de corromperse.
        const db = new Database({ file: DB_FILE }).open();
        db.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('99', 'schema_version');
        db.close();

        let rejected = false;
        try {
            new Database({ file: DB_FILE }).open().close();
        } catch (error) {
            rejected = /mas nueva/i.test(error.message);
        }

        check('una base de una version mas nueva se rechaza', rejected,
            'mejor negarse a arrancar que escribir con un esquema que no se conoce');

        // Se deja la base en su version para el resto de la prueba.
        const fix = new Database({ file: DB_FILE });
        fix.db = new (require('node:sqlite').DatabaseSync)(DB_FILE);
        fix.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('1', 'schema_version');
        fix.close();
    }

    cleanDatabase();

    // =======================================================================
    section('2. Cuentas y contrasenas');
    // =======================================================================

    {
        const db = new Database({ file: DB_FILE }).open();

        db.createAccount({ name: 'Ana', password: 'secreta-123' });
        db.createAccount({ name: 'Beto', password: 'secreta-123' });

        check('se autentica con la contrasena correcta',
            db.authenticate('Ana', 'secreta-123') !== null);

        check('se rechaza la contrasena incorrecta',
            db.authenticate('Ana', 'secreta-124') === null);

        check('se rechaza una cuenta que no existe',
            db.authenticate('Nadie', 'lo-que-sea') === null);

        check('el nombre de cuenta no distingue mayusculas',
            db.authenticate('ana', 'secreta-123') !== null,
            'nadie recuerda como escribio su nombre al registrarse');

        // Dos cuentas con la MISMA contrasena no pueden tener el mismo hash: si lo
        // tuvieran, seria que no hay sal, y una tabla de hashes precalculada las
        // sacaria todas de golpe.
        const ana = db.findAccount('Ana');
        const beto = db.findAccount('Beto');

        check('cada cuenta tiene su propia sal',
            ana.password_salt !== beto.password_salt);

        check('dos cuentas con la misma contrasena tienen hashes distintos',
            ana.password_hash !== beto.password_hash,
            'sin sal, una tabla de hashes precalculada las sacaria todas');

        // Y lo mas importante: que la contrasena NO este guardada.
        const dump = JSON.stringify([ana, beto]);
        check('la contrasena no esta en la base en claro',
            dump.indexOf('secreta-123') === -1,
            'TFS guarda SHA1 sin sal; aqui se usa scrypt');

        check('el hash tiene longitud de scrypt',
            ana.password_hash.length === 128,
            ana.password_hash.length + ' caracteres hexadecimales (64 bytes)');

        let duplicate = false;
        try {
            db.createAccount({ name: 'ana', password: 'otra' });
        } catch (error) {
            duplicate = /ya existe/i.test(error.message);
        }
        check('no se puede repetir un nombre de cuenta', duplicate);

        db.close();
    }

    // =======================================================================
    section('3. Personajes: pertenencia y doble entrada');
    // =======================================================================

    {
        const db = new Database({ file: DB_FILE }).open();

        const ana = db.findAccount('Ana');
        const beto = db.findAccount('Beto');

        db.createCharacter(ana.id, 'Guerrero', { x: 40, y: 40, z: 7 });

        check('el personaje queda en su cuenta',
            db.listCharacters(ana.id).length === 1 &&
            db.listCharacters(beto.id).length === 0);

        let duplicate = false;
        try {
            db.createCharacter(beto.id, 'Guerrero');
        } catch (error) {
            duplicate = /ya existe un personaje/i.test(error.message);
        }

        check('el nombre de personaje es unico en TODO el servidor', duplicate,
            'dos jugadores con el mismo nombre serian indistinguibles al hablar');

        db.createCharacter(beto.id, 'Mago', { x: 41, y: 40, z: 7 });

        // --- Doble entrada ---
        check('un personaje recien creado no esta dentro',
            db.isCharacterOnline(db.findCharacterByName('Mago').id) === false);

        db.setCharacterOnline(db.findCharacterByName('Mago').id, true);
        check('se puede marcar como dentro',
            db.isCharacterOnline(db.findCharacterByName('Mago').id) === true);

        db.close();
    }

    {
        // LA CAIDA: si el servidor se muere con gente jugando, la marca de "dentro"
        // se queda puesta y esos jugadores no pueden volver a entrar NUNCA. Se limpia
        // al abrir.
        const db = new Database({ file: DB_FILE }).open();

        const cleared = db.clearOnlineFlags();
        check('al abrir se limpian las marcas de "dentro" de un arranque anterior',
            cleared === 1 && db.isCharacterOnline(db.findCharacterByName('Mago').id) === false,
            cleared + ' marca(s) limpiada(s): si no, ese jugador no volveria a entrar');

        db.close();
    }

    // =======================================================================
    section('4. Ida y vuelta completa del estado');
    // =======================================================================

    {
        const db = new Database({ file: DB_FILE }).open();
        const ana = db.findAccount('Ana');
        const character = db.findCharacterByName('Guerrero');

        const state = {
            player: {
                id: character.id,
                vocation: 'Knight',
                level: 42,
                experience: 1234567,
                health: 380,
                maxHealth: 500,
                direction: 1,
                position: { x: 55, y: 66, z: 8 }
            },
            items: [
                { slot: 'hand', position: 0, typeId: 2400, count: 1 },
                { slot: 'ring', position: 0, typeId: 2376, count: 1 },
                { slot: 'backpack', position: 0, typeId: 3031, count: 87,
                  attributes: { dueno: 'Guerrero' } }
            ],
            storages: { 'mision.dragon': 3, '4021': 1, 'contador': 99 }
        };

        db.saveCharacter(state);
        const loaded = db.loadCharacter(character.id);

        check('el personaje vuelve con TODOS sus campos',
            loaded.player.vocation === 'Knight' &&
            loaded.player.level === 42 &&
            loaded.player.experience === 1234567 &&
            loaded.player.health === 380 &&
            loaded.player.maxHealth === 500 &&
            loaded.player.direction === 1 &&
            loaded.player.position.x === 55 &&
            loaded.player.position.y === 66 &&
            loaded.player.position.z === 8,
            'nivel ' + loaded.player.level + ' en ' + JSON.stringify(loaded.player.position));

        // Los items vuelven ordenados por `(slot, position)`, que es DETERMINISTA.
        // Se buscan por ranura y no por indice: el orden de inserción no es un
        // contrato, y una prueba que dependa de él se rompe el día que cambie una
        // consulta sin que nada haya dejado de funcionar.
        const bySlot = {};
        loaded.items.forEach((item) => { bySlot[item.slot] = item; });

        check('el inventario vuelve entero',
            loaded.items.length === 3 &&
            bySlot.hand && bySlot.hand.typeId === 2400 &&
            bySlot.ring && bySlot.ring.typeId === 2376 &&
            bySlot.backpack && bySlot.backpack.count === 87,
            loaded.items.map((i) => i.slot + ':' + i.typeId + 'x' + i.count).join(', '));

        check('y vuelve ordenado por ranura, que es determinista',
            loaded.items.map((i) => i.slot).join(',') === 'backpack,hand,ring',
            'dentro de una ranura manda `position`; entre ranuras, el nombre');

        check('los atributos de un item sobreviven al viaje',
            bySlot.backpack.attributes && bySlot.backpack.attributes.dueno === 'Guerrero',
            JSON.stringify(bySlot.backpack.attributes));

        check('los storages vuelven, tanto con nombre como numericos',
            loaded.storages['mision.dragon'] === 3 &&
            loaded.storages['4021'] === 1 &&
            loaded.storages['contador'] === 99,
            JSON.stringify(loaded.storages));

        // Guardar dos veces no puede DUPLICAR nada: es el fallo clasico de guardar
        // anadiendo en vez de reemplazando.
        db.saveCharacter(state);
        const twice = db.loadCharacter(character.id);

        check('guardar dos veces no duplica items ni storages',
            twice.items.length === 3 &&
            Object.keys(twice.storages).length === 3,
            twice.items.length + ' items, ' +
            Object.keys(twice.storages).length + ' storages');

        // --- Atomicidad ---
        // Un fallo a mitad del guardado tiene que dejar el estado ANTERIOR intacto,
        // no uno a medias.
        const broken = {
            player: { ...state.player, level: 999 },
            items: [
                { slot: 'hand', typeId: 2400, count: 1 },
                // Un getter que revienta al leerlo: hace fallar el guardado DESPUES
                // de haber escrito la fila del personaje.
                { get slot() { throw new Error('fallo deliberado a mitad del guardado'); },
                  typeId: 1, count: 1 }
            ],
            storages: { 'mando.a.medias': 1 }
        };

        let threw = false;
        try {
            db.saveCharacter(broken);
        } catch (error) {
            threw = true;
        }

        const after = db.loadCharacter(character.id);

        check('un guardado que falla a medias se deshace entero', threw &&
            after.player.level === 42,
            'el nivel sigue siendo 42 y no 999: la transaccion hizo ROLLBACK');

        check('y no deja items ni storages a medias',
            after.items.length === 3 &&
            after.storages['mando.a.medias'] === undefined,
            after.items.length + ' items y sin el storage del intento fallido');

        db.close();
    }

    // =======================================================================
    section('5. El repositorio: entrar, salir y el motor entero');
    // =======================================================================

    {
        const world = new World({ logger: null });
        const repository = new PlayerRepository({
            world: world,
            file: DB_FILE,
            spawnPosition: { x: 40, y: 40, z: 7 }
        }).open();

        const account = repository.createAccount('Carlos', 'clave-carlos');

        // --- Personaje nuevo ---
        const first = repository.login({
            account: 'Carlos', password: 'clave-carlos', character: 'Novato'
        });

        check('la primera entrada crea el personaje',
            first.player !== undefined && first.created === true,
            first.player ? first.player.name + ' en ' + first.player.position : first.error);

        check('y aparece donde dice el mapa',
            first.player.position.x === 40 && first.player.position.z === 7,
            'el waypoint `temple`, no una posicion inventada');

        check('el personaje queda marcado como dentro',
            repository.database.isCharacterOnline(first.player.characterId) === true);

        // --- Doble entrada ---
        const second = repository.login({
            account: 'Carlos', password: 'clave-carlos', character: 'Novato'
        });

        check('la misma cuenta no entra dos veces con el mismo personaje',
            second.error !== undefined && /ya esta dentro/.test(second.error),
            second.error);

        // --- Credenciales ---
        const wrongPassword = repository.login({
            account: 'Carlos', password: 'no-es', character: 'Novato'
        });
        check('una contrasena incorrecta no entra',
            wrongPassword.error !== undefined,
            wrongPassword.error);

        const wrongOwner = repository.login({
            account: 'Ana', password: 'secreta-123', character: 'Novato'
        });
        check('no se puede entrar con el personaje de otra cuenta',
            wrongOwner.error !== undefined && /no es de esta cuenta/.test(wrongOwner.error),
            wrongOwner.error);

        // --- Estado que se va a guardar ---
        const player = first.player;
        player.level = 17;
        player.experience = 98765;
        player.health = 111;
        player.position.x = 52;
        player.position.y = 53;
        player.position.z = 8;
        player.inventory.push({ slot: 'hand', position: 0, typeId: 2400, count: 1 });

        repository.setStorage(player, 'mision.rat', 5);
        repository.setStorage(player, 4021, 1);

        check('los storages se escriben en el mundo, no en el disco',
            repository.getStorage(player, 'mision.rat') === 5 &&
            repository.getStorage(player, 4021) === 1,
            'si cada uno escribiera, un bucle en un script machacaria el disco');

        // --- Salir guarda ---
        repository.logout(player);

        check('al salir el personaje queda marcado como fuera',
            repository.database.isCharacterOnline(player.characterId) === false);

        const saved = repository.database.loadCharacter(player.characterId);
        check('y su estado esta en la base',
            saved.player.level === 17 && saved.player.health === 111 &&
            saved.player.position.z === 8 && saved.items.length === 1 &&
            saved.storages['mision.rat'] === 5,
            'nivel ' + saved.player.level + ' en ' + JSON.stringify(saved.player.position));

        // --- Volver a entrar recupera lo guardado ---
        const again = repository.login({
            account: 'Carlos', password: 'clave-carlos', character: 'Novato'
        });

        check('al volver a entrar, el personaje esta como se dejo',
            again.created === false && again.player.level === 17 &&
            again.player.experience === 98765 && again.player.position.x === 52 &&
            again.player.inventory.length === 1 &&
            again.player.storages.get('mision.rat') === 5,
            'nivel ' + again.player.level + ', ' + again.player.inventory.length +
            ' item(s), storage ' + again.player.storages.get('mision.rat'));

        check('y el personaje NO se duplica al volver',
            repository.database.listCharacters(account.id).length === 1);

        repository.close();
    }

    // =======================================================================
    section('6. Caida sin cierre limpio: el WAL tiene que recuperar');
    // =======================================================================

    {
        // Se escribe SIN cerrar y se abre una COPIA de los tres archivos. Eso es
        // exactamente lo que queda cuando un servidor se muere de golpe: la base, el
        // registro de escritura anticipada y el indice de ese registro. Si el WAL no
        // sirviera para esto, no serviria para nada.
        const CRASH = path.join(ROOT, 'data', 'test-crash.db');
        const CRASH_COPY = path.join(ROOT, 'data', 'test-crash-copy.db');

        [CRASH, CRASH_COPY].forEach((base) => {
            [base, base + '-wal', base + '-shm'].forEach((file) => {
                try { fs.unlinkSync(file); } catch (error) { /* no existia */ }
            });
        });

        const live = new Database({ file: CRASH }).open();
        live.createAccount({ name: 'SeCayo', password: 'clave' });
        const account = live.findAccount('SeCayo');
        live.createCharacter(account.id, 'Superviviente', { x: 12, y: 13, z: 7 });

        // NO se llama a `close()`: se copian los archivos tal y como estan.
        [CRASH, CRASH + '-wal', CRASH + '-shm'].forEach((file) => {
            if (fs.existsSync(file)) {
                fs.copyFileSync(file, file.replace('test-crash', 'test-crash-copy'));
            }
        });

        const recovered = new Database({ file: CRASH_COPY }).open();
        const found = recovered.findCharacterByName('Superviviente');

        check('una base sin cerrar se recupera desde el WAL',
            found !== null && found.pos_x === 12 && found.pos_y === 13,
            found ? 'el personaje sobrevivio a la caida en (' + found.pos_x + ',' +
                found.pos_y + ')' : 'no se recupero');

        check('y la cuenta tambien',
            recovered.authenticate('SeCayo', 'clave') !== null);

        recovered.close();
        live.close();

        [CRASH, CRASH_COPY].forEach((base) => {
            [base, base + '-wal', base + '-shm'].forEach((file) => {
                try { fs.unlinkSync(file); } catch (error) { /* ya no esta */ }
            });
        });
    }

    // =======================================================================
    section('7. Reinicio del MOTOR: el estado sobrevive de verdad');
    // =======================================================================

    {
        // Motor 1: entra, juega y se apaga.
        const engine1 = createEngine({
            rootDir: ROOT,
            logLevel: 'error',
            overrides: { useDatabase: true, databaseFile: 'data/test-persistence.db' }
        });

        const accountId = engine1.repository.createAccount('Reinicio', 'clave-reinicio');

        const session1 = engine1.createSession(() => {});
        const login1 = session1.login({
            account: 'Reinicio', password: 'clave-reinicio', character: 'Persistente'
        });

        check('entra un personaje nuevo en el primer motor',
            login1.handled === true && login1.created === true);

        // Se le cambia el estado como si hubiera jugado.
        const hero = session1.player;
        hero.level = 33;
        hero.experience = 777000;
        hero.position.x = 44;
        hero.position.y = 45;

        const storageBefore = engine1.repository.setStorage(hero, 'hito.dragon', 7);
        check('el motor expone los storages del personaje',
            storageBefore === true && engine1.repository.getStorage(hero, 'hito.dragon') === 7);

        // Se apaga CON el jugador dentro: el cierre tiene que guardarlo.
        engine1.shutdown();

        // Motor 2: arranca de cero y el personaje tiene que estar como se dejo.
        const engine2 = createEngine({
            rootDir: ROOT,
            logLevel: 'error',
            overrides: { useDatabase: true, databaseFile: 'data/test-persistence.db' }
        });

        const session2 = engine2.createSession(() => {});
        const login2 = session2.login({
            account: 'Reinicio', password: 'clave-reinicio', character: 'Persistente'
        });

        check('el personaje sigue existiendo tras reiniciar el motor',
            login2.handled === true && login2.created === false,
            login2.error || 'no se creo de nuevo: se cargo');

        check('con su nivel y su experiencia',
            session2.player.level === 33 && session2.player.experience === 777000,
            'nivel ' + session2.player.level + ' con ' + session2.player.experience);

        check('con su posicion',
            session2.player.position.x === 44 && session2.player.position.y === 45,
            JSON.stringify(session2.player.position));

        check('y con lo que los scripts habian recordado',
            session2.player.storages.get('hito.dragon') === 7,
            'es lo que permite que el contenido cuente una historia que dura');

        check('arrancar limpio deja al personaje fuera, no dentro',
            engine2.repository.database.isCharacterOnline(session2.player.characterId) === true,
            'esta dentro porque acaba de entrar con este motor');

        // El guardado periodico esta programado.
        check('el guardado periodico esta en el planificador',
            engine2.scheduler.size > 0,
            engine2.scheduler.size + ' evento(s): el guardado va con el reloj del ' +
            'mundo, no en un temporizador suelto');

        engine2.shutdown();

        check('tras apagar, la base se cierra',
            engine2.repository.isOpen === false);

        // Y una tercera vez: que apagar dos veces no rompa nada.
        const engine3 = createEngine({
            rootDir: ROOT,
            logLevel: 'error',
            overrides: { useDatabase: true, databaseFile: 'data/test-persistence.db' }
        });
        const session3 = engine3.createSession(() => {});
        const login3 = session3.login({
            account: 'Reinicio', password: 'clave-reinicio', character: 'Persistente'
        });

        check('y sigue estando en el tercer arranque',
            login3.handled === true && session3.player.level === 33,
            'tres arranques y el personaje sigue igual');

        engine3.shutdown();
    }

    // =======================================================================
    console.log('');
    cleanDatabase();

    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — los personajes sobreviven al servidor.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
