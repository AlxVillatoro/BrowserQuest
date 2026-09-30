'use strict';

import {
    animacionDe,
    candidatasDeAnimacion,
    columnaDeFotograma,
    intervaloDeAnimacion
} from './sprite-anim.js';

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
 *   - MOVIMIENTO: si, y es lo que le faltaba. El JSON de cada sprite dice cuantos
 *     fotogramas tiene cada animacion (`length`) y en que fila esta (`row`), asi que basta
 *     con ir cambiando de COLUMNA con el reloj. Antes se dibujaba siempre la columna 0, o
 *     sea el primer fotograma de todo: las criaturas andaban deslizandose, con los pies
 *     quietos. El calculo de que columna toca vive en `sprite-anim.js`, que es puro y se
 *     puede comprobar sin navegador; aqui solo se recorta el fotograma que diga aquel.
 *
 *   - LO QUE NO TIENE DIBUJO PERO SI UN DIBUJO PROPIO: la moneda de oro (3031), la de
 *     cristal (2160) y el anillo (2376), que son de lo que mas se ve en el mapa. Se pintan
 *     aqui abajo, en `PROPIOS`, sin tocar `sprites.js`: se pide el MARCO al respaldo y se
 *     pinta dentro. El porque, en el comentario de `PROPIOS`.
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

/**
 * De id de objeto -los de este mundo- a dibujo. Solo lo que existe de verdad.
 *
 * DE DONDE SALE CADA ID, porque aqui es donde es facil inventar. Los ids NO se han
 * copiado de Tibia: se han leido de `data/items/items.xml`, que es el catalogo de este
 * mundo y el unico que este cliente puede ver. Ese archivo dice en su cabecera que de la
 * zona 2400-2600 solo el 2400 es un id de Tibia y que 2401..2420 son HUECOS LIBRES
 * elegidos a proposito; se mapean igual, porque el mapa `data/world/ciudad.map.json` ya
 * coloca uno de cada. Lo que se empareja es el NOMBRE del objeto con el dibujo que mas se
 * le parece, nunca un numero con una corazonada.
 *
 * LO QUE NO TIENE DIBUJO NO SE MAPEA, y no pasa nada: sigue saliendo por el proveedor de
 * procedimiento, que es lo que hace cualquier proyecto de verdad. De los 17 dibujos de
 * objeto que trae BrowserQuest aqui se usan 11; `item-sword2`, `item-redsword`,
 * `item-bluesword`, `item-goldenarmor`, `item-redarmor` y `item-clotharmor` se quedan sin
 * pareja porque en el catalogo no hay nada que se les parezca -un arco, un baston, un
 * escudo, un yelmo, unas botas y una mochila no son ninguna de esas cosas- y forzar el
 * parecido seria peor que dejar el rectangulo de color.
 */
export const OBJETOS = {
    // --- Armas ---
    2400: 'item-goldensword',   // magic sword
    2401: 'item-sword1',        // dagger: de los dos dibujos de espada, el mas corto y fino
    2402: 'item-axe',           // axe
    2403: 'item-morningstar',   // mace: una maza de bola con pinchos es un morning star
    // 2404 bow y 2405 staff: no hay arco ni baston entre los dibujos.

    // --- Proteccion ---
    2406: 'item-leatherarmor',  // leather armor
    2407: 'item-mailarmor',     // chain armor: `mail` es justo la malla de anillas
    2408: 'item-platearmor',    // plate armor

    // --- Pociones y comida ---
    2413: 'item-flask',         // health potion: el frasco con liquido rojo
    2414: 'item-firepotion',    // mana potion: no hay frasco azul y es el unico que queda
    2415: 'item-burger',        // meat: lo mas parecido a un trozo de carne
    2416: 'item-cake'           // bread: no hay pan; lo mas parecido es lo horneado
};

/** Los colores. Nuestros, no los de Tibia: no se puede copiar un sprite que no se tiene. */
const PALETA_ORO = { cara: '#e8c24a', borde: '#6d4c10', brillo: '#fff0a8', piedra: '#c03030' };
const PALETA_CRISTAL = { cara: '#a8e4f0', borde: '#2a6a7a', brillo: '#f4ffff', piedra: '#3070c0' };

/*
 * LOS TRES OBJETOS QUE SE DIBUJAN AQUI, SIN SPRITE.
 *
 * La moneda de oro (3031) y el anillo (2376) salen en el botin de casi todos los monstruos
 * -el 3031 esta en 14 de los 15 ficheros de `data/monsters/`- y el mapa de la ciudad tiene
 * 29 monedas de oro, 5 de cristal y 1 anillo. Son, con diferencia, lo que mas se ve en el
 * suelo, y su dibujo de procedimiento es un rectangulo de color: mejorarlo se nota mas que
 * cualquier otra cosa de este archivo.
 *
 * POR QUE AQUI Y NO EN `sprites.js`. Ese archivo es el proveedor de procedimiento y no es
 * de este cambio; la forma que tiene este proveedor de mejorar algo es DEVOLVER SU PROPIO
 * LIENZO antes de recurrir al respaldo, que es justo lo que se hace aqui.
 *
 * EL RESPALDO SE SIGUE CONSULTANDO, y esto no es un detalle: hay una prueba que exige que
 * al pedir el 3031 se le pregunte a el -"el proveedor de BrowserQuest no deja huecos"-, y
 * tiene razon, porque un proveedor que decide por su cuenta lo que no hace falta puede
 * acabar dejando un agujero. De el se toma el MARCO: el tamano del lienzo y, sobre todo,
 * el ANCLA, que es lo que dice en que fila del lienzo empieza la casilla. Sus pixeles no se
 * copian porque son una barra de color que el dibujo nuevo tapa igual, y copiarla solo
 * dejaria una mancha dorada asomando por encima de las monedas.
 *
 * SI EL RESPALDO NO DA NADA -o si el entorno no tiene DOM- se usa el mismo ancla por defecto
 * que el usa para sus formas, asi que el objeto NO CAMBIA DE MARCO. Lo unico que cambia es
 * DONDE cae dentro de el: el respaldo pintaba su barra pegada al borde de arriba del lienzo,
 * medio fuera de la casilla, y aqui se pinta dentro de la casilla, que es donde se ve una
 * moneda en el suelo. El ancla, que es lo que situa el marco entero, no se toca.
 */

const PROPIOS = {
    3031: { dibujo: pintarMonedas, paleta: PALETA_ORO },
    2160: { dibujo: pintarMonedas, paleta: PALETA_CRISTAL },
    2376: { dibujo: pintarAnillo, paleta: PALETA_ORO }
};

/**
 * El ancla por defecto, si no hay respaldo del que heredarla.
 *
 * Es 4 porque es la que usa el proveedor de procedimiento para sus formas pequeñas -el
 * `height` de su forma, que es lo que sobresale por encima de la casilla-, y asi el objeto
 * cae en el mismo sitio con respaldo y sin el.
 */
const ANCLA_POR_DEFECTO = 4;

/** La banda donde se dibuja, contada DESDE el ancla: ancho, alto y margen de arriba. */
const BANDA_ANCHO = 24;
const BANDA_ALTO = 16;
const BANDA_MARGEN = 2;

/** Una moneda suelta, vista desde arriba y un poco de lado. */
function pintarMoneda(ctx, x, y, paleta) {
    ctx.beginPath();
    ctx.ellipse(x, y, 4.6, 3.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = paleta.cara;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = paleta.borde;
    ctx.stroke();

    // Un brillo arriba a la izquierda: sin el, la moneda parece un boton.
    ctx.beginPath();
    ctx.ellipse(x - 1.3, y - 1, 1.7, 1, 0, 0, Math.PI * 2);
    ctx.fillStyle = paleta.brillo;
    ctx.fill();
}

/**
 * Una pila de monedas.
 *
 * Se dibuja una SOMBRA debajo y las monedas de abajo arriba, para que cada una tape a la
 * anterior: asi la pila se lee como un monton y no como una mancha. La sombra es lo que la
 * apoya en el suelo; sin ella el monton parece flotar, que es el mismo criterio que sigue
 * el renderer con las criaturas.
 */
function pintarMonedas(ctx, marco, paleta) {
    const cx = marco.cx;
    const baseY = marco.y1 - 4;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 2, 11, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tres apoyadas y dos encima: con menos no parece una pila y con mas no cabe.
    const puestos = [[-7, 0], [0, -0.5], [7, 0], [-3.5, -4], [3.5, -4.5]];
    puestos.forEach((sitio) => pintarMoneda(ctx, cx + sitio[0], baseY + sitio[1], paleta));
}

/**
 * Un anillo.
 *
 * El aro va como tres elipses -la cara, el borde de fuera y el de dentro- porque un aro
 * grueso sin los bordes no se distingue de una mancha. La piedra es un adorno NUESTRO: no
 * hay anillo entre los dibujos de BrowserQuest y el de Tibia no se puede copiar, asi que se
 * dibuja un anillo generico en vez de fingir que es el suyo.
 */
function pintarAnillo(ctx, marco, paleta) {
    const cx = marco.cx;
    const cy = marco.y1 - 6;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, cy, 6.5, 5, 0, 0, Math.PI * 2);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = paleta.cara;
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = paleta.borde;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7.6, 6.1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, 5.4, 3.9, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy - 5.2, 2, 1.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = paleta.piedra;
    ctx.fill();
    ctx.strokeStyle = paleta.borde;
    ctx.stroke();
}

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
        }).catch(() => {
            /*
             * Sin este `catch`, el fallo de carga queda como RECHAZO SIN MANEJAR, y eso en
             * Node tumba el proceso entero -la prueba de dibujo importa este modulo y llama a
             * `get()`, asi que la cadena se llega a disparar alli-. Se anota como fallo y se
             * sigue: un sprite que no carga ya tiene salida, que es el respaldo.
             */
            this.fallos.add(nombre);
        });

        return null;
    }

    /**
     * El fotograma que toca, en coordenadas de la hoja.
     *
     * Se busca la animacion que toca -andando manda `walk_<direccion>`, quieto manda
     * `idle_<direccion>`- y, si el sprite no tiene ninguna de las dos, la primera que traiga
     * el fichero, que es lo que hace que los objetos -que solo tienen `idle`- funcionen sin
     * un caso especial. El JSON dice en que FILA esta cada animacion, que es justo el dato
     * que no se puede deducir mirando la imagen.
     *
     * LA COLUMNA LA DECIDE EL RELOJ, y el reloj entra por parametro: `ahora`. Ese instante
     * es el mismo que usa el resto del cliente -`performance.now()`, ver `renderer.js`-, y
     * de ahi sale el numero de fotograma. Sin instante se dibuja el primero, que es lo que
     * hacia este proveedor antes de animar nada y lo que sigue haciendo el editor, que pide
     * los objetos sin reloj.
     *
     * @param {string} nombre el sprite
     * @param {number} [direccion] la direccion del motor
     * @param {number} [ahora] el instante del reloj del cliente
     * @param {boolean} [quiereAndar] si la animacion de andar tiene prioridad
     * @param {number} [desfase] fotogramas de adelanto, para desincronizar
     */
    _fotograma(nombre, direccion, ahora, quiereAndar, desfase) {
        const entrada = this._entrada(nombre);
        if (!entrada) {
            return null;
        }

        const datos = entrada.datos;
        const animaciones = datos.animaciones || datos.animations || {};

        const dir = DIRECCIONES[direccion === undefined ? 2 : direccion] || DIRECCIONES[2];

        // El calculo del fotograma es puro y vive en `sprite-anim.js`: aqui solo se recorta.
        const elegida = animacionDe(animaciones, candidatasDeAnimacion(dir.nombre, quiereAndar));
        const fila = elegida && elegida.animacion.row !== undefined ? elegida.animacion.row : 0;
        const largo = elegida && elegida.animacion.length !== undefined ? elegida.animacion.length : 1;

        const intervalo = intervaloDeAnimacion(elegida ? elegida.clave : null, largo);
        const columna = columnaDeFotograma(ahora, intervalo, largo, desfase);

        return {
            imagen: entrada.imagen,
            sx: columna * datos.width,
            sy: fila * datos.height,
            sw: datos.width,
            sh: datos.height,
            espejar: dir.espejar,
            // La animacion y la columna van en el resultado porque son parte de la IDENTIDAD
            // del fotograma: sin ellas, el lienzo de un fotograma se reutilizaria para otro
            // y el muñeco se quedaria congelado en el primero que se dibujara.
            clave: elegida ? elegida.clave : 'fila' + fila,
            columna: columna
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

    /**
     * Un lienzo fuera de pantalla, o null si este entorno no tiene DOM.
     *
     * El modulo se importa TAMBIEN desde Node -la prueba de dibujo lo hace para comprobar
     * que este proveedor nunca deja un hueco-, y alli no hay `document`. Devolver null en vez
     * de reventar es lo que mantiene el modulo comprobable fuera del navegador; quien llama
     * decide que hacer sin lienzo, y siempre hay una salida decente: el respaldo.
     */
    _lienzo(ancho, alto) {
        if (typeof document === 'undefined' || !document.createElement) {
            return null;
        }

        const lienzo = document.createElement('canvas');
        lienzo.width = ancho;
        lienzo.height = alto;

        return lienzo;
    }

    /**
     * El dibujo propio de un objeto, con el MARCO que da el respaldo.
     *
     * El marco es el tamano del lienzo y el ANCLA. El ancla es lo que dice en que fila del
     * lienzo empieza la casilla, y por eso se hereda en vez de escribirla a mano: si el
     * respaldo cambia su forma, esto sigue cayendo donde cae el, que es lo que se quiere.
     * Si no hay respaldo, o no da un lienzo, se usa el marco por defecto -el mismo que el usa
     * para estas formas-, asi que el objeto no se mueve de sitio en ningun caso.
     *
     * La banda de dibujo se cuenta DESDE el ancla, o sea en filas de la casilla: los primeros
     * pixeles de la casilla son los pies de quien esta encima, asi que ahi es donde tiene que
     * estar una moneda en el suelo.
     */
    _dibujoPropio(typeId) {
        const receta = PROPIOS[typeId];
        if (!receta) {
            return null;
        }

        const clave = 'propio:' + typeId;
        const guardado = this.lienzos.get(clave);
        if (guardado) {
            return guardado;
        }

        // El respaldo se consulta SIEMPRE, tambien para estos tres: es la regla que impide
        // que un objeto se convierta en un agujero negro, y es lo que comprueba la prueba.
        const base = this._pedirAlRespaldo(typeId);
        const lienzoBase = base && base.canvas && typeof base.canvas === 'object' ? base.canvas : null;

        const anchoBase = lienzoBase && typeof lienzoBase.width === 'number' ? lienzoBase.width : TILE;
        const altoBase = lienzoBase && typeof lienzoBase.height === 'number' ? lienzoBase.height : TILE;
        const ancla = base && typeof base.anchorY === 'number' ? base.anchorY : ANCLA_POR_DEFECTO;

        const ancho = Math.max(TILE, Math.round(anchoBase));
        // El lienzo se alarga lo justo para que quepa la banda: si el respaldo la dejara
        // fuera, el dibujo saldria recortado por abajo.
        const alto = Math.max(Math.round(altoBase), Math.ceil(ancla + BANDA_MARGEN + BANDA_ALTO + 2));

        const lienzo = this._lienzo(ancho, alto);
        if (!lienzo) {
            return base;
        }

        const banda = {
            ancho: ancho,
            alto: alto,
            ancla: ancla,
            y0: ancla + BANDA_MARGEN,
            y1: ancla + BANDA_MARGEN + BANDA_ALTO,
            cx: Math.round(ancho / 2)
        };

        receta.dibujo(lienzo.getContext('2d'), banda, receta.paleta);

        const sprite = { canvas: lienzo, anchorY: ancla };
        this.lienzos.set(clave, sprite);

        return sprite;
    }

    /**
     * El sprite de un objeto del suelo, o lo que ponga el respaldo.
     *
     * EL ORDEN DE LOS TRES CAMINOS ES LA REGLA, y no da igual cual vaya primero:
     *
     *   1. El dibujo de BrowserQuest, que es un dibujo de verdad.
     *   2. El dibujo propio de la moneda y el anillo, que es mejor que un rectangulo pero peor
     *      que un dibujo de verdad: si algun dia aparece su sprite, gana el sprite.
     *   3. El respaldo, para todo lo demas.
     *
     * @param {number} typeId el id del objeto
     * @param {number} [ahora] el instante del reloj del cliente, para elegir el fotograma
     */
    get(typeId, ahora) {
        const id = Number(typeId);
        const nombre = OBJETOS[id];

        if (nombre) {
            const fotograma = this._fotograma(nombre, undefined, ahora, false, id);

            if (!fotograma) {
                // El sprite todavia no ha cargado. Mientras tanto dibuja el respaldo: un
                // rectangulo de color medio segundo se nota menos que un hueco.
                return this._pedirAlRespaldo(id);
            }

            return this._aCasilla(nombre + '@' + id + '#' + fotograma.clave + ':' +
                fotograma.columna, fotograma);
        }

        const propio = this._dibujoPropio(id);
        if (propio) {
            return propio;
        }

        return this._pedirAlRespaldo(id);
    }

    /**
     * El sprite de una criatura, o null si no hay dibujo para ella.
     *
     * El ancho del lienzo se toma del propio fotograma cuando es MAS GRANDE que una casilla,
     * porque un jefe de 48x48 dibujado en un lienzo de 32 saldria cortado.
     *
     * ANDAR O ESTAR QUIETO lo dice la lista de dibujo: `op.moving` es verdadero mientras la
     * criatura se desliza de una casilla a la siguiente. Ese dato ya viajaba hasta aqui -lo
     * pone `drawlist.js` al interpolar- y antes no se miraba, asi que un muñeco que andaba
     * seguia con la animacion de reposo. El desfase va con el IDENTIFICADOR: sin el, todas las
     * ratas de la pantalla andarian con el mismo pie a la vez.
     *
     * @param {Object} op la operacion de dibujo de la criatura
     * @param {number} [ahora] el instante del reloj del cliente
     */
    getCreature(op, ahora) {
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

        const fotograma = this._fotograma(nombre, op.direction, ahora, !!op.moving, op.id);
        if (!fotograma) {
            return null;
        }

        const lado = Math.max(TILE, fotograma.sw, fotograma.sh);

        return this._aCasilla(nombre + ':' + (op.direction || 0) + ':' + lado + '#' +
            fotograma.clave + ':' + fotograma.columna, fotograma, lado);
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
            /*
             * Cuantos lienzos hay construidos. Se cuenta desde que hay animacion porque el
             * numero ya no es "uno por sprite": es uno por sprite Y FOTOGRAMA, y es el dato
             * que dice si la cache esta haciendo su trabajo o creciendo sin freno.
             */
            lienzos: this.lienzos.size,
            fallos: Array.from(this.fallos)
        };
    }
}

/** El lado de una casilla. Se repite aqui para no depender del orden de carga. */
const TILE = 32;
