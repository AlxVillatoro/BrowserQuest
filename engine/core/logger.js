'use strict';

/**
 * Logger del motor.
 *
 * A diferencia del servidor heredado, aquí NO se instala nada en `globalThis`:
 * el logger se pasa explícitamente a quien lo necesite. La global `log` del
 * servidor viejo obligaba a que el orden de `require` fuese el correcto, y eso
 * ya provocó un fallo real (ver tools/audit-globals.js).
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

function createLogger(levelName) {
    const minLevel = LEVELS[levelName] !== undefined ? LEVELS[levelName] : LEVELS.info;
    const logger = { level: levelName };

    Object.keys(LEVELS).forEach((level) => {
        logger[level] = (...args) => {
            if (LEVELS[level] < minLevel) {
                return;
            }
            const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const line = COLORS[level] + stamp + ' [' + level.toUpperCase() + ']' + RESET +
                ' ' + args.map(stringify).join(' ');
            if (level === 'error') {
                console.error(line);
            } else {
                console.log(line);
            }
        };
    });

    return logger;
}

module.exports = { createLogger, LEVELS };
