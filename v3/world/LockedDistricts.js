// Holographic "locked district" fences: a glowing scanline wall along the
// boundary shared with an already-unlocked district, shown/hidden as the
// resident count crosses each district's unlockFollowers threshold.
import * as THREE from '../vendor/three/three.module.js';

function fenceTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,120,60,0.0)';
  ctx.fillRect(0, 0, 64, 256);
  ctx.strokeStyle = 'rgba(255,150,70,0.55)';
  ctx.lineWidth = 1.5;
  for (let y = 6; y < 256; y += 22) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke();
  }
  // fade to transparent toward the top so it reads as a low holographic
  // barrier at street level, not a solid amber wall taller than the towers.
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,150,70,0.5)');
  grad.addColorStop(0.35, 'rgba(255,150,70,0.22)');
  grad.addColorStop(1, 'rgba(255,150,70,0)');
  ctx.fillStyle = grad;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export class LockedDistricts {
  constructor(scene, districts, toWorld, wallHeight = 2.2) {
    this.group = new THREE.Group();
    this.group.userData.noAudit = true; // see-through holographic boundary line, not a building
    scene.add(this.group);
    this.walls = new Map(); // districtId -> [meshes]
    const tex = fenceTexture();

    for (const d of districts) {
      const segs = [];
      for (const o of districts) {
        if (o.id === d.id) continue;
        const seg = sharedEdge(d.bounds, o.bounds);
        if (seg) segs.push(seg);
      }
      if (!segs.length) continue;
      const meshes = [];
      for (const seg of segs) {
        const p0 = toWorld(seg.x0, seg.y0);
        const p1 = toWorld(seg.x1, seg.y1);
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.6,
          blending: THREE.AdditiveBlending,
        });
        const geo = new THREE.PlaneGeometry(len, wallHeight);
        geo.translate(0, wallHeight / 2, 0);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2);
        mesh.rotation.y = -Math.atan2(p1.z - p0.z, p1.x - p0.x);
        this.group.add(mesh);
        meshes.push(mesh);
      }
      this.walls.set(d.id, meshes);
    }
  }

  setUnlocked(districtId, unlocked) {
    const meshes = this.walls.get(districtId);
    if (!meshes) return;
    for (const m of meshes) m.visible = !unlocked;
  }
}

function sharedEdge(a, b) {
  const EPS = 0.01;
  if (Math.abs(a.x1 - b.x0) < EPS || Math.abs(a.x0 - b.x1) < EPS) {
    const x = Math.abs(a.x1 - b.x0) < EPS ? a.x1 : a.x0;
    const y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
    if (y1 > y0) return { x0: x, y0, x1: x, y1 };
  }
  if (Math.abs(a.y1 - b.y0) < EPS || Math.abs(a.y0 - b.y1) < EPS) {
    const y = Math.abs(a.y1 - b.y0) < EPS ? a.y1 : a.y0;
    const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
    if (x1 > x0) return { x0, y0: y, x1, y1: y };
  }
  return null;
}
