// Tower library: loads the glTF skyscraper models (assets/models, see tools/gen_towers.py)
// and binds CC0 PBR materials by slot name:
//   glass  -> ambientCG Facade001/Facade006 (color/normal/roughness/metalness) + lit-window emissive map  [WALLS ONLY]
//   roof   -> plain dark concrete (no window texture can ever reach a roof)
//   neon / lamp / garden / trim -> unlit emissive or plain PBR
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from '../vendor/three/addons/loaders/RGBELoader.js';

export const KINDS = 16;
export const HERO_KINDS = [9, 11];
export const CLASS_HEIGHTS = [16, 30, 50, 78];
export const NEON = { cyan: 0x22e6ff, magenta: 0xff2fd0, blue: 0x3d7bff, violet: 0x9b5cff, amber: 0xffb02e, green: 0x38ff9c, gold: 0xffd34d };
const SKINS = [
  { mull: '#0b1228', paneTop: '#0e2552', paneBot: '#050e26', spandrel: '#04070f', env: 1.9, density: 0.55, lit: ['#ffc27a', '#35c8ff', '#4a8dff', '#2f7bff'] },   // blue glass, warm + cool rooms
  { mull: '#111827', paneTop: '#0f1e3c', paneBot: '#050a18', spandrel: '#05080f', env: 2.0, density: 0.48, lit: ['#5fd3ff', '#3d9dff', '#ffc888', '#4a7dff'] },   // chrome / pale curtain wall
  { mull: '#150f2a', paneTop: '#1f1648', paneBot: '#0c0724', spandrel: '#05030c', env: 1.9, density: 0.52, lit: ['#ff7ad0', '#9a7bff', '#4fd6ff', '#ffc080'] },   // smoked violet glass
];
export const FACADE_SKIN = { blueGlass: 0, smokedGlass: 2, chrome: 1, blackSteel: 0, whiteCeramic: 1 };

const texLoader = new THREE.TextureLoader();
let maxAniso = 8;
const cache = { glb: new Map(), tex: new Map(), glass: new Map(), neon: new Map() };

export function setAniso(v) { maxAniso = v; }

function loadTex(url, srgb, repeat) {
  const key = url + '|' + repeat.join(',');
  if (cache.tex.has(key)) return cache.tex.get(key);
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.tex.set(key, t);
  return t;
}

// One tile = 64 columns x 64 rows of 32px cells; the albedo, ORM and emissive canvases share this grid exactly,
// and the glTF UVs (tools/gen_towers.py: U_TILE 28.8 m, V_TILE 57.6 m) map one cell to one 0.45 x 0.9 m window.
const CELL = 32, COLS = 64, ROWS = 64;
function mkRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// iOS Safari caps total canvas memory (~384 MB) and getContext('2d') then returns null; 16 x 2048^2 facade canvases (~270 MB) blew it.
// On phones: downscale each baked facade to 1024^2 and free the canvas pixels once the texture is on the GPU.
const LOW_MEM = /iPhone|iPad|iPod|Android|Mobi/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function canvasTex(c, srgb) {
  if (LOW_MEM && c.width > 1024) {
    const s = document.createElement('canvas'); s.width = c.width >> 1; s.height = c.height >> 1;
    const sg = s.getContext('2d'); if (sg) { sg.drawImage(c, 0, 0, s.width, s.height); c.width = c.height = 1; c = s; }
  }
  const t = new THREE.CanvasTexture(c);
  if (LOW_MEM) t.onUpdate = () => { t.onUpdate = null; setTimeout(() => { c.width = c.height = 1; }, 0); };
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function mkCanvas() { const c = document.createElement('canvas'); c.width = COLS * CELL; c.height = ROWS * CELL; return c; }

// Reflective curtain wall: dark mirror panes + thin metal mullions + a spandrel band per floor.
// ORM: G = roughness, B = metalness (three.js reads exactly these channels).
function facadeTextures(skinIdx) {
  const skin = SKINS[skinIdx];
  const col = mkCanvas(), orm = mkCanvas(), g = col.getContext('2d'), o = orm.getContext('2d');
  g.fillStyle = skin.mull; g.fillRect(0, 0, col.width, col.height);
  o.fillStyle = 'rgb(255,150,225)'; o.fillRect(0, 0, orm.width, orm.height); // mullion: rough-ish metal
  const rnd = mkRng(1234 + skinIdx * 31);
  for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
    const x = q * CELL, y = r * CELL, v = rnd();
    const grad = g.createLinearGradient(x, y, x, y + CELL);
    grad.addColorStop(0, skin.paneTop); grad.addColorStop(1, skin.paneBot);
    g.fillStyle = grad; g.fillRect(x + 3, y + 4, CELL - 6, CELL - 11);   // glass
    g.fillStyle = skin.spandrel; g.fillRect(x + 3, y + CELL - 7, CELL - 6, 5);  // floor slab edge
    g.globalAlpha = 0.18 * v; g.fillStyle = '#9bd0ff'; g.fillRect(x + 3, y + 4, CELL - 6, CELL - 11); g.globalAlpha = 1; // pane-to-pane variation
    o.fillStyle = 'rgb(255,' + (40 + ((v * 30) | 0)) + ',150)'; o.fillRect(x + 3, y + 4, CELL - 6, CELL - 11); // pane: glossy mirror
  }
  return { map: canvasTex(col, true), orm: canvasTex(orm, false) };
}

// Lit windows: soft, varied lighting. Floors are lit in runs of rooms, every room has its own brightness and warmth,
// cells have blurred edges (light spilling through glass), and a faint cool wash lights whole floors from inside.
function litTexture(skinIdx, seed) {
  const skin = SKINS[skinIdx];
  const c = mkCanvas(), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const rnd = mkRng(seed);
  for (let r = 0; r < ROWS; r++) {
    const occupied = rnd() < 0.62;
    const floorBias = occupied ? skin.density * (0.7 + rnd() * 2.6) : skin.density * 0.1;
    const yy = (ROWS - 1 - r) * CELL;   // canvas y is flipped vs uv.v -> floor 0 at the base
    if (occupied && rnd() < 0.55) {      // whole-floor ambient wash (cool or warm), fading in/out along the floor
      const x0 = ((rnd() * COLS) | 0) * CELL, len = (6 + ((rnd() * 40) | 0)) * CELL;
      const gr = g.createLinearGradient(x0, 0, x0 + len, 0);
      const wc = rnd() < 0.6 ? '90,140,255' : '255,190,120';
      gr.addColorStop(0, `rgba(${wc},0)`); gr.addColorStop(0.5, `rgba(${wc},${(0.07 + rnd() * 0.12).toFixed(2)})`); gr.addColorStop(1, `rgba(${wc},0)`);
      g.fillStyle = gr; g.fillRect(x0, yy + 4, len, CELL - 10);
      if (x0 + len > c.width) { g.fillRect(x0 - c.width, yy + 4, len, CELL - 10); }
    }
    let colr = skin.lit[(rnd() * skin.lit.length) | 0];
    for (let q = 0; q < COLS; q++) {
      if (rnd() > floorBias) continue;
      if (rnd() < 0.25) colr = skin.lit[(rnd() * skin.lit.length) | 0];
      const a = Math.pow(rnd(), 0.9) * 0.65 + 0.35;         // many dim rooms, a few bright ones
      g.save(); g.shadowColor = colr; g.shadowBlur = 5 + a * 6;
      g.globalAlpha = a; g.fillStyle = colr;
      g.fillRect(q * CELL + 7, yy + 9, CELL - 14, CELL - 19);
      g.restore();
    }
  }
  g.globalAlpha = 1;
  return canvasTex(c, true);
}

// Big glowing glass section (atrium / sky-lobby / media facade): lit from within in a blue-violet or magenta wash,
// with floor lines, mullions and a scatter of brighter rooms. UV tile = 7.2 m x 7.2 m (loft UVs are metres / 28.8, / 57.6).
function glowGlassTexture(tone) {
  // smooth vertical-gradient wash with a faint floor-line grid; per-cell variation is tiny so it does not read as tile noise
  const S = 512, N = 8, cs = S / N;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mkRng(tone === 'magenta' ? 31 : tone === 'cyan' ? 57 : 77);
  const pal = tone === 'magenta' ? [[255, 90, 220], [170, 70, 255]] : tone === 'cyan' ? [[60, 220, 255], [60, 140, 255]] : [[70, 120, 255], [150, 90, 255]];
  g.fillStyle = '#05081a'; g.fillRect(0, 0, S, S);
  for (let r = 0; r < N; r++) {
    const gr = g.createLinearGradient(0, r * cs, 0, (r + 1) * cs);
    const k = 0.8 + rnd() * 0.15, a = pal[0];
    gr.addColorStop(0, `rgb(${a.map((v) => (v * k * 0.8) | 0)})`); gr.addColorStop(1, `rgb(${pal[1].map((v) => (v * k * 0.45) | 0)})`);
    g.fillStyle = gr; g.fillRect(0, r * cs + 2, S, cs - 5);                      // continuous floor band (no per-window cells)
    for (let q = 0; q < N; q++) if (rnd() < 0.1) { g.fillStyle = 'rgba(235,245,255,0.22)'; g.fillRect(q * cs + 8, r * cs + 10, cs - 16, cs - 24); }
  }
  g.fillStyle = 'rgba(5,8,26,0.55)'; for (let q = 0; q < N; q++) g.fillRect(q * cs - 1, 0, 2, S);   // thin mullions
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 4); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
export function glowGlassMaterial(tone = 'blue') {
  const key = 'glowglass:' + tone;
  if (cache.glass.has(key)) return cache.glass.get(key);
  const map = glowGlassTexture(tone);
  const m = new THREE.MeshStandardMaterial({ color: 0x111a33, map, emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: 1.15, metalness: 0.35, roughness: 0.22, envMapIntensity: 1.5 });
  cache.glass.set(key, m); return m;
}

// world-space low-frequency variation of the lit-window emission: whole floors / patches of the facade glow
// brighter or dimmer, breaking up the repeating tile (instancing-aware).
function varyLighting(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vec4 wv4 = vec4(transformed,1.);\n#ifdef USE_INSTANCING\n wv4 = instanceMatrix * wv4;\n#endif\n vWV = (modelMatrix * wv4).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWV;
float vh(vec2 p){ p=fract(p*vec2(.1031,.1030)); p+=dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(vh(i),vh(i+vec2(1,0)),f.x),mix(vh(i+vec2(0,1)),vh(i+vec2(1,1)),f.x),f.y); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float hz = vWV.x + vWV.z;
        float zone = vn(vec2(hz*.045, vWV.y*.06)) * .6 + vn(vec2(hz*.17, vWV.y*.21)) * .4;      // patches of floors, tens of metres across
        float flr = vh(vec2(floor(vWV.y/2.7), floor(hz*.02) + 3.)) ;                              // per-floor-run brightness
        totalEmissiveRadiance *= mix(.45, 1.7, smoothstep(.15, .7, zone)) * mix(.45, 1.2, flr)
          + vec3(.02,.05,.13) * smoothstep(.55,.9,zone) * (.4 + flr);
        // fine near-field detail: each window is split by a thin mullion into two sub-panes with their own brightness,
        // plus faint blind slats; all of it fades to the plain average once a sub-pane is smaller than ~a pixel.
        vec2 sc = vec2(hz / .225, vWV.y / .15); vec2 sid = floor(sc), sf = fract(sc);
        float spx = max(fwidth(sc.x), fwidth(sc.y)), nf = smoothstep(.35, .9, spx);
        float mull = smoothstep(0., .14, sf.x) * smoothstep(1., .86, sf.x);
        float slat = .82 + .18 * smoothstep(.1, .5, abs(sf.y - .5) * 2.);
        float sub = .55 + .9 * vh(vec2(floor(hz / .225), floor(vWV.y / .9)) + 11.);
        totalEmissiveRadiance *= mix(mull * slat * sub, 1., nf); }`);
  };
  m.customProgramCacheKey = () => 'varyLighting';
  return m;
}

export function glassMaterial(skinIdx) {
  if (cache.glass.has(skinIdx)) return cache.glass.get(skinIdx);
  const skin = SKINS[skinIdx];
  const { map, orm } = facadeTextures(skinIdx);
  const m = new THREE.MeshStandardMaterial({
    map, roughnessMap: orm, metalnessMap: orm,
    color: 0xffffff, metalness: 1.0, roughness: 1.0, envMapIntensity: skin.env,
    emissive: new THREE.Color(0xffffff), emissiveMap: litTexture(skinIdx, 4242 + skinIdx * 77), emissiveIntensity: 0.85,
  });
  varyLighting(m);
  cache.glass.set(skinIdx, m);
  return m;
}

// Hero-tower glass: same crisp curtain-wall grid, but mirror-bright (strong env reflection) with denser lit rooms.
export function heroGlassMaterial(skinIdx = 0) {
  const key = 'hero' + skinIdx;
  if (cache.glass.has(key)) return cache.glass.get(key);
  const m = glassMaterial(skinIdx).clone();
  m.envMapIntensity = 2.2; m.emissiveIntensity = 1.8; m.roughness = 0.8;
  m.emissiveMap = litTexture(skinIdx, 9100 + skinIdx * 53); // own lit pattern (denser than ambient towers)
  varyLighting(m);
  cache.glass.set(key, m); return m;
}

export function neonMaterial(color) {
  const key = typeof color === 'string' ? color : String(color);
  if (cache.neon.has(key)) return cache.neon.get(key);
  const hex = NEON[color] ?? color;
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(0.85), toneMapped: false });
  cache.neon.set(key, m); return m;
}


// planted roof terrace: world-space procedural canopy (dark/light foliage clumps, hedge rows, tiny warm path lamps).
function gardenMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x174a26, roughness: 0.95, metalness: 0, emissive: 0x0a4a1c, emissiveIntensity: 1.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vec4 gw4 = vec4(transformed,1.);\n#ifdef USE_INSTANCING\n gw4 = instanceMatrix * gw4;\n#endif\n vGW = (modelMatrix * gw4).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGW;
float gh(vec2 p){ p=fract(p*vec2(.1031,.1030)); p+=dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 gp = vGW.xz; float canopy = gn(gp*1.7)*.6 + gn(gp*5.3)*.4;
      float hedge = step(.86, fract(gp.x*.22)) + step(.9, fract(gp.y*.22));
      diffuseColor.rgb *= mix(.35, 1.5, canopy) * (1. + .3*hedge);
      vec2 lc = floor(gp*.5); float lamp = step(.93, gh(lc)) * smoothstep(.22,.0,length(fract(gp*.5)-.5));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= mix(.5, 1.2, canopy); totalEmissiveRadiance += vec3(1.,.8,.45) * lamp * 4.5 + vec3(.15,.9,.4) * hedge * .5;`);
  };
  return m;
}

const fixed = {};
function fixedMat(name) {
  if (fixed[name]) return fixed[name];
  const m = {
    roof: new THREE.MeshStandardMaterial({ color: 0x1a2640, roughness: 0.55, metalness: 0.5, envMapIntensity: 1.1, emissive: 0x0a1226, emissiveIntensity: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.2 }),
    garden: gardenMaterial(),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe3b0).multiplyScalar(1.25), toneMapped: false }),
  }[name];
  fixed[name] = m; return m;
}

// glowing glass band (illuminated atrium / core): same panel grid, lit from within, tinted by the neon colour
function glowMaterial(neon) {
  const key = 'glow:' + neon;
  if (cache.glass.has(key)) return cache.glass.get(key);
  const m = glassMaterial(0).clone();
  const c = new THREE.Color(NEON[neon] ?? neon);
  m.color = c.clone().multiplyScalar(0.18);
  m.emissive = c.clone().multiplyScalar(0.4);
  m.emissiveMap = litTexture(0, 777 + (typeof neon === 'string' ? neon.length : 3)); m.emissiveIntensity = 0.3; // lit atrium: dense glowing windows, not a flat slab
  cache.glass.set(key, m); return m;
}

export function materialFor(name, { skin = 0, neon = 'cyan' } = {}) {
  if (name === 'glow') return glowMaterial(neon === 'gold' ? 'amber' : neon);
  if (name === 'glass') return glassMaterial(skin);
  if (name === 'neon') return neonMaterial(neon);
  return fixedMat(name);
}

const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export async function loadModels() {
  const manifest = await (await fetch('assets/models/manifest.json')).json();
  await Promise.all(manifest.map((e) => new Promise((res, rej) => {
    gltf.load('assets/models/' + e.file, (g) => {
      const meshes = [];
      g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      cache.glb.set(`${e.kind}_${e.heightClass}`, { meshes, height: e.height, kind: e.kind });
      res();
    }, undefined, (err) => { console.error("tower model failed", e.file, err); res(); });
  })));
}

// Footprint (x/z extent at scale 1, podium included) of a loaded model, cached on the model.
export function modelDims(model) {
  if (!model.dims) {
    const box = new THREE.Box3();
    for (const m of model.meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
    model.dims = { w: box.max.x - box.min.x, d: box.max.z - box.min.z };
  }
  return model.dims;
}
export function modelFor(kind, heightClass) { return cache.glb.get(`${kind}_${heightClass}`); }
export function classForHeight(h) {
  let best = 0, bd = 1e9;
  CLASS_HEIGHTS.forEach((ch, i) => { const d = Math.abs(Math.log(h / ch)); if (d < bd) { bd = d; best = i; } });
  return best;
}

// Full independent clone of a tower with materials bound for this building.
export function instantiate(kind, H, { skin = 0, neon = 'cyan', maxFoot = Infinity } = {}) {
  const hc = classForHeight(H);
  const model = modelFor(kind % KINDS, hc);
  const scale = THREE.MathUtils.clamp(H / model.height, 0.55, 1.45);
  // horizontal scale is capped so the tower (podium included) always fits inside its plot; height stays free
  const dims = modelDims(model);
  const sxz = Math.min(scale, maxFoot / Math.max(dims.w, dims.d));
  const g = new THREE.Group();
  for (const src of model.meshes) {
    const mesh = new THREE.Mesh(src.geometry, materialFor(src.material.name, { skin, neon }));
    mesh.userData.slot = src.material.name;
    g.add(mesh);
  }
  g.scale.set(sxz, scale, sxz);
  g.userData.height = model.height * scale;
  const box = new THREE.Box3().setFromObject(g);
  g.userData.footprint = { w: box.max.x - box.min.x, d: box.max.z - box.min.z };
  return g;
}

// HDRI (Poly Haven, CC0) -> PMREM environment for glass reflections.
export function loadHDRI(renderer) {
  return new Promise((resolve) => {
    new RGBELoader().setDataType(THREE.FloatType).load('assets/hdri/modern_buildings_night_1k.hdr', (tex) => {
      // street lamps in the HDR are 100s of times brighter than the sky; mirrored in glass they bloom into white blobs
      const d = tex.image.data; for (let i = 0; i < d.length; i += 4) { // night grade: cool the sodium-orange lamps toward the neon-blue of the reference
        d[i] = Math.min(d[i], 2.0) * 0.5; d[i + 1] = Math.min(d[i + 1], 2.0) * 0.8; d[i + 2] = Math.min(d[i + 2], 2.5) * 1.25;
      }
      tex.needsUpdate = true;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(tex);
      pm.dispose();
      resolve({ env: rt.texture, hdr: tex });
    }, undefined, () => resolve(null));
  });
}
