/**
 * El lienzo del editor.
 *
 * DIBUJA CON EL MISMO CÓDIGO QUE EL JUEGO. La cámara y el orden de dibujo son los
 * módulos del cliente, importados tal cual. Si el editor tuviera su propio renderer,
 * los dos acabarían discrepando, y un mapa que se ve bien en el editor y mal en el
 * juego es un fallo que cuesta horas entender porque cada mitad parece correcta.
 *
 * Lo único propio es lo que el juego no necesita: la rejilla, el resaltado de la celda
 * bajo el cursor, el fondo de la planta actual y los marcadores de waypoint y de
 * spawn. Un juego no dibuja esas cosas; un editor no puede funcionar sin ellas.
 */

import { Camera, TILE_PIXELS, floorOffset } from '/avillatoro/js/camera.js';
import { buildDrawList, DRAW } from '/avillatoro/js/drawlist.js';
import { createProvider, TILE } from '/avillatoro/js/sprites.js';

export class MapCanvas {
    constructor(options) {
        const opts = options || {};

        this.canvas = opts.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.provider = createProvider({});

        this.camera = new Camera({ width: 800, height: 600, tileSize: TILE });
        this.map = null;

        /** La planta que se está editando. */
        this.z = 7;

        /** La celda bajo el cursor, para resaltarla. */
        this.hover = null;

        /** Desplazamiento mientras se arrastra con el botón derecho. */
        this.dragging = null;

        this.ctx.imageSmoothingEnabled = false;
        this.resize();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;

        this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
        this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));

        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.ctx.imageSmoothingEnabled = false;

        this.camera.setViewport(rect.width, rect.height);
        return this;
    }

    setMap(map) {
        this.map = map;
        return this;
    }

    setFloor(z) {
        this.z = z;
        return this;
    }

    centerOn(x, y) {
        this.camera.setCenter(x, y, this.z);
        return this;
    }

    /** La celda bajo un punto del lienzo. */
    cellAt(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return this.camera.screenToWorld(
            clientX - rect.left, clientY - rect.top, this.z);
    }

    // -----------------------------------------------------------------------
    // Dibujo
    // -----------------------------------------------------------------------

    draw(hoverInfo) {
        const ctx = this.ctx;
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.fillStyle = '#0d0d12';
        ctx.fillRect(0, 0, width, height);

        if (!this.map) {
            return;
        }

        this._drawFloorBackground(width, height);

        const ops = buildDrawList(this.map, this.camera, {
            now: 0,
            // Sólo la planta que se está editando. Ver las de arriba y abajo está bien
            // en un juego y estorba en un editor: al pintar hay que ver lo que se pinta.
            onlyCurrentFloor: true
        });

        ops.forEach((op) => {
            if (op.kind === DRAW.CREATURE) {
                return;
            }
            if (op.kind === DRAW.GROUND) {
                this._drawGround(op);
            } else {
                this._drawSprite(op);
            }
        });

        this._drawFlags(ops);
        this._drawMarkers();
        this._drawGrid(width, height);
        this._drawHover(hoverInfo);
    }

    /**
     * El fondo de la planta actual.
     *
     * Es el suelo por defecto, pintado de una vez en lugar de celda a celda. Sin esto
     * habría que dibujar 4096 celdas idénticas por planta, y además taparía lo que se
     * está editando.
     */
    _drawFloorBackground(width, height) {
        const defaultType = this.map.defaultGroundFor(this.z);
        const sprite = this.provider.get(defaultType);

        this.ctx.fillStyle = sprite ? (sprite.shape.color || '#2a2a30') : '#1a1a20';

        // Se cubre el rectángulo visible con margen, porque el desplazamiento por
        // planta corre el contenido en diagonal.
        const offset = floorOffset(this.z, this.camera.z);
        this.ctx.save();
        this.ctx.translate(
            Math.round(-(this.camera.centerX % 1) * TILE_PIXELS),
            Math.round(-(this.camera.centerY % 1) * TILE_PIXELS));
        this.ctx.fillRect(-TILE_PIXELS * offset.x, -TILE_PIXELS * offset.y,
            width + TILE_PIXELS * 2, height + TILE_PIXELS * 2);
        this.ctx.restore();
    }

    _drawGround(op) {
        const sprite = this.provider.get(op.typeId);
        if (!sprite) {
            return;
        }
        this.ctx.drawImage(sprite.canvas,
            Math.round(op.sx), Math.round(op.sy) - sprite.anchorY + TILE);
    }

    _drawSprite(op) {
        const sprite = this.provider.get(op.typeId);
        if (!sprite) {
            return;
        }
        this.ctx.drawImage(sprite.canvas,
            Math.round(op.sx), Math.round(op.sy) - sprite.anchorY + TILE);
    }

    /** Un borde en las celdas con banderas, para que se vean aunque no tengan dibujo. */
    _drawFlags(ops) {
        ops.forEach((op) => {
            if (!op.flags || op.flags.length === 0) {
                return;
            }
            this.ctx.strokeStyle = '#4ad0ff';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(op.sx + 1, op.sy + 1, TILE - 2, TILE - 2);

            this.ctx.fillStyle = '#4ad0ff';
            this.ctx.font = '9px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(op.flags.join(',').slice(0, 14), op.sx + 3, op.sy + 10);
        });
    }

    /** Waypoints y puntos de aparición, que si no son invisibles. */
    _drawMarkers() {
        const draw = [];

        const waypoints = this.map.raw.waypoints || {};
        Object.keys(waypoints).forEach((name) => {
            const position = waypoints[name];
            if (position[2] !== this.z) {
                return;
            }
            draw.push({ x: position[0], y: position[1], color: '#ffd24a', label: name });
        });

        (this.map.raw.spawns || []).forEach((spawn) => {
            if (spawn.z !== this.z) {
                return;
            }
            draw.push({
                x: spawn.x, y: spawn.y,
                color: '#ff6a6a',
                radius: spawn.radius === undefined ? 1 : spawn.radius,
                label: spawn.monster
            });
        });

        draw.forEach((marker) => {
            const screen = this.camera.worldToScreen(marker.x, marker.y, this.z);

            if (marker.radius !== undefined) {
                this.ctx.strokeStyle = marker.color;
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([4, 4]);
                this.ctx.strokeRect(
                    screen.x - marker.radius * TILE, screen.y - marker.radius * TILE,
                    (marker.radius * 2 + 1) * TILE, (marker.radius * 2 + 1) * TILE);
                this.ctx.setLineDash([]);
            }

            this.ctx.fillStyle = marker.color;
            this.ctx.beginPath();
            this.ctx.arc(screen.x + TILE / 2, screen.y + TILE / 2, 5, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.font = '10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(marker.label, screen.x + TILE / 2, screen.y - 2);
        });
    }

    /** La rejilla de casillas, alineada con el desplazamiento de la planta. */
    _drawGrid(width, height) {
        const offset = floorOffset(this.z, this.camera.z);
        const originX = (0 + offset.x - this.camera.centerX) * TILE + width / 2;
        const originY = (0 + offset.y - this.camera.centerY) * TILE + height / 2;

        this.ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();

        for (let x = originX % TILE; x < width; x += TILE) {
            this.ctx.moveTo(Math.round(x) + 0.5, 0);
            this.ctx.lineTo(Math.round(x) + 0.5, height);
        }
        for (let y = originY % TILE; y < height; y += TILE) {
            this.ctx.moveTo(0, Math.round(y) + 0.5);
            this.ctx.lineTo(width, Math.round(y) + 0.5);
        }

        this.ctx.stroke();
    }

    /** La celda bajo el cursor y lo que hay en ella. */
    _drawHover(info) {
        if (!this.hover) {
            return;
        }

        const screen = this.camera.worldToScreen(this.hover.x, this.hover.y, this.z);

        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(screen.x + 1, screen.y + 1, TILE - 2, TILE - 2);

        if (info) {
            this.ctx.fillStyle = 'rgba(0,0,0,0.75)';
            this.ctx.fillRect(screen.x, screen.y - 16, this.ctx.measureText(info).width + 8, 15);
            this.ctx.fillStyle = '#e8e8f0';
            this.ctx.font = '10px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(info, screen.x + 4, screen.y - 5);
        }
    }
}
