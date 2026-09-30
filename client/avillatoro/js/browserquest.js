'use strict';

/**
 * Los sprites de BrowserQuest.
 *
 * El cliente tenia dos proveedores desde el principio: uno que DIBUJA las formas con
 * procedimiento -los rectangulos de colores- y este, que estaba como stub. Cambiar uno por
 * otro es una linea, que es para lo que se hizo la separacion.
 *
 * DE DONDE SALE CADA DATO, porque esto es lo que costo acertar:
 *
 *   - La IMAGEN: `client/img/1/<nombre>.png`, que el servidor heredado ya sirve en
 *     `/img/1/...`. La resolucion 1 mide 32x32 por casilla, igual que `TILE_PIXELS`, asi que
 *     el suelo se dibuja 1:1.
 *
 *   - El TAMANO DEL FOTOGRAMA y LA FILA DE CADA ANIMACION: `client/sprites/<nombre>.json`,
 *     servido en `/sprites/<nombre>.json`. Hay 71.
 *
 * LO SEGUNDO ES LO QUE HACE QUE ESTO FUNCIONE. Intente deducir la rejilla dividiendo el
 * tamano de la imagen entre 32, y no se puede: `skeleton.png` mide 192x432 y admite 36
 * rejillas distintas, mientras que `goblin.png`, `spectre.png` y `wizard.png` no admiten
 * ninguna exacta, porque las imagenes estan RECORTADAS a su contenido. El JSON lo dice sin
 * ambiguedad: `rat` son fotogramas de 48x48 y `clotharmor` de 32x32, y `walk_down` esta en
 * la fila 8.
 *
 * LO QUE SE PUEDE Y LO QUE NO:
 *
 *   - CRIATURAS: si. `rat`, `skeleton`, `goblin`... y los NPC, que son `villager`, `guard`,
 *     `king` y compania. Es la ganancia que mas se nota.
 *
 *   - OBJETOS: solo algunos. Hay espadas, armaduras y pociones, pero NO hay moneda, ni
 *     anillo, ni palanca, ni teleport. Se mapea lo que hay y el resto sigue con el dibujo de
 *     procedimiento, que es lo que hace cualquier proyecto de verdad.
 *
 *   - SUELO: NO. `tilesheet.png` mide 320x1568 -10x49 casillas- y uno espera encontrar ahi
 *     la hierba y el agua. Lo que hay son CASAS, arboles, rocas y charcas: el suelo liso no
 *     esta, porque BrowserQuest dibuja el terreno como COLOR PLANO y la hoja es para lo que
 *     se pone encima. Mapear mi hierba a un tile de esa hoja habria puesto una casa donde
 *     va el suelo.
 */

/** La resolucion de los ficheros. La 1 mide 32x32 por casilla. */
export const RESOLUCION = 1;

/** Donde estan los ficheros. El servidor heredado monta `client/` en la raiz. */
export function urlDeImagen(nombre, resolucion) {
    return '/img/' + (resolucion || RESOLUCION) + '/' + nombre + '.png';
}

export function urlDeDatos(nombre) {
    return '/sprites/' + nombre + '.json';
}

/**
 * De aspecto de monstruo -el `lookType` de Tibia- a dibujo de BrowserQuest.
 *
 * NO HAY CORRESPONDENCIA y no se puede inventar: Tibia tiene cientos de monstruos y aqui hay
 * una docena. Se mapea lo que se parece y lo que no se queda con el dibujo de procedimiento,
 * que al menos es honesto.
 */
export const MONSTRUOS = {
    21: 'rat',        // Rat
    34: 'rat',        // Rat, variante
    35: 'rat',        // Cave Rat
    36: 'boss',       // Dragon: no hay dragon, y el jefe es lo mas parecido
    37: 'boss'        // Dragon Lord
};

/** De nombre de NPC a dibujo. Los NPC se reconocen por su nombre, que viaja en el protocolo. */
export const NPC = {
    Guia: 'villager',
    Herrero: 'guard'
};

/** De id de objeto -los de Tibia- a dibujo. Solo lo que existe de verdad. */
export const OBJETOS = {
    2400: 'item-goldensword'   // magic sword
};

/**
 * Las cuatro direcciones del motor, en los nombres de BrowserQuest.
 *
 * El 3 -oeste- no tiene fila propia en estas hojas: se dibuja la de este y se VOLTEA. Por eso
 * cada direccion dice tambien si hay que espejar.
 */
const DIRECCIONES = {
    0: { nombre: 'up', espejar: false },
    1: { nombre: 'right', espejar: false },
    2: { nombre: 'down', espejar: false },
    3: { nombre: 'right', espejar: true }
};

/** Carga un JSON. Devuelve null si falla, sin rechazar: un sprite de menos no para el juego. */
function cargarDatos(url) {
    return fetch(url)
        .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
        .catch(() => null);
}

/** Carga una imagen. Se resuelve SIEMPRE, tambien al fallar. */
function cargarImagen(src) {
    return new Promise((resolve) => {
        const imagen = new Image();
        imagen.onload = () => resolve(imagen);
        imagen.onerror = () => resolve(null);
        imagen.src = src;
    });
}

/**
 * El proveedor.
 *
 * Devuelve lo mismo que el de procedimiento -`{ canvas, anchorY }`- para que el renderer no
 * tenga que saber cual esta puesto.
 *
 * SI UN SPRITE NO ESTA CARGADO TODAVIA devuelve null y el renderer no dibuja nada. Es
 * preferible a dibujar un rectangulo raro durante medio segundo: el mundo aparece un
 * fotograma despues y nadie lo nota, mientras que un parpadeo de formas si se nota.
 */
export class BrowserQuestProvider {
    constructor(opciones) {
        const opts = opciones || {};

        this.resolucion = opts.resolucion || RESOLUCION;

        /*
         * EL PROVEEDOR DE PROCEDIMIENTO, DETRAS.
         *
         * BrowserQuest tiene una docena de monstruos y Tibia cientos, y de objetos solo
         * cubre espadas, armaduras y pociones: no hay moneda, ni anillo, ni palanca, ni
         * suelo. Todo lo que no tiene dibujo aqui tiene que salir por el otro proveedor.
         *
         * ESTO FALTABA Y SE VIO EN PANTALLA. Sustitui el proveedor de procedimiento por este
         * en vez de ponerlo delante, y como `get()` devolvia null para todo lo que no fuera
         * la espada, el mundo entero se quedo NEGRO: 180 tiles de suelo en la lista de dibujo
         * y ninguno pintado. Las criaturas si se veian, porque su camino ya tenia el `else`
         * que recurre al dibujo de procedimiento. Los objetos no lo tenian.
         *
         * La leccion es la de siempre en este proyecto: sustituir donde habia que componer.
         */
        this.respaldo = opts.respaldo || null;

        this.entradas = new Map();
        this.fallos = new Set();
        this.lienzos = new Map();
        this.name = 'browserquest';
    }

    /**
     * Pide los datos y la imagen de un sprite, una sola vez.
     *
     * @returns {Object|null} la entrada cuando esta lista, o null mientras tanto
     */
    _entrada(nombre) {
        const guardada = this.entradas.get(nombre);

        if (guardada) {
            return guardada.datos && guardada.imagen ? guardada : null;
        }

        const entrada = { datos: null, imagen: null };
        this.entradas.set(nombre, entrada);

        Promise.all([
            cargarDatos(urlDeDatos(nombre)),
            cargarImagen(urlDeImagen(nombre, this.resolucion))
        ]).then(([datos, imagen]) => {
            entrada.datos = datos;
            entrada.imagen = imagen;

            if (!datos || !imagen) {
                this.fallos.add(nombre);
            }
        });

        return null;
    }

    /**
     * El fotograma que toca, en coordenadas de la hoja.
     *
     * Se busca la animacion `idle_<direccion>` y, si el sprite no la tiene, `walk_<direccion>`.
     * Y si no tiene ninguna de las dos -los objetos solo tienen `idle`- se usa la primera que
     * haya. El JSON dice en que FILA esta cada una, que es justo el dato que no se puede
     * deducir mirando la imagen.
     */
    _fotograma(nombre, direccion) {
        const entrada = this._entrada(nombre);
        if (!entrada) {
            return null;
        }

        const datos = entrada.datos;
        const animaciones = datos.animaciones || datos.animations || {};

        const dir = DIRECCIONES[direccion === undefined ? 2 : direccion] || DIRECCIONES[2];
        const candidatas = ['idle_' + dir.nombre, 'walk_' + dir.nombre,
            'idle', 'walk', 'idle_down', 'walk_down'];

        let elegida = null;
        for (const clave of candidatas) {
            if (animaciones[clave]) {
                elegida = animaciones[clave];
                break;
            }
        }

        // Si no hay ninguna de las esperadas, la primera que traiga el fichero. Asi un sprite
        // con una sola animacion -todos los objetos- funciona sin caso especial.
        if (!elegida) {
            const claves = Object.keys(animaciones);
            elegida = claves.length > 0 ? animaciones[claves[0]] : null;
        }

        const fila = elegida && elegida.row !== undefined ? elegida.row : 0;

        return {
            imagen: entrada.imagen,
            // El primer fotograma de la animacion. Animar es el paso siguiente; dibujar el
            // primero ya cambia el juego entero y no depende del reloj, que es donde estaban
            // los fallos.
            sx: 0,
            sy: fila * datos.height,
            sw: datos.width,
            sh: datos.height,
            espejar: dir.espejar,
            alto: datos.height
        };
    }

    /**
     * Recorta el fotograma en un lienzo del tamano de una casilla.
     *
     * Se centra a lo ancho y se APOYA EN EL SUELO: un muñeco mas bajo que la casilla tiene que
     * apoyar su base en la base del tile, o parece flotar. Y `anchorY` se calcula para que el
     * renderer, que sube el dibujo, lo deje donde toca.
     */
    _aCasilla(clave, fotograma, lado) {
        const guardado = this.lienzos.get(clave);
        if (guardado) {
            return guardado;
        }

        const tamano = lado || TILE;
        const lienzo = document.createElement('canvas');
        lienzo.width = tamano;
        lienzo.height = tamano;

        const ctx = lienzo.getContext('2d');

        /*
         * Centrado a lo ancho y APOYADO EN EL SUELO.
         *
         * El JSON trae `offset_x` y `offset_y` -el villager tiene -4 y -8- y NO se usan: son
         * relativos a la convencion de dibujo de BrowserQuest y a su casilla de 32, y
         * aplicarlos AQUI ademas de la regla geometrica seria contarlos dos veces.
         *
         * Y no hacen falta, porque la regla geometrica da lo mismo: el villager mide 24 de
         * alto en una casilla de 32, asi que apoyarlo son 8 pixeles hacia abajo, que es
         * exactamente el `-offset_y` de su fichero. Cuando dos caminos llevan al mismo sitio,
         * se elige el que no depende de un dato que hay que recordar.
         */
        const x = Math.round((tamano - fotograma.sw) / 2);
        const y = tamano - fotograma.sh;

        if (fotograma.espejar) {
            // Se voltea sobre el eje del propio trozo, no sobre el lienzo: si se volteara el
            // lienzo entero, el muñeco saldria despedido al otro lado de la casilla.
            ctx.save();
            ctx.translate(x + fotograma.sw, y);
            ctx.scale(-1, 1);
            ctx.drawImage(fotograma.imagen, fotograma.sx, fotograma.sy,
                fotograma.sw, fotograma.sh, 0, 0, fotograma.sw, fotograma.sh);
            ctx.restore();
        } else {
            ctx.drawImage(fotograma.imagen, fotograma.sx, fotograma.sy,
                fotograma.sw, fotograma.sh, x, y, fotograma.sw, fotograma.sh);
        }

        const sprite = {
            canvas: lienzo,
            /*
             * EL ANCLA ES EL ALTO DEL LIENZO, y esto hay que razonarlo porque parece raro.
             *
             * El renderer dibuja en `sy - anchorY + TILE`. La base del tile esta en
             * `sy + TILE`. Para que la base del DIBUJO caiga ahi:
             *
             *     (sy - anchorY + TILE) + altoDelLienzo = sy + TILE
             *     anchorY = altoDelLienzo
             *
             * Con 32 da 32, y con 48 da 48. El comentario del renderer lo dice con otras
             * palabras: "un muro de 32x64 se dibuja 32 pixeles mas arriba", y eso es
             * exactamente anchorY = 64 con un tile de 32.
             *
             * La primera version ponia cero, y con cero TODO se dibuja una casilla entera por
             * debajo de su sitio.
             */
            anchorY: lienzo.height
        };
        this.lienzos.set(clave, sprite);

        return sprite;
    }

    /**
     * Lo que este proveedor no tiene, lo dibuja el de procedimiento.
     *
     * Se pregunta al respaldo SOLO cuando aqui no hay nada, y no al reves: lo que viene de
     * BrowserQuest es un dibujo de verdad y lo que viene del otro es una forma de color, asi
     * que cuando los dos pueden, gana el de verdad.
     */
    _pedirAlRespaldo(typeId) {
        return this.respaldo ? this.respaldo.get(typeId) : null;
    }

    /** El sprite de un objeto del suelo, o lo que ponga el respaldo. */
    get(typeId) {
        const nombre = OBJETOS[Number(typeId)];

        if (!nombre) {
            return this._pedirAlRespaldo(typeId);
        }

        const fotograma = this._fotograma(nombre);

        if (!fotograma) {
            return this._pedirAlRespaldo(typeId);
        }

        return this._aCasilla(nombre + '@' + typeId, fotograma);
    }

    /**
     * El sprite de una criatura, o null si no hay dibujo para ella.
     *
     * El ancho del lienzo se toma del propio fotograma cuando es MAS GRANDE que una casilla,
     * porque un jefe de 48x48 dibujado en un lienzo de 32 saldria cortado.
     */
    getCreature(op) {
        if (!op) {
            return null;
        }

        let nombre = null;

        if (op.isPlayer) {
            // En BrowserQuest el personaje lleva armadura puesta y no hay un sprite de
            // "personaje a secas": se usa la mas basica.
            nombre = 'clotharmor';
        } else if (op.name && NPC[op.name]) {
            nombre = NPC[op.name];
        } else if (op.outfit && MONSTRUOS[op.outfit.lookType] !== undefined) {
            nombre = MONSTRUOS[op.outfit.lookType];
        }

        if (!nombre) {
            return null;
        }

        const fotograma = this._fotograma(nombre, op.direction);
        if (!fotograma) {
            return null;
        }

        const lado = Math.max(TILE, fotograma.sw, fotograma.sh);

        return this._aCasilla(nombre + ':' + (op.direction || 0) + ':' + lado, fotograma, lado);
    }

    /** Cuantos sprites estan listos para dibujar. */
    get size() {
        let listos = 0;
        this.entradas.forEach((entrada) => {
            if (entrada.datos && entrada.imagen) {
                listos += 1;
            }
        });
        return listos;
    }

    /** El estado, para el diagnostico. */
    get estado() {
        return {
            pedidas: this.entradas.size,
            listas: this.size,
            fallos: Array.from(this.fallos)
        };
    }
}

/** El lado de una casilla. Se repite aqui para no depender del orden de carga. */
const TILE = 32;
