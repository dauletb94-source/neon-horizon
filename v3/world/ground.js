// Ground: wet reflective asphalt with lit curbs + animated light trails on every street, and a huge
// dark base so the horizon is never a void. Streets are the empty grid cells left by FillerField
// (every `roadEvery`-th cell), centred at (i+0.5)*cellSize.
import * as THREE from '../vendor/three/three.module.js';

const trailVert = `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const trailFrag = `
uniform float uTime; varying vec2 vUv; varying vec3 vW;
float h(float n){ return fract(sin(n*91.345)*47453.5453); }
void main(){
  // vUv.x across the road (0..1), vUv.y along it in world units
  float lane = vUv.x < 0.5 ? 0. : 1.;
  float across = abs(fract(vUv.x*2.)-0.5)*2.;           // 0 centre of lane .. 1 edge
  float dir = lane < .5 ? 1. : -1.;
  float along = vUv.y*0.16 + dir*uTime*(0.5+0.25*h(floor(vUv.y*0.16)*0.0+lane+floor(vW.x*0.01+vW.z*0.013)));
  float cell = floor(along);
  float f = fract(along);
  float on = step(0.55, h(cell*1.7 + lane*13. + floor(vW.x*0.02) + floor(vW.z*0.02)));
  float tail = smoothstep(0.0,0.07,f) * (1.-smoothstep(0.07,0.3,f));
  float core = smoothstep(0.55,0.0,across);
  vec3 c = lane < .5 ? vec3(1.0,0.92,0.75) : vec3(1.0,0.12,0.2);
  float a = on*tail*core;
  gl_FragColor = vec4(c*a*2.4, a);
}`;

export function buildGround(citySize, cellSize, roadEvery = 4, farExtent = citySize * 2.6) {
  const group = new THREE.Group();
  const cells = Math.round(citySize / cellSize);
  const half = citySize / 2;
  const roadW = cellSize * 0.5;

  // base: huge ground carrying the SAME street grid (tiled, one tile = one block + its streets) out past the far skyline,
  // so streets run all the way to the horizon and the layout stays one consistent grid everywhere.
  const period = cellSize * roadEvery;
  const tp = 1024, tcv = document.createElement('canvas'); tcv.width = tcv.height = tp;
  const tg = tcv.getContext('2d');
  { // street cross sits at (0.5 cell) inside each period, exactly like the near-city canvas below
    const rwT = (roadW / period) * tp, mid = (0.5 / roadEvery) * tp;
    tg.fillStyle = '#0c1226'; tg.fillRect(0, 0, tp, tp);               // paved block
    tg.strokeStyle = 'rgba(60,140,255,0.28)'; tg.lineWidth = 2;
    for (let k = 1; k < 8; k++) { tg.beginPath(); tg.moveTo((k * tp) / 8, 0); tg.lineTo((k * tp) / 8, tp); tg.moveTo(0, (k * tp) / 8); tg.lineTo(tp, (k * tp) / 8); tg.stroke(); }
    tg.fillStyle = '#080b12'; tg.fillRect(mid - rwT / 2, 0, rwT, tp); tg.fillRect(0, mid - rwT / 2, tp, rwT);
    for (const [col, k] of [['rgba(40,220,255,0.95)', -1], ['rgba(255,60,210,0.85)', 1]]) {
      tg.fillStyle = col; tg.fillRect(mid + k * rwT / 2 - 1.5, 0, 3, tp); tg.fillRect(0, mid + k * rwT / 2 - 1.5, tp, 3);
    }
    tg.fillStyle = 'rgba(255,214,140,0.6)';
    for (let y = 0; y < tp; y += 28) { tg.fillRect(mid - 1, y, 2, 13); tg.fillRect(y, mid - 1, 13, 2); }
  }
  const tileTex = new THREE.CanvasTexture(tcv); tileTex.colorSpace = THREE.SRGBColorSpace; tileTex.anisotropy = 16;
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  const S = Math.ceil((farExtent * 2.4) / period) * period; // plane size = whole number of tiles
  tileTex.repeat.set(S / period, S / period);
  // align tile phase with the layout: tile x-origin at world -half, tile y-origin at world z=-half
  tileTex.offset.set((half - S / 2) / period, 1 - half / period - S / (2 * period));
  const baseMat = new THREE.MeshStandardMaterial({ map: tileTex, emissiveMap: tileTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.25 });
  const base = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2), baseMat);
  base.position.y = -0.1; group.add(base);

  // city ground canvas: curbs + dashed centre line, emissive so bloom picks them up
  const px = 2048, c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'); g.fillStyle = '#05070c'; g.fillRect(0, 0, px, px);
  const cp = px / cells, rw = roadW / cellSize * cp;
  // city blocks: lit paving, plaza grid, warm lamp points and the odd park, so no bare dark ground shows between towers
  let sd = 4711; const rn = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  for (let r = 0; r < cells; r += roadEvery) {
    for (let q = 0; q < cells; q += roadEvery) {
      const x0 = (q + 0.5) * cp + rw / 2 + 4, y0 = (r + 0.5) * cp + rw / 2 + 4, bw = roadEvery * cp - rw - 8;
      const gr = g.createLinearGradient(x0, y0, x0 + bw, y0 + bw);
      gr.addColorStop(0, '#0d1a33'); gr.addColorStop(1, '#101530');
      g.fillStyle = gr; g.fillRect(x0, y0, bw, bw);
      g.strokeStyle = 'rgba(60,170,255,0.45)'; g.lineWidth = 2; g.strokeRect(x0 + 3, y0 + 3, bw - 6, bw - 6);
      g.strokeStyle = 'rgba(70,120,230,0.18)'; g.lineWidth = 1;
      for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x0 + (bw * k) / 6, y0); g.lineTo(x0 + (bw * k) / 6, y0 + bw); g.moveTo(x0, y0 + (bw * k) / 6); g.lineTo(x0 + bw, y0 + (bw * k) / 6); g.stroke(); }
      if (rn() < 0.35) { // pocket park
        const pw = bw * (0.25 + rn() * 0.2), px0 = x0 + rn() * (bw - pw), py0 = y0 + rn() * (bw - pw);
        g.fillStyle = 'rgba(30,150,70,0.8)'; g.fillRect(px0, py0, pw, pw);
        g.fillStyle = 'rgba(80,220,120,0.6)'; for (let k = 0; k < 14; k++) g.fillRect(px0 + rn() * pw, py0 + rn() * pw, 3, 3);
      }
      for (let k = 0; k < 40; k++) { g.fillStyle = rn() < 0.7 ? 'rgba(255,214,150,0.9)' : 'rgba(120,230,255,0.9)'; g.fillRect(x0 + rn() * bw, y0 + rn() * bw, 3, 3); }
    }
  }
  for (let i = 0; i < cells; i += roadEvery) {
    const mid = (i + 0.5) * cp;
    // asphalt strip
    g.fillStyle = '#0b0e16';
    g.fillRect(mid - rw / 2, 0, rw, px); g.fillRect(0, mid - rw / 2, px, rw);
    // neon curbs
    for (const [col, k] of [['rgba(40,220,255,0.95)', -1], ['rgba(255,60,210,0.85)', 1]]) {
      g.fillStyle = col;
      g.fillRect(mid + k * rw / 2 - 2, 0, 4, px); g.fillRect(0, mid + k * rw / 2 - 2, px, 4);
    }
    // dashed centre
    g.fillStyle = 'rgba(255,214,140,0.6)';
    for (let y = 0; y < px; y += 34) { g.fillRect(mid - 1.5, y, 3, 16); g.fillRect(y, mid - 1.5, 16, 3); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.25 });
  const city = new THREE.Mesh(new THREE.PlaneGeometry(citySize, citySize).rotateX(-Math.PI / 2), mat);
  city.position.set(0, 0.04, 0); group.add(city);

  // light trails (additive, animated)
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, vertexShader: trailVert, fragmentShader: trailFrag,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const len = farExtent * 2;
  const kMax = Math.ceil(farExtent / period) + 1;
  for (let k = -kMax; k <= kMax; k++) {
    const mid = -half + (roadEvery * k + 0.5) * cellSize;
    if (Math.abs(mid) > farExtent) continue;
    for (const rot of [0, 1]) {
      const geo = new THREE.PlaneGeometry(roadW * 0.86, len, 1, 1).rotateX(-Math.PI / 2);
      // uv.y spans 0..len world units
      const uv = geo.attributes.uv; for (let q = 0; q < uv.count; q++) uv.setY(q, uv.getY(q) * len);
      const m = new THREE.Mesh(geo, trailMat);
      m.position.set(rot ? 0 : mid, 0.08, rot ? mid : 0);
      if (rot) m.rotation.y = Math.PI / 2;
      m.renderOrder = 2; m.userData.noAudit = true; group.add(m);
    }
  }
  group.userData.trailMat = trailMat;
  return group;
}
