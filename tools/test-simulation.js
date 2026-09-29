'use strict';

/**
 * Prueba de la simulación: planificador, criaturas, movimiento y spawns.
 *
 * Se construye el mundo a mano, con un reloj inyectado, en vez de arrancar el
 * motor entero. La razón es el determinismo: el movimiento depende del tiempo, y
 * con `Date.now()` real una prueba de cooldowns sería una carrera contra el
 * reloj que falla una vez de cada veinte. Con un reloj que se avanza a mano, cada
 * comprobación mide exactamente lo que dice medir.
 *
 * Uso:  node tools/test-simulation.js
 */

const path = require('path');

const { World } = require('../engine/world/world');
const { Scheduler } = require('../engine/core/scheduler');
const { Spawner } = require('../engine/world/spawner');
const { loadMap } = require('../engine/world/loader');
const { DIRECTION } = require('../engine/world/creature');
const Xml = require('../engine/data/xml');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'data', 'world', 'sample.map.json');

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

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Reloj controlado a mano. */
const clock = { value: 1000000 };
const now = () => clock.value;
function advance(ms) {
    clock.value += ms;
}

function buildWorld(options) {
    const opts = options || {};

    const itemTypes = Xml.loadItems(path.join(ROOT, 'data', 'items', 'items.xml'));
    const monsterTypes = new Map([
        ['Rat', {
            name: 'Rat', health: 20, maxHealth: 20, speed: 74,
            experience: 5, loot: [{ id: 3031, chance: 40000 }]
        }]
    ]);

    const loaded = loadMap(MAP_FILE, { itemTypes: itemTypes, monsterTypes: monsterTypes });
    const scheduler = new Scheduler({ now: now, logger: null });

    const world = new World({
        scheduler: scheduler,
        now: now,
        tickIntervalMs: 50,
        logger: null
    });

    world.map = loaded.map;
    world.itemTypes = itemTypes;
    world.monsterTypes = monsterTypes;

    return {
        world: world,
        scheduler: scheduler,
        report: loaded.report,
        // Para las pruebas de spawn, un azar predecible que siempre cae en 0.
        spawner: new Spawner({
            world: world,
            scheduler: scheduler,
            logger: null,
            random: opts.random || (() => 0)
        })
    };
}

function main() {
    console.log('Prueba de la simulacion (' + ROOT + ')');

    // =======================================================================
    section('1. Planificador de eventos');
    // =======================================================================

    {
        const scheduler = new Scheduler({ now: now, logger: null });
        const order = [];

        clock.value = 1000;
        scheduler.schedule(300, () => order.push('c'), 'c');
        scheduler.schedule(100, () => order.push('a'), 'a');
        scheduler.schedule(200, () => order.push('b'), 'b');

        check('nada se ejecuta antes de tiempo',
            scheduler.tick(1000).executed === 0 && order.length === 0);

        advance(100);
        scheduler.tick(1000);
        check('se ejecuta lo que vence, en orden de tiempo',
            order.join('') === 'a', 'ejecutado: ' + order.join('') || 'nada');

        advance(200);
        scheduler.tick(1000);
        check('y sigue el orden con el resto',
            order.join('') === 'abc', order.join(''));
    }

    {
        // El desempate por secuencia: dos eventos al mismo milisegundo deben
        // ejecutarse en el orden en que se programaron. Sin ese desempate, dos
        // eventos simultaneos podrian invertirse y producir un fallo intermitente.
        const scheduler = new Scheduler({ now: now, logger: null });
        const order = [];

        clock.value = 5000;
        scheduler.schedule(50, () => order.push('primero'));
        scheduler.schedule(50, () => order.push('segundo'));
        scheduler.schedule(50, () => order.push('tercero'));

        advance(50);
        scheduler.tick(1000);

        check('a igual momento, se respeta el orden de programacion',
            order.join(',') === 'primero,segundo,tercero', order.join(','));
    }

    {
        const scheduler = new Scheduler({ now: now, logger: null });
        let ran = false;

        clock.value = 9000;
        const event = scheduler.schedule(10, () => { ran = true; });
        scheduler.cancel(event);

        advance(10);
        scheduler.tick(1000);
        check('un evento cancelado no se ejecuta', ran === false);
    }

    {
        // Un evento que revienta no debe arrastrar a los demas: si un sistema
        // falla, el resto del servidor tiene que seguir vivo.
        const scheduler = new Scheduler({ now: now, logger: null });
        const survivors = [];

        clock.value = 20000;
        scheduler.schedule(10, () => { throw new Error('fallo deliberado'); });
        scheduler.schedule(10, () => survivors.push('sigue vivo'));

        advance(10);
        const result = scheduler.tick(1000);

        check('un evento que lanza no impide los siguientes',
            survivors.length === 1 && result.executed === 2,
            survivors.join(',') + ' (' + result.executed + ' ejecutados)');
    }

    {
        // El presupuesto evita que una avalancha de eventos bloquee el bucle.
        const scheduler = new Scheduler({ now: now, logger: null });
        let count = 0;

        clock.value = 30000;
        for (let i = 0; i < 500; i += 1) {
            scheduler.schedule(1, () => { count += 1; });
        }

        advance(1);
        const result = scheduler.tick(0);   // presupuesto agotado de inmediato

        check('el presupuesto corta la ejecucion y deja el resto para luego',
            result.budgetExhausted === true && scheduler.size > 0,
            count + ' ejecutados, ' + scheduler.size + ' pendientes');
    }

    // =======================================================================
    section('2. Criaturas');
    // =======================================================================

    const { world, scheduler, spawner } = buildWorld();

    const player = world.createPlayer('Avillatoro', { x: 40, y: 40, z: 7 });

    check('el jugador queda registrado como criatura',
        world.getCreature(player.id) === player && world.getPlayer(player.id) === player);

    check('el jugador ocupa su tile',
        world.hasCreatureAt(40, 40, 7) === true &&
        world.getCreaturesAt(40, 40, 7).length === 1);

    const rat = world.createMonster('Rat', { x: 45, y: 45, z: 7 }, null);
    check('se crea un monstruo a partir de su tipo',
        rat && rat.isMonster() && rat.health === 20 && rat.experience === 5,
        rat ? rat.name + ' ' + rat.health + ' hp' : 'no creado');

    check('el monstruo tambien es una criatura',
        world.getCreature(rat.id) === rat && world.getMonster(rat.id) === rat);

    check('un tipo de monstruo inexistente no crea nada',
        world.createMonster('Dragon', { x: 46, y: 46, z: 7 }) === null);

    check('cada criatura ocupa un tile distinto',
        world.hasCreatureAt(45, 45, 7) === true &&
        world.hasCreatureAt(40, 40, 7) === true);

    // =======================================================================
    section('3. Movimiento y coste de paso');
    // =======================================================================

    // La hierba tiene groundSpeed 150 y el jugador speed 220 -> 550 ms por paso.
    const first = world.moveCreature(player, { x: 0, y: -1 });

    check('un paso recto sobre hierba se aplica',
        first.moved === true && player.position.x === 40 && player.position.y === 39,
        first.moved ? 'de (40,40) a ' + player.position : first.reason);

    check('el coste del paso es el de la formula de Tibia',
        player.nextStepAt - clock.value === 550,
        (player.nextStepAt - clock.value) + ' ms (speed 220, groundSpeed 150)');

    check('los tiles se actualizan al mover',
        world.hasCreatureAt(40, 40, 7) === false &&
        world.hasCreatureAt(40, 39, 7) === true,
        'el tile de origen queda libre y el de destino ocupado');

    check('la criatura mira hacia donde se mueve',
        player.direction === DIRECTION.NORTH,
        'direccion ' + player.direction + ' (norte = ' + DIRECTION.NORTH + ')');

    // Todavia no le toca: es el ritmo normal, NO un rechazo.
    const tooEarly = world.moveCreature(player, { x: 0, y: -1 });
    check('no se puede encadenar un paso antes del coste',
        tooEarly.moved === false && tooEarly.reason === 'exhausted' &&
        tooEarly.waitMs > 0,
        'faltan ' + tooEarly.waitMs + ' ms');

    advance(550);
    const second = world.moveCreature(player, { x: 0, y: -1 });
    check('pasado el tiempo, se vuelve a poder caminar',
        second.moved === true && player.position.y === 38);

    // --- Diagonal ---
    advance(1000);
    player._applyPosition({ x: 40, y: 40, z: 7 });
    player.nextStepAt = 0;

    const diagonal = world.moveCreature(player, { x: 1, y: -1 });
    check('la diagonal se acepta y cuesta mas que el paso recto',
        diagonal.moved === true && diagonal.diagonal === true &&
        player.nextStepAt - clock.value === 1650,
        (player.nextStepAt - clock.value) + ' ms frente a 550 del paso recto');

    // --- Suelo lento ---
    advance(2000);
    const swimmer = world.createPlayer('Nadador', { x: 20, y: 19, z: 7 });
    const intoWater = world.moveCreature(swimmer, { x: 0, y: 1 });

    check('caminar hacia un suelo lento cuesta lo que dice el suelo',
        intoWater.moved === true &&
        swimmer.nextStepAt - clock.value === 1100,
        (swimmer.nextStepAt - clock.value) + ' ms (charco con groundSpeed 300)');

    // --- Muros ---
    advance(5000);
    const againstWall = world.createPlayer('Muro', { x: 12, y: 11, z: 7 });
    const blocked = world.moveCreature(againstWall, { x: 0, y: -1 });

    check('no se camina hacia un muro',
        blocked.moved === false && blocked.reason === 'blocked' &&
        againstWall.position.y === 11,
        '(12,10) es muro; la criatura no se mueve');

    check('pero la criatura mira hacia donde intentaba ir',
        againstWall.direction === DIRECTION.NORTH,
        'direccion ' + againstWall.direction);

    // --- Esquina ---
    const cornerWalker = world.createPlayer('Esquina', { x: 30, y: 31, z: 7 });
    const corner = world.moveCreature(cornerWalker, { x: 1, y: -1 });

    check('no se corta la esquina entre dos muros',
        corner.moved === false && corner.reason === 'cornerCut',
        'destino (31,30) libre, pero (31,31) y (30,30) son muro');

    // --- Limites ---
    advance(5000);
    const edge = world.createPlayer('Borde', { x: 0, y: 0, z: 7 });
    const outside = world.moveCreature(edge, { x: -1, y: 0 });
    check('no se sale del mapa',
        outside.moved === false && outside.reason === 'outOfBounds');

    // --- Desplazamientos invalidos ---
    check('un desplazamiento nulo se rechaza',
        world.moveCreature(edge, { x: 0, y: 0 }).reason === 'badDirection');

    check('un desplazamiento de mas de un tile se normaliza a un paso',
        world._normalizeOffset({ x: 7, y: 0 }).x === 1,
        'un paso es un paso; la distancia la valida el mapa');

    // --- Direcciones cardinales ---
    advance(5000);
    const cardinal = world.createPlayer('Cardinal', { x: 40, y: 40, z: 7 });
    const east = world.moveCreature(cardinal, DIRECTION.EAST);
    check('tambien se acepta una direccion cardinal',
        east.moved === true && cardinal.position.x === 41 &&
        cardinal.direction === DIRECTION.EAST,
        'de (40,40) a ' + cardinal.position);

    // =======================================================================
    section('4. Enganches del mundo con el contenido');
    // =======================================================================

    {
        const harness = buildWorld();
        const stepped = [];
        const left = [];

        harness.world.on('onStepIn', (creature, tile, fromPosition) => {
            stepped.push({
                creature: creature.name,
                tile: tile.x + ',' + tile.y + ',' + tile.z,
                from: fromPosition.toString()
            });
        });
        harness.world.on('onStepOut', (creature, tile) => {
            left.push(creature.name + ' deja ' + tile.x + ',' + tile.y);
        });

        const walker = harness.world.createPlayer('Caminante', { x: 40, y: 40, z: 7 });
        harness.world.moveCreature(walker, { x: 0, y: -1 });

        check('el enganche de entrada avisa con la criatura y el tile',
            stepped.length === 1 && stepped[0].creature === 'Caminante' &&
            stepped[0].tile === '40,39,7' && stepped[0].from === '(40, 40, 7)',
            JSON.stringify(stepped[0]));

        check('el enganche de salida avisa del tile que se deja',
            left.length === 1 && left[0] === 'Caminante deja 40,40',
            JSON.stringify(left[0]));

        check('un paso bloqueado no dispara ningun enganche',
            (harness.world.moveCreature(walker, { x: 0, y: -1 }).moved === false) &&
            stepped.length === 1);
    }

    // =======================================================================
    section('5. Teletransporte');
    // =======================================================================

    {
        const harness = buildWorld();
        const walker = harness.world.createPlayer('Viajero', { x: 40, y: 40, z: 7 });

        const up = harness.world.teleportCreature(walker, { x: 40, y: 40, z: 8 });

        check('el teletransporte cambia de planta',
            up.moved === true && walker.position.z === 8,
            'de (40,40,7) a ' + walker.position);

        check('y actualiza los tiles de las dos plantas',
            harness.world.hasCreatureAt(40, 40, 7) === false &&
            harness.world.hasCreatureAt(40, 40, 8) === true);

        check('el teletransporte no comprueba el camino',
            harness.world.teleportCreature(walker, { x: 100, y: 100, z: 7 }).reason
            === 'outOfBounds',
            'pero si comprueba los limites del mapa');

        check('y no deja exhausto, aunque reinicia el reloj del paso',
            walker.nextStepAt === clock.value);
    }

    // =======================================================================
    section('6. Spawns y reaparicion');
    // =======================================================================

    {
        const harness = buildWorld();
        const loaded = harness.spawner.loadFromMap(harness.world.map);

        check('el mapa declara un punto de aparicion',
            loaded.spawns === 1 && loaded.monsters === 1,
            loaded.spawns + ' punto, ' + loaded.monsters + ' monstruo');

        check('y el monstruo esta vivo en el mundo',
            harness.world.monsters.size === 1);

        const snapshot = harness.spawner.snapshot();
        check('el punto de aparicion sabe que tiene un monstruo',
            snapshot[0].alive === true && snapshot[0].monsterId !== null,
            JSON.stringify(snapshot[0]));

        check('no se duplica el monstruo mientras vive',
            harness.spawner.spawn(harness.spawner.spawns[0]) === null &&
            harness.world.monsters.size === 1);

        // El monstruo debe estar en una celda transitable, no dentro de un muro.
        const monster = Array.from(harness.world.monsters.values())[0];
        check('el monstruo aparece en una celda transitable',
            harness.world.map.isWalkable(monster.position.x, monster.position.y, monster.position.z),
            'en ' + monster.position);

        // --- Muerte y reaparicion ---
        const interval = harness.spawner.spawns[0].interval;
        harness.world.killMonster(monster.id);

        check('al morir se libera el punto de aparicion',
            harness.spawner.snapshot()[0].alive === false &&
            harness.world.monsters.size === 0);

        check('y se programa la reaparicion, no se hace al instante',
            harness.world.monsters.size === 0 && harness.scheduler.size > 0,
            'programada a ' + interval + ' ms');

        advance(interval - 1);
        harness.scheduler.tick(1000);
        check('todavia no ha reaparecido un milisegundo antes',
            harness.world.monsters.size === 0);

        advance(1);
        harness.scheduler.tick(1000);
        check('pasado el intervalo, reaparece',
            harness.world.monsters.size === 1 &&
            harness.spawner.snapshot()[0].alive === true,
            'monstruos vivos: ' + harness.world.monsters.size);

        check('el tiempo de reaparicion se cuenta desde la MUERTE',
            harness.spawner.spawns[0].interval === interval,
            'mismo intervalo: ' + interval + ' ms');
    }

    {
        // Un spawn sin sitio debe reintentar, no quedarse vacio para siempre.
        const harness = buildWorld();

        // Sin mapa transitable alrededor: se rodea el punto de aparicion de muros.
        const entry = { x: 12, y: 12, z: 7, monster: 'Rat', interval: 1000, radius: 0 };
        harness.world.map.getOrCreateTile(12, 12, 7).addItem(
            new (require('../engine/world/item').Item)(harness.world.itemTypes.get(111)));

        check('sin sitio, el spawn no crea nada',
            harness.spawner.spawn(entry) === null &&
            harness.world.monsters.size === 0,
            'tambien se comprueba que NO se creo ningun monstruo: si el spawn ' +
            'retornara por otro motivo, la prueba pasaria sin medir lo que dice');

        check('pero se reintenta mas tarde en vez de rendirse',
            harness.scheduler.size > 0 && harness.spawner.stats.failed === 1,
            harness.spawner.stats.failed + ' intento fallido, ' +
            harness.scheduler.size + ' reintento programado');

        // Y si se libera el sitio, el reintento debe funcionar.
        harness.world.map.getTile(12, 12, 7).downItems.length = 0;
        advance(5000);
        harness.scheduler.tick(1000);

        check('liberado el sitio, el reintento hace aparecer el monstruo',
            harness.world.monsters.size === 1,
            'monstruos vivos: ' + harness.world.monsters.size);
    }

    // =======================================================================
    section('7. Recoger y soltar');
    // =======================================================================

    {
        const harness = buildWorld();
        const world = harness.world;

        // El mapa de ejemplo tiene 50 monedas en (11,12).
        const tile = world.map.getTile(11, 12, 7);
        check('el mapa tiene monedas que recoger',
            tile && tile.downItems.length === 1 &&
            tile.downItems[0].typeId === 3031 && tile.downItems[0].count === 50,
            tile && tile.downItems.length
                ? tile.downItems[0].count + ' monedas'
                : 'no hay nada');

        const player = world.createPlayer('Recogedor', { x: 11, y: 12, z: 7 });

        const picked = world.pickUpItem(player, 11, 12, 7);

        check('se recogen las monedas de la casilla',
            picked.ok === true && picked.item.typeId === 3031 && picked.item.count === 50,
            picked.ok ? picked.item.count + ' monedas' : picked.reason);

        check('y aparecen en el inventario',
            world.inventoryOf(player).length === 1 &&
            world.inventoryOf(player)[0].count === 50 &&
            world.inventoryOf(player)[0].name === 'gold coin',
            JSON.stringify(world.inventoryOf(player)));

        check('el tile queda vacio',
            world.map.getTile(11, 12, 7).downItems.length === 0,
            'los objetos de la pila son lo que se dibuja y lo que bloquea el paso');

        check('y recoger otra vez dice que no hay nada',
            world.pickUpItem(player, 11, 12, 7).reason === 'emptyTile',
            'el suelo tambien es un objeto de la pila, pero no es algo que se recoja');

        // --- Lo que NO se puede ---
        check('no se recoge de lejos',
            world.pickUpItem(player, 40, 40, 7).reason === 'tooFar',
            'y lo dice ANTES que "aqui no hay nada", que es cierto y no explica nada');

        check('no se recoge de otra planta',
            world.pickUpItem(player, 11, 12, 8).reason === 'tooFar');

        // El muro de (10,10): desde (11,11), que esta al lado.
        world.teleportCreature(player, { x: 11, y: 11, z: 7 });
        check('no se recoge un muro',
            world.pickUpItem(player, 10, 11, 7).reason === 'notPickupable',
            'hay cosas que estan en la pila y no se pueden coger');

        // --- Soltar ---
        const dropped = world.dropItem(player, 0);

        check('se suelta lo que se lleva',
            dropped.ok === true && world.inventoryOf(player).length === 0,
            dropped.ok ? 'se solto ' + dropped.item.count + ' monedas' : dropped.reason);

        // Se busca la moneda y no se cuenta lo que hay: (11,11) ya tenía la palanca del
        // mapa de ejemplo, así que contar daría dos y parecería un fallo de soltar.
        const droppedTile = world.map.getTile(11, 11, 7);
        const onGround = droppedTile
            ? droppedTile.downItems.concat(droppedTile.topItems)
                .find((item) => item.typeId === 3031)
            : null;

        check('y aparece en el suelo, en la casilla del jugador',
            onGround !== undefined && onGround !== null && onGround.count === 50,
            onGround
                ? onGround.count + ' monedas en ' + JSON.stringify(player.position)
                : 'no aparece en el suelo');

        check('soltar una ranura que no existe se rechaza',
            world.dropItem(player, 5).reason === 'badSlot');

        // --- Apilar ---
        // Lo que hace que cien monedas recogidas de una en una sean UNA entrada y no
        // cien. Sin esto el inventario crece sin limite al matar monstruos.
        world.teleportCreature(player, { x: 11, y: 12, z: 7 });
        world.createItem(3031, 10, { x: 11, y: 12, z: 7 });
        world.pickUpItem(player, 11, 12, 7);
        world.createItem(3031, 5, { x: 11, y: 12, z: 7 });
        const second = world.pickUpItem(player, 11, 12, 7);

        check('las monedas se apilan en una sola entrada',
            second.ok === true && second.stacked === true &&
            world.inventoryOf(player).length === 1 &&
            world.inventoryOf(player)[0].count === 15,
            world.inventoryOf(player)[0].count + ' monedas en una entrada');

        check('y las posiciones del inventario siguen siendo correlativas',
            world.inventoryOf(player).every((entry, index) => entry.index === index),
            'si no, el "soltar el 3" del jugador apuntaria a otro sitio del que ve');
    }

    // =======================================================================
    section('8. Limpieza de tiles materializados');
    // =======================================================================

    {
        const harness = buildWorld();
        const before = harness.world.map.stats().explicitTiles;

        // Un jugador paseando materializa cada tile que pisa.
        const walker = harness.world.createPlayer('Paseante', { x: 50, y: 50, z: 7 });
        for (let i = 0; i < 10; i += 1) {
            advance(1000);
            harness.world.moveCreature(walker, { x: 1, y: 0 });
        }

        const afterWalk = harness.world.map.stats().explicitTiles;
        check('caminar materializa tiles',
            afterWalk > before,
            before + ' -> ' + afterWalk + ' tiles explicitos');

        // Primera limpieza, CON la criatura viva: su tile no se puede descartar
        // porque lo ocupa, pero los que dejo atras ya no tienen nada.
        harness.world.map.compact();

        const own = walker.position;
        check('el tile que ocupa una criatura NO se descarta',
            harness.world.map.getTile(own.x, own.y, own.z) !== null &&
            harness.world.map.getTile(own.x, own.y, own.z).creatures.length === 1,
            'la criatura esta en ' + own);

        check('pero los tiles que dejo atras si vuelven al estado disperso',
            harness.world.map.getTile(50, 50, 7) === null,
            'el punto de partida ya no es un tile explicito');

        // Segunda limpieza, ya sin la criatura: ahora su tile tambien sobra.
        const beforeLeave = harness.world.map.stats().explicitTiles;
        harness.world.removePlayer(walker.id);
        const removed = harness.world.map.compact();

        check('al irse la criatura, su tile tambien vuelve al estado disperso',
            removed >= 1 &&
            harness.world.map.getTile(own.x, own.y, own.z) === null,
            removed + ' tile(s) descartados, quedaban ' + beforeLeave + ' explicitos');

        check('y lo que tiene contenido propio se conserva',
            harness.world.map.getTile(10, 10, 7) !== null &&
            harness.world.map.getTile(12, 12, 7) !== null,
            'el muro y la zona de proteccion siguen ahi');
    }

    // =======================================================================
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el mundo simula: planifica, mueve, aparece y se limpia.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
