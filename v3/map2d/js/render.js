// Map view: OpenSeadragon deep-zoom viewer over the REAL photo mosaic.
// No canvas drawing, no procedural shapes — buildings are the photo
// itself, tiled into a zoom pyramid so close-ups stay crisp instead of
// blurring. The only things rendered on top are small DOM pins
// (nameplate / remodeling / locked-district) anchored to the photo.
(function (global) {
  class MapView {
    constructor(viewportEl, { map, getUserBySlot, onPick }) {
      this.viewportEl = viewportEl;
      this.map = map;
      this.getUserBySlot = getUserBySlot;
      this.onPick = onPick;
      this.t = null;
      this.residents = 0;
      this.pins = new Map(); // slotId -> {el, inner}
      this._slotIndex = new Map(map.slots.map((s) => [s.id, s]));
      this.ready = new Promise((resolve) => { this._readyResolve = resolve; });

      this.viewer = OpenSeadragon({
        element: viewportEl,
        tileSources: map.dziUrl,
        showNavigationControl: false,
        showNavigator: false,
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
        gestureSettingsTouch: { clickToZoom: false, dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
        animationTime: 0.9,
        springStiffness: 7,
        maxZoomPixelRatio: 1.05,
        visibilityRatio: 1,
        constrainDuringPan: true,
        minZoomImageRatio: 0.18,
        placeholderFillStyle: "#03040c",
        imageLoaderLimit: 6,
      });

      this.viewer.addHandler("open", () => this._onOpen());
      this.viewer.addHandler("canvas-click", (e) => {
        if (e.quick) e.preventDefaultAction = true;
      });
    }

    _onOpen() {
      const vp = this.viewer.viewport;
      const tileW = this.map.mapWidth / 2;
      const tileH = this.map.mapHeight / 2;
      const tileRect = vp.imageToViewportRectangle(0, 0, tileW, tileH);

      // fitBounds() would otherwise stretch to the *container's* aspect
      // ratio and reveal neighbouring quadrants above/below on a narrow
      // phone screen. Pre-shape the home rect to the container's aspect
      // (same "cover" crop a CSS background-size:cover would do) so the
      // default view matches city.jpg's framing: full skyline height,
      // cropped left/right, not stretched vertically into another tile.
      const cs = vp.getContainerSize();
      this.homeRect = coverRect(tileRect, cs.x / cs.y);
      vp.fitBounds(this.homeRect, true);
      this.homeZoom = vp.getZoom();
      this.homeZoomWidth = this.homeZoom * vp.getBounds().width;
      vp.minZoomLevel = this.homeZoom * 0.96;
      // leave vp.maxZoomLevel as OSD computed it from maxZoomPixelRatio —
      // that's the real "don't upscale past native resolution" crispness
      // cap; hard-coding a bigger multiple here let zoom go past native
      // pixels and blur.
      vp.applyConstraints();

      this._buildPins();
      this._buildLockedOverlays();
      this._updateLockedOverlays();

      this.viewer.addHandler("resize", () => {
        const cs2 = vp.getContainerSize();
        this.homeRect = coverRect(tileRect, cs2.x / cs2.y);
      });

      this._readyResolve();
    }

    imgPointFor(slot) {
      const px = (slot.x / 100) * this.map.mapWidth;
      const py = (slot.y / 100) * this.map.mapHeight;
      return this.viewer.viewport.imageToViewportCoordinates(px, py);
    }

    setResidents(n) {
      this.residents = n;
      this._updateLockedOverlays();
    }

    setLocale(t) {
      this.t = t;
      this._updateLockedOverlays();
    }

    slotById(id) {
      return this._slotIndex.get(id);
    }

    flyTo(slotId, zoomFactor) {
      const slot = this.slotById(slotId);
      if (!slot || !this.viewer.viewport) return;
      const point = this.imgPointFor(slot);
      const vp = this.viewer.viewport;
      const targetZoom = Math.min(vp.getMaxZoom(), Math.max(vp.minZoomLevel, (this.homeZoom || vp.getZoom()) * (zoomFactor || 3.4)));
      // panTo() + zoomTo() as two separate animated calls fight each other
      // (zoomTo's "keep this point fixed on screen" math runs against the
      // pre-pan center). fitBounds() moves center+zoom in one atomic spring.
      const width = this.homeZoomWidth / targetZoom;
      const height = width * (this.homeRect.height / this.homeRect.width);
      const rect = new OpenSeadragon.Rect(point.x - width / 2, point.y - height / 2, width, height);
      vp.fitBounds(rect, false);
    }

    get maxZoomFactor() {
      return this.viewer.viewport ? this.viewer.viewport.getMaxZoom() / this.homeZoom : 8;
    }
    get minZoomFactor() {
      return this.viewer.viewport ? this.viewer.viewport.minZoomLevel / this.homeZoom : 0.96;
    }

    // ---------------- pins (nameplate / remodeling / unfollowed) ----------------
    _buildPins() {
      for (const slot of this.map.slots) {
        const pin = document.createElement("div");
        pin.className = "pin";
        pin.hidden = true;
        pin.dataset.slotId = slot.id;

        const inner = document.createElement("div");
        inner.className = "pin-inner";
        pin.appendChild(inner);

        pin.addEventListener("pointerup", (e) => {
          e.stopPropagation();
          const user = this.getUserBySlot(slot.id);
          if (user) this.onPick && this.onPick(user);
        });
        pin.addEventListener("pointerdown", (e) => e.stopPropagation());

        this.viewer.addOverlay({
          element: pin,
          location: this.imgPointFor(slot),
          placement: OpenSeadragon.Placement.BOTTOM,
        });
        this.pins.set(slot.id, { el: pin, inner });
      }
    }

    refreshPin(slotId, user) {
      const p = this.pins.get(slotId);
      if (!p) return;
      if (!user) { p.el.hidden = true; p.inner.innerHTML = ""; return; }
      p.el.hidden = false;
      const flag = global.NH_flagEmoji ? global.NH_flagEmoji(user.country) : "";
      let html = "";
      if (user.status === "pending") {
        html = `<div class="plaque remodel"><span class="scaffold"></span><span class="tag">🚧 ${this.t ? this.t("statusPending") : "Remodeling"}</span></div>`;
      } else if (user.status === "unfollowed") {
        const label = this.t ? this.t("followAgainBtn") : "↻ follow again";
        html = `<div class="plaque tag unfollowed">${label}</div>`;
      } else {
        html = `<div class="plaque nameplate ${user.upgrades && user.upgrades.rainbow ? "rainbow" : ""}">${flag} <b>${escapeHtml(user.displayNick)}</b></div>`;
        if (user.upgrades && user.upgrades.flyingCar) html += `<span class="mini-car">🚗</span>`;
        if (user.upgrades && user.upgrades.hologram) html += `<span class="holo-ring"></span>`;
      }
      p.inner.innerHTML = html;
    }

    // ---------------- locked districts ----------------
    _buildLockedOverlays() {
      this.lockedEls = new Map();
      for (const d of this.map.districts) {
        const box = document.createElement("div");
        box.className = "locked-box";

        const w = (d.bounds.x1 - d.bounds.x0) / 100 * this.map.mapWidth;
        const h = (d.bounds.y1 - d.bounds.y0) / 100 * this.map.mapHeight;
        const x = (d.bounds.x0 / 100) * this.map.mapWidth;
        const y = (d.bounds.y0 / 100) * this.map.mapHeight;
        const rect = this.viewer.viewport.imageToViewportRectangle(x, y, w, h);
        this.viewer.addOverlay({ element: box, location: rect });

        // label is a separate non-scaling point overlay at the district's
        // centre so it stays legible regardless of zoom, even though the
        // dimming rect above it is usually far bigger than the viewport.
        const label = document.createElement("div");
        label.className = "locked-label";
        const cx = x + w / 2, cy = y + h / 2;
        const point = this.viewer.viewport.imageToViewportCoordinates(cx, cy);
        this.viewer.addOverlay({ element: label, location: point, placement: OpenSeadragon.Placement.CENTER });

        this.lockedEls.set(d.id, { box, label });
      }
    }

    _updateLockedOverlays() {
      if (!this.lockedEls) return;
      for (const d of this.map.districts) {
        const entry = this.lockedEls.get(d.id);
        if (!entry) continue;
        const unlocked = global.NH_City.districtUnlocked(d, this.residents);
        entry.box.classList.toggle("hidden", unlocked);
        entry.label.classList.toggle("hidden", unlocked);
        if (!unlocked) {
          const hint = this.t ? this.t("districtLockedLabel", { n: d.unlockFollowers.toLocaleString() }) : `unlocks at ${d.unlockFollowers.toLocaleString()} followers`;
          entry.label.textContent = `🔒 ${d.name} — ${hint}`;
        }
      }
    }
  }

  function coverRect(rect, containerAspect) {
    const tileAspect = rect.width / rect.height;
    let w, h;
    if (containerAspect > tileAspect) { w = rect.width; h = w / containerAspect; }
    else { h = rect.height; w = h * containerAspect; }
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return new OpenSeadragon.Rect(cx - w / 2, cy - h / 2, w, h);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  global.NH_Render = { MapView };
})(window);
