/**
 * Prueba de la lógica de dibujo del cliente.
 *
 * El 2.5D no son píxeles: son dos decisiones —cuánto se desplaza cada planta y en
 * qué orden se pinta todo— y las dos son cálculo puro. Por eso se pueden verificar
 * sin abrir un navegador ni mirar una captura, que es lo que hace que esta prueba
 * sirva de algo.
 *
 * Se importan los MISMOS módulos que carga el navegador. No hay copia para la
 * prueba: si el cliente se rompe, aquí se ve.
 *
 * Uso:  node tools/test-render.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Camera, TILE_PIXELS, floorOffset } from '../client/avillatoro/js/camera.js';
import { ClientWorld } from '../client/avillatoro/js/world.js';
import { buildDrawList, forEachTileInDrawOrder, summarize, DRAW } from '../client/avillatoro/js/drawlist.js';

// El protocolo es el mismo archivo que usa el motor, y es CommonJS-friendly: se
// carga con require para no depender de la ruta del montaje del servidor.
const require = createRequire(import.meta.url);
const P = require('../shared/js/protocol.mjs');

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

/** Un mundo de cliente con un reloj controlado. */
function makeWorld(startTime) {
    const clock = { value: startTime === undefined ? 100000 : startTime };
    const world = new ClientWorld({ now: () => clock.value });
    return { world, clock };
}

/** Mete un tile en el mundo tal y como lo mandaría el motor. */
function tileMessage(x, y, z, ground, downIds, topIds) {
    const down = (downIds || []).map((id) => [id, 1, 0]);
    const top = (topIds || []).map((id) => [id, 1, 0]);
    const items = down.concat(top);
    return [P.SERVER.TILE_ADD, x, y, z, ground, down.length, items.length]
        .concat(items.reduce((flat, entry) => flat.concat(entry), []));
}

function main() {
    console.log('Prueba de la lógica de dibujo del cliente (' + ROOT + ')');

    // =======================================================================
    section('1. El desplazamiento por planta (la mitad del 2.5D)');
    // =======================================================================

    check('la planta de la cámara no se desplaza',
        floorOffset(7, 7).x === 0 && floorOffset(7, 7).y === 0);

    // Una planta por ENCIMA se corre hacia abajo y a la derecha. Es lo que hace que
    // una plataforma elevada tape el suelo que tiene delante, que está abajo y a la
    // derecha en la pantalla.
    check('una planta por encima se corre abajo-derecha',
        floorOffset(6, 7).x === 1 && floorOffset(6, 7).y === 1,
        'planta 6 vista desde la 7: (+1, +1)');

    check('una planta por debajo se corre arriba-izquierda',
        floorOffset(8, 7).x === -1 && floorOffset(8, 7).y === -1,
        'planta 8 vista desde la 7: (-1, -1)');

    check('el desplazamiento es proporcional a la diferencia de plantas',
        floorOffset(4, 7).x === 3 && floorOffset(11, 7).x === -4,
        'tres plantas arriba son +3; cuatro abajo son -4');

    {
        const camera = new Camera({ width: 320, height: 224, tileSize: TILE_PIXELS });
        camera.setCenter(40, 40, 7);

        const here = camera.worldToScreen(40, 40, 7);
        check('la casilla de la cámara cae en el centro del lienzo',
            here.x === 160 && here.y === 112,
            '(' + here.x + ', ' + here.y + ') con un lienzo de 320x224');

        const above = camera.worldToScreen(40, 40, 6);
        check('la misma casilla una planta arriba sale corrida un tile',
            above.x === 160 + TILE_PIXELS && above.y === 112 + TILE_PIXELS,
            'un tile es ' + TILE_PIXELS + ' px');

        const below = camera.worldToScreen(40, 40, 8);
        check('y una planta abajo, al contrario',
            below.x === 160 - TILE_PIXELS && below.y === 112 - TILE_PIXELS);

        const inverse = camera.screenToWorld(here.x + 4, here.y + 4, 7);
        check('la conversión inversa devuelve la misma casilla',
            inverse.x === 40 && inverse.y === 40,
            'de píxel a mundo y vuelta');

        // La planta de abajo necesita un rectángulo desplazado, o al mirarla se
        // vería un borde vacío por la izquierda y por arriba.
        const rectHere = camera.visibleRect(7);
        const rectBelow = camera.visibleRect(8);
        check('el rectángulo visible de una planta de abajo se desplaza',
            rectBelow.x0 === rectHere.x0 + 1 && rectBelow.y0 === rectHere.y0 + 1,
            'sin esto se vería un borde vacío al mirar hacia abajo');
    }

    // =======================================================================
    section('2. El orden de dibujo dentro de una planta (la otra mitad)');
    // =======================================================================

    {
        const visited = [];
        forEachTileInDrawOrder({ x0: 0, y0: 0, x1: 2, y1: 2 }, (x, y) => {
            visited.push(x + ',' + y);
        });

        check('se visitan todas las casillas del rectángulo',
            visited.length === 9 && new Set(visited).size === 9,
            visited.length + ' casillas de 3x3');

        // La regla: de la esquina de arriba a la izquierda hacia la de abajo a la
        // derecha. Es lo que hace que lo que está más abajo en pantalla se pinte
        // después y tape al muñeco que tiene detrás.
        const sums = visited.map((k) => {
            const parts = k.split(',');
            return Number(parts[0]) + Number(parts[1]);
        });
        let nonDecreasing = true;
        for (let index = 1; index < sums.length; index += 1) {
            if (sums[index] < sums[index - 1]) { nonDecreasing = false; break; }
        }
        check('la suma x+y nunca retrocede',
            nonDecreasing, 'diagonales: ' + sums.join(','));

        check('la primera casilla es la de arriba a la izquierda',
            visited[0] === '0,0');
        check('y la última la de abajo a la derecha',
            visited[visited.length - 1] === '2,2');

        // Dentro de una diagonal se avanza en x y se retrocede en y.
        const diagonalThird = visited.filter((k) => {
            const parts = k.split(',');
            return Number(parts[0]) + Number(parts[1]) === 2;
        });
        check('dentro de una diagonal se avanza de izquierda a derecha',
            diagonalThird.join(' ') === '0,2 1,1 2,0',
            diagonalThird.join(' '));
    }

    {
        // Entre plantas: de la más profunda a la más alta, porque las de arriba se
        // pintan después y tienen que tapar a las de abajo.
        const { world } = makeWorld();
        world.apply([
            tileMessage(10, 10, 7, 102),
            tileMessage(10, 10, 6, 103),
            tileMessage(10, 10, 8, 104)
        ], P);

        check('el cliente ordena las plantas de la más profunda a la más alta',
            world.floors().join(',') === '8,7,6',
            'plantas recibidas: ' + world.floors().join(', '));
    }

    // =======================================================================
    section('3. Dentro de un tile: suelo, items de abajo, criaturas, items de arriba');
    // =======================================================================

    {
        const { world } = makeWorld();
        world.playerId = 1;

        // Un tile con un item abajo (muro) y uno arriba (barandilla), y una
        // criatura encima.
        world.apply([
            tileMessage(20, 20, 7, 102, [111], [112]),
            [P.SERVER.CREATURE_ADD, 5, 0, 'Rata', 20, 20, 7, 2, 100, 1]
        ], P);

        const camera = new Camera({ width: 320, height: 224 });
        camera.setCenter(20, 20, 7);

        const ops = buildDrawList(world, camera);
        const kinds = ops.map((op) => op.kind === DRAW.ITEM
            ? 'item' + op.typeId : op.kind);

        check('el suelo va primero, luego el item de abajo, luego la criatura, luego el de arriba',
            kinds.join(' -> ') === 'ground -> item111 -> creature -> item112',
            kinds.join(' -> '));

        check('y el corte entre abajo y arriba lo decidio el motor, no el cliente',
            world.getTile(20, 20, 7).downCount === 1,
            'el cliente solo obedece el numero que le llegó');
    }

    // =======================================================================
    section('4. El cliente NO se inventa lo que no ha recibido');
    // =======================================================================

    {
        const { world } = makeWorld();
        const camera = new Camera({ width: 320, height: 224 });
        camera.setCenter(40, 40, 7);

        let ops = buildDrawList(world, camera);
        check('sin haber recibido nada, no hay nada que dibujar',
            ops.length === 0, ops.length + ' operaciones');

        world.apply([tileMessage(40, 40, 7, 102)], P);
        ops = buildDrawList(world, camera);

        check('con un solo tile recibido, se dibuja una sola cosa',
            ops.length === 1 && ops[0].kind === DRAW.GROUND,
            'el mundo del cliente son 1 tile y el motor manda 1 tile');

        // Se pide un rectángulo enorme y el cliente sigue dibujando lo que tiene.
        camera.setViewport(3200, 3200);
        ops = buildDrawList(world, camera);
        check('un rectángulo enorme no hace aparecer terreno inventado',
            ops.length === 1,
            'el cliente NO rellena los huecos: lo que no llega no existe');

        world.apply([[P.SERVER.TILE_REMOVE, 40, 40, 7]], P);
        ops = buildDrawList(world, camera);
        check('y al borrarlo el motor, desaparece',
            ops.length === 0);
    }

    // =======================================================================
    section('5. Interpolación de las criaturas que se mueven');
    // =======================================================================

    {
        const { world, clock } = makeWorld(1000);
        world.playerId = 99;

        world.apply([
            tileMessage(30, 30, 7, 102),
            tileMessage(30, 31, 7, 102),
            [P.SERVER.CREATURE_ADD, 7, 0, 'Rata', 30, 30, 7, 2, 100, 1]
        ], P);

        const rat = world.creatures.get(7);
        check('la criatura empieza quieta',
            world.creaturePosition(rat).x === 30 && world.creaturePosition(rat).moving === false);

        // Se mueve de (30,30) a (30,31) en 550 ms.
        world.apply([
            [P.SERVER.CREATURE_MOVE, 7, 30, 30, 7, 30, 31, 7, 2, 550]
        ], P);

        const at0 = world.creaturePosition(rat, 1000);
        check('recién empezado el paso, está en el origen',
            at0.x === 30 && at0.y === 30 && at0.moving === true,
            'la posición la calcula el cliente, pero la DURACIÓN la puso el motor');

        const atHalf = world.creaturePosition(rat, 1275);
        check('a mitad del paso, está a mitad de camino',
            Math.abs(atHalf.y - 30.5) < 0.001 && atHalf.moving === true,
            'y = ' + atHalf.y + ' a los 275 ms de 550');

        const atEnd = world.creaturePosition(rat, 1550);
        check('pasado el tiempo, está en el destino',
            atEnd.y === 31 && atEnd.moving === false);

        // Cerrar el movimiento es un paso EXPLÍCITO. Antes lo hacía la propia
        // consulta de la posición, como efecto secundario, y eso significaba que la
        // posición lógica sólo avanzaba si alguien la había consultado: en una
        // prueba sin renderer, los muñecos se quedaban a medio camino para siempre.
        const closed = world.update(1550);
        check('cerrar el movimiento es un paso explícito',
            closed === 1 && rat.x === 30 && rat.y === 31 && rat.moving === null,
            'deja de interpolarse y pasa a ocupar la casilla nueva');

        // La posición interpolada se usa para DIBUJAR, pero el orden de la pila usa
        // la casilla lógica: si no, la criatura cambiaría de capa a mitad de paso.
        //
        // El reloj se avanza ANTES de aplicar el movimiento: `startedAt` es el
        // instante en que llega el mensaje, así que sin avanzarlo el paso ya
        // estaría terminado cuando se le pregunta por la mitad.
        clock.value = 2000;
        world.apply([[P.SERVER.CREATURE_MOVE, 7, 30, 31, 7, 30, 32, 7, 2, 550]], P);

        const camera = new Camera({ width: 320, height: 224 });
        camera.setCenter(30, 31, 7);

        const mid = buildDrawList(world, camera, { now: 2275 });
        const creatureOp = mid.find((op) => op.kind === DRAW.CREATURE);

        check('la criatura se dibuja en su posición interpolada',
            creatureOp && Math.abs(creatureOp.sy - (112 + TILE_PIXELS * 0.5)) < 1,
            creatureOp ? 'y = ' + creatureOp.sy + ' px, media casilla por debajo ' +
                'del centro: entre dos casillas, no saltando de una a otra'
                : 'no se dibujo la criatura');

        check('pero su sitio en la pila sigue siendo la casilla de ORIGEN',
            creatureOp && creatureOp.y === 31,
            'el sprite se desliza, la capa no cambia a mitad de camino');
    }

    // =======================================================================
    section('6. El jugador propio se interpola como los demás');
    // =======================================================================

    {
        const { world, clock } = makeWorld(1000);
        world.apply([
            [P.SERVER.LOGIN_OK, 42, 'Yo', 50, 50, 7, 150, 150, 1, 0, 'None'],
            tileMessage(50, 50, 7, 102),
            tileMessage(50, 51, 7, 102)
        ], P);

        check('el jugador se identifica a si mismo',
            world.playerId === 42 && world.player.name === 'Yo');

        world.apply([[P.SERVER.CREATURE_ADD, 42, 0, 'Yo', 50, 50, 7, 2, 100, 0]], P);
        const me = world.creatures.get(42);
        check('y se reconoce como tal', me.isPlayer === true);

        clock.value = 2000;
        world.apply([[P.SERVER.CREATURE_MOVE, 42, 50, 50, 7, 50, 51, 7, 2, 550]], P);

        const half = world.creaturePosition(me, 2275);
        check('su movimiento SI se interpola, como el de cualquier criatura',
            Math.abs(half.y - 50.5) < 0.001 && half.moving === true,
            'y = ' + half.y + ': el muñeco se desliza y el mundo con él');

        const done = world.creaturePosition(me, 2550);
        check('y al terminar ocupa la casilla nueva',
            done.y === 51 && done.moving === false);
    }

    // =======================================================================
    section('7. Cambio de planta y mensajes desconocidos');
    // =======================================================================

    {
        const { world } = makeWorld();
        world.apply([tileMessage(10, 10, 7, 102)], P);
        check('hay un tile antes del cambio de planta', world.tiles.size === 1);

        world.apply([[P.SERVER.FLOOR_CHANGE, 8]], P);
        check('el cambio de planta vacía lo anterior',
            world.tiles.size === 0 && world.creatures.size === 0,
            'sin esto quedarian tiles de la planta vieja dibujandose encima');

        world.apply([tileMessage(10, 10, 8, 104)], P);
        check('y a partir de ahi se recibe la planta nueva',
            world.getTile(10, 10, 8) !== null && world.getTile(10, 10, 7) === null);
    }

    {
        const { world } = makeWorld();
        const before = world.tiles.size;

        // Un opcode que este cliente no conoce. Ignorarlo es lo que permite que el
        // motor añada mensajes sin obligar a actualizar todos los clientes.
        const result = world.apply([[0x7E, 1, 2, 3]], P);

        check('un opcode desconocido se ignora sin romper nada',
            world.tiles.size === before && result.tiles === 0,
            'el motor puede añadir mensajes sin romper clientes viejos');
    }

    // =======================================================================
    section('8. Resumen de la lista de dibujo');
    // =======================================================================

    {
        const { world } = makeWorld();
        world.playerId = 1;

        const messages = [];
        for (let y = 30; y < 34; y += 1) {
            for (let x = 30; x < 34; x += 1) {
                messages.push(tileMessage(x, y, 7, 102, x === 31 ? [111] : [], []));
            }
        }
        messages.push([P.SERVER.CREATURE_ADD, 3, 0, 'Rata', 32, 32, 7, 2, 50, 1]);
        world.apply(messages, P);

        const camera = new Camera({ width: 320, height: 224 });
        camera.setCenter(31, 31, 7);

        const ops = buildDrawList(world, camera);
        const summary = summarize(ops);

        check('el resumen cuenta lo que hay',
            summary.ground === 16 && summary.items === 4 && summary.creatures === 1,
            JSON.stringify(summary));

        check('y la lista esta ordenada por planta y luego por diagonal',
            summary.floors.length === 1 && summary.floors[0] === 7);

        // El orden de las operaciones de suelo debe seguir las diagonales.
        const groundSums = ops.filter((op) => op.kind === DRAW.GROUND)
            .map((op) => op.x + op.y);
        let ordered = true;
        for (let index = 1; index < groundSums.length; index += 1) {
            if (groundSums[index] < groundSums[index - 1]) { ordered = false; break; }
        }
        check('las casillas se pintan en orden de diagonal',
            ordered, 'sumas: ' + groundSums.join(','));
    }

    // =======================================================================
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el cliente ordena y desplaza como debe.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
