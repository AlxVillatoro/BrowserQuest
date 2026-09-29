'use strict';

/**
 * Configuración del motor.
 *
 * Es un módulo de JavaScript, así que el objeto exportado **es** la
 * configuración: no hay un formato intermedio que parsear ni una lista de claves
 * que mantener sincronizada. Lo que exportes es lo que ve el motor.
 *
 * Y al ser código, admite lo que un JSON no:
 *
 *   - Tablas anidadas con campos con nombre (las etapas de experiencia).
 *   - Cálculos: `maxPlayers: base * 2`.
 *   - Condicionales sobre el entorno, que es lo que permite tener un solo
 *     archivo para desarrollo y producción.
 *
 * Lo que NO debe hacer: efectos secundarios al cargarse (abrir puertos, conectar
 * a una base de datos). La configuración se lee, no se ejecuta como programa.
 */

const ENTORNO = process.env.NODE_ENV || 'development';
const ES_DESARROLLO = ENTORNO !== 'production';

module.exports = {

    // -----------------------------------------------------------------------
    // Identidad
    // -----------------------------------------------------------------------
    serverName: 'Avillatoro',
    worldType: 'pvp',              // 'pvp' | 'no-pvp' | 'pvp-enforced'
    protectionLevel: 1,

    // -----------------------------------------------------------------------
    // Rutas
    //
    // El motor no asume ninguna disposición de carpetas: todo se declara aquí.
    // -----------------------------------------------------------------------
    dataDirectory: 'data',
    clientDirectory: 'client',

    itemsXml: 'data/items/items.xml',
    itemsOtb: 'data/items/items.otb',
    vocationsXml: 'data/XML/vocations.xml',
    outfitsXml: 'data/XML/outfits.xml',
    scriptsDirectory: 'data/scripts',
    monstersDirectory: 'data/monsters',
    worldDirectory: 'data/world',

    // Nombre del mapa, SIN extensión: el motor resuelve
    // `<worldDirectory>/<mapName>.map.json`. `mapFile` permite apuntar a un
    // archivo concreto y gana sobre `mapName` si está definido.
    mapName: 'sample',
    mapFile: null,

    // -----------------------------------------------------------------------
    // Red
    // -----------------------------------------------------------------------
    ip: '127.0.0.1',
    loginProtocolPort: 7171,
    gameProtocolPort: 7172,
    maxPlayers: ES_DESARROLLO ? 50 : 500,
    maxPacketsPerSecond: 50,

    // -----------------------------------------------------------------------
    // Scripting
    // -----------------------------------------------------------------------
    // Interruptor maestro. Con esto en false el motor arranca sin cargar ningún
    // script, que es lo que se quiere para medir el coste base del mundo.
    scriptingEnabled: true,

    // Muestra en consola cada módulo de contenido que se carga.
    showScriptsLogInConsole: true,

    // Si un módulo de contenido falla al cargarse: 'abort' detiene el arranque
    // (útil mientras se desarrolla, para no arrancar con medio datapack) o
    // 'skip' lo descarta y sigue.
    scriptErrorPolicy: 'abort',

    // -----------------------------------------------------------------------
    // Mundo
    // -----------------------------------------------------------------------
    defaultWorldLight: { level: 250, color: 215 },
    tickIntervalMs: 50,            // 20 Hz, el valor clásico de estos servidores

    // -----------------------------------------------------------------------
    // Jugador nuevo
    // -----------------------------------------------------------------------
    newPlayerLevel: 1,
    newPlayerHealth: 150,
    newPlayerMana: 0,
    newPlayerCap: 400,
    newPlayerSpawnPos: { x: 100, y: 100, z: 7 },
    newPlayerTownId: 1,

    // -----------------------------------------------------------------------
    // Rates
    // -----------------------------------------------------------------------
    rateExperience: 1,
    rateSkill: 1,
    rateLoot: 1,
    rateSpawn: 1,

    // -----------------------------------------------------------------------
    // Etapas de experiencia
    //
    // `maxlevel: 0` significa "sin tope". Es el ejemplo que justifica que esto
    // sea código y no datos planos: la última etapa no tiene límite superior, y
    // un JSON obligaría a inventar un número centinela y a documentarlo.
    // -----------------------------------------------------------------------
    experienceStages: [
        { minlevel: 1, maxlevel: 50, multiplier: 100 },
        { minlevel: 51, maxlevel: 100, multiplier: 50 },
        { minlevel: 101, maxlevel: 150, multiplier: 25 },
        { minlevel: 151, maxlevel: 0, multiplier: 10 }
    ]
};
