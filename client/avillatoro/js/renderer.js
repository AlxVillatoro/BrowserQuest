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
import { TILE } from './sprites.js';

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

        // El desplazamiento del lienzo alinea la rejilla al píxel. Sin esto, al
        // moverse la cámara en coordenadas fraccionarias el navegador interpola las
        // texturas y la imagen tiembla.
        const offsetX = Math.round(this.cssWidth / 2 - (camera.centerX * camera.tileSize) % camera.tileSize);
        const offsetY = Math.round(this.cssHeight / 2 - (camera.centerY * camera.tileSize) % camera.tileSize);

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

        // Un cuerpo simple, con la forma cambiando según la dirección. No es un
        // sprite: es un marcador legible hasta que existan los assets de verdad.
        const isPlayer = op.isPlayer;
        const bodyColor = isPlayer ? '#4a90d9' : '#c05040';
        const outline = isPlayer ? '#2a5a90' : '#803020';

        // La sombra proyectada es lo que ancla al muñeco en el suelo: sin ella
        // parece flotar, y es lo que más se nota al mirar el 2.5D.
        this.ctx.fillStyle = 'rgba(0,0,0,0.28)';
        this.ctx.beginPath();
        this.ctx.ellipse(x + TILE / 2, y + TILE - 4, TILE / 3, TILE / 6, 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = bodyColor;
        this.ctx.strokeStyle = outline;
        this.ctx.lineWidth = 1;

        this.ctx.fillRect(x + 9, y + 8, TILE - 18, TILE - 14);
        this.ctx.strokeRect(x + 9.5, y + 8.5, TILE - 19, TILE - 15);

        // La cabeza, para que se distinga la orientación.
        this.ctx.fillStyle = '#e8c8a0';
        this.ctx.fillRect(x + 12, y + 3, TILE - 24, 9);

        // Un detalle que marca hacia dónde mira.
        this.ctx.fillStyle = '#202020';
        const cx = x + TILE / 2;
        const cy = y + 7;
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
            this.ctx.fillStyle = isPlayer ? '#cfe6ff' : '#ffd0c0';
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
