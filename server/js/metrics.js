
var cls = require("./lib/class"),
    _ = require("underscore");

module.exports = Metrics = cls.Class.extend({
    init: function(config) {
        var self = this,
            memcache;
        
        this.config = config;
        
        // `memcache` ya no es una dependencia del proyecto: sólo se necesita
        // si metrics_enabled=true. Se carga aquí, no en la cabecera del
        // módulo, para que el arranque normal no dependa de él.
        try {
            memcache = require("memcache");
        } catch(e) {
            throw new Error("metrics_enabled=true requiere el paquete 'memcache'. " +
                "Instalalo con `npm install memcache` o pon metrics_enabled=false en server/config_local.json.");
        }
        
        this.client = new memcache.Client(config.memcached_port, config.memcached_host);
        this.client.connect();
        
        this.isReady = false;
        
        this.client.on('connect', function() {
            log.info("Metrics enabled: memcached client connected to "+config.memcached_host+":"+config.memcached_port);
            self.isReady = true;
            if(self.ready_callback) {
                self.ready_callback();
            }
        });
    },
    
    ready: function(callback) {
        this.ready_callback = callback;
    },
    
    updatePlayerCounters: function(worlds, updatedCallback) {
        var self = this,
            config = this.config,
            numServers = _.size(config.game_servers),
            playerCount = _.reduce(worlds, function(sum, world) { return sum + world.playerCount; }, 0);
        
        if(this.isReady) {
            // Set the number of players on this server
            this.client.set('player_count_'+config.server_name, playerCount, function() {
                var total_players = 0;
                
                // Recalculate the total number of players and set it
                _.each(config.game_servers, function(server) {
                    self.client.get('player_count_'+server.name, function(error, result) {
                        var count = result ? parseInt(result) : 0;

                        total_players += count;
                        numServers -= 1;
                        if(numServers === 0) {
                            self.client.set('total_players', total_players, function() {
                                if(updatedCallback) {
                                    updatedCallback(total_players);
                                }
                            });
                        }
                    });
                });
            });
        } else {
            log.error("Memcached client not connected");
        }
    },
    
    updateWorldDistribution: function(worlds) {
        this.client.set('world_distribution_'+this.config.server_name, worlds);
    },
    
    getOpenWorldCount: function(callback) {
        this.client.get('world_count_'+this.config.server_name, function(error, result) {
            callback(result);
        });
    },
    
    getTotalPlayers: function(callback) {
        this.client.get('total_players', function(error, result) {
            callback(result);
        });
    }
});
