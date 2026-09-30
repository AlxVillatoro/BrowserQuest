'use strict';

/**
 * Cofre de un solo uso: recuerda que ya lo abriste, y comprueba si el premio cabría.
 *
 * Va sobre el 2412 porque es el ÚNICO objeto del catálogo que declara `isContainer`
 * (mira `data/items/items.xml`): no hay ningún id de cofre en este catálogo, y
 * `data/items/items.xml` está fuera del ámbito de este archivo, así que se escribe sobre
 * lo más parecido a un contenedor que existe. El día que haya un id de cofre, este módulo
 * se cambia de `ids` y no hay nada más que tocar.
 *
 * LO QUE SÍ HACE, que es la mitad que existe:
 *
 *   - MEMORIA. `setStorageValue`/`getStorageValue` son la API de TFS para que el contenido
 *     recuerde algo, y aquí recuerdan que este jugador ya abrió el cofre. El almacén es POR
 *     PERSONAJE (vive en `player.storages`), así que es "una vez por jugador" y no "una vez
 *     en el mundo", que es como funcionan los cofres de misión de Tibia. Y se guarda en el
 *     mundo, no en disco al momento: el guardado periódico lo baja.
 *   - LA COMPROBACIÓN. `getItemWeight` y `getFreeCapacity` SÍ existen, así que el cofre
 *     puede decir si el premio cabría. Es la única mitad de la entrega que se puede hacer.
 *
 * LO QUE NO HACE, Y ES LA OTRA MITAD: NO PUEDE ENTREGAR EL OBJETO. `world.giveItem` existe
 * (`engine/world/world.js`), pero el envoltorio del jugador no lo expone —mira
 * `engine/scripting/entities.js`—, así que desde un módulo de contenido no hay forma de
 * meter nada en el inventario de nadie. Y `Game.createItem` no sirve de recambio:
 * `engine/scripting/game.js` lo llama con `position` a null, así que crea una instancia que
 * no queda en ningún tile —ni en el suelo ni en la mochila—: un objeto que existe y no se
 * puede ver ni coger. Se dice aquí, en vez de escribir un `giveItem` que no existe y dejar
 * un cofre que promete y no da.
 *
 * ASÍ QUE EL COFRE HACE LO HONESTO: dice qué había dentro, lo recuerda, avisa de si
 * cabría, y no finge haberlo entregado. El mensaje al jugador NO habla de envoltorios ni de
 * funciones: el jugador no tiene por qué saber que existe `entities.js`.
 *
 * La firma es la de The Forgotten Server, con sus seis argumentos:
 *
 *     onUse(player, item, fromPosition, target, toPosition, isHotkey)
 */

/** El premio que declara el cofre. Es un id del catálogo, no un número inventado. */
const PREMIO = 2400;   // magic sword

/**
 * La clave del almacén. Se escribe una vez y se usa en los dos sitios: con la cadena
 * repetida a mano, un cambio en una línea y no en la otra convertiría el cofre en un pozo
 * sin fondo que da premio cada vez.
 */
const CLAVE = 'cofre:mochila_abierto';

module.exports = {
    type: 'action',

    ids: [2412],   // backpack: el único `isContainer` del catálogo

    onUse(player, item, fromPosition, target, toPosition, isHotkey) {
        // El segundo uso en adelante. Se comprueba con `!== null` y no con la verdad del
        // valor: un almacén que valga 0 es una respuesta guardada, y preguntar por la
        // verdad lo confundiría con "nunca se guardó".
        if (player.getStorageValue(CLAVE) !== null) {
            player.sendTextMessage('El cofre esta vacio: ya lo abriste.');
            return true;
        }

        player.setStorageValue(CLAVE, 1);

        player.sendTextMessage('Abres el cofre. Dentro hay ' + Game.getItemName(PREMIO) + '.');

        // El peso llega en CENTÉSIMAS de onza (está escrito en el comentario de
        // `getWeight` en `engine/scripting/entities.js`), así que se pasa a onzas para que
        // el número se pueda leer: "4200" no dice nada, "42.00 oz" sí.
        const pesoOnzas = (player.getItemWeight(PREMIO, 1) / 100).toFixed(2);
        const libreOnzas = (player.getFreeCapacity() / 100).toFixed(2);

        player.sendTextMessage('Pesa ' + pesoOnzas + ' oz y te quedan ' + libreOnzas +
            ' oz libres.');

        // El cofre NO lo entrega, y se dice sin rodeos técnicos: lo que el jugador ve es
        // que el objeto sigue dentro.
        player.sendTextMessage('Pero no puedo sacarlo: el objeto se queda dentro.');

        return true;
    }
};
