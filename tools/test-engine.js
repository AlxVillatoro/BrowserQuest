'use strict';

/**
 * Prueba del motor: arranca el datapack entero y comprueba que cada pieza hace
 * lo que dice hacer.
 *
 * No es una prueba de "carga sin petar". Lo que verifica es el contrato
 * completo, que es donde están los fallos de verdad:
 *
 *   config.lua    -> las claves llegan, incluidas las tablas anidadas
 *   items.xml     -> definiciones, atributos y rangos fromid/toid
 *   vocations.xml -> multiplicadores de skill indexados por id
 *   data/lib      -> se construye la API cómoda sobre las primitivas
 *   data/scripts  -> se registran acciones, movimientos y talkactions
 *   data/monsters -> los monstruos son Lua y su tabla anidada llega entera
 *   DESPACHO      -> un evento llega al script, el script actúa sobre el mundo
 *
 * El último punto es el importante: comprueba que un script Lua puede mover a un
 * jugador de verdad. Sin eso, todo lo demás es fontanería.
 *
 * Uso:  node tools/test-engine.js
 */

const path = require('path');
const { createEngine } = require('../engine/core/engine');

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

/** Último mensaje enviado a un jugador, o null. */
function lastMessage(world, playerId) {
    const forPlayer = world.messages.filter((m) => m.playerId === playerId);
    return forPlayer.length ? forPlayer[forPlayer.length - 1].text : null;
}

function main() {
    console.log('Prueba del motor (' + ROOT + ')');

    const engine = createEngine({ rootDir: ROOT, logLevel: 'error' });
    const world = engine.world;
    const config = engine.config;

    // -----------------------------------------------------------------------
    section('1. config.lua');
    // -----------------------------------------------------------------------

    check('las claves de config.lua llegan al motor',
        config.serverName === 'Avillatoro' && config.gameProtocolPort === 7172,
        'serverName=' + config.serverName + ' gameProtocolPort=' + config.gameProtocolPort);

    check('los valores por defecto se aplican',
        config.maxPlayers === 200 && config.scriptErrorPolicy === 'abort');

    // Esta es la razón de que la configuración sea Lua y no JSON: una tabla de
    // tablas con campos con nombre.
    const stages = config.experienceStages;
    check('experienceStages llega como array de tablas',
        Array.isArray(stages) && stages.length === 4 &&
        stages[0].minlevel === 1 && stages[0].multiplier === 100,
        Array.isArray(stages) ? stages.length + ' etapas, la primera x' + stages[0].multiplier : typeof stages);

    // -----------------------------------------------------------------------
    section('2. items.xml');
    // -----------------------------------------------------------------------

    check('se cargan los items', world.itemTypes.size === 11,
        world.itemTypes.size + ' items (6 explicitos + 5 del rango 1950-1954)');

    const sword = world.itemTypes.get(2400);
    check('nombre y atributos de un item',
        sword && sword.name === 'magic sword' && sword.attributes.attack === 48,
        sword ? sword.name + ' attack=' + sword.attributes.attack : 'no existe');

    const coin = world.itemTypes.get(3031);
    check('atributo plural',
        coin && coin.plural === 'gold coins' && coin.article === 'a');

    check('el rango fromid/toid expande la misma definicion',
        world.itemTypes.get(1950) && world.itemTypes.get(1954) &&
        world.itemTypes.get(1950).name === 'footprint' &&
        world.itemTypes.get(1954).name === 'footprint',
        'ids 1950..1954');

    check('un id inexistente no existe',
        world.itemTypes.get(9999) === undefined);

    // -----------------------------------------------------------------------
    section('3. vocations.xml');
    // -----------------------------------------------------------------------

    check('se cargan las vocaciones', engine.vocations.size === 5);

    const knight = engine.vocations.get(4);
    check('vocacion con sus escalares',
        knight && knight.name === 'Knight' && knight.gainHp === 15 && knight.baseSpeed === 220,
        knight ? knight.name + ' gainhp=' + knight.gainHp : 'no existe');

    check('multiplicadores de skill indexados por id',
        knight && knight.skills[0] === 1.1 && knight.skills[4] === 3.0,
        knight ? 'skill0=' + knight.skills[0] + ' skill4=' + knight.skills[4] : '-');

    // -----------------------------------------------------------------------
    section('4. data/lib (la capa Lua)');
    // -----------------------------------------------------------------------

    check('la API publica se construye sobre las primitivas',
        engine.stats.libFiles === 6,
        engine.stats.libFiles + ' archivos');

    check('los envoltorios de despacho se resuelven',
        engine.runtime.dispatchRefs.action !== undefined &&
        engine.runtime.dispatchRefs.movement !== undefined &&
        engine.runtime.dispatchRefs.talkaction !== undefined);

    // -----------------------------------------------------------------------
    section('5. Registro de contenido');
    // -----------------------------------------------------------------------

    check('acciones registradas', engine.stats.actions === 1, 'item 1948 (palanca)');
    check('movimientos registrados', engine.stats.movements === 1, 'stepin del item 1387 (portal)');
    check('talkactions registradas', engine.stats.talkActions === 2, '/pos y /item');
    check('tipos de monstruo registrados', engine.stats.monsterTypes === 1, 'Rat');

    const rat = world.monsterTypes.get('Rat');
    check('el monstruo llega con su tabla anidada',
        rat && rat.health === 20 && rat.experience === 5 &&
        rat.outfit && rat.outfit.lookType === 21,
        rat ? rat.health + ' hp, ' + rat.experience + ' exp, outfit ' + rat.outfit.lookType : 'no existe');

    check('el loot llega como array de tablas',
        rat && Array.isArray(rat.loot) && rat.loot.length === 2 && rat.loot[0].id === 3031,
        rat ? JSON.stringify(rat.loot[0]) : '-');

    check('el script de origen se registra',
        rat && rat.script === 'data/monsters/vermins/rat.lua',
        rat ? rat.script : '-');

    // -----------------------------------------------------------------------
    section('6. Despacho de eventos (el script actua sobre el mundo)');
    // -----------------------------------------------------------------------

    const player = world.createPlayer('Avillatoro', { x: 100, y: 100, z: 7 });

    // --- 6.1 Accion: /usar la palanca debe subir una planta ---
    const useLever = engine.dispatchAction(1948, {
        playerId: player.id, fromX: 100, fromY: 100, fromZ: 7
    });

    check('el onUse de la palanca se ejecuta y devuelve true',
        useLever.handled === true && useLever.script === 'data/scripts/actions/others/lever.lua',
        'script=' + useLever.script);

    check('el script TELEPORTÓ al jugador (z 7 -> 8)',
        world.teleports.length === 1 && world.teleports[0].to.z === 8,
        JSON.stringify(world.teleports[0] ? world.teleports[0].to : null));

    check('el script le envió un mensaje al jugador',
        lastMessage(world, player.id) === 'Subes a (100, 100, 8).',
        JSON.stringify(lastMessage(world, player.id)));

    check('el mundo refleja la nueva posicion',
        world.getPlayer(player.id).position.z === 8);

    // --- 6.2 Accion sobre un item sin script ---
    const useUnknown = engine.dispatchAction(3031, { playerId: player.id });
    check('un item sin accion no se despacha',
        useUnknown.handled === false);

    // --- 6.3 TalkAction sin parametro ---
    const pos = engine.dispatchTalkAction('/pos', { playerId: player.id });
    check('la talkaction /pos se ejecuta',
        pos.handled === true && pos.script === 'data/scripts/talkactions/commands.lua');

    check('el script LEYÓ el estado del mundo a traves de la API',
        lastMessage(world, player.id) ===
        'Posicion: (100, 100, 8)  Vida: 150/150  Nivel: 1  Vocacion: None',
        JSON.stringify(lastMessage(world, player.id)));

    // --- 6.4 TalkAction con parametro ---
    const itemsBefore = world.items.size;
    const item = engine.dispatchTalkAction('/item 3031', { playerId: player.id });

    check('la talkaction /item casa por prefijo con el parametro',
        item.handled === true);

    check('el script CREÓ un item en el mundo',
        world.items.size === itemsBefore + 1 &&
        lastMessage(world, player.id) === 'Creado: gold coin',
        JSON.stringify(lastMessage(world, player.id)));

    // --- 6.5 Parametro invalido ---
    engine.dispatchTalkAction('/item patata', { playerId: player.id });
    check('un parametro invalido se rechaza con un mensaje',
        lastMessage(world, player.id) === 'Uso: /item <id>',
        JSON.stringify(lastMessage(world, player.id)));

    // --- 6.6 Movimiento ---
    const stepIn = engine.dispatchMovement('stepin', 1387, {
        creatureId: player.id, x: 100, y: 100, z: 8, fromX: 100, fromY: 99, fromZ: 8
    });

    check('el onStepIn del portal se ejecuta',
        stepIn.handled === true && stepIn.script === 'data/scripts/movements/tiles/teleport.lua');

    check('el movimiento envia su propio mensaje',
        lastMessage(world, player.id) === 'Un portal te absorbe.',
        JSON.stringify(lastMessage(world, player.id)));

    // --- 6.7 Tipo de movimiento inexistente ---
    check('un tipo de movimiento no registrado no se despacha',
        engine.dispatchMovement('stepout', 1387, { creatureId: player.id }).handled === false);

    // -----------------------------------------------------------------------
    section('7. Aislamiento: Lua no puede corromper el estado');
    // -----------------------------------------------------------------------

    // Player guarda sólo el identificador, así que dos objetos del mismo jugador
    // son el mismo objeto y ninguno copia estado.
    const before = JSON.stringify(world.getPlayer(player.id));
    engine.dispatchTalkAction('/pos', { playerId: player.id });
    check('despachar no muta el estado del mundo por si solo',
        JSON.stringify(world.getPlayer(player.id)) === before);

    engine.shutdown();

    // -----------------------------------------------------------------------
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el motor carga el datapack y los scripts actuan sobre el mundo.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
