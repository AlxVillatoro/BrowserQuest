/**
 * La cámara: de coordenadas de mundo a píxeles de pantalla.
 *
 * Aquí está el 2.5D. No hay proyección isométrica ni perspectiva: los tiles son
 * cuadrados y se dibujan en una rejilla. **La sensación de profundidad sale del
 * desplazamiento entre plantas**, y eso es todo.
 *
 * CÓMO FUNCIONA EL DESPLAZAMIENTO. Cada planta se dibuja desplazada en diagonal
 * respecto a la planta donde está la cámara: una planta por ENCIMA se dibuja
 * corrida hacia abajo y a la derecha, y una por DEBAJO hacia arriba y a la
 * izquierda, en ambos casos una casilla por planta de diferencia.
 *
 * Que el signo sea ése y no el contrario tiene una razón que se ve al dibujar: una
 * plataforma elevada tiene que TAPAR el suelo que hay delante de ella, y el suelo
 * que hay delante está abajo y a la derecha en la pantalla. Por eso la planta de
 * arriba se corre hacia allí y se pinta después.
 *
 * La convención es la de OTClient, que en `MapView::updateVisibleTilesCache`
 * ajusta cada planta con `tilePos.coveredUp(cameraPosition.z - iz)`. No se copia su
 * código —es C++ y de otro proyecto—, pero sí el criterio, que es un hecho de
 * geometría y no una implementación. Lo que sí es nuestro es dónde vive: el motor
 * NO envía estos desplazamientos, porque son presentación pura. El motor decide qué
 * plantas se ven; cómo se colocan en la pantalla es cosa del cliente.
 */

/** Lado de un tile en píxeles. Es el de Tibia. */
export const TILE_PIXELS = 32;

/**
 * Desplazamiento de una planta, en TILES, respecto a la planta de la cámara.
 *
 * @param {number} floorZ la planta que se va a dibujar
 * @param {number} cameraZ la planta donde está la cámara
 * @returns {{x: number, y: number}} en tiles; positivo es abajo-derecha
 */
export function floorOffset(floorZ, cameraZ) {
    const floors = cameraZ - floorZ;
    return { x: floors, y: floors };
}

/** Lo mismo, en píxeles. */
export function floorOffsetPixels(floorZ, cameraZ, tileSize) {
    const size = tileSize === undefined ? TILE_PIXELS : tileSize;
    const floors = cameraZ - floorZ;
    return { x: floors * size, y: floors * size };
}

export class Camera {
    constructor(options) {
        const opts = options || {};

        this.tileSize = opts.tileSize || TILE_PIXELS;

        /** Tamaño del lienzo, en píxeles. */
        this.width = opts.width || 960;
        this.height = opts.height || 640;

        /**
         * Centro de la cámara en coordenadas de mundo, y puede ser FRACCIONARIO.
         *
         * Que sea fraccionario es lo que permite que el desplazamiento sea suave:
         * si sólo pudiera valer enteros, la pantalla saltaría de casilla en casilla
         * y el muñeco parecería ir a tirones aunque su animación fuera perfecta.
         */
        this.centerX = 0;
        this.centerY = 0;
        this.z = 7;
    }

    setViewport(width, height) {
        this.width = width;
        this.height = height;
        return this;
    }

    /** Centra la cámara. Acepta fraccionarios, a propósito. */
    setCenter(x, y, z) {
        this.centerX = x;
        this.centerY = y;
        if (z !== undefined) {
            this.z = z;
        }
        return this;
    }

    /**
     * Posición en pantalla de un punto del mundo.
     *
     * El desplazamiento por planta se aplica ANTES de restar el centro, para que la
     * planta de la cámara quede centrada y las demás alrededor.
     *
     * @returns {{x: number, y: number}} píxeles, con el tile alineado por su esquina
     */
    worldToScreen(x, y, z) {
        const offset = floorOffset(z === undefined ? this.z : z, this.z);

        return {
            x: (x + offset.x - this.centerX) * this.tileSize + this.width / 2,
            y: (y + offset.y - this.centerY) * this.tileSize + this.height / 2
        };
    }

    /** El inverso: qué tile hay bajo un punto de la pantalla, en la planta actual. */
    screenToWorld(px, py, z) {
        const floor = z === undefined ? this.z : z;
        const offset = floorOffset(floor, this.z);

        return {
            x: Math.floor((px - this.width / 2) / this.tileSize + this.centerX) - offset.x,
            y: Math.floor((py - this.height / 2) / this.tileSize + this.centerY) - offset.y,
            z: floor
        };
    }

    /** Cuántos tiles caben a lo ancho y a lo alto, redondeando hacia arriba. */
    tilesAcross() {
        return Math.ceil(this.width / this.tileSize) + 2;
    }

    tilesDown() {
        return Math.ceil(this.height / this.tileSize) + 2;
    }

    /**
     * El rectángulo de tiles que hay que dibujar en una planta.
     *
     * Se añaden dos casillas de margen porque el desplazamiento por planta corre el
     * contenido en diagonal: sin margen, al mirar una planta de abajo se vería un
     * borde vacío por la izquierda y por arriba.
     */
    visibleRect(z) {
        const offset = floorOffset(z === undefined ? this.z : z, this.z);
        const halfWidth = this.tilesAcross() / 2;
        const halfHeight = this.tilesDown() / 2;

        return {
            x0: Math.floor(this.centerX - halfWidth) - offset.x,
            x1: Math.ceil(this.centerX + halfWidth) - offset.x,
            y0: Math.floor(this.centerY - halfHeight) - offset.y,
            y1: Math.ceil(this.centerY + halfHeight) - offset.y
        };
    }

    /**
     * Desplazamiento fraccionario de la cámara, en píxeles.
     *
     * Lo usa el renderer para alinear la rejilla al píxel y que la imagen no
     * vibre: dibujar en coordenadas fraccionarias hace que el navegador interpole
     * las texturas y el resultado tiembla al moverse.
     */
    snap() {
        return {
            x: Math.round(this.centerX * this.tileSize) / this.tileSize,
            y: Math.round(this.centerY * this.tileSize) / this.tileSize
        };
    }
}
