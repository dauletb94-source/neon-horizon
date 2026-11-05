// Real (downloaded, CC-BY — see assets/CREDITS.md) skyscraper glTF models, re-graded for night:
//   * albedo darkened + blue-shifted, glossy/metallic, reflecting the night HDRI
//   * lit windows are a shader mask over the WALLS only (|normal.y| small) — roofs can never get windows
//   * strong neon outline (feature edges) around every tower, like the hero towers in city.jpg
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/addons/libs/meshopt_decoder.module.js';
import { NEON } from './towers.js';

export const REAL_FILES = [
  { file: 'singapore_office.glb', name: 'office', edge: 38 },
  { file: 'skyscraper_tower.glb', name: 'tower', edge: 38 },
  { file: 'modern_tower_terraces.glb', name: 'terraces', edge: 38 },
  { file: 'london_skyscraper.glb', name: 'london', edge: 38 },
  { file: 'atlanta_office.glb', name: 'atlanta', edge: 38 },
  { file: 'alpha_tower.glb', name: 'alpha', edge: 38 },
  { file: 'metlife_building.glb', name: 'metlife', edge: 38 },
];
export const REAL_COUNT = REAL_FILES.length;

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
const models = [];
export const realModels = models;

const nightCache = new Map();
export function nightMaterial(src, tint, unit = 1) {
  const key = src.uuid + '|' + tint + '|' + unit;
  if (nightCache.has(key)) return nightCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    map: src.map || null, normalMap: src.normalMap || null,
    color: new THREE.Color(0x3d5688),
    metalness: 0.72, roughness: 0.16, envMapIntensity: 2.6,
    side: src.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: false,
  });
  if (m.map) m.map.anisotropy = 8;
  m.emissive = new THREE.Color(0xffffff);
  m.emissiveIntensity = 1.0;
  const lit = new THREE.Color(tint);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = { value: lit }; sh.uniforms.uUnit = { value: unit };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vLocN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position; vLocN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLocal; varying vec3 vLocN; uniform vec3 uLit; uniform float uUnit;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }`)
      .replace('#include <emissivemap_fragment>', `
{
  float wall = 1.0 - smoothstep(0.25, 0.5, abs(normalize(vLocN).y));   // walls only, never roofs/ledges
  float ang = vLocal.x + vLocal.z * 1.0;
  vec2 g = vec2(ang / (0.9 * uUnit), vLocal.y / (1.7 * uUnit));
  vec2 cell = floor(g), fc = fract(g);
  float r = h21(cell);
  float floorBias = h21(vec2(cell.y, 7.0));
  float on = step(0.58 - 0.22 * step(0.5, floorBias), r);
  vec2 fw2 = fwidth(g) * 1.5;
  // anti-aliased pane with soft edges; fades out as cells shrink below a pixel (no moire / blocky pixels at range)
  float px = max(fw2.x, fw2.y);
  float paneM = smoothstep(0.14, 0.14 + fw2.x + 0.04, fc.x) * (1.0 - smoothstep(0.86 - fw2.x - 0.04, 0.86, fc.x))
              * smoothstep(0.18, 0.18 + fw2.y + 0.04, fc.y) * (1.0 - smoothstep(0.78 - fw2.y - 0.04, 0.78, fc.y));
  float mullion = smoothstep(0.0, 0.05 + fw2.x, abs(fc.x - 0.5)) * 0.35 + 0.65;           // thin vertical glazing bar
  float inCell = paneM * mullion * (1.0 - smoothstep(0.35, 1.0, px));
  float vgrad = mix(0.55, 1.15, fc.y);                                                      // light pools toward the ceiling
  float bright = 0.45 + 0.55 * h21(cell + 3.7);                                              // every room its own brightness
  float lum = 1.0;
  #ifdef USE_MAP
    vec3 base = texture2D(map, vMapUv).rgb; lum = dot(base, vec3(0.3,0.59,0.11));
  #endif
  float pane = 1.0 - smoothstep(0.35, 0.75, lum);          // windows are the darker parts of the source texture
  vec3 warm = mix(uLit, vec3(0.62,0.82,1.0), step(0.5, h21(cell.yx)));
  float glassSheen = wall * paneM * 0.05 * (1.0 - smoothstep(0.35, 1.0, px));           // unlit panes still read as glass
  vec3 sheen = vec3(0.10,0.22,0.5) * glassSheen * 2.0;
  // glowing atrium / sky-lobby glass bands (blue-violet or magenta wash with floor lines), walls only
  float bandId = floor(vLocal.y / (uUnit * 7.5));
  float atr = step(0.84, h21(vec2(bandId, 3.1))) * wall;
  float flr = smoothstep(0.0, 0.12, abs(fract(vLocal.y / (uUnit * 1.7)) - 0.5) * 2.0 + 0.0);
  vec3 atrC = mix(vec3(0.25,0.45,1.0), vec3(0.85,0.3,1.0), step(0.75, h21(vec2(bandId, 9.9))));
  sheen += atrC * atr * (0.55 + 0.25 * flr) * (1.0 - smoothstep(0.35, 1.0, px) * 0.5);
  totalEmissiveRadiance = warm * on * inCell * wall * mix(0.35, 1.0, pane) * bright * vgrad * 1.7 * (1.0 - atr * 0.8) + sheen;
}`);
  };
  nightCache.set(key, m);
  return m;
}

export async function loadRealModels() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(REAL_FILES.map((f, i) => new Promise((res) => {
    loader.load('assets/models/real/' + f.file, (g) => {
      const root = g.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      // measure the tower shaft footprint at mid-height (podiums / plazas excluded from the aspect estimate)
      const meshes = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        meshes.push({ geo, mat: o.material });
      });
      // normalise: base centre at origin, y up from 0, unit height 1 -> consumers scale by H and footprint
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const T = new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz);
      for (const m of meshes) m.geo.applyMatrix4(T);
      models[i] = { meshes, height: size.y, w: size.x, d: size.z, name: f.name, edge: f.edge, unit: Math.max(0.6, size.y / 60) };
      res();
    }, undefined, () => { console.warn('real model failed', f.file); res(); });
  })));
  // feature edges for the neon outline
  for (const m of models) {
    if (!m) continue;
    const parts = [];
    for (const s of m.meshes) {
      if (s.geo.attributes.position.count > 60000) continue; // skip dense scan meshes; outline from the lighter parts
      const e = new THREE.EdgesGeometry(s.geo, m.edge);
      // keep only the long structural edges (corner pillars, crown rims, slab lines) -> clean neon outline, no mullion noise
      const a = e.attributes.position.array, keep = [], minLen = m.height * 0.12, seen = new Set(), hw = m.w / 2, hd = m.d / 2;
      for (let k = 0; k < a.length; k += 6) {
        const dx = a[k + 3] - a[k], dy = a[k + 4] - a[k + 1], dz = a[k + 5] - a[k + 2];
        if (Math.hypot(dx, dy, dz) < minLen) continue;
        const mx = (a[k] + a[k + 3]) / 2, my = (a[k + 1] + a[k + 4]) / 2, mz = (a[k + 2] + a[k + 5]) / 2;
        if (Math.max(Math.abs(mx) / hw, Math.abs(mz) / hd) < 0.9) continue; // outer silhouette only: no mullions / interior frames
        const vert = Math.abs(dy) > 0.9 * Math.hypot(dx, dy, dz);
        const key = (vert ? 'v' : 'h') + Math.round(mx / (0.12 * m.w)) + ',' + Math.round(mz / (0.12 * m.d)) + (vert ? '' : ',' + Math.round(my / (0.06 * m.height)));
        if (seen.has(key)) continue; seen.add(key);
        keep.push(a[k], a[k + 1], a[k + 2], a[k + 3], a[k + 4], a[k + 5]);
      }
      if (!keep.length) continue;
      const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
      parts.push(kg);
    }
    m.edges = parts;
  }
}

/** Build a clone of real model `idx` scaled to height H and capped to maxFoot. */
export function instantiateReal(idx, H, { maxFoot = 13, neon = 'cyan', tint = 0xffd9a0, outline = true } = {}) {
  const m = models[idx % models.length] || models[0];
  const sy0 = H / m.height;
  // allow vertical stretch (<=1.7x) so slender footprints still reach the requested height
  const sxz0 = Math.min(maxFoot / Math.max(m.w, m.d), sy0 * 1.7);
  const sxz = sxz0, sy = Math.min(sy0, sxz0 * 1.7);
  const g = new THREE.Group();
  for (const s of m.meshes) {
    const mesh = new THREE.Mesh(s.geo, nightMaterial(s.mat, tint, m.unit));
    mesh.userData.slot = 'glass';
    g.add(mesh);
  }
  if (outline) {
    const lm = glowEdgeMaterial(NEON[neon] ?? neon);
    // strip width is in model units; the group is scaled by sxz afterwards, so divide to get ~0.45 m on screen
    for (const e of m.edges) { const ls = new THREE.Mesh(thickEdgeGeometry(e.attributes.position.array, 0.26 / Math.max(sxz, 0.01)), lm); ls.userData.slot = 'neon'; g.add(ls); }
  }
  g.scale.set(sxz, sy, sxz);
  g.userData.height = m.height * sy;
  g.userData.footprint = { w: m.w * sxz, d: m.d * sxz };
  return g;
}
