'use strict';

/**
 * Position: la coordenada canónica del motor.
 *
 * Vive en `world/` y no en `scripting/` porque es del motor, no de la API: el
 * mapa, los tiles y el movimiento la usan, y los envoltorios que se pasan a los
 * módulos de contenido la reutilizan en vez de duplicarla. Tener dos tipos de
 * posición distintos acaba en conversiones por todas partes.
 *
 * Se usa un objeto en vez de un array de tres números por legibilidad, no por
 * rendimiento: en el camino caliente el motor trabaja con las componentes
 * sueltas y no construye objetos.
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

    /**
     * Distancia en pasos, en el sentido de Tibia: el máximo de las diferencias
     * por eje, no la distancia euclídea. Un movimiento diagonal cuenta como uno.
     */
    distanceTo(other) {
        return Math.max(
            Math.abs(this.x - other.x),
            Math.abs(this.y - other.y)
        );
    }

    /** ¿Es adyacente en el plano, incluida la diagonal? */
    isAdjacentTo(other) {
        return this.distanceTo(other) <= 1 && this.z === other.z;
    }

    toString() {
        return '(' + this.x + ', ' + this.y + ', ' + this.z + ')';
    }

    toJSON() {
        return { x: this.x, y: this.y, z: this.z };
    }

    /** Clave de mapa. Sólo para depuración y cachés; el motor no la usa en caliente. */
    getKey() {
        return this.x + ',' + this.y + ',' + this.z;
    }

    static from(value) {
        if (value instanceof Position) {
            return value;
        }
        if (Array.isArray(value)) {
            return new Position(value[0], value[1], value[2]);
        }
        if (value && typeof value === 'object') {
            return new Position(value.x, value.y, value.z);
        }
        return new Position(0, 0, 0);
    }
}

/**
 * Direcciones de movimiento, con el desplazamiento que aplican.
 *
 * El orden importa para el apilado visual: en Tibia las columnas se dibujan de
 * abajo hacia arriba y de izquierda a derecha, así que lo que está más al sur y
 * al este tapa a lo que está al norte y al oeste.
 */
const DIRECTIONS = {
    north: { x: 0, y: -1, diagonal: false },
    east: { x: 1, y: 0, diagonal: false },
    south: { x: 0, y: 1, diagonal: false },
    west: { x: -1, y: 0, diagonal: false },
    northeast: { x: 1, y: -1, diagonal: true },
    southeast: { x: 1, y: 1, diagonal: true },
    southwest: { x: -1, y: 1, diagonal: true },
    northwest: { x: -1, y: -1, diagonal: true }
};

/**
 * Deduce la dirección de un desplazamiento.
 * @returns {string|null} nombre de la dirección, o null si no hay desplazamiento
 */
function directionFrom(from, to) {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    const found = Object.keys(DIRECTIONS).find((name) => {
        const d = DIRECTIONS[name];
        return d.x === dx && d.y === dy;
    });

    return found || null;
}

module.exports = { Position, DIRECTIONS, directionFrom };
