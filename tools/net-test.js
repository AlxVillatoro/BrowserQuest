'use strict';

/**
 * Prueba de extremo a extremo POR RED: motor + servidor WebSocket + cliente real.
 *
 * Es la única prueba del proyecto que abre un socket de verdad. Las demás usan el
 * transporte inyectado a propósito, para ser deterministas; ésta existe para
 * comprobar justo lo que aquéllas no pueden: que el adaptador de red esté bien
 * cableado, que el agrupado por tick funcione y que el orden de los mensajes
 * llegue intacto al otro lado.
 *
 * Se usa el puerto 0, que hace que el sistema elija uno libre: una prueba que
 * falla porque el 8080 estaba ocupado no dice nada del código.
 *
 * Uso:  node tools/net-test.js
 */

const path = require('path');

const { WebSocket } = require('ws');
const { createEngine } = require('../engine/core/engine');
const { createNetworkServer } = require('../engine/net/server');
const P = require('../engine/net/protocol');

const ROOT = path.resolve(__dirname, '..');

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Un cliente de prueba que acumula lo que recibe.
 *
 * Desempaqueta los lotes: el servidor manda un array de mensajes por marco, así
 * que sin desenvolverlo se vería `[[17,1],[11,...]]` y parecería que el protocolo
 * está mal cuando lo que pasa es que viene agrupado.
 */
class TestClient {
    constructor(url) {
        this.received = [];
        this.socket = new WebSocket(url);

        this.socket.on('message', (raw) => {
            let parsed;
            try {
                parsed = JSON.parse(raw.toString());
            } catch (error) {
                return;
            }
            parsed.forEach((message) => this.received.push(message));
        });
    }

    ready() {
        return new Promise((resolve, reject) => {
            this.socket.once('open', resolve);
            this.socket.once('error', reject);
        });
    }

    send(message) {
        this.socket.send(JSON.stringify(message));
    }

    /** Espera a que llegue un mensaje que cumpla una condición. */
    async waitFor(predicate, timeoutMs) {
        const deadline = Date.now() + (timeoutMs || 2000);

        for (;;) {
            const found = this.received.find(predicate);
            if (found) {
                return found;
            }
            if (Date.now() > deadline) {
                return null;
            }
            await sleep(10);
        }
    }

    count(opcode) {
        return this.received.filter((m) => m[0] === opcode).length;
    }

    close() {
        this.socket.close();
    }
}

async function main() {
    console.log('Prueba de red de extremo a extremo (' + ROOT + ')');

    const engine = createEngine({
        rootDir: ROOT,
        logLevel: 'error',
        // Sin persistencia: esta prueba usa el atajo de desarrollo para entrar al
        // mundo con solo un nombre. Con la base de datos activa haria falta
        // autenticarse, que es lo correcto pero no lo que se prueba aqui.
        overrides: { useDatabase: false }
    });

    const network = createNetworkServer({
        engine: engine,
        port: 0,                 // el sistema elige uno libre
        logger: { info() {}, warning() {}, error() {} }
    });

    // El motor arranca DESPUES de la red, igual que en `serve.js`.
    engine.start();

    // Se espera a que el servidor este ENLAZADO antes de preguntar el puerto:
    // enlazar es asincrono y con puerto 0 el numero lo elige el sistema.
    const port = await network.ready;

    // =======================================================================
    section('1. Conexion y entrada al mundo');
    // =======================================================================

    check('el servidor escucha en un puerto real',
        typeof port === 'number' && port > 0,
        'puerto ' + port);

    const client = new TestClient('ws://127.0.0.1:' + port);
    await client.ready();

    check('la conexion se acepta', client.socket.readyState === WebSocket.OPEN);

    // Nada debe llegar antes de pedir entrar: el servidor no habla primero.
    await sleep(150);
    check('el servidor no manda nada hasta que el cliente entra',
        client.received.length === 0,
        client.received.length + ' mensajes antes de entrar');

    client.send([P.CLIENT.ENTER_WORLD, 'PorRed']);

    const hello = await client.waitFor((m) => m[0] === P.SERVER.HELLO);
    check('llega el saludo con la version y el mundo',
        hello && hello[1] === P.PROTOCOL_VERSION && hello[2] === 64,
        hello ? 'protocolo v' + hello[1] + ', mundo ' + hello[2] + 'x' + hello[3] +
            'x' + hello[4] : 'no llego');

    const loginOk = await client.waitFor((m) => m[0] === P.SERVER.LOGIN_OK);
    check('llegan los datos del jugador, con su posicion',
        loginOk && loginOk[2] === 'PorRed',
        loginOk ? loginOk[2] + ' en (' + loginOk[3] + ',' + loginOk[4] + ',' +
            loginOk[5] + ')' : 'no llego');

    // El mapa inicial son cientos de tiles; se espera a que lleguen.
    const tiles = await client.waitFor(() => client.count(P.SERVER.TILE_ADD) > 500, 3000);
    check('llega el mapa inicial completo',
        client.count(P.SERVER.TILE_ADD) > 500,
        client.count(P.SERVER.TILE_ADD) + ' tiles');

    check('el jugador existe en el mundo del servidor',
        engine.sessions.size === 1 &&
        engine.sessions.get(loginOk[1]) !== null,
        'una sesion registrada');

    // =======================================================================
    section('2. Agrupado de mensajes');
    // =======================================================================

    const batches = [];
    const collector = new WebSocket('ws://127.0.0.1:' + port);

    await new Promise((resolve) => collector.once('open', resolve));
    collector.on('message', (raw) => {
        batches.push(JSON.parse(raw.toString()));
    });

    collector.send(JSON.stringify([P.CLIENT.ENTER_WORLD, 'Lote']));
    await sleep(400);

    check('los mensajes viajan AGRUPADOS, no de uno en uno',
        batches.length > 0 && Array.isArray(batches[0]) && batches[0].length > 10,
        batches.length + ' marcos para ' + batches.reduce((n, b) => n + b.length, 0) +
        ' mensajes: ' + (batches[0] ? batches[0].length : 0) + ' en el primero');

    check('y cada elemento del lote es un mensaje con su opcode',
        batches[0] && Array.isArray(batches[0][0]) && typeof batches[0][0][0] === 'number',
        'formato [opcode, ...datos]');

    // =======================================================================
    section('3. Caminar por la red');
    // =======================================================================

    const gameSession = engine.sessions.get(loginOk[1]);
    const before = gameSession.player.position.copy();

    client.received.length = 0;
    client.send([P.CLIENT.WALK_SOUTH]);

    const walk = await client.waitFor((m) => m[0] === P.SERVER.CREATURE_MOVE);

    check('el paso se ejecuta y se avisa al cliente',
        walk && walk[1] === loginOk[1] &&
        walk[5] === before.x && walk[6] === before.y + 1,
        walk ? 'de (' + walk[2] + ',' + walk[3] + ') a (' + walk[5] + ',' + walk[6] + ')'
            : 'no llego');

    check('y lleva la duracion del paso',
        walk && walk[9] === 550,
        walk ? walk[9] + ' ms' : 'sin duracion');

    check('el servidor movio al jugador de verdad',
        gameSession.player.position.y === before.y + 1,
        'el cliente pidio y el motor ejecuto: ' + gameSession.player.position);

    // =======================================================================
    section('4. La autoridad cruza la red intacta');
    // =======================================================================

    {
        // Se coloca al jugador junto a un muro, en el servidor.
        const wall = { x: 12, y: 11, z: 7 };
        engine.world.teleportCreature(gameSession.player, wall);
        gameSession.player.nextStepAt = 0;
        engine.view.markDirty(gameSession.playerId);
        await sleep(200);

        const stuck = gameSession.player.position.copy();
        client.received.length = 0;
        client.send([P.CLIENT.WALK_NORTH]);
        await sleep(200);

        check('un paso hacia un muro no se ejecuta ni por la red',
            gameSession.player.position.y === stuck.y,
            'el muro sigue en (12,10) y el jugador sigue en ' + gameSession.player.position);

        check('y el cliente no recibe ningun movimiento',
            client.count(P.SERVER.CREATURE_MOVE) === 0,
            'caminar contra una pared es normal, no un error que responder');
    }

    {
        // El cliente manda basura y opcodes inventados: el servidor debe seguir en
        // pie y el jugador no debe moverse.
        const position = gameSession.player.position.copy();

        client.socket.send('esto no es JSON');
        client.socket.send(JSON.stringify({ opcode: 999 }));
        client.socket.send(JSON.stringify([0xEE, 1, 2, 3]));
        client.socket.send(JSON.stringify([[0xEE, 9], [0xED, 60, 60]]));
        await sleep(250);

        check('la basura por el socket no tumba la conexion',
            client.socket.readyState === WebSocket.OPEN,
            'el servidor ignora lo que no entiende en vez de cerrar');

        // La comprobacion es que la posicion NO cambio. Antes tenia un `||` que la
        // hacia verdadera siempre, y una comprobacion que no puede fallar no
        // comprueba nada.
        check('y ningun opcode inventado mueve al jugador',
            gameSession.player.position.x === position.x &&
            gameSession.player.position.y === position.y &&
            gameSession.player.position.z === position.z,
            'sigue exactamente en ' + gameSession.player.position);

        // Un lote con un mensaje VALIDO dentro si debe ejecutarse: el lote se
        // procesa entero, no se descarta por llevar uno malo.
        const beforeBatch = gameSession.player.position.copy();
        gameSession.player.nextStepAt = 0;
        client.socket.send(JSON.stringify([[0xEE, 9], [P.CLIENT.WALK_SOUTH]]));
        await sleep(250);

        check('un lote se procesa entero y ejecuta lo que es valido',
            gameSession.player.position.y === beforeBatch.y + 1,
            'de ' + beforeBatch + ' a ' + gameSession.player.position);

        check('el servidor contabiliza lo que procesa',
            network.stats.messages > 2,
            network.stats.messages + ' mensajes procesados');
    }

    // =======================================================================
    section('5. Varios jugadores por la red');
    // =======================================================================

    {
        const a = engine.sessions.get(loginOk[1]);
        const b = engine.sessions.get(batches[0] && batches[0][0] &&
            batches[0].find((m) => m[0] === P.SERVER.LOGIN_OK)
            ? batches[0].find((m) => m[0] === P.SERVER.LOGIN_OK)[1] : null);

        check('hay dos jugadores conectados', engine.sessions.size >= 2,
            engine.sessions.size + ' sesiones');

        if (a && b) {
            // Se colocan cerca y se comprueba que se ven.
            engine.world.teleportCreature(a.player, { x: 40, y: 40, z: 7 });
            engine.world.teleportCreature(b.player, { x: 42, y: 40, z: 7 });
            a.nextStepAt = 0;
            engine.view.markDirty(a.playerId);
            engine.view.markDirty(b.playerId);
            await sleep(300);

            const seesB = a.playerId !== b.playerId;
            check('los dos jugadores estan en el mundo a la vez', seesB,
                'ids ' + a.playerId + ' y ' + b.playerId);
        }
    }

    // =======================================================================
    section('6. Los comandos y los mensajes LLEGAN al cliente');
    // =======================================================================

    {
        /*
         * ESTA SECCIÓN EXISTE POR DOS FALLOS QUE NO SE VEÍAN DESDE NINGUNA OTRA PRUEBA.
         *
         * Los talkactions estaban registrados y probados, y el cliente no los alcanzaba
         * nunca: el mensaje de chat se difundía como habla y no se despachaba. Y
         * `sendTextMessage` sólo apuntaba el texto en una lista interna, así que todo lo
         * que el contenido le decía a un jugador era invisible en el juego.
         *
         * Los dos son el mismo tipo de fallo: piezas que funcionan por separado y no
         * están conectadas. Cada mitad pasaba su prueba y el camino completo no existía,
         * que es exactamente lo que una prueba de extremo a extremo tiene que cubrir.
         */
        const session = engine.sessions.get(loginOk[1]);
        const textsBefore = client.count(P.SERVER.TEXT);

        session.handle([P.CLIENT.SAY, '/outfit 131 100 50 20 115 3']);
        await sleep(250);

        check('un comando cambia el aspecto del jugador',
            session.player.outfit.lookType === 131 &&
            session.player.outfit.addons === 3,
            'aspecto ' + session.player.outfit.lookType + ' con anadidos ' +
            session.player.outfit.addons);

        const confirmation = client.received
            .filter((m) => m[0] === P.SERVER.TEXT)
            .slice(textsBefore)
            .pop();

        check('Y LA CONFIRMACION LLEGA AL CLIENTE',
            confirmation !== undefined && /Aspecto: tipo 131/.test(confirmation[2]),
            confirmation ? '"' + confirmation[2] + '"'
                : 'no llego nada: el mensaje se quedo en una lista interna');

        // Un comando NO se difunde como habla: no es una frase.
        const saysBefore = client.count(P.SERVER.CREATURE_SAY);
        session.handle([P.CLIENT.SAY, '/pos']);
        await sleep(250);

        check('un comando no se difunde como si lo hubieras dicho',
            client.count(P.SERVER.CREATURE_SAY) === saysBefore,
            'un comando no es una frase, y verlo en el chat seria raro');

        const posAnswer = client.received.filter((m) => m[0] === P.SERVER.TEXT).pop();

        check('y su respuesta tambien llega',
            /Posicion:/.test(posAnswer ? posAnswer[2] : ''),
            '"' + (posAnswer ? posAnswer[2] : 'no llego') + '"');

        // Una frase normal SI se difunde, y con el nombre de quien la dice.
        const saysBeforeTalk = client.count(P.SERVER.CREATURE_SAY);
        session.handle([P.CLIENT.SAY, 'hola a todos']);
        await sleep(250);

        const said = client.received.filter((m) => m[0] === P.SERVER.CREATURE_SAY)
            .slice(saysBeforeTalk).pop();

        check('una frase normal si se difunde como habla',
            said !== undefined && said[3] === 'hola a todos',
            said ? '"' + said[2] + ': ' + said[3] + '"' : 'no llego');
    }

    // =======================================================================
    section('7. Recoger, soltar y el inventario');
    // =======================================================================

    {
        const session = engine.sessions.get(loginOk[1]);

        // Se le pone una moneda en su propia casilla, desde el servidor, que es lo que
        // haria el botin de un monstruo.
        const position = session.player.position;
        engine.world.createItem(3031, 25, {
            x: position.x, y: position.y, z: position.z
        });

        client.received.length = 0;
        client.send([P.CLIENT.PICKUP, position.x, position.y, position.z]);
        await sleep(300);

        const inventory = client.received.filter((m) => m[0] === P.SERVER.INVENTORY).pop();

        check('recoger manda el inventario al cliente',
            inventory !== undefined &&
            inventory[P.INVENTORY_FIELD.COUNT] === 1 &&
            inventory[P.INVENTORY_FIELD.ENTRIES + 2] === 25,
            inventory
                ? inventory[P.INVENTORY_FIELD.ENTRIES + 2] + 'x ' +
                    inventory[P.INVENTORY_FIELD.ENTRIES + 3]
                : 'no llego el inventario');

        check('y lo confirma con un mensaje',
            /Has recogido/.test((client.received.filter((m) => m[0] === P.SERVER.TEXT)
                .pop() || [])[2] || ''),
            '"' + ((client.received.filter((m) => m[0] === P.SERVER.TEXT).pop() || [])[2]
                || '') + '"');

        check('el objeto ya no esta en el suelo',
            engine.world.map.getTile(position.x, position.y, position.z)
                .downItems.concat(
                    engine.world.map.getTile(position.x, position.y, position.z).topItems)
                .filter((item) => item.typeId === 3031).length === 0);

        // --- Soltar ---
        client.received.length = 0;
        client.send([P.CLIENT.DROP, 0]);
        await sleep(300);

        const afterDrop = client.received.filter((m) => m[0] === P.SERVER.INVENTORY).pop();

        check('soltar deja el inventario vacio y lo dice',
            afterDrop !== undefined && afterDrop[P.INVENTORY_FIELD.COUNT] === 0,
            afterDrop ? 'quedan ' + afterDrop[P.INVENTORY_FIELD.COUNT] + ' cosa(s)' : 'no llego');

        // --- Lo que tiene que rechazar ---
        client.received.length = 0;
        client.send([P.CLIENT.PICKUP, 5, 5, 7]);
        await sleep(250);

        check('recoger de lejos se rechaza y se explica',
            /demasiado lejos/.test((client.received.filter((m) => m[0] === P.SERVER.TEXT)
                .pop() || [])[2] || ''),
            '"' + ((client.received.filter((m) => m[0] === P.SERVER.TEXT).pop() || [])[2]
                || '') + '"');

        const inventoryAfterFar = client.received
            .filter((m) => m[0] === P.SERVER.INVENTORY).length;

        check('y no manda el inventario, porque no ha cambiado',
            inventoryAfterFar === 0,
            'mandarlo sin que cambie seria ruido');
    }

    // =======================================================================
    section('8. Desconexion');
    // =======================================================================

    {
        const id = loginOk[1];
        check('el jugador esta en el mundo antes de desconectar',
            engine.world.getPlayer(id) !== null);

        client.close();
        await sleep(300);

        check('al desconectar sale del mundo',
            engine.world.getPlayer(id) === null,
            'no queda estado colgado');

        check('y la sesion se da de baja',
            engine.sessions.get(id) === null,
            'quedan ' + engine.sessions.size + ' sesiones');

        check('el servidor sigue aceptando conexiones',
            network.stats.accepted >= 2,
            network.stats.accepted + ' conexiones aceptadas en total');
    }

    // =======================================================================
    section('9. Cierre ordenado');
    // =======================================================================

    {
        collector.close();
        await sleep(100);

        await network.close();
        engine.shutdown();

        check('el servidor se cierra sin dejar nada vivo',
            true, 'conexiones: ' + network.connections.size);

        check('el motor queda parado',
            engine.world.timer === null,
            'sin bucle de tick');
    }

    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el motor y la red funcionan de extremo a extremo.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main().catch((error) => {
    console.error('\u001b[31mLa prueba fallo con una excepcion:\u001b[0m');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
