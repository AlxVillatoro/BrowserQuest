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
    const configPath = resolve(settings.configFile || 'config.js');
    const loaded = Config.load(configPath, log);
    const config = loaded.config;

    log.info('configuracion: ' + (loaded.source
        ? loaded.declaredKeys + ' claves declaradas en ' + path.basename(loaded.source)
        : 'valores por defecto'));

    // --- 2. Definiciones XML ---------------------------------------------
    const world = new World({ logger: log });

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

    // --- 3. Registro de contenido -----------------------------------------
    const registry = new ScriptRegistry({ world: world, logger: log });

    const loadOptions = () => ({
        directories: [resolve(config.scriptsDirectory), resolve(config.monstersDirectory)],
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
    let content = { files: 0, definitions: 0, byKind: { action: 0, movement: 0, talkaction: 0, monster: 0 } };

    if (config.scriptingEnabled) {
        content = loadContent(registry, loadOptions());
        log.info('contenido: ' + content.files + ' modulos cargados, ' +
            content.definitions + ' definiciones registradas');
    } else {
        log.warning('scriptingEnabled = false: no se carga contenido');
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
        monsterTypes: world.monsterTypes.size,
        map: mapStats
    };

    log.info('registrado: ' + stats.actions + ' acciones, ' + stats.movements +
        ' movimientos, ' + stats.talkActions + ' comandos, ' +
        stats.monsterTypes + ' tipos de monstruo');

    return {
        rootDir: rootDir,
        log: log,
        config: config,
        world: world,
        registry: registry,
        game: game,
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

        reloadContent: reloadContent,

        shutdown() {
            // Se restaura el `Game` anterior para no pisar a otro motor que
            // conviva en el mismo proceso (por ejemplo, en las pruebas).
            restoreGame();
        }
    };
}

module.exports = { createEngine };
