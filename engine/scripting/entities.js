'use strict';

/**
 * Envoltorios que se pasan a los módulos de contenido.
 *
 * Son **envoltorios alrededor de un identificador**, no los objetos del mundo. La
 * diferencia no es cosmética: si un módulo recibiera el objeto real, podría
 * mutarlo sin pasar por ninguna regla —ponerse 999999 de vida, teletransportarse
 * fuera del mapa, vaciar el inventario de otro—. Con un envoltorio, todo pasa por
 * esta API y aquí se puede validar.
 *
 * La jerarquía copia la del motor: un jugador y un monstruo son las dos cosas una
 * **criatura**, y por eso comparten base. Importa en la práctica: un handler de
 * `onStepIn(creature, ...)` recibe indistintamente a cualquiera de los dos, y si
 * fueran tipos sin relación habría que duplicar cada handler o comprobar el tipo
 * a mano en todos.
 *
 * Las instancias se cachean por identificador, así que dos peticiones de la misma
 * criatura devuelven el mismo objeto y `a === b` funciona como se espera.
 */

const { Position } = require('../world/position');

/** Clase base: lo que comparten jugadores y monstruos. */
class CreatureWrapper {
    constructor(world, id) {
        this.world = world;
        this.id = id;
    }

    /** La criatura real, o null si ya no existe. Uso interno del envoltorio. */
    _creature() {
        return this.world.getCreature(this.id);
    }

    getId() {
        return this.id;
    }

    getName() {
        const creature = this._creature();
        return creature ? creature.name : null;
    }

    /** Devuelve una COPIA: mutarla no mueve a nadie hasta llamar a teleportTo. */
    getPosition() {
        const creature = this._creature();
        return creature
            ? new Position(creature.position.x, creature.position.y, creature.position.z)
            : null;
    }

    getHealth() {
        const creature = this._creature();
        return creature ? creature.health : 0;
    }

    getMaxHealth() {
        const creature = this._creature();
        return creature ? creature.maxHealth : 0;
    }

    getSpeed() {
        const creature = this._creature();
        return creature ? creature.speed : 0;
    }

    getDirection() {
        const creature = this._creature();
        return creature ? creature.direction : 0;
    }

    isPlayer() {
        return false;
    }

    isMonster() {
        return false;
    }

    isDead() {
        const creature = this._creature();
        return !creature || creature.isDead();
    }

    /** Decir algo en voz alta, para que lo oiga quien esté cerca. */
    say(text) {
        this.world.creatureSay(this.id, String(text));
        return this;
    }

    toString() {
        return this.constructor.name + '(' + this.id + ', ' + this.getName() + ')';
    }
}

class PlayerWrapper extends CreatureWrapper {
    isPlayer() {
        return true;
    }

    getLevel() {
        const player = this.world.getPlayer(this.id);
        return player ? player.level : 0;
    }

    getVocation() {
        const player = this.world.getPlayer(this.id);
        return player ? player.vocation : null;
    }

    /** Mensaje privado, sólo para este jugador. */
    sendTextMessage(text) {
        this.world.sendTextMessage(this.id, String(text));
        return this;
    }

    teleportTo(position) {
        if (!position) {
            return false;
        }
        return this.world.teleportPlayer(this.id, position.x, position.y, position.z);
    }
}

class MonsterWrapper extends CreatureWrapper {
    isMonster() {
        return true;
    }

    /** La definición del tipo, tal y como se registró en data/monsters. */
    getMonsterType() {
        const monster = this.world.getMonster(this.id);
        return monster ? monster.monsterType : null;
    }

    getExperience() {
        const monster = this.world.getMonster(this.id);
        return monster ? monster.experience : 0;
    }

    getLoot() {
        const monster = this.world.getMonster(this.id);
        return monster ? monster.loot : [];
    }

    getTargetId() {
        const monster = this.world.getMonster(this.id);
        return monster && monster.target ? monster.target.id : null;
    }
}

class ItemWrapper {
    /**
     * @param {number} instanceId identificador de la INSTANCIA, o 0
     * @param {number} [typeId] identificador del TIPO
     *
     * Los dos identificadores son distintos y hay eventos en los que el motor
     * conoce sólo uno. En un movimiento, el evento se registra por TIPO de item
     * (el 2376), pero el item que hay en el suelo es una INSTANCIA con su uid.
     * Sin poder declarar el tipo explícitamente, `getName()` devuelve null en esos
     * handlers.
     */
    constructor(world, instanceId, typeId) {
        this.world = world;
        this.uid = instanceId;
        this.typeId = (typeId === undefined || typeId === null) ? null : typeId;
    }

    _item() {
        return this.world.getItem(this.uid);
    }

    getUniqueId() {
        return this.uid;
    }

    getId() {
        if (this.typeId !== null) {
            return this.typeId;
        }
        const item = this._item();
        return item ? item.typeId : 0;
    }

    getCount() {
        const item = this._item();
        return item ? item.count : 1;
    }

    getName() {
        const definition = this.world.itemTypes.get(this.getId());
        return definition ? definition.name : null;
    }

    getAttribute(key) {
        const item = this._item();
        if (item) {
            const own = item.getAttribute(key);
            if (own !== undefined) {
                return own;
            }
        }
        const definition = this.world.itemTypes.get(this.getId());
        if (!definition || !definition.attributes) {
            return undefined;
        }
        return definition.attributes[key];
    }

    remove() {
        return this.world.removeItem(this.uid);
    }

    toString() {
        return 'Item(' + this.uid + ', ' + this.getName() + ')';
    }
}

/**
 * Crea envoltorios con caché por identificador.
 *
 * La caché es por motor y no global: dos motores en el mismo proceso (por ejemplo
 * dos pruebas) no deben compartir envoltorios.
 */
class EntityFactory {
    constructor(world) {
        this.world = world;
        this.creatures = new Map();
        this.items = new Map();
    }

    /**
     * Devuelve el envoltorio que corresponde: jugador o monstruo.
     *
     * Es lo que permite que un handler de movimiento reciba al que de verdad pisó
     * el tile, sin que el módulo de contenido tenga que averiguarlo.
     */
    creature(id) {
        const key = Number(id) || 0;
        let existing = this.creatures.get(key);

        if (!existing) {
            existing = this.world.getPlayer(key)
                ? new PlayerWrapper(this.world, key)
                : new MonsterWrapper(this.world, key);
            this.creatures.set(key, existing);
        }

        return existing;
    }

    /** Igual que `creature`, pero deja claro en el código que se espera uno. */
    player(id) {
        return this.creature(id);
    }

    monster(id) {
        return this.creature(id);
    }

    item(instanceId, typeId) {
        const key = Number(instanceId) || 0;
        const type = (typeId === undefined || typeId === null) ? null : Number(typeId);

        // Si se declara el tipo explícitamente y no hay instancia, la caché por
        // uid no sirve: el mismo uid=0 se reutilizaría para todos los tipos.
        if (type !== null && key === 0) {
            return new ItemWrapper(this.world, key, type);
        }

        let existing = this.items.get(key);
        if (!existing) {
            existing = new ItemWrapper(this.world, key, type);
            this.items.set(key, existing);
        }
        return existing;
    }

    position(x, y, z) {
        return new Position(x, y, z);
    }
}

module.exports = {
    CreatureWrapper,
    PlayerWrapper,
    MonsterWrapper,
    ItemWrapper,
    EntityFactory,
    Position
};
