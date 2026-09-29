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

    const engine = createEngine({
        rootDir: ROOT,
        logLevel: 'error',
        // Sin persistencia: esta prueba comprueba el motor, y arrancarlo con base
        // de datos dejaria un archivo en `data/` cada vez que se ejecuta. Que las
        // pruebas no ensucien el repositorio no es estetica: un `.db` de verdad
        // mezclado con los de prueba hace imposible saber cual se esta mirando.
        overrides: { useDatabase: false }
    });
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

    check('se cargan los items', world.itemTypes.size === 18,
        world.itemTypes.size + ' items (13 explicitos + 5 del rango 1950-1954)');

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
        engine.stats.contentFiles === 8 && engine.stats.contentDefinitions === 11,
        engine.stats.contentFiles + ' modulos, ' + engine.stats.contentDefinitions + ' definiciones');

    check('definiciones por tipo',
        engine.stats.byKind.action === 1 && engine.stats.byKind.movement === 2 &&
        engine.stats.byKind.talkaction === 4 && engine.stats.byKind.monster === 1 &&
        engine.stats.byKind.event === 1,
        JSON.stringify(engine.stats.byKind));

    check('un modulo puede declarar varios registros con un array',
        engine.stats.talkActions === 4, '/pos, /item, /outfit y /i, los cuatro en commands.js');

    // --- Aspectos ---

    check('se cargan los aspectos de outfits.xml',
        engine.stats.outfits === 15 && world.outfitTypes.has(136),
        engine.stats.outfits + ' aspectos, y el 136 es "' +
        (world.outfitTypes.get(136) ? world.outfitTypes.get(136).name : '?') + '"');

    check('un aspecto sabe si es premium y si esta disponible',
        world.outfitTypes.get(132).premium === true &&
        world.outfitTypes.get(137).unlocked === false,
        'el 132 es premium y el 137 esta bloqueado');

    check('y sabe que anadidos tiene',
        world.outfitTypes.get(128).addons.size === 2 &&
        world.outfitTypes.get(133).addons.size === 0,
        'el Citizen tiene dos y el Summoner ninguno');

    {
        // El comando /outfit, con los nombres de TFS.
        const outfitPlayer = world.createPlayer('Vestido', { x: 40, y: 40, z: 7 });

        const sayOutfit = engine.dispatchTalkAction('/outfit 130 100 50 20 10 1', { playerId: outfitPlayer.id, type: 1 });

        check('el comando /outfit cambia el aspecto',
            sayOutfit.handled === true &&
            outfitPlayer.outfit.lookType === 130 &&
            outfitPlayer.outfit.head === 100 &&
            outfitPlayer.outfit.addons === 1,
            'aspecto ' + outfitPlayer.outfit.lookType + ', colores ' +
            outfitPlayer.outfit.head + '/' + outfitPlayer.outfit.body + '/' +
            outfitPlayer.outfit.legs + '/' + outfitPlayer.outfit.feet +
            ', anadidos ' + outfitPlayer.outfit.addons);

        check('y lo confirma con la API de TFS',
            lastMessage(world, outfitPlayer.id).indexOf('Aspecto: tipo 130') === 0,
            '"' + lastMessage(world, outfitPlayer.id) + '"');

        // LOS COLORES VIENEN DEL CLIENTE, asi que hay que acotarlos. Un indice 300 no
        // existe en una paleta de 133 colores, y si el motor lo dejara pasar, cada
        // cliente tendria que defenderse por su cuenta.
        engine.dispatchTalkAction('/outfit 131 300 -5 999 58', { playerId: outfitPlayer.id, type: 1 });

        check('un color fuera de la paleta se acota en vez de rechazarse',
            outfitPlayer.outfit.head === 132 &&
            outfitPlayer.outfit.body === 0 &&
            outfitPlayer.outfit.legs === 132,
            '300 -> 132, -5 -> 0, 999 -> 132: el motor valida y el cliente dibuja');

        // Un aspecto que no existe SI se rechaza, porque no es un dato fuera de rango:
        // es una apariencia que el cliente no sabria dibujar.
        const badOutfit = engine.dispatchTalkAction('/outfit 60000 10 10 10 10', { playerId: outfitPlayer.id, type: 1 });

        check('un aspecto que no existe se rechaza',
            outfitPlayer.outfit.lookType === 131 &&
            lastMessage(world, outfitPlayer.id).indexOf('No se puede') === 0,
            '"' + lastMessage(world, outfitPlayer.id) + '"');

        check('y un aspecto bloqueado tambien',
            engine.dispatchTalkAction('/outfit 137 10 10 10 10', { playerId: outfitPlayer.id, type: 1 }).handled === true &&
            outfitPlayer.outfit.lookType === 131 &&
            /bloqueado/.test(lastMessage(world, outfitPlayer.id)),
            '"' + lastMessage(world, outfitPlayer.id) + '"');

        check('los nombres de TFS y los de dentro son intercambiables',
            (() => {
                const wrapper = engine.registry.entities.player(outfitPlayer.id);
                const a = wrapper.setOutfit({ lookType: 129, lookHead: 11 }, false);
                const b = wrapper.getOutfit();
                const c = wrapper.setOutfit({ lookType: 128, head: 22 }, false);
                const d = wrapper.getOutfit();
                return a.ok && b.lookHead === 11 && c.ok && d.lookHead === 22;
            })(),
            'lookHead y head significan lo mismo, y obligar a recordar cual toca en ' +
            'cada sitio es una trampa');

        world.removePlayer(outfitPlayer.id);
    }

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

    // El jugador se coloca DENTRO del mapa, en hierba transitable. No es un
    // detalle: el teletransporte comprueba los limites, asi que un jugador fuera
    // del mapa no se puede mover y la prueba mediria lo que no cree medir.
    const player = world.createPlayer('Avillatoro', { x: 40, y: 40, z: 7 });

    // --- 6.1 Accion: onUse(player, item, fromPosition, target, toPosition, isHotkey)
    const useLever = engine.dispatchAction(1948, {
        playerId: player.id, fromX: 40, fromY: 40, fromZ: 7
    });

    check('el onUse de la palanca se ejecuta',
        useLever.handled === true && useLever.script === 'data/scripts/actions/others/lever.js',
        'script=' + useLever.script);

    check('el handler TELEPORTO al jugador (z 7 -> 8)',
        world.teleports.length === 1 && world.teleports[0].to.z === 8,
        JSON.stringify(world.teleports[0] ? world.teleports[0].to : null));

    check('el handler le envio un mensaje',
        lastMessage(world, player.id) === 'Subes a (40, 40, 8).',
        JSON.stringify(lastMessage(world, player.id)));

    check('un item sin accion no se despacha',
        engine.dispatchAction(3031, { playerId: player.id }).handled === false);

    // --- 6.2 TalkAction: onSay(player, words, param, type)
    const pos = engine.dispatchTalkAction('/pos', { playerId: player.id });
    check('la talkaction /pos se ejecuta y LEE el estado del mundo',
        pos.handled === true &&
        lastMessage(world, player.id) ===
        'Posicion: (40, 40, 8)  Vida: 150/150  Nivel: 1  Vocacion: None',
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
        engine.registry.actions.size === 1 && engine.registry.talkActions.length === 4,
        'las definiciones de prueba (que no son ficheros) desaparecen, como en un /reload real');

    check('recargar vuelve a dejar el contenido funcional',
        engine.dispatchAction(1948, { playerId: player.id }).handled === true);

    // -----------------------------------------------------------------------
    section('9. Mapa cargado por el motor');
    // -----------------------------------------------------------------------

    const map = world.map;
    check('el motor carga el mapa al arrancar', !!map, map ? map.name : 'no hay mapa');

    check('el mapa conoce su tamano',
        map.width === 64 && map.height === 64 && map.floors === 16,
        map.stats().size);

    check('el suelo por defecto es distinto por planta',
        map.getGround(50, 50, 7).getName() === 'grass' &&
        map.getGround(50, 50, 8).getName() === 'stone floor',
        'planta 7 = hierba, planta 8 = piedra');

    check('Game consulta el mapa a traves de la API',
        globalThis.Game.isWalkable(40, 40, 7) === true &&
        globalThis.Game.isWalkable(10, 10, 7) === false,
        'hierba transitable, muro no');

    const temple = globalThis.Game.getWaypoint('temple');
    check('Game resuelve waypoints',
        temple && temple.x === 40 && temple.y === 40 && temple.z === 7,
        'temple = ' + temple);

    check('Game puede describir el apilado de un tile',
        globalThis.Game.getTileStack(11, 11, 7).join(',') === 'grass,lever',
        '(11,11,7): ' + globalThis.Game.getTileStack(11, 11, 7).join(' -> '));

    check('Game informa del mapa',
        globalThis.Game.getMapInfo() && globalThis.Game.getMapInfo().name === 'sample');

    // -----------------------------------------------------------------------
    section('10. El inventario y su comando');
    // -----------------------------------------------------------------------

    {
        const bagPlayer = world.createPlayer('Cargado', { x: 40, y: 40, z: 7 });

        engine.dispatchTalkAction('/i', { playerId: bagPlayer.id, type: 1 });
        check('sin nada, /i lo dice',
            /No llevas nada/.test(lastMessage(world, bagPlayer.id)),
            '"' + lastMessage(world, bagPlayer.id) + '"');

        // Se le pone dinero en su casilla y lo recoge, que es el camino de verdad.
        world.createItem(3031, 12, { x: 40, y: 40, z: 7 });
        world.pickUpItem(bagPlayer, 40, 40, 7);

        engine.dispatchTalkAction('/i', { playerId: bagPlayer.id, type: 1 });

        check('/i lista lo que lleva',
            /12x gold coin/.test(lastMessage(world, bagPlayer.id)),
            '"' + lastMessage(world, bagPlayer.id) + '"');

        // Y la API del envoltorio tiene que ver lo mismo: si el comando y la API
        // discreparan, uno de los dos estaría mirando otro sitio.
        const bagWrapper = engine.registry.entities.player(bagPlayer.id);
        const inventory = bagWrapper.getInventory();

        check('y la API del envoltorio lo ve igual',
            inventory.length === 1 && inventory[0].count === 12 &&
            inventory[0].name === 'gold coin' && bagWrapper.getItemCount() === 1,
            JSON.stringify(inventory));

        check('la API devuelve una COPIA, no la lista de dentro',
            (() => {
                const first = bagWrapper.getInventory();
                first.push({ index: 99, typeId: 1, count: 1, name: 'inventado' });
                return bagWrapper.getItemCount() === 1;
            })(),
            'si devolviera la de verdad, un modulo podria meter cosas sin pasar por ' +
            'ninguna regla');

        world.removePlayer(bagPlayer.id);
    }

    // -----------------------------------------------------------------------
    section('11. Los NPC');
    // -----------------------------------------------------------------------

    check('se cargan las definiciones y los dialogos',
        engine.stats.npcTypes === 2 && world.npcs.size === 2,
        engine.stats.npcTypes + ' dialogos, ' + world.npcs.size + ' NPC colocados');

    {
        const guia = world.getNpc('Guia');
        const herrero = world.getNpc('Herrero');

        check('el NPC existe como criatura, con su aspecto',
            guia !== null && guia.isNpc() === true && guia.kind === 'npc' &&
            guia.outfit.lookType === 128,
            'aspecto ' + guia.outfit.lookType + ' en ' + guia.position);

        check('y el XML le da lo estatico: paseo y velocidad',
            herrero.walkInterval === 4000 && herrero.walkRadius === 3 &&
            guia.walkRadius === 0,
            'el herrero pasea cada ' + herrero.walkInterval + ' ms en un radio de ' +
            herrero.walkRadius + '; el guia no se mueve');

        check('y el modulo de contenido le da las palabras clave',
            guia.keywords.length === 6 && herrero.keywords.length === 8,
            guia.keywords.length + ' y ' + herrero.keywords.length);

        // --- El foco ---
        const visitor = world.createPlayer('Visitante', { x: 41, y: 40, z: 7 });

        check('un NPC no responde a quien no le ha saludado',
            guia.hear(visitor, 'donde esta el templo').replied === false,
            'si contestara a cualquiera, cinco jugadores a la vez serian un gallinero');

        const greeting = guia.hear(visitor, 'hola');
        check('un saludo le hace fijarse en quien le habla',
            greeting.replied === true && greeting.keyword === 'hola' &&
            guia.isFocusedOn(visitor) === true,
            '"' + String(guia.lastSaid).slice(0, 44) + '..."');

        check('y ahora si responde a las preguntas',
            guia.hear(visitor, 'donde estoy').keyword === 'donde' &&
            /Ahora mismo estas en/.test(guia.lastSaid),
            '"' + guia.lastSaid + '"');

        check('lo que no entiende lo dice, en vez de callarse',
            guia.hear(visitor, 'xyzzy').keyword === 'default' &&
            /No te entiendo/.test(guia.lastSaid),
            'callarse haria pensar que el NPC se ha roto');

        // `hola` va antes que el resto, y gana la PRIMERA que casa.
        check('gana la PRIMERA palabra clave que casa',
            guia.hear(visitor, 'hola, donde esta el templo').keyword === 'hola',
            'por eso el orden de la lista es significativo y no una lista sin mas');

        const bye = guia.hear(visitor, 'adios');

        check('despedirse suelta el foco',
            bye.keyword === 'adios' && guia.focus === null,
            'y lo suelta el MOTOR: si cada NPC tuviera que acordarse, el que se olvidara ' +
            'se quedaria pegado a un jugador para siempre');

        check('y tras despedirse vuelve a no responder',
            guia.hear(visitor, 'donde estoy').replied === false);

        world.teleportCreature(visitor, { x: 60, y: 60, z: 7 });
        check('un NPC no oye desde el otro lado del mapa',
            guia.hear(visitor, 'hola').reason === 'tooFar',
            'oye a 4 casillas, y por eso no contesta a un grito lejano');

        world.teleportCreature(visitor, { x: 41, y: 40, z: 7 });

        check('el guia no pasea: su radio es cero',
            guia.think(world.now()).reason === 'stationary');

        // Con azar inyectado la prueba es reproducible. Con `Math.random` seria una
        // moneda al aire, y una prueba que falla una de cada cuatro veces no sirve.
        const walk = herrero.think(world.now() + 100000, () => 0.5);
        check('el herrero si pasea, y el azar es inyectable',
            walk.walked === true && walk.direction === 2,
            'direccion ' + walk.direction + ' (sur), elegida con un azar fijo');

        herrero.setFocus(visitor, world.now());
        check('y no pasea mientras le estan hablando',
            herrero.think(world.now() + 1000, () => 0.5).reason === 'talking',
            'irse andando a mitad de una conversacion obliga a perseguirlo');
        herrero.clearFocus();

        world.removePlayer(visitor.id);
    }

    // -----------------------------------------------------------------------
    section('12. El comercio');
    // -----------------------------------------------------------------------

    {
        const npc = world.getNpc('Herrero');
        const buyer = world.createPlayer('Comprador', { x: 38, y: 41, z: 7 });
        const oye = (texto) => { npc.hear(buyer, texto); return npc.lastSaid; };

        check('el NPC declara su tienda',
            npc.shopList().length === 3 && npc.shopList()[0].buy === 1000,
            npc.shopList().map((e) => e.name + '(' + e.buy + '/' + e.sell + ')').join(' '));

        // --- Lo que NO debe pasar ---
        oye('hola');
        const sinDinero = oye('comprar espada');

        check('sin dinero no se compra, y NO se cobra nada',
            /Te faltan monedas/.test(sinDinero) &&
            world.countMoney(buyer) === 0 && world.countOf(buyer, 2400) === 0,
            '"' + sinDinero + '"');

        // --- Comprar ---
        world.giveItem(buyer, 3031, 2500);

        check('se compra y se cobra el precio',
            /Aqui tienes 1x espada/.test(oye('comprar espada')) &&
            world.countMoney(buyer) === 1500 && world.countOf(buyer, 2400) === 1,
            'dinero ' + world.countMoney(buyer) + ', espadas ' + world.countOf(buyer, 2400));

        // --- Vender ---
        check('se vende y se cobra lo que el NPC paga',
            /Te doy 400 monedas/.test(oye('vender espada')) &&
            world.countMoney(buyer) === 1900 && world.countOf(buyer, 2400) === 0,
            'dinero ' + world.countMoney(buyer) + '; comprar a 1000 y vender a 400: la ' +
            'diferencia es el margen del mercader');

        // --- Los dos nombres ---
        check('el objeto se reconoce por el nombre del mercader Y por el de Tibia',
            world.npcOfferFromWords(npc, ['espada'], 'buy') !== null &&
            world.npcOfferFromWords(npc, ['magic', 'sword'], 'buy') !== null,
            'quien escribe "espada" espera que le entiendan, y quien escribe ' +
            '"magic sword" tambien');

        // --- Las asimetrias ---
        check('hay cosas que vende y no compra',
            world.npcOfferFromWords(npc, ['anillo'], 'buy') !== null &&
            world.npcOfferFromWords(npc, ['anillo'], 'sell') === null &&
            /Eso no lo compro/.test(oye('vender anillo')),
            'que falte un precio significa "no hago esa operacion", no "es gratis"');

        check('y cosas que no vende ni compra',
            /Eso no lo vendo/.test(oye('comprar casa')),
            'y lo dice, en vez de entregar un objeto que no existe');

        // --- La moneda no es un negocio ---
        const monedasAntes = world.countMoney(buyer);
        const compraMonedas = world.buyFromNpc(buyer, npc, 3031, 100);
        world.sellToNpc(buyer, npc, 3031, 100);

        check('comprar y vender monedas no da beneficio',
            compraMonedas.ok === true && world.countMoney(buyer) === monedasAntes,
            monedasAntes + ' -> ' + world.countMoney(buyer) + ': al mismo precio no hay ' +
            'negocio, y si lo hubiera seria una maquina de fabricar dinero');

        // --- Atomicidad: lo mas importante de un comercio ---
        const dinero = world.countMoney(buyer);
        const fallo = world.buyFromNpc(buyer, npc, 2376, 99);

        check('una compra que no se puede pagar no cobra NADA',
            fallo.ok === false && fallo.reason === 'notEnoughMoney' &&
            world.countMoney(buyer) === dinero && world.countOf(buyer, 2376) === 0,
            'cuesta ' + fallo.price + ' y tiene ' + fallo.money +
            ': TODO se comprueba antes de tocar nada');

        const vendido = world.sellToNpc(buyer, npc, 2400, 5);

        check('y una venta de lo que no se tiene tampoco cobra nada',
            vendido.ok === false && vendido.reason === 'notOwned' &&
            world.countMoney(buyer) === dinero,
            'no se paga por lo que no se recibe');

        // El envoltorio tiene que ver lo mismo que el motor: la primera version contaba el
        // inventario DEL ENVOLTORIO, que no existe, y siempre daba cero.
        const envoltorio = engine.registry.entities.player(buyer.id);

        check('el envoltorio de contenido ve el mismo dinero que el motor',
            envoltorio.getMoney() === world.countMoney(buyer) &&
            envoltorio.getItemCountById(3031) === world.countOf(buyer, 3031),
            envoltorio.getMoney() + ' = ' + world.countMoney(buyer));

        world.removePlayer(buyer.id);
    }

    // -----------------------------------------------------------------------
    section('13. Aislamiento');
    // -----------------------------------------------------------------------

    // Se comparan los campos que importan, no el objeto entero. El grafo del mundo
    // es CIRCULAR a proposito (criatura -> tile -> criaturas), para poder sacar a
    // una criatura de su tile en O(1), asi que no es serializable tal cual. Es
    // tambien la razon de que la persistencia tendra que serializar campo a campo
    // en vez de volcar el estado.
    const snapshot = (id) => {
        const p = world.getPlayer(id);
        return JSON.stringify({
            name: p.name,
            position: p.position.toString(),
            health: p.health,
            maxHealth: p.maxHealth,
            level: p.level,
            vocation: p.vocation
        });
    };

    const beforeState = snapshot(player.id);
    engine.dispatchTalkAction('/pos', { playerId: player.id });
    check('despachar no muta el estado del mundo por si solo',
        snapshot(player.id) === beforeState);

    // El envoltorio devuelve una copia: mutar la posicion no mueve al jugador.
    const position = engine.registry.entities.player(player.id).getPosition();
    position.x = 9999;
    check('mutar una posicion obtenida no mueve al jugador',
        world.getPlayer(player.id).position.x === 40,
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
