'use strict';

/**
 * Anillo de espada: avisa al equiparlo.
 *
 * Existe para ejercitar la firma de `equip`, que NO es la misma que la de
 * `stepin`. Está verificado en el código de The Forgotten Server:
 *
 *     equip / deequip   (player, item, slot, isCheck)
 *     stepin / stepout  (creature, item, position, fromPosition)
 *
 * `isCheck` es el modo consulta: el motor pregunta si se puede equipar, sin
 * llegar a hacerlo. Un handler que lo ignore puede permitir equipar cosas que no
 * debería, así que se recibe explícitamente en vez de esconderlo.
 */

module.exports = {
    type: 'movement',
    event: 'equip',
    ids: [2376],   // sword ring

    onEquip(player, item, slot, isCheck) {
        if (isCheck) {
            // Sólo se está consultando: no hay que anunciar nada todavía.
            return true;
        }

        player.sendTextMessage('Te pones ' + item.getName() + ' en el slot ' + slot + '.');
        return true;
    }
};
