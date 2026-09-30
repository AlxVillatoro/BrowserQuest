'use strict';

/**
 * El sanador.
 *
 * Un sanador que no cura parece una broma, y es la verdad de este motor: HOY NO HAY FORMA
 * DE DEVOLVER VIDA DESDE EL CONTENIDO. `engine/world/creature.js` tiene un `heal(amount)`,
 * pero ningun envoltorio de los que se le pasan a un modulo lo expone —mira
 * `engine/scripting/entities.js`—: el contenido puede LEER la salud de un jugador y no
 * puede escribirla. Escribir aqui `player.heal(...)` no daria un NPC que cura, daria una
 * excepcion en mitad de la conversacion, que es peor que no curar.
 *
 * Asi que hace lo unico honesto que se puede hacer con lo que hay: DIAGNOSTICAR, que es un
 * dato que el jugador no tiene —el cliente dibuja una barra, no un numero— y decir de donde
 * vuelve la salud de verdad. Y son dos sitios, los dos comprobables:
 *
 *   - El templo, porque al morir se reaparece con la salud entera
 *     (`applyDeath` en `engine/world/combat.js`, que la pone a `maxHealth` despues de
 *     teletransportar al templo).
 *   - Subir de nivel, que tambien la rellena (mismo fichero, en `giveExperience`).
 *
 * NO HAY REGENERACION POR TIEMPO: nadie la programa en el motor, asi que "espera y se te
 * pasara" seria mentira. Y tampoco hay veneno, ni enfermedad, ni condicion ninguna: el
 * combate aplica dano y armadura, y nada mas. Un NPC que ofreciera curar veneno estaria
 * inventandose un sistema que no existe.
 *
 * El dia que haya pociones o un `heal` en el envoltorio, este NPC tendra algo que vender.
 * Mientras tanto vende lo que tiene: saber por donde vas.
 *
 * DIBUJO: `client/avillatoro/js/browserquest.js` tiene una tabla NPC que va de NOMBRE a
 * dibujo y hoy solo conoce a Guia y Herrero. A este le tocaria 'priest'.
 */

module.exports = {

    type: 'npc',
    name: 'Sanador',

    default: (npc) => {
        npc.say('No te entiendo. Dime "como estoy", "curar", "templo" o "veneno".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas', 'buenos dias'],
            greeting: true,
            say: (npc, player) => {
                // `getName()` y no `player.name`: en el envoltorio el nombre es un metodo.
                npc.say('Hola, ' + player.getName() + '. Dime "como estoy" y te digo como llevas ' +
                    'el cuerpo.');
            }
        },

        {
            /*
             * CURAR va lo primero de las concretas, y con la respuesta mas larga a
             * proposito: es lo que va a preguntar todo el mundo, y quien lo pregunta se
             * merece que se le diga POR QUE no hay cura en vez de un "no puedo" seco.
             *
             * La respuesta va en el idioma del mundo, no en el del codigo: el jugador no
             * tiene por que saber que existe un envoltorio.
             */
            words: ['curar', 'cura', 'curas', 'sanar', 'sanacion', 'medico', 'remedio'],
            say: (npc) => {
                npc.say('No puedo cerrarte las heridas. Aqui no hay remedio que las ' +
                    'cierre: la salud vuelve entera al templo, cuando caes, y al subir de ' +
                    'nivel. Andando no se te pasa.');
            }
        },

        {
            words: ['como estoy', 'salud', 'heridas', 'vida', 'estado', 'herido'],
            say: (npc, player) => {
                const salud = player.getHealth();
                const maxima = player.getMaxHealth() || 1;
                // El porcentaje se calcula aqui y no se manda crudo: lo que el jugador ve
                // en pantalla es una barra, y el numero solo es util comparado con algo.
                const porcentaje = Math.round(salud * 100 / maxima);

                npc.say('Estas a ' + salud + ' de ' + maxima + ' (' + porcentaje + '%).');

                if (porcentaje >= 90) {
                    npc.say('Entero. No te metas donde no te llaman y seguiras asi.');
                } else if (porcentaje >= 50) {
                    npc.say('Aguantas, pero no fuerces: otra pelea asi te deja en el suelo.');
                } else if (porcentaje > 0) {
                    npc.say('Estas para que te lleven. Si caes pierdes experiencia y sueltas ' +
                        'todo lo que llevas encima.');
                } else {
                    npc.say('Estas muerto, y eso ya no es cosa mia.');
                }
            }
        },

        {
            words: ['templo', 'reaparecer', 'resucitar', 'morir', 'muerte'],
            say: (npc) => {
                npc.say('El templo te rehace entero cuando caes, y por eso es lo unico que ' +
                    'te devuelve la salud de golpe. Eso si: pierdes experiencia y sueltas ' +
                    'lo que llevas, alli donde caiste.');
            }
        },

        {
            words: ['nivel', 'subir', 'experiencia'],
            say: (npc) => {
                npc.say('Al subir de nivel te rehaces entero, y ademas aguantas mas golpes ' +
                    'que antes. Es la otra manera de curarse que hay.');
            }
        },

        {
            words: ['veneno', 'enfermedad', 'maldicion', 'fiebre'],
            say: (npc) => {
                npc.say('Veneno no hay, ni fiebre tampoco. Aqui solo hacen dano: lo que te ' +
                    'abre la piel es un golpe, no un bicho invisible.');
            }
        },

        {
            words: ['mina', 'ratas', 'peligro'],
            say: (npc) => {
                npc.say('La mina esta planta abajo y las ratas junto al charco. Las dos ' +
                    'cosas dejan marca, y ninguna de las dos te la quito yo.');
            }
        },

        {
            words: ['adios', 'bye', 'chao', 'hasta luego'],
            farewell: true,
            say: (npc) => {
                npc.say('Vete con cuidado.');
            }
        }
    ]
};
