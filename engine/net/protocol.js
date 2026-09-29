'use strict';

/**
 * El protocolo: lo único que hay entre el motor y el cliente.
 *
 * Es la frontera que hace real la separación de responsabilidades. El cliente no
 * tiene el mapa, ni los items, ni las reglas: tiene un lienzo y una lista de cosas
 * que dibujar. Todo lo que sabe del mundo se lo ha dicho el motor por aquí, y si
 * algo no viaja en un mensaje, el cliente no puede saberlo.
 *
 * SOBRE LA NUMERACIÓN. Los opcodes del cliente para caminar y girar (0x64 a 0x6B)
 * son los de Tibia, porque son los que están documentados y no hay razón para
 * inventar otros. El resto son nuestros, en rangos separados por dirección para
 * que un mensaje enviado al revés se detecte solo. Y conviene decirlo claro: **el
 * transporte es JSON sobre WebSocket, no el protocolo binario de Tibia**. Copiar
 * los números no da compatibilidad; darla exigiría XTEA, el handshake RSA y el
 * formato binario exacto de cada mensaje, que es un trabajo aparte y con otro
 * objetivo.
 *
 * SOBRE LOS NOMBRES. Cada opcode tiene nombre, y el servidor puede registrar los
 * mensajes en claro para depurar. Un protocolo numérico sin tabla de nombres es
 * imposible de depurar cuando algo no cuadra.
 */

// ---------------------------------------------------------------------------
// Servidor -> cliente
// ---------------------------------------------------------------------------

const SERVER = {
    /** Saludo inicial: versión del protocolo y tamaño del mundo. */
    HELLO: 0x01,

    /** Login aceptado: los datos del jugador y su posición. */
    LOGIN_OK: 0x02,

    /** Login rechazado, con el motivo. */
    LOGIN_ERROR: 0x03,

    /** Aparece un tile que el cliente no tenía. */
    TILE_ADD: 0x10,

    /** Un tile que el cliente ya tenía ha cambiado (se reemplaza entero). */
    TILE_UPDATE: 0x11,

    /** Un tile sale de la vista. */
    TILE_REMOVE: 0x12,

    /** Aparece una criatura. */
    CREATURE_ADD: 0x20,

    /**
     * Una criatura se mueve.
     *
     * Lleva la DURACIÓN del paso en milisegundos, y ese es el detalle que hace que
     * el 2.5D se sienta bien: el cliente interpola el desplazamiento durante
     * exactamente el tiempo que el motor calculó con la fórmula de Tibia. Si el
     * cliente eligiera la duración por su cuenta, el muñeco iría a un ritmo
     * distinto del que el motor considera real y el desfase se vería en cada paso.
     */
    CREATURE_MOVE: 0x21,

    /** Una criatura sale de la vista. */
    CREATURE_REMOVE: 0x22,

    /**
     * Cambia el estado visible de una criatura: su dirección y su salud.
     *
     * Van juntos en un solo mensaje porque los dos son "lo mismo": información de
     * una criatura que no es su posición. Separarlos obligaría a dos mensajes cada
     * vez que alguien recibe un golpe y se gira, que es casi siempre.
     */
    CREATURE_UPDATE: 0x23,

    /** La criatura dice algo. */
    CREATURE_SAY: 0x24,

    /** Mensaje de texto al jugador. */
    TEXT: 0x30,

    /** Las estadísticas del jugador (nivel, experiencia, salud, maná). */
    PLAYER_STATS: 0x31,

    /** El jugador ha muerto. */
    PLAYER_DEATH: 0x32,

    /** Cambio de planta: el cliente debe redibujar todo. */
    FLOOR_CHANGE: 0x40,

    /**
     * Latido del servidor: el instante del motor y cuántos mensajes se enviaron.
     * Sirve para que el cliente pueda medir su latencia y para saber que la
     * conexión sigue viva aunque no pase nada.
     */
    PING: 0x50
};

// ---------------------------------------------------------------------------
// Cliente -> servidor
// ---------------------------------------------------------------------------

const CLIENT = {
    /**
     * Caminar. Los ocho opcodes son los de Tibia: 0x64 a 0x67 los cuatro pasos
     * rectos y 0x68 a 0x6B las cuatro diagonales.
     *
     * El cliente PIDE el paso; no lo da. Si el motor lo rechaza, no pasa nada y
     * no hay mensaje de vuelta, porque caminar contra una pared es normal y no un
     * error que merezca una respuesta.
     */
    WALK_NORTH: 0x64,
    WALK_EAST: 0x65,
    WALK_SOUTH: 0x66,
    WALK_WEST: 0x67,
    WALK_NORTH_EAST: 0x68,
    WALK_SOUTH_EAST: 0x69,
    WALK_SOUTH_WEST: 0x6A,
    WALK_NORTH_WEST: 0x6B,

    /** Girar sin moverse. */
    TURN_NORTH: 0x6C,
    TURN_EAST: 0x6D,
    TURN_SOUTH: 0x6E,
    TURN_WEST: 0x6F,

    /** Decir algo. */
    SAY: 0x96,

    /** Usar un item del suelo. */
    USE_ITEM: 0x82,

    /** Mirar algo. */
    LOOK: 0x8C,

    /** Atacar a una criatura. */
    ATTACK: 0x8A,

    /** El cliente ya terminó de cargar y quiere entrar al mundo. */
    ENTER_WORLD: 0x0F,

    /** Desconexión ordenada. */
    LOGOUT: 0x14
};

/** Desplazamiento de cada opcode de caminar. */
const WALK_OFFSETS = {
    [CLIENT.WALK_NORTH]: { x: 0, y: -1 },
    [CLIENT.WALK_EAST]: { x: 1, y: 0 },
    [CLIENT.WALK_SOUTH]: { x: 0, y: 1 },
    [CLIENT.WALK_WEST]: { x: -1, y: 0 },
    [CLIENT.WALK_NORTH_EAST]: { x: 1, y: -1 },
    [CLIENT.WALK_SOUTH_EAST]: { x: 1, y: 1 },
    [CLIENT.WALK_SOUTH_WEST]: { x: -1, y: 1 },
    [CLIENT.WALK_NORTH_WEST]: { x: -1, y: -1 }
};

/** Dirección de cada opcode de girar. */
const TURN_DIRECTIONS = {
    [CLIENT.TURN_NORTH]: 0,
    [CLIENT.TURN_EAST]: 1,
    [CLIENT.TURN_SOUTH]: 2,
    [CLIENT.TURN_WEST]: 3
};

// ---------------------------------------------------------------------------
// Tabla de nombres, para depurar
// ---------------------------------------------------------------------------

const NAMES = {};
Object.keys(SERVER).forEach((name) => { NAMES[SERVER[name]] = 'S:' + name; });
Object.keys(CLIENT).forEach((name) => { NAMES[CLIENT[name]] = 'C:' + name; });

/** El nombre de un opcode, para los registros. */
function opcodeName(code) {
    return NAMES[code] || ('0x' + Number(code).toString(16));
}

/** Versión del protocolo. Se comprueba en el saludo. */
const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Constructores de mensajes
// ---------------------------------------------------------------------------

/**
 * Los mensajes son arrays `[opcode, ...datos]` y no objetos con nombres.
 *
 * Un array gasta bastante menos que `{"opcode":16,"x":100,...}`, y en un juego
 * donde el mapa se reenvía al caminar eso se nota. El precio es que hay que mirar
 * la tabla para saber qué es cada posición, y por eso la tabla existe y por eso el
 * servidor puede registrar los mensajes en claro.
 */
function message(opcode, ...payload) {
    return [opcode, ...payload];
}

/**
 * Describe un tile para el cliente.
 *
 * El orden de `items` es el de DIBUJO, no el de almacenamiento: el cliente los
 * pinta en el orden en que llegan y así no necesita saber nada de bandas de
 * apilado. Esa es exactamente la clase de decisión que no debe estar en el
 * cliente.
 */
function describeTile(tile, ground, options) {
    const opts = options || {};
    const items = [];

    const groundId = tile && tile.ground ? tile.ground.typeId
        : (ground ? ground.typeId : 0);

    if (tile) {
        tile.downItems.forEach((item) => {
            items.push([item.typeId, item.count, item.instanceId || 0]);
        });
        tile.topItems.forEach((item) => {
            items.push([item.typeId, item.count, item.instanceId || 0]);
        });
    }

    return [groundId, items.length].concat(
        items.reduce((flat, entry) => flat.concat(entry), [])
    );
}

/** Describe una criatura para el cliente. */
function describeCreature(creature) {
    return [
        creature.id,
        0,                                   // hueco: tipo de aspecto (outfit), pendiente
        creature.name,
        creature.position.x,
        creature.position.y,
        creature.position.z,
        creature.direction,
        healthPercent(creature),
        creature.isPlayer() ? 0 : 1
    ];
}

/** Salud en porcentaje, que es lo que dibuja la barra. */
function healthPercent(creature) {
    if (!creature.maxHealth) {
        return 100;
    }
    return Math.max(0, Math.min(100,
        Math.round((creature.health / creature.maxHealth) * 100)));
}

module.exports = {
    SERVER,
    CLIENT,
    NAMES,
    WALK_OFFSETS,
    TURN_DIRECTIONS,
    PROTOCOL_VERSION,
    opcodeName,
    message,
    describeTile,
    describeCreature,
    healthPercent
};
