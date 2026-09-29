'use strict';

/**
 * Reemplazo mínimo del paquete `log` (abandonado desde 2013).
 *
 * El servidor original de BrowserQuest creaba `log` como **variable global
 * implícita** desde main.js (línea 30: `log = new Log(Log.ERROR)` sin `var`),
 * y 31 puntos de llamada en 10 módulos lo usan directamente sin importarlo.
 *
 * En vez de reescribir todos esos puntos de llamada, este módulo instala el
 * objeto en `globalThis` de forma deliberada y documentada. Es una decisión
 * consciente: mantiene el diff pequeño mientras se moderniza el resto.
 *
 * API conservada: log.debug / log.info / log.warning / log.error
 * (los cuatro aceptan cualquier número de argumentos, igual que el original).
 */

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };

const COLORS = {
    debug: '\u001b[90m',
    info: '\u001b[36m',
    warning: '\u001b[33m',
    error: '\u001b[31m'
};
const RESET = '\u001b[0m';

function stringify(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Error) {
        return value.stack || value.message;
    }
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

function timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * @param {string} minLevelName 'debug' | 'info' | 'warning' | 'error'
 */
function createLogger(minLevelName) {
    const minLevel = LEVELS[minLevelName] !== undefined ? LEVELS[minLevelName] : LEVELS.info;
    const logger = { level: minLevelName };

    for (const level of Object.keys(LEVELS)) {
        logger[level] = (...args) => {
            if (LEVELS[level] < minLevel) {
                return;
            }
            const line = `${COLORS[level]}${timestamp()} [${level.toUpperCase()}]${RESET} ` +
                args.map(stringify).join(' ');
            if (level === 'error') {
                console.error(line);
            } else {
                console.log(line);
            }
        };
    }

    return logger;
}

/** Instala el logger como global `log` y lo devuelve. */
function install(levelName) {
    globalThis.log = createLogger(levelName);
    return globalThis.log;
}

module.exports = { install, createLogger, LEVELS };
