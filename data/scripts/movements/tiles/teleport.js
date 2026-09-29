'use strict';

/**
 * Portal: avisa al pisarlo.
 *
 * El tipo de evento lo declara `event`, y de él sale el nombre del handler:
 * `stepin` busca `onStepIn`. En TFS es igual, y así un mismo archivo puede
 * declarar varios tipos sin nombres inventados.
 *
 * Ojo con la firma, que CAMBIA según el tipo de evento (está verificado en el
 * código de TFS, no es una suposición):
 *
 *     stepin / stepout    (creature, item, position, fromPosition)
 *     equip / deequip     (player, item, slot, isCheck)
 *     additem / removeitem(moveitem, tileitem, position)
 *
 * Pasar los argumentos de un tipo a otro produce un handler que recibe basura
 * sin dar ningún error, así que conviene tenerlo presente.
 */

module.exports = {
    type: 'movement',
    event: 'stepin',
    ids: [1387],

    onStepIn(creature, item, position, fromPosition) {
        if (!creature) {
            return false;
        }

        creature.sendTextMessage('Un portal te absorbe.');
        return true;
    }
};
