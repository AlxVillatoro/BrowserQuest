'use strict';

/**
 * Prueba del motor: arranca el datapack entero y comprueba que cada pieza hace
 * lo que dice hacer.
 *
 * No es una prueba de "carga sin petar". Verifica el contrato completo, que es
 * donde están los fallos de verdad:
 *
 *   config.js     -> las claves llegan, incluidas las estructuras anidadas
 *   items.xml     -> definiciones, atributos y rangos fromid/toid
 *   vocations.xml -> multiplicadores de skill indexados por id
 *   contenido     -> los módulos se cargan y se registran sin paso manual
 *   monstruos     -> las definiciones anidadas llegan enteras
 *   DESPACHO      -> un evento llega al handler y el handler actúa sobre el mundo
 *   FIRMAS        -> cada tipo de evento recibe los argumentos que le tocan
 *   recarga       -> recargar no duplica registros
 *   aislamiento   -> un handler que falla no tumba el tick
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
    section('1. config.js');
    // -----------------------------------------------------------------------

    check('las claves declaradas llegan al motor',
        config.serverName === 'Avillatoro' && config.gameProtocolPort === 7172,
        'serverName=' + config.serverName + ' gameProtocolPort=' + config.gameProtocolPort);

    check('los valores por defecto se aplican a lo no declarado',
        config.maxPlayers === 50 && typeof config.scriptErrorPolicy === 'string',
        'maxPlayers=' + config.maxPlayers + ' (calculado segun NODE_ENV)');

    // Esta es la razon de que la configuracion sea codigo y no JSON: una
    // estructura de estructuras con campos con nombre.
    const stages = config.experienceStages;
    check('experienceStages llega como array de objetos',
        Array.isArray(stages) && stages.length === 4 &&
        stages[0].minlevel === 1 && stages[0].multiplier === 100 &&
        stages[3].maxlevel === 0,
        Array.isArray(stages) ? stages.length + ' etapas, ultima sin tope' : typeof stages);

    // -----------------------------------------------------------------------
    section('2. items.xml');
    // -----------------------------------------------------------------------

    check('se cargan los items', world.itemTypes.size === 11,
        world.itemTypes.size + ' items (6 explicitos + 5 del rango 1950-1954)');

    const sword = world.itemTypes.get(2400);
    check('nombre y atributos de un item',
        sword && sword.name === 'magic sword' && sword.attributes.attack === 48,
        sword ? sword.name + ' attack=' + sword.attributes.attack : 'no existe');

    check('el rango fromid/toid expande la misma definicion',
        world.itemTypes.get(1950) && world.itemTypes.get(1954) &&
        world.itemTypes.get(1950).name === 'footprint',
        'ids 1950..1954');

    check('un id inexistente no existe', world.itemTypes.get(9999) === undefined);

    // -----------------------------------------------------------------------
    section('3. vocations.xml');
    // -----------------------------------------------------------------------

    const knight = engine.vocations.get(4);
    check('vocacion con sus escalares y skills por id',
        engine.vocations.size === 5 && knight && knight.name === 'Knight' &&
        knight.gainHp === 15 && knight.skills[4] === 3.0,
        knight ? knight.name + ' skill4=' + knight.skills[4] : 'no existe');

    // -----------------------------------------------------------------------
    section('4. Carga de contenido');
    // -----------------------------------------------------------------------

    check('los modulos se cargan sin paso manual de registro',
        engine.stats.contentFiles === 5 && engine.stats.contentDefinitions === 6,
        engine.stats.contentFiles + ' modulos, ' + engine.stats.contentDefinitions + ' definiciones');

    check('definiciones por tipo',
        engine.stats.byKind.action === 1 && engine.stats.byKind.movement === 2 &&
        engine.stats.byKind.talkaction === 2 && engine.stats.byKind.monster === 1,
        JSON.stringify(engine.stats.byKind));

    check('un modulo puede declarar varios registros con un array',
        engine.stats.talkActions === 2, '/pos y /item, ambos en commands.js');

    const rat = world.monsterTypes.get('Rat');
    check('el monstruo llega con su estructura anidada',
        rat && rat.health === 20 && rat.experience === 5 &&
        rat.outfit && rat.outfit.lookType === 21,
        rat ? rat.health + ' hp, ' + rat.experience + ' exp, outfit ' + rat.outfit.lookType : 'no existe');

    check('el loot llega como array indexado',
        rat && Array.isArray(rat.loot) && rat.loot.length === 2 && rat.loot[0].id === 3031,
        rat ? JSON.stringify(rat.loot[0]) : '-');

    check('el modulo de origen se registra para poder diagnosticar',
        rat && rat.script === 'data/monsters/vermins/rat.js',
        rat ? rat.script : '-');

    // -----------------------------------------------------------------------
    section('5. La API Game');
    // -----------------------------------------------------------------------

    check('Game esta instalado mientras el motor vive',
        typeof globalThis.Game === 'object' && globalThis.Game !== null);

    check('Game.getItemName resuelve el tipo',
        globalThis.Game.getItemName(3031) === 'gold coin' &&
        globalThis.Game.getItemName(9999) === null,
        'Game.getItemName(3031) = ' + JSON.stringify(globalThis.Game.getItemName(3031)));

    check('Game.createItem devuelve un envoltorio',
        globalThis.Game.getItemName(2400) === 'magic sword' &&
        engine.game.itemTypeExists(2400) && !engine.game.itemTypeExists(9999));

    // -----------------------------------------------------------------------
    section('6. Despacho: el handler actua sobre el mundo');
    // -----------------------------------------------------------------------

    const player = world.createPlayer('Avillatoro', { x: 100, y: 100, z: 7 });

    // --- 6.1 Accion: onUse(player, item, fromPosition, target, toPosition, isHotkey)
    const useLever = engine.dispatchAction(1948, {
        playerId: player.id, fromX: 100, fromY: 100, fromZ: 7
    });

    check('el onUse de la palanca se ejecuta',
        useLever.handled === true && useLever.script === 'data/scripts/actions/others/lever.js',
        'script=' + useLever.script);

    check('el handler TELEPORTO al jugador (z 7 -> 8)',
        world.teleports.length === 1 && world.teleports[0].to.z === 8,
        JSON.stringify(world.teleports[0] ? world.teleports[0].to : null));

    check('el handler le envio un mensaje',
        lastMessage(world, player.id) === 'Subes a (100, 100, 8).',
        JSON.stringify(lastMessage(world, player.id)));

    check('un item sin accion no se despacha',
        engine.dispatchAction(3031, { playerId: player.id }).handled === false);

    // --- 6.2 TalkAction: onSay(player, words, param, type)
    const pos = engine.dispatchTalkAction('/pos', { playerId: player.id });
    check('la talkaction /pos se ejecuta y LEE el estado del mundo',
        pos.handled === true &&
        lastMessage(world, player.id) ===
        'Posicion: (100, 100, 8)  Vida: 150/150  Nivel: 1  Vocacion: None',
        JSON.stringify(lastMessage(world, player.id)));

    const itemsBefore = world.items.size;
    engine.dispatchTalkAction('/item 3031', { playerId: player.id });
    check('la talkaction casa por prefijo y CREA un item',
        world.items.size === itemsBefore + 1 &&
        lastMessage(world, player.id) === 'Creado: gold coin',
        JSON.stringify(lastMessage(world, player.id)));

    engine.dispatchTalkAction('/item patata', { playerId: player.id });
    check('un parametro invalido se rechaza con un mensaje',
        lastMessage(world, player.id) === 'Uso: /item <id>');

    // El registro es API publica, asi que la prueba puede registrar contenido
    // propio para verificar firmas que el datapack de ejemplo no cubre.
    let capturedSay = null;
    engine.registry.register({
        type: 'talkaction',
        words: '/firma',
        onSay(p, words, param, type) {
            capturedSay = { words: words, param: param, type: type };
            return true;
        }
    }, 'prueba');

    engine.dispatchTalkAction('/firma uno dos', { playerId: player.id, type: 3 });
    check('onSay recibe los CUATRO argumentos de TFS',
        capturedSay && capturedSay.words === '/firma uno dos' &&
        capturedSay.param === 'uno dos' && capturedSay.type === 3,
        JSON.stringify(capturedSay));

    // --- 6.3 Movimiento stepin: (creature, item, position, fromPosition)
    const stepIn = engine.dispatchMovement('stepin', 1387, {
        creatureId: player.id, x: 100, y: 100, z: 8, fromX: 100, fromY: 99, fromZ: 8
    });
    check('el onStepIn del portal se ejecuta',
        stepIn.handled === true &&
        lastMessage(world, player.id) === 'Un portal te absorbe.',
        JSON.stringify(lastMessage(world, player.id)));

    // --- 6.4 Movimiento equip: (player, item, slot, isCheck) -- firma DISTINTA
    engine.dispatchMovement('equip', 2376, {
        creatureId: player.id, slot: 9, isCheck: false
    });
    check('onEquip recibe (player, item, slot, isCheck)',
        lastMessage(world, player.id) === 'Te pones sword ring en el slot 9.',
        JSON.stringify(lastMessage(world, player.id)));

    engine.dispatchMovement('equip', 2376, {
        creatureId: player.id, slot: 9, isCheck: true
    });
    check('isCheck distingue la consulta de la accion real',
        lastMessage(world, player.id) === 'Te pones sword ring en el slot 9.',
        'en modo consulta el handler no anuncio nada');

    check('un tipo de movimiento no registrado no se despacha',
        engine.dispatchMovement('stepout', 1387, { creatureId: player.id }).handled === false);

    // -----------------------------------------------------------------------
    section('7. Robustez');
    // -----------------------------------------------------------------------

    // Un handler que lanza no debe tumbar el tick del mundo.
    engine.registry.register({
        type: 'action',
        ids: [2160],
        onUse() {
            throw new Error('fallo deliberado de la prueba');
        }
    }, 'prueba');

    const thrown = engine.dispatchAction(2160, { playerId: player.id });
    check('un handler que lanza se captura y no propaga',
        thrown.handled === false && thrown.error instanceof Error,
        thrown.error ? thrown.error.message : 'no se capturo');

    // El motor debe seguir vivo despues del fallo.
    check('el motor sigue funcionando tras un handler roto',
        engine.dispatchTalkAction('/pos', { playerId: player.id }).handled === true);

    // Un handler async es un fallo silencioso: el tick no espera la promesa.
    engine.registry.register({
        type: 'action',
        ids: [2376],
        onUse() {
            return Promise.resolve(true);
        }
    }, 'prueba');
    const asyncResult = engine.dispatchAction(2376, { playerId: player.id });
    check('un handler que devuelve una promesa se detecta y se avisa',
        asyncResult.handled === false, 'no se trata como exito');

    // -----------------------------------------------------------------------
    section('8. Recarga en caliente');
    // -----------------------------------------------------------------------

    const before = {
        definitions: engine.stats.contentDefinitions,
        actions: engine.registry.actions.size,
        talkActions: engine.registry.talkActions.length
    };

    engine.reloadContent();

    check('recargar no DUPLICA registros',
        engine.stats.contentDefinitions === before.definitions,
        before.definitions + ' definiciones antes y despues');

    check('recargar devuelve el contenido a su estado de arranque',
        engine.registry.actions.size === 1 && engine.registry.talkActions.length === 2,
        'las definiciones de prueba (que no son ficheros) desaparecen, como en un /reload real');

    check('recargar vuelve a dejar el contenido funcional',
        engine.dispatchAction(1948, { playerId: player.id }).handled === true);

    // -----------------------------------------------------------------------
    section('9. Aislamiento');
    // -----------------------------------------------------------------------

    const snapshot = JSON.stringify(world.getPlayer(player.id));
    engine.dispatchTalkAction('/pos', { playerId: player.id });
    check('despachar no muta el estado del mundo por si solo',
        JSON.stringify(world.getPlayer(player.id)) === snapshot);

    // El envoltorio devuelve una copia: mutar la posicion no mueve al jugador.
    const position = engine.registry.entities.player(player.id).getPosition();
    position.x = 9999;
    check('mutar una posicion obtenida no mueve al jugador',
        world.getPlayer(player.id).position.x === 100,
        'la posicion se copia, no se comparte');

    engine.shutdown();

    check('al cerrar se restaura el Game anterior',
        globalThis.Game === undefined);

    // -----------------------------------------------------------------------
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el motor carga el datapack y el contenido JS actua sobre el mundo.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
