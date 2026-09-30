'use strict';

/**
 * Araña venenosa.
 *
 * La araña que sí hace daño. En Tibia se distingue de la común en tres cosas que
 * están las tres declaradas aquí: pega más, es INMUNE a la tierra (su propio
 * veneno no le hace nada) y NO se puede convencer.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/poisonspider): 26 hp, 22 de experiencia,
 * 2 de armadura, 20 de daño físico más 2 de tierra, huida a 6 hp e inmunidad a la
 * tierra. En su `lookType` pasa lo mismo que con el resto de la carpeta: el real es
 * el 36, el cliente solo dibuja el 21, 34, 35, 36 y 37... y da la casualidad de que
 * el 36 SÍ está en esa tabla, así que esta araña se ve con el dibujo del cliente en
 * vez de con el rectángulo de procedimiento. Es el único monstruo de esta familia
 * que se libra.
 *
 * OJO CON EL CLIENTE: su `lookType` real (36) y el 36 de
 * `client/avillatoro/js/browserquest.js` coinciden en el número pero no en el
 * dibujo: allí el 36 está mapeado a `boss` (el dragón). Se acepta a propósito,
 * porque la alternativa es un id que no es el de Tibia, y un dragón dibujado donde
 * va una araña venenosa al menos se ve.
 *
 * SIN LOOT REAL: el caparazón de araña venenosa no existe en
 * `data/items/items.xml`, así que solo suelta moneda de oro.
 */

module.exports = {
    type: 'monster',
    name: 'Poison Spider',

    description: 'a poison spider',
    experience: 22,
    health: 26,
    maxHealth: 26,
    race: 'blood',
    speed: 80,
    manaCost: 270,

    outfit: {
        lookType: 36,
        head: 70,
        body: 90,
        legs: 70,
        feet: 90,
        addons: 0
    },

    changeTarget: { interval: 4000, chance: 20 },

    strategiesTarget: {
        nearest: 100,
        health: 100,
        damage: 100,
        random: 0
    },

    /**
     * `convinceable: false` desde la corrección de contenido de Tibia de 2011: una
     * araña venenosa convencida envenenaba a otro jugador y el dueño del monstruo
     * se llevaba la muerte. Se copia el estado actual, no el histórico.
     */
    flags: {
        summonable: true,
        attackable: true,
        hostile: true,
        convinceable: false,
        pushable: true,
        rewardBoss: false,
        illusionable: true,
        canPushItems: false,
        canPushCreatures: false,
        staticAttackChance: 90,
        targetDistance: 1,
        runHealth: 6,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: true
    },

    /**
     * Su daño es cuerpo a cuerpo (20) más un veneno de tierra (2). El motor solo
     * usa `attacks[0]`, así que el veneno se declara como segundo ataque y hoy no
     * se aplica: se deja escrito para no volver a buscarlo cuando la IA recorra la
     * lista.
     */
    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -20 },
        { name: 'earth', interval: 4000, chance: 20, minDamage: 0, maxDamage: -2 }
    ],

    defenses: {
        defense: 2,
        armor: 2
    },

    elements: [
        { type: 'fire', percent: -10 }              // recibe un 110%: débil al fuego
    ],

    /**
     * En Tibia la inmunidad es a la tierra, que es el tipo con el que viaja el
     * veneno. El motor compara el tipo tal cual, y 'poison' no es 'earth': se
     * declaran los dos para que la inmunidad valga por cualquiera de los dos
     * nombres, que es lo que espera quien lea la ficha.
     */
    immunities: [
        { type: 'earth', percent: 100 },
        { type: 'poison', percent: 100 }
    ],

    voices: {
        interval: 6000,
        chance: 10,
        lines: [
            { text: 'Hissss', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 50000, maxCount: 4 }    // gold coin
    ]
};
