// Coin economy: value/level calculation, regular upgrades, daily rewards.
(function (global) {
  const ADJ = ["Crunchy", "Neon", "Chrome", "Violet", "Blazing", "Electric", "Midnight", "Hyper",
    "Glowing", "Silent", "Velvet", "Static", "Turbo", "Quantum", "Rogue", "Lunar", "Solar", "Prism"];
  const NOUN = ["Croissant", "Falcon", "Horizon", "Comet", "Drift", "Mirage", "Circuit", "Nebula",
    "Lotus", "Echo", "Spire", "Vortex", "Pulse", "Harbor", "Ember", "Glitch", "Zenith", "Aurora"];

  function randomBuildingName() {
    const a = ADJ[Math.floor(Math.random() * ADJ.length)];
    const n = NOUN[Math.floor(Math.random() * NOUN.length)];
    return `${a} ${n}`;
  }
  global.NH_randomBuildingName = randomBuildingName;

  const DISTRICT_LAND_VALUE = {
    0: 90, 1: 110, 2: 130, 3: 150, 4: 175, 5: 200,
  };

  const UPGRADE_DEFS = {
    floors: { label: "upgradeTaller", baseCost: 30, costStep: 22, valueAdd: 9 },
    neonColor: { label: "upgradeNeonColor", baseCost: 25, valueAdd: 10 },
    garden: { label: "upgradeGarden", baseCost: 60, valueAdd: 22 },
    billboard: { label: "upgradeBillboard", baseCost: 40, valueAdd: 16 },
  };

  const PAID_UPGRADE_DEFS = {
    hologram: { label: "paidHologram", priceUsd: 0.99, valueAdd: 35 },
    flyingCar: { label: "paidFlyingCar", priceUsd: 0.99, valueAdd: 50 },
    rainbow: { label: "paidRainbow", priceUsd: 0.99, valueAdd: 40 },
    helipad: { label: "paidHelipad", priceUsd: 0.99, valueAdd: 45 },
    spotlight: { label: "paidSpotlight", priceUsd: 0.99, valueAdd: 30 },
  };

  function floorsCost(currentFloors) {
    const d = UPGRADE_DEFS.floors;
    return d.baseCost + currentFloors * d.costStep;
  }

  function computeValue(user) {
    const land = DISTRICT_LAND_VALUE[user.districtId] ?? 100;
    let building = 40;
    const up = user.upgrades || {};
    building += (up.floors || 0) * UPGRADE_DEFS.floors.valueAdd;
    if (up.neonColor) building += UPGRADE_DEFS.neonColor.valueAdd;
    if (up.garden) building += UPGRADE_DEFS.garden.valueAdd;
    if (up.billboard) building += UPGRADE_DEFS.billboard.valueAdd;
    for (const k in PAID_UPGRADE_DEFS) {
      if (up[k]) building += PAID_UPGRADE_DEFS[k].valueAdd;
    }
    return { land, building, total: land + building };
  }

  function computeLevel(value) {
    return 1 + Math.floor(value.total / 55);
  }

  function canAfford(coins, cost) {
    return coins >= cost;
  }

  const DAILY_CHECKIN_REWARD = 20;
  const DAILY_DRAW_MIN = 10;
  const DAILY_DRAW_MAX = 90;
  const INVITE_REWARD = 50;
  const SHARE_REWARD = 10;
  const STARTING_COINS = 150;

  function isNewDay(stamp) {
    if (!stamp) return true;
    const today = new Date().toISOString().slice(0, 10);
    return stamp !== today;
  }
  function todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  global.NH_Economy = {
    UPGRADE_DEFS, PAID_UPGRADE_DEFS, DISTRICT_LAND_VALUE,
    floorsCost, computeValue, computeLevel, canAfford,
    DAILY_CHECKIN_REWARD, DAILY_DRAW_MIN, DAILY_DRAW_MAX,
    INVITE_REWARD, SHARE_REWARD, STARTING_COINS,
    isNewDay, todayStamp, randomBuildingName,
  };
})(window);
