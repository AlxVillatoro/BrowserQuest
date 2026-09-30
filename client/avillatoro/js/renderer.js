/**
 * El renderer: recorre la lista de dibujo y pinta.
 *
 * Es DELIBERADAMENTE tonto. No decide qué se ve, ni en qué orden, ni dónde: eso ya
 * está resuelto en `camera.js` y `drawlist.js`, que son cálculo puro y se prueban
 * sin navegador. Aquí sólo quedan llamadas al lienzo, que es la parte que no se
 * puede probar sin abrir uno.
 *
 * Esa división es lo que hace verificable el 2.5D: si el orden estuviera mezclado
 * con las llamadas de dibujo, la única forma de comprobarlo sería mirar una captura
 * y confiar en la vista.
 */

import { DRAW } from './drawlist.js';
import { TILE, paletteColor, darker } from './sprites.js';

export class Renderer {
    constructor(options) {
        const opts = options || {};

        this.canvas = opts.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.provider = opts.provider;
        this.showNames = opts.showNames !== false;
        this.showHealth = opts.showHealth !== false;

        /** Contadores para el diagnóstico. */
        this.stats = { frames: 0, ops: 0, lastFrameMs: 0 };

        // El suavizado de imagen se DESACTIVA: los sprites son pixel art y
        // interpolarlos los convierte en manchas. Es lo primero que hay que
        // configurar en un cliente de este tipo y lo primero que se olvida.
        this.ctx.imageSmoothingEnabled = false;

        this.resize();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;

        this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
        this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));

        this.cssWidth = rect.width;
        this.cssHeight = rect.height;

        // El contexto se escala para poder dibujar en píxeles CSS y que en pantallas
        // de alta densidad no salga todo diminuto.
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.ctx.imageSmoothingEnabled = false;

        return this;
    }

    /**
     * Pinta un fotograma.
     *
     * @param {Array} ops lista de dibujo, ya ordenada
     * @param {Camera} camera
     * @param {Object} [state] datos para la interfaz: jugador, textos
     */
    draw(ops, camera, state) {
        const started = performance.now();
        const ctx = this.ctx;

        ctx.fillStyle = '#101014';
        ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        /*
         * ESTE DESPLAZAMIENTO ES SÓLO PARA ALINEAR LA REJILLA AL PÍXEL. NO CENTRA.
         *
         * Aquí se sumaba `cssWidth / 2` y `cssHeight / 2`, y `camera.worldToScreen` YA SUMA
         * `width / 2` y `height / 2` para centrar. Las dos cosas juntas movían todo el dibujo
         * media pantalla hacia abajo y hacia la derecha: el resultado era una pantalla negra
         * con un trozo de mapa en la esquina inferior derecha, que es justo lo que se veía.
         *
         * Y por eso no lo cazó ninguna prueba: `worldToScreen` y la lista de dibujo hacían lo
         * correcto, y las dos se comprueban por separado. El error estaba en la suma de las
         * dos, y eso sólo se ve dibujando.
         *
         * Lo que hace falta es quitar la PARTE FRACCIONARIA del origen, que es lo que evita
         * que el navegador interpole las texturas al moverse la cámara en coordenadas
         * fraccionarias. Todos los tiles comparten esa parte fraccionaria, así que restarla
         * una vez los deja a todos en píxeles enteros.
         */
        const originX = camera.width / 2 - camera.centerX * camera.tileSize;
        const originY = camera.height / 2 - camera.centerY * camera.tileSize;
        const offsetX = -(originX - Math.floor(originX));
        const offsetY = -(originY - Math.floor(originY));

        ctx.save();
        ctx.translate(offsetX, offsetY);

        ops.forEach((op) => {
            if (op.kind === DRAW.CREATURE) {
                this._drawCreature(op);
            } else {
                this._drawSprite(op);
            }
        });

        ctx.restore();

        this._drawOverlay(state);

        this.stats.frames += 1;
        this.stats.ops = ops.length;
        this.stats.lastFrameMs = performance.now() - started;
    }

    _drawSprite(op) {
        const sprite = this.provider.get(op.typeId);
        if (!sprite) {
            return;
        }

        // El ancla sube el sprite para que su BASE coincida con la base del tile: un
        // muro de 32x64 se dibuja 32 píxeles más arriba y así sobresale hacia arriba,
        // que es lo que produce el volumen.
        this.ctx.drawImage(
            sprite.canvas,
            Math.round(op.sx),
            Math.round(op.sy) - sprite.anchorY + TILE
        );
    }

    _drawCreature(op) {
        const x = Math.round(op.sx);
        const y = Math.round(op.sy);

        // LOS COLORES VIENEN DEL ASPECTO, que son cuatro índices de la paleta. Aquí se
        // resuelven a colores: es trabajo del cliente, que es quien tiene la paleta, y
        // el motor sólo manda números.
        const outfit = op.outfit || {};
        const head = paletteColor(outfit.head);
        const body = paletteColor(outfit.body);
        const legs = paletteColor(outfit.legs);
        const feet = paletteColor(outfit.feet);

        // La sombra proyectada es lo que ancla al muñeco en el suelo: sin ella
        // parece flotar, y es lo que más se nota al mirar el 2.5D.
        this.ctx.fillStyle = 'rgba(0,0,0,0.28)';
        this.ctx.beginPath();
        this.ctx.ellipse(x + TILE / 2, y + TILE - 4, TILE / 3, TILE / 6, 0, 0, Math.PI * 2);
        this.ctx.fill();

        /*
         * SI HAY SPRITE DE VERDAD, SE DIBUJA Y SE SALTA EL MUÑECO DE COLORES.
         *
         * El proveedor devuelve null mientras el sprite no esta cargado y tambien cuando no
         * hay dibujo para esa criatura -Tibia tiene cientos de monstruos y BrowserQuest una
         * docena-, asi que el camino de procedimiento no se borra: es el que queda para todo
         * lo que no tiene equivalente.
         *
         * El `else` cierra justo antes de la barra de vida, para que el nombre y la vida se
         * dibujen SIEMPRE, con sprite o sin el: son interfaz, no cuerpo.
         */
        const sprite = this.provider.getCreature ? this.provider.getCreature(op) : null;

        if (sprite) {
            this.ctx.drawImage(sprite.canvas,
                Math.round(op.sx), Math.round(op.sy) - sprite.anchorY + TILE);
        } else {

        // Los pies, lo más abajo; luego las piernas, el cuerpo y la cabeza. Se dibujan
        // de abajo arriba para que cada parte tape a la anterior, que es el mismo
        // criterio que el orden de las casillas.
        this.ctx.fillStyle = feet;
        this.ctx.fillRect(x + 11, y + TILE - 8, TILE - 22, 5);

        this.ctx.fillStyle = legs;
        this.ctx.fillRect(x + 11, y + TILE - 15, TILE - 22, 8);

        this.ctx.fillStyle = body;
        this.ctx.fillRect(x + 9, y + 9, TILE - 18, TILE - 23);
        this.ctx.strokeStyle = darker(body);
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x + 9.5, y + 9.5, TILE - 19, TILE - 24);

        this.ctx.fillStyle = head;
        this.ctx.fillRect(x + 11, y + 2, TILE - 22, 9);
        this.ctx.strokeStyle = darker(head);
        this.ctx.strokeRect(x + 11.5, y + 2.5, TILE - 23, 8);

        // Los añadidos van sobre el cuerpo, y se ven como una pieza distinta. Con
        // sprites de verdad serían capas del sprite; aquí basta con que se note que
        // están puestos, porque un añadido que no se ve no se puede probar.
        const addons = Number(outfit.addons) || 0;
        if (addons & 1) {
            this.ctx.fillStyle = darker(body);
            this.ctx.fillRect(x + 7, y + 13, 5, 8);
            this.ctx.fillRect(x + TILE - 12, y + 13, 5, 8);
        }
        if (addons & 2) {
            this.ctx.fillStyle = paletteColor(outfit.head);
            this.ctx.fillRect(x + 12, y - 3, TILE - 24, 4);
        }

        // Los ojos, que marcan hacia dónde mira.
        this.ctx.fillStyle = '#202020';
        const cx = x + TILE / 2;
        const cy = y + 6;

        if (op.direction === 0) {
            this.ctx.fillRect(cx - 4, cy - 2, 2, 2);
            this.ctx.fillRect(cx + 2, cy - 2, 2, 2);
        } else if (op.direction === 2) {
            this.ctx.fillRect(cx - 4, cy + 1, 2, 2);
            this.ctx.fillRect(cx + 2, cy + 1, 2, 2);
        } else if (op.direction === 1) {
            this.ctx.fillRect(cx + 2, cy - 1, 3, 2);
        } else {
            this.ctx.fillRect(cx - 5, cy - 1, 3, 2);
        }

        // Un monstruo se distingue por su aspecto, pero mientras los sprites sean de
        // procedimiento el color del cuerpo podría coincidir con el de un jugador. Un
        // contorno distinto deja claro quién es quién sin depender del color.
        if (!op.isPlayer) {
            this.ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x + 8.5, y + 1.5, TILE - 17, TILE - 9);
        }

        }

        if (this.showHealth && op.health !== undefined && op.health < 100) {
            const width = TILE - 10;
            this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
            this.ctx.fillRect(x + 5, y - 6, width, 4);
            this.ctx.fillStyle = op.health > 50 ? '#4ac04a'
                : (op.health > 25 ? '#c0c04a' : '#c04a4a');
            this.ctx.fillRect(x + 5, y - 6, Math.round(width * op.health / 100), 4);
        }

        if (this.showNames && op.name) {
            this.ctx.font = '10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
            this.ctx.fillText(op.name, x + TILE / 2 + 1, y - 8 + 1);
            this.ctx.fillStyle = op.isPlayer ? '#cfe6ff' : '#ffd0c0';
            this.ctx.fillText(op.name, x + TILE / 2, y - 8);
        }
    }

    /** Los textos que van sobre el mapa: avisos y lo que dice la gente. */
    _drawOverlay(state) {
        if (!state) {
            return;
        }

        const ctx = this.ctx;
        const says = state.recentSays || [];

        ctx.font = '12px monospace';
        ctx.textAlign = 'left';

        says.forEach((say, index) => {
            const y = 40 + index * 16;
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(8, y - 12, ctx.measureText(say.line).width + 12, 16);
            ctx.fillStyle = '#ffe8a0';
            ctx.fillText(say.line, 14, y);
        });
    }
}
