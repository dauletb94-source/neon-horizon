// Procedural (self-authored, CC0) flying cars on "sky lanes": closed, rounded-rectangle
// circuits that follow the street centre-lines. Streets are building-free by layout; each circuit's altitude is chosen
// so that no lane sample comes near a sky-bridge box or a metro deck/train/pylon (see Metro.clear). Cars are large
// enough to read from the hero camera and carry head/tail lights, a coloured halo and a long neon trail.
// One InstancedMesh per model material keeps it cheap.
import * as THREE from '../vendor/three/three.module.js';
import { roadCenter, NEAR_BLOCKS } from './layout.js';
import { CAR_DEFS, loadCarModel } from './CarModels.js';

const MODELS = [
  { def: CAR_DEFS[0], len: 7.6, w: 2 },
  { def: CAR_DEFS[1], len: 8.4, w: 1 },
  { def: CAR_DEFS[2], len: 9.2, w: 2 },
];
const ALTS = [6, 34, 42, 50, 60, 72, 86];   // metro occupies ~10-31 m; 6 m only on streets without a metro pylon
const CAR_R = 3.3;                           // clearance radius used against sky-bridges / metro

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function trailTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// rounded rectangle polyline centred on (cx,cz) with half-sizes hx,hz and corner radius r, travelled counter-clockwise
function loopPath(cx, cz, hx, hz, r, off) {
  const pts = [], N = 12, HX = hx - off, HZ = hz - off, R = Math.max(2, r - off * 0.3);
  const corner = (ox, oz, a0) => { for (let i = 0; i <= N; i++) { const a = a0 + (i / N) * Math.PI / 2; pts.push([ox + Math.cos(a) * R, oz + Math.sin(a) * R]); } };
  corner(cx + HX - R, cz + HZ - R, 0); corner(cx - HX + R, cz + HZ - R, Math.PI / 2);
  corner(cx - HX + R, cz - HZ + R, Math.PI); corner(cx + HX - R, cz - HZ + R, Math.PI * 1.5);
  pts.push(pts[0]);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
function sample(path, s, out) {
  s = ((s % path.len) + path.len) % path.len;
  let lo = 0, hi = path.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.cum[m] <= s) lo = m; else hi = m; }
  const a = path.pts[lo], b = path.pts[hi], f = (s - path.cum[lo]) / Math.max(1e-6, path.cum[hi] - path.cum[lo]);
  out.x = a[0] + (b[0] - a[0]) * f; out.z = a[1] + (b[1] - a[1]) * f; out.hx = b[0] - a[0]; out.hz = b[1] - a[1];
}

export class FlyingCars {
  /** @param bridgeBoxes AABBs {x0,x1,z0,z1,y0,y1} of every sky-bridge  @param metro Metro (optional) */
  constructor(parent, count, bridgeBoxes = [], metro = null) {
    this.group = new THREE.Group(); this.group.userData.noAudit = true; parent.add(this.group);
    this.cars = []; this.ready = false; this.models = []; this.count = count;
    this.boxes = bridgeBoxes; this.metro = metro;
    this._plan();
    this._load().catch((e) => console.error('FlyingCars load failed', e));
  }

  _altOk(paths, alt) {
    for (const path of paths) for (let s = 0; s < path.len; s += 5) {
      const o = {}; sample(path, s, o);
      if (this.metro && !this.metro.clear(o.x, o.z, alt, CAR_R)) return false;
      for (const b of this.boxes) {
        if (alt + 3 < b.y0 - 1.5 || alt - 1 > b.y1 + 1.5) continue;
        const dx = Math.max(b.x0 - o.x, 0, o.x - b.x1), dz = Math.max(b.z0 - o.z, 0, o.z - b.z1);
        if (dx * dx + dz * dz < (CAR_R + 1.5) ** 2) return false;
      }
    }
    return true;
  }

  _plan() {
    let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    this.loops = [];
    const K = NEAR_BLOCKS;
    for (let i = 0; i < 16; i++) {
      const w = 1 + ((rnd() * 3) | 0), h = 1 + ((rnd() * 3) | 0);
      const k0 = (rnd() * (K + 1 - w)) | 0, j0 = (rnd() * (K + 1 - h)) | 0;
      const x0 = roadCenter(k0), x1 = roadCenter(k0 + w), z0 = roadCenter(j0), z1 = roadCenter(j0 + h);
      const L = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
      L.paths = [1.9, -1.9].map((o) => loopPath(L.cx, L.cz, L.hx, L.hz, 7, o));
      L.alts = ALTS.filter((a) => this._altOk(L.paths, a));
      if (L.alts.length) this.loops.push(L);
    }
    if (!this.loops.length) throw new Error('FlyingCars: no clear sky lane');
  }

  async _load() {
    const loaded = await Promise.all(MODELS.map((m) => loadCarModel(m.def, m.len)));
    const per = MODELS.map((m) => Math.round(this.count * m.w / 5));
    MODELS.forEach((m, mi) => {
      const M = loaded[mi]; if (!M) return;
      const meshes = M.parts.map((p) => { const im = new THREE.InstancedMesh(p.geometry, p.material, per[mi]); im.frustumCulled = false; this.group.add(im); return im; });
      this.models.push({ m, nose: M.def.nose ?? 1, meshes, n: per[mi] });
    });
    const total = this.models.reduce((a, q) => a + q.n, 0);
    const add = (mat) => new THREE.MeshBasicMaterial(Object.assign({ toneMapped: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }, mat));
    this.lightMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), total * 4);
    this.trailMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.7), add({ map: trailTexture() }), total);
    this.trailMesh2 = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.7).rotateX(Math.PI / 2), add({ map: trailTexture() }), total);
    this.haloMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), add({ map: glowTexture() }), total);       // vertical, side-on
    this.haloMesh2 = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), add({ map: glowTexture() }), total); // horizontal, from above
    for (const m of [this.lightMesh, this.trailMesh, this.trailMesh2, this.haloMesh, this.haloMesh2]) { m.frustumCulled = false; this.group.add(m); }
    let id = 0; const col = new THREE.Color(); const trailCols = [0x6ff4ff, 0xff63e6, 0xffd36a, 0x8aa8ff, 0x7dffb0];
    this.models.forEach((M, mi) => {
      for (let i = 0; i < M.n; i++, id++) {
        const loop = this.loops[(id * 7 + mi) % this.loops.length], dir = id % 2;
        const tc = trailCols[id % trailCols.length];
        this.cars.push({ M, i, id, loop, path: loop.paths[dir], dir, alt: loop.alts[(id >> 1) % loop.alts.length], s: Math.random() * loop.paths[dir].len, speed: 9 + Math.random() * 14, ph: Math.random() * 6.28, tc });
        col.setHex(tc);
        this.trailMesh.setColorAt(id, col.clone().multiplyScalar(0.8)); this.trailMesh2.setColorAt(id, col.clone().multiplyScalar(0.8));
        this.haloMesh.setColorAt(id, col.clone().multiplyScalar(0.55)); this.haloMesh2.setColorAt(id, col.clone().multiplyScalar(0.55));
        for (let q = 0; q < 4; q++) this.lightMesh.setColorAt(id * 4 + q, col.setHex(q < 2 ? 0xfff2d0 : 0xff2030).multiplyScalar(q < 2 ? 6 : 4));
      }
    });
    this.ready = true;
  }

  update(t) {
    if (!this.ready) return;
    if (this.frozenT != null) t = this.frozenT; // test hook: lock cars in place for close-up screenshots
    const p = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), lm = new THREE.Matrix4(), lp = new THREE.Vector3();
    const qy = new THREE.Quaternion(), qr = new THREE.Quaternion(), fwd = new THREE.Vector3(1, 0, 0), s1 = new THREE.Vector3();
    for (const c of this.cars) {
      const s = c.s + t * c.speed;
      sample(c.path, c.dir ? c.path.len - s : s, p);
      let hx = p.hx, hz = p.hz; if (c.dir) { hx = -hx; hz = -hz; }
      const yaw = Math.atan2(-hz, hx);
      sample(c.path, (c.dir ? c.path.len - s : s) + (c.dir ? -2 : 2), p); // look-ahead for banking
      const yaw2 = Math.atan2(-(c.dir ? -p.hz : p.hz), c.dir ? -p.hx : p.hx);
      let dy = yaw2 - yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      sample(c.path, c.dir ? c.path.len - s : s, p);
      const y = c.alt + Math.sin(t * 0.7 + c.ph) * 0.4;
      qy.setFromAxisAngle(up, yaw); qr.setFromAxisAngle(fwd, THREE.MathUtils.clamp(dy * 1.5, -0.3, 0.3)); q.copy(qy).multiply(qr);
      pos.set(p.x, y, p.z); m4.compose(pos, q, sc);
      for (const im of c.M.meshes) im.setMatrixAt(c.i, m4);
      const L = c.M.m.len, nz = c.M.nose, hw = L * 0.17;
      [[nz * L * 0.48, 0.55, hw], [nz * L * 0.48, 0.55, -hw], [-nz * L * 0.48, 0.65, hw], [-nz * L * 0.48, 0.65, -hw]].forEach((o, k) => {
        lp.set(o[0], o[1], o[2]).applyMatrix4(m4); lm.makeTranslation(lp.x, lp.y, lp.z); this.lightMesh.setMatrixAt(c.id * 4 + k, lm);
      });
      // neon trail behind the car (horizontal + vertical ribbon) and halos
      const tlen = 3.5 + c.speed * 0.22;
      lp.set(-nz * (L / 2 + tlen / 2), 0.7, 0).applyMatrix4(m4);
      const tq = nz < 0 ? q.clone().multiply(qr.setFromAxisAngle(up, Math.PI)) : q; // gradient runs bright->nose-side
      lm.compose(lp, tq, s1.set(tlen, 1, 1)); this.trailMesh.setMatrixAt(c.id, lm); this.trailMesh2.setMatrixAt(c.id, lm);
      lp.set(0, 0.8, 0).applyMatrix4(m4); lm.compose(lp, qy, s1.set(L * 1.3, L * 0.4, 1)); this.haloMesh.setMatrixAt(c.id, lm);
      lm.compose(lp.set(p.x, y + 0.5, p.z), qy, s1.set(L * 1.2, 1, L * 0.7)); this.haloMesh2.setMatrixAt(c.id, lm);
    }
    for (const M of this.models) for (const im of M.meshes) im.instanceMatrix.needsUpdate = true;
    for (const im of [this.lightMesh, this.trailMesh, this.trailMesh2, this.haloMesh, this.haloMesh2]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
}
