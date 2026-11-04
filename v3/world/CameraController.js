// Orbit (default, whole-city -> street level), fly (WASD/arrows + mouse,
// mobile joystick + drag) and walk (fly clamped to street-level eye height)
// camera modes, plus a smooth flyTo() tween used by search/click.
import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/addons/controls/OrbitControls.js';

const WALK_EYE_HEIGHT = 1.8;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export class CameraController {
  constructor(camera, domElement, { citySize, uiContainer }) {
    this.camera = camera;
    this.domElement = domElement;
    this.citySize = citySize;
    this.mode = 'orbit';
    this._tween = null;

    this.orbit = new OrbitControls(camera, domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 5;
    this.orbit.maxDistance = citySize * 1.6;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    // Sky clamp: never let the user (or a fly-to) tilt the view steeper than ~21 deg below the horizon, so every
    // elevated view keeps the starry sky + the distant skyline fading into the horizon in the top ~15% of the frame,
    // exactly like city.jpg. setView(..., {free:true}) lifts it for top-down audits until the next user drag.
    this.minPolar = 1.2;
    this.orbit.minPolarAngle = this.minPolar;
    this.orbit.addEventListener('start', () => { this.orbit.minPolarAngle = this.minPolar; });
    this.orbit.screenSpacePanning = false;

    // Hero framing (matches city.jpg): high 3/4 view, horizon ~15% from the top, towers towering in the foreground.
    this.homePosition = new THREE.Vector3(42, 150, 275);
    this.homeTarget = new THREE.Vector3(0, 22, -60);
    camera.position.copy(this.homePosition);
    this.orbit.target.copy(this.homeTarget);
    this.orbit.update();

    this._keys = Object.create(null);
    this._yaw = Math.atan2(this.homePosition.x, this.homePosition.z) + Math.PI;
    this._pitch = -0.18;
    this._dragging = false;
    this._lastX = 0; this._lastY = 0;
    this._joyVec = new THREE.Vector2(0, 0);
    this._joyActive = false;
    this._joyTouchId = null;
    this._lookTouchId = null;

    this._setupKeyboard();
    this._setupPointerLook();
    this._buildJoystick(uiContainer || domElement.parentElement || document.body);
  }

  // -------- mode switching --------
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    this._joyEl.style.display = mode === 'orbit' ? 'none' : '';
    if (mode !== 'orbit') {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this._yaw = Math.atan2(dir.x, dir.z);
      this._pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      if (mode === 'walk') this.camera.position.y = WALK_EYE_HEIGHT;
    }
  }

  cycleMode() {
    this.setMode(this.mode === 'orbit' ? 'fly' : this.mode === 'fly' ? 'walk' : 'orbit');
    return this.mode;
  }

  // -------- smooth fly-to (search / click a building) --------
  flyTo(targetPos, distance, opts = {}) {
    this.setMode('orbit');
    const duration = (opts.duration ?? 1.1) * 1000;
    const dir = new THREE.Vector3(0.5, 0.36, 0.78).normalize();
    const endTarget = targetPos.clone().add(new THREE.Vector3(0, Math.max(3, distance * 0.16), 0));
    const endPos = targetPos.clone().addScaledVector(dir, distance);
    this._tween = {
      startPos: this.camera.position.clone(), endPos,
      startTarget: this.orbit.target.clone(), endTarget,
      t0: performance.now(), duration,
    };
  }

  // Deterministic camera placement (used by the verification screenshots and deep links).
  setView(pos, target, { free = false } = {}) {
    this.setMode('orbit'); this._tween = null;
    this.orbit.minPolarAngle = free ? 0 : this.minPolar;
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.orbit.target.set(target[0], target[1], target[2]);
    this.orbit.update();
  }

  get isTweening() { return !!this._tween; }

  // -------- per-frame update --------
  update(dt) {
    if (this._tween) {
      const u = Math.min(1, (performance.now() - this._tween.t0) / this._tween.duration);
      const eu = easeInOutCubic(u);
      this.camera.position.lerpVectors(this._tween.startPos, this._tween.endPos, eu);
      this.orbit.target.lerpVectors(this._tween.startTarget, this._tween.endTarget, eu);
      this.camera.lookAt(this.orbit.target);
      if (u >= 1) this._tween = null;
      return;
    }
    if (this.mode === 'orbit') {
      this.orbit.update();
    } else {
      this._updateFlyWalk(dt);
    }
  }

  _updateFlyWalk(dt) {
    const speed = (this.mode === 'walk' ? 10 : 42) * (this._keys['shift'] ? 2.4 : 1);
    let moveX = this._joyVec.x, moveZ = -this._joyVec.y;
    if (this._keys['w'] || this._keys['arrowup']) moveZ -= 1;
    if (this._keys['s'] || this._keys['arrowdown']) moveZ += 1;
    if (this._keys['a'] || this._keys['arrowleft']) moveX -= 1;
    if (this._keys['d'] || this._keys['arrowright']) moveX += 1;
    const len = Math.hypot(moveX, moveZ);
    if (len > 1) { moveX /= len; moveZ /= len; }

    const forward = new THREE.Vector3(Math.sin(this._yaw), 0, Math.cos(this._yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    this.camera.position.addScaledVector(forward, -moveZ * speed * dt);
    this.camera.position.addScaledVector(right, moveX * speed * dt);

    if (this.mode === 'walk') {
      this.camera.position.y = WALK_EYE_HEIGHT;
    } else {
      if (this._keys[' ']) this.camera.position.y += speed * dt;
      if (this._keys['control']) this.camera.position.y -= speed * dt;
      this.camera.position.y = Math.max(1.4, this.camera.position.y);
    }

    const half = this.citySize * 0.56;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -half, half);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -half, half);

    const dir = new THREE.Vector3(
      Math.cos(this._pitch) * Math.sin(this._yaw),
      Math.sin(this._pitch),
      Math.cos(this._pitch) * Math.cos(this._yaw),
    );
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.orbit.target.copy(this.camera.position).add(dir);
  }

  // -------- keyboard --------
  _setupKeyboard() {
    window.addEventListener('keydown', (e) => { this._keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { this._keys[e.key.toLowerCase()] = false; });
  }

  // -------- mouse/touch look-drag (right side on mobile, anywhere on desktop while in fly/walk) --------
  _setupPointerLook() {
    const el = this.domElement;
    const LOOK_SPEED = 0.0038;

    el.addEventListener('pointerdown', (e) => {
      if (this.mode === 'orbit') return;
      if (this._joyActive && e.pointerId === this._joyTouchId) return;
      if (e.pointerType === 'touch' && e.clientX < el.clientWidth * 0.5) return; // left half reserved for joystick
      this._dragging = true; this._lookTouchId = e.pointerId;
      this._lastX = e.clientX; this._lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this._dragging || e.pointerId !== this._lookTouchId) return;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      this._yaw -= dx * LOOK_SPEED;
      this._pitch = THREE.MathUtils.clamp(this._pitch - dy * LOOK_SPEED, -1.3, 1.3);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerId === this._lookTouchId) { this._dragging = false; this._lookTouchId = null; }
    });
  }

  // -------- mobile virtual joystick (move forward/strafe) --------
  _buildJoystick(container) {
    const base = document.createElement('div');
    base.className = 'fly-joystick';
    const knob = document.createElement('div');
    knob.className = 'fly-joystick-knob';
    base.appendChild(knob);
    base.style.display = 'none';
    container.appendChild(base);
    this._joyEl = base;

    const radius = 44;
    const reset = () => { knob.style.transform = 'translate(0px,0px)'; this._joyVec.set(0, 0); };
    reset();

    base.addEventListener('pointerdown', (e) => {
      this._joyActive = true; this._joyTouchId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      this._joyOrigin = { x: e.clientX, y: e.clientY };
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joyTouchId) return;
      let dx = e.clientX - this._joyOrigin.x, dy = e.clientY - this._joyOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > radius) { dx = dx / d * radius; dy = dy / d * radius; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this._joyVec.set(dx / radius, dy / radius);
    });
    const end = (e) => {
      if (e.pointerId !== this._joyTouchId) return;
      this._joyActive = false; this._joyTouchId = null; reset();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
}
