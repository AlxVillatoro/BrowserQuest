'use strict';

/**
 * Los aspectos de una criatura.
 *
 * Un aspecto son cinco números: qué conjunto de sprites se usa y de qué colores.
 * Nada más. Todo lo demás —los sprites, la paleta— vive en el cliente, porque es
 * quien tiene los assets.
 *
 * POR QUÉ LOS COLORES SE ACOTAN AQUÍ. Los colores llegan del CLIENTE: un jugador
 * escribe `/outfit 136 300 300 300 -5` y esos números viajan al motor. Si se
 * guardaran tal cual, el cliente recibiría un índice 300 para una paleta de 133
 * colores y tendría que defenderse él, que es justo lo contrario del reparto que
 * sostiene todo esto: **el motor valida y el cliente dibuja**. Un motor que deja
 * pasar datos imposibles obliga a cada cliente a desconfiar del suyo, y a la larga
 * cada uno se defiende como puede y las apariencias acaban discrepando.
 *
 * LA PALETA ES DEL CLIENTE, y por eso aquí sólo se acota el RANGO y no se comprueba
 * qué color es cada índice. El motor no necesita saber que el 78 es un azul; le basta
 * con saber que existe un 78 y que no existe un 300.
 */

/** Cuántos colores tiene la paleta de Tibia. El cliente es quien los tiene. */
const PALETTE_SIZE = 133;

/** Los añadidos son dos, y viajan como una máscara de bits: 1, 2 o 3. */
const MAX_ADDONS = 3;

/**
 * El aspecto por defecto de un personaje nuevo.
 *
 * El 136 es el Druida en la numeración de Tibia, y los colores son los de un personaje
 * recién creado. La correspondencia exacta entre el 136 y un juego de sprites la fija
 * el `.dat` del cliente: si al enchufar assets reales no cuadra, se cambia aquí.
 */
const DEFAULT_OUTFIT = {
    lookType: 136,
    head: 78,
    body: 69,
    legs: 58,
    feet: 115,
    addons: 0
};

/** Acota un número a un rango, con un valor por defecto si no es un número. */
function clamp(value, min, max, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

/**
 * Normaliza un aspecto: todo lo que no esté en su rango se ajusta.
 *
 * No lanza. Un aspecto con un color imposible NO es un error que deba tumbar nada: se
 * corrige y se sigue. Es la misma decisión que en el movimiento, donde caminar contra
 * una pared no es un error sino algo que simplemente no ocurre.
 */
function normalizeOutfit(outfit) {
    const source = outfit || {};

    const lookType = clamp(source.lookType, 0, 0xFFFF,
        source.lookType === undefined ? DEFAULT_OUTFIT.lookType : 0);

    return {
        lookType: lookType,
        head: clamp(source.head, 0, PALETTE_SIZE - 1, DEFAULT_OUTFIT.head),
        body: clamp(source.body, 0, PALETTE_SIZE - 1, DEFAULT_OUTFIT.body),
        legs: clamp(source.legs, 0, PALETTE_SIZE - 1, DEFAULT_OUTFIT.legs),
        feet: clamp(source.feet, 0, PALETTE_SIZE - 1, DEFAULT_OUTFIT.feet),
        addons: clamp(source.addons, 0, MAX_ADDONS, 0)
    };
}

/** ¿Lleva puesto ese añadido? */
function hasAddon(outfit, addonId) {
    const id = Number(addonId);
    if (id < 1 || id > 2) {
        return false;
    }
    return ((outfit && outfit.addons ? outfit.addons : 0) & (1 << (id - 1))) !== 0;
}

/**
 * Pone o quita un añadido.
 *
 * Devuelve un aspecto NUEVO: mutar el que llega haría que dos criaturas que comparten
 * aspecto se cambiaran la una a la otra sin que nadie lo pidiera.
 */
function withAddon(outfit, addonId, enabled) {
    const normalized = normalizeOutfit(outfit);
    const id = Number(addonId);

    if (id < 1 || id > 2) {
        return normalized;
    }

    const bit = 1 << (id - 1);
    normalized.addons = enabled === false
        ? (normalized.addons & ~bit)
        : (normalized.addons | bit);

    return normalized;
}

/** Los añadidos puestos, como lista. */
function addonList(outfit) {
    const list = [];
    if (hasAddon(outfit, 1)) {
        list.push(1);
    }
    if (hasAddon(outfit, 2)) {
        list.push(2);
    }
    return list;
}

/**
 * Comprueba que un aspecto existe y se puede usar.
 *
 * @param {Object} outfit ya normalizado
 * @param {Map<number, Object>} outfitTypes lo cargado de outfits.xml
 * @param {boolean} [isPremium] si la cuenta es premium
 * @returns {{ok: boolean, reason: string|null}}
 */
function canUseOutfit(outfit, outfitTypes, isPremium) {
    if (!outfitTypes || outfitTypes.size === 0) {
        // Sin definiciones no se puede comprobar nada, y negarse a todo dejaría el
        // servidor sin aspectos por un archivo que falta.
        return { ok: true, reason: null };
    }

    const definition = outfitTypes.get(Number(outfit.lookType));

    if (!definition) {
        return { ok: false, reason: 'no existe el aspecto ' + outfit.lookType };
    }
    if (!definition.unlocked) {
        return { ok: false, reason: 'el aspecto "' + definition.name + '" esta bloqueado' };
    }
    if (definition.premium && !isPremium) {
        return { ok: false, reason: 'el aspecto "' + definition.name + '" es premium' };
    }

    // Un añadido que el aspecto no tiene definido no se puede poner, aunque la máscara
    // de bits diga que sí. Sin esta comprobación, un cliente podría ponerse el añadido
    // 2 de un aspecto que sólo tiene uno y el sprite saldría descuadrado.
    const requested = addonList(outfit);
    for (const addonId of requested) {
        if (!definition.addons.has(addonId)) {
            return {
                ok: false,
                reason: 'el aspecto "' + definition.name + '" no tiene el anadido ' + addonId
            };
        }
    }

    return { ok: true, reason: null };
}

module.exports = {
    DEFAULT_OUTFIT,
    PALETTE_SIZE,
    MAX_ADDONS,
    normalizeOutfit,
    hasAddon,
    withAddon,
    addonList,
    canUseOutfit
};
