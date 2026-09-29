'use strict';

/**
 * Carga de `config.js`.
 *
 * Al ser un módulo de JavaScript, el objeto exportado **es** la configuración:
 * no hay claves que extraer del código ni lista que mantener sincronizada, que
 * era la parte delicada de la versión con Lua. Añadir una opción al archivo basta
 * para que llegue al motor.
 *
 * Los valores por defecto de aquí son sólo los que el motor necesita para poder
 * arrancar aunque el archivo no exista o esté incompleto. Todo lo demás lo
 * declara la configuración.
 */

const fs = require('fs');

const DEFAULTS = {
    serverName: 'Avillatoro',
    dataDirectory: 'data',
    clientDirectory: 'client',
    itemsXml: 'data/items/items.xml',
    itemsOtb: 'data/items/items.otb',
    vocationsXml: 'data/XML/vocations.xml',
    outfitsXml: 'data/XML/outfits.xml',
    scriptsDirectory: 'data/scripts',
    monstersDirectory: 'data/monsters',
    worldDirectory: 'data/world',
    mapName: 'world',
    loginProtocolPort: 7171,
    gameProtocolPort: 7172,
    maxPlayers: 200,
    scriptingEnabled: true,
    showScriptsLogInConsole: true,
    scriptErrorPolicy: 'abort',
    worldType: 'pvp',
    protectionLevel: 1,
    tickIntervalMs: 50,
    newPlayerLevel: 1,
    newPlayerHealth: 150,
    newPlayerCap: 400,
    newPlayerSpawnPos: { x: 100, y: 100, z: 7 },
    rateExperience: 1,
    rateSkill: 1,
    rateLoot: 1,
    rateSpawn: 1
};

/**
 * Carga la configuración.
 *
 * @param {string} filepath ruta de config.js
 * @param {Object} log
 * @returns {{config: Object, source: string|null, declaredKeys: number}}
 */
function load(filepath, log) {
    if (!fs.existsSync(filepath)) {
        log.warning('no se encontro ' + filepath + ': se usan los valores por defecto');
        return { config: { ...DEFAULTS }, source: null, declaredKeys: 0 };
    }

    // Se descarta la caché para que recargar la configuración funcione.
    delete require.cache[require.resolve(filepath)];

    const exported = require(filepath);

    if (!exported || typeof exported !== 'object' || Array.isArray(exported)) {
        throw new Error('config.js debe exportar un objeto de configuracion');
    }

    // El archivo gana sobre los valores por defecto, pero las claves que no
    // declare siguen teniendo un valor sensato.
    const config = { ...DEFAULTS, ...exported };

    return {
        config: config,
        source: filepath,
        declaredKeys: Object.keys(exported).length
    };
}

module.exports = { load, DEFAULTS };
