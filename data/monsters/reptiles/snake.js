'use strict';

/**
 * Serpiente.
 *
 * La criatura más floja de la carpeta y la única que no huye nunca: 15 de vida y 8
 * de daño físico más 1 de tierra. En Tibia su peligro no es el golpe, es el veneno
 * que deja después.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/snake): 15 hp, 10 de experiencia, 0 de
 * armadura, 8 de daño físico más 1 de tierra, no huye, fuerte contra tierra y
 * energía y débil a fuego y hielo. Ojo con su resistencia a la tierra: en Tibia fue
 * INMUNE hasta la versión 9.8, y desde entonces recibe un 60% (es decir, un 40% de
 * reducción). Aquí se copia el estado actual, no el histórico.
 *
 * SIN LOOT: en Tibia una serpiente no suelta nada, y esta se queda igual,
 * deliberadamente. `data/items/items.xml` tampoco tiene nada que se le parezca, y
 * inventarle un botín para que "dé algo" sería justo lo contrario de lo que se
 * pide: un monstruo sin loot es un dato, no un olvido.
 *
 * SIN DIBUJO: su `lookType` real es el 28 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37).
 */

module.exports = {
    type: 'monster',
    name: 'Snake',

    description: 'a snake',
    experience: 10,
    health: 15,
    maxHealth: 15,
    race: 'blood',
    speed: 70,
    manaCost: 205,

    /**
     * La velocidad de la ficha es 60, pero la escala de este motor no es la de
     * Tibia: aquí la rata de `rat.js` tiene 74. Una serpiente es más lenta que una
     * rata, así que se queda por debajo, y se dice para que el número no se lea
     * como el de Tibia.
     */
    outfit: {
        lookType: 28,
        head: 70,
        body: 70,
        legs: 70,
        feet: 70,
        addons: 0
    },

    changeTarget: { interval: 4000, chance: 20 },

    strategiesTarget: {
        nearest: 100,
        health: 100,
        damage: 100,
        random: 0
    },

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
        runHealth: 0,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: true
    },

    /**
     * Cuerpo a cuerpo (8) más un veneno de tierra (1). Solo se aplica el primero:
     * el motor usa `attacks[0]` y el veneno queda declarado para cuando la IA
     * recorra la lista entera.
     */
    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -8 },
        { name: 'earth', interval: 4000, chance: 20, minDamage: 0, maxDamage: -1 }
    ],

    defenses: {
        defense: 0,
        armor: 0
    },

    /**
     * Fuerte contra tierra (recibe un 60%: +40) y energía (80%: +20); débil a fuego
     * e hielo (110%: -10).
     */
    elements: [
        { type: 'earth', percent: 40 },
        { type: 'poison', percent: 40 },
        { type: 'energy', percent: 20 },
        { type: 'fire', percent: -10 },
        { type: 'ice', percent: -10 }
    ],

    immunities: [],

    voices: {
        interval: 7000,
        chance: 10,
        lines: [
            { text: 'Zzzzzzt', yell: false }
        ]
    },

    loot: []
};
