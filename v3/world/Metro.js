// Futuristic elevated metro: three closed lines on dark steel decks with glowing rails, carried on slim pylons that stand
// in the street median (mid-block, never in intersections), neon-lit articulated trains, and glass-canopied stations.
// Lines follow street centre-lines (building-free by layout) with rounded corners that stay inside the intersection;
// each line has its own altitude so lines cross over one another. Sky-bridges that would clip a line are skipped via
// `blocks(box)` (FillerField / SkyBridges ask before building), and `clear(x,z,y,r)` lets flying cars avoid it.
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { roadCenter, PERIOD } from './layout.js';

export const METRO_LINES = [
  { name: 'A', alt: 12, xs: [1, 4], zs: [1, 5], color: 0x33e6ff, trains: 3, rev: false },
  { name: 'B', alt: 19, xs: [2, 5], zs: [0, 3], color: 0xff3fd0, trains: 3, rev: true },
  { name: 'C', alt: 26, xs: [0, 6], zs: [2, 6], color: 0xffc15a, trains: 2, rev: false },
];
const R = 9;            // corner radius (arc stays inside the intersection square)
const DECK_HW = 2.0;    // deck half-width
const CAR_L = 9.6, CAR_W = 2.8, GAP = 0.35, CARS = 5;
const STATION_L = 28, PYLON_FR = [0.14, 0.5, 0.86];

function roundedLoop(x0, x1, z0, z1, rev) {
  const pts = [], N = 16, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const corner = (ox, oz, a0) => { for (let i = 0; i <= N; i++) { const a = a0 + (i / N) * Math.PI / 2; pts.push([ox + Math.cos(a) * R, oz + Math.sin(a) * R]); } };
  corner(cx + hx - R, cz + hz - R, 0); corner(cx - hx + R, cz + hz - R, Math.PI / 2);
  corner(cx - hx + R, cz - hz + R, Math.PI); corner(cx + hx - R, cz - hz + R, Math.PI * 1.5);
  pts.push([pts[0][0], pts[0][1]]);
  if (rev) pts.reverse();
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
function sample(path, s, out) {
  s = ((s % path.len) + path.len) % path.len;
  let lo = 0, hi = path.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.cum[m] <= s) lo = m; else hi = m; }
  const a = path.pts[lo], b = path.pts[hi], d = Math.max(1e-6, path.cum[hi] - path.cum[lo]), f = (s - path.cum[lo]) / d;
  out.x = a[0] + (b[0] - a[0]) * f; out.z = a[1] + (b[1] - a[1]) * f; out.tx = (b[0] - a[0]) / d; out.tz = (b[1] - a[1]) / d; return out;
}

// sweep a rectangular cross-section (centre offset xoff, half-width hw, y0..y1) along a polyline -> BufferGeometry
function sweepBox(pts, hw, y0, y1, xoff = 0) {
  const P = [], Nn = [], I = [], n = pts.length, closed = pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1];
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n - 1) % (n - 1) : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % (n - 1) : Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = tz, nz = -tx; // lateral
    ring.push({ x: pts[i][0], z: pts[i][1], nx, nz });
  }
  const face = (fn) => { // fn(r) -> [[pos],[pos]] and a normal fn
    const base = P.length / 3;
    for (const r of ring) { const [p0, p1, nrm] = fn(r); P.push(...p0, ...p1); Nn.push(...nrm, ...nrm); }
    for (let i = 0; i < n - 1; i++) { const q = base + i * 2; I.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  };
  const L = (r, y) => [r.x + r.nx * (xoff + hw), y, r.z + r.nz * (xoff + hw)], Rr = (r, y) => [r.x + r.nx * (xoff - hw), y, r.z + r.nz * (xoff - hw)];
  face((r) => [L(r, y1), Rr(r, y1), [0, 1, 0]]);
  face((r) => [Rr(r, y0), L(r, y0), [0, -1, 0]]);
  face((r) => [L(r, y0), L(r, y1), [r.nx, 0, r.nz]]);
  face((r) => [Rr(r, y1), Rr(r, y0), [-r.nx, 0, -r.nz]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2)); g.setIndex(I); return g;
}
function box(cx, cy, cz, sx, sy, sz, rotY = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateY(rotY); g.translate(cx, cy, cz); return g.toNonIndexed();
}
function signTexture(letter, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#04101e'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(5, 5, 502, 118);
  g.fillStyle = color; g.beginPath(); g.arc(70, 64, 40, 0, 7); g.fill();
  g.fillStyle = '#04101e'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 70, 68);
  g.fillStyle = '#ffffff'; g.font = 'bold 62px sans-serif'; g.textAlign = 'left'; g.fillText('METRO', 140, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function carShape(kind) { // side profile in (x = length, y = height); kind: 'mid' | 'head' (nose at +x)
  const h = CAR_L / 2, s = new THREE.Shape();
  if (kind === 'mid') s.setFromPoints([[-h, 0.3], [h, 0.3], [h, 2.95], [h - 0.4, 3.25], [-h + 0.4, 3.25], [-h, 2.95]].map((p) => new THREE.Vector2(...p)));
  else s.setFromPoints([[-h, 0.3], [h - 0.5, 0.3], [h, 0.9], [h, 1.7], [h - 2.8, 3.25], [-h + 0.4, 3.25], [-h, 2.95]].map((p) => new THREE.Vector2(...p)));
  return s;
}
function carGeometry(kind) { const g = new THREE.ExtrudeGeometry(carShape(kind), { depth: CAR_W, bevelEnabled: false }); g.translate(0, 0, -CAR_W / 2); return g; }

export class Metro {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.userData.noAudit = true; parent.add(this.group);
    this.lines = []; this.pylons = []; this.stations = []; this.trains = []; this._last = null;
    for (const L of METRO_LINES) this._buildLine(L);
    this._buildTrains();
  }

  _buildLine(L) {
    const x0 = roadCenter(L.xs[0]), x1 = roadCenter(L.xs[1]), z0 = roadCenter(L.zs[0]), z1 = roadCenter(L.zs[1]);
    const path = roundedLoop(x0, x1, z0, z1, L.rev), alt = L.alt, col = new THREE.Color(L.color);
    const line = { ...L, path, stations: [], samples: [] };
    this.lines.push(line);
    // collision samples every ~4 m
    const o = {}; for (let s = 0; s < path.len; s += 4) { sample(path, s, o); line.samples.push([o.x, o.z]); }

    // ---- deck (dark steel), glowing rails, underglow ----
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x10172a, metalness: 0.55, roughness: 0.4, envMapIntensity: 0.9, side: THREE.DoubleSide });
    const neon = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.6), toneMapped: false, side: THREE.DoubleSide, fog: true });
    const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe9ff).multiplyScalar(1.6), toneMapped: false, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(sweepBox(path.pts, DECK_HW, alt - 1.0, alt, 0), deckMat));
    this.group.add(new THREE.Mesh(mergeGeometries([sweepBox(path.pts, 0.13, alt, alt + 0.28, DECK_HW - 0.2), sweepBox(path.pts, 0.13, alt, alt + 0.28, -(DECK_HW - 0.2))]), neon));
    this.group.add(new THREE.Mesh(mergeGeometries([sweepBox(path.pts, 0.07, alt + 0.02, alt + 0.1, 0.75), sweepBox(path.pts, 0.07, alt + 0.02, alt + 0.1, -0.75)]), white));
    this.group.add(new THREE.Mesh(sweepBox(path.pts, 0.5, alt - 1.06, alt - 0.96, 0), neon));

    // ---- stations: one per long edge, centred mid-block ----
    const edges = [], P = path.pts;
    // find straight runs: consecutive vertices > 20 m apart
    for (let i = 0; i < P.length - 1; i++) {
      const d = path.cum[i + 1] - path.cum[i]; if (d > 40) edges.push({ i, a: P[i], b: P[i + 1], len: d, s0: path.cum[i] });
    }
    const stGeo = [], canopyGeo = [], postGeo = [], edgeGeo = [], pyl = [];
    for (const e of edges) {
      const dx = (e.b[0] - e.a[0]) / e.len, dz = (e.b[1] - e.a[1]) / e.len, yaw = Math.atan2(-dz, dx);
      const alongX = Math.abs(dx) > 0.5, a0 = alongX ? e.a[0] : e.a[1], dir = alongX ? Math.sign(dx) : Math.sign(dz);
      // block-mid coordinates along this edge (street centres at roadCenter(k), blocks between them)
      const mids = []; const kmin = Math.round(Math.min(a0, alongX ? e.b[0] : e.b[1])), kmaxv = Math.max(a0, alongX ? e.b[0] : e.b[1]);
      void kmin; for (let k = -2; k < 9; k++) { const m = roadCenter(k) + PERIOD / 2; if (m > Math.min(a0, alongX ? e.b[0] : e.b[1]) + R + 6 && m < kmaxv - R - 6) mids.push(m); }
      const pos = (c) => alongX ? [c, e.a[1]] : [e.a[0], c];
      const sOf = (c) => e.s0 + Math.abs(c - a0);
      mids.forEach((m, mi) => {
        const isStation = mi === (mids.length >> 1);
        if (isStation) {
          const [px, pz] = pos(m); line.stations.push({ s: sOf(m), x: px, z: pz });
          const lo = pos(m - STATION_L / 2), hi = pos(m + STATION_L / 2), seg = [lo, hi];
          stGeo.push(sweepBox(seg, 3.4, alt - 1.0, alt + 0.14, 0));
          canopyGeo.push(sweepBox(seg, 3.3, alt + 4.3, alt + 4.6, 0));
          edgeGeo.push(sweepBox(seg, 0.1, alt + 0.14, alt + 0.2, 3.1), sweepBox(seg, 0.1, alt + 0.14, alt + 0.2, -3.1), sweepBox(seg, 0.12, alt + 4.6, alt + 4.7, 3.3), sweepBox(seg, 0.12, alt + 4.6, alt + 4.7, -3.3));
          for (let q = 0; q <= 4; q++) for (const sd of [-3.0, 3.0]) {
            const c = m - STATION_L / 2 + 1.5 + (q * (STATION_L - 3)) / 4;
            const [qx, qz] = pos(c); const lx = alongX ? qx : qx + sd, lz = alongX ? qz + sd : qz;
            postGeo.push(box(lx, alt + 2.3, lz, 0.2, 4.3, 0.2));
          }
          // sign boards (one each side, facing out), above the canopy
          const sgn = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: signTexture(L.name, '#' + col.getHexString()), toneMapped: false, fog: true }));
          for (const sd of [-1, 1]) {
            const m2 = sgn.clone(); m2.position.set(px, alt + 6.2, pz); m2.rotation.y = alongX ? (sd > 0 ? 0 : Math.PI) : (sd > 0 ? -Math.PI / 2 : Math.PI / 2);
            m2.position.x += alongX ? 0 : sd * 0.05; m2.position.z += alongX ? sd * 0.05 : 0; this.group.add(m2);
          }
          void yaw;
        }
        for (const f of PYLON_FR) { // pylons relative to this block
          const c = m - PERIOD / 2 + f * PERIOD, [qx, qz] = pos(c);
          if (c < Math.min(a0, alongX ? e.b[0] : e.b[1]) + R + 4 || c > kmaxv - R - 4) continue;
          pyl.push({ x: qx, z: qz, yaw: alongX ? 0 : Math.PI / 2 });
        }
      });
    }
    line.stations.sort((a, b) => a.s - b.s);
    this.stations.push(...line.stations.map((s) => ({ ...s, line: L.name, alt })));
    if (stGeo.length) {
      this.group.add(new THREE.Mesh(mergeGeometries(stGeo), new THREE.MeshStandardMaterial({ color: 0x3a4766, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide })));
      this.group.add(new THREE.Mesh(mergeGeometries(canopyGeo), new THREE.MeshStandardMaterial({ color: 0x0c2a44, metalness: 0.9, roughness: 0.15, envMapIntensity: 2, transparent: true, opacity: 0.72, side: THREE.DoubleSide })));
      this.group.add(new THREE.Mesh(mergeGeometries(postGeo), deckMat));
      this.group.add(new THREE.Mesh(mergeGeometries(edgeGeo), neon));
    }

    // ---- pylons: shaft + crossbeam + neon seam, instanced ----
    const n = pyl.length;
    const shaft = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1, 0.8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x1b2236, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.2 }), n);
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: 0x232c44, metalness: 0.75, roughness: 0.35, envMapIntensity: 1.3 }), n);
    const seam = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0), neon, n * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
    pyl.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(v.set(p.x, 0, p.z), q, sc.set(1, alt - 1.5, 1)); shaft.setMatrixAt(i, m4);
      m4.compose(v.set(p.x, alt - 1.25, p.z), q, sc.set(1, 1, 1)); cap.setMatrixAt(i, m4);
      for (let k = 0; k < 2; k++) {
        const off = k ? 0.4 : -0.4; // seam on the two track-facing faces
        const ox = p.yaw === 0 ? 0 : off, oz = p.yaw === 0 ? off : 0;
        m4.compose(v.set(p.x + ox, 0.2, p.z + oz), new THREE.Quaternion(), sc.set(1, alt - 1.8, 1)); seam.setMatrixAt(i * 2 + k, m4);
      }
      this.pylons.push({ x: p.x, z: p.z, top: alt - 1.0 });
    });
    for (const m of [shaft, cap, seam]) { m.frustumCulled = false; this.group.add(m); }
  }

  _buildTrains() {
    const nTrains = this.lines.reduce((a, l) => a + l.trains, 0), nCars = nTrains * CARS, nMid = nTrains * (CARS - 2), nEnd = nTrains * 2;
    const body = new THREE.MeshStandardMaterial({ color: 0x56637f, metalness: 0.7, roughness: 0.3, envMapIntensity: 0.8 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8f2ff).multiplyScalar(2.0), toneMapped: false });
    const stripM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const lightM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const bandEnd = new THREE.BoxGeometry(CAR_L - 4.4, 0.95, CAR_W + 0.06).translate(-1.5, 2.05, 0), bandMid = new THREE.BoxGeometry(CAR_L - 1.2, 0.95, CAR_W + 0.06).translate(0, 2.05, 0);
    this.tm = {
      mid: new THREE.InstancedMesh(carGeometry('mid'), body, nMid), end: new THREE.InstancedMesh(carGeometry('head'), body, nEnd),
      bandMid: new THREE.InstancedMesh(bandMid, glow, nMid), bandEnd: new THREE.InstancedMesh(bandEnd, glow, nEnd),
      strip: new THREE.InstancedMesh(new THREE.BoxGeometry(CAR_L - 0.5, 0.16, CAR_W + 0.08).translate(0, 0.62, 0), stripM, nCars),
      light: new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.35, 0.7), lightM, nEnd * 2),
    };
    for (const m of Object.values(this.tm)) { m.frustumCulled = false; this.group.add(m); }
    const c = new THREE.Color(); let ci = 0, ei = 0, mi = 0;
    this.lines.forEach((line, li) => {
      const spacing = line.path.len / line.trains;
      for (let t = 0; t < line.trains; t++) {
        const train = { line, li, head: t * spacing + 40, speed: 0, dwell: 0, next: 0, cars: [], len: CARS * CAR_L + (CARS - 1) * GAP, stopped: -1 };
        // next station ahead of the head
        train.next = Math.max(0, line.stations.findIndex((s) => s.s >= train.head - train.len / 2)); if (train.next < 0) train.next = 0;
        for (let k = 0; k < CARS; k++) {
          const end = k === 0 || k === CARS - 1, car = { k, end, tail: k === CARS - 1, ci: ci++, slot: end ? ei++ : mi++ };
          train.cars.push(car);
          this.tm.strip.setColorAt(car.ci, c.setHex(line.color).multiplyScalar(2.6));
          if (end) { this.tm.light.setColorAt(car.slot * 2, c.setHex(car.tail ? 0xff1c2c : 0xfff6dd).multiplyScalar(car.tail ? 4 : 7)); this.tm.light.setColorAt(car.slot * 2 + 1, c); }
        }
        this.trains.push(train);
      }
    });
    // the train directly ahead on the same loop = smallest positive head distance
    for (const tr of this.trains) {
      let best = null, bd = Infinity;
      for (const o of this.trains) if (o !== tr && o.line === tr.line) { const d = (o.head - tr.head + tr.line.path.len) % tr.line.path.len; if (d < bd) { bd = d; best = o; } }
      tr.ahead = best;
    }
    this.update(0, 0);
  }

  _step(dt) {
    for (const tr of this.trains) {
      const len = tr.line.path.len, st = tr.line.stations;
      let v = 15.5;
      if (tr.dwell > 0) { tr.dwell -= dt; v = 0; if (tr.dwell <= 0) { tr.next = (tr.next + 1) % st.length; tr.stopped = -1; } }
      else if (st.length) {
        const S = st[tr.next], stopHead = S.s + tr.len / 2 - 1; // train centred on the platform
        const dist = ((stopHead - tr.head) % len + len) % len;
        if (dist < 45 && tr.stopped !== tr.next) v = 15.5 * Math.min(1, 0.1 + dist / 45);
        if (dist < 0.7 && tr.stopped !== tr.next) { v = 0; tr.dwell = 3.5; tr.stopped = tr.next; }
        else if (dist > len - 1 && tr.stopped === tr.next) tr.stopped = -1;
      }
      if (tr.ahead) { // keep headway to the train in front
        const gap = ((tr.ahead.head - tr.ahead.len - tr.head) % len + len) % len;
        v *= THREE.MathUtils.clamp((gap - 12) / 35, 0, 1);
      }
      tr.speed += (v - tr.speed) * Math.min(1, dt * 3);
      tr.head = (tr.head + tr.speed * dt) % len;
    }
  }

  update(t, dtOverride) {
    if (!this.trains.length) return;
    let dt = dtOverride != null ? dtOverride : (this._last == null ? 0 : Math.min(0.1, t - this._last)); this._last = t;
    if (this.frozenT != null) dt = 0;
    if (dt > 0) this._step(dt);
    const o = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), lm = new THREE.Matrix4();
    const tm = this.tm;
    for (const tr of this.trains) {
      const alt = tr.line.alt;
      for (const car of tr.cars) {
        const s = tr.head - CAR_L / 2 - car.k * (CAR_L + GAP);
        sample(tr.line.path, s, o);
        q.setFromAxisAngle(up, Math.atan2(-o.tz, o.tx) + (car.tail ? Math.PI : 0));
        m4.compose(v.set(o.x, alt + 0.02, o.z), q, one);
        if (car.end) { tm.end.setMatrixAt(car.slot, m4); tm.bandEnd.setMatrixAt(car.slot, m4); } else { tm.mid.setMatrixAt(car.slot, m4); tm.bandMid.setMatrixAt(car.slot, m4); }
        const sm = new THREE.Matrix4().compose(v.set(o.x, alt + 0.02, o.z), q.setFromAxisAngle(up, Math.atan2(-o.tz, o.tx)), one); // strip is symmetric
        tm.strip.setMatrixAt(car.ci, sm);
        if (car.end) for (const sd of [-1, 1]) { v.set(CAR_L / 2 - 0.1, 1.0, sd * 0.95).applyMatrix4(m4.compose(new THREE.Vector3(o.x, alt + 0.02, o.z), q.setFromAxisAngle(up, Math.atan2(-o.tz, o.tx) + (car.tail ? Math.PI : 0)), one)); lm.compose(v, q, one); tm.light.setMatrixAt(car.slot * 2 + (sd > 0 ? 1 : 0), lm); }
      }
    }
    for (const m of Object.values(tm)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // ---- clearance API ----
  /** would a sky-bridge/box {x0,x1,z0,z1,y0,y1} clip a deck, train, station or pylon? */
  blocks(b, pad = 2.6) {
    for (const L of this.lines) {
      const lo = L.alt - 1.6, hi = L.alt + 7.4;
      if (b.y1 >= lo && b.y0 <= hi) for (const [x, z] of L.samples) {
        const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
        if (dx * dx + dz * dz < (DECK_HW + pad + 1.4) ** 2) return true;
      }
      if (b.y0 < L.alt) for (const p of this.pylons) {
        const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dz = Math.max(b.z0 - p.z, 0, p.z - b.z1);
        if (dx * dx + dz * dz < 2.2 * 2.2) return true;
      }
    }
    return false;
  }
  /** is the point (x,z) at altitude y with body radius r clear of every deck/train/pylon? */
  clear(x, z, y, r = 3.4) {
    for (const L of this.lines) {
      if (y > L.alt - 3.5 - 1 && y < L.alt + 8) for (const [sx, sz] of L.samples) if ((sx - x) ** 2 + (sz - z) ** 2 < (DECK_HW + 1.6 + r) ** 2) return false;
      if (y < L.alt) for (const p of this.pylons) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (1 + r) ** 2) return false;
    }
    return true;
  }
}
