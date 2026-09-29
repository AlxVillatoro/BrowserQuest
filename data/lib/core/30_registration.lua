--[[
    Objetos de registro: Action, MoveEvent, TalkAction, MonsterType.

    Reproducen el patrón de RevScript de The Forgotten Server, que es el que la
    comunidad ya conoce:

        local action = Action()
        function action.onUse(player, item, fromPosition, target, toPosition, isHotkey)
            ...
        end
        action:id(1948, 1949)
        action:register()

    Mantener este patrón no es nostalgia: significa que un script escrito para
    TFS se puede traer casi tal cual, y que quien ya sabe escribir datapacks
    sabe escribir para este motor desde el primer minuto.
--]]

-- ---------------------------------------------------------------------------
-- Action: un item que hace algo al usarlo.
-- ---------------------------------------------------------------------------

Action = {}
Action.__index = Action

function Action.new()
    return setmetatable({ ids = {} }, Action)
end

setmetatable(Action, {
    __call = function()
        return Action.new()
    end
})

-- Acepta tanto action:id(1, 2, 3) como action:id({1, 2, 3}).
function Action:id(...)
    local args = { ... }
    if #args == 1 and type(args[1]) == "table" then
        args = args[1]
    end
    for _, value in ipairs(args) do
        table.insert(self.ids, value)
    end
    return self
end

function Action:register()
    if type(self.onUse) ~= "function" then
        error("Action sin 'onUse': define action.onUse antes de register()")
    end
    if #self.ids == 0 then
        error("Action sin ids: usa action:id(...) antes de register()")
    end
    Engine.registerAction(self.ids, self.onUse)
    return self
end

-- ---------------------------------------------------------------------------
-- MoveEvent: algo que ocurre cuando una criatura pisa, sale, equipa o suelta.
-- ---------------------------------------------------------------------------

MoveEvent = {}
MoveEvent.__index = MoveEvent

-- El nombre del callback lo decide el tipo de evento, igual que en TFS.
local MOVE_CALLBACKS = {
    stepin = "onStepIn",
    stepout = "onStepOut",
    equip = "onEquip",
    deequip = "onDeEquip",
    additem = "onAddItem",
    removeitem = "onRemoveItem"
}

function MoveEvent.new()
    return setmetatable({ ids = {}, eventType = "stepin" }, MoveEvent)
end

setmetatable(MoveEvent, {
    __call = function()
        return MoveEvent.new()
    end
})

function MoveEvent:type(eventType)
    local normalized = string.lower(tostring(eventType))
    if not MOVE_CALLBACKS[normalized] then
        error("tipo de MoveEvent desconocido: " .. tostring(eventType))
    end
    self.eventType = normalized
    return self
end

function MoveEvent:id(...)
    local args = { ... }
    if #args == 1 and type(args[1]) == "table" then
        args = args[1]
    end
    for _, value in ipairs(args) do
        table.insert(self.ids, value)
    end
    return self
end

function MoveEvent:register()
    local callbackName = MOVE_CALLBACKS[self.eventType]
    if type(self[callbackName]) ~= "function" then
        error("MoveEvent de tipo '" .. self.eventType .. "' sin '" .. callbackName .. "'")
    end
    if #self.ids == 0 then
        error("MoveEvent sin ids: usa moveevent:id(...) antes de register()")
    end
    Engine.registerMovement(self.eventType, self.ids, self[callbackName])
    return self
end

-- ---------------------------------------------------------------------------
-- TalkAction: un comando de chat, como "/pos" o "!online".
-- ---------------------------------------------------------------------------

TalkAction = {}
TalkAction.__index = TalkAction

function TalkAction.new(words)
    if type(words) ~= "string" or words == "" then
        error("TalkAction necesita una palabra, por ejemplo TalkAction(\"/pos\")")
    end
    return setmetatable({ words = string.lower(words), separator = " " }, TalkAction)
end

setmetatable(TalkAction, {
    __call = function(_, words)
        return TalkAction.new(words)
    end
})

function TalkAction:separator(separator)
    self.separator = separator
    return self
end

function TalkAction:register()
    if type(self.onSay) ~= "function" then
        error("TalkAction '" .. self.words .. "' sin 'onSay'")
    end
    Engine.registerTalkAction(self.words, self.onSay)
    return self
end

-- ---------------------------------------------------------------------------
-- MonsterType: un tipo de monstruo creado desde Lua, no desde XML.
-- ---------------------------------------------------------------------------

MonsterType = {}
MonsterType.__index = MonsterType

function MonsterType.new(name)
    return setmetatable({ name = name }, MonsterType)
end

setmetatable(MonsterType, {
    __call = function(_, name)
        return MonsterType.new(name)
    end
})

function MonsterType:getName()
    return self.name
end

function MonsterType:register(definition)
    if type(definition) ~= "table" then
        error("MonsterType:register(definition) necesita una tabla")
    end
    Engine.registerMonsterType(self.name, definition)
    return self
end
