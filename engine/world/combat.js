'use strict';

/**
 * Combate.
 *
 * El SISTEMA es fiel a Tibia: los ataques se declaran en la definición del
 * monstruo con su alcance, su probabilidad y su intervalo; las resistencias
 * elementales se declaran por tipo y porcentaje; la muerte reparte botín y
 * experiencia. Todo eso está verificado en la estructura real de las definiciones
 * (`monster.attacks`, `monster.elements`, `monster.defenses`, `monster.loot`).
 *
 * La FÓRMULA de daño NO está verificada contra el código de TFS, y se dice en voz
 * alta en vez de disimularlo. Está aislada en `DEFAULT_FORMULAS` y el motor la
 * acepta inyectada, así que sustituirla por la real es cambiar un objeto, no
 * tocar el combate. Mientras tanto, la forma es la correcta: daño base del
 * atacante, menos reducción por armadura del objetivo, ajustado por su
 * resistencia elemental.
 *
 * Los porcentajes elementales se leen como en Tibia:
 *   percent = 100   -> inmune (el daño se anula)
 *   percent = 25    -> resistente, un 25% menos
 *   percent = -12   -> débil, un 12% MÁS de daño
 */

const { levelForExperience, experienceToNextLevel, applyExperienceStages } =
    require('./experience');

/** Probabilidad de botín expresada sobre 100.000, como en Tibia. */
const LOOT_CHANCE_BASE = 100000;

/**
 * Fórmulas por defecto.
 *
 * Inyectables a propósito: son la parte que hay que sustituir cuando se verifique
 * la de TFS, y tenerlas aparte evita que ese cambio toque la lógica de combate.
 */
const DEFAULT_FORMULAS = {

    /** Cuánto daño base hace un atacante. */
    baseDamage(attacker, random) {
        const profile = attackProfile(attacker);
        if (!profile) {
            return 0;
        }
        const min = Math.abs(profile.minDamage || 0);
        const max = Math.abs(profile.maxDamage === undefined ? min : profile.maxDamage);
        if (max <= min) {
            return min;
        }
        return min + Math.floor(random() * (max - min + 1));
    },

    /**
     * Reducción por armadura del objetivo.
     *
     * Aproximación documentada: en Tibia la armadura reduce un valor aleatorio y
     * la defensa da probabilidad de bloqueo, con una fórmula que no se ha
     * verificado. Aquí la armadura reduce hasta la mitad de su valor, y siempre
     * queda al menos un punto de daño: un golpe que no hace nada no se distingue
     * de un fallo y confunde al que juega.
     */
    armorReduction(target, random) {
        const armor = targetArmor(target);
        if (armor <= 0) {
            return 0;
        }
        return Math.floor(random() * (Math.floor(armor / 2) + 1));
    },

    /** Multiplicador por resistencia o debilidad elemental. */
    elementMultiplier(target, element) {
        if (!element) {
            return 1;
        }
        const percent = elementPercent(target, element);
        if (percent === 0) {
            return 1;
        }
        return Math.max(0, 1 - (percent / 100));
    }
};

// ---------------------------------------------------------------------------
// Lectura de perfiles
// ---------------------------------------------------------------------------

/** El ataque que usa una criatura ahora mismo, o null. */
function attackProfile(creature) {
    if (!creature) {
        return null;
    }

    // Un monstruo declara sus ataques; el primero es el cuerpo a cuerpo.
    if (creature.isMonster && creature.isMonster()) {
        const definition = creature.monsterType;
        if (definition && Array.isArray(definition.attacks) && definition.attacks.length > 0) {
            return definition.attacks[0];
        }
        return null;
    }

    // Un jugador ataca con su arma. El "perfil" sale de los atributos del arma,
    // que es lo que declara items.xml.
    if (creature.isPlayer && creature.isPlayer()) {
        const attack = creature.weaponAttack || 0;
        const skill = creature.attackSkill === undefined ? 10 : creature.attackSkill;
        return { minDamage: Math.floor(attack / 2), maxDamage: attack + skill };
    }

    return null;
}

/** Armadura del objetivo, venga de un monstruo o de un jugador. */
function targetArmor(target) {
    if (!target) {
        return 0;
    }

    if (target.isMonster && target.isMonster()) {
        const defenses = target.monsterType && target.monsterType.defenses;
        return defenses && defenses.armor ? Number(defenses.armor) : 0;
    }

    return Number(target.armorLevel || 0);
}

/**
 * Porcentaje elemental del objetivo para un tipo de daño.
 *
 * Los tipos se nombran en minúscula (`fire`, `ice`...) en vez de usar las
 * constantes `COMBAT_*` de Tibia, porque en JavaScript no existen y crear treinta
 * constantes globales para esto no aporta nada.
 */
function elementPercent(target, element) {
    if (!target) {
        return 0;
    }

    const list = (target.isMonster && target.isMonster() && target.monsterType)
        ? target.monsterType.elements
        : target.elements;

    if (!Array.isArray(list)) {
        return 0;
    }

    const entry = list.find((item) =>
        String(item.type).toLowerCase().replace('combat_', '').replace('damage', '') ===
        String(element).toLowerCase());

    return entry && entry.percent !== undefined ? Number(entry.percent) : 0;
}

// ---------------------------------------------------------------------------
// Combate
// ---------------------------------------------------------------------------

class Combat {
    constructor(options) {
        const opts = options || {};

        this.world = opts.world;
        this.scheduler = opts.scheduler || null;
        this.log = opts.logger || null;
        this.random = opts.random || Math.random;
        this.formulas = { ...DEFAULT_FORMULAS, ...(opts.formulas || {}) };
        this.config = opts.config || {};

        /** Registro de golpes, para las pruebas y para depurar. */
        this.hits = [];

        this.stats = { attacks: 0, hits: 0, misses: 0, kills: 0 };
    }

    // -----------------------------------------------------------------------
    // Alcance y enfriamiento
    // -----------------------------------------------------------------------

    /**
     * ¿Puede el atacante golpear al objetivo ahora mismo?
     *
     * Se distinguen los motivos igual que en el movimiento: "fuera de alcance" es
     * un rechazo, "todavía no le toca" es el ritmo normal del juego.
     */
    canAttack(attacker, target) {
        if (!attacker || !target) {
            return { allowed: false, reason: 'noTarget' };
        }
        if (attacker.isDead() || target.isDead()) {
            return { allowed: false, reason: 'dead' };
        }
        if (this.world && !this.world.map.canSee(attacker.position.z, target.position.z)) {
            return { allowed: false, reason: 'differentFloor' };
        }

        const range = this.attackRange(attacker);
        if (attacker.position.distanceTo(target.position) > range) {
            return { allowed: false, reason: 'outOfRange' };
        }

        const now = this.world ? this.world.now() : Date.now();
        if (now < (attacker.nextAttackAt || 0)) {
            return { allowed: false, reason: 'exhausted', waitMs: attacker.nextAttackAt - now };
        }

        return { allowed: true, reason: null };
    }

    /** Alcance del ataque principal de una criatura. */
    attackRange(attacker) {
        const profile = attackProfile(attacker);
        if (profile && profile.range !== undefined) {
            return Number(profile.range);
        }
        // El cuerpo a cuerpo de Tibia alcanza las cuatro casillas contiguas,
        // incluida la diagonal.
        return 1;
    }

    /**
     * Resuelve un ataque completo: comprueba, calcula el daño, lo aplica y
     * devuelve lo que pasó.
     */
    attack(attacker, target) {
        const check = this.canAttack(attacker, target);
        if (!check.allowed) {
            return { hit: false, reason: check.reason };
        }

        const now = this.world ? this.world.now() : Date.now();
        const profile = attackProfile(attacker);
        const interval = profile && profile.interval ? Number(profile.interval) : 2000;

        attacker.nextAttackAt = now + interval;
        if (attacker.target === undefined) {
            attacker.target = target;
        }

        this.stats.attacks += 1;

        // La probabilidad del ataque es lo que hace que un monstruo no use todas
        // sus habilidades a la vez.
        const chance = profile && profile.chance !== undefined ? Number(profile.chance) : 100;
        if (this.random() * 100 >= chance) {
            this.stats.misses += 1;
            return { hit: false, reason: 'chance' };
        }

        const raw = this.formulas.baseDamage(attacker, this.random);
        const element = (profile && profile.element) || null;

        return this.applyDamage(target, raw, {
            attacker: attacker,
            element: element
        });
    }

    /**
     * Aplica daño a una criatura, con armadura y resistencias, y resuelve la
     * muerte si la salud llega a cero.
     *
     * @returns {{hit: boolean, damage: number, killed: boolean, loot: Array}}
     */
    applyDamage(target, rawDamage, options) {
        const opts = options || {};

        if (!target || target.isDead()) {
            return { hit: false, damage: 0, killed: false, loot: [] };
        }

        const element = opts.element || null;
        const multiplier = this.formulas.elementMultiplier(target, element);
        const reduction = this.formulas.armorReduction(target, this.random);

        // El mínimo de 1 punto tiene una excepcion: la INMUNIDAD. Una resistencia
        // del 100% debe anular el golpe por completo, y aplicar el minimo haria que
        // un dragon inmune al fuego recibiera un punto de daño por cada bola de
        // fuego, que es peor que no hacer nada porque ademas envenena. La
        // inmunidad se comprueba ANTES del minimo, no despues.
        let damage;
        if (multiplier <= 0) {
            damage = 0;
        } else {
            damage = Math.max(1, Math.floor((rawDamage * multiplier) - reduction));
        }

        target.damage(damage);

        this.stats.hits += 1;
        this.hits.push({
            attackerId: opts.attacker ? opts.attacker.id : null,
            targetId: target.id,
            targetName: target.name,
            raw: rawDamage,
            damage: damage,
            element: element,
            multiplier: multiplier,
            remaining: target.health
        });

        // El objetivo se defiende: un monstruo al que pegan pasa a perseguir a
        // quien le pegó, que es lo que espera cualquiera que ataque a distancia.
        if (target.isMonster && target.isMonster() && opts.attacker) {
            target.target = opts.attacker;
        }

        const result = {
            hit: true,
            damage: damage,
            element: element,
            multiplier: multiplier,
            killed: false,
            loot: []
        };

        if (target.isDead()) {
            result.killed = true;
            result.loot = this.handleDeath(target, opts.attacker);
        }

        return result;
    }

    // -----------------------------------------------------------------------
    // Muerte
    // -----------------------------------------------------------------------

    /**
     * Resuelve la muerte de una criatura: reparte botín, da experiencia y avisa.
     *
     * @returns {Array} los items que cayeron al suelo
     */
    handleDeath(target, killer) {
        // Un JUGADOR que muere no es un monstruo que muere, y el camino se separa aquí.
        // Antes de esto, un jugador a cero de vida se quedaba en el mundo con la barra
        // vacía y sin que pasara nada: el combate no tenía conclusión para él.
        //
        // El contador de muertes NO se toca en este camino: que a uno le maten no es una
        // muerte que hayas causado, y sumarla haría que las estadísticas dijeran lo
        // contrario de lo que pasó.
        if (target.isPlayer && target.isPlayer()) {
            return this.handlePlayerDeath(target, killer);
        }

        this.stats.kills += 1;

        const dropped = target.isMonster && target.isMonster()
            ? this.dropLoot(target)
            : [];

        if (killer && killer.isPlayer && killer.isPlayer() && target.isMonster && target.isMonster()) {
            this.grantExperience(killer, target);
        }

        // `onKill` y `onDeath` se avisan ANTES de quitar al monstruo del mundo.
        //
        // El orden importa: los envoltorios que reciben los handlers resuelven la
        // criatura contra el mundo, asi que si ya se hubiera quitado, un handler
        // de muerte veria `getName() === null`. Es tambien el orden de TFS, donde
        // la criatura sigue siendo valida durante la llamada.
        if (this.world) {
            this.world.emit('onKill', killer || null, target);
            this.world.emit('onDeath', target, killer || null, dropped);
        }

        // Y quitarlo del mundo es lo ULTIMO, porque eso dispara `onMonsterDeath`,
        // que es lo que hace reaparecer al monstruo. Si se quitara antes, el
        // gestor de spawns empezaria a contar el tiempo de reaparicion mientras
        // los handlers de muerte todavia se estan ejecutando.
        if (target.isMonster && target.isMonster() && this.world) {
            this.world.killMonster(target.id, killer || null);
        }

        return dropped;
    }

    /**
     * Resuelve la muerte de un jugador.
     *
     * LAS TRES COSAS QUE PASAN, y por qué cada una:
     *
     * 1. PIERDE EXPERIENCIA, un porcentaje configurable. Sin castigo, morir no cuesta
     *    nada y el combate deja de tener tensión; es la razón de que en Tibia importe
     *    no morir.
     * 2. SUELTA EL INVENTARIO en el sitio donde cayó. Es lo que hace Tibia, y es lo que
     *    convierte recoger cosas en una decisión: llevarlo todo encima tiene un precio.
     *    Se puede apagar con `deathDropInventory`, porque para un servidor de pruebas es
     *    molesto.
     * 3. REAPARECE en el templo con la vida llena. Es lo único que puede hacer: dejarlo
     *    a cero de vida en el sitio sería dejarlo atrapado sin poder jugar.
     *
     * @returns {Array} lo que soltó
     */
    handlePlayerDeath(player, killer) {
        const dropped = [];

        // --- 1. La experiencia ---
        const percent = this.config.deathLosePercent === undefined
            ? 10 : Number(this.config.deathLosePercent);

        if (percent > 0 && player.experience > 0) {
            const lost = Math.floor(player.experience * percent / 100);
            player.experience = Math.max(0, player.experience - lost);
            player.level = levelForExperience(player.experience, 1);
        }

        // --- 2. El inventario ---
        if (this.config.deathDropInventory !== false &&
            player.inventory instanceof Array && player.inventory.length > 0) {

            // Se sueltan TODOS, y se hace con una copia porque `dropItem` va quitando
            // del inventario mientras se recorre.
            const count = player.inventory.length;
            for (let index = 0; index < count; index += 1) {
                const result = this.world.dropItem(player, 0);
                if (result.ok) {
                    dropped.push(result.item);
                }
            }
        }

        // --- 3. Reaparecer ---
        const temple = this.world.map ? this.world.map.getWaypoint('temple') : null;
        const spawn = this.config.templePosition ||
            (temple ? { x: temple.x, y: temple.y, z: temple.z } : null);

        if (spawn) {
            this.world.teleportCreature(player, spawn);
        }

        player.health = player.maxHealth;
        player.nextStepAt = this.world.now();
        player.nextAttackAt = this.world.now();

        // El objetivo del monstruo que lo mató deja de tener sentido: el jugador ya no
        // está donde estaba, y seguir persiguiendo un recuerdo lo dejaría dando vueltas.
        this.world.creatures.forEach((creature) => {
            if (creature.target === player) {
                creature.target = null;
            }
        });

        /*
         * Se avisa DESPUÉS de resucitarlo, y ese orden importa: quien escuche el aviso
         * y mire al jugador tiene que verlo vivo y en el templo, no a cero de vida y en
         * el sitio donde cayó. Un manejador que intente curarlo o moverlo se encontraría
         * con un muerto, que es lo que se quiere evitar.
         */
        this.world.emit('onDeath', player, killer || null, dropped);
        this.world.emit('onPlayerDeath', player, killer || null, dropped);

        return dropped;
    }

    /**
     * Tira el botín del monstruo.
     *
     * La probabilidad se expresa sobre 100.000, igual que en Tibia, así que
     * `chance: 40000` es un 40% y `1180` es un 1,18%. Se copia la convención en
     * vez de usar porcentajes normales porque los datapacks existentes están
     * escritos así y traducirlos al importarlos sería una fuente de errores.
     *
     * PENDIENTE: en Tibia el botín va dentro de un **cadáver** (un contenedor que
     * hay que abrir), no suelto en el suelo. Eso llega con el inventario; mientras
     * tanto cae al suelo, que es lo que hace el juego con los objetos cuando no hay
     * cadáver.
     */
    dropLoot(monster) {
        const dropped = [];
        const loot = monster.loot;

        if (!Array.isArray(loot) || !this.world) {
            return dropped;
        }

        loot.forEach((entry) => {
            const chance = entry.chance === undefined ? LOOT_CHANCE_BASE : Number(entry.chance);
            if (this.random() * LOOT_CHANCE_BASE >= chance) {
                return;
            }

            const typeId = entry.id !== undefined
                ? Number(entry.id)
                : this.world.itemTypes.size
                    ? this._typeIdByName(entry.name)
                    : null;

            if (!typeId) {
                if (this.log) {
                    this.log.warning('botin con un item que no existe: ' +
                        JSON.stringify(entry.name || entry.id));
                }
                return;
            }

            const count = entry.maxCount === undefined
                ? 1
                : 1 + Math.floor(this.random() * Number(entry.maxCount));

            const item = this.world.createItem(typeId, count, monster.position);
            if (item) {
                dropped.push(item);
            }
        });

        return dropped;
    }

    /** Busca el id de un item por su nombre, que es como lo declara el botín. */
    _typeIdByName(name) {
        if (!name || !this.world) {
            return null;
        }
        const wanted = String(name).toLowerCase();

        for (const [id, definition] of this.world.itemTypes) {
            if (definition.name && definition.name.toLowerCase() === wanted) {
                return id;
            }
        }
        return null;
    }

    /**
     * Da experiencia al que mató, aplicando las etapas si están configuradas.
     *
     * También comprueba la subida de nivel: la experiencia es acumulada, así que
     * subir es una sola comparación por nivel ganado, sin sumar tramos.
     */
    grantExperience(player, monster) {
        const base = monster.experience;
        if (base <= 0) {
            return { gained: 0, levels: 0 };
        }

        const stages = this.config.experienceStages;
        const gained = applyExperienceStages(base, player.level, stages);

        player.experience = (player.experience || 0) + gained;

        const oldLevel = player.level;
        const newLevel = levelForExperience(player.experience, player.level);
        const levels = newLevel - player.level;

        if (levels > 0) {
            player.level = newLevel;
            // La salud máxima sube con el nivel, y se cura la diferencia: es lo
            // que hace Tibia y lo que espera cualquiera al subir.
            const perLevel = Number(this.config.healthPerLevel || 5);
            player.maxHealth += perLevel * levels;
            player.health = player.maxHealth;

            // Se avisa con la firma de TFS: (jugador, habilidad, nivel anterior,
            // nivel nuevo). La habilidad es siempre 'level' porque las demas
            // (espada, escudo, magia) todavia no se entrenan.
            if (this.world) {
                this.world.emit('onAdvance', player, 'level', oldLevel, newLevel);
            }
        }

        return { gained: gained, levels: levels, experience: player.experience };
    }
}

module.exports = {
    Combat,
    DEFAULT_FORMULAS,
    attackProfile,
    targetArmor,
    elementPercent,
    LOOT_CHANCE_BASE
};
