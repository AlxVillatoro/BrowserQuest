'use strict';

/**
 * Prueba de combate, experiencia, caminos e IA.
 *
 * Uso:  node tools/test-combat.js
 */

const path = require('path');

const { World } = require('../engine/world/world');
const { Scheduler } = require('../engine/core/scheduler');
const { Combat, attackProfile, elementPercent } = require('../engine/world/combat');
const { MonsterAI } = require('../engine/world/ai');
const { findPath } = require('../engine/world/pathfinding');
const Experience = require('../engine/world/experience');
const { loadMap } = require('../engine/world/loader');
const { Item } = require('../engine/world/item');
const Xml = require('../engine/data/xml');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'data', 'world', 'sample.map.json');

let failures = 0;

function ok(label, detail) {
    console.log('  \u001b[32mPASS\u001b[0m  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
}
function fail(label, detail) {
    failures += 1;
    console.log('  \u001b[31mFAIL\u001b[0m  ' + label + (detail ? '  ' + detail : ''));
}
function check(label, condition, detail) {
    if (condition) { ok(label, detail); } else { fail(label, detail); }
}
function section(title) {
    console.log('\n' + title);
}

/** Reloj controlado a mano. */
const clock = { value: 5000000 };
const now = () => clock.value;
function advance(ms) { clock.value += ms; }

/**
 * Generador pseudoaleatorio con semilla.
 *
 * Las tiradas de botin y de daño son aleatorias, y con `Math.random` una prueba
 * sobre probabilidades seria una moneda al aire. Con semilla, la misma
 * comprobacion da siempre el mismo resultado y un fallo es reproducible.
 */
function seededRandom(seed) {
    let state = seed >>> 0;
    return function random() {
        state |= 0;
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildWorld(options) {
    const opts = options || {};
    const random = opts.random || seededRandom(12345);

    const itemTypes = Xml.loadItems(path.join(ROOT, 'data', 'items', 'items.xml'));
    const monsterTypes = new Map([
        ['Rat', {
            name: 'Rat', health: 20, maxHealth: 20, speed: 74, experience: 5,
            attacks: [{ name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -8 }],
            defenses: { defense: 1, armor: 1 },
            elements: [{ type: 'fire', percent: 20 }, { type: 'ice', percent: -10 }],
            loot: [{ id: 3031, chance: 40000, maxCount: 4 }, { id: 2160, chance: 1000 }]
        }],
        ['Dragon', {
            name: 'Dragon', health: 100, maxHealth: 100, speed: 200, experience: 700,
            attacks: [{ name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -60 }],
            defenses: { defense: 25, armor: 30 },
            elements: [{ type: 'fire', percent: 100 }],   // inmune al fuego
            loot: []
        }]
    ]);

    const loaded = loadMap(MAP_FILE, { itemTypes: itemTypes, monsterTypes: monsterTypes });
    const scheduler = new Scheduler({ now: now, logger: null });

    const world = new World({ scheduler: scheduler, now: now, tickIntervalMs: 50, logger: null });
    world.map = loaded.map;
    world.itemTypes = itemTypes;
    world.monsterTypes = monsterTypes;

    const config = {
        experienceStages: [{ minlevel: 1, maxlevel: 0, multiplier: 1 }],
        healthPerLevel: 5
    };

    const combat = new Combat({
        world: world, scheduler: scheduler, logger: null,
        random: random, config: config
    });

    const ai = new MonsterAI({
        world: world, combat: combat, scheduler: scheduler, logger: null
    });

    return { world, scheduler, combat, ai, random, itemTypes, monsterTypes };
}

function main() {
    console.log('Prueba de combate e IA (' + ROOT + ')');

    // =======================================================================
    section('1. Experiencia: la formula cubica, verificada');
    // =======================================================================

    // Estos valores son los de referencia de Tibia. Si la formula se rompiera, es
    // aqui donde se ve. Se incluyen DOS niveles altos porque son los que fijan la
    // cubica: con solo los primeros, una formula cuadratica pasaria la prueba.
    check('nivel 2 -> 100 de experiencia',
        Experience.experienceForLevel(2) === 100,
        String(Experience.experienceForLevel(2)));
    check('nivel 3 -> 200',
        Experience.experienceForLevel(3) === 200);
    check('nivel 8 -> 4.200',
        Experience.experienceForLevel(8) === 4200,
        String(Experience.experienceForLevel(8)));
    check('nivel 100 -> 15.694.800',
        Experience.experienceForLevel(100) === 15694800,
        String(Experience.experienceForLevel(100)));
    check('nivel 200 -> 129.389.800',
        Experience.experienceForLevel(200) === 129389800,
        String(Experience.experienceForLevel(200)));

    check('nivel 1 -> 0 de experiencia',
        Experience.experienceForLevel(1) === 0);

    check('la experiencia es ACUMULADA, no por tramo',
        Experience.experienceForLevel(3) - Experience.experienceForLevel(2) === 100 &&
        Experience.experienceForLevel(8) > Experience.experienceForLevel(3),
        'guardar el total evita sumar tramos y acumular redondeos');

    // Ida y vuelta: el nivel calculado desde una experiencia debe ser coherente
    // con la experiencia de ese nivel.
    let consistent = true;
    for (let level = 1; level <= 60; level += 1) {
        const needed = Experience.experienceForLevel(level);
        if (Experience.levelForExperience(needed) !== level) { consistent = false; break; }
        if (level > 1 && Experience.levelForExperience(needed - 1) !== level - 1) {
            consistent = false; break;
        }
    }
    check('ida y vuelta exacta en los bordes de nivel', consistent,
        'ni un punto de experiencia por encima o por debajo');

    check('lo que falta para el siguiente nivel',
        Experience.experienceToNextLevel(150, 2) === 50,
        'con 150 de experiencia y nivel 2 faltan 50');

    // Las etapas son la razon de que la configuracion sea codigo: una tabla de
    // tablas que se recorre en orden.
    const stages = [
        { minlevel: 1, maxlevel: 20, multiplier: 10 },
        { minlevel: 21, maxlevel: 0, multiplier: 1 }
    ];
    check('las etapas multiplican segun el nivel',
        Experience.applyExperienceStages(5, 10, stages) === 50 &&
        Experience.applyExperienceStages(5, 50, stages) === 5,
        'x10 hasta el 20, x1 despues (maxlevel 0 = sin tope)');
    check('sin etapas, la experiencia no se toca',
        Experience.applyExperienceStages(5, 10, []) === 5 &&
        Experience.applyExperienceStages(7, 10, null) === 7);

    // =======================================================================
    section('2. Perfiles de ataque y elementos');
    // =======================================================================

    const { world, combat, ai, itemTypes } = buildWorld();

    const rat = world.createMonster('Rat', { x: 40, y: 40, z: 7 });
    const player = world.createPlayer('Heroe', { x: 40, y: 45, z: 7 });

    const ratProfile = attackProfile(rat);
    check('un monstruo ataca con el ataque declarado en su definicion',
        ratProfile && ratProfile.maxDamage === -8 && ratProfile.interval === 2000,
        'melee 0..8 cada 2000 ms');

    check('el alcance por defecto es el cuerpo a cuerpo',
        combat.attackRange(rat) === 1,
        'las cuatro casillas contiguas, incluida la diagonal');

    player.weaponAttack = 48;
    player.attackSkill = 10;
    const playerProfile = attackProfile(player);
    check('un jugador ataca con su arma',
        playerProfile.minDamage === 24 && playerProfile.maxDamage === 58,
        'arma de ataque 48 y habilidad 10 -> 24..58');

    check('la resistencia elemental se lee de la definicion',
        elementPercent(rat, 'fire') === 20 &&
        elementPercent(rat, 'ice') === -10 &&
        elementPercent(rat, 'energy') === 0,
        'fuego 20 (resistente), hielo -10 (debil), energia 0');

    check('los nombres de tipo toleran el formato de Tibia',
        elementPercent({ elements: [{ type: 'COMBAT_FIREDAMAGE', percent: 50 }] }, 'fire') === 50,
        'COMBAT_FIREDAMAGE se reconoce como "fire"');

    // =======================================================================
    section('3. Alcance y enfriamiento');
    // =======================================================================

    advance(1000);
    check('no se ataca a alguien de otra planta',
        combat.canAttack(rat, world.createPlayer('Abajo', { x: 40, y: 41, z: 8 })).reason
        === 'differentFloor');

    check('no se ataca fuera de alcance',
        combat.canAttack(rat, player).reason === 'outOfRange',
        'estan a 5 casillas y el alcance es 1');

    const near = world.createPlayer('Cerca', { x: 41, y: 41, z: 7 });
    check('a distancia 1 si se puede atacar',
        combat.canAttack(rat, near).allowed === true,
        'la diagonal cuenta como alcance 1');

    // Distancia 1 en diagonal: (40,40) a (41,41).
    const firstAttack = combat.attack(rat, near);
    check('el ataque se resuelve y hace daño',
        firstAttack.hit === true && near.health < near.maxHealth,
        'vida ' + near.health + '/' + near.maxHealth);

    check('el atacante queda en enfriamiento',
        combat.canAttack(rat, near).reason === 'exhausted',
        'el intervalo del ataque es 2000 ms');

    advance(2000);
    check('pasado el intervalo, puede volver a atacar',
        combat.canAttack(rat, near).allowed === true);

    // =======================================================================
    section('4. Daño, armadura e inmunidad');
    // =======================================================================

    {
        const harness = buildWorld({ random: () => 0.999 });   // siempre el máximo
        const target = harness.world.createPlayer('Saco', { x: 40, y: 40, z: 7 });
        const attacker = harness.world.createMonster('Rat', { x: 41, y: 40, z: 7 });

        target.health = 1000;
        target.maxHealth = 1000;

        const result = harness.combat.applyDamage(target, 100, { attacker: attacker });
        check('sin armadura, el daño pasa entero',
            result.damage === 100,
            '100 de daño bruto contra armadura 0 -> ' + result.damage);

        // La armadura del objetivo reduce hasta la mitad de su valor.
        target.armorLevel = 40;
        const armored = harness.combat.applyDamage(target, 100, { attacker: attacker });
        check('mas armadura, menos daño',
            armored.damage < result.damage,
            result.damage + ' -> ' + armored.damage + ' con armadura 40');

        check('nunca se baja de 1 punto de daño',
            harness.combat.applyDamage(target, 1, { attacker: attacker }).damage >= 1,
            'un golpe que no hace nada es indistinguible de un fallo');

        // La inmunidad es la excepcion al minimo.
        const dragon = harness.world.createMonster('Dragon', { x: 42, y: 40, z: 7 });
        const immune = harness.combat.applyDamage(dragon, 500, { attacker: target, element: 'fire' });
        check('la inmunidad del 100% anula el golpe por completo',
            immune.damage === 0 && immune.multiplier === 0,
            'un dragon inmune al fuego recibe 0, no 1');

        // La debilidad se prueba en la RATA, que es la que la tiene declarada: el
        // dragon solo declara inmunidad al fuego, asi que pedirle hielo daba
        // multiplicador 1 y la prueba media lo que no creia medir.
        const raton = harness.world.createMonster('Rat', { x: 43, y: 40, z: 7 });
        raton.health = 5000;
        raton.maxHealth = 5000;

        const weak = harness.combat.applyDamage(raton, 100, { attacker: target, element: 'ice' });
        check('una debilidad aumenta el daño',
            weak.multiplier > 1,
            'multiplicador ' + weak.multiplier.toFixed(2) + ' con hielo -10% en la rata');

        const resisted = harness.combat.applyDamage(raton, 100, { attacker: target, element: 'fire' });
        check('una resistencia reduce el daño',
            resisted.multiplier < 1 && resisted.multiplier > 0,
            'multiplicador ' + resisted.multiplier.toFixed(2) + ' con fuego 20% en la rata');

        check('el daño deja registro, para poder depurar',
            harness.combat.hits.length >= 4,
            harness.combat.hits.length + ' golpes registrados');
    }

    // =======================================================================
    section('5. Muerte, botin, experiencia y eventos');
    // =======================================================================

    {
        // Azar que siempre acierta: todas las tiradas de botin entran.
        const harness = buildWorld({ random: () => 0 });
        const events = [];

        harness.world.on('onKill', (killer, target) => {
            events.push('kill:' + (target ? target.name : '?') +
                ':vivo=' + !!harness.world.getMonster(target.id));
        });
        harness.world.on('onDeath', (target) => {
            events.push('death:' + target.name);
        });
        harness.world.on('onMonsterDeath', () => {
            events.push('monsterDeath');
        });

        const hero = harness.world.createPlayer('Heroe', { x: 40, y: 40, z: 7 });
        const victim = harness.world.createMonster('Rat', { x: 41, y: 40, z: 7 });

        const experienceBefore = hero.experience;
        const itemsBefore = harness.world.items.size;

        // Se le quita toda la vida de un golpe.
        const result = harness.combat.applyDamage(victim, 1000, { attacker: hero });

        check('la muerte se detecta en el resultado',
            result.killed === true && victim.isDead());

        check('el monstruo sale del mundo',
            harness.world.getMonster(victim.id) === null &&
            harness.world.monsters.size === 0);

        check('el asesino gana la experiencia del monstruo',
            hero.experience - experienceBefore === 5,
            '+' + (hero.experience - experienceBefore) + ' de experiencia');

        check('el botin cae al suelo',
            harness.world.items.size > itemsBefore && result.loot.length > 0,
            result.loot.length + ' objetos: ' +
            result.loot.map((item) => item.getName() + 'x' + item.count).join(', '));

        check('el botin cae donde murio el monstruo',
            result.loot.every((item) =>
                item.position && item.position.x === 41 && item.position.y === 40),
            'en la casilla del monstruo');

        // EL ORDEN DE LOS EVENTOS es lo que permite escribir misiones: los
        // handlers tienen que ver al monstruo todavia en el mundo.
        check('onKill y onDeath se avisan ANTES de quitarlo del mundo',
            events[0] === 'kill:Rat:vivo=true' && events[1] === 'death:Rat',
            events.slice(0, 3).join(' -> '));

        check('quitarlo del mundo va despues, y es lo que programa la reaparicion',
            events[2] === 'monsterDeath',
            events.join(' -> '));

        check('el cadáver deja la casilla transitable al desaparecer',
            harness.world.hasCreatureAt(41, 40, 7) === false);
    }

    {
        // Azar que siempre falla: no debe caer nada.
        const harness = buildWorld({ random: () => 0.999999 });
        const hero = harness.world.createPlayer('Heroe', { x: 40, y: 40, z: 7 });
        const victim = harness.world.createMonster('Rat', { x: 41, y: 40, z: 7 });

        const result = harness.combat.applyDamage(victim, 1000, { attacker: hero });
        check('con mala suerte no cae botin',
            result.loot.length === 0,
            'las probabilidades se expresan sobre 100.000, como en Tibia');
    }

    {
        // Subida de nivel: un monstruo que da experiencia de sobra.
        const harness = buildWorld({ random: () => 0 });
        const advanced = [];
        harness.world.on('onAdvance', (player, skill, oldLevel, newLevel) => {
            advanced.push(skill + ':' + oldLevel + '->' + newLevel);
        });

        const hero = harness.world.createPlayer('Novato', { x: 40, y: 40, z: 7 });
        const dragon = harness.world.createMonster('Dragon', { x: 41, y: 40, z: 7 });

        check('el heroe empieza en nivel 1', hero.level === 1);

        harness.combat.applyDamage(dragon, 10000, { attacker: hero });

        check('matar sube de nivel',
            hero.level > 1 && hero.experience === 700,
            'nivel ' + hero.level + ' con 700 de experiencia');

        check('la subida de nivel avisa con la firma de TFS',
            advanced.length > 0 && advanced[0].startsWith('level:1->'),
            advanced.join(', '));

        check('la salud maxima sube con el nivel y se cura',
            hero.maxHealth === 150 + (hero.level - 1) * 5 &&
            hero.health === hero.maxHealth,
            hero.health + '/' + hero.maxHealth);
    }

    // =======================================================================
    section('6. Busqueda de caminos');
    // =======================================================================

    {
        const harness = buildWorld();
        const map = harness.world.map;

        const straight = findPath(map, { x: 40, y: 40, z: 7 }, { x: 45, y: 40, z: 7 });
        check('encuentra el camino recto',
            straight.found && straight.path.length === 5,
            straight.path.length + ' pasos, exploro ' + straight.explored + ' nodos');

        check('cada paso es adyacente al anterior',
            straight.path.every((step, index) => {
                const previous = index === 0 ? { x: 40, y: 40 } : straight.path[index - 1];
                return Math.abs(step.x - previous.x) <= 1 && Math.abs(step.y - previous.y) <= 1;
            }));

        // El camino debe RODEAR la habitacion, no cruzarla: los muros van de
        // (10,10) a (14,14), asi que ir de (8,12) a (16,12) obliga a dar un rodeo.
        const around = findPath(map, { x: 8, y: 12, z: 7 }, { x: 16, y: 12, z: 7 });
        check('rodea los muros en vez de cruzarlos',
            around.found && around.path.length > 8,
            around.path.length + ' pasos para una distancia de 8: el rodeo es real');

        check('el camino no pisa ningun muro',
            around.path.every((step) => map.isWalkable(step.x, step.y, 7)),
            'el pathfinding hereda las reglas del mapa');

        check('no se busca entre plantas distintas',
            findPath(map, { x: 40, y: 40, z: 7 }, { x: 40, y: 40, z: 8 }).reason === 'floorChange',
            'en Tibia las escaleras son teletransportes');

        check('estando ya en el destino, el camino esta vacio',
            findPath(map, { x: 40, y: 40, z: 7 }, { x: 40, y: 40, z: 7 }).reason === 'alreadyThere');

        // El tope de nodos: sin el, un monstruo encerrado recorrería el mapa
        // entero en cada intento de persecucion.
        const limited = findPath(map, { x: 2, y: 2, z: 7 }, { x: 60, y: 60, z: 7 }, { nodeLimit: 10 });
        check('el tope de nodos corta la busqueda',
            limited.found === false && limited.reason === 'nodeLimit' && limited.explored > 10,
            'exploro ' + limited.explored + ' nodos con tope 10');

        // Un destino encerrado no tiene camino, y eso es una respuesta normal.
        const cage = { x: 55, y: 55, z: 7 };
        [[54, 55], [56, 55], [55, 54], [55, 56],
         [54, 54], [56, 56], [54, 56], [56, 54]].forEach(([x, y]) => {
            map.getOrCreateTile(x, y, 7).addItem(new Item(harness.itemTypes.get(111)));
        });

        const caged = findPath(map, { x: 50, y: 55, z: 7 }, cage, { nodeLimit: 20000 });
        check('un destino encerrado no tiene camino, y lo dice',
            caged.found === false && caged.reason === 'unreachable',
            'exploro ' + caged.explored + ' nodos: agoto la region alcanzable');

        // El tope por defecto (2000) es menor que un mapa de 64x64, asi que una
        // busqueda larga termina en 'nodeLimit' y no en 'unreachable'. Distinguir
        // los dos motivos importa: uno dice "no hay camino" y el otro "no lo busque
        // lo suficiente", y confundirlos hace depurar en la direccion equivocada.
        const capped = findPath(map, { x: 2, y: 2, z: 7 }, cage);
        check('sin subir el tope, una busqueda larga se corta y lo dice',
            capped.found === false && capped.reason === 'nodeLimit',
            'tope por defecto agotado tras ' + capped.explored + ' nodos');
    }

    // =======================================================================
    section('7. IA de los monstruos');
    // =======================================================================

    {
        const harness = buildWorld();
        const map = harness.world.map;

        // --- Ver ---
        const monster = harness.world.createMonster('Rat', { x: 40, y: 44, z: 7 });
        check('sin jugadores cerca, no hay objetivo',
            harness.ai.think(monster).reason === 'noSpawn' ||
            monster.target === null,
            'el monstruo no tiene a quien perseguir');

        const hero = harness.world.createPlayer('Preso', { x: 40, y: 40, z: 7 });
        harness.ai.think(monster);
        check('ve a un jugador dentro del radio de vision',
            monster.target === hero,
            'a 4 casillas, el radio es ' + require('../engine/world/ai').SIGHT_RADIUS);

        // --- Fuera de vista ---
        const lejos = harness.world.createPlayer('Lejano', { x: 55, y: 55, z: 7 });
        const otro = harness.world.createMonster('Rat', { x: 40, y: 40, z: 7 });
        harness.world.removePlayer(hero.id);
        harness.ai.think(otro);
        check('no ve a un jugador fuera del radio',
            otro.target === null,
            'a 21 casillas no lo ve');

        harness.world.removePlayer(lejos.id);

        // --- Perseguir ---
        // Se retiran los monstruos de las sub-pruebas anteriores. No es solo
        // higiene: un monstruo de mas en el camino hace que el perseguidor tenga
        // que rodearlo, y entonces la prueba mediria la esquiva en vez de la
        // persecucion.
        harness.world.removeMonster(otro.id);

        const cazador = harness.world.createMonster('Rat', { x: 40, y: 45, z: 7 });
        const presa = harness.world.createPlayer('Presa', { x: 40, y: 40, z: 7 });

        const startDistance = cazador.position.distanceTo(presa.position);
        harness.ai.think(cazador);
        const afterOneStep = cazador.position.distanceTo(presa.position);

        check('persigue: se acerca al objetivo',
            afterOneStep < startDistance,
            'distancia ' + startDistance + ' -> ' + afterOneStep);

        // El paso del monstruo cuesta 1650 ms (speed 74 sobre hierba), asi que
        // sin avanzar el reloj no puede dar el siguiente.
        const blocked = harness.ai.think(cazador);
        check('respeta su propia velocidad de paso',
            cazador.position.distanceTo(presa.position) === afterOneStep,
            'no da dos pasos seguidos sin que pase el tiempo');

        // Se acerca hasta quedar contiguo y entonces ataca.
        let guard = 0;
        while (cazador.position.distanceTo(presa.position) > 1 && guard < 20) {
            advance(2000);
            harness.ai.think(cazador);
            guard += 1;
        }

        check('llega a quedar contiguo',
            cazador.position.distanceTo(presa.position) === 1,
            'en ' + guard + ' turnos, desde ' + startDistance + ' casillas');

        const healthBefore = presa.health;
        advance(2000);
        const attackResult = harness.ai.think(cazador);

        check('estando contiguo, ataca en vez de moverse',
            presa.health < healthBefore && attackResult.action === 'attack',
            'vida ' + healthBefore + ' -> ' + presa.health);

        // --- Volver a casa ---
        harness.world.removePlayer(presa.id);
        advance(3000);
        const returning = harness.ai.think(cazador);

        check('sin objetivo, vuelve a su punto de aparicion',
            returning.action === 'return' || returning.reason === 'noSpawn',
            'el cazador no tenia spawn, asi que no tiene a donde volver');

        // Con spawn declarado, si vuelve.
        const spawnEntry = { x: 20, y: 20, z: 7, monster: 'Rat', interval: 60000, radius: 0, activeMonsterId: null };
        const hogareno = harness.world.createMonster('Rat', { x: 24, y: 20, z: 7 }, spawnEntry);
        advance(3000);

        const homeDistanceBefore = hogareno.position.distanceTo({ x: 20, y: 20, z: 7 });
        harness.ai.think(hogareno);
        const homeDistanceAfter = hogareno.position.distanceTo({ x: 20, y: 20, z: 7 });

        check('con spawn declarado, se acerca a su casa',
            homeDistanceAfter < homeDistanceBefore,
            'distancia a casa ' + homeDistanceBefore + ' -> ' + homeDistanceAfter);

        // --- Los turnos se programan ---
        const scheduledBefore = harness.scheduler.size;
        check('el turno programa el siguiente',
            scheduledBefore > 0,
            scheduledBefore + ' turnos programados');
    }

    // =======================================================================
    section('8. Persecucion alrededor de un obstaculo');
    // =======================================================================

    {
        // Un muro entre el monstruo y el jugador: la IA debe rodearlo, no
        // quedarse pegado contra el.
        const harness = buildWorld();
        const map = harness.world.map;

        // Muro vertical en x=50, de y=40 a y=46.
        for (let y = 40; y <= 46; y += 1) {
            map.getOrCreateTile(50, y, 7).addItem(new Item(harness.itemTypes.get(111)));
        }

        const monster = harness.world.createMonster('Rat', { x: 51, y: 43, z: 7 });
        const hero = harness.world.createPlayer('Cebo', { x: 49, y: 43, z: 7 });

        monster.nextStepAt = 0;
        const firstThought = harness.ai.think(monster);

        check('encuentra un camino aunque el destino este ocupado',
            monster.path && monster.path.length > 0,
            'la meta de una persecucion la ocupa el perseguido: si contara como ' +
            'bloqueante, seria inalcanzable por definicion');

        check('y da el primer paso del camino',
            firstThought.moved && firstThought.moved.moved === true,
            'de ' + monster.position);

        let moved = 0;
        for (let i = 0; i < 40; i += 1) {
            advance(2000);
            const before = { x: monster.position.x, y: monster.position.y };
            harness.ai.think(monster);
            if (monster.position.x !== before.x || monster.position.y !== before.y) {
                moved += 1;
            }
            if (monster.position.distanceTo(hero.position) <= 1) {
                break;
            }
        }

        check('rodea el muro y llega hasta el jugador',
            monster.position.distanceTo(hero.position) <= 1,
            'dio ' + moved + ' pasos y acabo en ' + monster.position);

        check('nunca atraveso el muro',
            monster.position.x !== 50,
            'un monstruo no puede cortar una pared en diagonal igual que un jugador');
    }

    // =======================================================================
    section('9. La muerte del jugador');
    // =======================================================================

    {
        // El motor se configura con lo que cuesta morir. Sin castigo, morir no cuesta
        // nada y el combate deja de tener tensión.
        const harness = buildWorld();
        harness.combat.config = {
            experienceStages: [{ minlevel: 1, maxlevel: 0, multiplier: 1 }],
            healthPerLevel: 5,
            deathLosePercent: 10,
            deathDropInventory: true
        };

        const deaths = [];
        harness.world.on('onPlayerDeath', (player, killer, dropped) => {
            deaths.push({
                name: player.name,
                health: player.health,
                position: player.position.toString(),
                dropped: dropped.length
            });
        });

        const hero = harness.world.createPlayer('Mortals', { x: 40, y: 40, z: 7 });

        // El nivel y la experiencia tienen que ser COHERENTES entre si. La primera
        // version los puso a mano —nivel 30 con un millon de experiencia, que es la del
        // 39— y al recalcular el nivel desde la experiencia subia en vez de bajar. La
        // prueba estaba midiendo su propio dato inventado.
        hero.level = 30;
        hero.experience = Experience.experienceForLevel(30);
        hero.health = 100;
        hero.maxHealth = 500;

        hero.inventory.push({ slot: 'backpack', position: 0, typeId: 3031, count: 120 });
        hero.inventory.push({ slot: 'hand', position: 1, typeId: 2400, count: 1 });

        const dragon = harness.world.createMonster('Dragon', { x: 41, y: 40, z: 7 });
        dragon.target = hero;

        const before = {
            experience: hero.experience,
            level: hero.level,
            inventory: hero.inventory.length
        };

        const result = harness.combat.applyDamage(hero, 99999, { attacker: dragon });

        check('la muerte de un jugador se detecta',
            result.killed === true && hero.isDead() === false,
            'isDead() es false porque YA ha resucitado: el motor no lo deja muerto');

        check('pierde un 10% de la experiencia',
            hero.experience === Math.floor(before.experience * 0.9),
            before.experience + ' -> ' + hero.experience + ' (-' +
            (before.experience - hero.experience) + ')');

        check('y el nivel se recalcula con la experiencia que le queda',
            hero.level === Experience.levelForExperience(hero.experience, 1) &&
            hero.level < before.level,
            'nivel ' + before.level + ' -> ' + hero.level);

        check('reaparece en el templo',
            hero.position.x === 40 && hero.position.y === 40 && hero.position.z === 7,
            'en ' + hero.position + ' (el waypoint `temple` del mapa)');

        check('con la vida llena',
            hero.health === hero.maxHealth && hero.health === 500,
            hero.health + '/' + hero.maxHealth);

        check('y suelta TODO el inventario',
            hero.inventory.length === 0 &&
            result.loot.length === before.inventory,
            before.inventory + ' cosa(s) al suelo, ' + hero.inventory.length + ' en el inventario');

        check('lo soltado cae donde murio, no donde reaparece',
            result.loot.every((item) =>
                item.position && item.position.x === 40 && item.position.y === 40),
            'el jugador murio en (40,40) y reaparece en (40,40) porque el templo del ' +
            'mapa de ejemplo esta ahi; lo que importa es que se suelta ANTES de ' +
            'moverse, que es lo que hace que ir a recuperarlo sea una decision');

        check('el monstruo que lo mato deja de perseguirlo',
            dragon.target === null,
            'seguir persiguiendo a alguien que ya no esta ahi lo dejaria dando vueltas');

        check('y se avisa de la muerte, ya resucitado',
            deaths.length === 1 && deaths[0].health === 500 &&
            deaths[0].dropped === before.inventory,
            JSON.stringify(deaths[0]));

        // La estadistica de muertes causadas NO cuenta esta: que a uno le maten no es
        // una muerte que haya causado.
        check('la estadistica de muertes causadas no cuenta la propia',
            harness.combat.stats.kills === 0,
            harness.combat.stats.kills + ' muertes causadas');
    }

    {
        // Sin castigo configurado, morir solo devuelve al templo.
        const harness = buildWorld();
        harness.combat.config = {
            experienceStages: [],
            healthPerLevel: 5,
            deathLosePercent: 0,
            deathDropInventory: false
        };

        const hero = harness.world.createPlayer('Blando', { x: 40, y: 40, z: 7 });
        hero.experience = 5000;
        hero.inventory.push({ slot: 'hand', position: 0, typeId: 2400, count: 1 });

        const kept = hero.experience;

        harness.combat.handlePlayerDeath(hero, null);

        check('con el castigo apagado no se pierde experiencia ni inventario',
            hero.experience === kept && hero.inventory.length === 1,
            'util para un servidor de pruebas, y por eso es configurable');

        check('pero sigue reapareciendo vivo',
            hero.health === hero.maxHealth && hero.position.z === 7,
            hero.health + '/' + hero.maxHealth + ' en ' + hero.position);
    }

    // =======================================================================
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el mundo pelea, progresa, persigue y muere bien.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
