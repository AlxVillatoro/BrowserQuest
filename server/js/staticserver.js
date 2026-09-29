'use strict';

/**
 * Servidor de archivos estáticos muy pequeño para el cliente.
 *
 * El despliegue original de BrowserQuest servía el cliente desde un CDN
 * aparte (browserquest.mozilla.org) y dejaba el servidor de juego escuchando
 * sólo WebSocket + /status. Para desarrollo eso obliga a levantar dos
 * procesos y a tocar `client/config/config_build.json`.
 *
 * Aquí el mismo proceso sirve el cliente y el WebSocket en el mismo puerto,
 * así que el cliente funciona en `http://localhost:8000/` sin configuración
 * adicional.
 */

const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject'
};

function contentType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resuelve una URL a una ruta de archivo dentro de `root`.
 * Devuelve null si la ruta escapa del root (path traversal).
 */
function resolveSafe(root, urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (e) {
        return null;
    }

    // Normaliza separadores y elimina cualquier intento de salir del root.
    const relative = path.normalize(decoded).replace(/^([/\\])+/, '');
    const absolute = path.resolve(root, relative);
    const rootResolved = path.resolve(root);

    if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
        return null;
    }
    return absolute;
}

/**
 * Intenta servir un archivo estático.
 * @returns {boolean} true si la petición fue atendida.
 */
function serve(req, res, root, urlPath) {
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) {
        return false;
    }

    let target = resolveSafe(root, urlPath);
    if (!target) {
        return false;
    }

    let stat = null;
    try {
        stat = fs.statSync(target);
    } catch (e) {
        return false;
    }

    if (stat.isDirectory()) {
        target = path.join(target, 'index.html');
        try {
            stat = fs.statSync(target);
        } catch (e) {
            return false;
        }
    }

    res.writeHead(200, {
        'Content-Type': contentType(target),
        'Content-Length': stat.size,
        // El cliente se cachea agresivamente por defecto; en desarrollo
        // queremos ver los cambios al recargar.
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    if (req.method === 'HEAD') {
        res.end();
        return true;
    }

    const stream = fs.createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
}

module.exports = { serve, contentType, resolveSafe, MIME_TYPES };
