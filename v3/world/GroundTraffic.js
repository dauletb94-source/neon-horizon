// Ground traffic: hundreds of procedural (self-authored CC0) 3D cars driving two-way on every street.
// One InstancedMesh per model material; headlights/taillights are HDR instanced boxes (bloom), and every car carries
// a coloured underglow pool + a forward headlight beam on the asphalt so it reads from the whole-city hero camera.
// Cars run straight along street centre-lines (building-free by layout) in lanes 2 m either side of the centre.
import * as THREE from '../vendor/three/three.module.js';
import { roadCenter, NEAR_BLOCKS, ROAD_W } from './layout.js';
import { CAR_DEFS, loadCarModel } from './CarModels.js';

const LANE = ROAD_W * 0.27;               // lane centre offset from the street centre-line
const K0 = -2, K1 = NEAR_BLOCKS + 1;      // streets driven: k = -2 .. NEAR_BLOCKS+1 on both axes
const GLOWS = [0x38e8ff, 0xff3fd0, 0xffc15a, 0x6f8cff, 0x58ff9c];

function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function beamTexture() { // bright at the car (u=0), fading out ahead (u=1)
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 32);
  const m = g.createLinearGradient(0, 0, 0, 32); // soft edges across the beam
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; void m; return t;
}

export class GroundTraffic {
  /** @param {number} perLane cars per lane on each street (2 lanes x 2 axes x (K1-K0+1) streets) */
  constructor(parent, perLane = 12, { carLen = 7.2 } = {}) {
    this.group = new THREE.Group(); this.group.userData.noAudit = true; parent.add(this.group);
    this.perLane = perLane; this.carLen = carLen; this.cars = []; this.ready = false;
    this.lo = roadCenter(K0 - 1); this.hi = roadCenter(K1 + 1); this.span = this.hi - this.lo;
    this._load().catch((e) => console.error('GroundTraffic load failed', e));
  }

  async _load() {
    const models = (await Promise.all(CAR_DEFS.map((d) => loadCarModel(d, this.carLen)))).filter(Boolean);
    if (!models.length) return;
    // plan: street k, axis, direction, slot
    let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const plan = [];
    for (let k = K0; k <= K1; k++) for (const axis of [0, 1]) for (const dir of [1, -1]) {
      for (let i = 0; i < this.perLane; i++) {
        plan.push({ line: roadCenter(k), axis, dir, lane: dir * LANE, s0: ((i + rnd() * 0.7) / this.perLane) * this.span, speed: 7 + rnd() * 9, mi: Math.floor(rnd() * 2.999) });
      }
    }
    const counts = models.map((_, mi) => plan.filter((p) => (p.mi % models.length) === mi).length);
    this.models = models.map((M, mi) => {
      const meshes = M.parts.map((p) => { const im = new THREE.InstancedMesh(p.geometry, p.material, counts[mi]); im.frustumCulled = false; this.group.add(im); return im; });
      return { M, meshes, n: counts[mi], used: 0 };
    });
    const total = plan.length;
    const light = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    this.lightMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.1, 0.3), light, total * 4);
    const flat = (map, w, h) => new THREE.InstancedMesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }), total);
    this.glowMesh = flat(radialTexture(), this.carLen * 1.9, this.carLen * 1.05);
    this.beamMesh = flat(beamTexture(), 1, 3.2); this.beamMesh.geometry.translate(0.5, 0, 0);
    for (const m of [this.lightMesh, this.glowMesh, this.beamMesh]) { m.frustumCulled = false; this.group.add(m); }
    this.glowMesh.renderOrder = this.beamMesh.renderOrder = 3;

    const col = new THREE.Color();
    plan.forEach((p, id) => {
      const mi = p.mi % models.length, M = this.models[mi];
      const car = Object.assign(p, { id, mi, M, slot: M.used++, nose: M.M.def.nose ?? 1 });
      this.cars.push(car);
      col.setHex(GLOWS[(rnd() * GLOWS.length) | 0]); this.glowMesh.setColorAt(id, col.multiplyScalar(1.0));
      this.beamMesh.setColorAt(id, col.setHex(0xfff1cf).multiplyScalar(0.3));
      for (let q = 0; q < 4; q++) this.lightMesh.setColorAt(id * 4 + q, col.setHex(q < 2 ? 0xfff6dd : 0xff1c2c).multiplyScalar(q < 2 ? 6 : 4));
    });
    this.ready = true;
  }

  update(t) {
    if (!this.ready) return;
    if (this.frozenT != null) t = this.frozenT;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const lm = new THREE.Matrix4(), lp = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), bs = new THREE.Vector3(9, 1, 1);
    const L = this.carLen, hw = L * 0.19; // light half-spacing across the car
    for (const c of this.cars) {
      const s = (((c.s0 + c.dir * t * c.speed) % this.span) + this.span) % this.span;
      const a = c.dir > 0 ? this.lo + s : this.hi - s;
      const x = c.axis === 0 ? a : c.line + c.lane, z = c.axis === 0 ? c.line + c.lane : a;
      // +x of the baked model is the nose; travelling +x (axis 0, dir +1) -> yaw 0
      const yaw = c.axis === 0 ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      q.setFromAxisAngle(up, yaw); pos.set(x, 0.12, z); m4.compose(pos, q, sc);
      for (const im of c.M.meshes) im.setMatrixAt(c.slot, m4);
      const nz = c.nose;
      [[nz * L * 0.47, 0.62, hw], [nz * L * 0.47, 0.62, -hw], [-nz * L * 0.48, 0.7, hw], [-nz * L * 0.48, 0.7, -hw]].forEach((o, k) => {
        lp.set(o[0], o[1], o[2]).applyMatrix4(m4); lm.compose(lp, q, one); this.lightMesh.setMatrixAt(c.id * 4 + k, lm);
      });
      lp.set(0, 0.2, 0).applyMatrix4(m4); lm.compose(lp, q, one); this.glowMesh.setMatrixAt(c.id, lm);
      lp.set(nz * L * 0.5, 0.2, 0).applyMatrix4(m4); q.setFromAxisAngle(up, yaw + (nz < 0 ? Math.PI : 0));
      lm.compose(lp, q, bs.set(9 + c.speed * 0.4, 1, 1)); this.beamMesh.setMatrixAt(c.id, lm);
    }
    for (const M of this.models) for (const im of M.meshes) im.instanceMatrix.needsUpdate = true;
    for (const im of [this.lightMesh, this.glowMesh, this.beamMesh]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
}
