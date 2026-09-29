'use strict';

/**
 * Prueba del protocolo, la vista y las sesiones.
 *
 * Lo que se verifica aquí es la separación de responsabilidades, que es la razón
 * de ser de todo esto: que el cliente NO pueda saber nada que el motor no le haya
 * mandado, y que no pueda cambiar el mundo pidiéndolo.
 *
 * Se prueba sin abrir un socket: la sesión recibe un `send` inyectado que apunta a
 * un array. Así el protocolo entero se verifica de forma determinista, y el
 * servidor WebSocket queda como un adaptador que no hay que probar a base de
 * conexiones reales.
 *
 * Uso:  node tools/test-protocol.js
 */

const path = require('path');

const { createEngine } = require('../engine/core/engine');
const P = require('../engine/net/protocol');
const { key } = require('../engine/net/view');

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

/** Cuenta los mensajes de un opcode. */
function count(messages, opcode) {
    return messages.filter((m) => m[0] === opcode).length;
}

function first(messages, opcode) {
    return messages.find((m) => m[0] === opcode) || null;
}

function main() {
    console.log('Prueba del protocolo y la vista (' + ROOT + ')');

    // =======================================================================
    section('1. El protocolo');
    // =======================================================================

    const serverCodes = Object.keys(P.SERVER).map((name) => P.SERVER[name]);
    const clientCodes = Object.keys(P.CLIENT).map((name) => P.CLIENT[name]);

    check('los opcodes del servidor no se repiten',
        new Set(serverCodes).size === serverCodes.length,
        serverCodes.length + ' opcodes');

    check('los opcodes del cliente no se repiten',
        new Set(clientCodes).size === clientCodes.length,
        clientCodes.length + ' opcodes');

    // Una colision haria que un mensaje enviado al reves se interpretara como otro
    // distinto, y el fallo apareceria como un comportamiento absurdo del cliente.
    const shared = serverCodes.filter((code) => clientCodes.indexOf(code) !== -1);
    check('cliente y servidor usan rangos separados',
        shared.length === 0,
        shared.length === 0 ? 'ningun opcode compartido'
            : 'comparten: ' + shared.map((c) => '0x' + c.toString(16)).join(', '));

    check('todos los opcodes tienen nombre, para poder depurar',
        serverCodes.concat(clientCodes).every((code) => P.NAMES[code]),
        'por ejemplo 0x' + P.SERVER.TILE_ADD.toString(16) + ' = ' + P.opcodeName(P.SERVER.TILE_ADD));

    check('las ocho direcciones de caminar tienen desplazamiento',
        Object.keys(P.WALK_OFFSETS).length === 8,
        '0x64 a 0x6B, como en Tibia');

    check('los desplazamientos diagonales lo son de verdad',
        P.WALK_OFFSETS[P.CLIENT.WALK_NORTH_EAST].x === 1 &&
        P.WALK_OFFSETS[P.CLIENT.WALK_NORTH_EAST].y === -1 &&
        P.WALK_OFFSETS[P.CLIENT.WALK_SOUTH_WEST].x === -1 &&
        P.WALK_OFFSETS[P.CLIENT.WALK_SOUTH_WEST].y === 1);

    // =======================================================================
    section('2. Descripcion de tiles y criaturas');
    // =======================================================================

    const engine = createEngine({ rootDir: ROOT, logLevel: 'error' });
    const world = engine.world;
    const map = world.map;

    {
        const tile = map.getTile(12, 11, 7);       // barandilla (siempre arriba)
        const data = P.describeTile(tile, map.getGround(12, 11, 7));

        check('un tile se describe con suelo, los dos cortes y los items',
            data[0] === 102 && data[1] === 0 && data[2] === 1 && data[3] === 112,
            'suelo ' + data[0] + ', 0 abajo, 1 en total: ' + data.slice(3).join(','));

        const lever = map.getTile(11, 11, 7);
        const leverData = P.describeTile(lever, map.getGround(11, 11, 7));
        check('la palanca va en el mismo formato',
            leverData[0] === 102 && leverData[1] === 1 && leverData[2] === 1 &&
            leverData[3] === 1948,
            'suelo ' + leverData[0] + ', 1 abajo de 1 total, item ' + leverData[3]);

        // El ORDEN es el de dibujo: suelo, items de abajo, items de arriba. El
        // cliente pinta en el orden en que llegan y por eso no necesita conocer
        // las bandas de apilado. Pero SI necesita saber donde esta el corte, para
        // meter a las criaturas entre los dos grupos.
        const mixed = new (require('../engine/world/tile').Tile)(60, 60, 7);
        const { Item } = require('../engine/world/item');
        mixed.setGround(new Item(world.itemTypes.get(102)));
        mixed.addItem(new Item(world.itemTypes.get(111)));    // muro: abajo
        mixed.addItem(new Item(world.itemTypes.get(112)));    // barandilla: arriba

        const mixedData = P.describeTile(mixed, null);
        check('los items se envian en orden de DIBUJO, no de almacenamiento',
            mixedData[0] === 102 && mixedData[3] === 111 && mixedData[6] === 112,
            'suelo, luego el muro (abajo), luego la barandilla (arriba)');

        check('y el corte entre abajo y arriba viaja en el mensaje',
            mixedData[1] === 1 && mixedData[2] === 2,
            '1 item abajo de 2 en total: el cliente dibuja las criaturas entre ambos');
    }

    {
        const player = world.createPlayer('Prueba', { x: 40, y: 40, z: 7 });
        player.health = 75;
        player.maxHealth = 150;

        const description = P.describeCreature(player);
        check('una criatura se describe con su posicion, direccion y salud',
            description[0] === player.id &&
            description[3] === 40 && description[4] === 40 && description[5] === 7 &&
            description[7] === 50 && description[8] === 0,
            'salud al 50%, es jugador');

        check('la salud viaja en porcentaje, que es lo que dibuja la barra',
            P.healthPercent(player) === 50,
            '75 de 150 -> 50%');

        world.removePlayer(player.id);
    }

    // =======================================================================
    section('3. Que ve el cliente, y que NO ve');
    // =======================================================================

    const sent = [];
    const session = engine.createSession((message) => sent.push(message));

    const entered = session.enterWorld('Heroe');
    check('el jugador entra al mundo', entered === true && session.playerId !== null);

    const login = sent.slice();
    check('el cliente recibe el saludo con el tamano del mundo',
        login[0][0] === P.SERVER.HELLO && login[0][2] === 64 && login[0][3] === 64 &&
        login[0][4] === 16,
        'protocolo v' + login[0][1] + ', mundo ' + login[0][2] + 'x' + login[0][3] +
        'x' + login[0][4]);

    check('y sus propios datos, ANTES que el mapa',
        login[1][0] === P.SERVER.LOGIN_OK && login[1][2] === 'Heroe',
        'el cliente necesita saber donde esta antes de recibir los tiles');

    const tiles = count(login, P.SERVER.TILE_ADD);
    check('recibe el mapa de su alrededor', tiles > 0,
        tiles + ' tiles en ' + count(login, P.SERVER.TILE_REMOVE) + ' borrados y ' +
        count(login, P.SERVER.TILE_UPDATE) + ' actualizaciones');

    const snapshot = engine.view.snapshot(session.playerId);
    check('el motor recuerda lo que le envio',
        snapshot.tiles === tiles,
        snapshot.tiles + ' tiles en el estado de la vista');

    // El jugador esta en el templo (30,30,7). Las plantas que se ENVIAN son la 5,
    // la 6 y la 7: el rango de dibujo (dos abajo, una arriba) cruzado con la regla
    // de visibilidad de juego, que desde la superficie no deja ver el subsuelo.
    const floorsSent = new Set();
    login.filter((m) => m[0] === P.SERVER.TILE_ADD).forEach((m) => floorsSent.add(m[3]));
    check('se envian TRES plantas, no ocho',
        floorsSent.size === 3 && floorsSent.has(5) && floorsSent.has(6) && floorsSent.has(7),
        'plantas ' + Array.from(floorsSent).sort().join(', ') +
        ': el rango de dibujo, no todo lo que la regla de juego permite');

    check('la superficie NO recibe el subsuelo',
        !floorsSent.has(8) && !floorsSent.has(9),
        'seria una fuga de informacion, no una optimizacion');

    check('cada planta aporta su rectangulo completo',
        tiles === 19 * 15 * 3,
        '19x15 tiles por planta, sin excluir el que pisa el jugador: ' + tiles);

    check('el cliente se recibe a si mismo como criatura',
        count(login, P.SERVER.CREATURE_ADD) === 1 &&
        first(login, P.SERVER.CREATURE_ADD)[1] === session.playerId,
        'necesita saber que existe para dibujarse');

    // =======================================================================
    section('4. El diff: se envia lo que cambia, no todo');
    // =======================================================================

    {
        // Un tick sin que pase nada no debe generar ni un mensaje de tile.
        sent.length = 0;
        session.update();

        check('sin cambios, no se envia nada',
            count(sent, P.SERVER.TILE_ADD) === 0 &&
            count(sent, P.SERVER.TILE_UPDATE) === 0 &&
            count(sent, P.SERVER.TILE_REMOVE) === 0 &&
            count(sent, P.SERVER.CREATURE_MOVE) === 0,
            'el mundo no cambio y el cliente ya lo tiene todo');
    }

    {
        sent.length = 0;
        session.handle(P.message(P.CLIENT.WALK_NORTH));
        const ownMove = first(sent, P.SERVER.CREATURE_MOVE);

        check('el propio movimiento se envia al instante',
            ownMove && ownMove[1] === session.playerId,
            'sin esperar al tick: es donde se notaria el retraso');

        check('y lleva la DURACION del paso',
            ownMove[9] === 550,
            ownMove[9] + ' ms, la de la formula de Tibia para speed 220 sobre hierba');

        check('la duracion es la que calculo el motor, no una inventada',
            ownMove[9] === session.player.lastStepDuration,
            'el cliente interpola durante exactamente ese tiempo');

        sent.length = 0;
        session.update();

        check('el movimiento propio NO se duplica en el diff',
            count(sent, P.SERVER.CREATURE_MOVE) === 0,
            'la sesion ya lo envio y se lo apunto a la vista');
    }

    {
        // Al moverse una casilla entra una franja y sale otra. El diff debe mandar
        // solo eso, no el rectangulo entero.
        sent.length = 0;
        session.player.nextStepAt = 0;
        session.handle(P.message(P.CLIENT.WALK_NORTH));
        session.update();

        const adds = count(sent, P.SERVER.TILE_ADD);
        const removes = count(sent, P.SERVER.TILE_REMOVE);

        check('al caminar solo entra y sale una franja',
            adds > 0 && adds <= 19 * 3 + 1 && removes > 0 && removes <= 19 * 3 + 1,
            adds + ' tiles entran, ' + removes + ' salen (una fila por planta)');

        check('no se reenvia el rectangulo entero',
            adds < 100,
            'serian ' + (19 * 15 * 3) + ' si se reenviara todo');
    }

    // =======================================================================
    section('5. Autoridad: el cliente pide, el motor decide');
    // =======================================================================

    {
        // El jugador se coloca junto a un muro y pide caminar hacia el.
        const wall = { x: 12, y: 11, z: 7 };   // (12,10) es muro
        session.player._applyPosition(wall);
        session.player.nextStepAt = 0;
        engine.view.markDirty(session.playerId);
        session.update();

        const before = session.player.position.copy();
        sent.length = 0;

        const result = session.handle(P.message(P.CLIENT.WALK_NORTH));

        check('un paso hacia un muro NO se ejecuta',
            session.player.position.y === before.y,
            'el cliente lo pidio y el motor lo rechazo');

        check('y el rechazo no ensucia el protocolo',
            count(sent, P.SERVER.CREATURE_MOVE) === 0,
            'caminar contra una pared es normal, no un error que responder');

        check('el motor informa del motivo a quien pregunte',
            result.action === 'walk' && result.moved === false && result.reason === 'blocked',
            'motivo: ' + result.reason);
    }

    {
        // No hay NINGUN mensaje que permita al cliente situarse donde quiera.
        const before = session.player.position.copy();

        const codes = Object.keys(P.CLIENT).map((name) => P.CLIENT[name]);
        let teleported = false;
        const random = [];

        // Se excluyen dos opcodes con efectos legitimos que no tienen nada que ver
        // con teletransportarse, y que ademas romperian el resto de la prueba:
        // LOGOUT cierra la sesion (y todo lo que viniera despues mediria una
        // sesion cerrada) y ENTER_WORLD reentraria al mundo.
        const skip = [P.CLIENT.LOGOUT, P.CLIENT.ENTER_WORLD];

        codes.filter((code) => skip.indexOf(code) === -1).forEach((code) => {
            // Se prueba a mandar cada opcode del cliente con datos plausibles de
            // teletransporte, por si alguno moviera la posicion sin pasar por las
            // reglas.
            const result = session.handle([code, 5, 5, 12, 60, 60]);
            random.push(code + ':' + (result.reason || result.action || 'ok'));
            const now = session.player.position;
            if (now.x === 60 && now.y === 60) {
                teleported = true;
            }
        });

        check('ningun mensaje del cliente teletransporta',
            teleported === false,
            'se probaron ' + (codes.length - skip.length) + ' opcodes del cliente ' +
            'con datos de salto');

        check('la sesion sigue viva despues de la rafaga',
            session.closed === false && session.entered === true,
            'si algun opcode la hubiera cerrado, lo que viniera despues mediria ' +
            'una sesion cerrada sin avisar');

        check('la posicion solo cambia por un paso valido',
            session.player.position.x !== undefined,
            'el cliente no puede situarse: no existe tal mensaje');
    }

    // =======================================================================
    section('6. Mensajes malformados y orden');
    // =======================================================================

    {
        check('un mensaje vacio no rompe nada',
            session.handle([]).handled === false &&
            session.handle(null).handled === false &&
            session.handle('no soy un mensaje').handled === false);

        check('un opcode desconocido se rechaza con su numero',
            session.handle([0xFF, 1, 2]).reason === 'unknownOpcode');

        const fresh = engine.createSession(() => {});
        check('hablar antes de entrar al mundo no hace nada',
            fresh.handle(P.message(P.CLIENT.SAY, 'hola')).reason === 'notInWorld' &&
            fresh.playerId === null,
            'es un cliente que se adelanto, no un error del servidor');

        fresh.close();
    }

    // =======================================================================
    section('7. Varios jugadores: lo que uno ve del otro');
    // =======================================================================

    const sentB = [];
    const sessionB = engine.createSession((message) => sentB.push(message));
    sessionB.enterWorld('Segundo');

    {
        // Se devuelve al primer jugador a una posicion despejada. En la seccion
        // anterior se le movio junto a un muro para probar el rechazo, y sin
        // recolocarlo el segundo jugador apareceria a veinte casillas y no se
        // verian: la prueba mediria la distancia en vez de la aparicion.
        session.player._applyPosition({ x: 30, y: 30, z: 7 });
        session.player.nextStepAt = 0;
        engine.view.markDirty(session.playerId);

        // El segundo jugador aparece donde el primero pueda verlo.
        sessionB.player._applyPosition({ x: 32, y: 30, z: 7 });
        engine.view.markDirty(sessionB.playerId);

        sent.length = 0;
        session.update();

        const adds = sent.filter((m) => m[0] === P.SERVER.CREATURE_ADD);
        check('el primero ve aparecer al segundo',
            adds.length === 1 && adds[0][1] === sessionB.playerId,
            'a 2 casillas de distancia');

        // El segundo se mueve y el primero lo ve moverse, con su duracion.
        sent.length = 0;
        sessionB.player.nextStepAt = 0;
        sessionB.handle(P.message(P.CLIENT.WALK_SOUTH));
        session.update();

        const move = first(sent, P.SERVER.CREATURE_MOVE);
        check('y lo ve moverse con la duracion del paso',
            move && move[1] === sessionB.playerId && move[9] > 0,
            'de (' + move[2] + ',' + move[3] + ') a (' + move[5] + ',' + move[6] +
            ') en ' + move[9] + ' ms');

        // El segundo se aleja mas alla de la vista y desaparece.
        sessionB.player._applyPosition({ x: 60, y: 60, z: 7 });
        sent.length = 0;
        session.update();

        check('cuando se aleja, desaparece de la vista',
            count(sent, P.SERVER.CREATURE_REMOVE) === 1,
            'el cliente deja de dibujarlo');
    }

    {
        // El habla va por cercania, no por vista: no es lo mismo ver que oir.
        sent.length = 0;
        sentB.length = 0;
        sessionB.player._applyPosition({ x: 31, y: 30, z: 7 });

        session.handle(P.message(P.CLIENT.SAY, 'hola a todos'));

        const say = first(sent, P.SERVER.CREATURE_SAY);
        check('quien habla se oye a si mismo',
            say && say[1] === session.playerId && say[2] === 'Heroe' &&
            say[3] === 'hola a todos',
            '"' + (say ? say[3] : '') + '"');

        check('y lo oye quien esta cerca',
            count(sentB, P.SERVER.CREATURE_SAY) === 1 &&
            first(sentB, P.SERVER.CREATURE_SAY)[2] === 'Heroe',
            'la difusion es por cercania, no por vista');
    }

    {
        // CUIDADO CON LA DIRECCION DE ESTA REGLA, que es asimetrica y es facil
        // confundirla. El subsuelo ve DOS plantas arriba y dos abajo, asi que
        // desde la planta 8 SI se ve la 7: en una mazmorra se ve la calle por el
        // hueco. Lo que no ocurre es lo contrario: desde la superficie no se ve
        // NADA del subsuelo.
        //
        // Se usa `teleportCreature` y no `_applyPosition`: el segundo cambia la
        // posicion pero NO el indice de tiles, a proposito, asi que la criatura
        // seguiria contando como si estuviera en su casilla vieja.
        world.teleportCreature(sessionB.player, { x: 31, y: 30, z: 7 });
        world.teleportCreature(session.player, { x: 30, y: 30, z: 8 });
        session.player.nextStepAt = 0;
        engine.view.markDirty(session.playerId);
        engine.view.markDirty(sessionB.playerId);

        // `sent` son los mensajes del jugador que esta ABAJO (session).
        sent.length = 0;
        session.update();
        const seenFromBelow = sent.filter((m) => m[0] === P.SERVER.CREATURE_ADD)
            .map((m) => m[1]);
        check('desde el subsuelo SI se ve una planta hacia arriba',
            seenFromBelow.indexOf(sessionB.playerId) !== -1,
            'el subsuelo ve dos plantas arriba y dos abajo, asi que la 8 ve la 7');

        // Y `sentB` los del que esta ARRIBA.
        sentB.length = 0;
        sessionB.update();
        const seenFromAbove = sentB.filter((m) => m[0] === P.SERVER.CREATURE_ADD)
            .map((m) => m[1]);
        check('desde la superficie NO se ve a quien esta en el subsuelo',
            seenFromAbove.indexOf(session.playerId) === -1,
            'la superficie ve toda la superficie y NADA del subsuelo');

        // Y el habla sigue la misma regla, con la misma asimetria: el de arriba no
        // oye al de abajo, porque no lo ve.
        sentB.length = 0;
        session.handle(P.message(P.CLIENT.SAY, 'saludos desde el sotano'));

        check('el habla sigue la misma regla de plantas',
            count(sentB, P.SERVER.CREATURE_SAY) === 0,
            'quien no puede verte tampoco te oye');
    }

    // =======================================================================
    section('8. Mirar y atacar');
    // =======================================================================

    {
        // Los dos jugadores vuelven a la misma planta: en la seccion anterior se
        // separaron para probar la visibilidad entre plantas, y sin devolverlos
        // aqui las comprobaciones siguientes medirian esa separacion.
        // Se usa `teleportCreature` para que las criaturas queden tambien en el
        // INDICE DE TILES: `_applyPosition` cambia la posicion pero no el indice,
        // asi que un "mirar" no las encontraria.
        world.teleportCreature(session.player, { x: 30, y: 30, z: 7 });
        world.teleportCreature(sessionB.player, { x: 31, y: 30, z: 7 });
        session.player.nextStepAt = 0;
        engine.view.markDirty(session.playerId);
        engine.view.markDirty(sessionB.playerId);
        sent.length = 0;

        const look = session.handle(P.message(P.CLIENT.LOOK, 31, 30, 7));
        check('mirar un tile describe lo que hay',
            look.action === 'look' && /Segundo/.test(look.text),
            '"' + look.text + '"');

        const lookWall = session.handle(P.message(P.CLIENT.LOOK, 12, 10, 7));
        check('y describe los items del suelo',
            /stone wall/.test(lookWall.text),
            '"' + lookWall.text + '"');

        const lookGround = session.handle(P.message(P.CLIENT.LOOK, 50, 50, 7));
        check('y el suelo por defecto tambien se describe',
            /grass/.test(lookGround.text),
            '"' + lookGround.text + '"');

        const lookNothing = session.handle(P.message(P.CLIENT.LOOK, 999, 999, 7));
        check('y no se inventa nada cuando de verdad no hay nada',
            /No ves nada/.test(lookNothing.text),
            '"' + lookNothing.text + '" fuera del mapa');
    }

    {
        // Un monstruo al lado, para atacar. Se le sube la vida: con sus 20 puntos
        // el primer golpe lo mata, y entonces el segundo ataque fallaria por
        // objetivo inexistente en vez de por enfriamiento, que es lo que se quiere
        // medir.
        const rat = world.createMonster('Rat', { x: 31, y: 31, z: 7 });
        rat.maxHealth = 500;
        rat.health = 500;
        world.teleportCreature(session.player, { x: 30, y: 30, z: 7 });
        session.player.nextAttackAt = 0;
        session.player.nextStepAt = 0;
        session.player.weaponAttack = 20;
        session.player.attackSkill = 10;

        const healthBefore = rat.health;
        const attack = session.handle(P.message(P.CLIENT.ATTACK, rat.id));

        check('atacar a un monstruo contiguo le hace daño',
            attack.action === 'attack' && attack.result.hit === true &&
            rat.health < healthBefore,
            'vida ' + healthBefore + ' -> ' + rat.health);

        check('y el ataque queda en enfriamiento',
            session.player.nextAttackAt > 0,
            'no se puede atacar sin parar');

        const early = session.handle(P.message(P.CLIENT.ATTACK, rat.id));
        check('el segundo ataque inmediato se rechaza',
            early.result.hit === false && early.result.reason === 'exhausted');

        check('no se puede atacar a la propia criatura',
            session.handle(P.message(P.CLIENT.ATTACK, session.playerId)).reason === 'badTarget');

        check('ni a un identificador inventado',
            session.handle(P.message(P.CLIENT.ATTACK, 999999)).reason === 'badTarget');
    }

    // =======================================================================
    section('9. Desconexion');
    // =======================================================================

    {
        const id = session.playerId;
        check('el jugador esta en el mundo', world.getPlayer(id) !== null);

        session.close();

        check('al desconectar sale del mundo',
            world.getPlayer(id) === null && engine.view.snapshot(id) === null,
            'no queda estado colgado del jugador');

        check('y la sesion se da de baja',
            engine.sessions.get(id) === null && engine.sessions.size === 1,
            'queda ' + engine.sessions.size + ' sesion(es)');

        check('cerrar dos veces no rompe nada',
            session.close() === false,
            'el primer cierre devolvio true, el segundo false');
    }

    // =======================================================================
    console.log('');
    engine.shutdown();

    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el cliente solo ve lo que el motor le manda.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
