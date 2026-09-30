/**
 * Los sprites: de identificador de item a imagen.
 *
 * EL CLIENTE CARGA SUS PROPIOS ASSETS, y eso significa que esta capa es suya y del
 * motor no depende. El motor manda identificadores de tipo de item; qué imagen
 * corresponde a cada uno lo decide el cliente.
 *
 * DOS PROVEEDORES, Y POR QUÉ
 *
 * Un servidor de Tibia de verdad usa `items.otb` para los identificadores y los
 * assets `.dat`/`.spr` para las imágenes, y el contrato entre ambos es el
 * **ClientID**. Aquí no se pueden distribuir esos assets —son de CipSoft—, así que
 * hay dos proveedores intercambiables:
 *
 *   - `ProceduralProvider`, que dibuja cada item con formas y colores derivados de
 *     su identificador. No es bonito, pero deja el juego jugable y, sobre todo,
 *     permite comprobar que el 2.5D funciona sin depender de ningún archivo.
 *   - `SprProvider`, que leería `.dat`/`.spr` reales. Es la pieza que falta, y su
 *     sitio está marcado abajo.
 *
 * La tabla de abajo dice CÓMO SE VE cada item, nunca QUÉ HACE. Es una distinción
 * que importa: que un muro bloquee el paso es una regla del mundo y vive en el
 * motor; que se dibuje alto es una decisión de presentación y vive aquí. Si esta
 * tabla dijera "esto bloquea", el cliente sabría cosas del juego que no le tocan.
 */

/** Lado de un tile, en píxeles. En Tibia son 32. */
export const TILE = 32;

/**
 * Forma de cada item conocido.
 *
 * `height` es la altura del sprite en píxeles MÁS ALLÁ del tile, y es lo que da la
 * sensación de volumen: un muro se dibuja alto y su base coincide con la casilla,
 * así que sobresale hacia arriba y tapa lo que tiene detrás.
 */
const SHAPES = {
    // --- Suelos: planos, sin altura ---
    102: { kind: 'ground', color: '#4a7c3f', accent: '#5b9450', name: 'hierba' },
    103: { kind: 'ground', color: '#8b7355', accent: '#9c8466', name: 'tierra' },
    104: { kind: 'ground', color: '#7a7a7a', accent: '#8c8c8c', name: 'piedra' },
    105: { kind: 'ground', color: '#3a6ea5', accent: '#4a82bd', name: 'agua' },

    // --- Muros: altos ---
    111: { kind: 'block', color: '#6b6b6b', accent: '#8a8a8a', height: 32, name: 'muro' },

    // --- Objetos bajos, por encima de las criaturas ---
    112: { kind: 'onTop', color: '#a0703c', accent: '#c08a4c', height: 12, name: 'barandilla' },
    113: { kind: 'onTop', color: '#8b5a2b', accent: '#a5703a', height: 14, name: 'mesa' },

    // --- Objetos usables ---
    1948: { kind: 'item', color: '#c0a040', accent: '#e0c060', height: 10, name: 'palanca' },
    1387: { kind: 'item', color: '#8040c0', accent: '#a060e0', height: 6, name: 'portal' },

    // --- Cosas pequeñas del suelo ---
    3031: { kind: 'small', color: '#e0c040', accent: '#ffe870', height: 4, name: 'monedas' },
    2160: { kind: 'small', color: '#80d0e0', accent: '#c0f0ff', height: 6, name: 'moneda de cristal' },
    2400: { kind: 'small', color: '#d0d0e0', accent: '#ffffff', height: 8, name: 'espada' },
    2376: { kind: 'small', color: '#d0a020', accent: '#ffd060', height: 4, name: 'anillo' },
    1950: { kind: 'flat', color: '#5a5a4a', accent: '#6a6a5a', height: 2, name: 'huella' },
    1951: { kind: 'flat', color: '#5a5a4a', accent: '#6a6a5a', height: 2, name: 'huella' },
    1952: { kind: 'flat', color: '#5a5a4a', accent: '#6a6a5a', height: 2, name: 'huella' },
    1953: { kind: 'flat', color: '#5a5a4a', accent: '#6a6a5a', height: 2, name: 'huella' },
    1954: { kind: 'flat', color: '#5a5a4a', accent: '#6a6a5a', height: 2, name: 'huella' }
};

/** Un color estable a partir de un identificador, para los que no están en la tabla. */
function colorFromId(typeId, salt) {
    const hash = ((typeId * 2654435761) ^ ((salt || 0) * 40503)) >>> 0;
    const hue = hash % 360;
    const light = 35 + (hash >> 8) % 30;
    return 'hsl(' + hue + ', 45%, ' + light + '%)';
}

function shapeFor(typeId) {
    if (SHAPES[typeId]) {
        return SHAPES[typeId];
    }
    // Un item que no está en la tabla se dibuja igual, con un color derivado de su
    // identificador. Así un datapack nuevo se ve desde el primer momento en vez de
    // aparecer invisible, que es un fallo mucho peor de diagnosticar.
    return {
        kind: 'item',
        color: colorFromId(typeId, 1),
        accent: colorFromId(typeId, 2),
        height: 8,
        name: 'item ' + typeId,
        unknown: true
    };
}

/** Crea un lienzo fuera de pantalla del tamaño que haga falta. */
function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/**
 * Dibuja un sprite de procedimiento.
 *
 * Devuelve el lienzo y su ANCLA: el desplazamiento vertical que hay que restar a la
 * posición del tile para colocarlo. Un sprite de 32x64 se dibuja 32 píxeles más
 * arriba, de modo que su base coincide con la base del tile y el volumen sobresale
 * hacia arriba. Eso, junto con el desplazamiento por planta, es lo que da el 2.5D.
 */
function drawShape(typeId, shape) {
    const height = shape.height || 0;
    const canvas = makeCanvas(TILE, TILE + height);
    const ctx = canvas.getContext('2d');

    const top = height;

    if (shape.kind === 'ground') {
        ctx.fillStyle = shape.color;
        ctx.fillRect(0, top, TILE, TILE);

        // Un poco de textura para que no sea un color plano.
        ctx.fillStyle = shape.accent;
        for (let index = 0; index < 10; index += 1) {
            const seed = (typeId * 31 + index * 17) % 97;
            ctx.fillRect((seed * 7) % TILE, top + (seed * 13) % TILE, 3, 3);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(0.5, top + 0.5, TILE - 1, TILE - 1);
    } else if (shape.kind === 'block') {
        // Cara frontal, más oscura, y cara superior, más clara.
        ctx.fillStyle = shape.color;
        ctx.fillRect(0, top, TILE, TILE);

        ctx.fillStyle = shape.accent;
        ctx.fillRect(0, 0, TILE, height);

        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, top + TILE - 6, TILE, 6);

        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeRect(0.5, 0.5, TILE - 1, height + TILE - 1);
    } else {
        // Formas pequeñas y objetos: una base en el tile y un cuerpo encima.
        if (shape.kind === 'onTop' || shape.kind === 'item') {
            ctx.fillStyle = shape.color;
            ctx.fillRect(4, top + 6, TILE - 8, TILE - 10);
        }

        // El cuerpo: lo que sobresale del tile.
        ctx.fillStyle = shape.accent;
        ctx.fillRect(6, 2, TILE - 12, Math.max(3, height));

        ctx.fillStyle = shape.color;
        ctx.fillRect(8, 4, TILE - 16, Math.max(2, height - 4));
    }

    return {
        canvas: canvas,
        width: TILE,
        // El ancla es lo que hay que restar a la Y del tile para que la BASE del
        // sprite coincida con la base del tile.
        anchorY: height,
        shape: shape
    };
}

/**
 * Proveedor de sprites de procedimiento.
 *
 * Guarda cada sprite la primera vez que se pide. Sin caché, un mapa con ochocientos
 * tiles crearía ochocientos lienzos por fotograma y el navegador se arrastraría.
 */
export class ProceduralProvider {
    constructor() {
        this.cache = new Map();
        this.name = 'procedimiento';
    }

    /** @returns {{canvas, width, anchorY, shape}|null} */
    get(typeId) {
        if (!typeId) {
            return null;
        }

        let sprite = this.cache.get(typeId);
        if (!sprite) {
            sprite = drawShape(typeId, shapeFor(typeId));
            this.cache.set(typeId, sprite);
        }
        return sprite;
    }

    /** Cuántos sprites se han generado, para el diagnóstico. */
    get size() {
        return this.cache.size;
    }

    describe(typeId) {
        return shapeFor(typeId).name;
    }
}

/**
 * Proveedor de assets reales de Tibia.
 *
 * PENDIENTE, y es la pieza que falta para que esto se vea como Tibia de verdad.
 * Requiere leer `Tibia.dat` (las propiedades de cada ClientID) y `Tibia.spr` (los
 * píxeles), y luego construir un atlas, porque dibujar desde un `.spr` suelto por
 * fotograma es inviable. Formatos y viables: el `.dat`/`.spr` clásico cubre hasta
 * la versión 10.98; a partir de la 12 son atlas en protobuf con LZMA, que es otro
 * trabajo.
 *
 * La interfaz es la misma que la del proveedor de procedimiento, así que enchufarlo
 * es cambiar una línea en `main.js`. Los assets NO se distribuyen con el proyecto:
 * los tiene que aportar quien monte el servidor.
 */
export class SprProvider {
    constructor(options) {
        this.loaded = false;
        this.assets = options && options.assets ? options.assets : null;
    }

    get(typeId) {
        if (!this.loaded) {
            throw new Error(
                'El proveedor de .dat/.spr todavia no esta implementado. ' +
                'Usa ProceduralProvider, o implementa la lectura de .dat/.spr.');
        }
        return this.assets.get(typeId) || null;
    }
}

/** Elige el proveedor según lo que haya configurado. */
import { BrowserQuestProvider } from './browserquest.js';

export function createProvider(options) {
    const opts = options || {};
    /*
     * LOS SPRITES DE BROWSERQUEST.
     *
     * El nombre del proveedor lo pide main.js y aqui se decide cual se construye. Si el
     * nombre no se reconoce se cae al de procedimiento, que es lo que hace que el cliente
     * siga funcionando aunque alguien escriba mal el suyo: un cliente que no arranca por
     * una cadena mal escrita es peor que uno que dibuja rectangulos.
     */
    if (opts.provider === 'browserquest') {
        return new BrowserQuestProvider({
            resolucion: opts.resolucion,
            respaldo: new ProceduralProvider()
        });
    }

    if (opts.provider === 'spr' && opts.assets) {
        return new SprProvider({ assets: opts.assets });
    }
    return new ProceduralProvider();
}

// ---------------------------------------------------------------------------
// La paleta de los aspectos
// ---------------------------------------------------------------------------

/** Cuántos colores tiene la paleta. El motor acota a este rango. */
export const PALETTE_SIZE = 133;

/** Familias de color en la paleta. */
const HUE_FAMILIES = 19;

/** Cuántos pasos de claridad tiene cada familia. */
const SHADES_PER_FAMILY = 7;

/**
 * De índice de paleta a color.
 *
 * LA PALETA DE VERDAD SON 133 COLORES FIJOS que vienen con el cliente de Tibia, y no
 * se distribuyen con este proyecto. Esta función los DERIVA del índice.
 *
 * No da los mismos colores que los de Tibia, y eso hay que decirlo claro. Lo que sí da
 * es lo que hace falta para que el sistema funcione y se vea: **índices distintos dan
 * colores distintos, y siempre el mismo color para el mismo índice**. Un jugador que se
 * cambia el aspecto lo ve cambiar, y el mismo aspecto se ve igual en todas las
 * máquinas, que es lo que importa para poder probarlo.
 *
 * La forma imita la de la paleta real: familias de tono, y dentro de cada una los
 * colores van de claro a oscuro. Está así y no en un círculo continuo porque es como
 * se lee la de Tibia: el 78 y el 79 son el mismo color con distinta claridad, no dos
 * tonos parecidos.
 *
 * Sustituirla por la tabla real es cambiar ESTA función y nada más: el motor sigue
 * mandando los mismos índices, porque la paleta es un asset del cliente.
 *
 * @param {number} index 0..132
 * @returns {string} un color CSS
 */
export function paletteColor(index) {
    const value = Math.max(0, Math.min(PALETTE_SIZE - 1, Math.trunc(Number(index) || 0)));

    if (value === 0) {
        // El 0 es el blanco en la paleta de Tibia, y se respeta porque es el que más
        // se usa para las telas claras.
        return '#f0f0f0';
    }

    const family = Math.floor((value - 1) / SHADES_PER_FAMILY);
    const shade = (value - 1) % SHADES_PER_FAMILY;

    const hue = (family * 360) / HUE_FAMILIES;
    const lightness = 76 - shade * 9;

    return 'hsl(' + Math.round(hue) + ', 62%, ' + Math.round(lightness) + '%)';
}

/** Un color más oscuro que el dado, para los bordes. */
export function darker(color) {
    // Se trabaja sobre el hsl que devuelve `paletteColor`, que siempre tiene la misma
    // forma, para no depender de analizar colores arbitrarios.
    const match = String(color).match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);

    if (!match) {
        return 'rgba(0,0,0,0.45)';
    }

    const lightness = Math.max(8, Number(match[3]) - 26);
    return 'hsl(' + match[1] + ', ' + match[2] + '%, ' + lightness + '%)';
}
