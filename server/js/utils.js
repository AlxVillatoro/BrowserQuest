
var Utils = {},
    Types = require("../../shared/js/gametypes");

module.exports = Utils;

// Reemplaza al paquete `sanitizer` (abandonado). El original hacía
// sanitizer.escape(sanitizer.sanitize(s)): primero quitaba las etiquetas y
// después escapaba las entidades. Se conserva exactamente ese comportamiento
// porque el cliente inserta los mensajes de chat como HTML.
var HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
};

Utils.sanitize = function(string) {
    // Strip unsafe tags, then escape as html entities.
    return String(string)
        .replace(/<[^>]*>/g, '')
        .replace(/[&<>"'\/]/g, function(character) {
            return HTML_ENTITIES[character];
        });
};

Utils.random = function(range) {
    return Math.floor(Math.random() * range);
};

Utils.randomRange = function(min, max) {
    return min + (Math.random() * (max - min));
};

Utils.randomInt = function(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
};

Utils.clamp = function(min, max, value) {
    if(value < min) {
        return min;
    } else if(value > max) {
        return max;
    } else {
        return value;
    }
};

Utils.randomOrientation = function() {
    var o, r = Utils.random(4);
    
    if(r === 0)
        o = Types.Orientations.LEFT;
    if(r === 1)
        o = Types.Orientations.RIGHT;
    if(r === 2)
        o = Types.Orientations.UP;
    if(r === 3)
        o = Types.Orientations.DOWN;
    
    return o;
};

Utils.Mixin = function(target, source) {
  if (source) {
    for (var key, keys = Object.keys(source), l = keys.length; l--; ) {
      key = keys[l];

      if (source.hasOwnProperty(key)) {
        target[key] = source[key];
      }
    }
  }
  return target;
};

Utils.distanceTo = function(x, y, x2, y2) {
    var distX = Math.abs(x - x2);
    var distY = Math.abs(y - y2);

    return (distX > distY) ? distX : distY;
};