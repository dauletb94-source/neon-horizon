// Single source of truth for the street grid and building plots.
//
// The city is an infinite grid of streets. Street centre-lines sit at  -HALF + (4k + 0.5) * CELL  on both axes,
// each ROAD_W wide. Between two streets lies a BLOCK. Buildings may ONLY stand on PLOTS, which are carved
// out of blocks with a sidewalk margin, so by construction (and verified by auditBoxes) no building touches a road.
//
//   near zone (the playable city, k = 0..5 on each axis): each block = 3x3 plots of one CELL each
//   far zone  (skyline out to the horizon):               each block = 2x2 big plots
import * as THREE from '../vendor/three/three.module.js';

export const CITY_SIZE = 420;
export const CELLS = 26;
export const CELL = CITY_SIZE / CELLS;           // 16.15
export const HALF = CITY_SIZE / 2;
export const ROAD_EVERY = 4;
export const PERIOD = ROAD_EVERY * CELL;         // distance between street centre-lines
export const ROAD_W = CELL * 0.5;                // asphalt width
export const SIDEWALK = 1.0;                     // required clear gap between any building footprint and the asphalt edge
export const NEAR_BLOCKS = 6;                    // blocks per axis in the playable city (k = 0..5)
export const NEAR_CAP = CELL - 2.8;              // max footprint of a near-zone building (13.35)
export const FAR_CAP = 24;                       // max footprint of a far-zone building
export const FAR_EXTENT = CITY_SIZE * 2.6;       // radius of the skyline field

export const roadCenter = (k) => -HALF + (ROAD_EVERY * k + 0.5) * CELL;

// ---------------------------------------------------------------- road tests
// Distance from coordinate v to the nearest street centre-line along one axis.
function distToRoadAxis(v) {
  const f = ((v - roadCenter(0)) % PERIOD + PERIOD) % PERIOD;
  return Math.min(f, PERIOD - f);
}
// Does the 1D interval [a,b] come within `clear` of the asphalt of any street running perpendicular to this axis?
function intervalHitsRoad(a, b, clear) {
  const lim = ROAD_W / 2 + clear;
  if (b - a >= PERIOD - 2 * lim) return true;
  // nearest street centres around the interval
  const k0 = Math.floor((a - roadCenter(0)) / PERIOD);
  for (let k = k0 - 1; k <= k0 + 2; k++) {
    const c = roadCenter(k);
    if (b > c - lim && a < c + lim) return true;
  }
  return false;
}
/** true if the world-space AABB overlaps asphalt (or the sidewalk margin around it) */
export function boxHitsRoad(minX, maxX, minZ, maxZ, clear = SIDEWALK) {
  return intervalHitsRoad(minX, maxX, clear) || intervalHitsRoad(minZ, maxZ, clear);
}
export function pointOnRoad(x, z, clear = 0) {
  const lim = ROAD_W / 2 + clear;
  return distToRoadAxis(x) < lim || distToRoadAxis(z) < lim;
}

// ---------------------------------------------------------------- plots
export function buildPlots() {
  const near = [], far = [];
  const nearMax = roadCenter(NEAR_BLOCKS - 1) + PERIOD; // beyond the last near street
  // near zone: 3x3 cells per block, cells 4k+1..4k+3
  for (let bk = 0; bk < NEAR_BLOCKS; bk++) {
    for (let bj = 0; bj < NEAR_BLOCKS; bj++) {
      for (let a = 1; a <= 3; a++) {
        for (let b = 1; b <= 3; b++) {
          const i = ROAD_EVERY * bk + a, j = ROAD_EVERY * bj + b;
          near.push({ id: `n${i}_${j}`, zone: 'near', cx: -HALF + (i + 0.5) * CELL, cz: -HALF + (j + 0.5) * CELL, size: CELL, cap: NEAR_CAP, taken: null });
        }
      }
    }
  }
  // far zone: every other block in range, 2x2 big plots
  const kMax = Math.ceil(FAR_EXTENT / PERIOD) + 1;
  for (let kx = -kMax; kx <= kMax; kx++) {
    for (let kz = -kMax; kz <= kMax; kz++) {
      if (kx >= 0 && kx < NEAR_BLOCKS && kz >= 0 && kz < NEAR_BLOCKS) continue;
      const bx = roadCenter(kx) + PERIOD / 2, bz = roadCenter(kz) + PERIOD / 2;
      if (Math.hypot(bx, bz) > FAR_EXTENT) continue;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        far.push({ id: `f${kx}_${kz}_${sx}${sz}`, zone: 'far', cx: bx + sx * 13.2, cz: bz + sz * 13.2, size: 26.4, cap: FAR_CAP, taken: null });
      }
    }
  }
  void nearMax;
  return { near, far };
}

export const PLOTS = buildPlots();

export function plotAt(x, z) {
  let best = null, bd = Infinity;
  for (const p of PLOTS.near) {
    const d = Math.hypot(p.cx - x, p.cz - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** nearest FREE near-zone plot to (x,z); optional predicate to filter (e.g. same district) */
export function nearestFreePlot(x, z, pred, allowFiller = false) {
  let best = null, bd = Infinity;
  for (const p of PLOTS.near) {
    if ((p.taken && !(allowFiller && p.taken === 'filler')) || (pred && !pred(p))) continue;
    const d = Math.hypot(p.cx - x, p.cz - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Assign every named slot (percent coords) to its own free plot, nearest-first, staying in its district. */
export function assignSlots(slots, toWorld, districts) {
  const distOf = (x, z) => {
    const px = (x / CITY_SIZE + 0.5) * 100, py = (z / CITY_SIZE + 0.5) * 100;
    const d = districts.find((q) => px >= q.bounds.x0 && px < q.bounds.x1 && py >= q.bounds.y0 && py < q.bounds.y1);
    return d ? d.id : -1;
  };
  const out = new Map();
  for (const s of slots) {
    const w = toWorld(s.x, s.y);
    const p = nearestFreePlot(w.x, w.z, (q) => distOf(q.cx, q.cz) === s.districtId) || nearestFreePlot(w.x, w.z);
    if (!p) throw new Error('no free plot for slot ' + s.id);
    p.taken = 'slot' + s.id;
    out.set(s.id, p);
  }
  return out;
}

// ---------------------------------------------------------------- audit
// Measures the REAL world-space footprint of every rendered building piece (instanced + named + admin) and
// reports any that touch asphalt or its sidewalk margin, plus any two neighbouring footprints that intersect.
const _m = new THREE.Matrix4(), _b = new THREE.Box3(), _v = new THREE.Vector3();
function corners(bb, m, out) {
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m);
    out.min.min(_v); out.max.max(_v);
  }
}
export function auditBoxes(root, { clear = SIDEWALK, ground = false } = {}) {
  root.updateMatrixWorld(true);
  const boxes = []; // {x0,x1,z0,z1,y1,label}
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    for (let q = o; q; q = q.parent) if (q.userData.noAudit) return; // airborne: flying cars, elevated sky-bridges, trail planes
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld);
        _b.makeEmpty(); corners(bb, _m, _b);
        boxes.push({ x0: _b.min.x, x1: _b.max.x, z0: _b.min.z, z1: _b.max.z, y1: _b.max.y, kind: 'inst' });
      }
    } else {
      _b.makeEmpty(); corners(bb, o.matrixWorld, _b);
      boxes.push({ x0: _b.min.x, x1: _b.max.x, z0: _b.min.z, z1: _b.max.z, y1: _b.max.y, kind: 'mesh', name: o.name, mat: o.material && o.material.type, geo: o.geometry.type, up: (o.parent && o.parent.parent && o.parent.parent.type) });
    }
  });
  const onRoad = boxes.filter((b) => b.y1 > 0.3 && boxHitsRoad(b.x0, b.x1, b.z0, b.z1, clear));
  void ground;
  return { total: boxes.length, onRoad };
}
