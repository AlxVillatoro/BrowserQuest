'use strict';

/**
 * Item del mundo: una INSTANCIA concreta, no una definición.
 *
 * La confusión entre los dos es el error clásico de estos motores:
 *
 *   - `typeId`  -> el TIPO. "Una moneda de oro". Es lo que sale en items.xml.
 *   - instancia -> ESTA moneda, en este tile, con su cantidad y sus atributos
 *                  propios (actionId, uniqueId, texto escrito en una carta...).
 *
 * Las definiciones se cargan una vez y se comparten; las instancias se crean y
 * se destruyen. Aquí esta clase es la instancia, y guarda una referencia a su
 * definición para no tener que buscarla en cada consulta de una bandera.
 *
 * Sobre las banderas: en `items.otb` de Tibia están como bits, y hay una trampa
 * documentada — `FLAG_ALWAYSONTOP` significa en realidad "siempre abajo", con un
 * comentario literal en el código de Remere's Map Editor que se rinde y dice
 * "esto es confuso, acepta que ALWAYSONTOP quiere decir siempre abajo". Aquí se
 * usan dos nombres distintos y explícitos para no heredar la confusión.
 */

/** Banderas que el motor consulta, con su valor por defecto. */
const FLAG_DEFAULTS = {
    blocksSolid: false,       // impide caminar por el tile
    blocksProjectile: false,  // impide el paso de proyectiles
    blocksPathfind: false,    // impide que el pathfinding lo atraviese
    pickupable: false,
    stackable: false,
    alwaysOnTop: false,       // se dibuja ENCIMA de las criaturas
    onBottom: false,          // se dibuja DEBAJO de las criaturas
    isGround: false,          // es suelo (uno solo por tile, y el primero)
    isContainer: false,
    useable: false
};

class Item {
    /**
     * @param {Object} definition definición cargada de items.xml
     * @param {Object} [options]
     * @param {number} [options.count]
     * @param {Object} [options.attributes] actionId, uniqueId, text...
     * @param {number} [options.instanceId] identificador único de instancia
     */
    constructor(definition, options) {
        const opts = options || {};

        this.definition = definition || null;
        this.typeId = definition && definition.id !== undefined ? definition.id : 0;
        this.instanceId = opts.instanceId === undefined ? 0 : opts.instanceId;
        this.count = opts.count === undefined ? 1 : opts.count;
        this.attributes = opts.attributes ? { ...opts.attributes } : {};
        this.position = null;
    }

    getName() {
        return this.definition ? this.definition.name : null;
    }

    /**
     * Bandera de la definición, con su valor por defecto.
     *
     * Las definiciones declaran las banderas en `attributes` (así es como lo hace
     * `items.xml` de Tibia: `<attribute key="blocking" value="1"/>`), pero algunas
     * tienen nombres más cómodos. Aquí se aceptan los dos.
     */
    hasFlag(name) {
        const fallback = FLAG_DEFAULTS[name] === true;
        if (!this.definition || !this.definition.attributes) {
            return fallback;
        }

        const attributes = this.definition.attributes;
        const raw = attributes[name];

        if (raw === undefined) {
            return fallback;
        }
        // En XML un atributo presente sin valor llega como `true`.
        return raw === true || raw === 1 || raw === '1' || raw === 'true';
    }

    get isGround() { return this.hasFlag('isGround'); }
    get blocksSolid() { return this.hasFlag('blocksSolid'); }
    get blocksProjectile() { return this.hasFlag('blocksProjectile'); }
    get blocksPathfind() { return this.hasFlag('blocksPathfind'); }
    get pickupable() { return this.hasFlag('pickupable'); }
    get stackable() { return this.hasFlag('stackable'); }
    get alwaysOnTop() { return this.hasFlag('alwaysOnTop'); }
    get onBottom() { return this.hasFlag('onBottom'); }
    get isContainer() { return this.hasFlag('isContainer'); }

    /** Atributo propio de la instancia, o el de la definición como respaldo. */
    getAttribute(key) {
        if (this.attributes[key] !== undefined) {
            return this.attributes[key];
        }
        if (this.definition && this.definition.attributes) {
            return this.definition.attributes[key];
        }
        return undefined;
    }

    setAttribute(key, value) {
        this.attributes[key] = value;
        return this;
    }

    /**
     * ¿A qué banda del apilado pertenece?
     *
     * El modelo del servidor de Tibia es el que se copia aquí: el suelo es aparte,
     * y el resto de items se reparten entre los que van DEBAJO de las criaturas
     * (bordes, escaleras, trampillas) y los que van ENCIMA (mesas, tejados,
     * objetos decorativos altos). El cliente dibuja en ese orden y así se resuelve
     * el solapamiento sin ningún z-buffer.
     *
     * @returns {'ground'|'down'|'top'}
     */
    getStackBand() {
        if (this.isGround) {
            return 'ground';
        }
        if (this.alwaysOnTop) {
            return 'top';
        }
        // Por defecto los items van debajo de las criaturas: es lo correcto para
        // el caso más común (una piedra, una moneda, una flor), y equivocarse al
        // revés haría que el suelo tapase a los personajes.
        return 'down';
    }

    toString() {
        return 'Item(' + this.typeId + ', ' + this.getName() + ')';
    }
}

module.exports = { Item, FLAG_DEFAULTS };
