'use strict';

/**
 * Comprueba que TODO lo que el cliente carga por HTTP existe de verdad.
 *
 * Nace de un fallo real: el cliente pide el módulo compartido con una ruta
 * relativa que sale de su propio árbol (`'../../shared/js/gametypes'` en
 * client/js/game.js), el navegador la resuelve como /shared/js/gametypes.js, y el
 * servidor sólo servía `client/`. Resultado: 404 y el cliente muerto con
 * "Types is not defined". Las pruebas de servidor no lo veían, porque el archivo
 * sí existe en disco: el problema era que no se servía.
 *
 * Por eso esta comprobación va **por HTTP**, no por el sistema de archivos.
 *
 * Hace tres cosas:
 *   1. Recorre las dependencias de `define([...])`, `require([...])` e
 *      `importScripts(...)` de todo client/js y pide cada destino.
 *   2. Verifica que cada sprite declarado en client/sprites/*.json tiene su PNG
 *      en las tres escalas (img/1, img/2, img/3). Esta parte sí es de disco.
 *   3. Falla si algo devuelve 404, salvo los archivos opcionales por diseño.
 *
 * Uso:  node tools/check-client.js [host] [puerto]
 * Requiere el servidor levantado.
 */

const fs = require('fs');
const path = require('path');
const posix = path.posix;

const HOST = process.argv[2] || 'localhost';
const PORT = process.argv[3] || '8000';
const ORIGIN = 'http://' + HOST + ':' + PORT;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(PROJECT_ROOT, 'client');
const CLIENT_JS = path.join(CLIENT_DIR, 'js');
const SPRITES_DIR = path.join(CLIENT_DIR, 'sprites');

/**
 * Rutas que pueden devolver 404 sin que sea un fallo: son overrides opcionales
 * que el cliente intenta cargar y cuya ausencia tolera a propósito.
 */
const OPTIONAL = new Set([
    '/config/config_local.json',
    '/config/config_build.json'
]);

/** Ficheros JSON de sprites sin PNG asociado, por diseño (código muerto). */
const SPRITES_SIN_PNG = new Set(['arrow', 'impact']);

let problems = 0;

function ok(label, detail) {
    console.log('  \u001b[32mOK  \u001b[0m  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
}

function bad(label, detail) {
    problems += 1;
    console.log('  \u001b[31mFALLO\u001b[0m  ' + label + (detail ? '  ' + detail : ''));
}

function warn(label, detail) {
    console.log('  \u001b[33mAVISO\u001b[0m  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
}

/** Lista recursiva de ficheros .js bajo un directorio. */
function listJs(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listJs(full));
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

/** Extrae los literales de un array de dependencias. */
function extractArrayLiterals(source, callName) {
    const deps = [];
    const re = new RegExp('\\b' + callName + '\\s*\\(\\s*\\[([\\s\\S]*?)\\]', 'g');
    let match;
    while ((match = re.exec(source)) !== null) {
        const inner = match[1].match(/['"]([^'"]+)['"]/g) || [];
        inner.forEach((quoted) => deps.push(quoted.slice(1, -1)));
    }
    return deps;
}

/** Extrae los argumentos de importScripts('a', 'b'). */
function extractImportScripts(source) {
    const deps = [];
    const re = /importScripts\s*\(([^)]*)\)/g;
    let match;
    while ((match = re.exec(source)) !== null) {
        const inner = match[1].match(/['"]([^'"]+)['"]/g) || [];
        inner.forEach((quoted) => deps.push(quoted.slice(1, -1)));
    }
    return deps;
}

/** Ids de módulo declarados con nombre propio, que no tienen archivo suelto. */
function namedModules(files) {
    const ids = new Set();
    files.forEach((file) => {
        const source = fs.readFileSync(file, 'utf8');
        const re = /define\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = re.exec(source)) !== null) {
            ids.add(match[1]);
        }
    });
    return ids;
}

/**
 * Traduce una dependencia a la URL que pedirá el navegador.
 *
 * Hay tres formas y NO se resuelven igual, que es justo lo que hace fácil
 * equivocarse al escribir esta comprobación:
 *   - `define`/`require` con id de módulo: se le añade `.js` si no lo trae ya.
 *   - `text!<ruta>`: es una ruta a un recurso; nunca se le añade extensión.
 *   - `importScripts(...)`: son rutas literales resueltas contra el propio
 *     worker, sin añadir nada.
 *
 * @param {string} dirUrl directorio del módulo que declara la dependencia
 * @param {string} dep
 * @param {string} kind 'module' | 'importScripts'
 * @returns {string} ruta de URL
 */
function resolveDep(dirUrl, dep, kind) {
    if (kind === 'importScripts') {
        return posix.normalize(posix.join(dirUrl, dep));
    }

    const isText = dep.startsWith('text!');
    const target = isText ? dep.slice('text!'.length) : dep;
    const base = (target.startsWith('./') || target.startsWith('../')) ? dirUrl : '/js';
    let urlPath = posix.normalize(posix.join(base, target));

    // Ojo: no vale con mirar si tiene "extensión", porque ids como
    // 'lib/underscore.min' acabarían sin su '.js'.
    if (!isText && !urlPath.endsWith('.js')) {
        urlPath += '.js';
    }
    return urlPath;
}

async function head(url) {
    try {
        const response = await fetch(url, { method: 'GET' });
        return response.status;
    } catch (error) {
        return 'ERROR: ' + error.message;
    }
}

async function checkModuleGraph() {
    console.log('1. Grafo de módulos del cliente (por HTTP)\n');

    const files = listJs(CLIENT_JS).concat(listJs(path.join(CLIENT_DIR, 'maps')));
    const named = namedModules(files);

    // dep -> conjunto de ficheros que la declaran (para poder señalar al culpable)
    const wanted = new Map();

    files.forEach((file) => {
        const source = fs.readFileSync(file, 'utf8');
        const relative = '/' + path.relative(CLIENT_DIR, file).split(path.sep).join('/');
        const dirUrl = posix.dirname(relative);

        const deps = extractArrayLiterals(source, 'define')
            .map((dep) => ({ dep: dep, kind: 'module' }))
            .concat(extractArrayLiterals(source, 'require')
                .map((dep) => ({ dep: dep, kind: 'module' })))
            .concat(extractImportScripts(source)
                .map((dep) => ({ dep: dep, kind: 'importScripts' })));

        deps.forEach((item) => {
            if (named.has(item.dep)) {
                return; // definido dentro de otro archivo (p. ej. jquery)
            }
            const urlPath = resolveDep(dirUrl, item.dep, item.kind);
            if (!wanted.has(urlPath)) {
                wanted.set(urlPath, []);
            }
            wanted.get(urlPath).push(relative);
        });
    });

    console.log('   ' + files.length + ' archivos analizados, ' +
        wanted.size + ' recursos distintos referenciados\n');

    const missing = [];
    const optionalMissing = [];

    for (const urlPath of Array.from(wanted.keys()).sort()) {
        const status = await head(ORIGIN + urlPath);
        if (status === 200) {
            continue;
        }
        if (OPTIONAL.has(urlPath)) {
            optionalMissing.push(urlPath);
        } else {
            missing.push({ urlPath: urlPath, status: status, from: wanted.get(urlPath) });
        }
    }

    if (missing.length === 0) {
        ok('todos los recursos referenciados se sirven');
    } else {
        missing.forEach((item) => {
            bad(item.urlPath + '  [' + item.status + ']',
                'referenciado desde ' + Array.from(new Set(item.from)).join(', '));
        });
    }

    if (optionalMissing.length > 0) {
        console.log('  \u001b[90m(opcionales ausentes, correcto: ' +
            optionalMissing.join(', ') + ')\u001b[0m');
    }

    return missing.length === 0;
}

async function checkIndexAndSprites() {
    console.log('\n2. Página y sprites\n');

    const indexStatus = await head(ORIGIN + '/');
    if (indexStatus === 200) {
        ok('/ (index.html)');
    } else {
        bad('/ (index.html)', String(indexStatus));
    }

    // Cada sprite declarado debe tener su PNG en las tres escalas. La convención
    // (sprite.js) es img/<escala>/<id>.png, con escala en {1,2,3}.
    const spriteFiles = fs.readdirSync(SPRITES_DIR).filter((n) => n.endsWith('.json'));
    const missingPngs = [];
    const orphan = [];

    spriteFiles.forEach((name) => {
        const id = name.replace(/\.json$/, '');
        const found = [1, 2, 3].filter((scale) =>
            fs.existsSync(path.join(CLIENT_DIR, 'img', String(scale), id + '.png')));

        if (found.length === 0) {
            if (SPRITES_SIN_PNG.has(id)) {
                orphan.push(id);
            } else {
                missingPngs.push(id);
            }
        } else if (found.length < 3) {
            missingPngs.push(id + ' (sólo escalas ' + found.join(',') + ')');
        }
    });

    if (missingPngs.length === 0) {
        ok(spriteFiles.length + ' sprites, todos con PNG en img/1, img/2 e img/3');
    } else {
        bad('sprites sin PNG completo', missingPngs.join(', '));
    }

    if (orphan.length > 0) {
        warn('JSON de sprite sin PNG (código muerto conocido)', orphan.join(', '));
    }
}

async function main() {
    console.log('Comprobación del cliente contra ' + ORIGIN + '\n');

    const graphOk = await checkModuleGraph();
    await checkIndexAndSprites();

    console.log('');
    if (problems === 0 && graphOk) {
        console.log('\u001b[32mTodo OK\u001b[0m — el cliente puede cargar todos sus recursos.');
        process.exit(0);
    }
    console.log('\u001b[31m' + (problems || 1) + ' problema(s) encontrados.\u001b[0m');
    process.exit(1);
}

main();
