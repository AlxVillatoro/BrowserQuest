'use strict';

/**
 * Arranque del motor.
 *
 * El orden de carga NO es arbitrario: cada paso depende del anterior.
 *
 *   1. config.js         el resto de rutas y opciones sale de aquí.
 *   2. Definiciones XML  items.xml y data/XML/*.xml rellenan los tipos.
 *   3. Mundo             el estado, que es de quien son los tipos cargados.
 *   4. Registro          acciones, movimientos, comandos y monstruos.
 *   5. Contenido         data/scripts/ y data/monsters/, que ya pueden usar todo.
 *
 * Invertir 2 y 5, o 3 y 5, produce errores que parecen del script y son del orden
 * de arranque: es el fallo clásico al montar un datapack. Por eso el orden está
 * fijado aquí y no se deja al azar.
 *
 * Nota sobre el contenido: los módulos se cargan con `require`, y antes de cada
 * uno se descarta su entrada de caché. Sin eso, recargar en caliente devolvería
 * el módulo antiguo y la recarga sería una mentira.
 */

const fs = require('fs');
const path = require('path');

const { createLogger } = require('./logger');
const Config = require('./config');
const { World } = require('../world/world');
const Xml = require('../data/xml');
const { ScriptRegistry } = require('../scripting/registry');
const { loadContent } = require('../scripting/loader');
const { createGame, installGame } = require('../scripting/game');
const MapLoader = require('../world/loader');
const { Scheduler } = require('./scheduler');
const { Spawner } = require('../world/spawner');
const { Combat } = require('../world/combat');
const { MonsterAI } = require('../world/ai');
const { ViewManager } = require('../net/view');
const { SessionManager } = require('../net/session');
const { PlayerRepository } = require('../persistence/players');

/**
 * @param {Object} [options]
 * @param {string} [options.rootDir] raíz del proyecto
 * @param {string} [options.configFile] ruta de config.js
 * @param {string} [options.logLevel] debug | info | warning | error
 * @returns {Object} motor arrancado
 */
function createEngine(options) {
    const settings = options || {};
    const rootDir = settings.rootDir || path.resolve(__dirname, '..', '..');
    const log = createLogger(settings.logLevel || 'info');

    const resolve = (target) => (path.isAbsolute(target) ? target : path.resolve(rootDir, target));

    // --- 1. Configuración -------------------------------------------------
    // `overrides` gana sobre el archivo, y es lo que permite que las pruebas
    // arranquen un motor con la persistencia apagada o con una base de datos en un
    // archivo temporal, sin tocar config.js ni ensuciar el repositorio.
    const configPath = resolve(settings.configFile || 'config.js');
    const loaded = Config.load(configPath, log, settings.overrides);
    const config = loaded.config;

    log.info('configuracion: ' + (loaded.source
        ? loaded.declaredKeys + ' claves declaradas en ' + path.basename(loaded.source)
        : 'valores por defecto'));

    // --- 2. Planificador y mundo ------------------------------------------
    // El planificador se crea antes que el mundo porque el mundo lo usa para todo
    // lo que ocurre "dentro de un rato": terminar un paso, hacer reaparecer un
    // monstruo, regenerar salud.
    const scheduler = new Scheduler({ logger: log });

    const world = new World({
        logger: log,
        scheduler: scheduler,
        tickIntervalMs: config.tickIntervalMs
    });

    const itemsPath = resolve(config.itemsXml);
    if (fs.existsSync(itemsPath)) {
        world.itemTypes = Xml.loadItems(itemsPath);
        log.info('items.xml: ' + world.itemTypes.size + ' items definidos');
    } else {
        log.warning('no se encontro ' + itemsPath + ': no habra tipos de item');
    }

    let vocations = new Map();
    const vocationsPath = resolve(config.vocationsXml);
    if (fs.existsSync(vocationsPath)) {
        vocations = Xml.loadVocations(vocationsPath);
        log.info('vocations.xml: ' + vocations.size + ' vocaciones');
    } else {
        log.warning('no se encontro ' + vocationsPath);
    }

    // Los aspectos son definiciones del motor, como las vocaciones: no son contenido
    // de mundo y no los tocan los scripts, se leen al arrancar. Lo que SI es de cada
    // jugador son los COLORES, y esos van en el personaje.
    const outfitTypes = new Map();
    const outfitsPath = resolve(config.outfitsXml);
    if (fs.existsSync(outfitsPath)) {
        Xml.loadOutfits(outfitsPath).forEach((outfit, id) => {
            outfitTypes.set(id, outfit);
        });
        log.info('outfits.xml: ' + outfitTypes.size + ' aspectos');
    } else {
        log.warning('no se encontro ' + outfitsPath + ': no se podra comprobar el aspecto');
    }


    world.outfitTypes = outfitTypes;

    // --- 3. Registro de contenido -----------------------------------------
    const registry = new ScriptRegistry({ world: world, logger: log });

    /*
     * El mundo necesita saber ENVOLVER una criatura para el contenido, y el envoltorio vive
     * en la capa de contenido. Se le pasa la fabrica en vez de que el mundo la importe: asi
     * el mundo sigue sin conocer el registro, que es lo que permite que el motor funcione
     * sin datapack.
     *
     * Lo usan los NPC para pasarle a su dialogo un envoltorio del jugador y no la criatura
     * cruda. Sin esto, un modulo de dialogo podria mover jugadores por el mapa, y la unica
     * razon por la que las acciones y los comandos no pueden es que a ellos si se les pasa
     * el envoltorio.
     */
    world.wrapForContent = (creature) => registry.entities.creature(creature.id);

    const loadOptions = () => ({
        directories: [
            resolve(config.scriptsDirectory),
            resolve(config.monstersDirectory),
            // El diálogo de los NPC vive junto a sus definiciones, como en TFS. Se carga
            // como un módulo de contenido más, así que se recarga en caliente igual que
            // una acción o un monstruo.
            resolve(config.npcDirectory)
        ],
        rootDir: rootDir,
        logger: log,
        onError: config.scriptErrorPolicy === 'skip' ? 'skip' : 'abort',
        verbose: config.showScriptsLogInConsole
    });

    /**
     * Recarga el contenido de data/ sin reiniciar el proceso, como el `/reload`
     * de TFS. Hereda sus dos límites, que conviene tener presentes: NO recarga
     * el mapa ni la configuración estática (puertos, nombre del mapa).
     *
     * El vaciado previo es imprescindible: sin él, recargar duplicaría cada
     * registro. Es el fallo que el propio TFS documenta en su script de recarga.
     */
    const reloadContent = () => {
        registry.actions.clear();
        registry.movements.clear();
        registry.talkActions.length = 0;
        registry.registeredScripts.clear();
        world.monsterTypes.clear();

        const result = loadContent(registry, loadOptions());
        log.info('contenido recargado: ' + result.files + ' modulos, ' +
            result.definitions + ' definiciones');
        return result;
    };

    // --- 4. API de scripting ----------------------------------------------
    // `Game` se instala ANTES de cargar el contenido, porque un módulo puede
    // usarlo ya al cargarse (por ejemplo, para generar definiciones en bucle).
    const game = createGame({
        world: world,
        registry: registry,
        logger: log,
        config: config,
        reloadContent: reloadContent
    });
    const restoreGame = installGame(game);

    // --- 5. Contenido -----------------------------------------------------
    let content = { files: 0, definitions: 0, byKind: { action: 0, movement: 0, talkaction: 0, monster: 0, npc: 0, event: 0 } };

    if (config.scriptingEnabled) {
        content = loadContent(registry, loadOptions());
        log.info('contenido: ' + content.files + ' modulos cargados, ' +
            content.definitions + ' definiciones registradas');
    } else {
        log.warning('scriptingEnabled = false: no se carga contenido');
    }

    // --- 5b. NPC ----------------------------------------------------------
    //
    // VA DESPUÉS DEL CONTENIDO Y ANTES DEL MAPA, y el orden es obligatorio por los dos
    // lados. Después del contenido porque el diálogo de un NPC es un módulo de contenido y
    // hasta aquí no existe; antes del mapa porque el mapa valida que los NPC que coloca
    // estén definidos.
    //
    // La primera versión de esto estaba junto a los otros XML, ANTES del contenido, y el
    // resultado fueron dos NPC mudos y un aviso que decía justo eso. El sitio de un paso
    // no es "donde queda ordenado" sino "después de lo que necesita".
    const npcTypes = new Map();
    const npcsPath = path.join(resolve(config.npcDirectory), 'npcs.xml');
    const npcDefinitions = fs.existsSync(npcsPath)
        ? Xml.loadNpcs(npcsPath)
        : new Map();

    if (npcDefinitions.size > 0) {
        npcDefinitions.forEach((definition, name) => {
            const dialogue = world.npcTypes.get(name);

            if (!dialogue) {
                // Un NPC definido y sin diálogo es un NPC mudo, y eso es un fallo de quien
                // escribe el contenido, no algo que deba descubrir un jugador.
                log.warning('el npc "' + name + '" esta en npcs.xml pero no tiene modulo ' +
                    'de dialogo: se quedara mudo');
                return;
            }

            npcTypes.set(name, { ...definition, dialogue: dialogue });
        });

        log.info('npcs.xml: ' + npcDefinitions.size + ' definidos, ' +
            npcTypes.size + ' con dialogo');
    } else if (fs.existsSync(path.dirname(npcsPath))) {
        log.warning('no se encontro ' + npcsPath + ': el mundo no tendra NPC');
    }

    // --- 6. Mapa ----------------------------------------------------------
    // Se carga DESPUÉS del contenido a propósito, y es el mismo orden que sigue
    // The Forgotten Server: la validación de los spawns necesita los tipos de
    // monstruo ya registrados, así que el mapa no puede ir antes.
    const mapFile = config.mapFile
        ? resolve(config.mapFile)
        : path.join(resolve(config.worldDirectory), config.mapName + '.map.json');

    let mapStats = null;

    if (!fs.existsSync(mapFile)) {
        log.warning('no se encontro el mapa ' + mapFile + ': el mundo no tendra geometria');
    } else {
        const mapResult = MapLoader.loadMap(mapFile, {
            itemTypes: world.itemTypes,
            monsterTypes: world.monsterTypes,
            npcTypes: npcTypes,
            logger: log
        });

        // Los avisos se muestran siempre; los errores impiden arrancar. Seguir con
        // un mapa a medias da fallos de movimiento imposibles de rastrear hasta su
        // causa, así que es mejor parar y decir exactamente qué tile está mal.
        mapResult.report.warnings.forEach((warning) => {
            log.warning('mapa: ' + (warning.where ? warning.where + ': ' : '') + warning.message);
        });

        if (!mapResult.report.ok) {
            log.error('el mapa tiene ' + mapResult.report.errors.length + ' error(es):');
            console.error(mapResult.report.format());
            throw new Error('mapa invalido: ' + mapFile);
        }

        world.map = mapResult.map;
        mapStats = mapResult.map.stats();

        log.info('mapa: ' + mapStats.name + ' ' + mapStats.size + ', ' +
            mapStats.explicitTiles + ' tiles explicitos de ' +
            mapStats.cellsIfMaterialized.toLocaleString('es-ES') + ' celdas (' +
            (100 * mapStats.explicitTiles / mapStats.cellsIfMaterialized).toFixed(2) + '%)');
        log.info('mapa: ' + mapStats.waypoints + ' waypoints, ' + mapStats.spawns + ' spawns');
    }

    // --- 7. Mundo y contenido: los enganches ------------------------------
    // El mundo NO conoce el registro de contenido: sólo avisa de lo que pasa, y
    // aquí se decide si hay algún módulo interesado. Sin esta separación el mundo
    // tendría que saber qué es un `onStepIn`, y el motor dejaría de ser
    // independiente del datapack.
    //
    // Sobre la búsqueda: en TFS la precedencia es uniqueid -> actionid -> itemid.
    // Aquí sólo se resuelve por itemid, porque el mapa todavía no declara action
    // ids. Cuando los declare, esta es la función que debe implementar la cascada.
    world.on('onStepIn', (creature, tile, fromPosition) => {
        tile.getItems().forEach((item) => {
            registry.dispatchMovement('stepin', item.typeId, {
                creatureId: creature.id,
                itemUid: item.instanceId || 0,
                x: tile.x, y: tile.y, z: tile.z,
                fromX: fromPosition.x, fromY: fromPosition.y, fromZ: fromPosition.z
            });
        });
    });

    world.on('onStepOut', (creature, tile, toPosition) => {
        tile.getItems().forEach((item) => {
            registry.dispatchMovement('stepout', item.typeId, {
                creatureId: creature.id,
                itemUid: item.instanceId || 0,
                x: toPosition.x, y: toPosition.y, z: toPosition.z,
                fromX: tile.x, fromY: tile.y, fromZ: tile.z
            });
        });
    });

    // --- 8. Combate e IA --------------------------------------------------
    const combat = new Combat({
        world: world,
        scheduler: scheduler,
        logger: log,
        config: config
    });

    // La IA se crea ANTES de cargar los spawns: se suscribe a la aparicion de
    // criaturas, asi que los monstruos que aparezcan despues empiezan a pensar
    // solos. Si se creara despues, los del arranque se quedarian quietos.
    const ai = new MonsterAI({
        world: world,
        combat: combat,
        scheduler: scheduler,
        logger: log
    });

    // --- 9. Los eventos de criatura, hacia el contenido -------------------
    // El envoltorio se construye por criatura y no por identificador suelto: asi
    // un handler de muerte recibe un monstruo y no un jugador.
    const wrap = (creature) => (creature ? registry.entities.creature(creature.id) : null);

    world.on('onKill', (killer, target) => {
        registry.dispatchEvent('kill', [wrap(killer), wrap(target)]);
    });

    world.on('onDeath', (target, killer, dropped) => {
        registry.dispatchEvent('death', [
            wrap(target),
            wrap(killer),
            dropped.map((item) => item.getName())
        ]);
    });

    world.on('onAdvance', (player, skill, oldLevel, newLevel) => {
        registry.dispatchEvent('advance', [wrap(player), skill, oldLevel, newLevel]);
    });

    // --- 10. Vista --------------------------------------------------------
    // La vista decide qué ve cada jugador. Se crea aquí y no dentro de la capa de
    // red porque no es red: es una decision sobre el MUNDO (que plantas se ven,
    // que entra en el area), y la red solo la transporta.
    const view = new ViewManager({
        world: world,
        logger: log,
        viewWidth: config.viewWidth,
        viewHeight: config.viewHeight,
        floorsBelow: config.viewFloorsBelow,
        floorsAbove: config.viewFloorsAbove
    });

    // --- 11. Spawns -------------------------------------------------------
    // El gestor se suscribe por su cuenta al evento de muerte: es quien lo
    // necesita, asi que no depende de que el motor se acuerde de cablearlo.
    const spawner = new Spawner({ world: world, scheduler: scheduler, logger: log });

    let spawnStats = { spawns: 0, monsters: 0 };
    if (world.map) {
        spawnStats = spawner.loadFromMap(world.map);
        log.info('spawns: ' + spawnStats.spawns + ' puntos de aparicion, ' +
            spawnStats.monsters + ' monstruos vivos');
    }

    // --- 11b. NPC ---------------------------------------------------------
    //
    // Los NPC se colocan a partir de las posiciones del MAPA, igual que los spawns. El
    // mapa dice DÓNDE y `npcs.xml` dice CÓMO es cada uno; el diálogo lo pone el registro
    // al crear la criatura.
    let npcStats = { placed: 0, skipped: [] };

    if (world.map) {
        (world.map.npcPlacements || []).forEach((placement) => {
            const definition = npcTypes.get(placement.name);

            if (!definition) {
                // El cargador ya avisa de esto al leer el mapa; aquí se salta en vez de
                // reventar, porque un NPC que falta no debe impedir jugar.
                npcStats.skipped.push(placement.name);
                return;
            }

            world.createNpc(definition, placement);
            npcStats.placed += 1;
        });

        if (npcStats.placed > 0 || npcStats.skipped.length > 0) {
            log.info('npc: ' + npcStats.placed + ' colocados' +
                (npcStats.skipped.length > 0
                    ? ', ' + npcStats.skipped.length + ' sin definicion' : ''));
        }
    }

    /*
     * Los NPC OYEN lo que se dice cerca.
     *
     * Se engancha al mismo aviso que usa la difusión del habla, así que un NPC oye
     * exactamente lo mismo que oiría un jugador de al lado. Lo importante es el orden: el
     * NPC responde ANTES de que el mensaje se difunda, para que su respuesta salga después
     * de lo que dijo el jugador y la conversación se lea en orden.
     *
     * La respuesta NO se difunde desde aquí: el NPC la dice por `onSayLine`, que el mundo
     * engancha a su vez a la difusión. Así una respuesta de tres frases sale en orden.
     */

    /**
     * Los NPC pasean.
     *
     * Se les da un tic propio y no se reutiliza el de los monstruos: un monstruo piensa
     * cada pocos cientos de milisegundos porque persigue, y un NPC piensa cada varios
     * segundos porque pasea. Meterlos en el mismo bucle obligaría a uno de los dos a
     * pensar más de lo que necesita.
     */
    if (world.npcs.size > 0) {
        const NPC_TICK_MS = 500;

        /**
         * Los cuatro pasos, en el orden de `DIRECTION`: norte, este, sur, oeste.
         *
         * Se declaran aquí y no se importan de `world` porque son la representación del
         * MOVIMIENTO, no del mundo, y este es el único sitio que los necesita.
         */
        const NPC_STEP_OFFSETS = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 }
        ];

        const npcTick = () => {
            const at = world.now();

            world.npcs.forEach((npc) => {
                if (npc.onThink) {
                    npc.onThink(npc, world, at);
                }

                const decision = npc.think(at);
                if (!decision.walked) {
                    return;
                }

                const offset = NPC_STEP_OFFSETS[decision.direction];
                const to = {
                    x: npc.position.x + offset.x,
                    y: npc.position.y + offset.y,
                    z: npc.position.z
                };

                // Sólo da el paso si sigue dentro de su radio Y la casilla se puede
                // pisar. El radio es lo que impide que acabe dentro de una casa, y el
                // segundo lo que impide que atraviese una pared.
                const distance = Math.max(
                    Math.abs(to.x - npc.home.x), Math.abs(to.y - npc.home.y));

                if (distance > npc.walkRadius) {
                    return;
                }

                world.moveCreature(npc, { x: offset.x, y: offset.y });
            });

            scheduler.schedule(NPC_TICK_MS, npcTick, 'npc-think');
        };

        scheduler.schedule(NPC_TICK_MS, npcTick, 'npc-think');
    }

    // --- 11. Persistencia -------------------------------------------------
    // Se crea DESPUES del mapa porque un personaje nuevo necesita saber donde
    // aparece, y eso lo dice el waypoint `temple` del mapa.
    let repository = null;
    let persistenceStats = null;

    if (config.useDatabase) {
        const spawn = world.map ? world.map.getWaypoint('temple') : null;

        repository = new PlayerRepository({
            world: world,
            logger: log,
            config: config,
            file: resolve(config.databaseFile),
            spawnPosition: spawn
                ? { x: spawn.x, y: spawn.y, z: spawn.z }
                : { x: 0, y: 0, z: 7 }
        });

        repository.open();
        persistenceStats = repository.database.stats_();

        log.info('personajes guardados: ' + persistenceStats.players +
            ' en ' + persistenceStats.accounts + ' cuenta(s)');
    } else {
        log.warning('persistencia APAGADA: los personajes viven lo que viva el proceso');
    }

    const stats = {
        declaredConfigKeys: loaded.declaredKeys,
        items: world.itemTypes.size,
        vocations: vocations.size,
        contentFiles: content.files,
        contentDefinitions: content.definitions,
        byKind: content.byKind,
        actions: registry.actions.size,
        movements: registry.movements.size,
        talkActions: registry.talkActions.length,
        creatureEvents: registry.events.size,
        monsterTypes: world.monsterTypes.size,
        outfits: world.outfitTypes ? world.outfitTypes.size : 0,
        // Los NPC se cuentan por los COLOCADOS y no solo por los definidos: de nada sirve
        // tener diez definidos si el mapa no coloca ninguno.
        npcs: world.npcs.size,
        npcTypes: npcTypes.size,
        monsters: world.monsters.size,
        spawns: spawnStats.spawns,
        persistence: persistenceStats,
        map: mapStats
    };

    log.info('registrado: ' + stats.actions + ' acciones, ' + stats.movements +
        ' movimientos, ' + stats.talkActions + ' comandos, ' +
        stats.monsterTypes + ' tipos de monstruo');

    const api = {
        rootDir: rootDir,
        log: log,
        config: config,
        world: world,
        registry: registry,
        game: game,
        scheduler: scheduler,
        spawner: spawner,
        combat: combat,
        ai: ai,
        view: view,
        repository: repository,
        sessions: null,
        vocations: vocations,
        stats: stats,

        dispatchAction(itemId, context) {
            return registry.dispatchAction(itemId, context);
        },

        dispatchMovement(event, itemId, context) {
            return registry.dispatchMovement(event, itemId, context);
        },

        dispatchTalkAction(words, context) {
            return registry.dispatchTalkAction(words, context);
        },

        /**
         * Arranca el bucle de simulación.
         *
         * Está separado del arranque a propósito: las pruebas necesitan avanzar el
         * mundo a mano (`world.tick()`) para ser deterministas, y arrancar un
         * temporizador de fondo dentro de `createEngine` lo haría imposible.
         */
        start() {
            // Los monstruos que ya existian empiezan a pensar; los que aparezcan
            // despues lo hacen solos al suscribirse la IA a su aparicion.
            ai.start();
            return world.start();
        },

        stop() {
            return world.stop();
        },

        reloadContent: reloadContent,

        shutdown() {
            // `api.sessions` y no `sessions`: el gestor se crea DESPUES de este
            // literal, asi que no es una variable en su ambito. La referencia se
            // resuelve al llamar, cuando ya existe.
            if (api.sessions) {
                // Cerrar las sesiones guarda a cada jugador, porque el guardado va
                // en `close()`. Es el ultimo momento en que se puede salvar lo que
                // hayan hecho.
                api.sessions.closeAll();
            }

            // Y despues se guarda a quien pudiera quedar, por si alguna sesion no
            // llego a registrarse. Guardar de mas no cuesta nada; perder a alguien
            // si.
            if (repository) {
                const result = repository.saveAll();
                if (result.failed > 0) {
                    log.error('al apagar no se pudo guardar a ' + result.failed +
                        ' jugador(es)');
                }
                repository.close();
            }

            world.stop();
            ai.stop();
            if (scheduler) {
                scheduler.clear();
            }
            // Se restaura el `Game` anterior para no pisar a otro motor que
            // conviva en el mismo proceso (por ejemplo, en las pruebas).
            restoreGame();
        }
    };

    // --- 11. Red ----------------------------------------------------------
    // La capa de red se crea AL FINAL y recibe el propio objeto del motor, porque
    // necesita su combate. Se construye aparte del literal para poder cerrar esta
    // referencia circular sin trucos: primero existe el motor, luego la red que lo
    // usa.
    api.sessions = new SessionManager({
        engine: api,
        world: world,
        view: view,
        repository: repository,
        logger: log
    });

    /**
     * Guardado periódico.
     *
     * Va en el planificador y no en un `setInterval` propio: así comparte reloj con
     * el mundo, se puede avanzar a mano en las pruebas y no queda un temporizador
     * suelto que nadie recuerda apagar.
     */
    if (repository) {
        const autosave = () => {
            const result = repository.saveAll();
            if (result.failed > 0) {
                log.error('guardado periodico: ' + result.saved + ' guardados, ' +
                    result.failed + ' fallaron');
            }
            scheduler.schedule(config.autosaveIntervalMs, autosave, 'autosave');
        };

        scheduler.schedule(config.autosaveIntervalMs, autosave, 'autosave');
    }

    /** Difunde lo que dice una criatura a quien pueda oírla. */
    api.broadcastSay = (creature, text) => api.sessions.broadcastSay(creature, text);

    /*
     * El camino de los mensajes HACIA el jugador.
     *
     * El mundo avisa de que alguien ha hablado o de que hay un mensaje privado, y aquí
     * se traduce a mensajes del protocolo. Es la misma separación que en todo lo demás:
     * el mundo no sabe que existe un protocolo, y el contenido no sabe que existe un
     * cliente. Sin este enganche, `sendTextMessage` sólo apuntaba el texto en una lista
     * y al jugador no le llegaba nada.
     */
    world.on('onTextMessage', (player, text) => {
        if (!player) {
            return;
        }
        const session = api.sessions.get(player.id);
        if (session) {
            session.sendText(text);
        }
    });

    world.on('onCreatureSay', (creature, text) => {
        api.sessions.broadcastSay(creature, text);

        /*
         * Los NPC oyen DESPUÉS de que el mensaje se difunda, y el orden es lo que hace que
         * la conversación se lea bien.
         *
         * El primer intento los escuchaba en un manejador aparte, registrado ANTES que
         * éste, así que el NPC respondía antes de que el mensaje del jugador se difundiera
         * y en el chat salía primero la respuesta y después la pregunta. Se veía al
         * probarlo por la red; desde dentro del motor los dos caminos funcionaban.
         *
         * Un monstruo que grita no hace que el herrero conteste: los NPC oyen a los
         * jugadores, que es lo que hace que una conversación sea una conversación.
         */
        if (creature && creature.isPlayer && creature.isPlayer()) {
            world.npcsHear(creature, text, world.now());
        }
    });

    /*
     * La muerte de un jugador tiene que LLEGARLE.
     *
     * Sin esto, morir era un teletransporte silencioso al templo con la vida llena y las
     * cosas tiradas en otro sitio: desde dentro del juego, indistinguible de un fallo.
     * El aviso va por dos caminos porque son dos cosas distintas: el mensaje explica qué
     * ha pasado, y el mensaje de protocolo le dice al cliente que puede reaccionar (una
     * pantalla, un sonido) sin tener que interpretar el texto.
     */
    world.on('onPlayerDeath', (player, killer, dropped) => {
        const killerName = killer && killer.name ? killer.name : null;

        world.sendTextMessage(player.id, killerName
            ? 'Has muerto a manos de ' + killerName + '.'
            : 'Has muerto.');

        if (dropped.length > 0) {
            world.sendTextMessage(player.id, 'Has soltado ' + dropped.length +
                ' cosa(s) donde caiste. Sigues en el templo.');
        }

        const session = api.sessions.get(player.id);
        if (session) {
            session.sendDeath(killerName, dropped.length);
        }
    });

    /** Crea una sesión con un transporte ya resuelto. Se registra al entrar. */
    api.createSession = (send) => api.sessions.createSession(send);

    // El mundo avisa al final de cada tick y la red empuja entonces los cambios de
    // vista. Se engancha aquí y no dentro del mundo porque el mundo no sabe que
    // existe una red.
    world.on('onTick', () => api.sessions.updateAll());

    return api;
}

module.exports = { createEngine };
