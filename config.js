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

    // ==========================================================================
    // Lo que el motor le ENVÍA a cada jugador
    // ==========================================================================
    // `viewWidth` y `viewHeight` son el área visible en tiles. Enviar de más gasta
    // ancho de banda en cada paso; enviar de menos hace que el jugador vea el borde
    // del mundo al caminar. El cliente de Tibia usa 15x11 para el mapa, y aquí se
    // usa algo mayor para que el desplazamiento no muestre costuras.
    viewWidth: 18,
    viewHeight: 14,

    // Plantas que se envían por DEBAJO y por ENCIMA de la actual. NO es lo mismo
    // que la visibilidad de juego: aquélla decide a quién puedes ver, y ésta qué se
    // dibuja. Enviar las ocho plantas de superficie que la regla de juego permite
    // sería ocho veces el tráfico para dibujar una sola.
    //
    // Dos abajo es lo que hace falta para ver el fondo de un desnivel; una arriba,
    // para que el borde de un tejado no desaparezca al pasar por debajo. El número
    // exacto hay que ajustarlo cuando exista el renderer.
    viewFloorsBelow: 2,
    viewFloorsAbove: 1,

    // -----------------------------------------------------------------------
    // Red
    // -----------------------------------------------------------------------
    ip: '127.0.0.1',
    loginProtocolPort: 7171,
    gameProtocolPort: 7172,

    // Puerto del servidor de juego nuevo. Se separa de los dos de arriba, que son
    // los de Tibia y hoy sólo sirven de referencia: el motor nuevo habla JSON
    // sobre WebSocket, no el protocolo binario, así que no puede compartir puerto
    // con nada que espere aquél.
    enginePort: 8080,
    maxPlayers: ES_DESARROLLO ? 50 : 500,
    maxPacketsPerSecond: 50,

    // -----------------------------------------------------------------------
    // Persistencia
    // -----------------------------------------------------------------------
    //
    // Se puede APAGAR, y sirve para dos cosas: arrancar el motor sin dejar archivos
    // por el repositorio, y poder probar el juego sin crear una cuenta. Con la
    // persistencia apagada los personajes son efímeros: viven lo que vive el
    // proceso.
    useDatabase: true,
    databaseFile: 'data/avillatoro.db',

    // Crea la cuenta sola si no existe, con la contraseña que mande el cliente.
    //
    // ES UNA COMODIDAD DE DESARROLLO Y ES INSEGURO: cualquiera que se conecte puede
    // crearse una cuenta. En un servidor de verdad las cuentas se crean desde una
    // web, como en Tibia, y esto se pone en false. Se deja activo porque lo
    // contrario obliga a crear cuentas a mano antes de poder probar nada.
    autoCreateAccounts: true,

    // Cada cuánto se guardan los jugadores que están dentro. Entre guardado y
    // guardado se pierde lo que haya pasado, así que cuanto más corto, menos se
    // pierde y más se escribe. Un minuto es el equilibrio que usa cualquier servidor
    // de este tamaño. Al desconectar y al apagar SIEMPRE se guarda.
    autosaveIntervalMs: 60000,

    // -----------------------------------------------------------------------
    // Muerte del jugador
    // -----------------------------------------------------------------------
    //
    // Sin castigo, morir no cuesta nada y el combate deja de tener tensión. Estas dos
    // son las que hacen que importe no morir, y son las de Tibia.
    //
    // El inventario se suelta en el sitio donde cayó, lo que convierte llevar cosas
    // encima en una decisión. Para un servidor de pruebas es molesto, así que se puede
    // apagar.
    deathLosePercent: 10,
    deathDropInventory: true,

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
