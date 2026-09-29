'use strict';

/**
 * Palanca que sube al jugador una planta.
 *
 * Un módulo de contenido es esto: un archivo `.js` que exporta una definición.
 * No hay función de registro que llamar, así que no hay forma de olvidarla —que
 * era un fallo silencioso en la versión con Lua: el script se cargaba sin error y
 * no hacía nada.
 *
 * La firma del handler es la de The Forgotten Server, verificada en su código:
 *
 *     onUse(player, item, fromPosition, target, toPosition, isHotkey)
 *
 * Se mantiene a propósito, aunque el lenguaje sea otro: quien ya sabe escribir un
 * datapack reconoce el patrón, y una firma inventada obliga a aprender de cero.
 */

module.exports = {
    type: 'action',

    // Acepta un número suelto o un array.
    ids: [1948],

    onUse(player, item, fromPosition, target, toPosition, isHotkey) {
        // getPosition() devuelve una COPIA: mutarla no mueve al jugador hasta
        // llamar a teleportTo. Así un script no puede mover a nadie por accidente
        // mientras consulta su posición.
        const destination = player.getPosition();
        destination.moveUpstairs();

        if (!player.teleportTo(destination)) {
            player.sendTextMessage('No puedes subir aqui.');
            return true;
        }

        player.sendTextMessage('Subes a ' + destination + '.');
        return true;
    }
};
