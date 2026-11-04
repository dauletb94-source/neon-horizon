// Distant skyline backdrop: a big inward-facing cylinder painted with a
// hazy silhouette of far-away towers, so the city reads as extending to the
// horizon instead of stopping dead in a black void past the last filler
// block (per owner feedback: "scene too dark and empty").
import * as THREE from '../vendor/three/three.module.js';

function mkSkylineTexture() {
  const W = 4096, H = 512, GY = H * 0.9;      // GY = ground line
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  let seed = 48217;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // Back -> front. Far layers are lighter and hazier (atmospheric perspective), near layers darker and taller,
  // each tower gets a vertical gradient (lit by city glow at its foot) and a grid of lit windows.
  const layers = [
    { hMin: 0.10, hMax: 0.34, top: [38, 56, 120], bot: [90, 70, 170], lit: 0.10, gap: 1.2, neon: 0.05 },
    { hMin: 0.10, hMax: 0.38, top: [24, 36, 92],  bot: [60, 70, 150], lit: 0.14, gap: 1.5, neon: 0.07 },
    { hMin: 0.09, hMax: 0.42, top: [14, 22, 66],  bot: [40, 60, 130], lit: 0.18, gap: 2.0, neon: 0.09 },
    { hMin: 0.08, hMax: 0.46, top: [8, 12, 44],   bot: [26, 44, 105], lit: 0.22, gap: 2.5, neon: 0.12 },
  ];
  for (const L of layers) {
    let x = -rnd() * 20;
    while (x < W) {
      const w = 14 + rnd() * 40;
      const h = H * (L.hMin + Math.pow(rnd(), 1.6) * (L.hMax - L.hMin));
      const g = ctx.createLinearGradient(0, GY - h, 0, GY);
      g.addColorStop(0, `rgb(${L.top.join(',')})`); g.addColorStop(1, `rgb(${L.bot.join(',')})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, GY - h, w, h + (H - GY));
      // stepped crown / antenna on some towers
      if (rnd() < 0.3) ctx.fillRect(x + w * 0.3, GY - h - h * 0.08, w * 0.4, h * 0.08);
      if (rnd() < 0.25) ctx.fillRect(x + w * 0.5 - 0.8, GY - h - 14 - rnd() * 22, 1.6, 40);
      // window grid
      const cw = 2.6, ch = 3.6;
      for (let yy = GY - h + 5; yy < GY - 3; yy += ch) {
        const rowOn = rnd() < 0.55;
        for (let xx = x + 2.5; xx < x + w - 3; xx += cw) {
          if (!rowOn || rnd() > L.lit * 1.3) continue;
          ctx.fillStyle = rnd() < 0.55 ? 'rgba(255,214,150,0.6)' : 'rgba(150,215,255,0.6)';
          ctx.fillRect(xx, yy, 1.2, 1.6);
        }
      }
      // neon edge strip / rooftop band
      if (rnd() < L.neon) {
        ctx.fillStyle = rnd() < 0.55 ? 'rgba(60,225,255,0.9)' : 'rgba(255,70,225,0.85)';
        ctx.fillRect(x, GY - h, 1.6, h * (0.4 + rnd() * 0.6));
        ctx.fillRect(x, GY - h, w, 1.8);
      }
      x += w + L.gap + rnd() * 4;
    }
  }
  // city glow haze rising from the ground line (blends the foot of the skyline into the horizon)
  const haze = ctx.createLinearGradient(0, GY - H * 0.32, 0, GY + 4);
  haze.addColorStop(0, 'rgba(70,130,255,0)'); haze.addColorStop(0.6, 'rgba(90,120,255,0.20)'); haze.addColorStop(1, 'rgba(200,110,255,0.42)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = haze; ctx.fillRect(0, GY - H * 0.32, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function buildDistantSkyline(radius, height) {
  const tex = mkSkylineTexture();
  const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true);
  // sink it slightly below ground level so there's no seam gap at the horizon
  geo.translate(0, height * 0.5 - height * 0.1 - 6, 0);
  tex.repeat.set(2, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,          // haze is painted into the texture; scene fog would erase it at this distance
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  return mesh;
}
