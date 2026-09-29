'use strict';

/**
 * Búsqueda de caminos sobre la rejilla de tiles.
 *
 * Es una búsqueda en anchura (BFS), no A*. La razón es que **todos los pasos
 * cuestan lo mismo**: en el mundo ya hay suelos que cuestan más (el charco del
 * mapa de ejemplo tarda el doble), pero ese coste es de TIEMPO, no de distancia
 * recorrida, y un monstruo que rodea un charco para ahorrar tiempo recorrería más
 * tiles de los necesarios y se vería raro. Si algún día el coste de camino debe
 * influir, el cambio es sustituir la cola por una cola de prioridad y esto pasa a
 * ser Dijkstra.
 *
 * El tope de nodos no es opcional. Sin él, un monstruo encerrado en una región
 * grande recorrería el mapa entero en cada intento de persecución, y con veinte
 * monstruos persiguiendo a la vez el bucle del servidor se caería. Como la
 * búsqueda está acotada, «no encontré camino» es una respuesta normal y el que
 * llama debe saber seguir sin él.
 */

/** Nodos que se exploran como mucho antes de rendirse. */
const DEFAULT_NODE_LIMIT = 2000;

/** Las ocho direcciones, en el orden en que conviene probarlas. */
const OFFSETS = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
    { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
];

function key(x, y, z) {
    return x + ',' + y + ',' + z;
}

/**
 * Busca el camino más corto entre dos posiciones.
 *
 * @param {GameMap} map
 * @param {{x, y, z}} from
 * @param {{x, y, z}} to
 * @param {Object} [options]
 * @param {number} [options.nodeLimit]
 * @param {number} [options.maxDistance] si se indica, no se busca más lejos
 * @param {Function} [options.isBlocked] permite vetar celdas además del terreno
 *        (por ejemplo, ocupadas por otra criatura)
 * @returns {{found: boolean, path: Array<{x,y}>, explored: number, reason: string}}
 *          `path` NO incluye el origen y cada paso es adyacente al anterior.
 */
function findPath(map, from, to, options) {
    const opts = options || {};
    const nodeLimit = opts.nodeLimit === undefined ? DEFAULT_NODE_LIMIT : opts.nodeLimit;
    const isBlocked = opts.isBlocked || null;

    if (!map) {
        return { found: false, path: [], explored: 0, reason: 'noMap' };
    }

    // Cambiar de planta no se camina: en Tibia las escaleras son teletransportes.
    if (from.z !== to.z) {
        return { found: false, path: [], explored: 0, reason: 'floorChange' };
    }

    if (from.x === to.x && from.y === to.y) {
        return { found: true, path: [], explored: 0, reason: 'alreadyThere' };
    }

    const startKey = key(from.x, from.y, from.z);
    const goalKey = key(to.x, to.y, to.z);

    const visited = new Set([startKey]);
    const cameFrom = new Map();

    // Cola con índice de cabeza en vez de `shift()`: `shift()` sobre un array
    // grande es O(n) y convertiría la búsqueda en cuadrática.
    //
    // Los nodos llevan la Z aunque la búsqueda no cambie de planta. Es
    // imprescindible y no un detalle: `map.canWalk` comprueba `to.z !== from.z`
    // para rechazar los cambios de planta, así que un nodo sin Z se rechaza a sí
    // mismo como si fuera un cambio de planta y la búsqueda no encuentra NADA.
    const queue = [{ x: from.x, y: from.y, z: from.z }];
    let head = 0;
    let explored = 0;

    const maxDistance = opts.maxDistance;

    while (head < queue.length) {
        const current = queue[head];
        head += 1;
        explored += 1;

        if (explored > nodeLimit) {
            return { found: false, path: [], explored: explored, reason: 'nodeLimit' };
        }

        for (const offset of OFFSETS) {
            const next = { x: current.x + offset.x, y: current.y + offset.y, z: from.z };
            const nextKey = key(next.x, next.y, from.z);

            if (visited.has(nextKey)) {
                continue;
            }

            if (maxDistance !== undefined) {
                const distance = Math.max(
                    Math.abs(next.x - from.x), Math.abs(next.y - from.y));
                if (distance > maxDistance) {
                    continue;
                }
            }

            visited.add(nextKey);

            // Se planifica sobre el TERRENO, ignorando a las criaturas.
            //
            // Es imprescindible, y no una comodidad. El destino de una persecución
            // está ocupado por el propio perseguido, así que si contara como
            // bloqueante la meta sería INALCANZABLE POR DEFINICIÓN: la búsqueda
            // exploraría el mapa entero y acabaría en el tope de nodos, y los
            // monstruos no podrían alcanzar a nadie nunca. Es exactamente el fallo
            // que apareció al escribir la prueba de persecución.
            //
            // Que una criatura bloquee un paso se decide al DARLO, no al
            // planificarlo: si el paso falla, el camino se descarta y se recalcula.
            // La comprobación de esquinas sí se hereda del mapa, y esa es la que
            // impide que un monstruo atraviese una pared en diagonal.
            const check = map.canWalk(current, next, { ignoreCreatures: true });
            if (!check.allowed) {
                continue;
            }

            if (isBlocked && isBlocked(next.x, next.y, from.z)) {
                continue;
            }

            cameFrom.set(nextKey, current);

            if (nextKey === goalKey) {
                return {
                    found: true,
                    path: reconstruct(cameFrom, from, next),
                    explored: explored,
                    reason: 'found'
                };
            }

            queue.push(next);
        }
    }

    return { found: false, path: [], explored: explored, reason: 'unreachable' };
}

/** Reconstruye el camino desde el mapa de predecesores. */
function reconstruct(cameFrom, from, last) {
    const path = [];
    let current = last;

    while (current && !(current.x === from.x && current.y === from.y)) {
        path.push({ x: current.x, y: current.y });
        current = cameFrom.get(key(current.x, current.y, from.z));
    }

    path.reverse();
    return path;
}

module.exports = { findPath, OFFSETS, DEFAULT_NODE_LIMIT };
