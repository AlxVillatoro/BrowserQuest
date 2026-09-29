/**
 * El cliente del API del editor.
 *
 * Envuelve `fetch` para que quien llama no tenga que acordarse de comprobar el estado,
 * analizar el JSON ni mirar si la respuesta traía un error. Todas las funciones
 * devuelven un objeto y NUNCA lanzan por un error del servidor: un 422 con una lista de
 * problemas es una respuesta normal de esta herramienta, no una excepción.
 */

async function request(method, route, body) {
    let response;

    try {
        response = await fetch(route, {
            method: method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (error) {
        // El servidor de herramientas no está levantado, o se cayó. Es el caso más
        // probable con diferencia y merece un mensaje que lo diga.
        return { error: 'no se pudo hablar con el servidor: ' + error.message };
    }

    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        return { error: 'el servidor devolvio algo que no es JSON (estado ' + response.status + ')' };
    }

    if (!response.ok) {
        return {
            error: payload.error || ('el servidor respondio ' + response.status),
            problems: payload.problems || [],
            status: response.status
        };
    }

    return payload;
}

export class ApiClient {
    constructor(options) {
        const opts = options || {};
        this.base = opts.base || '';
    }

    status() {
        return request('GET', this.base + '/api/status');
    }

    listMaps() {
        return request('GET', this.base + '/api/maps');
    }

    getMap(name) {
        return request('GET', this.base + '/api/map?name=' + encodeURIComponent(name));
    }

    /**
     * Guarda las ediciones de un mapa.
     *
     * @param {string} name
     * @param {Array} edits
     * @param {boolean} [dryRun] para comprobar sin escribir
     */
    saveMap(name, edits, dryRun) {
        return request('POST', this.base + '/api/map', {
            name: name,
            edits: edits,
            dryRun: dryRun === true
        });
    }

    getItems() {
        return request('GET', this.base + '/api/items');
    }

    saveItem(item) {
        return request('POST', this.base + '/api/items', { item: item });
    }

    /**
     * Borra un objeto.
     *
     * El API no tiene borrado propio: se manda el objeto SIN contenido y el servidor
     * lo interpreta. Si se añade un `DELETE` de verdad, este es el sitio.
     */
    async deleteItem(id) {
        const current = await this.getItems();
        const item = current.items.find((entry) => entry.id === Number(id));

        if (!item) {
            return { error: 'no existe el objeto ' + id };
        }

        // El servidor sólo sabe añadir o sustituir, así que borrar es sustituir por un
        // objeto sin propiedades... que no es lo mismo. Se hace con un `DELETE` de
        // verdad, que es lo honesto.
        return request('DELETE', this.base + '/api/items?id=' + encodeURIComponent(id));
    }
}
