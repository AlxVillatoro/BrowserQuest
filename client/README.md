Documentación del cliente
==========================

El cliente funciona **sin paso de build**. El servidor de desarrollo sirve el
cliente y el WebSocket en el mismo puerto, y `js/config.js` deduce el destino del
propio origen (`window.location`), así que basta con:

```bash
npm start
# abrir http://localhost:8000/
```

## Overrides opcionales

- **Host y puerto**: `js/config.js` los toma de `window.location`. Para forzarlos,
  crea `client/config/config_local.json` a partir de
  `config_local.json-dist`; se carga por encima y su ausencia es tolerada.
- `config_build.json` **ya no se usa**: era un artefacto que generaba el build y
  que además estaba en `.gitignore`, de modo que en un clon limpio el `define`
  fallaba y el cliente no arrancaba. Se ha eliminado esa dependencia.

## Build de producción (opcional)

Sigue siendo posible optimizar el cliente con el optimizador de RequireJS:

```bash
cd bin
chmod +x build.sh
./build.sh
```

Genera `client-build/`, un directorio autocontenido que se puede desplegar en
cualquier sitio. El registro del build queda en `bin/build.txt`.

Nota: `bin/build.sh` y `client/js/build.js` son del proyecto original y aplican
las pragmas `devHost`/`prodHost` de r.js. Como `js/config.js` ya no lee
`config_build.json`, el resultado del build se conecta al mismo origen desde el
que se sirve.
