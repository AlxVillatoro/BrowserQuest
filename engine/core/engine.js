'use strict';

/**
 * Arranque del motor.
 *
 * El orden de carga NO es arbitrario: replica el de The Forgotten Server, y cada
 * paso depende del anterior.
 *
 *   1. `config.lua`      — el resto de rutas y opciones salen de aquí.
 *   2. Definiciones XML  — `items.xml` y `data/XML/*.xml` rellenan los tipos.
 *   3. API primitiva     — se publica `Engine` antes de que nadie la use.
 *   4. `data/lib/`       — la librería Lua construye `Game`, `Player`, `Action`
 *                          y los envoltorios de despacho SOBRE `Engine`.
 *   5. Envoltorios       — se resuelven y se referencian para poder despachar.
 *   6. Contenido         — `data/scripts/` y `data/monsters/`, que ya pueden
 *                          usar todo lo anterior.
 *
 * Invertir 3 y 4, o 4 y 6, produce errores de "nil value" en los scripts que
 * parecen del script y son del orden de arranque. Es el fallo clásico al montar
 * un datapack, así que el orden está fijado aquí y no se deja al azar.
 */

const fs = require('fs');
const path = require('path');

const { createLogger } = require('./logger');
const Config = require('./config');
const { LuaRuntime } = require('../lua/runtime');
const { createPrimitives } = require('../lua/api');
const { World } = require('../world/world');
const Xml = require('../data/xml');

/**
 * @param {Object} [options]
 * @param {string} [options.rootDir] raíz del proyecto
 * @param {string} [options.configFile] ruta de config.lua
 * @param {string} [options.logLevel]
 * @returns {Object} motor arrancado
 */
function createEngine(options) {
    const settings = options || {};
    const rootDir = settings.rootDir || path.resolve(__dirname, '..', '..');
    const log = createLogger(settings.logLevel || 'info');

    const resolve = (target) => (path.isAbsolute(target) ? target : path.resolve(rootDir, target));

    const world = new World({ logger: log });
    const runtime = new LuaRuntime({ rootDir: rootDir, logger: log });

    // --- 1. Configuración -------------------------------------------------
    const configPath = resolve(settings.configFile || 'config.lua');
    const loaded = Config.load(runtime, configPath, log);
    const config = loaded.config;
    log.info('configuración: ' + (loaded.source ? loaded.applied + ' claves de ' + path.basename(loaded.source) : 'valores por defecto'));

    // --- 2. Definiciones XML ---------------------------------------------
    const itemsPath = resolve(config.itemsXml);
    if (fs.existsSync(itemsPath)) {
        world.itemTypes = Xml.loadItems(itemsPath);
        log.info('items.xml: ' + world.itemTypes.size + ' items definidos');
    } else {
        log.warning('no se encontró ' + itemsPath + ': no habrá tipos de item');
    }

    const vocationsPath = resolve(config.vocationsXml);
    let vocations = new Map();
    if (fs.existsSync(vocationsPath)) {
        vocations = Xml.loadVocations(vocationsPath);
        log.info('vocations.xml: ' + vocations.size + ' vocaciones');
    } else {
        log.warning('no se encontró ' + vocationsPath);
    }

    // --- 3. API primitiva -------------------------------------------------
    runtime.registerApi(createPrimitives({ runtime: runtime, world: world, log: log }));

    // --- 4. Librería Lua --------------------------------------------------
    let libFiles = [];
    const libDir = resolve(config.libDirectory);
    if (config.luaEnabled) {
        libFiles = runtime.runDirectory(libDir, {
            verbose: config.showScriptsLogInConsole,
            onError: 'abort'
        });
        log.info('data/lib: ' + libFiles.length + ' archivos cargados');
    } else {
        log.warning('luaEnabled = false: no se carga data/lib');
    }

    // --- 5. Envoltorios de despacho --------------------------------------
    runtime.resolveDispatchWrappers();

    // --- 6. Contenido -----------------------------------------------------
    const onError = config.scriptErrorPolicy === 'skip' ? 'skip' : 'abort';
    let scriptFiles = [];
    let monsterFiles = [];

    if (config.luaEnabled) {
        const scriptsDir = resolve(config.scriptsDirectory);
        scriptFiles = runtime.runDirectory(scriptsDir, {
            verbose: config.showScriptsLogInConsole,
            onError: onError
        });
        log.info('data/scripts: ' + scriptFiles.length + ' scripts cargados');

        const monstersDir = resolve(config.monstersDirectory);
        monsterFiles = runtime.runDirectory(monstersDir, {
            verbose: config.showScriptsLogInConsole,
            onError: onError
        });
        log.info('data/monsters: ' + monsterFiles.length + ' monstruos cargados');
    }

    // Contadores de contenido registrado. Se exponen para que las pruebas y el
    // arranque puedan informar de lo que hay sin hurgar en las estructuras.
    const registeredScripts = new Set();
    runtime.actions.forEach((entry) => registeredScripts.add(entry.script));
    runtime.movements.forEach((entry) => registeredScripts.add(entry.script));
    runtime.talkActions.forEach((entry) => registeredScripts.add(entry.script));

    const stats = {
        configKeys: loaded.keys.length,
        items: world.itemTypes.size,
        vocations: vocations.size,
        libFiles: libFiles.length,
        scriptFiles: scriptFiles.length,
        monsterFiles: monsterFiles.length,
        registeredScripts: registeredScripts.size,
        actions: runtime.actions.size,
        movements: runtime.movements.size,
        talkActions: runtime.talkActions.length,
        monsterTypes: world.monsterTypes.size
    };

    log.info('contenido registrado: ' + stats.actions + ' acciones, ' +
        stats.movements + ' movimientos, ' + stats.talkActions + ' talkactions, ' +
        stats.monsterTypes + ' tipos de monstruo');

    return {
        rootDir: rootDir,
        log: log,
        config: config,
        world: world,
        runtime: runtime,
        vocations: vocations,
        stats: stats,

        dispatchAction(itemId, context) {
            return runtime.dispatchAction(itemId, context);
        },

        dispatchMovement(type, itemId, context) {
            return runtime.dispatchMovement(type, itemId, context);
        },

        dispatchTalkAction(words, context) {
            return runtime.dispatchTalkAction(words, context);
        },

        shutdown() {
            runtime.close();
        }
    };
}

module.exports = { createEngine };
