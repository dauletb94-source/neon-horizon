// Nick+flag plaques, remodeling tags and locked-district labels, rendered as
// crisp HTML/CSS2D objects anchored to building world positions — reuses the
// exact .plaque/.pin/.locked-label markup and CSS from the old 2D map view.
import * as THREE from '../vendor/three/three.module.js';
import { CSS2DObject, CSS2DRenderer } from '../vendor/three/addons/renderers/CSS2DRenderer.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Plaques only make sense "visible when near" (per GDD) -- at a whole-city
// overview distance, showing every registered nick at once just clusters
// dozens of nameplates on top of each other. Fade them in as the camera
// approaches and fully hide them past FAR, instead of always-on.
const LABEL_FAR = 210;
const LABEL_NEAR = 70;
const MAX_LABELS = 14;
const PAD = 8;

export class PlaqueLayer {
  constructor(container, scene) {
    this.renderer = new CSS2DRenderer();
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.renderer.domElement);
    this.scene = scene;
    this.pins = new Map(); // slotId -> {obj, el, inner}
    this.t = null;
    this._w = 0; this._h = 0;
    this._v3 = new THREE.Vector3();
  }

  setSize(w, h) { this.renderer.setSize(w, h); this._w = w; this._h = h; }

  render(scene, camera) {
    this._declutter(camera);
    this.renderer.render(scene, camera);
  }

  setAnchorHeight(slotId, y) {
    const p = this.pins.get(slotId);
    if (p) p.obj.position.y = (p.baseY ?? 0) + Math.max(4, y);
  }

  // Distance fade + scale, then nearest-first greedy collision rejection: a label that would overlap an
  // already-placed (nearer) label is hidden instead of stacked, so names never overprint each other.
  // Hover/selected pins (.pin-focus) are placed first and always win.
  _declutter(camera) {
    if (!this._w || !this._h) return;
    const cands = [];
    for (const p of this.pins.values()) {
      if (p.el.hidden) continue;
      const dist = camera.position.distanceTo(p.obj.position);
      this._v3.copy(p.obj.position).project(camera);
      const focus = p.inner.matches(':hover') || p.inner.classList.contains('pin-focus');
      const off = this._v3.z > 1 || Math.abs(this._v3.x) > 1.1 || Math.abs(this._v3.y) > 1.1;
      if ((dist >= LABEL_FAR && !focus) || off) { this._hide(p); continue; }
      cands.push({ p, dist: focus ? -1 : dist, x: (this._v3.x * 0.5 + 0.5) * this._w, y: (-this._v3.y * 0.5 + 0.5) * this._h });
    }
    // district banners: lowest priority, hidden when far, off-screen, or colliding with names / the bottom search bar
    if (this._districtLabels) {
      for (const [id, el] of this._districtLabels) {
        if (el.classList.contains('hidden')) continue;
        const o = el._obj;
        const dist = camera.position.distanceTo(o.position);
        this._v3.copy(o.position).project(camera);
        const y = (-this._v3.y * 0.5 + 0.5) * this._h;
        if (camera.position.y < 70 || dist < 140 || dist > 900 || this._v3.z > 1 || Math.abs(this._v3.x) > 1 || y > this._h - 120 || y < 90) { el.style.visibility = 'hidden'; continue; }
        cands.push({ p: { inner: el, el }, dist: 1000 + dist, x: (this._v3.x * 0.5 + 0.5) * this._w, y, banner: true });
      }
    }
    cands.sort((a, b) => a.dist - b.dist);
    const placed = [];
    let shown = 0;
    for (const e of cands) {
      const p = e.p;
      if (e.banner) e.dist -= 1000;
      const fade = e.dist <= LABEL_NEAR ? 1 : 1 - (e.dist - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR);
      const scale = 0.72 + 0.28 * fade;
      p.inner.style.visibility = '';
      // Real on-screen box: CSS2DRenderer centres the .pin element on the anchor, then the inner is shifted up
      // by 100% of its own height and scaled about its bottom-centre -> bottom = y - hu/2, top = bottom - hu*scale.
      const wu = p.inner.offsetWidth || 90, hu = p.inner.offsetHeight || 22;
      const w = wu * scale, h = hu * scale, bot = e.y - hu / 2;
      const r = { l: e.x - w / 2 - PAD, r: e.x + w / 2 + PAD, t: bot - h - PAD, b: bot + PAD };
      // keep clear of the fixed HUD: top bar and the bottom search bar
      const hudHit = r.t < 64 || r.b > this._h - 104;
      const clash = hudHit || placed.some((o) => !(r.r < o.l || r.l > o.r || r.b < o.t || r.t > o.b));
      if ((clash || shown >= MAX_LABELS) && e.dist >= 0) { this._hide(p); continue; }
      placed.push(r); shown++;
      p.inner.style.opacity = Math.max(0.6, fade).toFixed(2); // floor keeps shown labels readable; far ones are culled, not faded out
      p.inner.style.transform = `translateY(-100%) scale(${scale.toFixed(2)})`;
      p.inner.style.pointerEvents = 'auto';
    }
  }

  _hide(p) { p.inner.style.visibility = 'hidden'; p.inner.style.pointerEvents = 'none'; }

  addPin(slotId, worldPos, onPick) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.hidden = true;
    const inner = document.createElement('div');
    inner.className = 'pin-inner';
    inner.style.pointerEvents = 'auto';
    el.appendChild(inner);
    inner.addEventListener('pointerup', (e) => { e.stopPropagation(); onPick && onPick(); });
    inner.addEventListener('pointerdown', (e) => e.stopPropagation());

    const obj = new CSS2DObject(el);
    obj.position.copy(worldPos);
    obj.position.y += 12;
    this.scene.add(obj);
    this.pins.set(slotId, { obj, el, inner, baseY: worldPos.y });
  }

  setLocale(t) { this.t = t; }

  refresh(slotId, user) {
    const p = this.pins.get(slotId);
    if (!p) return;
    if (!user) { p.el.hidden = true; p.inner.innerHTML = ''; return; }
    p.el.hidden = false;
    const flag = window.NH_flagEmoji ? window.NH_flagEmoji(user.country) : '';
    let html = '';
    if (user.status === 'pending') {
      html = `<div class="plaque remodel"><span class="scaffold"></span><span class="tag">🚧 ${this.t ? this.t('statusPending') : 'Remodeling'}</span></div>`;
    } else if (user.status === 'unfollowed') {
      const label = this.t ? this.t('followAgainBtn') : '↻ follow again';
      html = `<div class="plaque tag unfollowed">${label}</div>`;
    } else {
      html = `<div class="plaque nameplate ${user.upgrades && user.upgrades.rainbow ? 'rainbow' : ''}">${flag} <b>${escapeHtml(user.displayNick)}</b></div>`;
      if (user.upgrades && user.upgrades.flyingCar) html += `<span class="mini-car">🚗</span>`;
      if (user.upgrades && user.upgrades.hologram) html += `<span class="holo-ring"></span>`;
    }
    p.inner.innerHTML = html;
  }

  // -------- locked-district floating labels --------
  addDistrictLabel(districtId, worldCenter) {
    if (!this._districtLabels) this._districtLabels = new Map();
    const el = document.createElement('div');
    el.className = 'locked-label';
    const obj = new CSS2DObject(el);
    obj.position.copy(worldCenter);
    obj.position.y += 165; // hangs in the sky ABOVE the district's skyline - never over a facade
    this.scene.add(obj);
    el._obj = obj;
    this._districtLabels.set(districtId, el);
  }

  updateDistrictLabel(districtId, unlocked, district) {
    const el = this._districtLabels && this._districtLabels.get(districtId);
    if (!el) return;
    el.classList.toggle('hidden', unlocked);
    if (!unlocked) {
      const hint = this.t ? this.t('districtLockedLabel', { n: district.unlockFollowers.toLocaleString() }) : `unlocks at ${district.unlockFollowers.toLocaleString()} followers`;
      el.textContent = `🔒 ${district.name} — ${hint}`;
    }
  }
}
