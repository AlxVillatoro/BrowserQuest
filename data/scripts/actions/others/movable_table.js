'use strict';

/**
 * Un paso que se abre: apartar lo que estorba deja la casilla libre.
 *
 * ESTE ES EL MÓDULO DE "LA PUERTA QUE SE ABRE", Y VA SOBRE UNA MESA POR UN MOTIVO. En este
 * catálogo NO HAY NINGÚN ID DE PUERTA —no existe el objeto, y `data/items/items.xml` está
 * fuera del ámbito de este archivo—, así que no se puede escribir una puerta que se abra
 * porque no hay puerta que colocar en el mapa. Lo que sí se puede escribir es LA MECÁNICA:
 * quitar de la casilla un objeto que bloquea el paso, con `item.remove()`.
 *
 * Y de los tres objetos del catálogo que bloquean el paso, se elige el 113:
 *
 *   - El 111 (stone wall) es el candidato obvio y el PEOR: en `data/world/ciudad.map.json`
 *     aparece 1515 veces y forma las murallas y las casas. Un muro que se puede usar para
 *     disolverlo convertiría la ciudad amurallada en un colador, y ese no es un efecto que
 *     se deba poder provocar de uno en uno.
 *   - El 113 (table) bloquea el paso (`blocksSolid` y `blocksPathfind`, mira items.xml) y
 *     aparece 7 veces, todas dentro de edificios. Apartar una mesa abre un hueco de verdad
 *     y no rompe la geometría del mapa.
 *
 * QUE LA CASILLA QUEDE LIBRE ES REAL Y COMPROBABLE: `Item.remove()` llama a
 * `world.removeItem`, y esa función quita el objeto DEL TILE además de la tabla de objetos
 * (está comentado en `engine/world/world.js`): si sólo lo borrara de la tabla, seguiría
 * dibujándose y bloqueando, que es justo el fallo que ese comentario dice que hay que
 * evitar.
 *
 * ES DE UN SOLO SENTIDO, y se dice en voz alta: no hay forma de REPONER un objeto en una
 * casilla desde el contenido. El motor sabe poner objetos en un tile
 * (`world.addItemToTile`), pero el contenido no lo alcanza, y `Game.createItem` crea la
 * instancia fuera de todo tile. Así que este paso se abre y no se cierra: quien lo escriba
 * en un mapa debe saberlo antes, no después.
 *
 * La firma es la de The Forgotten Server, con sus seis argumentos:
 *
 *     onUse(player, item, fromPosition, target, toPosition, isHotkey)
 */

module.exports = {
    type: 'action',

    ids: [113],   // table

    onUse(player, item, fromPosition, target, toPosition, isHotkey) {
        // `remove()` devuelve false cuando el motor no sabe QUÉ instancia se está usando
        // (llega un uid 0). Pasa de verdad: `dispatchAction` sólo recibe instancia si quien
        // despacha la pasa en el contexto, y sin instancia no hay nada que quitar. Decir
        // "apartada" y que la mesa siga bloqueando sería el peor de los dos mundos, así que
        // se mira el resultado y se avisa.
        if (!item.remove()) {
            player.sendTextMessage('No puedes apartar esto de aqui.');
            return true;
        }

        player.sendTextMessage('Apartas la mesa y el paso queda libre.');

        return true;
    }
};
