// Flying cars with light-trail streaks, orbiting the city at varying radii
// and heights — matches the moving light trails in city.jpg / tower1.jpg.
import * as THREE from '../vendor/three/three.module.js';

function trailTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class FlyingCars {
  constructor(scene, count, citySize) {
    this.group = new THREE.Group();
    this.group.userData.noAudit = true;
    scene.add(this.group);
    this.cars = [];
    const tex = trailTexture();
    const colors = [0x7ef9ff, 0xff7ef0, 0xffd36a];

    for (let i = 0; i < count; i++) {
      const color = colors[i % colors.length];
      const radius = citySize * (0.12 + 0.38 * Math.random());
      const height = 14 + Math.random() * 46;
      const speed = 0.06 + Math.random() * 0.1;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const phase = Math.random() * Math.PI * 2;
      const wobbleAmp = 2 + Math.random() * 4;
      const wobbleFreq = 0.3 + Math.random() * 0.4;

      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.3, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x0c0e13, metalness: 0.85, roughness: 0.2, emissive: color, emissiveIntensity: 0.25 }),
      );
      g.add(body);
      const trail = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 0.07),
        new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      trail.position.x = -3.4;
      g.add(trail);
      this.group.add(g);
      this.cars.push({ g, radius, height, speed, dir, phase, wobbleAmp, wobbleFreq });
    }
  }

  update(t) {
    for (const c of this.cars) {
      const a = c.phase + t * c.speed * c.dir;
      const x = Math.cos(a) * c.radius;
      const z = Math.sin(a) * c.radius;
      const y = c.height + Math.sin(t * c.wobbleFreq + c.phase) * c.wobbleAmp;
      c.g.position.set(x, y, z);
      const tangent = new THREE.Vector3(-Math.sin(a) * c.dir, 0, Math.cos(a) * c.dir);
      c.g.lookAt(c.g.position.clone().add(tangent));
    }
  }
}
