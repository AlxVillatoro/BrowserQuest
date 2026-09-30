'use strict';

/**
 * El guardia.
 *
 * EN TIBIA UN GUARDIA PEGA, y aqui no puede, y conviene dejarlo escrito porque es lo
 * primero que se espera de el. En Tibia un guardia ataca al criminal —el de la calavera— y
 * esa es toda su funcion. En este motor NO HAY SISTEMA DE CRIMINALES: no hay calavera, ni
 * carcel, ni reputacion (basta buscarlo: no aparece nada de eso en `engine/`). Un guardia
 * que persiguiera a alguien tendria que inventarse a quien persigue.
 *
 * Y LAS ZONAS DE PROTECCION TAMPOCO SE APLICAN TODAVIA. `engine/world/tile.js` define la
 * bandera y el mapa marca dos casillas con ella (`protectionZone` en
 * `data/world/sample.map.json`), pero NADA la consulta: el combate no mira ni la bandera de
 * proteccion, ni la de `noPvp`, ni mira `worldType`. O sea que hoy se puede pegar a
 * cualquiera que este a tiro, este donde este. Por eso el guardia AVISA en vez de prometer
 * un refugio que no existe.
 *
 * Lo que si dice son cosas comprobadas: el cuerpo a cuerpo llega a UNA casilla y cuenta la
 * diagonal (el alcance es 1 y la distancia se mide como el maximo de los dos ejes, o sea
 * las ocho casillas de alrededor), y una plaza marcada en el mapa no protege de nada.
 *
 * Pasea, y por eso su XML lleva `walkradius`: un guardia clavado en el sitio parece un
 * poste, y uno sin radio se va a mirar la mina y deja la puerta sola.
 *
 * DIBUJO: `client/avillatoro/js/browserquest.js` tiene una tabla NPC que va de NOMBRE a
 * dibujo y hoy solo conoce a Guia y Herrero. A este le tocaria 'guard', que es exactamente
 * lo que es.
 */

module.exports = {

    type: 'npc',
    name: 'Guardia',

    default: (npc) => {
        npc.say('No te entiendo, forastero. Prueba con "mina", "ratas", "peligro" o "ley".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas', 'buenos dias'],
            greeting: true,
            say: (npc, player) => {
                // `getName()` y no `player.name`: en el envoltorio el nombre es un metodo.
                npc.say('Alto ahi, ' + player.getName() + '. Guardia de la ciudad. Pregunta por ' +
                    'la "mina", por las "ratas" o por la "ley".');
            }
        },

        {
            words: ['mina', 'minas', 'bajar'],
            say: (npc) => {
                npc.say('La mina esta una planta mas abajo. No bajes sin nivel y sin arma: ' +
                    'ahi abajo nadie te oye, y aqui arriba no hay quien baje a buscarte.');
            }
        },

        {
            words: ['ratas', 'rata', 'monstruos', 'bichos'],
            say: (npc) => {
                npc.say('Las ratas salen junto al charco, al otro lado de la ciudad. Son ' +
                    'debiles, pero muerden, y sin arma acabas en el suelo mas rapido de lo ' +
                    'que crees.');
            }
        },

        {
            words: ['charco', 'agua', 'charca', 'nadar'],
            say: (npc) => {
                npc.say('El agua somera se anda a la mitad de velocidad: el suelo mojado ' +
                    'cuesta el doble. Si te persiguen, no te metas en el charco.');
            }
        },

        {
            // Lo que de verdad puede contar de una pelea, que es lo que ha visto.
            words: ['ataque', 'pelea', 'combate', 'pvp', 'pegar', 'matar'],
            say: (npc) => {
                npc.say('El que pega de cerca llega a una casilla, contando la diagonal. ' +
                    'Y aqui se pega el que quiere: no hay calavera, ni carcel, ni juez.');
            }
        },

        {
            words: ['proteccion', 'protegido', 'seguro', 'refugio', 'zona'],
            say: (npc) => {
                npc.say('No te fies de las plazas. Hay casillas marcadas como protegidas en ' +
                    'el mapa, pero hoy no protegen de nada: si alguien te ataca, te ataca.');
            }
        },

        {
            words: ['ley', 'orden', 'justicia', 'bandidos', 'criminales'],
            say: (npc) => {
                npc.say('La ley la pongo yo, y la pongo avisando. Bandidos no hay: nadie se ' +
                    'ha puesto una calavera todavia, y sin calavera no hay a quien ' +
                    'perseguir.');
            }
        },

        {
            words: ['templo', 'curar', 'vida', 'morir'],
            say: (npc) => {
                npc.say('El templo te rehace cuando caes, pero te cuesta una decima parte ' +
                    'de tu experiencia y todo lo que lleves encima. No es un sitio al que ' +
                    'ir de visita.');
            }
        },

        {
            words: ['adios', 'bye', 'chao', 'hasta luego'],
            farewell: true,
            say: (npc) => {
                npc.say('Anda con ojo.');
            }
        }
    ]
};
