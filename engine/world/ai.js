'use strict';

/**
 * Inteligencia de los monstruos.
 *
 * Cada monstruo tiene su propio turno de decisión, programado en el planificador.
 * Eso es importante y es como funciona Tibia: **no hay un bucle que recorra todos
 * los monstruos**, sino un evento por monstruo. La diferencia se nota cuando hay
 * doscientos: con un bucle, un turno que se alarga retrasa a todos y el retraso se
 * acumula; con eventos, cada uno lleva su propio ritmo y el planificador los
 * reparte.
 *
 * El turno hace tres cosas, en este orden: elegir objetivo, actuar sobre él y
 * programar el siguiente turno. En ese orden y no en otro, porque programar el
 * siguiente turno antes de actuar dejaría al monstruo sin hacer nada si algo
 * falla a mitad.
 *
 * Lo que NO hace, y conviene saberlo: no usa hechizos con área, no invoca, no
 * huye cuando le queda poca salud (`runHealth`) y no dice sus frases (`voices`).
 * Todo eso está declarado en las definiciones de los monstruos y es la siguiente
 * capa; aquí está el esqueleto: ver, perseguir, golpear y volver a casa.
 */

const { findPath } = require('./pathfinding');

/** A qué distancia ve un monstruo a un jugador. */
const SIGHT_RADIUS = 8;

/** A qué distancia deja de perseguir y vuelve a su sitio. */
const CHASE_RADIUS = SIGHT_RADIUS * 2;

/**
 * A qué distancia de su punto de aparición se da por perdido y vuelve.
 *
 * En Tibia esto son dos números distintos: uno para volver andando y otro, mucho
 * mayor, para desaparecer. Aquí sólo se usa el primero; el despawn por lejanía
 * llega cuando haya muchos jugadores y haga falta.
 */
const LEASH_RADIUS = 15;

/** Cada cuánto decide un monstruo. */
const DEFAULT_THINK_INTERVAL = 250;

/** Nodos que puede explorar una búsqueda de camino de un monstruo. */
const PATH_NODE_LIMIT = 800;

class MonsterAI {
    constructor(options) {
        const opts = options || {};

        this.world = opts.world;
        this.combat = opts.combat;
        this.scheduler = opts.scheduler;
        this.log = opts.logger || null;

        this.thinkInterval = opts.thinkIntervalMs || DEFAULT_THINK_INTERVAL;
        this.sightRadius = opts.sightRadius || SIGHT_RADIUS;

        /** Monstruos que ya tienen un turno programado, para no duplicarlos. */
        this.scheduled = new Set();

        this.stats = { thinks: 0, targetsFound: 0, steps: 0, attacks: 0 };

        // Un monstruo que aparece (incluidos los que reaparecen) empieza a pensar.
        if (this.world && typeof this.world.on === 'function') {
            this.world.on('onCreatureAppear', (creature) => {
                if (creature.isMonster && creature.isMonster()) {
                    this.scheduleThink(creature);
                }
            });
        }
    }

    /** Arranca los turnos de los monstruos que ya existen. */
    start() {
        if (!this.world) {
            return 0;
        }
        let started = 0;
        this.world.monsters.forEach((monster) => {
            if (this.scheduleThink(monster)) {
                started += 1;
            }
        });
        return started;
    }

    /** Programa el siguiente turno de un monstruo, si no lo tiene ya. */
    scheduleThink(monster) {
        if (!this.scheduler || this.scheduled.has(monster.id)) {
            return false;
        }

        this.scheduled.add(monster.id);

        this.scheduler.schedule(this.thinkInterval, () => {
            this.scheduled.delete(monster.id);

            if (monster.isDead() || !this.world.getMonster(monster.id)) {
                return;
            }

            try {
                this.think(monster);
            } catch (error) {
                if (this.log) {
                    this.log.error('fallo el turno de ' + monster.name + ':\n' +
                        (error && error.stack ? error.stack : error));
                }
            }
        }, 'think-' + monster.id);

        return true;
    }

    /**
     * Un turno de decisión.
     *
     * Se expone aparte de la programación para que las pruebas puedan ejecutarlo
     * cuando quieran, sin depender del planificador ni del reloj.
     */
    think(monster) {
        if (!monster || monster.isDead()) {
            return { acted: false, reason: 'dead' };
        }

        this.stats.thinks += 1;

        const target = this._pickTarget(monster);
        monster.target = target;

        let result;
        if (target) {
            result = this._pursue(monster, target);
        } else {
            result = this._returnHome(monster);
        }

        // El siguiente turno se programa AL FINAL, cuando ya se actuó.
        this.scheduleThink(monster);
        return result;
    }

    // -----------------------------------------------------------------------
    // Elegir objetivo
    // -----------------------------------------------------------------------

    /**
     * Decide a quién persigue.
     *
     * Se conserva el objetivo anterior mientras siga siendo válido: cambiar de
     * objetivo en cada turno haría que el monstruo oscilara entre dos jugadores
     * cercanos sin llegar a alcanzar a ninguno.
     */
    _pickTarget(monster) {
        const current = monster.target;

        if (current && this._isValidTarget(monster, current)) {
            return current;
        }

        const found = this._findNearestPlayer(monster);
        if (found) {
            this.stats.targetsFound += 1;
        }
        return found;
    }

    _isValidTarget(monster, target) {
        if (!target || target.isDead()) {
            return false;
        }
        // Ya no está en el mundo: pudo desconectarse o morir.
        if (!this.world.getCreature(target.id)) {
            return false;
        }
        if (monster.position.z !== target.position.z) {
            return false;
        }
        return monster.position.distanceTo(target.position) <= CHASE_RADIUS;
    }

    /** El jugador vivo más cercano dentro del radio de visión. */
    _findNearestPlayer(monster) {
        let best = null;
        let bestDistance = Infinity;

        this.world.players.forEach((player) => {
            if (player.isDead()) {
                return;
            }
            if (player.position.z !== monster.position.z) {
                return;
            }

            const distance = monster.position.distanceTo(player.position);
            if (distance <= this.sightRadius && distance < bestDistance) {
                best = player;
                bestDistance = distance;
            }
        });

        return best;
    }

    // -----------------------------------------------------------------------
    // Actuar
    // -----------------------------------------------------------------------

    _pursue(monster, target) {
        monster.faceTowards(target.position);

        const check = this.combat.canAttack(monster, target);

        if (check.allowed) {
            const result = this.combat.attack(monster, target);
            if (result.reason !== 'outOfRange') {
                this.stats.attacks += 1;
            }
            return { acted: true, action: 'attack', target: target.id, result: result };
        }

        if (check.reason === 'outOfRange') {
            const moved = this._stepToward(monster, target.position, target);
            return { acted: true, action: 'chase', target: target.id, moved: moved };
        }

        // Enfriamiento: no hay nada que hacer este turno.
        return { acted: false, action: 'wait', reason: check.reason };
    }

    /**
     * Da un paso hacia un objetivo, siguiendo un camino.
     *
     * El camino se recalcula sólo cuando hace falta, y eso es lo que hace viable
     * tener monstruos persiguiendo: recalcularlo en cada turno serían cuatro
     * búsquedas por segundo y por monstruo. Se reutiliza mientras el objetivo no
     * se haya movido y queden pasos.
     *
     * @param {Object} goal a dónde quiere ir
     * @param {Creature} [target] a quién persigue, si es una persecución. Su casilla
     *        no cuenta como bloqueada: si contara, la meta sería inalcanzable.
     */
    _stepToward(monster, goal, target) {
        const now = this.world.now();

        // Si todavía no le toca andar, no se consume un paso del camino: gastarlo
        // aquí dejaría al monstruo «saltándose» casillas y avanzando más rápido de
        // lo que permite su velocidad.
        if (now < monster.nextStepAt) {
            return { moved: false, reason: 'exhausted' };
        }

        const path = this._pathFor(monster, goal, target);
        if (!path || path.length === 0) {
            return { moved: false, reason: 'noPath' };
        }

        const next = path[0];
        const offset = {
            x: next.x - monster.position.x,
            y: next.y - monster.position.y
        };

        const result = this.world.moveCreature(monster, offset);

        if (result.moved) {
            path.shift();
            this.stats.steps += 1;
        } else if (result.reason !== 'exhausted') {
            // El camino ya no sirve: algo se movió en medio. Se descarta para que
            // el siguiente turno lo recalcule, en vez de insistir contra un muro.
            monster.path = null;
        }

        return result;
    }

    _pathFor(monster, goal, target) {
        const goalUnchanged = monster.pathGoal &&
            Math.abs(monster.pathGoal.x - goal.x) <= 1 &&
            Math.abs(monster.pathGoal.y - goal.y) <= 1;

        if (monster.path && monster.path.length > 0 && goalUnchanged) {
            return monster.path;
        }

        const result = findPath(this.world.map, monster.position, goal, {
            nodeLimit: PATH_NODE_LIMIT,
            isBlocked: (x, y, z) => this._isOccupied(x, y, z, monster, goal, target)
        });

        monster.path = result.path;
        monster.pathGoal = { x: goal.x, y: goal.y };

        return monster.path;
    }

    /**
     * ¿Estorba una criatura en esa casilla, para planificar el camino?
     *
     * Dos casillas NO estorban, y las dos excepciones son necesarias:
     *
     *   - La del propio monstruo. Si contara, el primer paso de cualquier camino
     *     sería su propia casilla y no habría camino posible.
     *   - La del perseguido. Si contara, la meta de una persecución sería
     *     inalcanzable POR DEFINICIÓN, porque el perseguido está en ella.
     *
     * El resto de criaturas SÍ estorban, y evitarse es lo que hace que un monstruo
     * rodee a otro en vez de quedarse pegado. Sin esto, el camino se descartaba al
     * chocar, se recalculaba idéntico y el monstruo se quedaba atascado para
     * siempre: el fallo que apareció en la prueba de persecución.
     */
    _isOccupied(x, y, z, monster, goal, target) {
        if (x === monster.position.x && y === monster.position.y &&
            z === monster.position.z) {
            return false;
        }

        if (target && x === goal.x && y === goal.y && z === goal.z) {
            return false;
        }

        return this.world.hasCreatureAt(x, y, z);
    }

    /**
     * Vuelve a su punto de aparición cuando no tiene a quién perseguir.
     *
     * No se teletransporta: anda. Que un monstruo aparezca de golpe en su sitio
     * sería visible y raro, y además permitiría atravesar paredes.
     */
    _returnHome(monster) {
        const spawn = monster.spawn;
        if (!spawn) {
            return { acted: false, reason: 'noSpawn' };
        }

        const home = { x: spawn.x, y: spawn.y, z: spawn.z };
        const distance = monster.position.distanceTo(home);

        if (distance === 0) {
            return { acted: false, reason: 'atHome' };
        }

        // Si se alejó demasiado, se da por perdido y vuelve directo: perseguir a
        // alguien que ya no está a la vista durante media hora no tiene sentido.
        if (distance > LEASH_RADIUS) {
            monster.path = null;
        }

        const moved = this._stepToward(monster, home, monster);
        return { acted: true, action: 'return', moved: moved };
    }

    stop() {
        this.scheduled.clear();
    }

    snapshot() {
        return {
            ...this.stats,
            scheduled: this.scheduled.size
        };
    }
}

module.exports = { MonsterAI, SIGHT_RADIUS, CHASE_RADIUS, LEASH_RADIUS, DEFAULT_THINK_INTERVAL };
