
/**
 * Configuración de conexión del cliente.
 *
 * El original cargaba el host y el puerto de `config/config_build.json` con el
 * plugin `text!`, un archivo que NO está en el repo (lo genera el paso de build
 * con r.js) y que además está en .gitignore. Consecuencia: en un clon limpio el
 * `define` fallaba y el cliente no arrancaba hasta ejecutar el build.
 *
 * Aquí el destino se deduce del propio origen: el servidor de desarrollo sirve
 * el cliente y el WebSocket en el mismo puerto (server/js/staticserver.js), así
 * que basta con leer `window.location`. El cliente funciona al abrir
 * http://localhost:8000/ sin ningún paso previo.
 *
 * `config/config_local.json` sigue siendo un override opcional: si existe, se
 * carga por encima. Se conserva la tolerancia del original a que no exista.
 */
define(function() {

    function fromLocation() {
        return {
            host: window.location.hostname || 'localhost',
            port: parseInt(window.location.port, 10) || 8000,
            dispatcher: false
        };
    }

    var endpoint = fromLocation();

    var config = {
        dev: endpoint,
        build: endpoint
    };

    //>>excludeStart("prodHost", pragmas.prodHost);
    require(['text!../config/config_local.json'], function(local) {
        try {
            config.local = JSON.parse(local);
        } catch(e) {
            // config_local.json no existe o no es JSON válido: se usa el origen.
        }
    });
    //>>excludeEnd("prodHost");

    return config;
});
