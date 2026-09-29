'use strict';

/**
 * El servidor de herramientas: sirve el editor y su API.
 *
 * POR QUÉ UN SERVIDOR PROPIO Y NO AÑADIRLO AL DEL JUEGO. Porque son cosas distintas
 * con ciclos de vida distintos. El servidor de juego atiende a jugadores y no debe
 * exponer un API que escribe archivos del datapack; el de herramientas escribe
 * archivos y no debe atender a nadie que esté jugando. Mezclarlos significaría que
 * un fallo en el editor tumba las partidas, y que para editar un mapa hay que
 * levantar el servidor con sus monstruos y sus temporizadores.
 *
 * SIRVE LOS MÓDULOS DEL CLIENTE, y eso es deliberado: el editor dibuja el mapa con
 * LA MISMA cámara y EL MISMO orden de dibujo que el juego. Si el editor tuviera su
 * propio renderer, acabarían discrepando, y un mapa que se ve bien en el editor y
 * mal en el juego es un fallo que cuesta horas entender.
 *
 * El API escribe en `data/`, QUE ES EL DATAPACK. Por eso escucha sólo en localhost
 * por defecto: no lleva autenticación y no debe ser alcanzable desde fuera.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const Xml = require('../engine/data/xml');
const ItemsFile = require('./lib/itemsfile');
const MapLoader = require('../engine/world/loader');
const MapWriter = require('../engine/world/writer');
const { Item } = require('../engine/world/item');
const { FLAG_NAMES } = require('../engine/world/writer');

const ROOT = path.resolve(__dirname, '..');

/** Lo que se sirve por HTTP: prefijo de URL -> carpeta del disco. */
const MOUNTS = [
    { prefix: '/avillatoro/', dir: path.join(ROOT, 'client', 'avillatoro') },
    { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
    { prefix: '/', dir: path.join(ROOT, 'editor') }
];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

const MAX_BODY_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Rutas del datapack
// ---------------------------------------------------------------------------

/**
 * Dónde está el datapack que se edita.
 *
 * Es configurable para que las pruebas trabajen sobre COPIAS. Una prueba que
 * escribiera en `data/` de verdad estaría modificando el datapack del proyecto cada
 * vez que se ejecuta, y entonces un fallo de la prueba se convierte en un mapa roto y
 * el fallo real queda escondido detrás del daño que hizo la propia prueba.
 */
const PATHS = {
    mapsDir: path.join(ROOT, 'data', 'world'),
    itemsFile: path.join(ROOT, 'data', 'items', 'items.xml')
};

function configurePaths(options) {
    const opts = options || {};
    if (opts.mapsDir) {
        PATHS.mapsDir = path.resolve(opts.mapsDir);
    }
    if (opts.itemsFile) {
        PATHS.itemsFile = path.resolve(opts.itemsFile);
    }
    return PATHS;
}

function mapsDirectory() {
    return PATHS.mapsDir;
}

function itemsPath() {
    return PATHS.itemsFile;
}

/** Nombres de mapa válidos. Se rechaza cualquier cosa con barras o puntos. */
function safeMapName(name) {
    const clean = String(name || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
        return null;
    }
    return clean;
}

function mapFilePath(name) {
    return path.join(mapsDirectory(), name + '.map.json');
}

// ---------------------------------------------------------------------------
// Aplicar ediciones a un mapa
// ---------------------------------------------------------------------------

/**
 * Convierte las banderas por nombre a su número, y avisa de las que no existen.
 *
 * Se avisa en vez de ignorarlas: una bandera mal escrita en el editor que se guarda
 * sin más deja un mapa que parece correcto y no tiene la propiedad que se quería.
 */
function flagsFromNames(names) {
    const unknown = [];
    let bits = 0;

    (names || []).forEach((name) => {
        const entry = FLAG_NAMES.find(([flagName]) => flagName === name);
        if (!entry) {
            unknown.push(name);
            return;
        }
        bits |= entry[1];
    });

    return { bits: bits, unknown: unknown };
}

/**
 * Aplica una lista de ediciones a un mapa cargado.
 *
 * LA FORMA DE UNA EDICIÓN ES "CÓMO DEBE QUEDAR EL TILE", no "qué hay que cambiar".
 * Es lo que hace que aplicar la misma edición dos veces dé lo mismo, y que el editor
 * no tenga que llevar la cuenta de lo que ya mandó.
 *
 * Una edición sin suelo, sin items y sin banderas significa BORRAR: el tile vuelve a
 * ser suelo por defecto. Es lo que hace la goma de borrar.
 */
function applyEdits(map, edits, itemTypes) {
    const problems = [];
    let changed = 0;

    edits.forEach((edit) => {
        const x = Number(edit.x);
        const y = Number(edit.y);
        const z = Number(edit.z);

        if (!map.inBounds(x, y, z)) {
            problems.push('edicion fuera del mapa en (' + x + ',' + y + ',' + z + ')');
            return;
        }

        const items = edit.items || [];
        const flags = edit.flags || [];
        const hasGround = edit.ground !== undefined && edit.ground !== null;
        const isEmpty = !hasGround && items.length === 0 && flags.length === 0;

        if (isEmpty) {
            if (map.removeTile(x, y, z)) {
                changed += 1;
            }
            return;
        }

        const tile = map.getOrCreateTile(x, y, z);
        if (!tile) {
            problems.push('no se pudo crear el tile en (' + x + ',' + y + ',' + z + ')');
            return;
        }

        if (hasGround) {
            const definition = itemTypes.get(Number(edit.ground));
            if (!definition) {
                problems.push('el suelo ' + edit.ground + ' no existe en items.xml');
                return;
            }
            tile.setGround(new Item(definition, { count: 1 }));
        }

        // Los items se reemplazan ENTEROS, no se añaden. Si se añadieran, pintar dos
        // veces el mismo muro lo pondría dos veces, y el mapa acumularía basura con
        // cada retoque.
        tile.downItems.length = 0;
        tile.topItems.length = 0;

        items.forEach((entry) => {
            const typeId = Number(entry.id !== undefined ? entry.id : entry);
            const definition = itemTypes.get(typeId);

            if (!definition) {
                problems.push('el item ' + typeId + ' no existe en items.xml');
                return;
            }

            tile.addItem(new Item(definition, {
                count: entry.count === undefined ? 1 : Number(entry.count),
                attributes: entry.attributes || null
            }));
        });

        const parsedFlags = flagsFromNames(flags);
        parsedFlags.unknown.forEach((name) => {
            problems.push('la bandera "' + name + '" no existe');
        });
        tile.flags = parsedFlags.bits;

        changed += 1;
    });

    return { changed: changed, problems: problems };
}

/** Las claves de documentación de un archivo de mapa, que hay que conservar. */
function documentationKeys(data) {
    const extras = {};
    Object.keys(data).forEach((key) => {
        if (key.startsWith('_')) {
            extras[key] = data[key];
        }
    });
    return extras;
}

// ---------------------------------------------------------------------------
// Cargar y guardar
// ---------------------------------------------------------------------------

function loadItemTypes() {
    const file = itemsPath();
    if (!fs.existsSync(file)) {
        throw new Error('no se encontro ' + file);
    }
    return Xml.loadItems(file);
}

function readMap(name) {
    const file = mapFilePath(name);
    if (!fs.existsSync(file)) {
        return null;
    }

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const itemTypes = loadItemTypes();

    const result = MapLoader.buildMap(raw, { itemTypes });
    if (!result.report.ok) {
        return {
            error: 'el mapa tiene errores y no se puede abrir',
            problems: result.report.errors.map((entry) =>
                (entry.where ? entry.where + ': ' : '') + entry.message)
        };
    }

    return {
        name: name,
        raw: raw,
        map: result.map,
        itemTypes: itemTypes,
        extras: documentationKeys(raw)
    };
}

/**
 * Guarda un mapa, comprobando ANTES que se puede volver a leer.
 *
 * Es la comprobación que justifica que este servidor exista: si el escritor tiene un
 * fallo, el archivo que produce no lo va a detectar nadie hasta que el motor intente
 * arrancar, y para entonces el mapa bueno ya se ha sobrescrito. Comprobando la ida y
 * vuelta antes de escribir, un fallo se convierte en un mensaje de error y el archivo
 * se queda como estaba.
 */
function writeMap(name, loaded, options) {
    const opts = options || {};

    const result = MapWriter.verifyRoundTrip(loaded.map, MapLoader.buildMap, {
        itemTypes: loaded.itemTypes,
        extraKeys: loaded.extras,
        name: name
    });

    if (!result.ok) {
        return { ok: false, problems: result.problems };
    }

    const text = MapWriter.writeMap(loaded.map, {
        itemTypes: loaded.itemTypes,
        extraKeys: loaded.extras,
        name: name
    });

    // Se escribe en un temporal y se renombra. Un guardado que se corta a la mitad
    // deja el archivo original intacto en vez de uno truncado, y en un mapa truncado
    // se pierde el trabajo de semanas.
    const target = mapFilePath(name);
    const temporary = target + '.tmp';

    if (opts.dryRun) {
        return { ok: true, dryRun: true, bytes: text.length, text: text };
    }

    fs.writeFileSync(temporary, text, 'utf8');
    fs.renameSync(temporary, target);

    return { ok: true, bytes: text.length, text: text };
}

// ---------------------------------------------------------------------------
// El servidor
// ---------------------------------------------------------------------------

function sendJson(response, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(body);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];

        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('el cuerpo pasa de ' + MAX_BODY_BYTES + ' bytes'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });

        request.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!text) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(text));
            } catch (error) {
                reject(new Error('el cuerpo no es JSON valido: ' + error.message));
            }
        });

        request.on('error', reject);
    });
}

/** Sirve un archivo estático, sin salirse de su montaje. */
function serveStatic(request, response, pathname) {
    for (const mount of MOUNTS) {
        if (!pathname.startsWith(mount.prefix)) {
            continue;
        }

        let rest = pathname.slice(mount.prefix.length);
        if (rest === '' || rest.endsWith('/')) {
            rest += 'index.html';
        }

        const target = path.normalize(path.join(mount.dir, rest));

        // Sin esta comprobación, `/../server/config.json` se serviría. Es el fallo
        // clásico de cualquier servidor de archivos.
        if (!target.startsWith(mount.dir)) {
            response.writeHead(403);
            response.end('fuera del montaje');
            return true;
        }

        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
            return false;
        }

        const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        response.end(fs.readFileSync(target));
        return true;
    }

    return false;
}

async function handleApi(request, response, pathname, query) {
    const method = request.method.toUpperCase();

    // `query` es un URLSearchParams, que tiene la misma forma de lectura que el
    // objeto que devolvía `url.parse`. Se normaliza aquí para no cambiarlo todo.
    const queryOf = (key) => (query && typeof query.get === 'function'
        ? query.get(key) : (query ? query[key] : null));

    // --- Lista de mapas ---
    if (pathname === '/api/maps' && method === 'GET') {
        const directory = mapsDirectory();
        const maps = [];

        if (fs.existsSync(directory)) {
            fs.readdirSync(directory)
                .filter((file) => file.endsWith('.map.json'))
                .forEach((file) => {
                    const name = file.replace('.map.json', '');
                    try {
                        const raw = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
                        maps.push({
                            name: name,
                            width: raw.width,
                            height: raw.height,
                            floors: raw.floors,
                            tiles: (raw.tiles || []).length,
                            bytes: fs.statSync(path.join(directory, file)).size
                        });
                    } catch (error) {
                        maps.push({ name: name, error: 'JSON invalido' });
                    }
                });
        }

        sendJson(response, 200, { maps: maps });
        return;
    }

    // --- Leer un mapa ---
    if (pathname === '/api/map' && method === 'GET') {
        const name = safeMapName(queryOf('name'));
        if (!name) {
            sendJson(response, 400, { error: 'nombre de mapa invalido' });
            return;
        }

        const loaded = readMap(name);
        if (!loaded) {
            sendJson(response, 404, { error: 'no existe el mapa ' + name });
            return;
        }
        if (loaded.error) {
            sendJson(response, 422, loaded);
            return;
        }

        sendJson(response, 200, {
            name: name,
            raw: loaded.raw,
            stats: loaded.map.stats()
        });
        return;
    }

    // --- Guardar ediciones de un mapa ---
    if (pathname === '/api/map' && method === 'POST') {
        const body = await readBody(request);
        const name = safeMapName(body.name);
        if (!name) {
            sendJson(response, 400, { error: 'nombre de mapa invalido' });
            return;
        }

        const loaded = readMap(name);
        if (!loaded || loaded.error) {
            sendJson(response, 404, { error: 'no se pudo abrir el mapa ' + name });
            return;
        }

        const applied = applyEdits(loaded.map, body.edits || [], loaded.itemTypes);
        if (applied.problems.length > 0) {
            sendJson(response, 422, {
                error: 'algunas ediciones no se pudieron aplicar',
                problems: applied.problems
            });
            return;
        }

        const written = writeMap(name, loaded, { dryRun: body.dryRun === true });
        if (!written.ok) {
            sendJson(response, 422, {
                error: 'el mapa no se pudo guardar: no se puede volver a leer',
                problems: written.problems
            });
            return;
        }

        sendJson(response, 200, {
            ok: true,
            changed: applied.changed,
            bytes: written.bytes,
            dryRun: written.dryRun === true,
            stats: loaded.map.stats()
        });
        return;
    }

    // --- Items ---
    if (pathname === '/api/items' && method === 'GET') {
        const xml = fs.readFileSync(itemsPath(), 'utf8');
        sendJson(response, 200, {
            items: ItemsFile.readItems(xml),
            attributeKeys: ItemsFile.KNOWN_ATTRIBUTE_KEYS,
            bytes: xml.length
        });
        return;
    }

    if (pathname === '/api/items' && method === 'POST') {
        const body = await readBody(request);
        const item = body.item;

        if (!item || (item.id === undefined && item.fromid === undefined)) {
            sendJson(response, 400, { error: 'el item necesita un id o un fromid' });
            return;
        }

        const xml = fs.readFileSync(itemsPath(), 'utf8');
        const result = ItemsFile.saveItem(xml, item);

        // Se escribe en un temporal y SE ANALIZA EL TEMPORAL antes de sustituir el
        // archivo bueno. Un `items.xml` roto deja el servidor sin arrancar, y es lo
        // único que este editor puede romper de forma irreversible: los mapas se
        // pueden regenerar, el catálogo de items no.
        const temporary = itemsPath() + '.tmp';
        fs.writeFileSync(temporary, result.xml, 'utf8');

        try {
            Xml.loadItems(temporary);
        } catch (error) {
            fs.unlinkSync(temporary);
            sendJson(response, 422, {
                error: 'el items.xml resultante no se puede leer, no se ha guardado',
                problems: [error.message]
            });
            return;
        }

        fs.renameSync(temporary, itemsPath());
        sendJson(response, 200, { ok: true, action: result.action, bytes: result.xml.length });
        return;
    }

    // --- Borrar un item ---
    if (pathname === '/api/items' && method === 'DELETE') {
        const id = Number(queryOf('id'));
        if (!id) {
            sendJson(response, 400, { error: 'falta el id del item' });
            return;
        }

        /*
         * SE COMPRUEBA QUE NINGÚN MAPA USE EL ITEM, y es la razón por la que el
         * borrado vive aquí y no en el navegador: sólo el servidor conoce los mapas.
         *
         * Un item borrado que aparece en un mapa deja ese mapa inválido, y el fallo
         * salta al arrancar el MOTOR, mucho después y en otro sitio. Negarse a borrar
         * y decir en qué mapa está es infinitamente más útil que dejar romperlo.
         */
        const users = [];
        const directory = mapsDirectory();

        if (fs.existsSync(directory)) {
            fs.readdirSync(directory)
                .filter((file) => file.endsWith('.map.json'))
                .forEach((file) => {
                    try {
                        const raw = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
                        const name = file.replace('.map.json', '');

                        if (Number(raw.defaultGround && raw.defaultGround['7']) === id) {
                            users.push(name);
                            return;
                        }
                        Object.keys(raw.defaultGround || {}).forEach((z) => {
                            if (Number(raw.defaultGround[z]) === id && users.indexOf(name) === -1) {
                                users.push(name);
                            }
                        });

                        (raw.tiles || []).forEach((tile) => {
                            if (Number(tile.ground) === id && users.indexOf(name) === -1) {
                                users.push(name);
                                return;
                            }
                            (tile.items || []).forEach((item) => {
                                if (Number(item.id) === id && users.indexOf(name) === -1) {
                                    users.push(name);
                                }
                            });
                        });
                    } catch (error) {
                        // Un mapa ilegible no debe impedir borrar un item; ya tiene su
                        // propio problema y se verá al abrirlo.
                    }
                });
        }

        if (users.length > 0) {
            sendJson(response, 409, {
                error: 'no se puede borrar: el item ' + id + ' lo usa ' +
                    (users.length === 1 ? 'el mapa ' : 'los mapas ') + users.join(', '),
                problems: users.map((name) => 'usado en ' + name)
            });
            return;
        }

        const xml = fs.readFileSync(itemsPath(), 'utf8');
        const result = ItemsFile.deleteItem(xml, id);

        if (result.action === 'notFound') {
            sendJson(response, 404, { error: 'no existe el item ' + id });
            return;
        }

        const temporary = itemsPath() + '.tmp';
        fs.writeFileSync(temporary, result.xml, 'utf8');

        try {
            Xml.loadItems(temporary);
        } catch (error) {
            fs.unlinkSync(temporary);
            sendJson(response, 422, {
                error: 'el items.xml resultante no se puede leer, no se ha borrado',
                problems: [error.message]
            });
            return;
        }

        fs.renameSync(temporary, itemsPath());
        sendJson(response, 200, { ok: true, action: 'deleted' });
        return;
    }

    // --- Estado ---
    if (pathname === '/api/status' && method === 'GET') {
        const itemTypes = loadItemTypes();
        sendJson(response, 200, {
            root: ROOT,
            items: itemTypes.size,
            maps: fs.existsSync(mapsDirectory())
                ? fs.readdirSync(mapsDirectory()).filter((f) => f.endsWith('.map.json')).length
                : 0
        });
        return;
    }

    sendJson(response, 404, { error: 'no existe ' + pathname });
}

/**
 * Arranca el servidor de herramientas.
 *
 * @param {Object} options { port, host, logger }
 */
function createToolsServer(options) {
    const opts = options || {};
    const log = opts.logger || console;

    configurePaths(opts);

    const server = http.createServer((request, response) => {
        // Se usa la URL de WHATWG y no `url.parse`, que está obsoleto y emite un
        // aviso en cada petición. `URL` necesita una base porque en una petición la
        // ruta viene sin host.
        const parsed = new URL(request.url, 'http://localhost');
        const pathname = decodeURIComponent(parsed.pathname);

        if (pathname.startsWith('/api/')) {
            handleApi(request, response, pathname, parsed.searchParams).catch((error) => {
                sendJson(response, 500, { error: error.message });
            });
            return;
        }

        if (!serveStatic(request, response, pathname)) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('no encontrado: ' + pathname);
        }
    });

    /**
     * Escucha sólo en localhost por defecto.
     *
     * NO LLEVA AUTENTICACIÓN y escribe en el datapack. Escuchando en todas las
     * interfaces, cualquiera en la misma red podría reescribir los mapas del
     * servidor, y eso no es una configuración que deba salir por defecto.
     */
    const host = opts.host || '127.0.0.1';

    const ready = new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port === undefined ? 8090 : opts.port, host, () => {
            resolve(server.address().port);
        });
    });

    return {
        server: server,
        ready: ready,
        port() {
            const address = server.address();
            return address ? address.port : null;
        },
        close() {
            return new Promise((resolve) => server.close(() => resolve(true)));
        }
    };
}

module.exports = {
    createToolsServer,
    configurePaths,
    applyEdits,
    flagsFromNames,
    readMap,
    writeMap,
    loadItemTypes,
    safeMapName,
    documentationKeys,
    MOUNTS
};

if (require.main === module) {
    const args = process.argv.slice(2);
    let port = 8090;

    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--port') {
            port = Number(args[index + 1]);
        }
    }

    const tools = createToolsServer({ port: port });

    tools.ready.then((realPort) => {
        console.log('');
        console.log('  Editor de Avillatoro en http://localhost:' + realPort + '/');
        console.log('  Escribe en data/, asi que solo escucha en localhost.');
        console.log('');
    }).catch((error) => {
        console.error('no se pudo arrancar el editor: ' + error.message);
        process.exit(1);
    });
}
