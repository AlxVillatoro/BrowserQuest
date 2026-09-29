'use strict';

/**
 * Entidades que se pasan a los scripts.
 *
 * Son **envoltorios alrededor de un identificador**, no los objetos del mundo.
 * La diferencia no es cosmética: si un script recibiera el objeto real, podría
 * mutarlo sin pasar por ninguna regla —ponerse 999999 de vida, teletransportarse
 * fuera del mapa, vaciar el inventario de otro—. Con un envoltorio, todo lo que
 * hace un script pasa por esta API, y aquí se puede validar.
 *
 * En la etapa anterior esto se hacía con metatablas de Lua y costaba entre 2x y
 * 4x. En JavaScript es una clase normal y no cuesta nada extra: el envoltorio y
 * la llamada directa son lo mismo. Ésa es la ventaja concreta de haber dejado
 * Lua, más allá de quitar un lenguaje del proyecto.
 *
 * Las instancias se cachean por identificador, así que dos peticiones del mismo
 * jugador devuelven el mismo objeto y `a === b` funciona como se espera.
 */

class Position {
    constructor(x, y, z) {
        this.x = Number(x) || 0;
        this.y = Number(y) || 0;
        this.z = Number(z) || 0;
    }

    /**
     * En Tibia las escaleras no son geometría: subir de planta es incrementar la
     * coordenada Z. Por eso esto es aritmética y no una consulta al mapa.
     */
    moveUpstairs() {
        this.z += 1;
        return this;
    }

    moveDownstairs() {
        this.z -= 1;
        return this;
    }

    isZero() {
        return this.x === 0 && this.y === 0 && this.z === 0;
    }

    equals(other) {
        return !!other && this.x === other.x && this.y === other.y && this.z === other.z;
    }

    copy() {
        return new Position(this.x, this.y, this.z);
    }

    toString() {
        return '(' + this.x + ', ' + this.y + ', ' + this.z + ')';
    }

    toJSON() {
        return { x: this.x, y: this.y, z: this.z };
    }
}

class Player {
    constructor(world, id) {
        this.world = world;
        this.id = id;
    }

    getId() {
        return this.id;
    }

    getName() {
        const player = this.world.getPlayer(this.id);
        return player ? player.name : null;
    }

    /** Devuelve una COPIA: mutarla no mueve al jugador hasta llamar a teleportTo. */
    getPosition() {
        const player = this.world.getPlayer(this.id);
        if (!player) {
            return null;
        }
        return new Position(player.position.x, player.position.y, player.position.z);
    }

    getHealth() {
        const player = this.world.getPlayer(this.id);
        return player ? player.health : 0;
    }

    getMaxHealth() {
        const player = this.world.getPlayer(this.id);
        return player ? player.maxHealth : 0;
    }

    getLevel() {
        const player = this.world.getPlayer(this.id);
        return player ? player.level : 0;
    }

    getVocation() {
        const player = this.world.getPlayer(this.id);
        return player ? player.vocation : null;
    }

    sendTextMessage(text) {
        this.world.sendTextMessage(this.id, String(text));
    }

    teleportTo(position) {
        if (!position) {
            return false;
        }
        return this.world.teleportPlayer(this.id, position.x, position.y, position.z);
    }

    toString() {
        return 'Player(' + this.id + ', ' + this.getName() + ')';
    }
}

class Item {
    /**
     * @param {number} uid identificador de la INSTANCIA, o 0 si no hay ninguna
     * @param {number} [typeId] identificador del TIPO
     *
     * Los dos identificadores son distintos y hay eventos en los que el motor
     * conoce sólo uno. En un movimiento, por ejemplo, el evento se registra por
     * TIPO de item (el 2376), pero el item que hay en el suelo es una INSTANCIA
     * con su propio uid. Sin poder declarar el tipo explícitamente, `getName()`
     * devolvía null en esos handlers.
     */
    constructor(world, uid, typeId) {
        this.world = world;
        this.uid = uid;
        this.typeId = (typeId === undefined || typeId === null) ? null : typeId;
    }

    getUniqueId() {
        return this.uid;
    }

    getId() {
        if (this.typeId !== null) {
            return this.typeId;
        }
        const item = this.world.getItem(this.uid);
        return item ? item.itemId : 0;
    }

    getCount() {
        const item = this.world.getItem(this.uid);
        return item ? item.count : 0;
    }

    getName() {
        const definition = this.world.itemTypes.get(this.getId());
        return definition ? definition.name : null;
    }

    getAttribute(key) {
        const definition = this.world.itemTypes.get(this.getId());
        if (!definition || !definition.attributes) {
            return undefined;
        }
        return definition.attributes[key];
    }

    remove() {
        return this.world.items.delete(this.uid);
    }

    toString() {
        return 'Item(' + this.uid + ', ' + this.getName() + ')';
    }
}

/**
 * Crea envoltorios con caché por identificador.
 *
 * La caché es por motor, no global: dos motores en el mismo proceso (por ejemplo
 * dos tests, o dos mundos) no deben compartir envoltorios.
 */
class EntityFactory {
    constructor(world) {
        this.world = world;
        this.players = new Map();
        this.items = new Map();
    }

    player(id) {
        const key = Number(id) || 0;
        let existing = this.players.get(key);
        if (!existing) {
            existing = new Player(this.world, key);
            this.players.set(key, existing);
        }
        return existing;
    }

    /**
     * @param {number} uid identificador de instancia (0 si no hay)
     * @param {number} [typeId] identificador de tipo, para cuando sólo se conoce ése
     */
    item(uid, typeId) {
        const key = Number(uid) || 0;
        const type = (typeId === undefined || typeId === null) ? null : Number(typeId);

        // Si se declara el tipo explícitamente, la caché por uid no sirve: el
        // mismo uid=0 se reutilizaría para todos los tipos.
        if (type !== null && key === 0) {
            return new Item(this.world, key, type);
        }

        let existing = this.items.get(key);
        if (!existing) {
            existing = new Item(this.world, key, type);
            this.items.set(key, existing);
        }
        return existing;
    }

    position(x, y, z) {
        return new Position(x, y, z);
    }
}

module.exports = { Position, Player, Item, EntityFactory };
