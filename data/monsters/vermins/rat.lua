--[[
    Rata.

    Los monstruos son Lua y no XML a propósito. Un monstruo acaba necesitando
    ataques condicionales, invocaciones, gritos con probabilidad y loot con
    rangos: todo eso es lógica, y forzarla a XML produce dialectos imposibles de
    mantener. Es la misma decisión que tomó The Forgotten Server.

    El patrón es el suyo: `Game.createMonsterType(nombre)` devuelve el objeto de
    registro, se rellena la tabla y se registra.
--]]

local mType = Game.createMonsterType("Rat")
local monster = {}

monster.description = "a rat"
monster.experience = 5
monster.outfit = {
	lookType = 21,
	lookHead = 0,
	lookBody = 0,
	lookLegs = 0,
	lookFeet = 0,
	lookAddons = 0,
	lookMount = 0
}

monster.health = 20
monster.maxHealth = 20
monster.race = "blood"
monster.corpse = 5965
monster.speed = 74
monster.manaCost = 250

monster.changeTarget = {
	interval = 4000,
	chance = 20
}

monster.strategiesTarget = {
	nearest = 100,
	health = 100,
	damage = 100,
	random = 0
}

monster.flags = {
	summonable = true,
	attackable = true,
	hostile = true,
	convinceable = true,
	pushable = true,
	rewardBoss = false,
	illusionable = true,
	canPushItems = false,
	canPushCreatures = false,
	staticAttackChance = 90,
	targetDistance = 1,
	runHealth = 0,
	healthHidden = false,
	isBlockable = false,
	canWalkOnEnergy = false,
	canWalkOnFire = false,
	canWalkOnPoison = false
}

monster.attacks = {
	{ name = "melee", interval = 2000, chance = 100, minDamage = 0, maxDamage = -8 }
}

monster.defenses = {
	defense = 1,
	armor = 1
}

monster.elements = {}
monster.immunities = {}

monster.voices = {
	interval = 5000,
	chance = 10,
	{ text = "Eeek!", yell = false },
	{ text = "Meep!", yell = false }
}

monster.loot = {
	{ id = 3031, chance = 40000, maxCount = 4 },   -- gold coin
	{ id = 2160, chance = 1000 }                   -- crystal coin
}

mType:register(monster)
