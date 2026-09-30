'use strict';

/**
 * El anciano.
 *
 * Es el unico NPC que no vende, no cura y no guarda nada: su oficio es ACORDARSE. Existe
 * porque un mundo sin memoria es una sucesion de casillas, y porque el jugador que llega
 * nuevo necesita que alguien le cuente de donde sale todo lo que ve.
 *
 * LA HISTORIA QUE CUENTA ES DE ESTE MUNDO Y ESTA INVENTADA PARA EL. No es lore de Tibia y
 * no pretende serlo: de Tibia este repositorio copia los NUMEROS del catalogo —los pesos y
 * el ataque de `items.xml`, los aspectos de `outfits.xml`—, y esas cifras hay que respetarlas
 * o decirlas como aproximacion. La historia de una ciudad no es un dato de Tibia, es
 * contenido, y por eso se puede escribir. Lo que NO hace es poner cifras de Tibia en su
 * boca: aqui no hay "hace mil anos, en el ano 700" ni nombres de reyes de Tibia.
 *
 * HABLA SOLO, y eso es lo que enseña este NPC, porque el herrero ya enseña `onThink` para
 * otra cosa. Un NPC que solo abre la boca cuando le hablan parece un mueble; uno que
 * murmura de vez en cuando parece alguien esperando. `onThink` se llama en cada tic del
 * NPC —cada 500 ms, mira `engine/core/engine.js`— y por eso el modulo se guarda la fecha
 * del proximimo murmullo EN EL PROPIO NPC: no hay otro sitio donde recordar nada entre dos
 * tics, y el herrero ya usa ese truco con `npc.goingHome`.
 *
 * Y SE CALLA SI LE ESTAN HABLANDO. `npc.focus` dice con quien esta; soltar una frase al
 * aire encima de una conversacion es justo el ruido que el foco existe para evitar.
 *
 * DIBUJO: `client/avillatoro/js/browserquest.js` tiene una tabla NPC que va de NOMBRE a
 * dibujo y hoy solo conoce a Guia y Herrero. A este le tocaria 'king': es el unico dibujo
 * de la lista con ropa larga de viejo, aunque lleve corona.
 */

/** Cada cuanto murmura para si mismo. Dos minutos: se oye, no cansa. */
const MURMULLO_MS = 120000;

module.exports = {

    type: 'npc',
    name: 'Anciano',

    onThink: (npc, world, now) => {
        // El primer tic solo sirve para arrancar el reloj: sin esto, el anciano soltaria su
        // primera frase nada mas arrancar el servidor y luego se callaria dos minutos.
        if (npc.proximoMurmullo === undefined) {
            npc.proximoMurmullo = now + MURMULLO_MS;
            return;
        }

        if (now < npc.proximoMurmullo) {
            return;
        }

        // Se habla encima de una conversacion: no.
        if (npc.focus) {
            return;
        }

        npc.proximoMurmullo = now + MURMULLO_MS;
        npc.say('... y entonces el pozo se seco, y nadie supo decir por que.');
    },

    default: (npc) => {
        npc.say('No te oigo bien, hijo. Hablame de la "historia", de la "mina" o del ' +
            '"templo".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas', 'buenos dias'],
            greeting: true,
            say: (npc, player) => {
                // `getName()` y no `player.name`: en el envoltorio el nombre es un metodo.
                npc.say('Anda, ' + player.getName() + '. Sientate, que yo ya no me levanto. ' +
                    'Preguntame por la "historia" y te la cuento como me la contaron.');
            }
        },

        {
            words: ['historia', 'cuentame', 'origen', 'antano', 'acuerdate'],
            say: (npc) => {
                npc.say('Esto era un descampado con un templo, y nada mas. La gente se ' +
                    'junto alrededor del templo porque era lo unico que no se caia, y asi ' +
                    'acabo habiendo ciudad.');
                npc.say('Despues abrieron la mina, y la ciudad crecio de golpe. Cuando la ' +
                    'mina se quedo vacia, la ciudad ya no se fue.');
            }
        },

        {
            words: ['ciudad', 'avillatoro', 'pueblo', 'aqui'],
            say: (npc) => {
                npc.say('Avillatoro es un punado de casas y un templo. No esperes murallas: ' +
                    'lo unico que nos ha defendido siempre es que no hay nada que robar.');
            }
        },

        {
            words: ['mina', 'minas', 'pozo', 'abajo'],
            say: (npc) => {
                npc.say('La mina esta debajo de todo esto, una planta mas abajo. Esta ' +
                    'abierta y vacia: se dice que abajo hay algo, pero no lo ha visto nadie ' +
                    'todavia.');
            }
        },

        {
            words: ['templo', 'dioses', 'rezar', 'reza'],
            say: (npc) => {
                npc.say('El templo es lo primero que hubo, y por eso esta donde esta. El ' +
                    'que cae vuelve alli entero, aunque vuelve sin lo que llevaba.');
            }
        },

        {
            words: ['rey', 'corona', 'reino', 'gobernador'],
            say: (npc) => {
                npc.say('Reyes no hay. Hubo uno, hace tanto que ya no me acuerdo del ' +
                    'nombre, y no dejo heredero ni ganas de tenerlo.');
            }
        },

        {
            words: ['ratas', 'bichos', 'monstruos'],
            say: (npc) => {
                npc.say('Las ratas llevan aqui mas que nosotros. Se crian en el charco y ' +
                    'no se han ido nunca, ni cuando la mina daba de comer.');
            }
        },

        {
            words: ['edad', 'anos', 'viejo', 'mayor'],
            say: (npc) => {
                npc.say('No te sabria decir cuantos anos tengo. Deje de contarlos cuando ' +
                    'me di cuenta de que nadie me creia.');
            }
        },

        {
            words: ['adios', 'bye', 'chao', 'hasta luego'],
            farewell: true,
            say: (npc) => {
                npc.say('Vete, vete. Yo me quedo aqui, como siempre.');
            }
        }
    ]
};
