/**
 * La lista de dibujo: qué se pinta y en qué orden.
 *
 * Aquí está la otra mitad del 2.5D. La primera es el desplazamiento por planta (en
 * `camera.js`); ésta es el ORDEN, y sin él el desplazamiento no sirve de nada
 * porque las cosas se taparían unas a otras al revés.
 *
 * DOS ÓRDENES, UNO DENTRO DEL OTRO
 *
 * 1. ENTRE PLANTAS: de la más profunda (z mayor) a la más alta (z menor). Las
 *    plantas de arriba se pintan después, y por eso tapan a las de abajo. Es lo que
 *    hace que una plataforma elevada oculte el suelo que tiene delante en vez de
 *    aparecer flotando.
 *
 * 2. DENTRO DE UNA PLANTA: por diagonales. Se recorre sumando `x + y`, de la
 *    esquina de arriba a la izquierda hacia la de abajo a la derecha, y dentro de
 *    cada diagonal de izquierda a derecha. Suena arbitrario y no lo es: un muñeco
 *    se dibuja DESDE SU casilla hacia arriba, así que lo que está más abajo en la
 *    pantalla tiene que pintarse después para taparlo. Recorrer la pantalla de
 *    arriba a la izquierda hacia abajo a la derecha hace exactamente eso.
 *
 * Es el mismo orden que sigue OTClient en `MapView::updateVisibleTilesCache`, donde
 * el bucle es `numDiagonals = ancho + alto - 1` y dentro avanza `ix` mientras
 * retrocede `iy`. Aquí se escribe con una suma en vez de con su aritmética de
 * índices porque hace lo mismo y se lee de un vistazo.
 *
 * DENTRO DE UN TILE, el orden es el que manda el motor: suelo, items de abajo,
 * CRIATURAS, items de arriba. El corte entre los dos grupos de items viene en el
 * mensaje, y es lo que permite meter a los muñecos en medio: una mesa va por encima
 * de un jugador y una alfombra por debajo.
 */

/** Los tipos de operación de dibujo. */
export const DRAW = {
    GROUND: 'ground',
    ITEM: 'item',
    CREATURE: 'creature'
};

/**
 * Construye la lista de dibujo.
 *
 * @param {ClientWorld} world
 * @param {Camera} camera
 * @param {Object} [options]
 * @param {number} [options.now] instante para interpolar los movimientos
 * @param {boolean} [options.onlyCurrentFloor] para depurar, una sola planta
 * @returns {Array<Object>} operaciones en orden de pintado
 */
export function buildDrawList(world, camera, options) {
    const opts = options || {};
    const now = opts.now === undefined ? world.now() : opts.now;
    const ops = [];

    const floors = opts.onlyCurrentFloor
        ? [camera.z]
        : world.floors();

    // Las criaturas se indexan por su casilla LÓGICA una sola vez, y no se busca
    // por tile dentro del bucle: con 250 tiles en pantalla y doscientos monstruos,
    // recorrer la tabla entera por tile serían cincuenta mil comprobaciones por
    // fotograma, y eso no hay quien lo dibuje.
    const creaturesByTile = indexCreatures(world, now);

    floors.forEach((z) => {
        const rect = camera.visibleRect(z);

        forEachTileInDrawOrder(rect, (x, y) => {
            const tile = world.getTile(x, y, z);

            // Si el motor no lo mandó, no existe. El cliente NO se inventa el
            // terreno que no ha recibido: es la regla que impide que un cliente
            // modificado vea más de lo que le corresponde.
            if (!tile) {
                return;
            }

            const screen = camera.worldToScreen(x, y, z);
            const base = { x: x, y: y, z: z, sx: screen.x, sy: screen.y };

            if (tile.ground) {
                ops.push({
                    kind: DRAW.GROUND,
                    typeId: tile.ground,
                    count: 1,
                    x: x, y: y, z: z, sx: screen.x, sy: screen.y
                });
            }

            // --- Items de abajo ---
            for (let index = 0; index < tile.downCount; index += 1) {
                const item = tile.items[index];
                ops.push({
                    kind: DRAW.ITEM,
                    typeId: item.id,
                    count: item.count,
                    instanceId: item.instanceId,
                    band: 'down',
                    x: x, y: y, z: z, sx: screen.x, sy: screen.y
                });
            }

            // --- Criaturas: entre los dos grupos de items ---
            const here = creaturesByTile.get(x + ',' + y + ',' + z);
            if (here) {
                here.forEach((entry) => {
                    const position = camera.worldToScreen(entry.px, entry.py, z);
                    ops.push({
                        kind: DRAW.CREATURE,
                        creature: entry.creature,
                        id: entry.creature.id,
                        name: entry.creature.name,
                        direction: entry.creature.direction,
                        health: entry.creature.health,
                        isPlayer: entry.creature.isPlayer,
                        moving: entry.moving,
                        x: x, y: y, z: z,
                        sx: position.x, sy: position.y
                    });
                });
            }

            // --- Items de arriba ---
            for (let index = tile.downCount; index < tile.items.length; index += 1) {
                const item = tile.items[index];
                ops.push({
                    kind: DRAW.ITEM,
                    typeId: item.id,
                    count: item.count,
                    instanceId: item.instanceId,
                    band: 'top',
                    x: x, y: y, z: z, sx: screen.x, sy: screen.y
                });
            }
        });
    });

    return ops;
}

/**
 * Recorre las casillas de un rectángulo en el orden de pintado.
 *
 * Se separa del bucle principal para que el orden quede en un solo sitio, con
 * nombre, y no enterrado entre el resto de la lógica de dibujo.
 */
export function forEachTileInDrawOrder(rect, visit) {
    const width = rect.x1 - rect.x0 + 1;
    const height = rect.y1 - rect.y0 + 1;

    if (width <= 0 || height <= 0) {
        return;
    }

    // De la diagonal 0 (esquina de arriba a la izquierda) a la última (abajo a la
    // derecha), y dentro de cada una de izquierda a derecha.
    const lastDiagonal = (width - 1) + (height - 1);

    for (let sum = 0; sum <= lastDiagonal; sum += 1) {
        const from = Math.max(0, sum - (height - 1));
        const to = Math.min(sum, width - 1);

        for (let ix = from; ix <= to; ix += 1) {
            visit(rect.x0 + ix, rect.y0 + (sum - ix));
        }
    }
}

/**
 * Índice de criaturas por casilla, para no buscarlas dentro del bucle.
 *
 * Se indexan por su posición LÓGICA, no por la interpolada: un muñeco que se está
 * moviendo ocupa la casilla de la que sale hasta que termina de llegar. Es lo
 * correcto para el orden de pintado —el sprite se desliza, pero su sitio en la pila
 * del tile es el de origen— y además evita que cambie de capa a mitad de camino.
 */
function indexCreatures(world, now) {
    const index = new Map();

    world.creatures.forEach((creature) => {
        const position = world.creaturePosition(creature, now);
        const key = creature.x + ',' + creature.y + ',' + creature.z;

        let list = index.get(key);
        if (!list) {
            list = [];
            index.set(key, list);
        }

        list.push({
            creature: creature,
            px: position.x,
            py: position.y,
            moving: position.moving
        });
    });

    return index;
}

/**
 * Resumen de la lista, para los diagnósticos y las pruebas.
 */
export function summarize(ops) {
    const counts = { ground: 0, item: 0, creature: 0 };
    const floors = new Set();

    ops.forEach((op) => {
        counts[op.kind] = (counts[op.kind] || 0) + 1;
        floors.add(op.z);
    });

    return {
        total: ops.length,
        ground: counts.ground,
        items: counts.item,
        creatures: counts.creature,
        floors: Array.from(floors).sort((a, b) => b - a)
    };
}
