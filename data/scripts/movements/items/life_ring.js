'use strict';

/**
 * Anillo de espada al quitárselo: «un anillo que da vida» no da vida, y aquí se dice por qué.
 *
 * Va sobre el mismo id que `data/scripts/movements/items/sword_ring.js` (el 2376) pero con
 * OTRO evento: aquel cubre `equip` y este cubre `deequip`. No se pisan, porque el registro
 * indexa los movimientos por «evento:id» (mira `dispatchMovement` en
 * `engine/scripting/registry.js`), así que el 2376 puede tener un handler al ponérselo y
 * otro al quitárselo. Y hace falta: `onDeEquip` es la única firma del catálogo que no tenía
 * ningún módulo, y sin él no hay forma de comprobar que llega con los argumentos correctos.
 *
 * LA IDEA DE «UN ANILLO QUE DA VIDA» NO SE PUEDE ESCRIBIR, y no es una limitación de este
 * archivo: el contenido puede LEER la salud (`getHealth`, `getMaxHealth`) y no puede
 * escribirla —`heal(amount)` existe en `engine/world/creature.js` pero ningún envoltorio de
 * `engine/scripting/entities.js` lo expone—. Lo mismo que le pasa al sanador
 * (`data/npc/ciudad/sanador.js`) y a la poción (`actions/others/health_potion.js`).
 *
 * ASÍ QUE EL ANILLO HACE LO CONTRARIO DE PROMETER: al quitárselo demuestra que la vida no
 * dependía de él. Es un mensaje corto y es verdad, y la frase final no es un adorno: en este
 * motor lo puesto suma ataque y armadura y nada más, porque `world.recomputeEquipment` sólo
 * escribe `weaponAttack` y `armorLevel`. Ninguna línea del motor mete la salud en esa
 * cuenta.
 *
 * Vale el mismo aviso que en `plate_armor.js`: `deequip` se despacha por
 * `engine.dispatchMovement`, pero el servidor todavía no lo dispara, porque los únicos
 * enganches conectados en `engine/core/engine.js` son `stepin` y `stepout`.
 */

module.exports = {
    type: 'movement',
    event: 'deequip',

    ids: [2376],   // sword ring

    onDeEquip(player, item, slot, isCheck) {
        if (isCheck) {
            // Modo consulta: se pregunta si se puede quitar, no se está quitando.
            return true;
        }

        // El máximo se protege antes de dividir: el envoltorio de un jugador que ya no
        // está devuelve 0, y un cero en el divisor saca un "NaN%" por la pantalla.
        const salud = player.getHealth();
        const maxima = player.getMaxHealth() || 1;

        player.sendTextMessage('Te quitas ' + item.getName() + ' del slot ' + slot + '.');

        player.sendTextMessage('Tu vida sigue en ' + salud + '/' + maxima + ': en este ' +
            'motor lo que llevas puesto suma ataque y armadura, no salud.');

        return true;
    }
};
