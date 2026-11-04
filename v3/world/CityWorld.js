// Assembles the whole 3D city from buildings.json: named/claimable plots as
// full modular Building entities, a dense instanced filler skyline between
// them, a glowing street-grid ground, sky-bridges, flying cars and locked-
// district fences. Pure data in, THREE.Group out — no UI/DOM here.
import * as THREE from '../vendor/three/three.module.js';
import { Building, defaultSpecForSlot } from '../entities/Building.js';
import { buildGround } from './ground.js';
import { FillerField } from './FillerField.js';
import { HeroTowers } from './HeroTowers.js';
import { FlyingCars } from './FlyingCars.js';
import { GroundTraffic } from './GroundTraffic.js';
import { Metro } from './Metro.js';
import { SkyBridges } from './SkyBridges.js';
import { LockedDistricts } from './LockedDistricts.js';

import { CITY_SIZE, CELL, ROAD_EVERY, FAR_EXTENT, HORIZON_EXTENT, assignSlots, auditBoxes } from './layout.js';
export { CITY_SIZE };

export function toWorld(xPercent, yPercent) {
  return new THREE.Vector3((xPercent / 100 - 0.5) * CITY_SIZE, 0, (yPercent / 100 - 0.5) * CITY_SIZE);
}

export class CityWorld {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.ground = buildGround(CITY_SIZE, CELL, ROAD_EVERY, HORIZON_EXTENT);
    this.group.add(this.ground);

    // -------- named/claimable buildings (full modular, individually addressable) --------
    this.buildings = new Map(); // slotId -> Building
    // every named slot gets its OWN plot inside a block (nearest free plot in its district) - never a street
    this.slotPlots = assignSlots(map.slots, toWorld, map.districts);
    for (const slot of map.slots) {
      const plot = this.slotPlots.get(slot.id);
      const b = new Building(slot.id, new THREE.Vector3(plot.cx, 0, plot.cz), plot.cap);
      try { b.rebuild(defaultSpecForSlot(slot.id)); } catch (e) { console.error('building failed', slot.id, e); }
      b.group.rotation.y = 0;
      this.group.add(b.group);
      this.buildings.set(slot.id, b);
    }

    // -------- elevated metro (built first: sky-bridges that would clip it are skipped) --------
    this.metro = safe('metro', () => new Metro(this.group));
    const reserve = (b) => this.metro.blocks(b);

    // -------- hero landmark towers: claim whole blocks/plots BEFORE the filler fills the rest --------
    this.heroes = safe('heroes', () => new HeroTowers(this.group, { count: 12 }));

    // -------- ambient filler skyline (instanced): fills every remaining plot + the far field --------
    this.filler = safe('filler', () => new FillerField(this.group, { skipChance: 0.08, reserve }));

    // -------- sky-bridges between nearby tall named towers --------
    this.skyBridges = safe('skyBridges', () => new SkyBridges(this.group, [...this.buildings.values()], reserve));

    // -------- flying cars --------
    const mobile = matchMedia('(pointer:coarse)').matches;
    this.flyingCars = safe('flyingCars', () => new FlyingCars(this.group, mobile ? 50 : 110, [...(this.filler.bridgeBoxes || []), ...this.skyBridges.boxes], this.metro));
    this.groundTraffic = safe('groundTraffic', () => new GroundTraffic(this.group, mobile ? 6 : 12));

    // -------- locked districts --------
    this.lockedDistricts = safe('lockedDistricts', () => new LockedDistricts(this.group, map.districts, toWorld));
    this._districtById = new Map(map.districts.map((d) => [d.id, d]));
    this._slotById = new Map(map.slots.map((s) => [s.id, s]));
    this._userStatus = new Map(); // slotId -> status string from the live user record
    this._districtLocked = new Map(map.districts.map((d) => [d.id, d.unlockFollowers > 0]));
  }

  // Layout audit: real measured footprints of every building piece vs. the street grid. Must report 0 on roads.
  audit() {
    const r = auditBoxes(this.group);
    return { total: r.total, onRoad: r.onRoad.length, sample: r.onRoad.slice(0, 5) };
  }

  worldPositionForSlot(slotId) {
    const b = this.buildings.get(slotId);
    return b ? b.group.position : null;
  }

  // Rebuilds a named building's 3D model from a user record's spec (or back
  // to the ambient default when the plot is freed) and applies status FX.
  applyUser(slotId, user) {
    const b = this.buildings.get(slotId);
    if (!b) return;
    const spec = user ? specFromUser(user) : defaultSpecForSlot(slotId);
    b.rebuild(spec);
    this._userStatus.set(slotId, user ? user.status : null);
    this._refreshStatus(slotId);
  }

  _refreshStatus(slotId) {
    const b = this.buildings.get(slotId);
    const slot = this._slotById.get(slotId);
    if (!b || !slot) return;
    const userStatus = this._userStatus.get(slotId);
    const locked = this._districtLocked.get(slot.districtId);
    b.setStatus(userStatus || (locked ? 'locked' : null));
  }

  setResidents(residents) {
    for (const d of this.map.districts) {
      const unlocked = residents >= d.unlockFollowers;
      this.lockedDistricts.setUnlocked(d.id, unlocked);
      if (this._districtLocked.get(d.id) === unlocked) {
        this._districtLocked.set(d.id, !unlocked);
        for (const slot of this.map.slots) {
          if (slot.districtId === d.id) this._refreshStatus(slot.id);
        }
      }
    }
  }

  update(t) {
    this.ground.userData.trailMat.uniforms.uTime.value = t;
    for (const b of this.buildings.values()) b.update(t);
    this.flyingCars.update(t);
    this.groundTraffic.update(t);
    this.metro.update(t);
    this.skyBridges.update(t);
  }

  // Raycast-pickable meshes: every named building's group (tagged with slotId).
  pickables() {
    const arr = [];
    for (const [slotId, b] of this.buildings) {
      b.group.userData.slotId = slotId;
      arr.push(b.group);
    }
    return arr;
  }
}

function specFromUser(user) {
  const up = user.upgrades || {};
  const baseLevel = 1 + Math.min(9, up.floors || 0);
  return {
    level: baseLevel,
    facade: 'blueGlass',
    neonColor: up.neonColor || 'cyan',
    crown: up.helipad ? 'helipad' : 'spire',
    archetype: 'setback',
    groundItem: up.garden ? 'trees' : (up.billboard ? 'plaza' : null),
    seed: hashId(user.nick),
    nick: user.displayNick,
    premium: {
      hologram: !!up.hologram,
      flyingCar: !!up.flyingCar,
      searchlights: !!up.spotlight,
      goldenNeon: !!up.rainbow,
      flagPole: false,
    },
  };
}

function hashId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// One failing subsystem (e.g. iOS canvas/WebGL memory limits) must not take the whole city down with it.
function safe(name, make) {
  try { return make(); } catch (e) {
    console.error('[CityWorld] ' + name + ' failed:', e);
    return { ready: true, boxes: [], bridgeBoxes: [], update() {}, blocks() { return false; }, setUnlocked() {} };
  }
}
