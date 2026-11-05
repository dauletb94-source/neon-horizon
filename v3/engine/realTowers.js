// Self-authored neon-edge helpers (CC0). The former downloaded CC-BY skyscraper loader was removed in pass 12 (strict CC0).
import * as THREE from '../vendor/three/three.module.js';

/** Thick glowing neon edges: every line segment (flat xyz pairs) becomes two crossed quads (visible from any side,
 *  `w` metres wide) so the outline is a real glowing strip that survives distance + bloom, not a 1px GL line. */
export function thickEdgeGeometry(pts, w = 0.4) {
  const nSeg = pts.length / 6, pos = new Float32Array(nSeg * 8 * 3), idx = new Uint32Array(nSeg * 12);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), fw = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < nSeg; i++) {
    a.fromArray(pts, i * 6); b.fromArray(pts, i * 6 + 3); d.subVectors(b, a).normalize();
    n1.crossVectors(d, Math.abs(d.y) > 0.9 ? fw : up).normalize().multiplyScalar(w / 2);
    n2.crossVectors(d, n1).normalize().multiplyScalar(w / 2);
    const o = i * 24, vs = [[a, n1, -1], [a, n1, 1], [b, n1, 1], [b, n1, -1], [a, n2, -1], [a, n2, 1], [b, n2, 1], [b, n2, -1]];
    vs.forEach(([p, n, sg], k) => { pos[o + k * 3] = p.x + n.x * sg; pos[o + k * 3 + 1] = p.y + n.y * sg; pos[o + k * 3 + 2] = p.z + n.z * sg; });
    const v = i * 8, q = i * 12;
    idx.set([v, v + 1, v + 2, v, v + 2, v + 3, v + 4, v + 5, v + 6, v + 4, v + 6, v + 7], q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
export const glowEdgeMaterial = (hex, k = 1.1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false, side: THREE.DoubleSide, fog: false });
// kept as empty stubs so legacy imports keep working: no downloaded models are loaded any more
export const realModels = [];
export const REAL_COUNT = 0;
export async function loadRealModels() {}
export function instantiateReal() { return null; }
export function nightMaterial() { return null; }
