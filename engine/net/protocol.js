'use strict';

/**
 * El protocolo, del lado del motor.
 *
 * El archivo de verdad está en `shared/js/protocol.mjs`, porque lo usan el motor y
 * el cliente y tiene que ser EL MISMO: dos copias de una tabla de opcodes se
 * separan en cuanto alguien toca una, y el fallo que produce —un mensaje que el
 * cliente interpreta como otro distinto— se busca durante horas.
 *
 * Esto es sólo un puente para que los módulos del motor sigan escribiendo
 * `require('./protocol')` sin tener que saber dónde vive el archivo compartido. La
 * redirección está aquí, en un solo sitio, y no repartida por todo el motor.
 *
 * Funciona porque Node admite `require()` de un módulo ES desde la versión 22,
 * siempre que no tenga `await` de nivel superior.
 */

module.exports = require('../../shared/js/protocol.mjs');
