// Procedural material/texture factory for the Neon Horizon city.
// Everything here is generated at runtime with Canvas2D -> THREE.CanvasTexture,
// tuned for crisp, high-res windows and moody PBR glass. No external image assets.
import * as THREE from '../vendor/three/three.module.js';

const NEON_COLORS = {
  cyan: '#2be7ff',
  magenta: '#ff3bd4',
  blue: '#3b6bff',
  violet: '#9b4bff',
  amber: '#ffb23b',
  green: '#39ffb0',
  red: '#ff3b5c',
  white: '#eaf6ff',
};

// Base tones were near-pure-black (rgb ~5-10) before; combined with the
// scene's modest night lighting, ACES tonemapping crushed them to literal
// zero so facades disappeared and only the emissive lit-window rectangles
// remained visible ("invisible black box" bug). Lifted again here and
// metalness pulled down: high metalness kills the diffuse term (metals only
// show environment reflections), and with a mostly-dark night sky as the
// env map that reflection was itself near-black, so the facades still read
// as empty silhouettes with just floating lit windows. Lower metalness lets
// direct scene lights (hemisphere/moon/fill) actually shade the glass.
const FACADES = {
  blueGlass: { base: 0x1c3356, tint: 0x3f6aa8, metalness: 0.4, roughness: 0.32 },
  smokedGlass: { base: 0x1b2030, tint: 0x323b50, metalness: 0.38, roughness: 0.42 },
  chrome: { base: 0x242832, tint: 0x9aa4ba, metalness: 0.85, roughness: 0.18 },
  blackSteel: { base: 0x161a22, tint: 0x2c323e, metalness: 0.5, roughness: 0.45 },
  whiteCeramic: { base: 0x262b34, tint: 0x565f6e, metalness: 0.22, roughness: 0.46 },
};

let _maxAniso = 8;
export function setMaxAnisotropy(v) { _maxAniso = v; }

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Cache of generated window texture sets so we only pay the canvas cost a handful of times.
const _winCache = new Map();

// Every facade texture is baked at this fixed design grid (cols x rows) and
// a fixed canvas resolution, then TILED across a real building face via
// texture.repeat computed from the face's actual world-unit size (see
// computeWindowRepeat). Previously repeat was always left at (1,1) and the
// whole grid was stretched to cover the entire face regardless of its real
// size -- on a tall tower that smears one pane into a huge rectangle, and
// combined with a near-invisible unlit base (see below) that stretched lit
// pane read as a "floating square" detached from any visible structure.
// Tiling at a fixed world-unit cell size keeps window pitch constant and
// sharp across every building, matching the dense regular grid in city.jpg.
const WIN_TILE_COLS = 8;
const WIN_TILE_ROWS = 18;
const CELL_WORLD_W = 1.9; // world units per window bay
const CELL_WORLD_H = 2.9; // world units per floor
const TILE_WORLD_W = WIN_TILE_COLS * CELL_WORLD_W;
const TILE_WORLD_H = WIN_TILE_ROWS * CELL_WORLD_H;

export function computeWindowRepeat(realWidth, realHeight) {
  return {
    x: Math.max(1, realWidth / TILE_WORLD_W),
    y: Math.max(1, realHeight / TILE_WORLD_H),
  };
}

/**
 * Builds a window-grid texture pair (color map + emissive map) for a glass
 * tower face at the fixed WIN_TILE_COLS x WIN_TILE_ROWS design grid. Callers
 * tile it across the real face size with computeWindowRepeat() instead of
 * baking a different grid per building, so a modest number of seed variants
 * are reused (tiled) across hundreds of buildings at a consistent, sharp
 * real-world window pitch.
 */
export function getWindowTextureSet(themeKey, seed) {
  const cacheKey = `${themeKey}:${seed}`;
  if (_winCache.has(cacheKey)) return _winCache.get(cacheKey);

  const cols = WIN_TILE_COLS, rows = WIN_TILE_ROWS;
  const W = 1024, H = 1536;
  const pad = Math.round(W / cols * 0.08);
  const colorCanvas = mkCanvas(W, H);
  const emisCanvas = mkCanvas(W, H);
  const cctx = colorCanvas.getContext('2d');
  const ectx = emisCanvas.getContext('2d');

  const theme = FACADES[themeKey] || FACADES.blueGlass;
  const baseHex = '#' + theme.base.toString(16).padStart(6, '0');
  const tintHex = '#' + theme.tint.toString(16).padStart(6, '0');
  // Soft vertical gradient (brighter near the top) so the facade reads as
  // reflective glass catching sky light, not a flat fill.
  const baseGrad = cctx.createLinearGradient(0, 0, 0, H);
  baseGrad.addColorStop(0, tintHex);
  baseGrad.addColorStop(0.3, baseHex);
  baseGrad.addColorStop(1, baseHex);
  cctx.fillStyle = baseGrad;
  cctx.fillRect(0, 0, W, H);
  // Baseline self-illumination wash across the WHOLE face (not just lit
  // windows): under the night lighting rig, a purely physically-lit dark
  // glass base can tonemap all the way down to literal (0,0,0) wherever the
  // sky/key light doesn't hit it, which made unlit panes vanish entirely and
  // left only the bright lit-window rects visible, "floating" with nothing
  // behind them. A faint uniform emissive tint guarantees every pane stays
  // visibly glass-like regardless of light direction.
  ectx.fillStyle = tintHex;
  ectx.globalAlpha = 0.16;
  ectx.fillRect(0, 0, W, H);
  ectx.globalAlpha = 1;

  // deterministic PRNG so the same seed always yields the same window pattern
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  const litRatio = 0.14 + rnd() * 0.18; // denser lit-window pattern, closer to city.jpg's skyline
  // Cap lit cells per row: pure independent-random placement occasionally
  // clusters several lit cells in one row, which (since each texture is
  // reused across dozens of filler buildings) turns into a visible repeated
  // "stripe" across the skyline. Capping keeps the look scattered instead.
  const maxLitPerRow = Math.max(1, Math.round(cols * 0.45));
  const litColors = ['#ffcf8a', '#ffe9c2', '#bfe0ff', '#eef6ff'];
  const cw = W / cols, ch = H / rows;
  for (let r = 0; r < rows; r++) {
    let litInRow = 0;
    for (let c = 0; c < cols; c++) {
      const x = c * cw + pad, y = r * ch + pad;
      const w = cw - pad * 2, h = ch - pad * 2;
      // Visible glass pane, bright enough to read as a distinct tile even
      // under weak/no direct light (unlit panes in city.jpg are still
      // clearly visible medium-blue glass, not holes in a black wall).
      const shade = 0.8 + rnd() * 0.4;
      cctx.fillStyle = `rgba(200,224,255,${(0.22 + (shade - 0.8) * 0.3).toFixed(3)})`;
      cctx.fillRect(x, y, w, h);
      // bright mullion frame around every pane -- this is what makes the
      // facade read as a windowed glass tower instead of a flat black box.
      cctx.strokeStyle = 'rgba(210,228,250,0.85)';
      cctx.lineWidth = Math.max(1.5, cw * 0.035);
      cctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      if (litInRow < maxLitPerRow && rnd() < litRatio) {
        litInRow++;
        const col = litColors[(rnd() * litColors.length) | 0];
        ectx.fillStyle = col;
        ectx.globalAlpha = 0.55 + rnd() * 0.4;
        ectx.fillRect(x + 1, y + 1, w - 2, h - 2);
        ectx.globalAlpha = 1;
      }
    }
  }

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  const emisTex = new THREE.CanvasTexture(emisCanvas);
  for (const t of [colorTex, emisTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = _maxAniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
  }
  const set = { colorTex, emisTex, theme };
  _winCache.set(cacheKey, set);
  return set;
}

// realWidth/realHeight are the actual world-unit size of the face being
// textured -- used to tile the fixed design grid at a constant window pitch
// (see computeWindowRepeat) instead of stretching one grid over the whole face.
export function glassMaterial(themeKey, seed, realWidth, realHeight) {
  const { colorTex, emisTex, theme } = getWindowTextureSet(themeKey, seed);
  const ct = colorTex.clone(); ct.needsUpdate = true;
  const et = emisTex.clone(); et.needsUpdate = true;
  const rep = computeWindowRepeat(realWidth, realHeight);
  ct.repeat.set(rep.x, rep.y); et.repeat.set(rep.x, rep.y);
  return new THREE.MeshPhysicalMaterial({
    map: ct,
    emissiveMap: et,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 0.75,
    metalness: theme.metalness,
    roughness: theme.roughness,
    // Previously also multiplied by theme.tint on top of a texture that was
    // ALREADY baked with that same tint in its gradient -- squaring the
    // darkening and crushing facades to literal black under ACES tonemap.
    // The texture carries all the facade color now; leave material color neutral.
    color: new THREE.Color(0xffffff),
    // Driven way up from 0.35: this is what lets the glass actually pick up
    // the night-sky/city-glow environment map as visible reflections instead
    // of reading as a flat black silhouette.
    envMapIntensity: 1.3,
    clearcoat: themeKey === 'chrome' ? 0.5 : 0.18,
    clearcoatRoughness: 0.25,
  });
}

export function neonMaterial(colorName) {
  const hex = NEON_COLORS[colorName] || NEON_COLORS.cyan;
  const c = new THREE.Color(hex);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: true });
}

export function neonColorHex(colorName) {
  return NEON_COLORS[colorName] || NEON_COLORS.cyan;
}

export const NEON_COLOR_KEYS = Object.keys(NEON_COLORS);
export const FACADE_KEYS = Object.keys(FACADES);

export function podiumMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x0c0e13, metalness: 0.5, roughness: 0.55 });
}

export function roadMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x05060a, metalness: 0.2, roughness: 0.8 });
}

export function foliageMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1a7a4a, emissive: 0x0a3a24, emissiveIntensity: 0.4, roughness: 0.8 });
}
