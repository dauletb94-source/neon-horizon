// Building entity: assembles a full tower (podium + shaft + crown + neon trim + rooftop/ground items)
// from a data spec, so upgrades visibly change the model. Rebuild-on-change rather than mutate-in-place.
import * as THREE from '../vendor/three/three.module.js';
import { buildGroundItem, ARCHETYPES, CROWN_KINDS } from './buildingParts.js';
import { instantiate, KINDS, FACADE_SKIN } from '../engine/towers.js';
import { instantiateReal, realModels, REAL_COUNT } from '../engine/realTowers.js';
import { neonMaterial, neonColorHex, podiumMaterial } from '../engine/materials.js';
import { NEAR_CAP, CELL } from '../world/layout.js';

// World-unit (stylized, not literal meters) height per GDD height level 1-10.
export const WORLD_HEIGHT_BY_LEVEL = [0, 8, 14, 21, 30, 40, 51, 63, 76, 90, 105];
// Real "meters" shown in UI value/economy text, per GDD.
export const METERS_BY_LEVEL = [0, 50, 80, 120, 180, 260, 360, 500, 700, 950, 1300];

function hash(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function defaultSpecForSlot(slotId) {
  const h = hash(slotId);
  const level = 1 + (h % 6); // demo city: levels 1-6 for ambient buildings
  return {
    level,
    facade: ['blueGlass', 'smokedGlass', 'chrome', 'blackSteel', 'whiteCeramic'][h % 5],
    neonColor: ['cyan', 'magenta', 'blue', 'violet', 'amber', 'green'][(h >> 3) % 6],
    crown: CROWN_KINDS[(h >> 6) % CROWN_KINDS.length],
    archetype: ARCHETYPES[(h >> 9) % ARCHETYPES.length],
    groundItem: ['plaza', 'fountain', 'trees', null][(h >> 12) % 4],
    seed: h,
    premium: {},
  };
}

export class Building {
  constructor(id, position, cap = NEAR_CAP) {
    this.id = id;
    this.cap = cap; // max footprint: the building must fit inside its plot
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.spec = null;
    this.topY = 0;
    this.footprint = { w: 8, d: 8 };
    this._anim = [];
  }

  dispose() {
    const tower = this.tower;
    this.group.traverse((o) => {
      for (let p = o; p; p = p.parent) if (p === tower) return; // shared cached geometry/materials
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.tower = null;
    this._scaffold = null;
    this._scaffoldStatic = null;
    this._lockFrame = null;
  }

  rebuild(spec) {
    this.dispose();
    this.spec = spec;
    const seed = spec.seed ?? hash(this.id);
    const totalH = WORLD_HEIGHT_BY_LEVEL[spec.level] || WORLD_HEIGHT_BY_LEVEL[1];
    // glTF tower model (assets/models). Helipad upgrade selects the helipad-crown model.
    const useReal = realModels.length > 0;
    const kind = spec.crown === 'helipad' ? 6 : seed % KINDS;
    const tower = useReal
      ? instantiateReal((seed >> 3) % REAL_COUNT, Math.max(totalH, 22), { maxFoot: this.cap, neon: spec.neonColor })
      : instantiate(kind, totalH, { skin: FACADE_SKIN[spec.facade] ?? 0, neon: spec.neonColor, maxFoot: this.cap });
    tower.rotation.y = ((seed >> 5) % 4) * (Math.PI / 2);
    this.group.add(tower);
    this.tower = tower;
    const fp = tower.userData.footprint;
    const width = fp.w / 1.4, depth = fp.d / 1.4; // inner shaft ~ podium/1.38
    this.footprint = { w: fp.w, d: fp.d };
    this.topY = tower.userData.height + 6;
    if (useReal && (seed % 3) !== 0) { // rectangular roof garden with neon rim (never a disc), like city.jpg
      const gw = fp.w * 0.34, gd = fp.d * 0.34, top = tower.userData.height;
      const gm = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.5, gd), materialForGarden());
      gm.position.set(0, top + 0.25, 0); gm.userData.slot = 'garden'; this.group.add(gm);
      const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(gw * 1.12, 0.6, gd * 1.12)), new THREE.LineBasicMaterial({ color: new THREE.Color(neonColorHex(spec.neonColor)).multiplyScalar(1.5), toneMapped: false }));
      rim.position.copy(gm.position); rim.userData.slot = 'neon'; this.group.add(rim);
    }
    const podiumH = 1.8;
    const shaft = { userData: { topY: tower.userData.height } };

    if (spec.groundItem) {
      // small ground feature tucked into a corner of the plot's sidewalk ring: it must stay inside the plot (never on the road)
      const gi = buildGroundItem(spec.groundItem, 1.3, seed);
      const corner = ((seed >> 2) % 4) * (Math.PI / 2) + Math.PI / 4;
      const half = CELL / 2 - 1.6; // fountain radius 1.5 -> stays inside the plot cell
      gi.position.set(Math.sign(Math.cos(corner)) * half, podiumH, Math.sign(Math.sin(corner)) * half);
      this.group.add(gi);
    }

    this._anim = [];
    if (spec.premium?.hologram) this._addHologram(width, depth, shaft.userData.topY, spec);
    if (spec.premium?.flyingCar) this._addOrbitingCar(width, depth, shaft.userData.topY * 0.6);
    if (spec.premium?.searchlights) this._addSearchlights(width, depth, podiumH);
    if (spec.premium?.goldenNeon) this._tintNeonGold();
    if (spec.premium?.flagPole) this._addFlagPole(width, depth, podiumH);

    return this;
  }

  _addHologram(width, depth, topY, spec) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, 512, 128);
    ctx.font = 'bold 72px sans-serif';
    ctx.fillStyle = neonColorHex(spec.neonColor);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = neonColorHex(spec.neonColor);
    ctx.shadowBlur = 24;
    ctx.fillText((spec.hologramText || spec.nick || 'NEON').toUpperCase().slice(0, 10), 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.4, width * 0.35), mat);
    plane.position.set(0, topY + 2.2, depth * 0.9);
    this.group.add(plane);
    this._anim.push((t) => { plane.lookAt(plane.getWorldPosition(new THREE.Vector3()).setY(0).add(new THREE.Vector3(0, 0, 100))); });
  }

  _addOrbitingCar(width, depth, baseY) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.7), new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.8, roughness: 0.2 }));
    car.add(body);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.75), neonMaterial('cyan'));
    glow.position.y = -0.22; car.add(glow);
    this.group.add(car);
    const radius = Math.max(width, depth) * 1.3;
    this._anim.push((t) => {
      const a = t * 0.4;
      car.position.set(Math.cos(a) * radius, baseY + 3, Math.sin(a) * radius);
      car.rotation.y = -a + Math.PI / 2;
    });
  }

  _addSearchlights(width, depth, baseY) {
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.4, 14, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.set(side * width * 0.5, baseY + 7, side * depth * 0.5);
      beam.rotation.x = Math.PI;
      this.group.add(beam);
      this._anim.push((t) => { beam.rotation.y = t * 0.6 * side; });
    }
  }

  _tintNeonGold() {
    this.group.traverse((o) => { if (o.userData.slot === 'neon') o.material = neonMaterial('gold'); });
  }

  _addFlagPole(width, depth, baseY) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), new THREE.MeshStandardMaterial({ color: 0x222 }));
    pole.position.set(width * 0.6, baseY + 3, depth * 0.6);
    this.group.add(pole);
  }

  update(t) {
    for (const fn of this._anim) fn(t);
    if (this._scaffold) this._scaffold.rotation.y = t * 0.6;
  }

  // -------- status FX: remodeling scaffold (pending), dim (unfollowed/locked) --------
  setStatus(status) {
    this._setScaffold(status === 'pending');
    this._setDim(status === 'unfollowed' || status === 'locked');
  }

  _setScaffold(on) {
    if (on && this._scaffold) return;
    if (!on) {
      if (this._scaffold) { this.group.remove(this._scaffold); this._scaffold = null; }
      return;
    }
    const g = new THREE.Group();
    const h = Math.max(this.topY, 6);
    const w = this.footprint.w, d = this.footprint.d;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.6, roughness: 0.5 });
    const corners = [[w / 2, d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]];
    for (const [cx, cz] of corners) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h, 6), poleMat);
      pole.position.set(cx * 1.08, h / 2, cz * 1.08);
      g.add(pole);
    }
    const rungCount = Math.max(2, Math.round(h / 3.5));
    for (let i = 0; i < rungCount; i++) {
      const y = (i + 0.5) * (h / rungCount);
      for (let s = 0; s < 4; s++) {
        const a = corners[s], b = corners[(s + 1) % 4];
        const mx = (a[0] + b[0]) / 2 * 1.08, mz = (a[1] + b[1]) / 2 * 1.08;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.08;
        const rung = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), poleMat);
        rung.position.set(mx, y, mz);
        rung.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
        g.add(rung);
      }
    }
    // small crane arm on top; `this._scaffold` (the rotating head) is spun by update()
    const crane = new THREE.Group();
    crane.position.y = h;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), poleMat);
    mast.position.y = 1.5;
    crane.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 0.12), poleMat);
    arm.position.set(1.6, 3, 0);
    crane.add(arm);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), neonMaterial('amber'));
    beacon.position.set(0, 3.3, 0);
    crane.add(beacon);
    g.add(crane);
    this.group.add(g);
    this._scaffoldStatic = g;
    this._scaffold = crane; // rotated slowly in update()
  }

  // Locked / unfollowed: the real tower stays visible but goes cold and dark (smoked glass, no neon, no lit
  // windows) with a thin amber hologram frame. No slab covering the model.
  _setDim(on) {
    if (this.tower) {
      for (const m of this.tower.children) {
        if (m.userData.slot !== 'glass' && m.userData.slot !== 'glow') continue;
        if (!m.userData.origMat) m.userData.origMat = m.material;
        m.material = on ? lockedGlass(m.userData.origMat) : m.userData.origMat;
      }
    }
    if (on && !this._lockFrame && this.tower) {
      const w = this.footprint.w, d = this.footprint.d, h = Math.max(this.topY, 4);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 1.02, h, d * 1.02)),
        new THREE.LineBasicMaterial({ color: 0xffa14a, transparent: true, opacity: 0.04, depthWrite: false }));
      frame.position.y = h / 2;
      this.group.add(frame);
      this._lockFrame = frame;
    }
    if (this._lockFrame) this._lockFrame.visible = on;
    this.group.traverse((o) => {
      if (o.material && o.material.isMeshBasicMaterial) o.visible = !on;
    });
  }
}

const _lockedCache = new Map();
function lockedGlass(src) {
  if (_lockedCache.has(src)) return _lockedCache.get(src);
  const m = src.clone();
  m.color = new THREE.Color(0x5a6684);
  m.emissive = new THREE.Color(0x4a5b80);
  m.emissiveIntensity = 0.3;
  m.envMapIntensity = 0.9;
  _lockedCache.set(src, m);
  return m;
}

let _gardenMat;
function materialForGarden() {
  return _gardenMat || (_gardenMat = new THREE.MeshStandardMaterial({ color: 0x2c8a45, roughness: 0.95, emissive: 0x137a38, emissiveIntensity: 1.1 }));
}
