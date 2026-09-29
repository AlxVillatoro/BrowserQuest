'use strict';

/**
 * Duración del paso, con la fórmula real de Tibia.
 *
 * Está extraída del código de The Forgotten Server (`creature.cpp`), no
 * aproximada, porque es de esas cosas que "se sienten" mal cuando no coinciden:
 *
 *     calculatedStepSpeed = floor(857.36 * ln(speed / 2 + 261.29) - 4795.01 + 0.5)
 *     duration            = floor(1000 * groundSpeed / calculatedStepSpeed)
 *     stepDuration        = ceil(duration / 50) * 50
 *
 * La cuantización final a múltiplos de 50 ms es lo que produce los **umbrales de
 * velocidad** que nota cualquier jugador de Tibia: subir `speed` no siempre hace
 * nada, y de golpe saltas 50 ms. Si se ignorase, el movimiento se sentiría
 * continuo y ajeno.
 *
 * Valores verificados con la implementación de referencia:
 *   speed = 220, suelo normal  ->  550 ms por paso
 *
 * `groundSpeed` lo pone el suelo sobre el que se camina. El valor por defecto de
 * Tibia es 150, y hay suelos más lentos (arena, nieve, pantano).
 */

/** El tick del servidor. La duración del paso se cuantiza a este múltiplo. */
const TICK_MS = 50;

/** Velocidad del suelo por defecto, la de la mayoría de tiles de Tibia. */
const DEFAULT_GROUND_SPEED = 150;

/** Coste extra del movimiento en diagonal. */
const DIAGONAL_FACTOR = 3;

/** Coste extra de cambiar de planta (escaleras, rampas). */
const FLOOR_CHANGE_FACTOR = 2;

/**
 * La velocidad "calculada" de la criatura. Es monótona en `speed`, así que
 * ordena igual que la velocidad, pero no es lineal: de ahí la curva del juego.
 */
function calculatedStepSpeed(speed) {
    return Math.floor(857.36 * Math.log(speed / 2 + 261.29) - 4795.01 + 0.5);
}

/**
 * Cuántos milisegundos tarda un paso.
 *
 * @param {number} speed velocidad de la criatura
 * @param {Object} [options]
 * @param {number} [options.groundSpeed] velocidad del suelo (por defecto 150)
 * @param {boolean} [options.diagonal] si el paso es en diagonal
 * @param {boolean} [options.floorChange] si cambia de planta
 * @returns {number} duración en ms, múltiplo de 50
 */
function stepDuration(speed, options) {
    const settings = options || {};

    let groundSpeed = settings.groundSpeed === undefined
        ? DEFAULT_GROUND_SPEED
        : settings.groundSpeed;

    if (settings.diagonal) {
        groundSpeed *= DIAGONAL_FACTOR;
    }
    if (settings.floorChange) {
        groundSpeed *= FLOOR_CHANGE_FACTOR;
    }

    const calculated = calculatedStepSpeed(speed);
    if (calculated <= 0) {
        // Velocidades absurdamente bajas darían duración infinita o negativa.
        // Es mejor un valor grande y explícito que un NaN propagándose.
        return TICK_MS * 40;
    }

    const duration = Math.floor(1000 * groundSpeed / calculated);
    return Math.ceil(duration / TICK_MS) * TICK_MS;
}

/**
 * Umbrales: los tramos de `speed` que dan la misma duración de paso.
 *
 * Existe sobre todo para poder demostrar la cuantización. Un rango de velocidad
 * que no cambia la duración es invisible para el jugador, y saberlo evita perder
 * el tiempo ajustando `speed` en un punto muerto.
 *
 * @param {number} from
 * @param {number} to
 * @param {Object} [options] se pasa a stepDuration
 * @returns {Array<{from: number, to: number, duration: number}>}
 */
function speedBreakpoints(from, to, options) {
    const ranges = [];
    let current = null;

    for (let speed = from; speed <= to; speed += 1) {
        const duration = stepDuration(speed, options);

        if (current && current.duration === duration) {
            current.to = speed;
        } else {
            current = { from: speed, to: speed, duration: duration };
            ranges.push(current);
        }
    }

    return ranges;
}

/**
 * Velocidad necesaria para que el paso dure como mucho `targetMs`.
 * Devuelve null si no se alcanza dentro del rango explorado.
 */
function speedForDuration(targetMs, options) {
    const settings = options || {};
    const max = settings.maxSpeed || 2000;

    for (let speed = 1; speed <= max; speed += 1) {
        if (stepDuration(speed, options) <= targetMs) {
            return speed;
        }
    }
    return null;
}

module.exports = {
    TICK_MS,
    DEFAULT_GROUND_SPEED,
    DIAGONAL_FACTOR,
    FLOOR_CHANGE_FACTOR,
    calculatedStepSpeed,
    stepDuration,
    speedBreakpoints,
    speedForDuration
};
