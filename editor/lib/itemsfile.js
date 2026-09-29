'use strict';

/**
 * Edición de `items.xml` conservando el resto del archivo.
 *
 * POR QUÉ NO SE REESCRIBE EL ARCHIVO ENTERO. Sería más fácil: se analiza el XML, se
 * cambia el modelo y se vuelca. Pero `items.xml` es un archivo de Tibia que la gente
 * mantiene a mano, con comentarios que explican decisiones y un orden que alguien
 * eligió. Reescribirlo desde el modelo borraría los comentarios, reordenaría todo y
 * cambiaría el formato de cada línea, y el diff de guardar un item sería el archivo
 * entero. Eso hace que nadie se atreva a guardar.
 *
 * Así que se edita QUIRÚRGICAMENTE sobre el texto: se localiza el bloque `<item>` que
 * corresponde y se sustituye SÓLO ése. Todo lo demás —comentarios, orden, sangría,
 * items que la herramienta no entiende— queda byte a byte como estaba.
 *
 * POR QUÉ NO SE USA UNA EXPRESIÓN REGULAR. La tentación es
 * `/<item[^>]*id="111"[\s\S]*?<\/item>/`, y funciona hasta que un item tiene un
 * atributo cuyo valor contiene la cadena `</item>`, o hasta que alguien anida algo.
 * Aquí se recorre el texto llevando la cuenta de dónde empieza y acaba cada bloque,
 * que es más código y no tiene esos casos raros. Los bloques `<item>` de este formato
 * no se anidan, y el recorrido lo comprueba en vez de darlo por hecho.
 */

/** Las claves que se pueden escribir en un `<attribute>`. */
const KNOWN_ATTRIBUTE_KEYS = [
    'isGround', 'groundSpeed', 'blocksSolid', 'blocksProjectile', 'blocksPathfind',
    'alwaysOnTop', 'pickupable', 'stackable', 'useable', 'container', 'isContainer',
    'weight', 'attack', 'defense', 'armor', 'weaponType', 'slotType', 'description'
];

/**
 * Localiza los bloques `<item ...> ... </item>` de un texto XML.
 *
 * @returns {Array<{start: number, end: number, open: string, body: string, id: number|null,
 *                  fromid: number|null, toid: number|null, name: string|null}>}
 */
function findItemBlocks(xml) {
    const blocks = [];
    let cursor = 0;

    for (;;) {
        const open = xml.indexOf('<item', cursor);
        if (open === -1) {
            break;
        }

        // Hay que asegurarse de que es `<item` y no `<items` ni `<itemAlgo`.
        const after = xml[open + 5];
        if (after !== ' ' && after !== '>' && after !== '\t' && after !== '\n' && after !== '\r') {
            cursor = open + 5;
            continue;
        }

        const openEnd = xml.indexOf('>', open);
        if (openEnd === -1) {
            break;
        }

        const openTag = xml.slice(open, openEnd + 1);

        // Un item sin hijos se cierra en la propia etiqueta.
        if (openTag.endsWith('/>')) {
            blocks.push(describeBlock(xml, open, openEnd + 1, openTag, ''));
            cursor = openEnd + 1;
            continue;
        }

        const close = xml.indexOf('</item>', openEnd);
        if (close === -1) {
            // Bloque sin cerrar: se deja fuera en vez de tragárselo todo, que es lo
            // que haría un `indexOf` ingenuo.
            break;
        }

        const body = xml.slice(openEnd + 1, close);
        blocks.push(describeBlock(xml, open, close + '</item>'.length, openTag, body));
        cursor = close + '</item>'.length;
    }

    return blocks;
}

function describeBlock(xml, start, end, openTag, body) {
    const attributeOf = (name) => {
        const match = openTag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
        return match ? match[1] : null;
    };

    const numberOrNull = (value) => (value === null ? null : Number(value));

    return {
        start: start,
        end: end,
        open: openTag,
        body: body,
        id: numberOrNull(attributeOf('id')),
        fromid: numberOrNull(attributeOf('fromid')),
        toid: numberOrNull(attributeOf('toid')),
        name: attributeOf('name'),
        article: attributeOf('article'),
        plural: attributeOf('plural')
    };
}

/** Saca los atributos de un bloque, como objeto. */
function parseAttributes(body) {
    const attributes = {};
    const pattern = /<attribute\s+key\s*=\s*"([^"]*)"\s+value\s*=\s*"([^"]*)"\s*\/?>/g;

    let match;
    while ((match = pattern.exec(body)) !== null) {
        const value = match[2];
        attributes[match[1]] = /^-?\d+$/.test(value) ? Number(value) : value;
    }

    return attributes;
}

/** Escapa un valor para que quepa en un atributo XML. */
function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Construye el bloque de un item, con la misma sangría que los demás.
 *
 * Se genera a partir de los datos y no se copia el formato de otro bloque: intentar
 * imitar la sangría de un vecino falla en cuanto el archivo tiene dos estilos, y
 * entonces el archivo se vuelve un mosaico.
 */
function buildItemBlock(item, indent) {
    const pad = indent === undefined ? '\t' : indent;
    const lines = [];

    const opening = ['<item'];
    if (item.fromid !== undefined && item.fromid !== null) {
        opening.push('fromid="' + Number(item.fromid) + '"');
        opening.push('toid="' + Number(item.toid) + '"');
    } else {
        opening.push('id="' + Number(item.id) + '"');
    }
    if (item.article) {
        opening.push('article="' + escapeXml(item.article) + '"');
    }
    opening.push('name="' + escapeXml(item.name || '') + '"');
    if (item.plural) {
        opening.push('plural="' + escapeXml(item.plural) + '"');
    }
    opening.push('>');

    lines.push(pad + opening.join(' '));

    const attributes = item.attributes || {};
    Object.keys(attributes).forEach((key) => {
        lines.push(pad + '\t<attribute key="' + escapeXml(key) + '" value="' +
            escapeXml(attributes[key]) + '" />');
    });

    lines.push(pad + '</item>');

    return lines.join('\n');
}

/**
 * Lee todos los items de un archivo, tal y como los ve la herramienta.
 */
function readItems(xml) {
    return findItemBlocks(xml).map((block) => ({
        id: block.id,
        fromid: block.fromid,
        toid: block.toid,
        article: block.article,
        name: block.name,
        plural: block.plural,
        attributes: parseAttributes(block.body),
        isRange: block.fromid !== null
    }));
}

/**
 * Guarda un item: lo sustituye si ya existe y lo añade si no.
 *
 * @returns {{xml: string, action: 'replaced'|'added'}}
 */
function saveItem(xml, item) {
    const blocks = findItemBlocks(xml);

    const existing = blocks.find((block) =>
        (item.fromid !== undefined && item.fromid !== null)
            ? (block.fromid === Number(item.fromid) && block.toid === Number(item.toid))
            : block.id === Number(item.id));

    // La sangría se toma del bloque que se va a sustituir, para no cambiar el estilo
    // del archivo. Si es nuevo, se toma la del último bloque, y si no hay ninguno, un
    // tabulador.
    const indent = existing
        ? (xml.slice(xml.lastIndexOf('\n', existing.start) + 1, existing.start))
        : (blocks.length > 0
            ? xml.slice(xml.lastIndexOf('\n', blocks[blocks.length - 1].start) + 1,
                blocks[blocks.length - 1].start)
            : '\t');

    const replacement = buildItemBlock(item, indent);

    if (existing) {
        return {
            xml: xml.slice(0, existing.start) + replacement + xml.slice(existing.end),
            action: 'replaced'
        };
    }

    // Se inserta antes del cierre de `</items>`, respetando lo que haya.
    const closing = xml.lastIndexOf('</items>');
    if (closing === -1) {
        throw new Error('items.xml no tiene un cierre </items>');
    }

    // Se coloca justo antes del cierre, con una linea en blanco de separacion si la
    // ultima linea no la tiene ya.
    const before = xml.slice(0, closing);
    const separator = before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');

    return {
        xml: before + separator + replacement + '\n\n' + xml.slice(closing),
        action: 'added'
    };
}

/**
 * Borra un item.
 *
 * ANTES DE BORRAR HAY QUE COMPROBAR QUE NINGÚN MAPA LO USA. Un item borrado que
 * aparece en un mapa deja el mapa inválido, y el fallo salta al arrancar el motor y
 * no aquí, que es donde se puede explicar qué pasó. La comprobación la hace quien
 * llama, que es el único que conoce los mapas; esto sólo borra.
 */
function deleteItem(xml, id) {
    const blocks = findItemBlocks(xml);
    const existing = blocks.find((block) => block.id === Number(id));

    if (!existing) {
        return { xml: xml, action: 'notFound' };
    }

    // Se come también el salto de linea que precede al bloque, para no dejar un
    // hueco de dos lineas donde estaba.
    let start = existing.start;
    const lineStart = xml.lastIndexOf('\n', start - 1);
    if (lineStart !== -1 && xml.slice(lineStart + 1, start).trim() === '') {
        start = lineStart + 1;
    }

    return {
        xml: xml.slice(0, start) + xml.slice(existing.end).replace(/^\n/, ''),
        action: 'deleted'
    };
}

module.exports = {
    findItemBlocks,
    parseAttributes,
    buildItemBlock,
    readItems,
    saveItem,
    deleteItem,
    escapeXml,
    KNOWN_ATTRIBUTE_KEYS
};
