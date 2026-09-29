'use strict';

/**
 * El peso, en las unidades de Tibia.
 *
 * Se guarda en CENTÉSIMAS DE ONZA —una moneda son 10, una espada 4200— porque es lo que
 * dicen los archivos de Tibia, y convertir en la frontera obliga a recordar en qué unidad
 * está cada número que se lee.
 *
 * La conversión a texto vive aquí y no en el cliente porque la usan los dos: el motor para
 * los mensajes del chat y el cliente para la barra del inventario. Dos formatos distintos
 * para el mismo número es como se acaba con "42,00 oz" en un sitio y "42 oz" en otro, y con
 * un jugador que no sabe si son lo mismo.
 */

/** Cuántas centésimas de onza tiene una onza. */
const UNITS_PER_OUNCE = 100;

/**
 * De centésimas de onza a texto.
 *
 * Siempre con dos decimales, incluso cuando son cero: "42.00 oz" y no "42 oz". Que todos
 * los pesos tengan la misma forma es lo que permite compararlos de un vistazo en una lista,
 * y una columna que a veces tiene decimales y a veces no se lee peor que una que siempre
 * los tiene.
 */
function formatWeight(units) {
    const value = Number(units) || 0;
    return (value / UNITS_PER_OUNCE).toFixed(2) + ' oz';
}

/** De onzas a centésimas, para escribir contenido a mano. */
function ouncesToUnits(ounces) {
    return Math.round((Number(ounces) || 0) * UNITS_PER_OUNCE);
}

module.exports = { formatWeight, ouncesToUnits, UNITS_PER_OUNCE };
