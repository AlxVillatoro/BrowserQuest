'use strict';

/**
 * Gusano putrefacto (rotworm).
 *
 * Es el primer monstruo de esta carpeta que NO huye y que aguanta lo suficiente
 * como para que un novato tenga que decidir si pelea o corre. En Tibia es el
 * monstruo más cazado del juego, y esa fama viene justo de aquí: lento, sin ataque
 * a distancia y con mucha vida para lo que pega.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/rotworm): 65 hp, 40 de experiencia, 8 de
 * armadura y 40 de daño máximo. La velocidad (58) es la que trae la ficha, pero la
 * escala de este motor no es la de Tibia: la rata de `rat.js` tiene 74 aquí y en
 * Tibia va por delante de un gusano, asi que lo coherente con el motor es que este
 * valor quede POR DEBAJO del de la rata aunque los numeros absolutos no coincidan.
 *
 * SIN DIBUJO: su `lookType` real en Tibia es el 26, y la tabla de
 * `client/avillatoro/js/browserquest.js` solo conoce el 21, 34, 35, 36 y 37, asi
 * que se dibuja con el rectangulo de procedimiento. Se prefiere el id de verdad y
 * un rectangulo antes que un id inventado y un dibujo que miente.
 *
 * SIN LOOT REAL: `data/items/items.xml` no define ni el gusano, ni la carne, ni el
 * jamon, ni el trozo de tierra que suelta en Tibia. El botin se limita a la moneda
 * de oro, que si existe (id 3031).
 */

module.exports = {
    type: 'monster',
    name: 'Rotworm',

    description: 'a rotworm',
    experience: 40,
    health: 65,
    maxHealth: 65,
    race: 'blood',
    speed: 58,
    manaCost: 305,

    outfit: {
        lookType: 26,
        head: 80,
        body: 80,
        legs: 80,
        feet: 80,
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
     * `summonable: false` porque en Tibia un gusano putrefacto no se invoca, y esa
     * diferencia con la rata no es un detalle de sabor: cambia lo que puede hacer
     * un jugador con la runa de invocar criaturas.
     *
     * `pushable: false` por lo mismo: la ficha lo marca como no empujable, y eso
     * hace que no sirva para atascarlo en una esquina.
     */
    flags: {
        summonable: false,
        attackable: true,
        hostile: true,
        convinceable: true,
        pushable: false,
        rewardBoss: false,
        illusionable: true,
        canPushItems: false,
        canPushCreatures: false,
        staticAttackChance: 90,
        targetDistance: 1,
        runHealth: 0,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: false
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -40 }
    ],

    defenses: {
        defense: 8,
        armor: 8
    },

    /** Ni resistencias ni debilidades: en Tibia recibe el 100% de todo. */
    elements: [],

    immunities: [],

    voices: {
        interval: 6000,
        chance: 10,
        lines: [
            { text: 'Slurp', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 60000, maxCount: 17 }   // gold coin
    ]
};
