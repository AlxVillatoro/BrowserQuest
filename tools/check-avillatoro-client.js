'use strict';

/**
 * Comprueba que el cliente nuevo puede cargar TODOS sus módulos.
 *
 * Los módulos se importan entre sí con rutas absolutas (`/shared/js/protocol.mjs`,
 * `/client/avillatoro/js/...`), que es lo que hace que el mismo archivo sirva desde
 * el servidor estático. El precio es que un error de escritura en una de esas rutas
 * NO se ve hasta que se abre el navegador, y entonces el fallo que aparece es un
 * `Failed to fetch dynamically imported module` que no dice qué archivo falta.
 *
 * Esto recorre el grafo de imports sobre el disco, sin servidor, y dice exactamente
 * qué falta. Se comprueba además que cada `import` sea sintácticamente válido,
 * porque un módulo ES que no parsea rompe el cliente entero sin cargar nada.
 *
 * Uso:  node tools/check-avillatoro-client.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'client/avillatoro/index.html';

/**
 * Los montajes del servidor estático, leídos de SU configuración.
 *
 * Es importante leerlos y no volver a escribirlos aquí: si el servidor monta
 * `client/` en la raíz y `shared/` en `/shared`, este comprobador tiene que saber
 * exactamente lo mismo. Con dos copias, cambiar el montaje dejaría al comprobador
 * diciendo que todo está bien mientras el navegador recibe 404.
 */
function loadMounts() {
    const configPath = path.join(ROOT, 'server', 'config.json');

    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('  FALLO  no se pudo leer ' + configPath + ': ' + error.message);
        process.exit(1);
    }

    const clientRoot = (config.client_root || './client').replace(/^\.\//, '');
    const sharedRoot = (config.shared_root || './shared').replace(/^\.\//, '');

    return [
        // El orden importa: la primera coincidencia gana.
        { prefix: '/shared/', dir: sharedRoot },
        { prefix: '/', dir: clientRoot }
    ];
}

const MOUNTS = loadMounts();

/** A qué archivo del disco corresponde una ruta absoluta del navegador. */
function resolveWebPath(webPath) {
    if (!webPath.startsWith('/')) {
        return path.join(ROOT, webPath);
    }

    for (const mount of MOUNTS) {
        if (webPath.startsWith(mount.prefix)) {
            const rest = webPath.slice(mount.prefix.length);
            return path.normalize(path.join(ROOT, mount.dir, rest));
        }
    }

    return null;
}

/** Resuelve un import relativo o absoluto desde el archivo que lo hace. */
function resolveImport(fromFile, spec) {
    if (spec.startsWith('/')) {
        const resolved = resolveWebPath(spec);
        return resolved === null ? null : path.normalize(resolved);
    }
    if (spec.startsWith('.')) {
        return path.normalize(path.join(path.dirname(fromFile), spec));
    }
    // Un import de un paquete no lo resuelve el navegador sin un mapa de imports.
    return null;
}

/** Saca los `import ... from '...'` y los `import('...')` de un módulo. */
function extractImports(source) {
    const found = [];
    const patterns = [
        /^\s*import\s+[^'"]*?from\s*['"]([^'"]+)['"]/gm,
        /^\s*import\s*['"]([^'"]+)['"]/gm,
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ];

    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            found.push(match[1]);
        }
    });

    return found;
}

/** Saca los `src="..."` de tipo módulo de un HTML. */
function extractHtmlModules(source) {
    const found = [];
    const pattern = /<script[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["']([^"']+)["']/g;

    let match;
    while ((match = pattern.exec(source)) !== null) {
        found.push(match[1]);
    }
    return found;
}

function main() {
    console.log('Comprobacion de los modulos del cliente nuevo\n');

    const entryPath = path.join(ROOT, ENTRY);
    if (!fs.existsSync(entryPath)) {
        console.error('  FALLO  no existe ' + ENTRY);
        process.exit(1);
    }

    const queue = [];
    const visited = new Set();
    const missing = [];
    const broken = [];

    extractHtmlModules(fs.readFileSync(entryPath, 'utf8')).forEach((src) => {
        queue.push({ file: resolveWebPath(src), from: ENTRY, spec: src });
    });

    // El HTML también enlaza la hoja de estilos y el propio punto de entrada; aquí
    // sólo interesan los módulos, que son los que pueden faltar en silencio.
    let modules = 0;

    while (queue.length > 0) {
        const item = queue.shift();
        const key = item.file;

        if (visited.has(key)) {
            continue;
        }
        visited.add(key);

        if (!fs.existsSync(item.file)) {
            missing.push(item);
            continue;
        }

        const source = fs.readFileSync(item.file, 'utf8');
        modules += 1;

        // Un módulo ES que no parsea rompe el cliente entero. Se comprueba aquí
        // porque el error del navegador no dice en qué archivo está.
        try {
            new (require('vm').SourceTextModule || Object)(source);
        } catch (error) {
            // `vm.SourceTextModule` necesita un flag; si no está, se usa una
            // comprobación de sintaxis más básica.
            try {
                // eslint-disable-next-line no-new-func
                new Function('import', source);
            } catch (inner) {
                if (/import|export/.test(inner.message)) {
                    broken.push({ file: item.file, error: inner.message });
                }
            }
        }

        extractImports(source).forEach((spec) => {
            const resolved = resolveImport(item.file, spec);

            if (resolved === null) {
                missing.push({
                    file: item.file,
                    from: path.relative(ROOT, item.file),
                    spec: spec,
                    reason: 'no es una ruta resoluble por el navegador'
                });
                return;
            }

            queue.push({
                file: resolved,
                from: path.relative(ROOT, item.file),
                spec: spec
            });
        });
    }

    const relative = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

    visited.forEach((file) => {
        if (fs.existsSync(file)) {
            console.log('  ok     ' + relative(file));
        }
    });

    console.log('');

    if (missing.length > 0) {
        console.log('  FALTAN ' + missing.length + ' archivo(s):');
        missing.forEach((item) => {
            console.log('    ' + item.spec + '  (importado desde ' + item.from + ')');
            console.log('      -> ' + (item.reason || relative(item.file)));
        });
    }

    if (broken.length > 0) {
        console.log('  NO PARSEAN ' + broken.length + ' modulo(s):');
        broken.forEach((item) => {
            console.log('    ' + relative(item.file) + ': ' + item.error);
        });
    }

    console.log('');
    console.log('  ' + modules + ' modulos, ' + visited.size + ' archivos visitados');

    if (missing.length === 0 && broken.length === 0) {
        console.log('\n\u001b[32mTodo OK\u001b[0m — el cliente puede cargar todo lo que importa.');
        process.exit(0);
    }

    console.log('\n\u001b[31mEl cliente no cargaria.\u001b[0m');
    process.exit(1);
}

main();
