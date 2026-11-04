// CityView: the 3D engine's public surface. Implements the exact same
// interface the old OpenSeadragon-based NH_Render.MapView exposed
// (constructor(viewportEl, {map, getUserBySlot, onPick}), .ready,
// .setLocale, .setResidents, .refreshPin, .flyTo) so js/app.js and js/ui.js
// need zero changes to drive the live 3D city instead of the flat photo.
import * as THREE from '../vendor/three/three.module.js';
import { createRenderPipeline } from '../engine/renderer.js';
import { setupSky, addSkyDome } from '../engine/sky.js';
import { setMaxAnisotropy } from '../engine/materials.js';
import { loadModels, loadHDRI, setAniso } from '../engine/towers.js';
import { loadRealModels } from '../engine/realTowers.js';
import { CityWorld, CITY_SIZE, toWorld } from './CityWorld.js';
import { CameraController } from './CameraController.js';
import { PlaqueLayer } from '../ui/plaques.js';
import { initBuildMode } from '../editor/BuildMode.js';

const BASE_FLY_DISTANCE = CITY_SIZE * 0.5;
const MIN_FLY_DISTANCE = 20;
const MAX_FLY_DISTANCE = CITY_SIZE * 1.5;

class CityView {
  constructor(viewportEl, { map, getUserBySlot, onPick }) {
    this.viewportEl = viewportEl;
    this.map = map;
    this.getUserBySlot = getUserBySlot;
    this.onPick = onPick;
    this.residents = 0;
    this.t = null;
    this._slotIndex = new Map(map.slots.map((s) => [s.id, s]));
    this.ready = new Promise((resolve) => { this._readyResolve = resolve; });

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;cursor:grab;';
    viewportEl.appendChild(canvas);
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 4200);

    const pipe = createRenderPipeline(canvas, this.scene, this.camera);
    this.renderer = pipe.renderer; this.composer = pipe.composer; this.setSizeGL = pipe.setSize;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    setupSky(this.renderer, this.scene);
    this.scene.background = null;
    this.sky = addSkyDome(this.scene);
    setAniso(this.renderer.capabilities.getMaxAnisotropy());
    this._addLights();
    this.world = null;

    this.cameraCtl = new CameraController(this.camera, canvas, { citySize: CITY_SIZE, uiContainer: viewportEl });

    this.plaques = new PlaqueLayer(viewportEl, this.scene);
    this._setupResize();
    this._clock = new THREE.Clock();
    this._init(map);
    requestAnimationFrame(() => this._loop());
  }

  async _init(map) {
    await loadModels();
    await loadRealModels();
    const hd = await loadHDRI(this.renderer);
    if (hd) this.scene.environment = hd.env;
    this.world = new CityWorld(this.scene, map);
    // far skyline is now real 3D geometry (FillerField horizon ring); the painted cylinder backdrop is gone
    for (const slot of map.slots) {
      const pos = this.world.worldPositionForSlot(slot.id);
      this.plaques.addPin(slot.id, pos, () => {
        const user = this.getUserBySlot(slot.id);
        if (user) this.onPick && this.onPick(user);
      });
    }
    for (const d of map.districts) {
      const center = toWorld((d.bounds.x0 + d.bounds.x1) / 2, (d.bounds.y0 + d.bounds.y1) / 2);
      this.plaques.addDistrictLabel(d.id, center);
    }

    this._setupPicking();
    this._buildModeToggle = initBuildMode(this, this.viewportEl);
    this._buildModeButton(this.viewportEl);

    requestAnimationFrame(() => { this._resize(); this._readyResolve(); });
  }

  _buildModeButton(container) {
    const btn = document.createElement('button');
    btn.className = 'mode-btn';
    btn.type = 'button';
    const labels = { orbit: '🖱 Orbit', fly: '🚀 Fly', walk: '🚶 Walk' };
    btn.textContent = labels.orbit;
    btn.addEventListener('click', () => { btn.textContent = labels[this.cameraCtl.cycleMode()]; });
    container.appendChild(btn);
    this.modeButton = btn;
  }

  _addLights() {
    // Raised from the original 0.55/0.5: at the old levels the near-black
    // facade base colors multiplied down to literal zero under ACES
    // tonemapping, which is why towers rendered as invisible black boxes
    // with only their emissive windows showing. This keeps the night mood
    // but gives the glass something to reflect and shade with.
    const hemi = new THREE.HemisphereLight(0x3f62b8, 0x070a14, 0.32);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0x9fb8ff, 0.14);
    moon.position.set(-60, 90, 40);
    this.scene.add(moon);
    // Low fill light from the opposite side so facades facing away from the
    // "moon" aren't pure black, and a faint ambient floor so ACES never
    // crushes dark glass all the way to zero.
    const fill = new THREE.DirectionalLight(0x3b6bff, 0.1);
    fill.position.set(70, 50, -60);
    this.scene.add(fill);
    const ambient = new THREE.AmbientLight(0x0c1326, 0.35);
    this.scene.add(ambient);
  }

  _setupResize() {
    this._resize = () => {
      const w = this.viewportEl.clientWidth || 1, h = this.viewportEl.clientHeight || 1;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.setSizeGL(w, h);
      this.plaques.setSize(w, h);
    };
    window.addEventListener('resize', this._resize);
    if (window.ResizeObserver) new ResizeObserver(this._resize).observe(this.viewportEl);
  }

  _setupPicking() {
    let downX = 0, downY = 0, downT = 0;
    this.canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; downT = performance.now(); });
    this.canvas.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 6 || performance.now() - downT > 500) return; // was a drag, not a click
      if (this.cameraCtl.mode !== 'orbit') return;
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.world.pickables(), true)[0];
      if (!hit) return;
      let o = hit.object;
      while (o && o.userData.slotId === undefined) o = o.parent;
      if (!o) return;
      const user = this.getUserBySlot(o.userData.slotId);
      if (user) this.onPick && this.onPick(user);
    });
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.1, this._clock.getDelta());
    const t = this._clock.elapsedTime;
    if (this.world) this.world.update(t);
    this.sky.position.copy(this.camera.position);
    if (this.horizon) { this.horizon.position.x = this.camera.position.x * 0.9; this.horizon.position.z = this.camera.position.z * 0.9; }
    this.cameraCtl.update(dt);
    this.composer.render();
    this.plaques.render(this.scene, this.camera);
  }

  // -------- public interface (matches the old MapView) --------
  setLocale(t) {
    this.t = t;
    this.plaques.setLocale(t);
    this._refreshDistrictLabels();
  }

  setResidents(n) {
    this.residents = n;
    this.world.setResidents(n);
    this._refreshDistrictLabels();
  }

  _refreshDistrictLabels() {
    for (const d of this.map.districts) {
      this.plaques.updateDistrictLabel(d.id, this.residents >= d.unlockFollowers, d);
    }
  }

  refreshPin(slotId, user) {
    this.world.applyUser(slotId, user);
    const b = this.world.buildings.get(slotId);
    if (b) this.plaques.setAnchorHeight(slotId, b.topY - 3);
    this.plaques.refresh(slotId, user);
  }

  setView(pos, target, opts) { this.cameraCtl.setView(pos, target, opts); }

  slotById(id) { return this._slotIndex.get(id); }

  flyTo(slotId, zoomFactor) {
    const slot = this.slotById(slotId);
    const pos = this.world.worldPositionForSlot(slotId);
    if (!slot || !pos) return;
    const b = this.world.buildings.get(slotId);
    const target = pos.clone();
    target.y += b ? Math.min(b.topY * 0.5, 14) : 6;
    // Keep enough clearance from the building's own footprint so a max-zoom
    // fly-to lands just outside the facade instead of inside the geometry.
    const clearance = b ? Math.hypot(b.footprint.w, b.footprint.d) * 0.9 + 6 : MIN_FLY_DISTANCE;
    const distance = THREE.MathUtils.clamp(BASE_FLY_DISTANCE / (zoomFactor || 3.4), Math.max(MIN_FLY_DISTANCE, clearance), MAX_FLY_DISTANCE);
    this.cameraCtl.flyTo(target, distance);
  }

  get maxZoomFactor() { return BASE_FLY_DISTANCE / MIN_FLY_DISTANCE; }
  get minZoomFactor() { return BASE_FLY_DISTANCE / MAX_FLY_DISTANCE; }
}

window.NH_Render = { MapView: CityView };
