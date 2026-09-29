/**
 * Prueba de extremo a extremo DEL CLIENTE: el código real del cliente contra el
 * servidor real.
 *
 * Las otras pruebas usan trozos: `test-protocol` prueba el motor sin socket,
 * `test-render` prueba el dibujo sin motor y `net-test` prueba el transporte sin
 * cliente. Ésta junta las tres cosas y usa **los mismos módulos que carga el
 * navegador** —`world.js`, `camera.js`, `drawlist.js`— contra un servidor de verdad
 * escuchando en un puerto.
 *
 * Es lo que detecta las discrepancias que ninguna prueba por partes puede ver: un
 * campo en la posición equivocada del mensaje, un opcode que el cliente no maneja,
 * un orden que no cuadra. Y se puede ejecutar sin navegador porque la lógica del
 * cliente es cálculo puro: lo único que no se prueba aquí son las llamadas al
 * lienzo, que son la parte que no decide nada.
 *
 * Uso:  node tools/test-client-e2e.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ClientWorld } from '../client/avillatoro/js/world.js';
import { Camera } from '../client/avillatoro/js/camera.js';
import { buildDrawList, summarize, DRAW } from '../client/avillatoro/js/drawlist.js';

const require = createRequire(import.meta.url);
const P = require('../shared/js/protocol.mjs');
const { WebSocket } = require('ws');
const { createEngine } = require('../engine/core/engine');
const { createNetworkServer } = require('../engine/net/server');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
 * Un cliente de verdad, sin navegador.
 *
 * Usa la MISMA `ClientWorld` que el navegador y el mismo desempaquetado de marcos.
 */
class HeadlessClient {
    constructor(url) {
        this.world = new ClientWorld();
        this.socket = new WebSocket(url);
        this.frames = 0;
        this.bytes = 0;
        this.ready = false;

        this.socket.on('message', (raw) => {
            this.frames += 1;
            this.bytes += raw.length;

            const parsed = JSON.parse(raw.toString());
            const messages = Array.isArray(parsed[0]) ? parsed : [parsed];
            this.world.apply(messages, P);
        });
    }

    open() {
        return new Promise((resolve, reject) => {
            this.socket.once('open', () => { this.ready = true; resolve(); });
            this.socket.once('error', reject);
        });
    }

    send(message) {
        this.socket.send(JSON.stringify(message));
    }

    async waitUntil(predicate, timeoutMs) {
        const deadline = Date.now() + (timeoutMs || 3000);
        while (Date.now() < deadline) {
            // Se cierran los movimientos terminados en cada vuelta, que es lo que
            // hace el bucle del cliente de verdad en cada fotograma. Sin esto, la
            // posición lógica de una criatura no avanza nunca: cerrarla es un paso
            // explícito, no un efecto de consultarla.
            this.world.update();

            if (predicate(this.world)) {
                return true;
            }
            await sleep(20);
        }
        return false;
    }

    close() {
        this.socket.close();
    }
}

async function main() {
    console.log('Prueba de extremo a extremo del cliente (' + ROOT + ')');

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
        port: 0,
        logger: { info() {}, warning() {}, error() {} }
    });

    engine.start();
    const port = await network.ready;

    const client = new HeadlessClient('ws://127.0.0.1:' + port);

    // =======================================================================
    section('1. Entrar al mundo con el cliente de verdad');
    // =======================================================================

    await client.open();
    client.send([P.CLIENT.ENTER_WORLD, 'PorCliente']);

    const gotWorld = await client.waitUntil((world) => world.tiles.size > 500, 4000);

    check('el cliente recibe y aplica el mapa',
        gotWorld, client.world.tiles.size + ' tiles');

    check('y se reconoce a si mismo',
        client.world.playerId !== null && client.world.player.name === 'PorCliente',
        'id ' + client.world.playerId + ' en (' + client.world.player.x + ',' +
        client.world.player.y + ',' + client.world.player.z + ')');

    check('el jugador esta entre las criaturas que dibuja',
        client.world.creatures.has(client.world.playerId),
        client.world.creatures.size + ' criaturas');

    check('el saludo trajo el tamano del mundo',
        client.world.size.width === 64 && client.world.size.floors === 16,
        client.world.size.width + 'x' + client.world.size.height + 'x' + client.world.size.floors);

    // =======================================================================
    section('2. La lista de dibujo con datos reales del servidor');
    // =======================================================================

    const player = client.world.player;
    const camera = new Camera({ width: 960, height: 640 });

    // Esperar a que la interpolación se asiente, para medir posiciones estables.
    await sleep(200);
    const me = client.world.creatures.get(client.world.playerId);
    const mePosition = client.world.creaturePosition(me);
    camera.setCenter(mePosition.x, mePosition.y, me.z);

    const ops = buildDrawList(client.world, camera);
    const summary = summarize(ops);

    check('la lista de dibujo tiene suelo de sobra',
        summary.ground > 200,
        JSON.stringify(summary));

    check('el suelo sale de las plantas que el motor mando, ni una mas',
        summary.floors.length === client.world.floors().length,
        'plantas dibujadas: ' + summary.floors.join(', '));

    check('el jugador aparece en la lista',
        ops.some((op) => op.kind === DRAW.CREATURE && op.id === client.world.playerId));

    // El orden es lo que se viene a comprobar: las casillas tienen que ir por
    // diagonales, y las plantas de mas profunda a mas alta.
    {
        let okOrder = true;
        let previousFloor = Infinity;
        let previousSum = -1;

        for (const op of ops) {
            if (op.z < previousFloor) {
                // Se ha pasado a una planta mas alta: correcto, y la suma se
                // reinicia porque empieza un barrido nuevo.
                previousFloor = op.z;
                previousSum = -1;
            } else if (op.z > previousFloor) {
                okOrder = false;
                break;
            }

            if (op.kind === DRAW.GROUND) {
                const sum = op.x + op.y;
                if (sum < previousSum) {
                    okOrder = false;
                    break;
                }
                previousSum = sum;
            }
        }

        check('las plantas van de la mas profunda a la mas alta y el suelo por diagonales',
            okOrder,
            'el orden es lo que hace que las cosas se tapen unas a otras bien');
    }

    // Las posiciones en pantalla tienen que caer dentro del lienzo, con margen: si
    // algo se dibujara fuera, seria un error de camara.
    {
        const inside = ops.filter((op) => op.sx > -200 && op.sx < camera.width + 200 &&
            op.sy > -200 && op.sy < camera.height + 200);

        check('casi todo lo que se dibuja cae dentro del lienzo',
            inside.length === ops.length,
            inside.length + ' de ' + ops.length + ' operaciones');
    }

    // =======================================================================
    section('3. Caminar y verlo con los ojos del cliente');
    // =======================================================================

    {
        const before = { x: me.x, y: me.y };

        client.send([P.CLIENT.WALK_SOUTH]);

        // Se mira el estado EN CURSO antes de esperar a que termine. El paso dura
        // 550 ms, así que a los 100 ms está a medias: preguntar por él despues de
        // esperar al destino devolveria "no se esta moviendo", que es lo correcto
        // pero no lo que se quiere medir aqui.
        await sleep(100);
        const walking = client.world.creatures.get(client.world.playerId).moving;

        check('el cliente lo tiene como un movimiento en curso',
            walking !== null,
            walking ? walking.duration + ' ms de duracion' : 'no hay movimiento');

        check('y la duracion la puso el motor, no el cliente',
            walking !== null && walking.duration === 550,
            'la de la formula de Tibia para speed 220 sobre hierba');

        if (walking) {
            const mid = walking.positionAt(walking.startedAt + walking.duration / 2);
            check('y a mitad del tiempo esta a mitad de camino',
                Math.abs(mid.y - (before.y + 0.5)) < 0.01,
                'y = ' + mid.y + ': el muneco se desliza, no salta');
        }

        const arrived = await client.waitUntil(
            (world) => world.creatures.get(world.playerId).y === before.y + 1, 2000);

        check('y al terminar el paso ocupa la casilla nueva',
            arrived,
            'de (' + before.x + ',' + before.y + ') a (' +
            client.world.creatures.get(client.world.playerId).x + ',' +
            client.world.creatures.get(client.world.playerId).y + ')');
    }

    // =======================================================================
    section('4. Un muro, desde el cliente');
    // =======================================================================

    {
        // Se coloca al jugador junto a un muro desde el servidor.
        const session = engine.sessions.get(client.world.playerId);
        engine.world.teleportCreature(session.player, { x: 12, y: 11, z: 7 });
        session.player.nextStepAt = 0;
        engine.view.markDirty(session.playerId);

        await sleep(300);

        // Se cierra el teletransporte antes de medir. Va con duracion CERO —un
        // teletransporte no se anda— pero sigue siendo un movimiento hasta que el
        // cliente lo cierra.
        client.world.update();

        const position = engine.world.getPlayer(client.world.playerId).position.copy();
        client.send([P.CLIENT.WALK_NORTH]);
        await sleep(300);
        client.world.update();

        check('el muro sigue frenando al jugador',
            engine.world.getPlayer(client.world.playerId).position.y === position.y,
            'sigue en (' + position.x + ',' + position.y + ')');

        check('y el cliente no ha inventado un movimiento',
            client.world.creatures.get(client.world.playerId).moving === null,
            'sin respuesta del motor, el cliente no se mueve solo');

        check('el teletransporte llego sin animacion',
            client.world.creatures.get(client.world.playerId).x === 12 &&
            client.world.creatures.get(client.world.playerId).y === 11,
            'un salto no se desliza: aparece');
    }

    // =======================================================================
    section('5. Combate visto desde el cliente');
    // =======================================================================

    {
        const session = engine.sessions.get(client.world.playerId);
        engine.world.teleportCreature(session.player, { x: 30, y: 30, z: 7 });
        session.player.nextStepAt = 0;
        session.player.nextAttackAt = 0;
        session.player.weaponAttack = 20;

        // Se pone un monstruo al lado, con vida de sobra para que aguante.
        const rat = engine.world.createMonster('Rat', { x: 31, y: 31, z: 7 });
        rat.maxHealth = 500;
        rat.health = 500;

        engine.view.markDirty(session.playerId);
        await sleep(300);

        const known = await client.waitUntil(
            (world) => world.creatures.has(rat.id), 2000);

        check('el cliente ve aparecer al monstruo',
            known, rat.name + ' ' + rat.health + '/' + rat.maxHealth);

        client.send([P.CLIENT.ATTACK, rat.id]);
        const damaged = await client.waitUntil((world) => {
            const seen = world.creatures.get(rat.id);
            return seen && seen.health < 100;
        }, 2000);

        check('y ve bajar su salud cuando le atacan',
            damaged,
            'el cliente ve ' +
            (client.world.creatures.get(rat.id)
                ? client.world.creatures.get(rat.id).health + '%' : '?'));
    }

    // =======================================================================
    section('6. Hablar y oir');
    // =======================================================================

    {
        client.world.says.length = 0;
        client.send([P.CLIENT.SAY, 'hola desde el cliente sin navegador']);

        await sleep(300);

        const said = client.world.says.find((say) =>
            say.text === 'hola desde el cliente sin navegador');

        check('el cliente se oye a si mismo',
            said !== undefined && said.name === 'PorCliente',
            said ? '"' + said.name + ': ' + said.text + '"' : 'no llego');
    }

    // =======================================================================
    section('7. Mirar');
    // =======================================================================

    {
        client.world.texts.length = 0;
        client.send([P.CLIENT.LOOK, 30, 30, 7]);

        await sleep(300);

        check('mirar devuelve una descripcion al cliente',
            client.world.texts.length > 0,
            client.world.texts.length > 0 ? '"' + client.world.texts[0] + '"' : 'nada');
    }

    // =======================================================================
    section('8. Volumen de datos y cierre');
    // =======================================================================

    {
        const stats = client.world.stats();

        check('el cliente mantiene un mundo coherente',
            stats.tiles > 0 && stats.floors >= 1 && stats.creatures >= 1,
            JSON.stringify(stats));

        check('el trafico se agrupa en pocos marcos',
            client.frames < 60,
            client.frames + ' marcos para ' + client.world.tiles.size +
            ' tiles y ' + (client.bytes / 1024).toFixed(0) + ' KB');

        client.close();
        await sleep(200);

        check('al cerrar el cliente, el jugador sale del mundo',
            engine.sessions.size === 0 || engine.world.getPlayer(client.world.playerId) === null,
            'sesiones vivas: ' + engine.sessions.size);
    }

    // =======================================================================
    console.log('');

    await network.close();
    engine.shutdown();

    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el cliente real entiende al motor real.');
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
