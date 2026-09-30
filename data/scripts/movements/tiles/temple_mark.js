'use strict';

/**
 * Marca en el suelo: la casilla que devuelve al templo.
 *
 * Va sobre el rango 1950-1954 (`footprint`), que es lo más parecido a una casilla marcada
 * que hay en el catálogo, y además está puesto en el mapa: `data/world/ciudad.map.json`
 * coloca 12 de estos. El templo NO se escribe con coordenadas a mano: se lee del mapa con
 * `Game.getWaypoint('temple')`, y ambos mapas lo declaran (el de la ciudad en 71,48,7 y el
 * de ejemplo en 40,40,7). Escribir aquí un (71, 48, 7) funcionaría en un mapa y mandaría a
 * la nada en el otro, y un destino copiado es el dato que peor envejece.
 *
 * OJO CON LA FIRMA, que es la de `stepin` y NO la de `equip` (está verificada en el código
 * de The Forgotten Server, y en el comentario de `data/scripts/movements/tiles/teleport.js`
 * están las dos):
 *
 *     stepin / stepout    (creature, item, position, fromPosition)
 *     equip / deequip     (player, item, slot, isCheck)
 *
 * QUIEN PISA PUEDE NO SER UN JUGADOR, y por eso se comprueba `isPlayer()` antes de mover a
 * nadie. `dispatchMovement` envuelve como monstruo a todo el que no sea jugador (mira
 * `EntityFactory.creature` en `engine/scripting/entities.js`), y `teleportTo` sólo existe en
 * el envoltorio del jugador: llamarlo sobre un monstruo no daría un aviso, daría un
 * TypeError que el registro captura y apunta como error del módulo. Un monstruo que pase
 * por encima de la marca no tiene por qué romper nada.
 */

module.exports = {
    type: 'movement',
    event: 'stepin',

    // El rango entero: los cinco ids son la misma definición en items.xml.
    ids: [1950, 1951, 1952, 1953, 1954],

    onStepIn(creature, item, position, fromPosition) {
        if (!creature || !creature.isPlayer()) {
            return false;
        }

        const templo = Game.getWaypoint('temple');
        if (!templo) {
            // Un mapa sin templo es un mapa raro, pero no imposible: el de ejemplo y el de
            // la ciudad lo tienen, y cualquier otro mapa que no lo declare llegaría aquí.
            creature.sendTextMessage('La marca tira de ti, pero este mapa no tiene templo.');
            return false;
        }

        // Si ya está en el templo, no se mueve. Teletransportar a la misma casilla es un
        // viaje que no lleva a ningún sitio, y el aviso de "vuelves al templo" quedaría
        // mintiendo justo cuando el jugador acaba de llegar.
        const actual = creature.getPosition();
        if (actual && actual.x === templo.x && actual.y === templo.y && actual.z === templo.z) {
            return false;
        }

        if (!creature.teleportTo(templo)) {
            // `teleportPlayer` comprueba los límites del mapa, así que puede negarse.
            creature.sendTextMessage('La marca no te lleva a ninguna parte.');
            return false;
        }

        creature.sendTextMessage('La marca del suelo te devuelve al templo.');

        return true;
    }
};
