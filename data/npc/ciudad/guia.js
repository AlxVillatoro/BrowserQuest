'use strict';

/**
 * El guía de la ciudad.
 *
 * Un NPC es un módulo de contenido más, como una acción o un monstruo. Lo que cambia es
 * lo que declara: en vez de `onUse` o `onThink`, declara PALABRAS CLAVE.
 *
 * EL ORDEN DE LA LISTA ES SIGNIFICATIVO. Se recorre de arriba abajo y gana la PRIMERA que
 * casa, así que una palabra general puesta antes que una concreta se come a la concreta.
 * Por eso "hola" va primero —es lo que tiene que funcionar siempre— y las preguntas
 * concretas van después, de la más específica a la más general.
 *
 * Las palabras clave de un NPC son las de TFS, y su comportamiento también: sólo responde
 * a quien le ha saludado. Un NPC que contesta a cualquiera en una plaza con cinco
 * jugadores sería un gallinero.
 */

module.exports = {

    type: 'npc',
    name: 'Guia',

    /** Lo que dice cuando no entiende. Es lo que distingue "no te oigo" de "no te entiendo". */
    default: (npc, player) => {
        npc.say('No te entiendo. Prueba con "templo", "salir" o "donde".');
    },

    keywords: [
        {
            // `greeting: true` significa que funciona SIN foco, y que lo establece.
            words: ['hola', 'hi', 'buenas', 'buenos dias'],
            greeting: true,
            say: (npc, player) => {
                npc.say('Hola, ' + player.name + '. Soy el guia de la ciudad. ' +
                    'Preguntame por el "templo", por como "salir" o por "donde" esta algo.');
            }
        },

        {
            words: ['templo', 'temple'],
            say: (npc) => {
                npc.say('El templo esta al norte. Si mueres, reapareces alli: ' +
                    'recuerda que pierdes experiencia y sueltas lo que llevas.');
            }
        },

        {
            words: ['donde', 'donde esta', 'donde queda'],
            say: (npc, player) => {
                const position = player.getPosition();
                npc.say('Ahora mismo estas en ' + position + '.');
            }
        },

        {
            words: ['salir', 'como salgo', 'ayuda'],
            say: (npc) => {
                npc.say('Muevete con las flechas o WASD. Con Intro escribes, y ' +
                    'con el boton derecho del raton recoges lo que haya en el suelo.');
            }
        },

        {
            words: ['monstruos', 'peligro', 'ratas'],
            say: (npc) => {
                npc.say('Hay ratas al sur. Son debiles, pero no bajes a la mina ' +
                    'sin subir de nivel.');
            }
        },

        {
            /*
             * La despedida VA LA ULTIMA de las que importan.
             *
             * `farewell: true` hace que el motor suelte el foco después de responder, y
             * eso lo hace el MOTOR y no este módulo: si cada NPC tuviera que acordarse de
             * soltar el foco, el que se olvidara se quedaría pegado a un jugador para
             * siempre y no atendería a nadie más.
             */
            words: ['adios', 'bye', 'chao', 'hasta luego'],
            farewell: true,
            say: (npc) => {
                npc.say('Adios. Vuelve cuando quieras.');
            }
        }
    ]
};
