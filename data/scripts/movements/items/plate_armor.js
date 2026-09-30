'use strict';

/**
 * Armadura de placas: avisa de la armadura que suma al ponérsela.
 *
 * Existe para el otro extremo del catálogo: `data/scripts/movements/items/sword_ring.js`
 * cubre un anillo y este cubre una armadura de cuerpo, y los dos ejercitan la misma firma
 * de `equip`, que NO es la de `stepin`. Está verificada en el código de The Forgotten
 * Server:
 *
 *     equip / deequip     (player, item, slot, isCheck)
 *     stepin / stepout    (creature, item, position, fromPosition)
 *
 * EL NÚMERO NO SE ESCRIBE A MANO. Se lee el atributo `defense` del propio objeto con
 * `Game.getItemAttribute`, así que el día que `data/items/items.xml` cambie el 10 por otro
 * número, este mensaje cambia solo. Y es `defense` y no `armor` a propósito: en el
 * `items.xml` de Tibia una armadura de cuerpo declara `armor`, pero aquí el único sitio que
 * recalcula lo que aporta lo puesto es `world.recomputeEquipment`, y ese lee `defense`
 * (está explicado largo en el bloque de armaduras de `data/items/items.xml`). Leer aquí
 * `armor` daría un mensaje que promete una defensa que el motor no suma.
 *
 * `isCheck` ES EL MODO CONSULTA, y se respeta: en ese modo el motor pregunta si se puede
 * equipar, sin llegar a hacerlo, así que anunciar el cambio sería anunciar algo que todavía
 * no ha pasado.
 *
 * UN AVISO SOBRE CUÁNDO SE EJECUTA ESTO. Los únicos enganches que `engine/core/engine.js`
 * conecta al mundo son `stepin` y `stepout`; `equip` y `deequip` están registrados y se
 * despachan por `engine.dispatchMovement`, pero nada en el servidor los dispara todavía —
 * equipar un objeto en el juego no pasa por aquí—. Se dice para que nadie busque en este
 * archivo por qué no se lee el mensaje al ponerse la armadura.
 */

module.exports = {
    type: 'movement',
    event: 'equip',

    ids: [2408],   // plate armor

    onEquip(player, item, slot, isCheck) {
        if (isCheck) {
            // Sólo se está consultando: no hay que anunciar nada todavía.
            return true;
        }

        // El id sale del propio objeto y no del literal 2408: si alguien añade otro id a
        // `ids`, el atributo que se lee sigue siendo el del objeto que se está poniendo.
        const armadura = Game.getItemAttribute(item.getId(), 'defense');

        player.sendTextMessage('Te pones ' + item.getName() + ' en el slot ' + slot + '.');

        if (typeof armadura === 'number') {
            player.sendTextMessage('Suma ' + armadura + ' de armadura. El motor la recalcula ' +
                'al ponerla y al quitarla, asi que no se queda pegada.');
        }

        return true;
    }
};
