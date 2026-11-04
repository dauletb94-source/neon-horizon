// Modular building parts: podium, tower segments, crowns, neon trim, rooftop items.
// Each function returns a THREE.Group (or Mesh) positioned relative to building origin (ground = y0).
import * as THREE from '../vendor/three/three.module.js';
import { glassMaterial, neonMaterial, podiumMaterial, foliageMaterial } from '../engine/materials.js';

const FLOOR_H = 3.2; // meters-ish per floor before world scale

function prism(width, depth, height, topScale = 1, segments = 4) {
  // CylinderGeometry with `segments` radial sides makes a square/N-gon prism.
  // topScale < 1 tapers the top (chamfered/slanted silhouette), rotated 45deg so flat faces align to X/Z.
  const r = Math.max(width, depth) * 0.5 * Math.SQRT2;
  const geo = new THREE.CylinderGeometry(r * topScale, r, height, segments, 1, false);
  geo.rotateY(Math.PI / 4);
  geo.scale(width / (r * 2), 1, depth / (r * 2));
  return geo;
}

function twistGeometry(geo, totalTwist) {
  const pos = geo.attributes.position;
  const bbox = geo.boundingBox || geo.computeBoundingBox();
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y, maxY = geo.boundingBox.max.y;
  const span = Math.max(0.0001, maxY - minY);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y - minY) / span;
    const ang = t * totalTwist;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const x = v.x * ca - v.z * sa;
    const z = v.x * sa + v.z * ca;
    pos.setXYZ(i, x, v.y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function buildPodium(width, depth, height, seed, neonColor = 'cyan') {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(width * 1.18, height, depth * 1.18);
  const mesh = new THREE.Mesh(geo, podiumMaterial());
  mesh.position.y = height / 2;
  g.add(mesh);
  // thin horizontal neon belt at podium top
  const belt = new THREE.Mesh(new THREE.BoxGeometry(width * 1.2, 0.18, depth * 1.2), neonMaterial(neonColor));
  belt.position.y = height - 0.1;
  g.add(belt);
  g.userData.topY = height;
  return g;
}

// archetype: 'setback' | 'chamfer' | 'cylinder' | 'twist'
export function buildTowerShaft(spec) {
  const { width, depth, totalHeight, baseY, facade, seed, archetype } = spec;
  const g = new THREE.Group();
  let y = baseY;
  let topW = width, topD = depth; // cross-section at the roofline, for the rooftop trim + crown fit

  if (archetype === 'setback') {
    const segCount = 2 + (seed % 3); // 2-4 stacked segments
    let w = width, d = depth;
    const segH = totalHeight / segCount;
    for (let i = 0; i < segCount; i++) {
      const h = segH * (i === segCount - 1 ? 1 : 0.92 + (seed % 7) * 0.01);
      const mat = glassMaterial(facade, seed * 13 + i * 97, w, h);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.y = y + h / 2;
      g.add(mesh);
      edgeTrimBox(g, w, d, h, y, spec.neonColor);
      roofTrim(g, w, d, y + h, spec.neonColor);
      y += h;
      topW = w; topD = d;
      w *= 0.8; d *= 0.8;
    }
  } else if (archetype === 'chamfer') {
    const mat = glassMaterial(facade, seed * 13, width, totalHeight);
    const geo = prism(width, depth, totalHeight, 0.55, 4);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y + totalHeight / 2;
    g.add(mesh);
    edgeTrimPrism(g, width, depth, totalHeight, y, 0.55, spec.neonColor);
    y += totalHeight;
    topW = width * 0.55; topD = depth * 0.55;
    roofTrim(g, topW, topD, y, spec.neonColor);
  } else if (archetype === 'cylinder') {
    const r = Math.max(width, depth) * 0.5;
    const mat = glassMaterial(facade, seed * 13, 2 * Math.PI * r, totalHeight);
    const geo = new THREE.CylinderGeometry(r * 0.92, r, totalHeight, 28, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y + totalHeight / 2;
    g.add(mesh);
    ringTrim(g, r * 0.97, totalHeight, y, spec.neonColor, 6);
    y += totalHeight;
    topW = topD = r * 0.92 * 2;
    roofRing(g, r * 0.92, y, spec.neonColor);
  } else { // twist
    const mat = glassMaterial(facade, seed * 13, Math.PI * Math.max(width, depth), totalHeight);
    const geo = prism(width, depth, totalHeight, 0.8, 8);
    twistGeometry(geo, Math.PI * 0.35);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y + totalHeight / 2;
    g.add(mesh);
    ringTrim(g, Math.max(width, depth) * 0.5, totalHeight, y, spec.neonColor, 4);
    y += totalHeight;
    topW = topD = Math.max(width, depth) * 0.8;
    roofRing(g, Math.max(width, depth) * 0.4, y, spec.neonColor);
  }

  g.userData.topY = y;
  g.userData.topW = topW;
  g.userData.topD = topD;
  return g;
}

// Straight-segment neon frame tracing the roofline of a box-footprint tower
// top, so every rooftop reads as a distinct glowing deck edge (per the brief:
// neon edge lines on corners AND rooftops). Four separate box segments, not a
// closed ring, so it never reads as a glowing "circle on the roof".
function roofTrim(group, width, depth, y, colorName) {
  const mat = neonMaterial(colorName);
  const t = 0.16;
  const hw = width / 2, hd = depth / 2;
  const segs = [
    [0, hd - t / 2, width - t, t], [0, -hd + t / 2, width - t, t],
    [hw - t / 2, 0, t, depth - t], [-hw + t / 2, 0, t, depth - t],
  ];
  for (const [dx, dz, bw, bd] of segs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.12, bd), mat);
    m.position.set(dx, y, dz);
    group.add(m);
  }
}

// Rooftop edge marker for round (cylinder/twist) tops: short radial tick
// segments around the rim instead of a continuous glowing disc/ring, which
// the brief explicitly bans ("no circles/ellipses on roofs").
function roofRing(group, radius, y, colorName) {
  const mat = neonMaterial(colorName);
  const ticks = 10;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const len = radius * 0.22;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.1), mat);
    m.position.set(Math.cos(a) * (radius - len * 0.4), y, Math.sin(a) * (radius - len * 0.4));
    m.rotation.y = -a;
    group.add(m);
  }
}

function edgeTrimBox(group, width, depth, height, baseY, colorName) {
  const mat = neonMaterial(colorName);
  const t = 0.12;
  const corners = [
    [width / 2 - t / 2, depth / 2 - t / 2],
    [width / 2 - t / 2, -depth / 2 + t / 2],
    [-width / 2 + t / 2, depth / 2 - t / 2],
    [-width / 2 + t / 2, -depth / 2 + t / 2],
  ];
  for (const [cx, cz] of corners) {
    const geo = new THREE.BoxGeometry(t, height * 0.985, t);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, baseY + height / 2, cz);
    group.add(m);
  }
}

function edgeTrimPrism(group, width, depth, height, baseY, topScale, colorName) {
  const mat = neonMaterial(colorName);
  const t = 0.14;
  const hw = width / 2 - t / 2, hd = depth / 2 - t / 2;
  const corners = [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]];
  for (const [cx, cz] of corners) {
    const geo = new THREE.CylinderGeometry(t * topScale, t, height * 0.985, 4, 1);
    geo.rotateY(Math.PI / 4);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx * (1 + topScale) * 0.5, baseY + height / 2, cz * (1 + topScale) * 0.5);
    group.add(m);
  }
  // diagonal accent on front face
  const diag = new THREE.Mesh(new THREE.BoxGeometry(t, height * 0.5, t), mat);
  diag.position.set(0, baseY + height * 0.3, depth / 2 + 0.02);
  diag.rotation.z = Math.PI / 5;
  group.add(diag);
}

function ringTrim(group, radius, height, baseY, colorName, count) {
  // Vertical neon ribs only, like the reference towers' edge-lit silhouettes.
  // A past version added a horizontal accent ring of boxes wrapping the
  // cylinder at mid-height; at a distance that read as a stack of glowing
  // discs ("tube building with rings") which the owner explicitly rejected.
  // Never add a full-circumference horizontal band here.
  const mat = neonMaterial(colorName);
  const t = 0.12;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const geo = new THREE.BoxGeometry(t, height * 0.985, t);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.cos(a) * radius, baseY + height / 2, Math.sin(a) * radius);
    group.add(m);
  }
  // Two short diagonal accent chevrons break up long shafts without
  // forming a closed ring (mirrors the asymmetric accents in tower1/tower2).
  for (const frac of [0.35, 0.72]) {
    const a = (frac * count * 1.7) % (Math.PI * 2);
    const segH = height * 0.16;
    const geo = new THREE.BoxGeometry(t, segH, t);
    const m = new THREE.Mesh(geo, mat);
    const a2 = a + 0.9;
    m.position.set(Math.cos(a2) * radius, baseY + height * frac, Math.sin(a2) * radius);
    group.add(m);
  }
}

// crown archetypes: 'spire' | 'slanted' | 'helipad' | 'antenna' | 'garden'
export function buildCrown(kind, width, depth, baseY, colorName, seed) {
  const g = new THREE.Group();
  const neon = neonMaterial(colorName);
  if (kind === 'spire') {
    // A real tapering mast, not a toy traffic-cone with a ball glued on top
    // (that combo is explicitly banned by the brief). Built from a stepped
    // glass/steel collar (volume, so it reads as structure from above too),
    // TWO crossed flattened glowing blades 90deg apart (a single flattened
    // blade reads as a flat crude triangle/line from a side-on angle; the
    // cross gives it a thick needle silhouette from every angle, matching
    // the reference towers' spires) and a hair-thin radio mast above with a
    // tiny rectangular aviation-obstruction light -- never a sphere.
    const minWD = Math.min(width, depth);
    const collarH = Math.max(1.4, width * 0.26);
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(minWD * 0.2, minWD * 0.32, collarH, 8),
      glassMaterial('chrome', seed, Math.PI * minWD * 0.5, collarH),
    );
    collar.position.y = baseY + collarH / 2;
    g.add(collar);
    // narrower step collar on top of the first, for a layered/machined look
    const step2H = collarH * 0.6;
    const collar2 = new THREE.Mesh(
      new THREE.CylinderGeometry(minWD * 0.14, minWD * 0.2, step2H, 8),
      glassMaterial('chrome', seed + 7, Math.PI * minWD * 0.34, step2H),
    );
    collar2.position.y = baseY + collarH + step2H / 2;
    g.add(collar2);
    roofRing(g, minWD * 0.32, baseY + collarH * 0.12, colorName);

    const bladeBaseY = baseY + collarH + step2H;
    const h = Math.max(7, width * 1.6);
    for (const rot of [0, Math.PI / 2]) {
      const bladeGeo = new THREE.ConeGeometry(minWD * 0.17, h, 4, 1);
      bladeGeo.rotateY(Math.PI / 4 + rot);
      bladeGeo.scale(1, 1, 0.4); // flatten into a blade silhouette, not a round cone
      const blade = new THREE.Mesh(bladeGeo, neon);
      blade.position.y = bladeBaseY + h / 2;
      g.add(blade);
      // thin edge ribs so the blade still reads as structure under bloom
      for (const side of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.98, 0.05), neon);
        const off = side * minWD * 0.14;
        rib.position.set(Math.sin(rot) * off, bladeBaseY + h / 2, Math.cos(rot) * off);
        g.add(rib);
      }
    }

    const mastH = h * 0.3;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, mastH, 5), podiumMaterial());
    mast.position.y = bladeBaseY + h + mastH / 2;
    g.add(mast);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), neonMaterial('red'));
    beacon.position.y = bladeBaseY + h + mastH;
    g.add(beacon);
  } else if (kind === 'slanted') {
    const h = Math.max(3, width * 0.4);
    const geo = prism(width * 0.9, depth * 0.9, h, 0.15, 4);
    const mesh = new THREE.Mesh(geo, glassMaterial('chrome', seed, width * 0.9, h));
    mesh.position.y = baseY + h / 2;
    g.add(mesh);
    edgeTrimPrism(g, width * 0.9, depth * 0.9, h, baseY, 0.15, colorName);
  } else if (kind === 'helipad') {
    // Square landing deck with a flush-painted "H" marking, not a glowing
    // circle — the owner's spec explicitly bans circles/ellipses on roofs.
    const pw = width * 0.78, pd = depth * 0.78;
    const plat = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.3, pd), podiumMaterial());
    plat.position.y = baseY + 0.15;
    g.add(plat);
    const markCanvas = document.createElement('canvas');
    markCanvas.width = 256; markCanvas.height = 256;
    const mctx = markCanvas.getContext('2d');
    mctx.strokeStyle = 'rgba(255,255,255,0.75)'; mctx.lineWidth = 14;
    mctx.strokeRect(20, 20, 216, 216);
    mctx.fillStyle = 'rgba(255,255,255,0.85)';
    mctx.fillRect(70, 60, 24, 136); mctx.fillRect(162, 60, 24, 136); mctx.fillRect(70, 118, 116, 20);
    const markTex = new THREE.CanvasTexture(markCanvas);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(pw, pd) * 0.75, Math.min(pw, pd) * 0.75),
      new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = baseY + 0.31;
    g.add(mark);
    // thin neon frame around the deck edge (straight segments, not a ring)
    for (const [dx, dz, bw, bd] of [[0, pd / 2, pw, 0.1], [0, -pd / 2, pw, 0.1], [pw / 2, 0, 0.1, pd], [-pw / 2, 0, 0.1, pd]]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.06, bd), neon);
      edge.position.set(dx, baseY + 0.33, dz);
      g.add(edge);
    }
    for (let i = 0; i < 4; i++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), podiumMaterial());
      const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      const [sx, sz] = corners[i];
      pole.position.set(sx * pw * 0.46, baseY + 1, sz * pd * 0.46);
      g.add(pole);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), neonMaterial('red'));
      beacon.position.set(sx * pw * 0.46, baseY + 1.75, sz * pd * 0.46);
      g.add(beacon);
    }
  } else if (kind === 'antenna') {
    const n = 3 + (seed % 3);
    for (let i = 0; i < n; i++) {
      const h = 2 + (i % 3) * 1.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 6), podiumMaterial());
      pole.position.set((i - n / 2) * (width * 0.18), baseY + h / 2, (i % 2) * depth * 0.1);
      g.add(pole);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), neonMaterial('red'));
      tip.position.set(pole.position.x, baseY + h, pole.position.z);
      g.add(tip);
    }
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.6, depth * 0.6), glassMaterial('blackSteel', seed, width * 0.6, 0.6));
    slab.position.y = baseY + 0.3;
    g.add(slab);
  } else if (kind === 'garden') {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width * 0.95, 0.5, depth * 0.95), podiumMaterial());
    slab.position.y = baseY + 0.25;
    g.add(slab);
    const fmat = foliageMaterial();
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = Math.min(width, depth) * 0.3;
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + (i % 3) * 0.15, 0), fmat);
      bush.position.set(Math.cos(a) * r, baseY + 0.9, Math.sin(a) * r);
      g.add(bush);
    }
    const rim = new THREE.Mesh(new THREE.BoxGeometry(width * 0.95, 0.1, 0.1), neon);
    for (const side of [1, -1]) {
      const r1 = rim.clone(); r1.position.set(0, baseY + 0.55, side * depth * 0.47); g.add(r1);
      const r2 = rim.clone(); r2.scale.set(depth / width, 1, 1); r2.rotation.y = Math.PI / 2; r2.position.set(side * width * 0.47, baseY + 0.55, 0); g.add(r2);
    }
  }
  return g;
}

export function buildGroundItem(kind, plotRadius, seed) {
  const g = new THREE.Group();
  if (kind === 'fountain') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.4, 20), podiumMaterial());
    base.position.y = 0.2; g.add(base);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.08, 20), neonMaterial('blue'));
    water.position.y = 0.42; g.add(water);
  } else if (kind === 'trees') {
    const fmat = foliageMaterial();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1, 5), podiumMaterial());
      trunk.position.set(Math.cos(a) * plotRadius * 0.7, 0.5, Math.sin(a) * plotRadius * 0.7);
      g.add(trunk);
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), fmat);
      top.position.set(trunk.position.x, 1.2, trunk.position.z);
      g.add(top);
    }
  } else if (kind === 'plaza') {
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(plotRadius * 0.9, plotRadius * 0.9, 0.12, 24), podiumMaterial());
    slab.position.y = 0.06; g.add(slab);
  }
  return g;
}

export const ARCHETYPES = ['setback', 'chamfer', 'cylinder', 'twist'];
export const CROWN_KINDS = ['spire', 'slanted', 'helipad', 'antenna', 'garden'];
export const GROUND_KINDS = ['plaza', 'fountain', 'trees'];
export { FLOOR_H };
