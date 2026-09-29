'use strict';

/**
 * Carga de `config.lua`.
 *
 * La configuración del motor es código Lua que se ejecuta y deja sus claves en
 * variables globales, igual que en The Forgotten Server. Eso permite escribir
 * tablas anidadas y expresiones:
 *
 *     experienceStages = {
 *         { minlevel = 1, maxlevel = 50, multiplier = 100 },
 *     }
 *
 * En vez de mantener a mano una lista de claves (que se desincroniza en cuanto
 * alguien añade una opción), las claves se EXTRAEN del propio archivo: cualquier
 * asignación de primer nivel en `config.lua` se convierte en una clave de
 * configuración. Añadir una opción al archivo basta para que llegue al motor.
 */

const fs = require('fs');

/** Valores de respaldo para lo que el motor necesita sí o sí. */
const DEFAULTS = {
    dataDirectory: 'data',
    clientDirectory: 'client',
    itemsXml: 'data/items/items.xml',
    itemsOtb: 'data/items/items.otb',
    vocationsXml: 'data/XML/vocations.xml',
    outfitsXml: 'data/XML/outfits.xml',
    monstersDirectory: 'data/monsters',
    scriptsDirectory: 'data/scripts',
    libDirectory: 'data/lib',
    worldDirectory: 'data/world',
    mapName: 'world',
    loginProtocolPort: 7171,
    gameProtocolPort: 7172,
    maxPlayers: 200,
    serverName: 'Avillatoro',
    luaEnabled: true,
    showScriptsLogInConsole: true,
    reloadCommandEnabled: true,
    scriptErrorPolicy: 'abort',
    worldType: 'pvp',
    protectionLevel: 1,
    tickIntervalMs: 50,
    newPlayerLevel: 1,
    newPlayerHealth: 150,
    newPlayerCap: 400,
    newPlayerSpawnPosX: 100,
    newPlayerSpawnPosY: 100,
    newPlayerSpawnPosZ: 7,
    rateExperience: 1,
    rateSkill: 1,
    rateLoot: 1,
    rateSpawn: 1
};

/**
 * Elimina comentarios de línea y de bloque antes de buscar asignaciones, para
 * que un ejemplo comentado no se cuele como clave de configuración.
 */
function stripComments(source) {
    return source
        .replace(/--\[\[[\s\S]*?\]\]/g, ' ')
        .replace(/--[^\n]*/g, ' ');
}

/**
 * Extrae los nombres asignados en el primer nivel del archivo.
 * @returns {string[]}
 */
function extractKeys(source) {
    const clean = stripComments(source);
    const keys = [];
    const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm;
    let match;
    while ((match = re.exec(clean)) !== null) {
        if (keys.indexOf(match[1]) === -1) {
            keys.push(match[1]);
        }
    }
    return keys;
}

/**
 * Carga la configuración.
 *
 * @param {Object} runtime instancia de LuaRuntime
 * @param {string} filepath ruta de config.lua
 * @param {Object} log
 * @returns {{config: Object, keys: string[], source: string|null}}
 */
function load(runtime, filepath, log) {
    const config = { ...DEFAULTS };

    if (!fs.existsSync(filepath)) {
        log.warning('no se encontró ' + filepath + ': se usan los valores por defecto');
        return { config: config, keys: Object.keys(DEFAULTS), source: null };
    }

    const source = fs.readFileSync(filepath, 'utf8');
    const keys = extractKeys(source);

    runtime.runFile(filepath);

    let applied = 0;
    keys.forEach((key) => {
        const value = runtime.getGlobal(key);
        if (value !== undefined) {
            config[key] = value;
            applied += 1;
        }
    });

    return { config: config, keys: keys, applied: applied, source: filepath };
}

module.exports = { load, extractKeys, stripComments, DEFAULTS };
