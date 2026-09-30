/**
 * La animacion de los sprites: QUE FOTOGRAMA TOCA en cada instante.
 *
 * POR QUE ESTO ES UN MODULO APARTE. De toda la animacion, lo unico que es calculo puro
 * es esto: dado el JSON de un sprite -que dice cuantos fotogramas tiene cada animacion y
 * en que fila esta- y un instante, sale un numero de columna. Aqui no hay lienzos ni
 * relojes: el instante ENTRA COMO PARAMETRO. Por eso se puede comprobar en Node sin
 * abrir un navegador, que es la misma razon por la que `camera.js` y `drawlist.js` viven
 * separados del renderer.
 *
 * EL RELOJ ES UNO SOLO, Y ES EL DEL CLIENTE. `world.now` y el bucle de dibujo usan
 * `performance.now()`. Aqui no se llama a ningun reloj, y esa es la parte que importa:
 * el fallo que ya hubo en este proyecto fue mezclar `Date.now()` -milisegundos desde
 * 1970, un billon y pico- con el reloj de `requestAnimationFrame` -milisegundos desde
 * que se abrio la pagina, unos miles-, y el desfase no era pequeno: el paso se quedaba
 * clavado en su casilla de salida. Con el instante como parametro, mezclar dos escalas
 * de tiempo es imposible desde aqui.
 */

/**
 * Lo que dura un paso de una criatura, en milisegundos.
 *
 * DE DONDE SALE ESTE NUMERO: de `engine/world/stepcost.js`, que lo documenta con un
 * ejemplo -"speed = 220, suelo normal -> 550 ms por paso"-. NO es una cifra de Tibia
 * copiada de ningun sitio, es el paso por defecto de ESTE mundo, y es el unico dato de
 * tiempo que el cliente tiene a mano.
 *
 * ES UNA APROXIMACION CONSCIENTE, y conviene decir por que. El motor manda en cada
 * movimiento su duracion exacta -`MOVE_FIELD.DURATION`, que la prueba de dibujo usa con
 * 550-, asi que lo exacto seria animar con ESA duracion. Hoy no se puede: la lista de
 * dibujo no lleva ese campo hasta el renderer, y para llevarlo habria que tocar
 * `drawlist.js`, que no es de este cambio. Un monstruo mas lento que el jugador andara,
 * por tanto, con el compas del jugador, y se vera igual de bien porque el ciclo no
 * depende de la velocidad para leerse.
 */
export const PASO_MS = 550;

/** Cuanto se tarda en dar una vuelta a la animacion que no es de andar, en pasos. */
const PASOS_POR_REPOSO = 2;

/**
 * El nombre de la animacion es de andar.
 *
 * Se mira el PREFIJO y no la lista entera de nombres posibles porque los nombres de
 * BrowserQuest son `walk_up`, `walk_right`... y asi un sprite nuevo con
 * `walk_northwest` sigue contando como andar sin tocar esto.
 */
export function esAndar(nombre) {
    return String(nombre === undefined || nombre === null ? '' : nombre).indexOf('walk') === 0;
}

/**
 * Cada cuanto cambia de fotograma una animacion.
 *
 * EL JSON NO TRAE VELOCIDAD: `length` y `row`, y nada mas. La velocidad hay que
 * ponerla, y aqui NO se copia de Tibia ni de BrowserQuest: no hay ningun dato de esos
 * en el repositorio que la fije, y escribir un numero y llamarlo "el de BrowserQuest"
 * seria inventarselo, que es el peor fallo posible en este proyecto.
 *
 * Lo que se hace es DERIVARLA de un dato que si existe, el paso del motor:
 *
 *   - ANDAR: un ciclo entero dura un paso, con cualquier numero de fotogramas.
 *         intervalo = PASO_MS / fotogramas
 *     Es lo que hace que el muñeco no parezca patinar: los pies dan la vuelta al ciclo
 *     justo cuando llega a la casilla siguiente.
 *
 *   - LO DEMAS (el reposo, y el brillo de los objetos): a la MITAD de velocidad. Es una
 *     decision de presentacion, no un dato: mas lento se lee como respiracion y mas
 *     rapido parece que el muñeco esta nervioso.
 *
 * @param {string} nombre el nombre de la animacion, tal y como viene del JSON
 * @param {number} largo cuantos fotogramas tiene
 * @param {number} [pasoMs] el paso del mundo, para poder inyectarlo en una prueba
 * @returns {number} milisegundos por fotograma, siempre mayor que cero
 */
export function intervaloDeAnimacion(nombre, largo, pasoMs) {
    const fotogramas = Math.max(1, Math.trunc(Number(largo)) || 1);
    const paso = Number(pasoMs) > 0 ? Number(pasoMs) : PASO_MS;

    return (esAndar(nombre) ? paso : paso * PASOS_POR_REPOSO) / fotogramas;
}

/**
 * La columna del fotograma que toca dibujar.
 *
 * El desfase va EN FOTOGRAMAS y no en milisegundos porque es lo que se necesita: dos
 * criaturas de la misma especie con el mismo desfase andan con el mismo pie a la vez, y
 * seis ratas marchando al unisono se notan muchisimo. Pasando el identificador de la
 * criatura, cada una va por su sitio sin dejar de usar el mismo reloj.
 *
 * @param {number} ahora el instante, del reloj del cliente
 * @param {number} intervalo milisegundos por fotograma, de `intervaloDeAnimacion`
 * @param {number} largo cuantos fotogramas tiene la animacion
 * @param {number} [desfase] fotogramas de adelanto, para desincronizar
 * @returns {number} 0..largo-1, siempre dentro del rango
 */
export function columnaDeFotograma(ahora, intervalo, largo, desfase) {
    const fotogramas = Math.max(1, Math.trunc(Number(largo)) || 1);
    const paso = Number(intervalo) > 0 ? Number(intervalo) : PASO_MS;
    const instante = Number(ahora);

    // Sin instante -quien llame sin reloj, como el editor-, se dibuja el primer
    // fotograma: es lo que hacia este proveedor antes de animar nada.
    if (!Number.isFinite(instante)) {
        return 0;
    }

    const avance = Math.floor(instante / paso) + (Math.trunc(Number(desfase)) || 0);

    // El modulo de JavaScript devuelve negativo con un dividendo negativo, y un
    // desfase negativo es una peticion razonable. Se normaliza para no devolver nunca
    // una columna fuera de la hoja, que dibujaria trozos de la animacion vecina.
    return ((avance % fotogramas) + fotogramas) % fotogramas;
}

/**
 * Las animaciones que se prueban, en orden, para una direccion.
 *
 * El orden dice QUE GANA cuando un sprite tiene las dos: andando manda `walk_` y quieto
 * manda `idle_`. Antes se preferia siempre `idle_`, asi que un muñeco que se movia
 * seguia con la animacion de estar parado; el dato para elegir ya viajaba en la lista de
 * dibujo -`moving`-, solo habia que mirarlo.
 *
 * Y al final van las de abajo (`idle_down`, `walk_down`) porque hay sprites -el
 * `villager` y el `guard`- que SOLO traen esa: mirando a la derecha no tienen fila
 * propia, y es mejor su unica animacion que nada.
 */
export function candidatasDeAnimacion(nombreDireccion, quiereAndar) {
    const dir = nombreDireccion || 'down';

    const propias = quiereAndar
        ? ['walk_' + dir, 'idle_' + dir, 'walk', 'idle']
        : ['idle_' + dir, 'walk_' + dir, 'idle', 'walk'];

    return propias.concat(['idle_down', 'walk_down']);
}

/**
 * Elige la animacion de entre las que trae el fichero.
 *
 * Si no hay ninguna de las esperadas se usa LA PRIMERA del fichero, que es lo que hace
 * que un sprite con una sola animacion -todos los objetos, que solo tienen `idle`-
 * funcione sin un caso especial. Y si el fichero no trae ninguna, se devuelve null y
 * quien llama dibuja la fila 0 con un solo fotograma, que es el comportamiento de antes.
 *
 * @returns {{clave: string, animacion: Object}|null}
 */
export function animacionDe(animaciones, candidatas) {
    const tabla = animaciones || {};

    for (const clave of candidatas || []) {
        if (tabla[clave]) {
            return { clave: clave, animacion: tabla[clave] };
        }
    }

    const claves = Object.keys(tabla);
    if (claves.length === 0) {
        return null;
    }

    return { clave: claves[0], animacion: tabla[claves[0]] };
}
