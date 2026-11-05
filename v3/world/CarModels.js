// Self-authored procedural car meshes (CC0, no downloaded assets). Every car is lofted from smooth rounded cross-sections:
// painted body, tinted glass canopy, wheels/hover pods, glowing neon side strips + underglow bar. Frame: +x = nose, y up,
// wheels at y = 0, centred in x/z, scaled to `len` metres. Same interface as the old glTF loader (parts[] -> InstancedMesh).
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

// profile stations along the car (t 0 = tail .. 1 = nose): half width, bottom, top (fractions of len)
const PROFILES = {
  coupe: { w: 0.19, h0: 0.05, st: [[0, .72, .22, .46], [.08, .92, .2, .58], [.3, 1, .18, .62], [.55, 1, .18, .6], [.8, .92, .2, .5], [.95, .78, .22, .4], [1, .5, .26, .33]], cab: [.28, .68, .62, .98], wheels: 0.095, flat: false },
  wedge: { w: 0.2, h0: 0.04, st: [[0, .8, .2, .4], [.15, 1, .17, .52], [.5, 1, .16, .5], [.85, .85, .18, .36], [1, .4, .22, .27]], cab: [.34, .62, .5, .8], wheels: 0.085, flat: false },
  hover: { w: 0.22, h0: 0.14, st: [[0, .6, .24, .42], [.12, .95, .2, .54], [.45, 1, .2, .58], [.78, .9, .22, .46], [1, .35, .26, .34]], cab: [.3, .66, .58, .9], wheels: 0, flat: true },
};
export const CAR_DEFS = [
  { id: 'coupe', file: 'coupe', body: 0xdfe8ff, accent: 0x38e8ff, nose: 1 },
  { id: 'wedge', file: 'wedge', body: 0xff4fd8, accent: 0xff3fd0, nose: 1 },
  { id: 'hover', file: 'hover', body: 0x7da2ff, accent: 0x6ff4ff, nose: 1 },
];

function ring(n, hw, y0, y1, p = 4.2) { // superellipse cross-section (rounded box), returns [[z,y]...]
  const pts = [], cy = (y0 + y1) / 2, hh = (y1 - y0) / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pts.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * hw, cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / p) * hh]);
  }
  return pts;
}
function loft(stations, n = 16) { // stations: [{x, hw, y0, y1}], closed ends
  const pos = [], idx = [];
  stations.forEach((s) => ring(n, s.hw, s.y0, s.y1).forEach(([z, y]) => pos.push(s.x, y, z)));
  for (let k = 0; k < stations.length - 1; k++) for (let i = 0; i < n; i++) {
    const a = k * n + i, b = k * n + (i + 1) % n, c = (k + 1) * n + i, d = (k + 1) * n + (i + 1) % n;
    idx.push(a, c, b, b, c, d);
  }
  for (const [k, flip] of [[0, true], [stations.length - 1, false]]) { // caps
    const base = pos.length / 3, s = stations[k]; pos.push(s.x, (s.y0 + s.y1) / 2, 0);
    for (let i = 0; i < n; i++) { const a = k * n + i, b = k * n + (i + 1) % n; idx.push(...(flip ? [base, b, a] : [base, a, b])); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const fin = (g) => { if (g.index) { if (!g.attributes.normal) g.computeVertexNormals(); g = g.toNonIndexed(); } for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };

function build(def, len) {
  const P = PROFILES[def.file], L = len, at = (t) => (t - 0.5) * L;
  const body = [], glass = [], wheel = [], neon = [];
  const lerpY = (t, key) => { const s = P.st; for (let i = 0; i < s.length - 1; i++) if (t <= s[i + 1][0]) { const f = (t - s[i][0]) / (s[i + 1][0] - s[i][0]); return s[i][key] + (s[i + 1][key] - s[i][key]) * f; } return s[s.length - 1][key]; };
  const lift = P.h0 * L + (P.wheels ? P.wheels * L * 0.6 : 0.0);
  const stations = P.st.map(([t, w, a, b]) => ({ x: at(t), hw: P.w * L * w, y0: lift * 0 + a * L * 0.6 + P.h0 * L, y1: b * L * 0.6 + P.h0 * L + 0.2 * L * 0.25 }));
  // resample the profile with smoothstep interpolation so the body reads as one continuous curved surface
  const smooth = [], NS = 22;
  for (let i = 0; i < NS; i++) { const t = i / (NS - 1), j = Math.min(stations.length - 2, Math.max(0, stations.findIndex((s, k) => k < stations.length - 1 && at(P.st[k + 1][0]) >= at(t)))); const a = stations[j], b = stations[j + 1], u0 = at(P.st[j][0]), u1 = at(P.st[j + 1][0]), f0 = (at(t) - u0) / (u1 - u0), f = f0 * f0 * (3 - 2 * f0); smooth.push({ x: at(t), hw: a.hw + (b.hw - a.hw) * f, y0: a.y0 + (b.y0 - a.y0) * f, y1: a.y1 + (b.y1 - a.y1) * f }); }
  body.push(loft(smooth, 28));
  // glass canopy: narrower, taller loft sitting on the body roof
  const [c0, c1, , ] = P.cab, cn = 6, cs = [];
  for (let i = 0; i <= cn; i++) {
    const u = i / cn, t = c0 + (c1 - c0) * u, bulge = Math.sin(Math.PI * Math.min(1, 0.1 + u * 0.9)) ;
    const top = lerpY(t, 3) * L * 0.6 + P.h0 * L + 0.2 * L * 0.25;
    cs.push({ x: at(t), hw: P.w * L * (0.62 + 0.28 * bulge) * (i === 0 || i === cn ? 0.7 : 1), y0: top - 0.05 * L, y1: top + (0.035 + 0.05 * bulge) * L });
  }
  glass.push(loft(cs, 22));
  // wheels (ground cars) or hover pods
  const ws = P.wheels * L;
  if (!P.flat) for (const [t, sg] of [[0.2, 1], [0.2, -1], [0.78, 1], [0.78, -1]]) {
    const g = new THREE.CylinderGeometry(ws, ws, 0.075 * L, 24); g.rotateX(Math.PI / 2); g.translate(at(t), ws, sg * P.w * L * 0.93); wheel.push(g);
  } else for (const [t, sg] of [[0.22, 1], [0.22, -1], [0.78, 1], [0.78, -1]]) {
    const g = new THREE.CylinderGeometry(0.05 * L, 0.07 * L, 0.03 * L, 14); g.translate(at(t), P.h0 * L * 0.7, sg * P.w * L * 0.8); wheel.push(g);
  }
  // neon: side strips (both flanks), roof-edge accent, underglow bar, light bars (front white, rear red as separate parts)
  const bar = (x, y, z, w, h, d) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const yMid = (t) => (lerpY(t, 2) + lerpY(t, 3)) * 0.5 * L * 0.6 + P.h0 * L + 0.03 * L;
  for (const sg of [-1, 1]) {
    for (let i = 0; i < 9; i++) { const t = 0.12 + i * 0.095; neon.push(bar(at(t), yMid(t) - 0.015 * L, sg * P.w * L * 1.0, 0.1 * L, 0.012 * L, 0.012 * L)); }
  }
  neon.push(bar(0, P.h0 * L * 0.55, 0, L * 0.7, 0.014 * L, P.w * L * 1.6));            // underglow plate
  const head = [], tail = [];
  for (const sg of [-1, 1]) {
    head.push(bar(at(0.985), yMid(0.97) - 0.01 * L, sg * P.w * L * 0.55, 0.03 * L, 0.025 * L, 0.11 * L));
    tail.push(bar(at(0.01), yMid(0.02), sg * P.w * L * 0.6, 0.03 * L, 0.025 * L, 0.14 * L));
  }
  tail.push(bar(at(0.005), yMid(0.02) + 0.01 * L, 0, 0.02 * L, 0.012 * L, P.w * L * 1.5));
  const M = (o) => new THREE.MeshStandardMaterial(o);
  const paint = M({ color: new THREE.Color(def.body).multiplyScalar(0.62), metalness: 0.85, roughness: 0.3, envMapIntensity: 1.5, emissive: new THREE.Color(def.body), emissiveIntensity: 0.05 });
  const glassM = M({ color: 0x0a1630, metalness: 0.95, roughness: 0.06, envMapIntensity: 3.2, emissive: new THREE.Color(0x153a7a), emissiveIntensity: 0.5 });
  const wheelM = M({ color: 0x1a1c24, metalness: 0.6, roughness: 0.5, envMapIntensity: 1.0 });
  const neonM = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent).multiplyScalar(2.4), toneMapped: false });
  const headM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d0).multiplyScalar(3), toneMapped: false });
  const tailM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2030).multiplyScalar(2.6), toneMapped: false });
  const merge = (a) => mergeGeometries(a.map(fin));
  return [[body, paint], [glass, glassM], [wheel, wheelM], [neon, neonM], [head, headM], [tail, tailM]].filter(([g]) => g.length).map(([g, m]) => ({ geometry: merge(g), material: m }));
}

const cache = new Map();
export function loadCarModel(def, len) {
  const key = def.id + ':' + len;
  if (!cache.has(key)) {
    const parts = build(def, len), bb = new THREE.Box3();
    parts.forEach((q) => { q.geometry.computeBoundingBox(); bb.union(q.geometry.boundingBox); });
    cache.set(key, Promise.resolve({ def, parts, size: bb.getSize(new THREE.Vector3()), box: bb }));
  }
  return cache.get(key);
}
