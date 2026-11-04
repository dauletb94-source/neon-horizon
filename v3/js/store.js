// Pluggable data store. LocalStorageStore is the default (works with zero
// backend). SupabaseStore (see supabase/adapter.js) implements the same
// interface so swapping backends later is a one-line change in app.js.
(function (global) {
  const KEY_USERS = "nh_users_v1";
  const KEY_COUNTER = "nh_counter_v1";
  const KEY_STATS = "nh_stats_v1";
  // Progression layer (versioned keys; each maps 1:1 to a table in supabase/schema.sql)
  const KEY_GAME = "nh_game_v1";         // nick -> { xp, level, businesses[], stats, quests... }
  const KEY_REFS = "nh_referrals_v1";    // [ { id, referrer, referee, status, ... } ]
  const KEY_SOCIAL = "nh_social_v1";     // nick -> { likes[], visits, visitDays{} }
  const KEY_EVENTS = "nh_events_v1";     // city event log for the News page
  const KEY_CLOCK = "nh_clock_v1";       // dev time-travel offset (ms)

  // Game clock: Date.now() plus an optional dev offset (NH.debugAdvance).
  const Clock = {
    offset: Number(localStorage.getItem(KEY_CLOCK) || 0) || 0,
    now() { return Date.now() + this.offset; },
    advance(ms) { this.offset += ms; localStorage.setItem(KEY_CLOCK, String(this.offset)); },
    reset() { this.offset = 0; localStorage.removeItem(KEY_CLOCK); },
    stamp(t) { return new Date(t === undefined ? this.now() : t).toISOString().slice(0, 10); },
  };
  global.NH_Clock = Clock;

  // Device fingerprint STUB (anti-abuse). Real deployment: server-side IP + FingerprintJS.
  function deviceHash() {
    let h = localStorage.getItem("nh_device_v1");
    if (h) return h;
    const raw = [navigator.userAgent, screen.width + "x" + screen.height, navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.hardwareConcurrency || 0].join("|");
    let x = 2166136261;
    for (let i = 0; i < raw.length; i++) { x ^= raw.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
    h = "dv" + x.toString(16) + Math.floor(Math.random() * 0xffff).toString(16);
    localStorage.setItem("nh_device_v1", h);
    return h;
  }
  global.NH_deviceHash = deviceHash;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function todayStamp() {
    return global.NH_Clock.stamp();
  }
  function genCode() {
    const n = 1000 + Math.floor(Math.random() * 9000);
    return `NH-${n}`;
  }

  class LocalStorageStore {
    constructor() {
      if (!localStorage.getItem(KEY_USERS)) writeJSON(KEY_USERS, {});
      if (!localStorage.getItem(KEY_COUNTER)) writeJSON(KEY_COUNTER, { n: 48000 });
      if (!localStorage.getItem(KEY_STATS)) {
        writeJSON(KEY_STATS, { newToday: 0, dayStamp: todayStamp() });
      }
    }

    _all() {
      return readJSON(KEY_USERS, {});
    }
    _save(all) {
      writeJSON(KEY_USERS, all);
    }
    _bumpStatsNewBuilding() {
      const stats = readJSON(KEY_STATS, { newToday: 0, dayStamp: todayStamp() });
      const today = todayStamp();
      if (stats.dayStamp !== today) {
        stats.dayStamp = today;
        stats.newToday = 0;
      }
      stats.newToday += 1;
      writeJSON(KEY_STATS, stats);
    }

    async getStats() {
      const all = this._all();
      const count = Object.keys(all).length;
      const stats = readJSON(KEY_STATS, { newToday: 0, dayStamp: todayStamp() });
      if (stats.dayStamp !== todayStamp()) {
        stats.newToday = 0;
        stats.dayStamp = todayStamp();
        writeJSON(KEY_STATS, stats);
      }
      return { residents: 51762 + count, newToday: stats.newToday };
    }

    async getUserByNick(nick) {
      const all = this._all();
      return all[nick.toLowerCase()] || null;
    }

    async getUserByCode(code) {
      const all = this._all();
      return Object.values(all).find(u => u.code === code) || null;
    }

    async createUser({ nick, country, source, plot, deviceHash: dev }) {
      const all = this._all();
      const key = nick.toLowerCase();
      if (all[key]) return all[key];
      const counter = readJSON(KEY_COUNTER, { n: 48000 });
      counter.n += 1;
      writeJSON(KEY_COUNTER, counter);

      const user = {
        nick: key,
        displayNick: nick.replace(/^@/, ""),
        country,
        source,
        code: genCode(),
        status: "pending",
        buildingNumber: counter.n,
        buildingName: global.NH_randomBuildingName ? global.NH_randomBuildingName() : "New Building",
        districtId: plot.districtId,
        plotId: plot.plotId,
        level: 1,
        coins: 150,
        upgrades: { floors: 0, neonColor: null, garden: false, billboard: false,
          hologram: false, flyingCar: false, rainbow: false, helipad: false, spotlight: false },
        lastCheckin: null,
        lastDraw: null,
        deviceHash: dev || null,
        createdAt: global.NH_Clock.now(),
      };
      all[key] = user;
      this._save(all);
      this._bumpStatsNewBuilding();
      return user;
    }

    async updateUser(nick, patch) {
      const all = this._all();
      const key = nick.toLowerCase();
      if (!all[key]) return null;
      all[key] = Object.assign({}, all[key], patch);
      this._save(all);
      return all[key];
    }

    // verify: a referral becomes "verified" only here (registered + follow code passed)
    async verify(code) {
      const user = await this.getUserByCode(code);
      if (!user) return null;
      const updated = await this.updateUser(user.nick, { status: "verified" });
      const refs = this._refs();
      let touched = false;
      for (const r of refs) {
        if (r.referee === user.nick && r.status === "pending") {
          r.status = "verified"; r.verifiedAt = global.NH_Clock.now(); touched = true;
        }
      }
      if (touched) this._saveRefs(refs);
      return updated;
    }

    // unfollow within the revoke window revokes the referral
    async unfollow(code, windowDays = 7) {
      const user = await this.getUserByCode(code);
      if (!user) return null;
      const updated = await this.updateUser(user.nick, { status: "unfollowed" });
      const refs = this._refs();
      let touched = false;
      for (const r of refs) {
        if (r.referee !== user.nick || r.status === "revoked") continue;
        const since = global.NH_Clock.now() - (r.verifiedAt || r.createdAt);
        if (since <= windowDays * 86400000) {
          r.status = "revoked"; r.revokedAt = global.NH_Clock.now(); r.reason = "unfollow"; touched = true;
        }
      }
      if (touched) this._saveRefs(refs);
      return updated;
    }

    // ---- progression tables (game state, referrals, social, events) ----
    _refs() { return readJSON(KEY_REFS, []); }
    _saveRefs(list) { writeJSON(KEY_REFS, list); }
    async getGame(nick) { return readJSON(KEY_GAME, {})[nick.toLowerCase()] || null; }
    async setGame(nick, game) {
      const all = readJSON(KEY_GAME, {});
      all[nick.toLowerCase()] = game;
      writeJSON(KEY_GAME, all);
      return game;
    }
    async listGames() { return readJSON(KEY_GAME, {}); }
    async listReferrals() { return this._refs(); }
    async addReferral(ref) {
      const refs = this._refs();
      const r = Object.assign({ id: "r" + Math.random().toString(36).slice(2, 9), createdAt: global.NH_Clock.now(),
        status: "pending", notified: false }, ref);
      refs.push(r);
      this._saveRefs(refs);
      return r;
    }
    async updateReferral(id, patch) {
      const refs = this._refs();
      const r = refs.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch);
      this._saveRefs(refs);
      return r;
    }
    async getSocial(nick) {
      return readJSON(KEY_SOCIAL, {})[nick.toLowerCase()] || { likes: [], visits: 0, visitDays: {} };
    }
    async setSocial(nick, rec) {
      const all = readJSON(KEY_SOCIAL, {});
      all[nick.toLowerCase()] = rec;
      writeJSON(KEY_SOCIAL, all);
    }
    async listSocial() { return readJSON(KEY_SOCIAL, {}); }
    async addEvent(ev) {
      const list = readJSON(KEY_EVENTS, []);
      list.push(Object.assign({ ts: global.NH_Clock.now() }, ev));
      writeJSON(KEY_EVENTS, list.slice(-500));
    }
    async listEvents() { return readJSON(KEY_EVENTS, []); }

    async listAll() {
      return Object.values(this._all());
    }
  }

  global.NH_Store = { LocalStorageStore };
})(window);
