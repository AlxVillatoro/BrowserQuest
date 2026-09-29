'use strict';

/**
 * Auditoría de globales implícitas en `server/js`.
 *
 * El servidor de BrowserQuest se apoya en globales creadas por asignaciones sin
 * `var` (`Class`, `Types`, `Player`, `Item`, `Entity`, ...) y, por accidente, por
 * una coma faltante en `map.js` que convertía media declaración en globales
 * (`fs`, `_`, `Utils`, `Checkpoint`).
 *
 * Eso hace que el orden de `require` sea load-bearing y que un `var` de más
 * rompa el juego **en silencio**: por ejemplo, el `_` filtrado por `map.js` era
 * lo único que hacía funcionar `Types.getArmorRank` en Node, y sin él el daño y
 * los HP se volvían NaN sin ningún error visible.
 *
 * Este script marca, por archivo, qué identificadores conocidos se usan sin
 * importarlos, para poder eliminarlos uno a uno con confianza.
 *
 * Uso:  node tools/audit-globals.js
 * Salida: código 1 si encuentra dependencias implícitas.
 */

const fs = require('fs');
const path = require('path');

const SERVER_JS = path.resolve(__dirname, '..', 'server', 'js');

/**
 * Identificadores que en este código base se resuelven como globales.
 * Para cada uno se anota quién lo produce legítimamente, si alguien.
 */
const WATCHED = {
    Class: 'lib/class.js (asignación sin var, intencional)',
    Types: 'shared/js/gametypes.js (asignación sin var, intencional)',
    Player: 'server/js/player.js (module.exports = Player = ...)',
    Item: 'server/js/item.js',
    Entity: 'server/js/entity.js',
    Character: 'server/js/character.js',
    Mob: 'server/js/mob.js',
    Chest: 'server/js/chest.js',
    Npc: 'server/js/npc.js',
    _: 'require("underscore") — NO hay productor legítimo',
    Utils: 'require("./utils")',
    fs: 'require("fs")',
    path: 'require("path")',
    Checkpoint: 'require("./checkpoint")',
    Messages: 'require("./message")',
    Properties: 'require("./properties")',
    Formulas: 'require("./formulas")',
    Map: 'require("./map")',
    Log: 'require("log") — eliminado',
    Bison: 'require("bison") — eliminado',
    FormatChecker: 'server/js/format.js (asignación sin var, intencional)'
};

function listFiles(dir) {
    return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.join(dir, name));
}

/**
 * Elimina comentarios antes de analizar. Sin esto, cualquier comentario que
 * mencione un identificador (por ejemplo explicar que se evita `_.size`) se
 * cuenta como uso y la herramienta acaba dando falsos positivos, que es la
 * forma más rápida de que nadie la use.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        // El guardia [^:] evita destrozar las URL (http://, ws://).
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Nombres importados vía require en este archivo. */
function importedNames(source) {
    const names = new Set();
    // var X = require(...) | X = require(...) | const X = require(...)
    const re = /(?:var|let|const)?\s*([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/g;
    let match;
    while ((match = re.exec(source)) !== null) {
        names.add(match[1]);
    }
    // require("...") sin asignación (efecto lateral) no aporta nombres.
    return names;
}

/**
 * Nombres declarados con var/let/const.
 *
 * Se captura la lista completa hasta el `;` (admitiendo saltos de línea) y se
 * parte por comas, porque en este código base las declaraciones son multilínea:
 * `var cls = require(...),\n    Entity = require(...),\n    ...;`
 * Un patrón que se detuviese en el primer `=` sólo vería `cls`.
 */
function declaredNames(source) {
    const names = new Set();
    const re = /\b(?:var|let|const)\s+([^;]*);/g;
    let match;

    while ((match = re.exec(source)) !== null) {
        match[1].split(',').forEach((piece) => {
            const beforeEquals = piece.replace(/=[\s\S]*$/, '');
            const identifier = beforeEquals.replace(/[[\]{}()]/g, ' ')
                .trim()
                .split(/\s+/)
                .pop();
            if (identifier && /^[A-Za-z_$][\w$]*$/.test(identifier)) {
                names.add(identifier);
            }
        });
    }
    return names;
}

function usesIdentifier(source, name) {
    const escaped = name.replace(/\$/g, '\\$');
    // Uso como Namespace.algo, Name( o Name[
    return new RegExp('(^|[^\\w.$])' + escaped + '\\s*[.(\\[]').test(source);
}

function main() {
    const files = listFiles(SERVER_JS);
    let problems = 0;

    console.log('Auditoría de globales implícitas en server/js\n');
    console.log('Archivos analizados: ' + files.length + '\n');

    files.forEach((file) => {
        const raw = fs.readFileSync(file, 'utf8');
        const source = stripComments(raw);
        const imported = importedNames(source);
        const declared = declaredNames(source);
        const offenders = [];

        Object.keys(WATCHED).forEach((name) => {
            if (imported.has(name) || declared.has(name)) {
                return;
            }
            if (usesIdentifier(source, name)) {
                offenders.push(name);
            }
        });

        if (offenders.length > 0) {
            problems += offenders.length;
            console.log('\u001b[33m' + path.basename(file) + '\u001b[0m');
            offenders.forEach((name) => {
                console.log('    usa "' + name + '" sin importarlo   \u001b[90m(' + WATCHED[name] + ')\u001b[0m');
            });
        }
    });

    console.log('');
    if (problems === 0) {
        console.log('\u001b[32mSin dependencias implícitas.\u001b[0m');
        process.exit(0);
    }

    console.log('\u001b[31m' + problems + ' dependencia(s) implícita(s) encontradas.\u001b[0m');
    console.log('Cada una es un fallo latente: si cambia el orden de require, deja de resolverse.');
    process.exit(1);
}

main();
