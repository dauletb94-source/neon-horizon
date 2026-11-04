// Realistic flying cars (CC-BY Sketchfab models, see assets/CREDITS.md) on "sky lanes": closed, rounded-rectangle
// circuits that follow the street centre-lines. Streets are building-free by layout, and each circuit's altitude is
// chosen clear of every sky-bridge crossing its streets, so cars never touch a tower. One InstancedMesh per model
// sub-mesh keeps it cheap; head/tail lights and neon trails are additive instanced quads/spheres (bloom picks them up).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { roadCenter, NEAR_BLOCKS } from './layout.js';

const MODELS = [
  { file: 'quadra.glb', len: 5.2, yaw: Math.PI / 2, w: 3, lights: [[2.6, 0.5, 0.9], [2.6, 0.5, -0.9]], tails: [[-2.6, 0.7, 0.9], [-2.6, 0.7, -0.9]] },
  { file: 'molnia.glb', len: 8.5, yaw: Math.PI, w: 2, lights: [[-4.2, 0.5, 0.35], [-4.2, 0.5, -0.35]], tails: [[4.2, 0.6, 0.5], [4.2, 0.6, -0.5]] },
];
const ALTS = [9, 14, 20, 27, 35, 44, 54, 66, 80];

function trailTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 8);
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
  constructor(parent, count, bridgeSpans = []) {
    this.group = new THREE.Group(); this.group.userData.noAudit = true; parent.add(this.group);
    this.cars = []; this.ready = false;
    this.models = []; this.count = count;
    this.bridges = bridgeSpans;
    this._plan();
    this._load().catch((e) => console.error("FlyingCars load failed", e));
  }

  _clearAlt(edges) { // altitudes with >=5 m clearance from every sky-bridge that crosses one of the circuit's streets
    const ok = ALTS.filter((a) => !this.bridges.some((b) => edges.some((e) => e.along !== b.along && Math.abs(e.line - b.line) < 7) && a > b.y - 5 && a < b.y + b.bh + 5));
    return ok.length ? ok : [ALTS[ALTS.length - 1]];
  }

  _plan() {
    let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    this.loops = [];
    const K = NEAR_BLOCKS;
    for (let i = 0; i < 11; i++) {
      const w = 1 + ((rnd() * 3) | 0), h = 1 + ((rnd() * 3) | 0);
      const k0 = (rnd() * (K + 1 - w)) | 0, j0 = (rnd() * (K + 1 - h)) | 0;
      const x0 = roadCenter(k0), x1 = roadCenter(k0 + w), z0 = roadCenter(j0), z1 = roadCenter(j0 + h);
      // edges: x=x0,x1 run along z; z=z0,z1 run along x  (`along` = the axis the lane travels on)
      const edges = [{ along: 'z', line: x0 }, { along: 'z', line: x1 }, { along: 'x', line: z0 }, { along: 'x', line: z1 }];
      this.loops.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, alts: this._clearAlt(edges) });
    }
    for (const L of this.loops) { L.paths = [1.7, -1.7].map((o) => loopPath(L.cx, L.cz, L.hx, L.hz, 7, o)); }
  }

  async _load() {
    const loader = new GLTFLoader();
    const up = new THREE.Vector3(0, 1, 0);
    const per = MODELS.map((m) => Math.round(this.count * m.w / 5));
    const trailTex = trailTexture();
    const gltfs = await Promise.all(MODELS.map((def) => new Promise((res) => loader.load('assets/models/cars/' + def.file, res, undefined, () => res(null)))));
    for (let mi = 0; mi < MODELS.length; mi++) {
      const def = MODELS[mi], gltf = gltfs[mi];
      if (!gltf) continue;
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = def.len / Math.max(sz.x, sz.z);
      const T = new THREE.Matrix4().makeRotationY(def.yaw).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
      const meshes = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(T);
        const m = o.material.clone(); m.envMapIntensity = 2.0; m.transmission = 0; m.transparent = !!o.material.transparent;
        if (m.emissive && m.emissiveMap) m.emissiveIntensity = 1.6;
        const im = new THREE.InstancedMesh(g, m, per[mi]); im.frustumCulled = false; this.group.add(im); meshes.push(im);
      });
      this.models.push({ def, meshes, n: per[mi], k });
    }
    const total = this.models.reduce((a, m) => a + m.n, 0);
    // lights (4 per car) + trail (1 per car)
    this.lightMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), total * 4);
    this.trailMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ map: trailTex, color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), total);
    for (const m of [this.lightMesh, this.trailMesh]) { m.frustumCulled = false; this.group.add(m); }
    let id = 0; const col = new THREE.Color(); const trailCols = [0x7ef9ff, 0xff7ef0, 0xffd36a, 0x8aa8ff];
    this.models.forEach((M, mi) => {
      for (let i = 0; i < M.n; i++, id++) {
        const loop = this.loops[(id * 7 + mi) % this.loops.length], dir = id % 2;
        const tc = trailCols[id % 4];
        this.cars.push({ M, i, id, loop, path: loop.paths[dir], dir, alt: loop.alts[(id >> 1) % loop.alts.length], s: Math.random() * loop.paths[dir].len, speed: 9 + Math.random() * 14, ph: Math.random() * 6.28, tc });
        col.setHex(tc).multiplyScalar(1.7); this.trailMesh.setColorAt(id, col);
        for (let q = 0; q < 4; q++) this.lightMesh.setColorAt(id * 4 + q, col.setHex(q < 2 ? 0xfff2d0 : 0xff2030).multiplyScalar(3));
      }
    });
    this.ready = true; void up;
  }

  update(t) {
    if (!this.ready) return;
    if (this.frozenT != null) t = this.frozenT; // test hook: lock cars in place for close-up screenshots
    const p = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), lm = new THREE.Matrix4(), lp = new THREE.Vector3();
    const qy = new THREE.Quaternion(), qr = new THREE.Quaternion(), fwd = new THREE.Vector3(1, 0, 0);
    for (const c of this.cars) {
      const s = c.s + t * c.speed * (c.dir ? 1 : 1);
      sample(c.path, c.dir ? c.path.len - s : s, p);
      // path is CCW; for the second lane we travel it in reverse, so flip the tangent
      let hx = p.hx, hz = p.hz; if (c.dir) { hx = -hx; hz = -hz; }
      const yaw = Math.atan2(-hz, hx);
      sample(c.path, (c.dir ? c.path.len - s : s) + (c.dir ? -2 : 2), p); // look-ahead for banking
      const yaw2 = Math.atan2(-(c.dir ? -p.hz : p.hz), c.dir ? -p.hx : p.hx);
      let dy = yaw2 - yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      sample(c.path, c.dir ? c.path.len - s : s, p);
      const y = c.alt + Math.sin(t * 0.7 + c.ph) * 0.5;
      qy.setFromAxisAngle(up, yaw); qr.setFromAxisAngle(fwd, THREE.MathUtils.clamp(dy * 1.5, -0.35, 0.35)); q.copy(qy).multiply(qr);
      pos.set(p.x, y, p.z); m4.compose(pos, q, sc);
      for (const im of c.M.meshes) im.setMatrixAt(c.i, m4);
      const L = c.M.def;
      [...L.lights, ...L.tails].forEach((o, k) => { lp.set(o[0], o[1], o[2]).applyMatrix4(m4); lm.makeTranslation(lp.x, lp.y, lp.z); this.lightMesh.setMatrixAt(c.id * 4 + k, lm); });
      // neon trail behind the car
      const tlen = 7 + c.speed * 0.5; lp.set(-L.len / 2 - tlen / 2 + (L.file === 'molnia.glb' ? L.len : 0) * 0, 0.6, 0);
      const rear = L.file === 'molnia.glb' ? 1 : -1; lp.set(rear * (L.len / 2 + tlen / 2), 0.6, 0).applyMatrix4(m4);
      lm.compose(lp, q, new THREE.Vector3(tlen, 1, 1)); this.trailMesh.setMatrixAt(c.id, lm);
    }
    for (const M of this.models) for (const im of M.meshes) im.instanceMatrix.needsUpdate = true;
    this.lightMesh.instanceMatrix.needsUpdate = true; this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.lightMesh.instanceColor) this.lightMesh.instanceColor.needsUpdate = true; if (this.trailMesh.instanceColor) this.trailMesh.instanceColor.needsUpdate = true;
  }
}
