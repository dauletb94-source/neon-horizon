// Small geometry builder for axis-aligned slabs (garden podiums, sky-bridges).
// walls: 4 side quads per box, UVs in world metres / tile size so the shared curtain-wall texture tiles at its
// native 0.45 x 0.9 m window size (same grid as the glTF towers). tops: one up-facing quad per box (roof/garden).
import * as THREE from '../vendor/three/three.module.js';

const U_TILE = 28.8, V_TILE = 57.6;

export class SlabBuilder {
  constructor() { this.w = { p: [], n: [], u: [], i: [] }; this.t = { p: [], n: [], u: [], i: [] }; }
  _quad(B, a, b, c, d, nrm, uvs) {
    const v = B.p.length / 3;
    for (const q of [a, b, c, d]) B.p.push(q[0], q[1], q[2]);
    for (let k = 0; k < 4; k++) B.n.push(nrm[0], nrm[1], nrm[2]);
    for (const q of uvs) B.u.push(q[0], q[1]);
    B.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  /** box centred on (cx,cz), spanning y0..y0+h, size sx x sz. walls=false -> top only */
  box(cx, y0, cz, sx, h, sz, { walls = true, top = true, topY = null } = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + h;
    if (walls) {
      const vv0 = y0 / V_TILE, vv1 = y1 / V_TILE;
      // +z, -z, +x, -x faces (counter-clockwise seen from outside)
      this._quad(this.w, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0 / U_TILE, vv0], [x1 / U_TILE, vv0], [x1 / U_TILE, vv1], [x0 / U_TILE, vv1]]);
      this._quad(this.w, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[x1 / U_TILE, vv0], [x0 / U_TILE, vv0], [x0 / U_TILE, vv1], [x1 / U_TILE, vv1]]);
      this._quad(this.w, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[z1 / U_TILE, vv0], [z0 / U_TILE, vv0], [z0 / U_TILE, vv1], [z1 / U_TILE, vv1]]);
      this._quad(this.w, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0 / U_TILE, vv0], [z1 / U_TILE, vv0], [z1 / U_TILE, vv1], [z0 / U_TILE, vv1]]);
    }
    if (top) {
      const ty = topY ?? y1;
      this._quad(this.t, [x0, ty, z1], [x1, ty, z1], [x1, ty, z0], [x0, ty, z0], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    return this;
  }
  static _geo(B) {
    if (!B.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    g.setIndex(B.i);
    return g;
  }
  walls() { return SlabBuilder._geo(this.w); }
  tops() { return SlabBuilder._geo(this.t); }
}

/** rectangle outline at height y as line-segment pairs (flat xyz array) for thickEdgeGeometry */
export function rectOutline(cx, y, cz, sx, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  return [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0];
}
