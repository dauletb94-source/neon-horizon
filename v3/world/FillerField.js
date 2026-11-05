// Ambient skyline: the SAME glTF towers as the named buildings, drawn with InstancedMesh (one per model/material
// slot). Every tower is placed on a PLOT from world/layout.js (never on a street) and its horizontal scale is
// capped to the plot's footprint cap, so roads stay fully clear by construction.
//   near field : the free plots of the playable city
//   far field  : big plots on the same street grid out to the horizon; heights swell mid-distance then taper into haze
import * as THREE from '../vendor/three/three.module.js';
import { modelFor, modelDims, KINDS, HERO_KINDS, materialFor, NEON } from '../engine/towers.js';
import { PLOTS, FAR_EXTENT, HORIZON_EXTENT } from './layout.js';
import { realModels, nightMaterial, thickEdgeGeometry, glowEdgeMaterial } from '../engine/realTowers.js';
import { glassMaterial } from '../engine/towers.js';
import { SlabBuilder, rectOutline } from './Proc.js';

export const HOME = { x: 42, z: 275 };
const REAL_CAP = [40, 14, 40, 22, 22, 26, 14]; // max instances per real model (office, tower, terraces, scifi) - triangle budget

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NEON_KEYS = ['cyan', 'cyan', 'cyan', 'blue', 'blue', 'magenta', 'cyan', 'violet'];
const CLASS_W = [0.1, 0.3, 0.38, 0.22];
const NORMAL_KINDS = Array.from({ length: KINDS }, (_, i) => i).filter((i) => !HERO_KINDS.includes(i)).concat([8]); // kind 8 = curved glass cylinder: kept rare (~1 in 12) so silhouettes are not all tubes
const pickKind = (rnd, heroP) => (rnd() < heroP ? HERO_KINDS[(rnd() * HERO_KINDS.length) | 0] : NORMAL_KINDS[(rnd() * NORMAL_KINDS.length) | 0]);
function pickClass(r, boost = 0) {
  const x = r + boost; let acc = 0;
  for (let i = 0; i < CLASS_W.length; i++) { acc += CLASS_W[i]; if (x <= acc) return i; }
  return CLASS_W.length - 1;
}

export class FillerField {
  constructor(parent, { skipChance = 0.08, reserve = null } = {}) {
    this.reserve = reserve;
    this.group = new THREE.Group();
    parent.add(this.group);
    const rnd = mulberry32(90210);
    const items = []; // {kind,hc,x,z,rot,sxz,sy,neon}
    const realItems = []; const realUsed = REAL_CAP.map(() => 0);

    // near field: every plot not claimed by a named building.
    // A low-frequency 'density' field makes tall clusters, mid-rise belts and low dark valleys (like city.jpg's
    // few hero towers over a darker, lower fabric); ~1 in 5 plots is a garden-roofed podium, ~6% stay open plazas.
    this.podiums = new Map(); this.bridgeCands = new Map();
    const dens = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.0095 + 0.4) + 0.25 * Math.sin((x + z) * 0.021);
    for (const p of PLOTS.near) {
      if (p.taken) continue;
      const neon = NEON_KEYS[(rnd() * NEON_KEYS.length) | 0], rot = ((rnd() * 4) | 0) * Math.PI / 2;
      const d = dens(p.cx, p.cz), r0 = rnd();
      if (r0 < 0.05 + 0.07 * (1 - d)) { p.taken = 'filler'; continue; }                                  // open dark plaza
      if (r0 < 0.24 + 0.12 * (1 - d)) { this._podium(p, rnd, neon); continue; }                         // garden podium
      if (realModels.length && rnd() < 0.5) { // downloaded realistic tower on this plot
        const ri = (rnd() * realModels.length) | 0;
        if (realUsed[ri] < (REAL_CAP[ri] ?? 20)) {
          realUsed[ri]++; p.taken = 'filler';
          const m = realModels[ri], H = (18 + rnd() * 30) * (0.7 + d * 1.2) + (rnd() < 0.08 ? 40 : 0);
          const sxz = Math.min(p.cap / Math.max(m.w, m.d), (H / m.height) * 1.7), sy = Math.min(H / m.height, sxz * 1.7);
          realItems.push({ ri, x: p.cx, z: p.cz, rot: ((rnd() * 4) | 0) * Math.PI / 2, sxz, sy, neon: neon, plot: p });
          p.h = m.height * sy; p.half = Math.max(m.w, m.d) * sxz / 2;
          continue;
        }
      }
      const kind = pickKind(rnd, 0.06 + 0.08 * d), hero = HERO_KINDS.includes(kind);
      const hc = hero ? 3 : pickClass(Math.pow(rnd(), 0.9) * (0.35 + 0.75 * d));                    // dense core -> taller classes
      const sy = hero ? 0.9 + rnd() * 0.45 : (0.55 + rnd() * 0.75) * (0.7 + 0.6 * d);
      items.push(this._item(kind, hc, p, rot, hero ? 0.9 : 0.8 + rnd() * 0.2, sy, neon));
    }

    // far field: big plots out to the horizon, same street grid
    for (const p of PLOTS.far) {
      if (rnd() < 0.05) continue;
      const hd = Math.hypot(p.cx - HOME.x, p.cz - HOME.z); // keep the hero-camera terrace clear so the opening view never starts inside a tower
      if (hd < 55) continue;
      const k = Math.min(1, Math.hypot(p.cx, p.cz) / FAR_EXTENT);
      const fk = pickKind(rnd, 0.05);
      const hc = HERO_KINDS.includes(fk) ? 3 : pickClass(rnd(), 0.12 * Math.sin(Math.min(1, k * 1.6) * Math.PI)); // tall in the mid-distance
      const taper = 1.25 - 0.55 * k; // lower, hazier silhouettes toward the horizon
      items.push(this._item(fk, hc, p, ((rnd() * 4) | 0) * Math.PI / 2, 0.95 + rnd() * 0.5, (0.55 + rnd() * 0.7) * taper * (hd < 120 ? 0.6 : 1), NEON_KEYS[(rnd() * NEON_KEYS.length) | 0]));
    }
    // horizon: now drawn by world/FarSkyline.js (dense lit shader skyline all the way to the haze)
    this.count = items.length + realItems.length;
    this._build(items);
    this._buildReal(realItems);
    this._buildBridges(rnd);
  }

  // xz scale is capped so the (podium-inclusive) footprint fits the plot; y scale is free
  _item(kind, hc, plot, rot, sxzWant, sy, neon) {
    const model = modelFor(kind, hc);
    const dims = modelDims(model);
    const sxz = Math.min(sxzWant, plot.cap / Math.max(dims.w, dims.d));
    plot.taken = plot.taken || 'filler';
    plot.h = model.height * sy; plot.half = Math.max(dims.w, dims.d) * sxz / 2;
    return { kind, hc, x: plot.cx, z: plot.cz, rot, sxz, sy, neon, plot };
  }

  _build(items) {
    const pools = new Map();
    this._refs = new Map(); // near plot id -> instances, so the admin editor can swap a filler tower for its own building
    for (const it of items) {
      const key = it.kind + '_' + it.hc;
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(it);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const [key, list] of pools) {
      const [kind, hc] = key.split('_').map(Number);
      const model = modelFor(kind, hc);
      if (!model) continue;
      const skin = (kind + hc) % 3;
      for (const src of model.meshes) {
        const slot = src.material.name;
        const mat = materialFor(slot, { skin, neon: 'cyan' });
        const im = new THREE.InstancedMesh(src.geometry, slot === 'neon' ? mat.clone() : mat, list.length);
        list.forEach((it, idx) => {
          q.setFromAxisAngle(up, it.rot);
          m4.compose(pos.set(it.x, 0, it.z), q, sc.set(it.sxz, it.sy, it.sxz));
          im.setMatrixAt(idx, m4);
          if (it.plot.zone === 'near') (this._refs.get(it.plot.id) || this._refs.set(it.plot.id, []).get(it.plot.id)).push({ im, idx, m: m4.clone() });
          if (slot === 'neon') { col.setHex(NEON[it.neon]); im.setColorAt(idx, col); }
        });
        if (slot === 'neon') im.material.color.set(0xffffff).multiplyScalar(0.75);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        this.group.add(im);
      }
    }
  }

  _buildReal(list) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this._realRefs = new Map();
    const byModel = new Map();
    for (const it of list) { if (!byModel.has(it.ri)) byModel.set(it.ri, []); byModel.get(it.ri).push(it); }
    for (const [ri, arr] of byModel) {
      const model = realModels[ri];
      arr.forEach((it, idx) => { q.setFromAxisAngle(up, it.rot); it.m = new THREE.Matrix4().compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(it.sxz, it.sy, it.sxz)); });
      for (const src of model.meshes) {
        const im = new THREE.InstancedMesh(src.geo, nightMaterial(src.mat, 0xffd9a0, model.unit), arr.length);
        arr.forEach((it, idx) => {
          im.setMatrixAt(idx, it.m);
          (this._realRefs.get(it.plot.id) || this._realRefs.set(it.plot.id, []).get(it.plot.id)).push({ im, idx, m: it.m });
        });
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
      }
      // neon outline: all instances' long structural edges merged into one LineSegments per neon colour
      const byNeon = new Map();
      for (const it of arr) { if (!byNeon.has(it.neon)) byNeon.set(it.neon, []); byNeon.get(it.neon).push(it); }
      for (const [neon, its] of byNeon) {
        const pts = [], v = new THREE.Vector3();
        for (const it of its) for (const e of model.edges) {
          const a = e.attributes.position.array;
          for (let k = 0; k < a.length; k += 3) { v.set(a[k], a[k + 1], a[k + 2]).applyMatrix4(it.m); pts.push(v.x, v.y, v.z); }
          it.edgeRange = 1;
        }
        const ls = new THREE.Mesh(thickEdgeGeometry(new Float32Array(pts), 0.26), glowEdgeMaterial(NEON[neon], 1.1));
        ls.frustumCulled = false; ls.userData.noAudit = true; this.group.add(ls);
      }
    }
  }

  // low-rise garden podium: lit curtain-wall walls, green roof garden inset with lamps, glowing neon parapet outline
  _podium(p, rnd, neon) {
    const w = p.cap * (0.78 + rnd() * 0.22), d = p.cap * (0.78 + rnd() * 0.22), h = 5 + rnd() * 11;
    const sb = new SlabBuilder().box(p.cx, 0, p.cz, w, h, d, { walls: true, top: true });
    const inset = 1.3; sb.box(p.cx, 0, p.cz, w - inset * 2, 0, d - inset * 2, { walls: false, top: true, topY: h + 0.18 });
    const grp = new THREE.Group(); grp.userData.noPick = true;
    const wg = sb.walls(), tg = sb.tops();
    grp.add(new THREE.Mesh(wg, glassMaterial((p.cx | 0) % 3 === 0 ? 2 : 0)));
    // roof = dark slab (first top quad) + garden (second); split by index count (6 indices each)
    const roof = new THREE.BufferGeometry(); roof.copy(tg); roof.setIndex(Array.from(tg.index.array).slice(0, 6)); grp.add(new THREE.Mesh(roof, materialFor('roof')));
    const gar = new THREE.BufferGeometry(); gar.copy(tg); gar.setIndex(Array.from(tg.index.array).slice(6, 12)); grp.add(new THREE.Mesh(gar, materialFor('garden')));
    const lamps = [], lw = 0.5;
    for (let k = 0; k < 6; k++) { const lx = p.cx + (rnd() - 0.5) * (w - 4), lz = p.cz + (rnd() - 0.5) * (d - 4); lamps.push(lx - lw, h + 0.3, lz, lx + lw, h + 0.3, lz); }
    grp.add(new THREE.Mesh(thickEdgeGeometry(new Float32Array(lamps), 0.5), materialFor('lamp')));
    grp.add(new THREE.Mesh(thickEdgeGeometry(new Float32Array(rectOutline(p.cx, h + 0.1, p.cz, w, d)), 0.45), glowEdgeMaterial(NEON[neon])));
    this.group.add(grp); this.podiums.set(p.id, grp);
    p.taken = 'filler'; p.h = h; p.half = Math.max(w, d) / 2;
  }

  // wide glass sky-bridges with a planted roof and glowing rails, spanning the streets between tall neighbours
  _buildBridges(rnd) {
    const sb = new SlabBuilder(), rails = [], under = [];
    const byId = new Map(PLOTS.near.map((q) => [q.id, q]));
    let n = 0;
    for (const p of PLOTS.near) {
      const [i, j] = p.id.slice(1).split('_').map(Number);
      for (const [di, dj] of [[2, 0], [0, 2]]) {
        if (!((di && i % 4 === 3) || (dj && j % 4 === 3))) continue;
        const q = byId.get(`n${i + di}_${j + dj}`);
        if (!q || !p.h || !q.h || p.h < 15 || q.h < 15 || n > 90 || rnd() > 0.8) continue;
        const along = di ? 'x' : 'z', y = THREE.MathUtils.clamp(Math.min(p.h, q.h) * (0.5 + rnd() * 0.3), 7, 60), bh = 3.2, bw = 4.6;
        const a0 = (along === 'x' ? p.cx : p.cz) + p.half - 1.2, a1 = (along === 'x' ? q.cx : q.cz) - q.half + 1.2;
        if (a1 - a0 < 6) continue;
        const L = a1 - a0, mid = (a0 + a1) / 2, cx = along === 'x' ? mid : p.cx, cz = along === 'x' ? p.cz : mid;
        const sx = along === 'x' ? L : bw, sz = along === 'x' ? bw : L;
        if (this.reserve && this.reserve({ x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2, y0: y - 0.2, y1: y + bh + 0.3 })) continue;
        sb.box(cx, y, cz, sx, bh, sz, { walls: true, top: true });
        sb.box(cx, y, cz, sx - 1.2, 0, sz - 1.2, { walls: false, top: true, topY: y + bh + 0.2 });   // garden strip on the roof
        for (const sgn of [-1, 1]) { // glowing rails along the roof edge + underglow
          const ox = along === 'x' ? 0 : sgn * bw / 2, oz = along === 'x' ? sgn * bw / 2 : 0;
          const A = along === 'x' ? [cx - L / 2, y + bh, cz + oz, cx + L / 2, y + bh, cz + oz] : [cx + ox, y + bh, cz - L / 2, cx + ox, y + bh, cz + L / 2];
          rails.push(...A);
          const U = along === 'x' ? [cx - L / 2, y - 0.1, cz + oz, cx + L / 2, y - 0.1, cz + oz] : [cx + ox, y - 0.1, cz - L / 2, cx + ox, y - 0.1, cz + L / 2];
          under.push(...U);
        }
        (this.bridgeSpans || (this.bridgeSpans = [])).push({ along, line: mid, y, bh });
        (this.bridgeBoxes || (this.bridgeBoxes = [])).push({ x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2, y0: y - 0.2, y1: y + bh + 0.3 });
        n++;
      }
    }
    this.bridgeCount = n;
    if (!n) return;
    const g = new THREE.Group(); g.userData.noAudit = true; // elevated spans over the streets, never standing on them
    const wg = sb.walls(), tg = sb.tops();
    g.add(new THREE.Mesh(wg, glassMaterial(1)));
    const roof = new THREE.BufferGeometry(); roof.copy(tg); const ti = Array.from(tg.index.array);
    const rI = [], gI = [];
    for (let k = 0; k < ti.length; k += 6) (((k / 6) & 1) ? gI : rI).push(...ti.slice(k, k + 6));
    roof.setIndex(rI); g.add(new THREE.Mesh(roof, materialFor('roof')));
    const gar = new THREE.BufferGeometry(); gar.copy(tg); gar.setIndex(gI); g.add(new THREE.Mesh(gar, materialFor('garden')));
    g.add(new THREE.Mesh(thickEdgeGeometry(new Float32Array(rails), 0.5), glowEdgeMaterial(NEON.cyan, 2.6)));
    g.add(new THREE.Mesh(thickEdgeGeometry(new Float32Array(under), 0.7), glowEdgeMaterial(NEON.magenta, 2.2)));
    this.group.add(g);
  }

  // hide / restore the filler tower standing on a near plot
  hide(plot) {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const r of [...(this._refs.get(plot.id) || []), ...(this._realRefs?.get(plot.id) || [])]) { r.im.setMatrixAt(r.idx, z); r.im.instanceMatrix.needsUpdate = true; }
    const pg = this.podiums?.get(plot.id); if (pg) pg.visible = false;
    plot.taken = 'admin';
  }
  show(plot) {
    for (const r of [...(this._refs.get(plot.id) || []), ...(this._realRefs?.get(plot.id) || [])]) { r.im.setMatrixAt(r.idx, r.m); r.im.instanceMatrix.needsUpdate = true; }
    const pg = this.podiums?.get(plot.id); if (pg) pg.visible = true;
    plot.taken = 'filler';
  }
}
