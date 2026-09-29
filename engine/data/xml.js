'use strict';

/**
 * Lectura de las definiciones XML del motor.
 *
 * `data/XML/` es, en The Forgotten Server, la carpeta de definiciones estáticas
 * del motor (vocaciones, outfits, grupos, mounts, imbuements, quests). No es
 * contenido de mundo y no lo tocan los scripts: se parsea al arrancar y rellena
 * objetos en memoria.
 *
 * Nota de diseño sobre el formato: el XML se usa para lo que es declarativo y
 * estable (una vocación, un grupo de permisos), y NO para el contenido que la
 * comunidad va a querer programar. Por eso en TFS los monstruos y los hechizos
 * son Lua y no XML: un monstruo con IA, ataques condicionales y loot acaba
 * necesitando código, y forzarlo a XML produce dialectos imposibles.
 */

const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

/**
 * Parser configurado para el dialecto de estos archivos: los atributos se leen
 * sin prefijo y las listas de `<item>` y `<attribute>` siempre son arrays,
 * aunque tengan un solo elemento. Sin eso, un archivo con un único item
 * devolvería un objeto suelto y todo el código de consumo tendría que
 * defenderse caso por caso.
 */
function createParser() {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true,
        trimValues: true,
        isArray: (name) => name === 'item' || name === 'attribute' ||
            name === 'vocation' || name === 'skill' || name === 'formula'
    });
}

function parseFile(filepath, parser) {
    const source = fs.readFileSync(filepath, 'utf8');
    return (parser || createParser()).parse(source);
}

/**
 * Convierte la lista de `<attribute key= value=>` de un item en un objeto
 * plano. Los atributos anidados (por ejemplo el `<attribute key="field">` de un
 * campo de magia) se conservan como objeto.
 */
function attributesToObject(attributes) {
    const result = {};
    (attributes || []).forEach((attribute) => {
        const key = attribute.key;
        if (key === undefined) {
            return;
        }
        if (attribute.attribute) {
            result[key] = attributesToObject(attribute.attribute);
        } else {
            result[key] = attribute.value !== undefined ? attribute.value : true;
        }
    });
    return result;
}

/**
 * Carga `items.xml`.
 *
 * Devuelve un Map de id de item a definición. Soporta los rangos
 * `fromid`/`toid`, que en items.xml se usan para dar el mismo nombre a una
 * familia de sprites.
 *
 * Ojo: en The Forgotten Server el binario `items.otb` es el que CREA los ids y
 * este XML sólo los completa. Aquí todavía no hay `items.otb`, así que por ahora
 * el XML es la única fuente y el importador de OTB llegará después (ver
 * ARQUITECTURA.md). Cuando llegue, este módulo pasará a tener el mismo papel que
 * en TFS: completar, no crear.
 */
function loadItems(filepath) {
    const parsed = parseFile(filepath);
    const items = new Map();

    const list = (parsed.items && parsed.items.item) || [];
    list.forEach((entry) => {
        const definition = {
            name: entry.name !== undefined ? String(entry.name) : null,
            article: entry.article !== undefined ? String(entry.article) : null,
            plural: entry.plural !== undefined ? String(entry.plural) : null,
            attributes: attributesToObject(entry.attribute)
        };

        if (entry.id !== undefined) {
            items.set(Number(entry.id), { ...definition, id: Number(entry.id) });
            return;
        }

        if (entry.fromid !== undefined && entry.toid !== undefined) {
            const from = Number(entry.fromid);
            const to = Number(entry.toid);
            for (let id = from; id <= to; id += 1) {
                items.set(id, { ...definition, id: id });
            }
        }
    });

    return items;
}

/**
 * Carga `vocations.xml`.
 *
 * Es el ejemplo canónico de definición declarativa: fórmulas de progresión y
 * multiplicadores por skill, sin nada de lógica.
 */
function loadVocations(filepath) {
    const parsed = parseFile(filepath);
    const vocations = new Map();

    const list = (parsed.vocations && parsed.vocations.vocation) || [];
    list.forEach((entry) => {
        const id = Number(entry.id);
        const vocation = {
            id: id,
            name: entry.name !== undefined ? String(entry.name) : 'None',
            fromVocation: entry.fromvoc !== undefined ? Number(entry.fromvoc) : 0,
            gainCap: entry.gaincap !== undefined ? Number(entry.gaincap) : 0,
            gainHp: entry.gainhp !== undefined ? Number(entry.gainhp) : 0,
            gainMana: entry.gainmana !== undefined ? Number(entry.gainmana) : 0,
            gainHpTicks: entry.gainhpticks !== undefined ? Number(entry.gainhpticks) : 0,
            gainManaTicks: entry.gainmanaticks !== undefined ? Number(entry.gainmanaticks) : 0,
            attackSpeed: entry.attackspeed !== undefined ? Number(entry.attackspeed) : 0,
            baseSpeed: entry.basespeed !== undefined ? Number(entry.basespeed) : 0,
            soul: entry.soul !== undefined ? Number(entry.soul) : 0,
            skills: {}
        };

        // Los multiplicadores de skill van en elementos <skill id= multiplier=>,
        // uno por skill, indexados por id.
        (entry.skill || []).forEach((skill) => {
            vocation.skills[Number(skill.id)] = Number(skill.multiplier);
        });

        // El resto de multiplicadores van como atributos sueltos del elemento
        // <vocation> (magLevel, magFist...). Se recogen por prefijo para no
        // tener que tocar el motor cada vez que se añade una skill. Se excluyen
        // los valores que son objetos, que son los elementos anidados.
        Object.keys(entry).forEach((key) => {
            const isMultiplier = key.indexOf('mag') === 0 || key.indexOf('skill') === 0;
            if (isMultiplier && typeof entry[key] !== 'object') {
                vocation.skills[key] = Number(entry[key]);
            }
        });

        vocations.set(id, vocation);
    });

    return vocations;
}

module.exports = { createParser, parseFile, attributesToObject, loadItems, loadVocations };
