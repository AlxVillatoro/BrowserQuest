'use strict';

/**
 * Comando `/stats`: los números del jugador y los del mundo, en un sitio.
 *
 * POR QUÉ EXISTE SI YA ESTÁ `/pos`. `/pos` contesta la pregunta "dónde estoy": posición,
 * vida, nivel y vocación. Este contesta "cómo voy", que es otra pregunta y lleva otros
 * números: el peso y la capacidad —que son la razón por la que no se puede recoger algo—, el
 * dinero, cuántas cosas se llevan, y en qué mundo se está. Son los datos con los que se
 * decide volver a la ciudad o seguir bajando a la mina.
 *
 * EL PESO VA CON SU TEXTO YA FORMATEADO (`getWeightText` / `getCapacityText`) y no como
 * número crudo: por dentro el peso va en centésimas de onza —mira el comentario de
 * `getWeight` en `engine/scripting/entities.js`—, y dividir entre cien en cada script es
 * cómo se acaba con dos scripts que dividen distinto. El motor ya tiene esa cuenta hecha en
 * un solo sitio.
 *
 * EL MUNDO SE PREGUNTA AL MOTOR, no se escribe a mano: `Game.getMapInfo()` devuelve el
 * informe del mapa cargado (nombre, tamaño, waypoints, spawns) y `null` si no hay mapa. Un
 * "ciudad" escrito aquí sería mentira en cuanto se cambiara `mapName` en `config.js`.
 *
 * La firma es la de TFS y tiene CUATRO argumentos:
 *
 *     onSay(player, words, param, type)
 *
 * `param` y `type` no se usan en este comando, y se reciben igual: el canal (`type`) es un
 * dato que el motor manda y que un comando puede querer mirar, y recortar la firma es
 * romper el contrato aunque hoy no haga falta el argumento.
 */

module.exports = {
    type: 'talkaction',
    words: '/stats',

    onSay(player, words, param, type) {
        const salud = player.getHealth();
        const maxima = player.getMaxHealth() || 1;
        const porcentaje = Math.round(salud * 100 / maxima);

        player.sendTextMessage('Nivel ' + player.getLevel() +
            ', vocacion ' + player.getVocation() +
            ', en ' + player.getPosition() + '.');

        // El porcentaje se calcula aquí porque lo que el cliente dibuja es una barra: el
        // número solo dice algo comparado con el máximo.
        player.sendTextMessage('Vida ' + salud + ' de ' + maxima +
            ' (' + porcentaje + '%).');

        player.sendTextMessage('Peso ' + player.getWeightText() +
            ' de ' + player.getCapacityText() + '.');

        player.sendTextMessage('Llevas ' + player.getItemCount() +
            ' cosa(s) y ' + player.getMoney() + ' de dinero.');

        const mapa = Game.getMapInfo();
        if (mapa) {
            player.sendTextMessage('Mundo ' + mapa.name + ' (' + mapa.size + '): ' +
                mapa.waypoints + ' waypoints, ' + mapa.spawns + ' spawns, ' +
                mapa.npcs + ' npcs colocados.');
        } else {
            // Sin mapa no hay waypoints ni spawns, y decirlo es más útil que imprimir ceros
            // como si fueran un mundo vacío.
            player.sendTextMessage('No hay ningun mapa cargado.');
        }

        return true;
    }
};
