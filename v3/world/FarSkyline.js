// Dense lit far skyline out to the horizon (replaces the thin 1-tower-per-block horizon ring).
// ~20k towers in 4 silhouette families (slab / stepped / wedge / spired) drawn as 4 InstancedMeshes with a procedural
// window shader: lit rooms only on WALLS (roofs get dark slab + neon rim / garden / beacon), per-tower tint + density,
// floors lit in runs, distance-aware filtering so far towers resolve into a glowing lit mass instead of noise.
// Emissive light is attenuated by fog far less than the base colour, so the skyline stays lit all the way to the haze.
// Every tower stands inside a block (same street grid as world/layout.js), never on a road.
import * as THREE from '../vendor/three/three.module.js';
import { roadCenter, PERIOD, FAR_EXTENT } from './layout.js';

export const SKYLINE_EXTENT = 2900;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// unit footprint (1 x 1), unit height; y in [0,1]; local y>1 = spire, tier marker via position
function boxGeo(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; }
function merge(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
function families() {
  const slab = boxGeo(1, 1, 1);
  const stepped = merge([boxGeo(1, 0.62, 1), boxGeo(0.7, 0.26, 0.7, 0, 0.62), boxGeo(0.42, 0.12, 0.42, 0, 0.88)]);
  const spired = merge([boxGeo(1, 0.9, 1), boxGeo(0.62, 0.08, 0.62, 0, 0.9), boxGeo(0.07, 0.2, 0.07, 0, 0.98)]);
  const wedgeG = new THREE.BoxGeometry(1, 1, 1); wedgeG.translate(0, 0.5, 0);
  const p = wedgeG.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.99) p.setY(i, 1 - (p.getX(i) + 0.5) * 0.22);
  wedgeG.computeVertexNormals();
  // pass 11 silhouettes: twin towers of unequal height, podium + slim tower, and a 4-tier ziggurat
  const twin = merge([boxGeo(0.46, 0.78, 0.9, -0.26, 0, 0), boxGeo(0.4, 1.0, 0.7, 0.28, 0, 0.05), boxGeo(0.12, 0.06, 0.2, 0, 0.55, 0)]);
  const podTower = merge([boxGeo(1, 0.22, 1), boxGeo(0.58, 0.64, 0.58, 0, 0.22), boxGeo(0.4, 0.14, 0.4, 0, 0.86)]);
  const zig = merge([boxGeo(1, 0.4, 1), boxGeo(0.8, 0.3, 0.8, 0, 0.4), boxGeo(0.58, 0.2, 0.58, 0, 0.7), boxGeo(0.34, 0.1, 0.34, 0, 0.9)]);
  return [slab, stepped, wedgeG, spired, twin, podTower, zig];
}

const VERT = `
attribute vec4 aP;   // density, seed, roofType, glow
attribute vec3 aTint;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec4 vP; varying vec3 vTint; varying float vDist; varying vec3 vSize;
void main(){
  vec4 w = modelMatrix * instanceMatrix * vec4(position,1.);
  vW = w.xyz; vL = position; vN = normal; vP = aP; vTint = aTint;
  vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 mv = viewMatrix * w; vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uFogC; uniform float uFogD; uniform float uTime;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec4 vP; varying vec3 vTint; varying float vDist; varying vec3 vSize;
float h2(vec2 p){ p=fract(p*vec2(.1031,.1030)); p+=dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
void main(){
  float fogF = 1. - exp(-pow(vDist*uFogD, 2.));
  vec3 base = vec3(0.012,0.022,0.055) * (0.6 + 0.8*h2(vec2(vP.y*13.1, 4.2)));
  vec3 emis = vec3(0.);
  bool wall = abs(vN.y) < 0.5;
  float seed = vP.y;
  if (wall) {
    // coordinate along the wall (no instance rotation: walls facing x use z and vice versa)
    float along = abs(vN.x) > 0.5 ? vW.z : vW.x;
    vec2 cell = vec2(along / 2.7, vW.y / 3.6);
    vec2 id = floor(cell), f = fract(cell);
    float floorLit = h2(vec2(id.y, seed*7.7));                 // floors lit in runs
    float run = h2(vec2(floor(id.x/6.), id.y*0.5 + seed*3.1)); // room clusters along a floor
    float room = h2(id + seed*91.7);
    float dens = vP.x * (0.35 + 1.3*floorLit) * (0.5 + run);
    float on = step(room, dens);
    float bright = 0.35 + 0.65*h2(id*1.7 + seed*5.);
    vec3 warm = vec3(1.0,0.72,0.42), cool = vec3(0.55,0.8,1.0), white = vec3(1.0,0.95,0.9);
    float cs = h2(id + seed*17.);
    vec3 lc = cs < 0.5 ? warm : (cs < 0.8 ? white : cool);
    lc = mix(lc, vTint, 0.5);
    float px = max(fwidth(cell.x), fwidth(cell.y));          // pixels shrinking below a cell -> fade to the mean glow
    float fade = smoothstep(0.35, 0.9, px);
    float mullion = smoothstep(0.0,0.12,f.x) * smoothstep(1.0,0.88,f.x) * smoothstep(0.0,0.16,f.y) * smoothstep(1.0,0.84,f.y);
    // far: keep it speckled (coarse random lit rooms + faint mean) instead of a flat pastel average
    vec2 cc = floor(cell / vec2(3.0, 2.0));
    float sparkle = step(h2(cc + seed*3.3), dens*0.55) * (0.25 + 0.5*h2(cc*1.9 + seed));
    float lit = mix(on*bright*mullion, sparkle * 0.55 + min(dens,0.8)*0.03, fade);
    emis = lc * lit * 1.2;
    // glowing floor wash + vertical gradient (bright base glow of the street, dimmer higher up)
    float hn = clamp(vW.y / (vSize.y*1.0), 0., 1.);
    emis += vTint * 0.02 * floorLit * (1.-hn*0.6) * (1.-fade);
    // neon corner strips on some towers: vertical lines at the building edges
    float edge = max(abs(vL.x), abs(vL.z));
    float strip = step(0.46, edge) * step(vP.w, 0.5);
    emis += vTint * strip * 1.3 * (0.6 + 0.4*sin(vW.y*0.05)) * (1. - 0.85*fogF);
    base += vec3(0.01,0.02,0.05) * f.y;
    // lit crown: a glowing band near the top of ~45% of towers (cyan / magenta / tint), plus a second lower band on a few
    float crown = step(0.55, h2(vec2(seed, 9.1)));
    float hy = vL.y;
    float band = smoothstep(0.86, 0.9, hy) * (1. - smoothstep(0.935, 0.965, hy));
    float band2 = step(0.8, h2(vec2(seed, 3.3))) * smoothstep(0.7, 0.73, hy) * (1. - smoothstep(0.745, 0.77, hy));
    vec3 cc2 = h2(vec2(seed, 5.5)) < 0.5 ? vec3(0.1,0.9,1.0) : vec3(1.0,0.2,0.85);
    emis += cc2 * crown * (band + band2*0.7) * 2.6 * (1. - 0.6*fogF);
  } else if (vN.y > 0.5) {
    // roof: no windows ever. dark slab; neon rim, garden, or beacon by roof type
    float edge = max(abs(vL.x), abs(vL.z));
    float rim = smoothstep(0.38, 0.45, edge);
    vec3 rc = h2(vec2(seed, 5.5)) < 0.5 ? vec3(0.1,0.9,1.0) : vec3(1.0,0.2,0.85);
    if (vP.z < 0.5) emis += mix(vTint, rc, 0.7) * rim * 3.6;                      // neon crown
    else if (vP.z < 0.74) { if (edge < 0.36) { base = vec3(0.012,0.05,0.016); emis += vec3(0.1,0.55,0.18) * 0.55 * (0.6+0.4*h2(floor(vW.xz*0.5))); } emis += vTint*rim*0.8; } // rooftop garden
    else if (h2(floor(vW.xz*0.8)+seed) > 0.97) emis += vec3(1.,0.9,0.7)*1.2;                                                              // lone lamps
    if (vL.y > 1.005) emis += vec3(1.,0.15,0.1) * 2.5;               // beacon on the spire tip
  }
  vec3 c = mix(base, uFogC, fogF) + emis * (1. - 0.72*fogF);
  gl_FragColor = vec4(c, 1.);
}`;

export class FarSkyline {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.userData.farSkyline = true;
    parent.add(this.group);
    const rnd = mulberry32(777001);
    const fams = families();
    const lists = fams.map(() => []);
    const kMax = Math.ceil(SKYLINE_EXTENT / PERIOD) + 1;
    const inner = FAR_EXTENT * 0.985;
    const TINTS = [[0.1, 0.8, 1.0], [0.1, 0.8, 1.0], [0.25, 0.45, 1.0], [1.0, 0.2, 0.85], [0.6, 0.35, 1.0], [1.0, 0.65, 0.3], [0.2, 1.0, 0.7]];
    for (let kx = -kMax; kx <= kMax; kx++) for (let kz = -kMax; kz <= kMax; kz++) {
      const bx = roadCenter(kx) + PERIOD / 2, bz = roadCenter(kz) + PERIOD / 2, r = Math.hypot(bx, bz);
      if (r <= inner || r > SKYLINE_EXTENT) continue;
      const k = (r - inner) / (SKYLINE_EXTENT - inner);
      const cluster = 0.5 + 0.5 * Math.sin(bx * 0.0031 + 1.7) * Math.sin(bz * 0.0027 + 0.3); // low-frequency downtown clusters
      const swell = Math.sin(Math.min(1, k * 1.25) * Math.PI) * 0.55 + 0.55;               // tall mid-distance, lower toward haze
      const plots = [];
      if (rnd() < 0.3) plots.push([bx, bz, 30 + rnd() * 14]);
      else for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (rnd() > 0.04) plots.push([bx + sx * 13.2, bz + sz * 13.2, 13 + rnd() * 10]);
      for (const [x, z, cap] of plots) {
        const tall = Math.pow(rnd(), 1.7);
        const hm = rnd(), hmix = hm < 0.34 ? 0.35 + rnd() * 0.25 : hm < 0.8 ? 0.7 + rnd() * 0.4 : 1.1 + rnd() * 0.35; // low / mid / tall
        const H = (30 + tall * 200 * (0.35 + cluster)) * swell * hmix + rnd() * 16;
        const fr = rnd(), fam = fr < 0.26 ? 0 : fr < 0.4 ? 1 : fr < 0.52 ? 2 : fr < 0.62 ? 3 : fr < 0.76 ? 4 : fr < 0.9 ? 5 : 6;
        const tint = TINTS[(rnd() * TINTS.length) | 0];
        lists[fam].push({ x, z, w: cap * (0.8 + rnd() * 0.2), d: cap * (0.8 + rnd() * 0.2), H, tint, dens: 0.12 + rnd() * 0.5, seed: rnd() * 50, roof: rnd(), glow: rnd() });
      }
    }
    this.uniforms = { uFogC: { value: new THREE.Color(0x081a44) }, uFogD: { value: 0.00085 }, uTime: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, extensions: { derivatives: true } });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.count = 0;
    fams.forEach((geo, fi) => {
      const list = lists[fi]; if (!list.length) return;
      const g = geo.clone();
      const aP = new Float32Array(list.length * 4), aT = new Float32Array(list.length * 3);
      const im = new THREE.InstancedMesh(g, this.mat, list.length);
      list.forEach((t, i) => {
        im.setMatrixAt(i, m4.compose(p.set(t.x, 0, t.z), q, s.set(t.w, t.H, t.d)));
        aP.set([t.dens, t.seed, t.roof, t.glow], i * 4); aT.set(t.tint, i * 3);
      });
      g.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(aT, 3));
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
      im.userData.farSkyline = true;
      im.onBeforeRender = (_r, scene) => { if (scene.fog) { this.uniforms.uFogC.value.copy(scene.fog.color); this.uniforms.uFogD.value = scene.fog.density; } };
      this.group.add(im); this.count += list.length;
    });
  }
}
