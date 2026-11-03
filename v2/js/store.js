// Pluggable data store. LocalStorageStore is the default (works with zero
// backend). SupabaseStore (see supabase/adapter.js) implements the same
// interface so swapping backends later is a one-line change in app.js.
(function (global) {
  const KEY_USERS = "nh_users_v1";
  const KEY_COUNTER = "nh_counter_v1";
  const KEY_STATS = "nh_stats_v1";

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
    return new Date().toISOString().slice(0, 10);
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

    async createUser({ nick, country, source, plot }) {
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
        createdAt: Date.now(),
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

    async verify(code) {
      const user = await this.getUserByCode(code);
      if (!user) return null;
      return this.updateUser(user.nick, { status: "verified" });
    }

    async unfollow(code) {
      const user = await this.getUserByCode(code);
      if (!user) return null;
      return this.updateUser(user.nick, { status: "unfollowed" });
    }

    async listAll() {
      return Object.values(this._all());
    }
  }

  global.NH_Store = { LocalStorageStore };
})(window);
