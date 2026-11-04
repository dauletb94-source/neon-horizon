// Admin build mode (Даки): place/move/rotate/delete extra buildings — roads,
// parks, landmarks — on top of the data-driven city, persisted to
// localStorage. Toggle with Shift+B or ?admin=1. Separate from the named
// follower plots in buildings.json, which are never editable here.
import * as THREE from '../vendor/three/three.module.js';
import { Building, defaultSpecForSlot } from '../entities/Building.js';
import { FACADE_KEYS, NEON_COLOR_KEYS } from '../engine/materials.js';
import { nearestFreePlot, PLOTS, NEAR_CAP } from '../world/layout.js';
import { ARCHETYPES, CROWN_KINDS, GROUND_KINDS } from '../entities/buildingParts.js';

const STORAGE_KEY = 'nh_admin_layout_v1';
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function options(keys) { return keys.map((k) => `<option value="${k}">${k}</option>`).join(''); }

export function initBuildMode(cityView, container) {
  const scene = cityView.scene;
  const extra = new Map(); // adminId -> Building
  let nextId = 1;
  let active = false;
  let mode = null; // 'place' | 'move' | null
  let selected = null;

  const panel = document.createElement('div');
  panel.className = 'admin-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="admin-title">🛠 Admin Build Mode</div>
    <div class="admin-row">
      <button type="button" data-a="place">+ Place</button>
      <button type="button" data-a="move">Move</button>
      <button type="button" data-a="delete">Delete</button>
    </div>
    <div class="admin-row admin-fields" hidden>
      <select data-f="facade">${options(FACADE_KEYS)}</select>
      <select data-f="neonColor">${options(NEON_COLOR_KEYS)}</select>
      <select data-f="archetype">${options(ARCHETYPES)}</select>
      <select data-f="crown">${options(CROWN_KINDS)}</select>
      <select data-f="groundItem"><option value="">no ground item</option>${options(GROUND_KINDS)}</select>
      <label>Lvl <input type="range" min="1" max="10" data-f="level"></label>
      <label>Rotate <input type="range" min="0" max="360" data-f="rotate"></label>
    </div>
    <div class="admin-hint">Shift+B to close · click ground to place/move · click a placed building to select</div>
  `;
  container.appendChild(panel);
  const fields = panel.querySelector('.admin-fields');

  function save() {
    const arr = [...extra.values()].map((b) => ({
      adminId: b.group.userData.adminId, x: b.group.position.x, z: b.group.position.z,
      rotY: b.group.rotation.y, spec: b.spec,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  function spawn(adminId, pos, spec, rotY = 0) {
    const b = new Building(adminId, pos, NEAR_CAP);
    b.rebuild(spec);
    b.group.rotation.y = rotY;
    b.group.userData.adminId = adminId;
    scene.add(b.group);
    extra.set(adminId, b);
    return b;
  }

  function load() {
    // restored layouts are re-snapped to plots, so old saves that sat on a road are healed
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { arr = []; }
    for (const item of arr) {
      const plot = nearestFreePlot(item.x, item.z, null, true);
      if (!plot) continue;
      cityView.world.filler.hide(plot);
      spawn(item.adminId, new THREE.Vector3(plot.cx, 0, plot.cz), item.spec, item.rotY || 0);
      const n = parseInt(String(item.adminId).replace(/\D/g, ''), 10);
      if (!Number.isNaN(n)) nextId = Math.max(nextId, n + 1);
    }
  }
  load();

  function select(b) {
    selected = b;
    fields.hidden = !b;
    if (!b) return;
    fields.querySelector('[data-f=facade]').value = b.spec.facade;
    fields.querySelector('[data-f=neonColor]').value = b.spec.neonColor;
    fields.querySelector('[data-f=archetype]').value = b.spec.archetype;
    fields.querySelector('[data-f=crown]').value = b.spec.crown;
    fields.querySelector('[data-f=groundItem]').value = b.spec.groundItem || '';
    fields.querySelector('[data-f=level]').value = b.spec.level;
    fields.querySelector('[data-f=rotate]').value = Math.round(THREE.MathUtils.radToDeg(b.group.rotation.y));
  }

  panel.addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (!a) return;
    if (a === 'place') { mode = 'place'; }
    else if (a === 'move') { if (selected) mode = 'move'; }
    else if (a === 'delete' && selected) {
      const op = PLOTS.near.find((q) => q.taken === 'admin' && Math.abs(q.cx - selected.group.position.x) < 0.01 && Math.abs(q.cz - selected.group.position.z) < 0.01); if (op) cityView.world.filler.show(op);
      scene.remove(selected.group); selected.dispose();
      extra.delete(selected.group.userData.adminId);
      select(null); save();
    }
  });
  fields.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f || !selected) return;
    if (f === 'rotate') { selected.group.rotation.y = THREE.MathUtils.degToRad(+e.target.value); save(); return; }
    const spec = Object.assign({}, selected.spec, { [f]: f === 'level' ? +e.target.value : (e.target.value || null) });
    selected.rebuild(spec);
    selected.group.userData.adminId = selected.id;
    save();
  });

  function groundPoint(e) {
    const rect = cityView.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cityView.camera);
    const pt = new THREE.Vector3();
    return ray.ray.intersectPlane(GROUND_PLANE, pt) ? pt : null;
  }

  let downX = 0, downY = 0, downT = 0;
  cityView.canvas.addEventListener('pointerdown', (e) => { if (active) { downX = e.clientX; downY = e.clientY; downT = performance.now(); } });
  cityView.canvas.addEventListener('pointerup', (e) => {
    if (!active) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || performance.now() - downT > 500) return;

    if (mode === 'place') {
      const pt = groundPoint(e);
      const plot = pt && nearestFreePlot(pt.x, pt.z, null, true);
      if (plot) { cityView.world.filler.hide(plot); const id = `admin-${nextId++}`; select(spawn(id, new THREE.Vector3(plot.cx, 0, plot.cz), defaultSpecForSlot(id))); save(); }
      mode = null;
      return;
    }
    if (mode === 'move') {
      const pt = groundPoint(e);
      const plot = pt && selected && nearestFreePlot(pt.x, pt.z, null, true);
      if (plot) {
        const old = PLOTS.near.find((q) => q.taken === 'admin' && Math.abs(q.cx - selected.group.position.x) < 0.01 && Math.abs(q.cz - selected.group.position.z) < 0.01);
        if (old) cityView.world.filler.show(old);
        cityView.world.filler.hide(plot); selected.group.position.set(plot.cx, 0, plot.cz); save();
      }
      mode = null;
      return;
    }
    const rect = cityView.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cityView.camera);
    const hit = ray.intersectObjects([...extra.values()].map((b) => b.group), true)[0];
    if (hit) {
      let o = hit.object;
      while (o && o.userData.adminId === undefined) o = o.parent;
      if (o) select(extra.get(o.userData.adminId));
    } else {
      select(null);
    }
  });

  function toggle(force) {
    active = typeof force === 'boolean' ? force : !active;
    panel.hidden = !active;
    if (!active) { mode = null; select(null); }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'b' && e.shiftKey) toggle();
  });
  if (new URLSearchParams(location.search).get('admin') === '1') toggle(true);

  return toggle;
}
