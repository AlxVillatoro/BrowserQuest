'use strict';

/**
 * Prueba de la capa de mundo.
 *
 * Verifica las cuatro cosas que definen a Tibia y que son fáciles de implementar
 * mal sin que nada avise:
 *
 *   1. El coste de paso, con la fórmula real y su cuantización a 50 ms.
 *   2. El apilado por tile (stackpos) y el orden en que se dibuja.
 *   3. Las reglas de paso, incluida la que impide cortar esquinas en diagonal.
 *   4. La visibilidad entre plantas: la superficie no ve el subsuelo.
 *
 * Y una quinta que es de calidad de vida: que el validador de mapas informe de
 * TODOS los errores a la vez, con su coordenada.
 *
 * Uso:  node tools/test-world.js
 */

const path = require('path');

const { loadMap, buildMap } = require('../engine/world/loader');
const stepcost = require('../engine/world/stepcost');
const { Tile, TILE_FLAGS, MAX_STACKPOS } = require('../engine/world/tile');
const { Item } = require('../engine/world/item');
const { Position, DIRECTIONS, directionFrom } = require('../engine/world/position');
const Xml = require('../engine/data/xml');

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
    if (condition) {
        ok(label, detail);
    } else {
        fail(label, detail);
    }
}

function section(title) {
    console.log('\n' + title);
}

function main() {
    console.log('Prueba de la capa de mundo (' + ROOT + ')');

    const itemTypes = Xml.loadItems(path.join(ROOT, 'data', 'items', 'items.xml'));

    // -----------------------------------------------------------------------
    section('1. Coste de paso (la formula real de Tibia)');
    // -----------------------------------------------------------------------

    // El valor de referencia verificado contra la implementacion de TFS.
    check('speed 220 -> 550 ms por paso',
        stepcost.stepDuration(220) === 550,
        stepcost.stepDuration(220) + ' ms');

    check('la velocidad calculada intermedia coincide',
        stepcost.calculatedStepSpeed(220) === 278,
        'calculatedStepSpeed(220) = ' + stepcost.calculatedStepSpeed(220));

    // La cuantizacion a 50 ms es lo que produce los umbrales de velocidad.
    let allMultiples = true;
    for (let speed = 50; speed <= 1500; speed += 7) {
        if (stepcost.stepDuration(speed) % 50 !== 0) {
            allMultiples = false;
            break;
        }
    }
    check('todas las duraciones son multiplos del tick de 50 ms', allMultiples);

    // Monotonia: mas velocidad nunca puede tardar mas.
    let monotonic = true;
    let previous = Infinity;
    for (let speed = 50; speed <= 1500; speed += 1) {
        const duration = stepcost.stepDuration(speed);
        if (duration > previous) {
            monotonic = false;
            break;
        }
        previous = duration;
    }
    check('la duracion es monotona decreciente con la velocidad', monotonic);

    // Si la cuantizacion no existiera, cada velocidad tendria su duracion.
    const ranges = stepcost.speedBreakpoints(200, 400);
    check('existen umbrales: varias velocidades comparten duracion',
        ranges.length < 201 && ranges.length > 1,
        ranges.length + ' tramos distintos en el rango 200..400');

    const slow = stepcost.stepDuration(220);
    check('la diagonal cuesta mas que el paso recto',
        stepcost.stepDuration(220, { diagonal: true }) > slow,
        stepcost.stepDuration(220, { diagonal: true }) + ' ms vs ' + slow + ' ms');

    check('cambiar de planta cuesta mas que el paso recto',
        stepcost.stepDuration(220, { floorChange: true }) > slow,
        stepcost.stepDuration(220, { floorChange: true }) + ' ms');

    check('un suelo mas lento alarga el paso',
        stepcost.stepDuration(220, { groundSpeed: 300 }) > slow,
        stepcost.stepDuration(220, { groundSpeed: 300 }) + ' ms con groundSpeed 300');

    // El mínimo de velocidad que alcanza 550 ms. Se comprueba la PROPIEDAD, no un
    // número concreto: por la cuantización a 50 ms, todo un tramo de velocidades da
    // la misma duración, así que "la velocidad para 550 ms" es en realidad un rango.
    //
    // Al escribir esta prueba se asumió que el mínimo sería 220 y resulta ser 216.
    // Es justo el efecto que hace que subir `speed` no siempre sirva de nada, así
    // que en vez de corregir el número se comprueba la propiedad y se deja el tramo
    // a la vista.
    const minSpeed = stepcost.speedForDuration(550);
    check('speedForDuration encuentra el mínimo que alcanza 550 ms',
        stepcost.stepDuration(minSpeed) === 550 &&
        stepcost.stepDuration(minSpeed - 1) > 550,
        'mínimo = ' + minSpeed + '; con ' + (minSpeed - 1) + ' ya tarda ' +
        stepcost.stepDuration(minSpeed - 1) + ' ms');

    const plateau = stepcost.speedBreakpoints(minSpeed, minSpeed + 20)
        .find((r) => r.duration === 550);
    check('y forma un tramo: varias velocidades dan exactamente lo mismo',
        plateau && plateau.to > plateau.from,
        plateau ? 'las velocidades ' + plateau.from + '..' + plateau.to + ' dan 550 ms'
            : 'no se encontró el tramo');

    // -----------------------------------------------------------------------
    section('2. Apilado por tile (stackpos)');
    // -----------------------------------------------------------------------

    const groundDef = itemTypes.get(102);
    const wallDef = itemTypes.get(111);
    const railingDef = itemTypes.get(112);

    const tile = new Tile(5, 5, 7);
    const ground = new Item(groundDef);
    const wall = new Item(wallDef);
    const railing = new Item(railingDef);
    const creature = { name: 'Avillatoro' };

    tile.setGround(ground);
    tile.addItem(wall);
    tile.addItem(railing);
    tile.addCreature(creature);

    const stack = tile.getStack();
    check('el suelo es la posicion 0 de la pila',
        stack[0] === ground, 'stackpos 0 = ' + stack[0].getName());

    check('los items normales van DEBAJO de las criaturas',
        stack.indexOf(wall) < stack.indexOf(creature),
        'muro en ' + stack.indexOf(wall) + ', criatura en ' + stack.indexOf(creature));

    check('los items alwaysOnTop van ENCIMA de las criaturas',
        stack.indexOf(railing) > stack.indexOf(creature),
        'barandilla en ' + stack.indexOf(railing) + ', criatura en ' + stack.indexOf(creature));

    check('el orden completo es suelo, abajo, criaturas, arriba',
        stack.length === 4 &&
        stack[0] === ground && stack[1] === wall &&
        stack[2] === creature && stack[3] === railing,
        stack.map((t) => (t.getName ? t.getName() : t.name)).join(' -> '));

    check('getStackPos devuelve el indice de cada cosa',
        tile.getStackPos(ground) === 0 && tile.getStackPos(railing) === 3);

    check('el muro bloquea el paso', tile.isWalkable() === false,
        'hay un item con blocksSolid');

    // El mismo tile sin el muro: la barandilla no bloquea aunque vaya encima.
    const openTile = new Tile(6, 6, 7);
    openTile.setGround(new Item(groundDef));
    openTile.addItem(new Item(railingDef));
    check('un item alwaysOnTop que no bloquea deja el tile transitable',
        openTile.isWalkable() === true);

    // Mas alla de MAX_STACKPOS el protocolo no puede direccionar la posicion.
    const crowded = new Tile(7, 7, 7);
    crowded.setGround(new Item(groundDef));
    const extras = [];
    for (let i = 0; i < MAX_STACKPOS + 3; i += 1) {
        const item = new Item(itemTypes.get(1950));
        extras.push(item);
        crowded.addItem(item);
    }
    check('mas alla del tope de apilado, getStackPos devuelve -1',
        crowded.getStackPos(extras[MAX_STACKPOS - 2]) === MAX_STACKPOS - 1 &&
        crowded.getStackPos(extras[MAX_STACKPOS]) === -1,
        'tope = ' + MAX_STACKPOS + ', y la pila tiene ' + crowded.getStack().length + ' cosas');

    // Un tile sin suelo es un agujero: no se camina por el.
    check('un tile sin suelo no es transitable',
        new Tile(1, 1, 7).isWalkable() === false);

    // -----------------------------------------------------------------------
    section('3. Mapa: almacenamiento disperso y consulta directa');
    // -----------------------------------------------------------------------

    const loaded = loadMap(path.join(ROOT, 'data', 'world', 'sample.map.json'), {
        itemTypes: itemTypes,
        monsterTypes: new Map([['Rat', {}]])
    });
    const map = loaded.map;

    check('el mapa de ejemplo carga sin errores',
        loaded.report.ok,
        loaded.report.ok ? map.width + 'x' + map.height + 'x' + map.floors
            : loaded.report.format());

    const wallTile = map.getTile(10, 10, 7);
    check('se encuentra un tile explicito (el muro)',
        wallTile && wallTile.downItems.length === 1 &&
        wallTile.downItems[0].getName() === 'stone wall');

    check('una celda no declarada no tiene tile pero si suelo por defecto',
        map.getTile(40, 40, 7) === null &&
        map.getGround(40, 40, 7) !== null &&
        map.getGround(40, 40, 7).getName() === 'grass',
        'getGround(40,40,7) = ' + map.getGround(40, 40, 7).getName());

    check('cada planta tiene su suelo por defecto',
        map.getGround(40, 40, 7).getName() === 'grass' &&
        map.getGround(40, 40, 8).getName() === 'stone floor');

    const s = map.stats();
    check('solo se guardan las excepciones, no el mapa entero',
        s.explicitTiles < 30 && s.cellsIfMaterialized === 64 * 64 * 16,
        s.explicitTiles + ' tiles explicitos de ' + s.cellsIfMaterialized.toLocaleString('es-ES') +
        ' celdas posibles (' + (100 * s.explicitTiles / s.cellsIfMaterialized).toFixed(2) + '%)');

    check('los chunks se crean solo donde hay contenido',
        s.chunks < 20, s.chunks + ' chunks de 32x32');

    check('una celda fuera del mapa no existe',
        map.getTile(999, 999, 7) === null && map.isWalkable(999, 999, 7) === false);

    // -----------------------------------------------------------------------
    section('4. Reglas de paso');
    // -----------------------------------------------------------------------

    const free = (x, y) => ({ x: x, y: y, z: 7 });

    check('el suelo por defecto es transitable',
        map.canWalk(free(40, 40), free(41, 40)).allowed === true);

    check('un muro no es transitable',
        map.canWalk(free(11, 11), free(11, 10)).reason === 'blocked');

    check('un tile no adyacente se rechaza',
        map.canWalk(free(40, 40), free(45, 40)).reason === 'notAdjacent');

    check('no moverse se rechaza',
        map.canWalk(free(40, 40), free(40, 40)).reason === 'noMovement');

    check('cambiar de planta no es caminar',
        map.canWalk({ x: 40, y: 40, z: 7 }, { x: 40, y: 40, z: 8 }).reason === 'floorChange',
        'en Tibia las escaleras son teleports, no pasos');

    // EL CASO IMPORTANTE: cortar la esquina entre dos muros.
    //
    // Desde (30,31) a (31,30): el DESTINO está libre, pero los dos ortogonales del
    // vértice, (31,31) y (30,30), son muro. Sin esta regla se atraviesan las
    // paredes en diagonal, que es el fallo de movimiento más visible que existe.
    //
    // Nótese que moverse HACIA un muro es otro caso distinto (y se comprueba
    // arriba): ahí lo que falla es el destino, no la esquina.
    const corner = map.canWalk(free(30, 31), free(31, 30));
    check('no se puede cortar la esquina entre dos muros',
        corner.allowed === false && corner.reason === 'cornerCut',
        'destino (31,30) libre, pero (31,31) y (30,30) son muro');

    // Con un solo ortogonal libre, la diagonal si es valida.
    const openDiagonal = map.canWalk(free(11, 12), free(12, 11));
    check('la diagonal es valida si al menos un ortogonal esta libre',
        openDiagonal.allowed === true,
        'ortogonales (12,12) y (11,11), ambos libres');

    // Las dos direcciones diagonales se reconocen como tales.
    check('directionFrom distingue recto de diagonal',
        DIRECTIONS[directionFrom(free(0, 0), free(1, 1))].diagonal === true &&
        DIRECTIONS[directionFrom(free(0, 0), free(1, 0))].diagonal === false);

    // Una criatura en el destino bloquea, salvo que se ignore.
    const occupied = map.getOrCreateTile(45, 45, 7);
    occupied.addCreature({ name: 'otro' });

    check('una criatura en el destino impide el paso',
        map.canWalk(free(44, 45), free(45, 45)).reason === 'creature');

    check('se puede ignorar a las criaturas a proposito',
        map.canWalk(free(44, 45), free(45, 45), { ignoreCreatures: true }).allowed === true);

    // -----------------------------------------------------------------------
    section('5. Visibilidad entre plantas');
    // -----------------------------------------------------------------------

    check('la superficie ve toda la superficie',
        map.canSee(0, 7) === true && map.canSee(7, 0) === true);

    check('la superficie NO ve el subsuelo',
        map.canSee(7, 8) === false && map.canSee(0, 8) === false,
        'desde la calle no se ve lo que pasa en una mazmorra');

    check('el subsuelo ve dos plantas arriba y dos abajo',
        map.canSee(8, 10) === true && map.canSee(10, 8) === true);
    check('el subsuelo no ve tres plantas de diferencia',
        map.canSee(8, 11) === false && map.canSee(8, 5) === false);

    // -----------------------------------------------------------------------
    section('6. Validacion de mapas: todos los errores a la vez');
    // -----------------------------------------------------------------------

    const broken = {
        format: 'avillatoro-map',
        version: 1,
        name: 'roto',
        width: 32,
        height: 32,
        floors: 2,
        defaultGround: { '0': 102 },
        tiles: [
            { x: 1, y: 1, z: 0, items: [9999] },              // item inexistente
            { x: 99, y: 1, z: 0, items: [111] },              // fuera del mapa
            { x: 2, y: 2, z: 0, flags: ['zonaInventada'] },   // bandera desconocida
            { x: 3, y: 3, z: 0, items: [111] }
        ],
        waypoints: { malo: [999, 999, 0] },                   // waypoint fuera
        spawns: [
            { x: 4, y: 4, z: 0, monster: 'Dragon' },          // monstruo no definido
            { x: 5, y: 5, z: 0 }                              // spawn sin monstruo
        ]
    };

    const brokenResult = buildMap(broken, {
        itemTypes: itemTypes,
        monsterTypes: new Map([['Rat', {}]])
    });

    const messages = brokenResult.report.errors.map((e) => e.message).join('\n');

    check('la validacion NO se detiene en el primer error',
        brokenResult.report.errors.length >= 6,
        brokenResult.report.errors.length + ' errores encontrados de una sola pasada');

    check('detecta un item que no existe',
        /no existe ningun item con id 9999/.test(messages));

    check('detecta un tile fuera del mapa',
        /fuera del mapa/.test(messages));

    check('detecta una bandera desconocida',
        /bandera de tile desconocida/.test(messages));

    check('detecta un waypoint fuera del mapa',
        /waypoint "malo"/.test(messages));

    check('detecta un spawn de un monstruo no definido',
        /no esta definido en data\/monsters/.test(messages));

    check('detecta un spawn sin monstruo',
        /spawn #1 sin monstruo/.test(messages));

    check('cada error lleva su coordenada cuando la tiene',
        brokenResult.report.errors.some((e) => e.where === '(1,1,0)') &&
        brokenResult.report.errors.some((e) => e.where === '(99,1,0)'),
        'sin coordenada, un error en un mapa de mil tiles no es accionable');

    // El informe se puede imprimir tal cual.
    check('el informe es imprimible', brokenResult.report.format().length > 0);

    // Un mapa con cabecera invalida se rechaza sin intentar construir nada.
    const badHeader = buildMap({ format: 'otro', version: 99 }, { itemTypes: itemTypes });
    check('una cabecera invalida se rechaza de inmediato',
        badHeader.map === null && badHeader.report.errors.length === 2,
        'formato y version, los dos errores');

    // -----------------------------------------------------------------------
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el mundo carga, apila, camina y valida.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
