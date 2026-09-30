'use strict';

/**
 * Rata de cueva.
 *
 * Es la rata de `rat.js` un escalón más arriba: mismo sitio en el mundo (cuevas y
 * cloacas) y misma forma de pelear, pero aguanta un golpe más y da algo más de
 * experiencia. Existe como fichero propio y no como una opción de la rata porque
 * el registro de monstruos indexa por nombre, y un spawn apunta a un nombre: dos
 * variantes con el mismo nombre no se podrían colocar por separado en el mapa.
 *
 * DATOS: los contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/caverat): 30 hp, 10 de experiencia, 1 de
 * armadura y 10 de daño máximo. La velocidad de aquí (78) NO es la de Tibia: el
 * motor usa su propia escala, calibrada con la rata de `rat.js`, que tiene 74, y
 * la de Tibia para la rata de cueva es solo un poco mayor que la de la rata común.
 *
 * SIN DIBUJO: el cliente de `client/avillatoro/js/browserquest.js` solo sabe
 * dibujar los `lookType` 21, 34, 35, 36 y 37, y el 56 que lleva esta rata no está
 * entre ellos, asi que se ve con el rectangulo de procedimiento. El 56 es el
 * `lookType` real de la rata de cueva en Tibia; el 35 que la tabla del cliente
 * llama "Cave Rat" no lo es, y por eso NO se usa aqui.
 *
 * SIN LOOT REAL: `data/items/items.xml` solo define los ids 102-113, 1948, 1387,
 * 3031, 2160 y el rango 1950-1954. La rata de cueva de Tibia suelta queso, gusano
 * y galleta, y ninguno de esos ids existe todavia en este datapack, asi que el
 * botin se limita a la moneda de oro. Cuando se definan esos items, aqui solo hay
 * que anadir lineas.
 */

module.exports = {
    type: 'monster',
    name: 'Cave Rat',

    description: 'a cave rat',
    experience: 10,
    health: 30,
    maxHealth: 30,
    race: 'blood',
    speed: 78,
    manaCost: 350,

    /**
     * El aspecto.
     *
     * Los colores son indices de la paleta del cliente y van todos en el mismo
     * tono: en un monstruo se lee como criatura, en un jugador se lee como ropa.
     * Se dejan algo mas oscuros que los de la rata comun porque una rata de cueva
     * vive donde no da la luz.
     */
    outfit: {
        lookType: 56,
        head: 40,
        body: 40,
        legs: 40,
        feet: 40,
        addons: 0
    },

    /**
     * Cada cuanto reconsidera a quien pelea. La probabilidad es sobre 100.
     *
     * PENDIENTE: el motor todavia no lee estos dos bloques (`changeTarget` y
     * `strategiesTarget`). Se declaran igual que en la rata para que el dia que la
     * IA los lea no haya que reescribir quince ficheros, pero hoy son inertes.
     */
    changeTarget: { interval: 4000, chance: 20 },

    strategiesTarget: {
        nearest: 100,
        health: 100,
        damage: 100,
        random: 0
    },

    /**
     * Banderas de comportamiento.
     *
     * `runHealth: 0` significa "no huye nunca", que es lo que hace en Tibia la
     * rata de cueva.
     */
    flags: {
        summonable: true,
        attackable: true,
        hostile: true,
        convinceable: true,
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
        canWalkOnPoison: false
    },

    /**
     * Ataques.
     *
     * El daño máximo va NEGATIVO por convención de Tibia: en los datapacks el
     * signo distingue "quita vida" de "da vida", y el motor usa el valor absoluto.
     *
     * El motor solo usa hoy el PRIMER ataque (`attacks[0]`), asi que el cuerpo a
     * cuerpo va siempre delante. Los demas se declaran para el dia que la IA los
     * recorra, y no se inventan: se copian de la ficha de la criatura.
     */
    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -10 }
    ],

    defenses: {
        defense: 1,
        armor: 1
    },

    /**
     * Resistencias elementales, con la lectura de Tibia:
     *   percent positivo -> resistente (25 = un 25% menos de daño)
     *   percent = 100    -> inmune
     *   percent negativo -> débil (más daño)
     *
     * La rata de cueva recibe un 110% del daño de fuego, es decir, es débil a él:
     * un 10% MÁS de daño se escribe, por tanto, -10.
     */
    elements: [
        { type: 'fire', percent: -10 }
    ],

    immunities: [],

    voices: {
        interval: 5000,
        chance: 10,
        lines: [
            { text: 'Meep!', yell: false },
            { text: 'Meeeeep!', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 40000, maxCount: 2 }    // gold coin
    ]
};
