// Elevated glowing sky-bridges between nearby tall towers, with a small
// light pulse animated along each span — matches the connecting bridges
// visible between towers in city.jpg.
import * as THREE from '../vendor/three/three.module.js';
import { materialFor, glassMaterial } from '../engine/towers.js';
const neonMaterial = (c) => materialFor('neon', { neon: c === 'white' ? 0xffffff : c });

const MAX_BRIDGES = 6;
const MAX_DIST = 46;
const MIN_HEIGHT = 20;

export class SkyBridges {
  constructor(scene, namedBuildings) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pulses = [];

    const tall = namedBuildings.filter((b) => b.topY >= MIN_HEIGHT);
    const used = new Set();
    let built = 0;
    for (let i = 0; i < tall.length && built < MAX_BRIDGES; i++) {
      if (used.has(tall[i].id)) continue;
      let best = null, bestDist = Infinity;
      for (let j = 0; j < tall.length; j++) {
        if (i === j || used.has(tall[j].id)) continue;
        const dist = tall[i].group.position.distanceTo(tall[j].group.position);
        if (dist < bestDist && dist < MAX_DIST) { bestDist = dist; best = tall[j]; }
      }
      if (!best) continue;
      used.add(tall[i].id); used.add(best.id);
      built++;
      this._addBridge(tall[i], best);
    }
  }

  _addBridge(a, b) {
    // Rectangular glass-and-steel span (no round tubes) with neon edge rails and travelling light dashes.
    const h = Math.min(a.topY, b.topY) * 0.58;
    const p0 = new THREE.Vector3(a.group.position.x, h, a.group.position.z);
    const p1 = new THREE.Vector3(b.group.position.x, h, b.group.position.z);
    const len = p0.distanceTo(p1);
    const g = new THREE.Group();
    g.position.copy(p0.clone().lerp(p1, 0.5));
    g.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(len, 1.5, 2.2), materialFor('trim')));
    const win = new THREE.Mesh(new THREE.BoxGeometry(len * 0.98, 0.7, 2.24), glassMaterial(0));
    win.geometry.attributes.uv.array.forEach((v, i, arr) => { arr[i] = v * (i % 2 ? 0.05 : len / 17.6); });
    g.add(win);
    for (const sz of [-1.15, 1.15]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), neonMaterial('cyan'));
      r.position.set(0, 0.8, sz); g.add(r);
    }
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.5), neonMaterial('white'));
    dash.position.y = 0.82; g.add(dash);
    g.traverse((o) => { o.userData.noAudit = true; }); // elevated span over the street, not a building on it
    this.group.add(g);
    this.pulses.push({ dash, len, speed: 0.12 + Math.random() * 0.08, phase: Math.random() });
  }

  update(t) {
    for (const p of this.pulses) p.dash.position.x = (((t * p.speed + p.phase) % 1) - 0.5) * p.len;
  }
}
