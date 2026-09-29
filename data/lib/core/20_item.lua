--[[
    Item: una instancia concreta de item en el mundo.

    Hay que distinguir dos identificadores, y confundirlos es el error clásico:

      - itemId  -> el TIPO ("una moneda de oro"). Es el que sale en items.xml.
      - uid     -> la INSTANCIA ("esta moneda concreta, en este tile").

    Un script casi siempre trabaja con la instancia y pregunta por el tipo.
--]]

Item = {}
Item.__index = Item

local instances = setmetatable({}, { __mode = "v" })

function Item.new(uid)
    local existing = instances[uid]
    if existing then
        return existing
    end
    local self = setmetatable({ uid = uid }, Item)
    instances[uid] = self
    return self
end

setmetatable(Item, {
    __call = function(_, uid)
        return Item.new(uid)
    end
})

function Item:__tostring()
    return "Item(" .. tostring(self.uid) .. ")"
end

function Item:getUniqueId()
    return self.uid
end

function Item:getId()
    return Engine.getItemId(self.uid)
end

function Item:getCount()
    return Engine.getItemCount(self.uid)
end

function Item:getName()
    return Engine.getItemName(self:getId())
end

function Item:getAttribute(key)
    return Engine.getItemAttribute(self:getId(), key)
end

function Item:remove()
    return Engine.removeItem(self.uid)
end
