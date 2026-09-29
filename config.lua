--[[
    Configuración del motor.

    Se ejecuta como Lua al arrancar, igual que en The Forgotten Server: este
    archivo NO es un JSON que se parsea, es código que se ejecuta y deja las
    claves en variables globales que el motor lee después.

    La diferencia es práctica, no cosmética. Permite escribir cosas como
    `experienceStages = { {minlevel=1, maxlevel=50, multiplier=100}, ... }`,
    calcular un valor con una expresión, o condicionar una opción a otra, sin
    inventar un dialecto de plantillas encima de JSON.

    Copia este archivo a `config.lua` y edítalo. Los valores de aquí son los
    que usa el motor si `config.lua` no existe.
--]]

----------------------------------------------------------------------------
-- Rutas
----------------------------------------------------------------------------
-- El motor no asume ninguna disposición de carpetas: todo se declara aquí.
dataDirectory   = "data"
clientDirectory = "client"

-- Contenido del juego (equivalente a `data/` de TFS).
itemsXml         = "data/items/items.xml"
itemsOtb         = "data/items/items.otb"
vocationsXml     = "data/XML/vocations.xml"
outfitsXml       = "data/XML/outfits.xml"
monstersDirectory = "data/monsters"
scriptsDirectory  = "data/scripts"
libDirectory      = "data/lib"
worldDirectory    = "data/world"

-- Nombre del mapa, SIN extensión (el motor resuelve `data/world/<nombre>.otbm`).
mapName = "world"

----------------------------------------------------------------------------
-- Red
----------------------------------------------------------------------------
ip                = "127.0.0.1"
loginProtocolPort = 7171
gameProtocolPort  = 7172
statusProtocolPort = 7171
maxPlayers        = 200
maxPacketsPerSecond = 50
serverName        = "Avillatoro"

----------------------------------------------------------------------------
-- Scripting
----------------------------------------------------------------------------
-- Interruptor maestro de Lua. Con esto en false el motor arranca sin ejecutar
-- ningún script, que es lo que se quiere para medir el coste base.
luaEnabled = true

-- Muestra en consola cada script que se carga.
showScriptsLogInConsole = true

-- Permite recargar contenido en caliente (`/reload`). No recarga el mapa.
reloadCommandEnabled = true

-- Si un script falla al cargarse: "abort" detiene el arranque (útil mientras se
-- desarrolla, para no arrancar con medio datapack), "skip" sigue adelante.
scriptErrorPolicy = "abort"

----------------------------------------------------------------------------
-- Mundo
----------------------------------------------------------------------------
worldType = "pvp"           -- "pvp" | "no-pvp" | "pvp-enforced"
protectionLevel = 1
defaultWorldLight = { level = 250, color = 215 }

-- Ritmo del motor. El tick es el presupuesto de simulación, no el de red.
tickIntervalMs = 50         -- 20 Hz, el valor clásico de estos servidores

----------------------------------------------------------------------------
-- Jugador nuevo
----------------------------------------------------------------------------
newPlayerLevel      = 1
newPlayerHealth     = 150
newPlayerMana       = 0
newPlayerCap        = 400
newPlayerSpawnPosX  = 100
newPlayerSpawnPosY  = 100
newPlayerSpawnPosZ  = 7
newPlayerTownId     = 1

----------------------------------------------------------------------------
-- Rates
----------------------------------------------------------------------------
rateExperience = 1
rateSkill      = 1
rateLoot       = 1
rateSpawn      = 1

-- Las etapas de experiencia son la razón de que este archivo sea Lua y no JSON:
-- son una tabla de tablas, con nombres de campo, que se recorre en orden.
experienceStages = {
    { minlevel = 1,   maxlevel = 50,   multiplier = 100 },
    { minlevel = 51,  maxlevel = 100,  multiplier = 50 },
    { minlevel = 101, maxlevel = 150,  multiplier = 25 },
    { minlevel = 151, maxlevel = 0,    multiplier = 10 },
}
