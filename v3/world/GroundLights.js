// Many small warm lights between the towers: street lamps along both kerbs of every street and scattered plaza /
// shop-front lights inside the blocks (like the glittering ground in city.jpg). One Points draw call, soft round
// additive sprites, depth-tested so towers hide the ones behind them. Lights stand on sidewalks / inside blocks only.
import * as THREE from '../vendor/three/three.module.js';
import { PERIOD, ROAD_W, roadCenter, SIDEWALK, PLOTS } from './layout.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class GroundLights {
  constructor(parent, { radius = 760, lampStep = 11, perBlock = 0 } = {}) {
    const r = rng(2024), pos = [], col = [], siz = [];
    const warm = [[1, 0.72, 0.38], [1, 0.82, 0.55], [1, 0.62, 0.3]], cool = [[0.4, 0.85, 1], [0.8, 0.45, 1], [1, 0.4, 0.8]];
    const push = (x, y, z, big) => {
      const c = r() < 0.86 ? warm[(r() * warm.length) | 0] : cool[(r() * cool.length) | 0];
      const k = 0.55 + r() * 0.75;
      pos.push(x, y, z); col.push(c[0] * k, c[1] * k, c[2] * k); siz.push(big ? 1.8 + r() * 1.4 : 1.0 + r() * 1.2);
    };
    const kMin = Math.floor((-radius - roadCenter(0)) / PERIOD), kMax = Math.ceil((radius - roadCenter(0)) / PERIOD);
    const edge = ROAD_W / 2 + SIDEWALK * 0.5;
    for (let k = kMin; k <= kMax; k++) {
      const c = roadCenter(k);
      for (let t = -radius; t <= radius; t += lampStep) {
        for (const side of [-1, 1]) {
          const o = c + side * edge, j = (r() - 0.5) * 1.5;
          if (r() < 0.55) { push(o, 4.2 + r() * 0.8, t + j, true); push(t + j, 4.2 + r() * 0.8, o, true); } // lamp heads on both axes
        }
      }
    }
    // clustered around real plazas: open plazas and low garden-roofed podiums get a dense ring of path lamps + a bright
    // core (rooftop gardens in city.jpg glow warm; the empty ground between towers stays dark)
    for (const p of PLOTS.near) {
      if (p.taken !== 'filler' || (p.h && p.h > 17)) continue;
      const roofY = p.h ? p.h + 0.6 : 0.6, half = (p.half || p.cap / 2) * 0.82, n = p.h ? 14 : 18;
      for (let q = 0; q < n; q++) {
        const a = (q / n) * Math.PI * 2 + r() * 0.3, rad = half * (0.35 + r() * 0.6);
        push(p.cx + Math.cos(a) * rad, roofY + r() * 1.4, p.cz + Math.sin(a) * rad, false);
      }
      for (let q = 0; q < 3; q++) push(p.cx + (r() - 0.5) * half * 0.8, roofY + 1.2, p.cz + (r() - 0.5) * half * 0.8, true);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(siz, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; varying float vF; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; vC = color;
          float d = -mv.z; gl_PointSize = clamp(size*uScale/d, 1.5, 6.5); vF = clamp(1.0 - d/2200., 0.25, 1.); }`,
      fragmentShader: `varying vec3 vC; varying float vF;
        void main(){ vec2 p = gl_PointCoord-.5; float d = length(p)*2.; float a = smoothstep(1.,0.,d); a = a*a;
          gl_FragColor = vec4(vC*(a*1.0 + smoothstep(.35,0.,d)*0.8)*vF, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false; this.points.renderOrder = 3; this.points.userData.noAudit = true; this.points.userData.noPick = true;
    parent.add(this.points);
    this.count = pos.length / 3;
  }
  // keep sprite size independent of the canvas height
  setViewportHeight(h) { this.points.material.uniforms.uScale.value = h * 0.6; }
}
