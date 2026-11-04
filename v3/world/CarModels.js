// Shared loader for the realistic CC-BY car models (assets/models/cars, credits in assets/CREDITS.md).
// Every sub-mesh of a model is baked into one frame (+x = driving direction, y up, wheels at y = 0, centred, scaled to
// `len` metres) and merged per material, so each model costs 1-2 draw calls per InstancedMesh.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

export const CAR_DEFS = [
  { file: 'quadra.glb', flip: false, nose: 1 },  // nose = sign of the nose along +x after the bake
  { file: 'molnia.glb', flip: false, nose: 1 },
];
const cache = new Map();

export function loadCarModel(def, len) {
  const key = def.file + ':' + len;
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((resolve) => {
    new GLTFLoader().load('assets/models/cars/' + def.file, (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      // drop ground/floor planes baked into the source file (Quadra ships a 21 m "Boden" plane that otherwise shrinks the car)
      const isFloor = (o) => /boden|floor|ground|plane/i.test((o.material && o.material.name) || '') || /boden|floor|ground/i.test(o.name || '');
      const meshes = []; gltf.scene.traverse((o) => { if (o.isMesh && !isFloor(o)) meshes.push(o); });
      const box = new THREE.Box3(); meshes.forEach((o) => box.expandByObject(o));
      const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = len / Math.max(sz.x, sz.z);
      // long axis -> +x; def.flip turns the nose around (decided from renders)
      const yaw = (sz.x >= sz.z ? 0 : Math.PI / 2) + (def.flip ? Math.PI : 0);
      const T = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
      const byMat = new Map();
      for (const o of meshes) {
        let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(T);
        if (g.index) g = g.toNonIndexed();
        for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const m = o.material; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g);
      }
      const parts = [];
      for (const [mat, gs] of byMat) {
        const m = mat.clone(); m.envMapIntensity = 2.0; m.transmission = 0;
        if (m.emissiveMap) m.emissiveIntensity = 1.6;
        parts.push({ geometry: gs.length > 1 ? mergeGeometries(gs) : gs[0], material: m });
      }
      const bb = new THREE.Box3(); parts.forEach((q) => { q.geometry.computeBoundingBox(); bb.union(q.geometry.boundingBox); });
      resolve({ def, parts, size: bb.getSize(new THREE.Vector3()), box: bb });
    }, undefined, (e) => { console.error('car model failed', def.file, e && e.message || e); resolve(null); });
  });
  cache.set(key, p);
  return p;
}
