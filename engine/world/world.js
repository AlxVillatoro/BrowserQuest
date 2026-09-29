'use strict';

/**
 * Estado del mundo.
 *
 * El motor es el único dueño de esto: los módulos de contenido nunca reciben
 * estos objetos, sólo envoltorios con identificadores, y piden los datos a través
 * de la API. Eso es lo que hace que un módulo no pueda corromper el estado por
 * accidente, y es la razón de que en The Forgotten Server `player` sea un userdata
 * que apunta a la criatura en vez de una copia.
 *
 * De momento es un esqueleto: lo justo para que la capa de scripting tenga algo
 * real contra lo que despachar. El mapa, los tiles y el resto del mundo llegan
 * en la siguiente fase.
 */

let nextEntityId = 1;

class World {
    constructor(options) {
        this.log = options.logger;
        this.players = new Map();      // id -> { id, name, position, health, level, vocation }
        this.items = new Map();        // id -> { id, itemId, name, count, position }
        this.itemTypes = new Map();    // itemId -> definición de items.xml
        this.monsterTypes = new Map(); // nombre -> definición registrada por el contenido

        /**
         * La geometría del mundo. La carga el motor y vive aquí porque es estado
         * del mundo, no configuración: los items se caen al suelo, las puertas se
         * abren y los tiles cambian mientras el servidor corre.
         */
        this.map = null;

        // Registro de lo que hacen los scripts, para poder verificar en las
        // pruebas sin tener que espiar por dentro del estado del mundo.
        this.messages = [];
        this.teleports = [];

        this.startTime = Date.now();
    }

    // -- jugadores ----------------------------------------------------------

    createPlayer(name, position) {
        const id = nextEntityId++;
        const player = {
            id: id,
            name: name,
            position: { x: position.x, y: position.y, z: position.z },
            health: 150,
            maxHealth: 150,
            level: 1,
            vocation: 'None'
        };
        this.players.set(id, player);
        return player;
    }

    getPlayer(id) {
        return this.players.get(id) || null;
    }

    removePlayer(id) {
        return this.players.delete(id);
    }

    // -- items --------------------------------------------------------------

    createItem(itemId, count, position) {
        const type = this.itemTypes.get(itemId);
        const id = nextEntityId++;
        const item = {
            id: id,
            itemId: itemId,
            name: type ? type.name : 'unknown',
            count: count || 1,
            position: position ? { x: position.x, y: position.y, z: position.z } : null
        };
        this.items.set(id, item);
        return item;
    }

    getItem(id) {
        return this.items.get(id) || null;
    }

    // -- efectos observables -------------------------------------------------

    sendTextMessage(playerId, text) {
        const player = this.getPlayer(playerId);
        this.messages.push({
            playerId: playerId,
            playerName: player ? player.name : null,
            text: text
        });
    }

    teleportPlayer(playerId, x, y, z) {
        const player = this.getPlayer(playerId);
        if (!player) {
            return false;
        }
        this.teleports.push({ playerId: playerId, from: { ...player.position }, to: { x, y, z } });
        player.position = { x: x, y: y, z: z };
        return true;
    }

    getWorldTime() {
        // En TFS el tiempo del mundo avanza a razón de un minuto de juego por
        // segundo real. Aquí basta con que sea monótono y determinista.
        return Math.floor((Date.now() - this.startTime) / 1000);
    }
}

module.exports = { World };
