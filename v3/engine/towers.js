// Tower library: loads the glTF skyscraper models (assets/models, see tools/gen_towers.py)
// and binds CC0 PBR materials by slot name:
//   glass  -> ambientCG Facade001/Facade006 (color/normal/roughness/metalness) + lit-window emissive map  [WALLS ONLY]
//   roof   -> plain dark concrete (no window texture can ever reach a roof)
//   neon / lamp / garden / trim -> unlit emissive or plain PBR
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from '../vendor/three/addons/loaders/RGBELoader.js';

export const KINDS = 12;
export const HERO_KINDS = [9, 11];
export const CLASS_HEIGHTS = [16, 30, 50, 78];
export const NEON = { cyan: 0x22e6ff, magenta: 0xff2fd0, blue: 0x3d7bff, violet: 0x9b5cff, amber: 0xffb02e, green: 0x38ff9c, gold: 0xffd34d };
const SKINS = [
  { mull: '#0b1228', paneTop: '#1d3f78', paneBot: '#0e2048', spandrel: '#070c1c', env: 1.7, density: 0.10, lit: ['#ffd9a0', '#ffe9c4', '#9fd8ff', '#7fb4ff'] },   // blue glass, warm + cool rooms
  { mull: '#111827', paneTop: '#33557f', paneBot: '#16263f', spandrel: '#0a101c', env: 2.0, density: 0.09, lit: ['#dff2ff', '#a8d6ff', '#ffe3b8', '#8fc0ff'] },   // chrome / pale curtain wall
  { mull: '#150f2a', paneTop: '#37297a', paneBot: '#190f40', spandrel: '#0a0716', env: 1.6, density: 0.11, lit: ['#ffd0e8', '#c9b8ff', '#9fe6ff', '#ffe2b0'] },   // smoked violet glass
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
function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
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

// Lit windows: floors lit in runs (like occupied offices), a few warm rooms, mostly dark; tiny, quiet cells.
function litTexture(skinIdx, seed) {
  const skin = SKINS[skinIdx];
  const c = mkCanvas(), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const rnd = mkRng(seed);
  for (let r = 0; r < ROWS; r++) {
    const occupied = rnd() < 0.55;
    const floorBias = occupied ? skin.density * (0.8 + rnd() * 2.2) : skin.density * 0.12;
    let colr = skin.lit[(rnd() * skin.lit.length) | 0];
    for (let q = 0; q < COLS; q++) {
      if (rnd() > floorBias) continue;
      if (rnd() < 0.2) colr = skin.lit[(rnd() * skin.lit.length) | 0];
      g.globalAlpha = 0.4 + rnd() * 0.5; g.fillStyle = colr;
      // canvas y is flipped vs uv.v (flipY) -> draw rows bottom-up so floor 0 is at the base
      g.fillRect(q * CELL + 6, (ROWS - 1 - r) * CELL + 8, CELL - 12, CELL - 17);
    }
  }
  g.globalAlpha = 1;
  return canvasTex(c, true);
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
  cache.glass.set(skinIdx, m);
  return m;
}

export function neonMaterial(color) {
  const key = typeof color === 'string' ? color : String(color);
  if (cache.neon.has(key)) return cache.neon.get(key);
  const hex = NEON[color] ?? color;
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.15), toneMapped: false });
  cache.neon.set(key, m); return m;
}

const fixed = {};
function fixedMat(name) {
  if (fixed[name]) return fixed[name];
  const m = {
    roof: new THREE.MeshStandardMaterial({ color: 0x1a2640, roughness: 0.55, metalness: 0.5, envMapIntensity: 1.1, emissive: 0x0a1226, emissiveIntensity: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.2 }),
    garden: new THREE.MeshStandardMaterial({ color: 0x2c8a45, roughness: 0.95, metalness: 0, emissive: 0x0e4a24, emissiveIntensity: 0.9 }),
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
  m.emissiveMap = litTexture(0, 777 + (typeof neon === 'string' ? neon.length : 3)); m.emissiveIntensity = 0.16; // lit atrium: dense glowing windows, not a flat slab
  cache.glass.set(key, m); return m;
}

export function materialFor(name, { skin = 0, neon = 'cyan' } = {}) {
  if (name === 'glow') return glowMaterial(neon === 'gold' ? 'amber' : neon);
  if (name === 'glass') return glassMaterial(skin);
  if (name === 'neon') return neonMaterial(neon);
  return fixedMat(name);
}

const gltf = new GLTFLoader();
export async function loadModels() {
  const manifest = await (await fetch('assets/models/manifest.json')).json();
  await Promise.all(manifest.map((e) => new Promise((res, rej) => {
    gltf.load('assets/models/' + e.file, (g) => {
      const meshes = [];
      g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      cache.glb.set(`${e.kind}_${e.heightClass}`, { meshes, height: e.height, kind: e.kind });
      res();
    }, undefined, rej);
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
