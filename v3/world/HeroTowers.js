// Hero towers: big, bright landmark skyscrapers with distinct silhouettes (podium + setbacks + spire, slanted prism,
// rounded curved-glass shaft with a lit crown, twisted tower, twin towers with a glowing sky-link, tapered needle).
// Built from lofted geometry (walls get window UVs in metres, roofs are separate 'roof' meshes: windows never reach
// a roof). Each hero claims 1, 4 or 9 whole free plots of ONE block and stays inside their combined footprint, so
// roads remain clear by construction (verified by tools/audit_layout.py).
import * as THREE from '../vendor/three/three.module.js';
import { PLOTS, NEAR_BLOCKS, CELL } from './layout.js';
import { heroGlassMaterial, materialFor, NEON } from '../engine/towers.js';
import { thickEdgeGeometry, glowEdgeMaterial } from '../engine/realTowers.js';

const U_TILE = 28.8, V_TILE = 57.6;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- profiles (closed loops of [x,z]); orientation fixed so wall normals face outward
function orient(pts) {
  let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a < 0 ? pts : pts.slice().reverse();
}
const rectP = (w, d, c = 0) => {
  const x = w / 2, z = d / 2;
  if (!c) return orient([[-x, -z], [-x, z], [x, z], [x, -z]]);
  return orient([[-x + c, -z], [-x, -z + c], [-x, z - c], [-x + c, z], [x - c, z], [x, z - c], [x, -z + c], [x - c, -z]]);
};
const superP = (w, d, n = 2.8, N = 56) => {
  const pts = [];
  for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); pts.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w / 2, Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * d / 2]); }
  return orient(pts);
};
const scaleP = (pts, sx, sz = sx) => pts.map(([x, z]) => [x * sx, z * sz]);
const rotP = (pts, a) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, z]) => [x * c - z * s, x * s + z * c]); };
const shiftP = (pts, dx, dz) => pts.map(([x, z]) => [x + dx, z + dz]);

// ---------- loft: rings = [{y, pts}] (same point count). smooth=true shares vertices (curved glass), else flat facets.
function loft(rings, { smooth = false, cap = true, flatY = null } = {}) {
  const P = rings[0].pts.length, pos = [], uv = [], idx = [];
  const arc = rings.map((r) => { const a = [0]; for (let i = 0; i < P; i++) { const p = r.pts[i], q = r.pts[(i + 1) % P]; a.push(a[i] + Math.hypot(q[0] - p[0], q[1] - p[1])); } return a; });
  const Y = (r, i) => (r.ys ? r.ys[i] : r.y);
  if (smooth) {
    for (const [ri, r] of rings.entries()) for (let i = 0; i <= P; i++) { const p = r.pts[i % P]; pos.push(p[0], Y(r, i % P), p[1]); uv.push(arc[ri][i] / U_TILE, Y(r, i % P) / V_TILE); }
    for (let ri = 0; ri < rings.length - 1; ri++) for (let i = 0; i < P; i++) { const a = ri * (P + 1) + i, b = a + 1, c = a + P + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
  } else {
    for (let ri = 0; ri < rings.length - 1; ri++) {
      const r0 = rings[ri], r1 = rings[ri + 1];
      for (let i = 0; i < P; i++) {
        const j = (i + 1) % P, v = pos.length / 3;
        pos.push(r0.pts[i][0], Y(r0, i), r0.pts[i][1], r0.pts[j][0], Y(r0, j), r0.pts[j][1], r1.pts[j][0], Y(r1, j), r1.pts[j][1], r1.pts[i][0], Y(r1, i), r1.pts[i][1]);
        uv.push(arc[ri][i] / U_TILE, Y(r0, i) / V_TILE, arc[ri][i + 1] / U_TILE, Y(r0, j) / V_TILE, arc[ri + 1][i + 1] / U_TILE, Y(r1, j) / V_TILE, arc[ri + 1][i] / U_TILE, Y(r1, i) / V_TILE);
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      }
    }
  }
  const wall = new THREE.BufferGeometry();
  wall.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wall.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wall.setIndex(idx); wall.computeVertexNormals();
  let roof = null;
  if (cap) { // fan cap at the last ring, always facing up
    const r = rings[rings.length - 1], rp = [], ri2 = [];
    let cx = 0, cz = 0, cy = 0; for (let i = 0; i < P; i++) { cx += r.pts[i][0] / P; cz += r.pts[i][1] / P; cy += Y(r, i) / P; }
    rp.push(cx, cy, cz); for (let i = 0; i < P; i++) rp.push(r.pts[i][0], Y(r, i), r.pts[i][1]);
    for (let i = 0; i < P; i++) ri2.push(0, 1 + (i + 1) % P, 1 + i);
    roof = new THREE.BufferGeometry(); roof.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); roof.setIndex(ri2); roof.computeVertexNormals();
    // flip if the fan faces down
    if (roof.attributes.normal.getY(0) < 0) { roof.setIndex(ri2.map((v, k) => (k % 3 === 1 ? ri2[k + 1] : k % 3 === 2 ? ri2[k - 1] : v))); roof.computeVertexNormals(); }
  }
  return { wall, roof };
}
const prism = (pts, y0, y1, o = {}) => loft([{ y: y0, pts }, { y: y1, pts }], o);

// ---------- neon helpers (flat xyz segment lists)
function outline(pts, y, out = []) { for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; out.push(p[0], y, p[1], q[0], y, q[1]); } return out; }
function corners(pts, y0, y1, out = [], step = 1) { for (let i = 0; i < pts.length; i += step) out.push(pts[i][0], y0, pts[i][1], pts[i][0], y1, pts[i][1]); return out; }

export class HeroTowers {
  constructor(parent, { count = 12, seed = 424242, avoid = [] } = {}) {
    this.group = new THREE.Group(); parent.add(this.group);
    this.list = [];
    const rnd = mulberry32(seed);
    const byId = new Map(PLOTS.near.map((p) => [p.id, p]));
    const free = (p) => p && !p.taken;
    const cands = [];
    for (let bk = 0; bk < NEAR_BLOCKS; bk++) for (let bj = 0; bj < NEAR_BLOCKS; bj++) {
      const i0 = 4 * bk + 1, j0 = 4 * bj + 1, at = (a, b) => byId.get(`n${i0 + a}_${j0 + b}`);
      const rects = [];
      if ([0, 1, 2].every((a) => [0, 1, 2].every((b) => free(at(a, b))))) rects.push({ a0: 0, b0: 0, n: 3 });
      for (const a0 of [0, 1]) for (const b0 of [0, 1]) if ([0, 1].every((a) => [0, 1].every((b) => free(at(a0 + a, b0 + b))))) rects.push({ a0, b0, n: 2 });
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (free(at(a, b))) rects.push({ a0: a, b0: b, n: 1 });
      if (rects.length) cands.push({ bk, bj, at, rects });
    }
    // deterministic shuffle, then pick with spacing; prefer big claims (mega first), ~40% mega / 35% 2x2 / rest singles
    cands.sort(() => rnd() - 0.5);
    const chosen = [];
    for (const relax of [2, 1, 0]) {
      for (const c of cands) {
        if (chosen.length >= count) break;
        if (chosen.includes(c)) continue;
        if (chosen.some((o) => Math.max(Math.abs(o.bk - c.bk), Math.abs(o.bj - c.bj)) < relax)) continue;
        chosen.push(c);
      }
    }
    chosen.forEach((c, k) => {
      const want = k % 5 === 0 || k % 5 === 3 ? 3 : k % 5 === 1 || k % 5 === 4 ? 2 : 1;
      let r = c.rects.filter((q) => q.n === want)[0] || c.rects.filter((q) => q.n < want).sort((a, b) => b.n - a.n)[0] || c.rects[0];
      const ps = []; for (let a = 0; a < r.n; a++) for (let b = 0; b < r.n; b++) ps.push(c.at(r.a0 + a, r.b0 + b));
      if (!ps.every(free)) return;
      const cx = ps.reduce((s, p) => s + p.cx, 0) / ps.length, cz = ps.reduce((s, p) => s + p.cz, 0) / ps.length;
      const fp = r.n * CELL - 2.8;
      const H = r.n === 3 ? 170 + rnd() * 80 : r.n === 2 ? 125 + rnd() * 70 : 85 + rnd() * 60;
      const type = ['setback', 'curved', 'slant', 'twist', 'twin', 'needle'][(k + ((rnd() * 3) | 0)) % 6];
      const neon = ['cyan', 'magenta', 'blue', 'violet', 'cyan', 'magenta'][(rnd() * 6) | 0];
      const g = this._build(type, fp, H, neon, rnd);
      g.position.set(cx, 0, cz);
      this.group.add(g);
      for (const p of ps) { p.taken = 'hero'; p.h = H; p.half = fp / 2 + Math.hypot(p.cx - cx, p.cz - cz); }
      this.list.push({ type, cx, cz, fp, H, n: r.n, neon });
    });
  }

  _mesh(g, mat, grp) { if (!g) return; const m = new THREE.Mesh(g, mat); m.userData.noPick = true; grp.add(m); return m; }
  _neon(pts, w, neon, grp, k = 2.4) { if (!pts.length) return; const m = new THREE.Mesh(thickEdgeGeometry(new Float32Array(pts), w), glowEdgeMaterial(NEON[neon], k)); m.userData.noPick = true; grp.add(m); }

  _build(type, fp, H, neon, rnd) {
    const grp = new THREE.Group(), skin = (rnd() * 3) | 0, glass = heroGlassMaterial(skin), roof = materialFor('roof');
    const accent = { cyan: 'magenta', magenta: 'cyan', blue: 'cyan', violet: 'cyan' }[neon];
    const nl = [], na = [];                       // neon segments (main colour / accent colour)
    const bright = materialFor('glow', { neon });
    // podium for wide claims: lit glass base with neon parapet; the shaft stands on it
    let base = 0, tw = fp;
    if (fp > 20) {
      const ph = 9 + rnd() * 5, pp = rectP(fp, fp, 2.2);
      const p = prism(pp, 0, ph); this._mesh(p.wall, glass, grp); this._mesh(p.roof, roof, grp);
      outline(pp, ph + 0.15, nl); corners(pp, 0, ph, na, 2);
      base = ph; tw = fp * 0.64;
      const gar = prism(rectP(fp * 0.9, fp * 0.9), ph + 0.1, ph + 0.35); // planted podium roof ring around the shaft
      this._mesh(gar.roof, materialFor('garden'), grp);
    }
    const spire = (y, h, w) => { // thin mast + beacon, always inside the footprint
      const pp = rectP(w, w); const s = prism(pp, y, y + h); this._mesh(s.wall, materialFor('trim'), grp); this._mesh(s.roof, materialFor('trim'), grp);
      const lp = [0, y + h, 0, 0, y + h + 2.2, 0]; this._neon(lp, 1.1, 'magenta', grp, 4);
      this._neon([0, y + h * 0.45, 0, 0, y + h * 0.55, 0], w * 1.6, neon, grp, 3);
    };
    const hh = H - base;
    if (type === 'setback') {
      const tiers = [[1, 0.52], [0.78, 0.22], [0.58, 0.14], [0.38, 0.07]]; let y = base;
      tiers.forEach(([s, f], i) => {
        const pp = rectP(tw * s, tw * s * (0.9 + (i % 2) * 0.1), 0.8 * s), y1 = y + hh * f;
        const p = prism(pp, y, y1); this._mesh(p.wall, glass, grp); this._mesh(p.roof, roof, grp);
        outline(pp, y1 + 0.15, i % 2 ? na : nl); if (i < 2) corners(pp, y, y1, nl, 2);
        y = y1;
      });
      spire(y, hh * 0.1 + 6, 0.9);
    } else if (type === 'curved') {
      const pf = superP(tw, tw * 0.82), top = 0.8, N = 14, rings = [], rg = [];
      for (let i = 0; i <= N; i++) { const t = i / N, s = 1 - (1 - top) * t; rings.push({ y: base + hh * 0.78 * t, pts: scaleP(pf, s) }); }
      const l = loft(rings, { smooth: true, cap: false }); this._mesh(l.wall, glass, grp);
      const sTop = top, cp = scaleP(pf, sTop);
      // lit crown: bright glowing glass section (like the blue cylinder in city.jpg)
      const crown = loft([{ y: base + hh * 0.78, pts: cp }, { y: H, pts: scaleP(pf, sTop * 0.96) }], { smooth: true });
      this._mesh(crown.wall, bright, grp); this._mesh(crown.roof, roof, grp);
      outline(cp, base + hh * 0.78, nl); outline(scaleP(pf, sTop * 0.96), H + 0.1, nl);
      for (let k = 1; k < 4; k++) outline(scaleP(pf, 1 - (1 - top) * (k / 4) * 0.78 * 1.2), base + hh * 0.78 * 0.25 * k, na);
      corners(cp, base, base + hh * 0.78, nl, 14).length; void rg;
      const sp = rectP(tw * 0.22, tw * 0.22); const hp = prism(sp, H, H + 0.8); this._mesh(hp.wall, materialFor('trim'), grp); this._mesh(hp.roof, materialFor('lamp'), grp);
    } else if (type === 'slant') {
      const pp = rectP(tw, tw * 0.8, 1.2), zs = pp.map((p) => p[1]);
      const ys = pp.map((p) => H - hh * 0.22 * (0.5 - p[1] / (tw * 0.8)));      // roof falls towards -z
      const r0 = { y: base, pts: pp }, r1 = { y: H, pts: pp, ys };
      const l = loft([r0, r1]); this._mesh(l.wall, glass, grp); this._mesh(l.roof, roof, grp);
      for (let i = 0; i < pp.length; i++) { const q = pp[(i + 1) % pp.length]; nl.push(pp[i][0], ys[i] + 0.15, pp[i][1], q[0], ys[(i + 1) % pp.length] + 0.15, q[1]); }
      corners(pp, base, H, nl, 1).length;
      // glowing vertical fin on the tall face
      const fin = prism(rectP(tw * 0.14, 0.7), base + 2, H - hh * 0.05); fin.wall.translate(0, 0, zs[1] + 0.35); this._mesh(fin.wall, bright, grp);
      spire(H + hh * 0.03, hh * 0.12, 0.7);
    } else if (type === 'twist') {
      const N = 30, rings = [], pp = rectP(tw * 0.92, tw * 0.92, 1.6), turn = 1.25 + rnd() * 0.5;
      for (let i = 0; i <= N; i++) { const t = i / N; rings.push({ y: base + hh * t, pts: rotP(scaleP(pp, 1 - 0.3 * t * t), turn * t) }); }
      const l = loft(rings); this._mesh(l.wall, glass, grp); this._mesh(l.roof, roof, grp);
      for (let c = 0; c < pp.length; c += 2) for (let i = 0; i < N; i += 1) { const a = rings[i], b = rings[i + 1]; nl.push(a.pts[c][0], a.y, a.pts[c][1], b.pts[c][0], b.y, b.pts[c][1]); }
      outline(rings[N].pts, H + 0.15, na);
      spire(H, hh * 0.12, 0.8);
    } else if (type === 'twin') {
      const w = tw * 0.42, d = tw * 0.62;
      [[-1, 1, 1], [1, 0.72, 0.8]].forEach(([sg, hf, wf], i) => {
        const pp = shiftP(rectP(w * wf, d, 1.0), sg * tw * 0.27, 0), top = base + hh * hf;
        const p = prism(pp, base, top); this._mesh(p.wall, glass, grp); this._mesh(p.roof, roof, grp);
        outline(pp, top + 0.15, i ? na : nl); corners(pp, base, top, nl, 1);
        const cr = prism(shiftP(rectP(w * wf * 0.6, d * 0.6), sg * tw * 0.27, 0), top, top + hh * 0.07); this._mesh(cr.wall, bright, grp); this._mesh(cr.roof, roof, grp);
        this._neon([sg * tw * 0.27, top + hh * 0.07, 0, sg * tw * 0.27, top + hh * 0.07 + hh * 0.1, 0], 0.7, i ? 'magenta' : neon, grp, 3.4);
      });
      const by = base + hh * 0.58, br = prism(rectP(tw * 0.2, d * 0.5), by, by + hh * 0.07); this._mesh(br.wall, bright, grp); this._mesh(br.roof, roof, grp);
      outline(rectP(tw * 0.2, d * 0.5), by + hh * 0.07 + 0.15, na);
    } else { // needle: octagonal shaft tapering in two soft stages, tall spire with glowing rings
      const pp = rectP(tw * 0.9, tw * 0.9, tw * 0.22), N = 12, rings = [];
      for (let i = 0; i <= N; i++) { const t = i / N; rings.push({ y: base + hh * 0.86 * t, pts: scaleP(pp, 1 - 0.38 * t - (t > 0.55 ? 0.1 * (t - 0.55) : 0)) }); }
      const l = loft(rings); this._mesh(l.wall, glass, grp); this._mesh(l.roof, roof, grp);
      const top = rings[N].pts; outline(top, base + hh * 0.86 + 0.15, nl); corners(top, base + hh * 0.86 - 4, base + hh * 0.86, na, 1);
      for (let i = 0; i < N; i++) { const a = rings[i], b = rings[i + 1]; for (let c = 0; c < pp.length; c += 2) nl.push(a.pts[c][0], a.y, a.pts[c][1], b.pts[c][0], b.y, b.pts[c][1]); }
      const y0 = base + hh * 0.86;
      spire(y0, H + hh * 0.12 - y0, 0.9);
      for (let k = 1; k <= 3; k++) outline(rectP(2.4 - k * 0.5, 2.4 - k * 0.5), y0 + (H - y0) * 0.3 * k, na);
    }
    this._neon(nl, 0.7, neon, grp); this._neon(na, 0.6, accent, grp, 2.2);
    return grp;
  }
}
