'use strict';

/**
 * Tile: una celda del mundo.
 *
 * Su razón de ser es el **apilado**: en un mismo tile puede haber suelo, varios
 * items y varias criaturas, y el orden en que se dibujan es lo que hace que el
 * juego se vea bien o roto. Ese orden es el `stackpos`.
 *
 * El modelo es el del servidor de Tibia, que es más simple de lo que parece: el
 * suelo es aparte, y el resto de items se reparten entre los que van DEBAJO de
 * las criaturas y los que van ENCIMA. El cliente dibuja en ese orden y así se
 * resuelve el solapamiento **sin ningún z-buffer**.
 *
 *     de abajo a arriba:  suelo -> items de abajo -> criaturas -> items de arriba
 *
 * Que el suelo sea un item aparte y no "el primero de la pila" no es un detalle:
 * hay exactamente uno, siempre está abajo del todo, y las reglas de si se puede
 * caminar dependen de él de forma distinta a los demás.
 */

/**
 * Tope de posiciones de apilado que el protocolo puede direccionar.
 *
 * No es una limitación del motor sino del protocolo de Tibia: cuando el cliente
 * quiere coger o usar algo de un tile, lo identifica por su índice, y ese índice
 * viaja en un byte. Más allá de 10 posiciones, lo que haya encima es inalcanzable
 * para el jugador.
 */
const MAX_STACKPOS = 10;

/** Banderas del tile. Son del tile, no del item: afectan a la zona, no al objeto. */
const TILE_FLAGS = {
    PROTECTION_ZONE: 1,   // nadie puede atacar a nadie aquí
    NO_PVP: 2,
    NO_LOGOUT: 4,
    PVP_ZONE: 8,
    HOUSE: 16
};

class Tile {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;

        this.ground = null;
        this.downItems = [];
        this.creatures = [];
        this.topItems = [];

        this.flags = 0;
        this.houseId = 0;
    }

    // -----------------------------------------------------------------------
    // Contenido
    // -----------------------------------------------------------------------

    setGround(item) {
        if (item) {
            item.position = { x: this.x, y: this.y, z: this.z };
        }
        this.ground = item;
        return this;
    }

    /**
     * Añade un item a la banda que le corresponde según su definición.
     *
     * Los de la misma banda se ordenan por inserción: el primero queda más abajo.
     * Es lo que hace que un item puesto encima de otro se dibuje encima, que es
     * lo que espera cualquiera que juegue.
     */
    addItem(item) {
        if (!item) {
            return this;
        }

        item.position = { x: this.x, y: this.y, z: this.z };

        switch (item.getStackBand()) {
            case 'ground':
                this.setGround(item);
                break;
            case 'top':
                this.topItems.push(item);
                break;
            default:
                this.downItems.push(item);
        }
        return this;
    }

    removeItem(item) {
        const bands = [this.downItems, this.topItems];
        for (const band of bands) {
            const index = band.indexOf(item);
            if (index !== -1) {
                band.splice(index, 1);
                return true;
            }
        }
        if (this.ground === item) {
            this.ground = null;
            return true;
        }
        return false;
    }

    addCreature(creature) {
        if (creature && this.creatures.indexOf(creature) === -1) {
            creature.position = { x: this.x, y: this.y, z: this.z };
            this.creatures.push(creature);
        }
        return this;
    }

    removeCreature(creature) {
        const index = this.creatures.indexOf(creature);
        if (index !== -1) {
            this.creatures.splice(index, 1);
            return true;
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Apilado
    // -----------------------------------------------------------------------

    /**
     * La pila completa, de abajo arriba, tal y como debe dibujarse.
     *
     * Éste es el orden que consume el cliente. Se devuelve entero a propósito: el
     * límite de `MAX_STACKPOS` afecta a lo que el jugador puede *seleccionar*, no
     * a lo que se ve.
     */
    getStack() {
        const stack = [];
        if (this.ground) {
            stack.push(this.ground);
        }
        for (const item of this.downItems) {
            stack.push(item);
        }
        for (const creature of this.creatures) {
            stack.push(creature);
        }
        for (const item of this.topItems) {
            stack.push(item);
        }
        return stack;
    }

    /**
     * Índice de apilado de una cosa, o -1 si no está o si queda fuera del alcance
     * del protocolo.
     */
    getStackPos(thing) {
        const index = this.getStack().indexOf(thing);
        if (index === -1 || index >= MAX_STACKPOS) {
            return -1;
        }
        return index;
    }

    /** Lo que hay que apartar para poder poner algo encima: lo de arriba del todo. */
    getTopDownItem() {
        return this.downItems.length ? this.downItems[this.downItems.length - 1] : null;
    }

    getTopTopItem() {
        return this.topItems.length ? this.topItems[this.topItems.length - 1] : null;
    }

    // -----------------------------------------------------------------------
    // Reglas de paso
    // -----------------------------------------------------------------------

    /**
     * ¿Se puede caminar por este tile, por lo que respecta al terreno?
     *
     * Las criaturas NO se miran aquí: si se puede atravesar a otra criatura
     * depende de quién pregunte y de sus banderas, y eso lo resuelve el mapa.
     */
    isWalkable() {
        // Un tile sin suelo es un agujero: no se camina por él.
        if (!this.ground) {
            return false;
        }
        if (this.ground.blocksSolid) {
            return false;
        }
        return !this.hasBlockingItem();
    }

    /** ¿Hay algún item que impida caminar? */
    hasBlockingItem() {
        for (const item of this.downItems) {
            if (item.blocksSolid) {
                return true;
            }
        }
        for (const item of this.topItems) {
            if (item.blocksSolid) {
                return true;
            }
        }
        return false;
    }

    /** ¿Hay algo que impida el paso de un proyectil? */
    hasProjectileBlocker() {
        const items = [this.ground].concat(this.downItems, this.topItems);
        return items.some((item) => item && item.blocksProjectile);
    }

    // -----------------------------------------------------------------------
    // Banderas
    // -----------------------------------------------------------------------

    hasFlag(flag) {
        return (this.flags & flag) !== 0;
    }

    setFlag(flag, enabled) {
        if (enabled === false) {
            this.flags &= ~flag;
        } else {
            this.flags |= flag;
        }
        return this;
    }

    isProtectionZone() {
        return this.hasFlag(TILE_FLAGS.PROTECTION_ZONE);
    }

    isEmpty() {
        return !this.ground && this.downItems.length === 0 &&
            this.topItems.length === 0 && this.creatures.length === 0;
    }

    toString() {
        return 'Tile(' + this.x + ',' + this.y + ',' + this.z + ' ' +
            this.getStack().length + ' cosas)';
    }
}

module.exports = { Tile, TILE_FLAGS, MAX_STACKPOS };
