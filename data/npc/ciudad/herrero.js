'use strict';

/**
 * El herrero.
 *
 * Existe para enseñar dos cosas que el guía no tiene: **pasea** —lo dice su XML, con
 * `walkradius`— y **se calla mientras trabaja**, que es lo que hace `onThink`.
 *
 * `onThink` se llama cada vez que el NPC piensa, antes de decidir si da un paso. Sirve
 * para lo que un NPC tenga que hacer por su cuenta: mirar alrededor, volver a su sitio,
 * decir algo de vez en cuando.
 *
 * PENDIENTE: no vende nada. El comercio es la siguiente capa del sistema de NPC y necesita
 * dos cosas que todavía no existen: listas de precios y el traspaso de objetos y dinero
 * entre un jugador y el NPC. Dejarlo apuntado aquí es mejor que un NPC que parece una
 * tienda y no lo es.
 */

module.exports = {

    type: 'npc',
    name: 'Herrero',

    /**
     * Se queja si se aleja demasiado de su taller.
     *
     * Es el uso típico de `onThink`: el motor ya impide que se aleje más de su radio al
     * dar los pasos, pero sólo el NPC sabe que eso ha pasado y puede comentarlo. Un
     * monstruo que se aleja de su guarida vuelve andando; un NPC que se aleja de su
     * tienda tiene que volver, y el camino de vuelta lo da el motor.
     */
    onThink: (npc, world, now) => {
        if (!npc.isWithinHome() && !npc.goingHome) {
            npc.goingHome = true;
            npc.say('Me he alejado del taller. Vuelvo.');
        }
    },

    default: (npc, player) => {
        npc.say('No te he entendido. Dime "hola", "armas" o "precios".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas'],
            greeting: true,
            say: (npc) => {
                npc.say('Buenas. Soy el herrero. Te puedo hablar de "armas" o de "precios".');
            }
        },

        {
            words: ['armas', 'espada', 'espadas'],
            say: (npc) => {
                npc.say('Forjo espadas de ataque 48. Se nota mucho contra las ratas.');
            }
        },

        {
            words: ['precios', 'precio', 'cuanto', 'comprar'],
            say: (npc) => {
                npc.say('Todavia no vendo nada: estoy esperando a que el mercado abra.');
            }
        },

        {
            words: ['trabajo', 'haces', 'oficio'],
            say: (npc) => {
                npc.say('Trabajo el hierro. Por eso me ves dando vueltas por aqui.');
            }
        },

        {
            words: ['adios', 'bye', 'chao'],
            farewell: true,
            say: (npc) => {
                npc.say('Que te vaya bien.');
            }
        }
    ]
};
