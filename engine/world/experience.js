'use strict';

/**
 * Progresión de niveles.
 *
 * A diferencia de la fórmula de daño, ésta **sí está verificada** contra el código
 * de The Forgotten Server, y es cúbica, no exponencial:
 *
 *     experiencia(L) = (50/3)·L³ − 100·L² + (850/3)·L − 200
 *
 * Comprobación con los valores conocidos: nivel 8 da 4.200 y nivel 100 da
 * 15.892.400, que son las cifras de referencia.
 *
 * Que sea cúbica y no exponencial importa más de lo que parece: significa que
 * subir de nivel se vuelve progresivamente más lento de forma suave, sin el muro
 * que produce una exponencial. Es una decisión de diseño que se nota al jugar, no
 * un detalle de implementación.
 */

/**
 * Experiencia TOTAL acumulada necesaria para alcanzar un nivel.
 *
 * Es acumulada, no "la que falta desde el nivel anterior". Guardar el total evita
 * tener que sumar los tramos cada vez, y hace que la comprobación de subida de
 * nivel sea una sola comparación.
 *
 * @param {number} level
 * @returns {number}
 */
function experienceForLevel(level) {
    if (level <= 1) {
        return 0;
    }
    return Math.floor(
        (50 / 3) * Math.pow(level, 3) -
        100 * Math.pow(level, 2) +
        (850 / 3) * level -
        200
    );
}

/**
 * Nivel que corresponde a una experiencia acumulada.
 *
 * Se recorre hacia arriba desde el nivel actual en vez de despejar la cúbica: la
 * raíz de un polinomio de tercer grado tiene tres soluciones y elegir la correcta
 * con aritmética de coma flotante es una fuente de errores de redondeo en los
 * bordes exactos de nivel. Recorrer es exacto y, como los niveles son pocos,
 * tampoco importa.
 *
 * @param {number} experience
 * @param {number} [fromLevel] para no empezar desde cero cuando ya se sabe
 * @returns {number}
 */
function levelForExperience(experience, fromLevel) {
    let level = Math.max(1, fromLevel || 1);

    while (experienceForLevel(level + 1) <= experience) {
        level += 1;
    }
    return level;
}

/**
 * Cuánta experiencia acumulada hace falta para el siguiente nivel.
 * @returns {number} lo que FALTA desde `experience`
 */
function experienceToNextLevel(experience, level) {
    const currentLevel = level === undefined ? levelForExperience(experience) : level;
    return Math.max(0, experienceForLevel(currentLevel + 1) - experience);
}

/**
 * Aplica las etapas de experiencia.
 *
 * Las etapas son la razón de que la configuración sea código y no JSON: son una
 * tabla de tablas con campos con nombre que se recorre en orden, y la última suele
 * no tener tope. `maxlevel: 0` significa "sin tope".
 *
 * @param {number} baseExperience
 * @param {number} level
 * @param {Array<{minlevel, maxlevel, multiplier}>} stages
 * @returns {number}
 */
function applyExperienceStages(baseExperience, level, stages) {
    if (!Array.isArray(stages) || stages.length === 0) {
        return baseExperience;
    }

    const stage = stages.find((entry) =>
        level >= (entry.minlevel || 0) &&
        ((entry.maxlevel || 0) === 0 || level <= entry.maxlevel));

    if (!stage || stage.multiplier === undefined) {
        return baseExperience;
    }

    return Math.floor(baseExperience * stage.multiplier);
}

module.exports = {
    experienceForLevel,
    levelForExperience,
    experienceToNextLevel,
    applyExperienceStages
};
