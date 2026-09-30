'use strict';

/**
 * Comprueba que los identificadores que el JavaScript busca EXISTEN en su HTML.
 *
 * POR QUE EXISTE ESTE ARCHIVO. El cliente del navegador no arrancaba y no lo vio nadie:
 *
 *     const chatForm = document.getElementById('chat-form');   // null
 *     chatForm.addEventListener('submit', ...);                // revienta aqui
 *
 * El HTML definia `chat-bar` y el JavaScript buscaba `chat-form`. Como `boot()` lanzaba en
 * esa linea, TODO lo que venia detras no se ejecutaba: ni el teclado, ni el clic en el mapa,
 * ni el clic derecho para recoger. El cliente estaba muerto y el sintoma era un error en la
 * consola del navegador que nadie mira hasta que alguien juega.
 *
 * Y ninguna de las comprobaciones que ya habia podia verlo:
 *
 *   - `check-avillatoro-client.js` verifica que los modulos EXISTEN y se importan. Un
 *     identificador que no esta en el HTML no rompe ninguna importacion.
 *   - Las pruebas de protocolo y de mundo corren en Node, donde no hay DOM.
 *   - Las pruebas de extremo a extremo hablan por el socket, no arrancan el navegador.
 *
 * Es el hueco clasico: se comprueba todo menos lo que el usuario ejecuta. Esta comprobacion
 * es de texto y no necesita navegador, que es justo lo que la hace util.
 *
 * Uso:  node tools/check-client-dom.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Las aplicaciones de navegador: su HTML y su carpeta de JavaScript. */
const APPS = [
    { name: 'cliente', html: 'client/avillatoro/index.html', js: 'client/avillatoro/js' },
    { name: 'editor', html: 'editor/index.html', js: 'editor/js' }
];

let failures = 0;

function check(label, condition, detail) {
    if (condition) {
        console.log('  \u001b[32mPASS\u001b[0m  ' + label +
            (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
    } else {
        failures += 1;
        console.log('  \u001b[31mFAIL\u001b[0m  ' + label + (detail ? '  ' + detail : ''));
    }
}

/** Todos los ficheros `.js` de una carpeta, recursivamente. */
function jsFiles(dir) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) {
        return [];
    }

    const found = [];
    fs.readdirSync(full, { withFileTypes: true }).forEach((entry) => {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...jsFiles(relative));
        } else if (entry.name.endsWith('.js')) {
            found.push(relative);
        }
    });

    return found;
}

function main() {
    console.log('Identificadores del HTML que el JavaScript busca (' + ROOT + ')');

    APPS.forEach((app) => {
        const htmlPath = path.join(ROOT, app.html);

        if (!fs.existsSync(htmlPath)) {
            console.log('\n' + app.name + ': no hay ' + app.html + ', se salta');
            return;
        }

        console.log('\n' + app.name + ' (' + app.html + ')');

        /** El texto de cada fichero, leido una vez: se usa para los ids y para buscarlos. */
        const sourceCache = new Map();

        const html = fs.readFileSync(htmlPath, 'utf8');
        const defined = new Set(
            [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

        /*
         * Y TAMBIEN CUENTAN LOS QUE CREA EL PROPIO JAVASCRIPT.
         *
         * El editor construye los botones de su formulario con `innerHTML` y despues los
         * busca por identificador:
         *
         *     actions.innerHTML = '<button id="f-save">...' ;
         *     form.appendChild(actions);
         *     document.getElementById('f-save').addEventListener(...);
         *
         * Eso esta bien y la primera version de esta comprobacion lo daba por fallo. Es un
         * falso positivo, y los falsos positivos son peores de lo que parecen: una
         * comprobacion que avisa de cosas correctas deja de mirarse, y entonces el dia que
         * avisa de una de verdad nadie la lee.
         *
         * Va DESPUES del bucle de abajo, que es el que llena el cache: hacerlo antes fue el
         * primer intento y el falso positivo seguia ahi, porque se estaba leyendo un mapa
         * todavia vacio.
         */

        // Los identificadores que se buscan, con el fichero y la linea donde se buscan, para
        // que el aviso diga DONDE arreglarlo y no solo que falta.
        const wanted = new Map();

        jsFiles(app.js).forEach((file) => {
            const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
            sourceCache.set(file, source);

            [...source.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)]
                .forEach((match) => {
                    if (!wanted.has(match[1])) {
                        wanted.set(match[1], file);
                    }
                });
        });

        // Ya estan leidos todos los ficheros, asi que ahora si se pueden contar los que crea
        // el propio JavaScript. Ver la explicacion de arriba.
        sourceCache.forEach((text) => {
            [...text.matchAll(/id="([^"]+)"/g)].forEach((match) => defined.add(match[1]));
        });

        const missing = [...wanted.keys()].filter((id) => !defined.has(id));

        check('todos los identificadores que se buscan existen',
            missing.length === 0,
            missing.length === 0
                ? wanted.size + ' identificadores buscados, todos definidos'
                : missing.map((id) => '"' + id + '" (en ' + wanted.get(id) + ')').join(', '));

        /*
         * Y AL REVES NO SE COMPRUEBA, a proposito.
         *
         * Un identificador definido en el HTML que nadie busca NO es un fallo: puede ser un
         * ancla de CSS, un contenedor que se rellena por otra via, o algo que se usa desde un
         * atributo `for`. Avisar de eso llenaria la salida de ruido, y una comprobacion que
         * avisa de cosas que estan bien deja de mirarse. La direccion que importa es esta: si
         * el JavaScript lo busca y no esta, revienta.
         */
    });

    console.log('');

    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — el JavaScript no busca identificadores que no existan.');
        process.exit(0);
    }

    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main();
