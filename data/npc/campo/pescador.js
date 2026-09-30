'use strict';

/**
 * El pescador.
 *
 * NO HAY PESCA, y este comentario esta para que nadie lo busque. En Tibia pescar es una
 * habilidad: se usa una cana sobre el agua, hay un skill que sube con cada intento y un
 * pez que sale con suerte. En este motor no existe NADA de eso: no hay habilidad de pesca
 * (el comentario de `giveExperience` en `engine/world/combat.js` lo dice: solo se entrena
 * el nivel, y la espada, el escudo y la magia estan pendientes), no hay accion de usar una
 * cana sobre el agua, y en `data/items/items.xml` no hay cana ni pez que darle al jugador.
 *
 * Un modulo de contenido no puede inventarse una habilidad, asi que el pescador NO PESCA:
 * cuenta lo que hay. Y hay una cosa que si es util y esta comprobada en los datos: **el
 * agua somera cuesta el doble de andar**. Su `groundSpeed` es 300 en `items.xml` y el suelo
 * normal de Tibia es 150 —el valor por defecto de `engine/world/stepcost.js`—, y la
 * duracion del paso es proporcional a ese numero. Ese es el dato que este NPC le da al
 * jugador, y es el mismo sitio donde el charco deja de ser decorado.
 *
 * Vive en `campo/` y no en `ciudad/` porque TFS organiza los NPC por zona y el `module` del
 * XML es una ruta relativa a `data/npc/`: la carpeta es organizacion, no una regla.
 *
 * DIBUJO: `client/avillatoro/js/browserquest.js` tiene una tabla NPC que va de NOMBRE a
 * dibujo y hoy solo conoce a Guia y Herrero. A este le tocaria 'beachnpc', que es el unico
 * de la lista con pinta de estar al aire libre.
 */

module.exports = {

    type: 'npc',
    name: 'Pescador',

    default: (npc) => {
        npc.say('No te he entendido. Dime "pesca", "charco" o "cebo".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas', 'buenos dias'],
            greeting: true,
            say: (npc, player) => {
                // `getName()` y no `player.name`: en el envoltorio el nombre es un metodo.
                npc.say('Buenas, ' + player.getName() + '. Si vienes a preguntar por la "pesca", ' +
                    'te adelanto que hoy no pica nada.');
            }
        },

        {
            words: ['pesca', 'pescar', 'pez', 'peces', 'pescado', 'pican'],
            say: (npc) => {
                npc.say('Ni un pez. Llevo la manana entera con el sedal en el agua y no ha ' +
                    'picado nada, y no es por falta de paciencia.');
            }
        },

        {
            words: ['cana', 'cebo', 'anzuelo', 'red', 'sedal'],
            say: (npc) => {
                npc.say('Aparejos tengo los mios, pero no te puedo vender ninguno: no hay ' +
                    'donde comprarlos en toda la ciudad.');
            }
        },

        {
            words: ['charco', 'agua', 'charca', 'rio', 'mar', 'lago'],
            say: (npc) => {
                npc.say('Metete en el charco y lo vas a notar: el agua somera se anda a la ' +
                    'mitad de velocidad. Por eso los peces no tienen quien los moleste.');
            }
        },

        {
            words: ['ratas', 'rata', 'bichos'],
            say: (npc) => {
                npc.say('Las ratas vienen al charco a beber, y ya no se asustan de mi. Son ' +
                    'mas duenas del agua que yo.');
            }
        },

        {
            words: ['mina', 'peces raros', 'fondo'],
            say: (npc) => {
                npc.say('En la mina no hay agua, que yo sepa. Si la hubiera, seria la unica ' +
                    'pesca tranquila de por aqui.');
            }
        },

        {
            words: ['adios', 'bye', 'chao', 'hasta luego'],
            farewell: true,
            say: (npc) => {
                npc.say('Que tengas mas suerte que yo.');
            }
        }
    ]
};
