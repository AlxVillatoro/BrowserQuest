
var Utils = require('./utils'),
    Types = require("../../shared/js/gametypes"),
    Item = require('./item');

module.exports = Chest = Item.extend({
    init: function(id, x, y) {
        this._super(id, Types.Entities.CHEST, x, y);
    },
    
    setItems: function(items) {
        this.items = items;
    },
    
    getRandomItem: function() {
        // `this.items` es un array de kinds. Se usa .length en vez de _.size
        // porque `_` no existe como global en Node (ver tools/audit-globals.js):
        // abrir un cofre lanzaba ReferenceError y el contenido nunca aparecía.
        var items = this.items || [],
            nbItems = items.length,
            item = null;

        if(nbItems > 0) {
            item = items[Utils.random(nbItems)];
        }
        return item;
    }
});