(function () {
  const $ = (sel) => document.querySelector(sel);
  const CLOSEUP_ZOOM = 3.4; // multiple of home zoom when flying to a building

  const App = {
    store: new window.NH_Store.LocalStorageStore(),
    economy: window.NH_Economy,
    city: window.NH_City,
    map: null,
    renderer: null,
    usersByPlot: new Map(),
    myNick: localStorage.getItem("nh_my_nick") || null,
    t: (key, vars) => window.NH_I18N.t(key, vars),
  };
  window.App = App;
  // ui.js looks up district names via app.layout.districts[id]
  Object.defineProperty(App, "layout", { get() { return App.map; } });

  function applyLangDir() {
    const dict = window.NH_I18N.TRANSLATIONS[window.NH_currentLang];
    document.documentElement.dir = (dict && dict.dir) || "ltr";
    document.documentElement.lang = window.NH_currentLang;
  }

  function setLang(lang) {
    window.NH_currentLang = lang;
    localStorage.setItem("nh_lang", lang);
    applyLangDir();
    window.NH_UI.renderHeaderTexts(App.t);
    if (App.renderer) App.renderer.setLocale(App.t);
    refreshStats();
  }

  async function refreshUsersIndex() {
    const all = await App.store.listAll();
    App.usersByPlot = new Map(all.map((u) => [u.plotId, u]));
    if (App.renderer) {
      for (const slot of App.map.slots) App.renderer.refreshPin(slot.id, App.usersByPlot.get(slot.id) || null);
    }
    return all;
  }

  async function refreshStats() {
    const stats = await App.store.getStats();
    window.NH_UI.renderStats(stats, App.t);
    if (App.renderer) App.renderer.setResidents(stats.residents);
    return stats;
  }

  App.getMyUser = () => {
    if (!App.myNick) return null;
    for (const u of App.usersByPlot.values()) if (u.nick === App.myNick) return u;
    return null;
  };

  async function refreshCoinsPill() {
    const user = App.getMyUser();
    window.NH_UI.renderCoins(user ? user.coins : 0);
  }

  function buildLink(user) {
    return `${location.origin}${location.pathname}#${user.nick}`;
  }
  App.copyInviteLink = async (user) => {
    const link = buildLink(user) + `?ref=${user.nick}`;
    try { await navigator.clipboard.writeText(link); } catch (e) {}
  };

  // -------- seed demo data on first run so the city isn't empty --------
  async function seedDemoIfEmpty() {
    const all = await App.store.listAll();
    if (all.length > 0) return;
    const demoNicks = [
      ["nextepisode.tv", "US", "instagram", "verified", 120],
      ["pixel.raven", "US", "instagram", "verified"],
      ["mika.codes", "JP", "tiktok", "verified"],
      ["lara_builds", "BR", "instagram", "verified"],
      ["chromewolf", "DE", "tiktok", "verified"],
      ["suna.aesthetics", "TR", "instagram", "verified"],
      ["kai_draws", "KR", "tiktok", "verified"],
      ["neon.nadia", "EG", "instagram", "pending"],
      ["ivy.static", "GB", "tiktok", "verified"],
      ["ramonflux", "MX", "instagram", "unfollowed"],
      ["token_tilly", "FR", "tiktok", "verified"],
    ];
    const claimed = new Set();
    for (const [nick, country, source, status, coins] of demoNicks) {
      const stats = await App.store.getStats();
      const free = App.city.findFreePlot(App.map, claimed, stats.residents);
      if (!free) break;
      claimed.add(free.plotId);
      const user = await App.store.createUser({ nick, country, source, plot: free });
      await App.store.updateUser(nick, { status, coins: coins ?? (80 + Math.floor(Math.random() * 400)) });
    }
  }

  // -------- card actions --------
  App.onCardAction = async (act, user, overlay) => {
    const t = App.t;
    if (act === "build") {
      if (user.status === "pending") {
        window.NH_UI.openCodeModal(App, user);
      } else if (user.status === "unfollowed") {
        window.NH_UI.showToast("💔 " + t("unfollowedHint"));
      } else {
        window.NH_UI.showToast("✅ " + t("statusVerified"));
      }
    } else if (act === "share") {
      const link = buildLink(user);
      if (navigator.share) {
        try { await navigator.share({ title: user.buildingName, url: link }); } catch (e) {}
      } else {
        try { await navigator.clipboard.writeText(link); window.NH_UI.showToast(t("copySuccess")); } catch (e) {}
      }
      if (user.nick === App.myNick) await window.NH_Game.recordShare(user.nick);
      if (user.nick === App.myNick && App.economy.isNewDay(user.lastShare)) {
        await App.store.updateUser(user.nick, {
          coins: user.coins + App.economy.SHARE_REWARD, lastShare: App.economy.todayStamp(),
        });
        await refreshUsersIndex();
        refreshCoinsPill();
      }
    } else if (act === "live") {
      App.copyInviteLink(user);
      window.NH_UI.showToast("👥 " + t("copySuccess"));
    } else if (act === "upgrade") {
      window.NH_UI.openUpgrades(App, user);
    } else if (act === "flag") {
      window.NH_UI.showToast(`🚩 ${user.buildingName}!`);
      if (user.nick === App.myNick) { await window.NH_Game.setFlag(user.nick); App.refreshAll(); }
    } else if (act === "change") {
      const stats = await App.store.getStats();
      const claimed = new Set([...App.usersByPlot.keys()]);
      const next = App.city.randomFreePlot(App.map, claimed, stats.residents, user.plotId);
      if (!next) { window.NH_UI.showToast(t("upgradeLocked")); return; }
      const oldSlot = user.plotId;
      await App.store.updateUser(user.nick, { plotId: next.plotId, districtId: next.districtId });
      await refreshUsersIndex();
      App.renderer.refreshPin(oldSlot, null);
      App.renderer.flyTo(next.plotId, CLOSEUP_ZOOM);
      window.NH_UI.showToast("🔄 " + t("btnChange"));
    } else if (act === "copy") {
      try { await navigator.clipboard.writeText(buildLink(user)); window.NH_UI.showToast(t("copySuccess")); } catch (e) {}
    }
  };

  App.onFollowAgain = async (user, overlay) => {
    await App.store.updateUser(user.nick, { status: "verified" });
    await refreshUsersIndex();
    window.NH_UI.closeOverlay(overlay);
    const updated = App.usersByPlot.get(user.plotId);
    window.NH_UI.openCard(App, updated);
  };

  App.buyUpgrade = async (nick, key) => {
    const user = await App.store.getUserByNick(nick);
    const defs = App.economy.UPGRADE_DEFS;
    let cost;
    const up = Object.assign({}, user.upgrades);
    if (key === "floors") {
      cost = App.economy.floorsCost(up.floors || 0);
      if (!App.economy.canAfford(user.coins, cost)) return { ok: false };
      up.floors = (up.floors || 0) + 1;
    } else if (key === "neonColor") {
      cost = defs.neonColor.baseCost;
      if (!App.economy.canAfford(user.coins, cost)) return { ok: false };
      const palette = ["cyan", "magenta", "violet", "gold", "teal", "red"];
      up.neonColor = palette[Math.floor(Math.random() * palette.length)];
    } else {
      if (up[key]) return { ok: false };
      cost = defs[key].baseCost;
      if (!App.economy.canAfford(user.coins, cost)) return { ok: false };
      up[key] = true;
    }
    const value = App.economy.computeValue({ ...user, upgrades: up });
    const level = App.economy.computeLevel(value);
    const updated = await App.store.updateUser(nick, { coins: user.coins - cost, upgrades: up, level });
    await refreshUsersIndex();
    refreshCoinsPill();
    await window.NH_Game.onBuildingUpgrade(nick);
    return { ok: true, user: updated };
  };

  App.dailyCheckin = async (nick) => {
    const user = await App.store.getUserByNick(nick);
    if (!App.economy.isNewDay(user.lastCheckin)) return null;
    const updated = await App.store.updateUser(nick, {
      coins: user.coins + App.economy.DAILY_CHECKIN_REWARD, lastCheckin: App.economy.todayStamp(),
    });
    await refreshUsersIndex();
    refreshCoinsPill();
    return updated;
  };

  App.dailyDraw = async (nick) => {
    const user = await App.store.getUserByNick(nick);
    if (!App.economy.isNewDay(user.lastDraw)) return null;
    const amount = App.economy.DAILY_DRAW_MIN + Math.floor(Math.random() * (App.economy.DAILY_DRAW_MAX - App.economy.DAILY_DRAW_MIN));
    await App.store.updateUser(nick, { coins: user.coins + amount, lastDraw: App.economy.todayStamp() });
    await refreshUsersIndex();
    refreshCoinsPill();
    return { amount };
  };

  App.completeRegistration = async (data) => {
    const stats = await App.store.getStats();
    const claimed = new Set([...App.usersByPlot.keys()]);
    const free = App.city.findFreePlot(App.map, claimed, stats.residents);
    if (!free) throw new Error("City is full — more districts unlocking soon!");
    const existing = await App.store.getUserByNick(data.nick);
    if (existing) throw new Error(App.t("notFound"));
    const user = await App.store.createUser({ ...data, plot: free, deviceHash: window.NH_deviceHash ? window.NH_deviceHash() : null });
    localStorage.setItem("nh_my_nick", user.nick);
    App.myNick = user.nick;
    await refreshUsersIndex();
    await refreshStats();
    refreshCoinsPill();
    await window.NH_Game.onRegistered(user);
    await App.refreshAll();
    return user;
  };

  App.onAfterRegistration = (user) => {
    App.renderer.flyTo(user.plotId, CLOSEUP_ZOOM);
    setTimeout(() => {
      const fresh = App.usersByPlot.get(user.plotId) || user;
      window.NH_UI.openCard(App, fresh);
    }, 950);
  };

  async function findOrRegister(nickRaw) {
    const nick = nickRaw.trim().replace(/^@/, "");
    if (!nick) return;
    const user = await App.store.getUserByNick(nick);
    if (user) {
      localStorage.setItem("nh_my_nick", user.nick);
      App.myNick = user.nick;
      refreshCoinsPill();
      App.renderer.flyTo(user.plotId, CLOSEUP_ZOOM);
      setTimeout(() => window.NH_UI.openCard(App, user), 950);
    } else {
      window.NH_UI.openRegistration(App, nick);
    }
  }

  // -------- NH global API (verify / unfollow via comment codes) --------
  window.NH = {
    verify: async (code) => {
      const user = await App.store.verify(code);
      if (user) { await refreshUsersIndex(); await refreshStats(); await window.NH_Game.afterVerify(user); await App.refreshAll(); }
      return user;
    },
    unfollow: async (code) => {
      const user = await App.store.unfollow(code);
      if (user) { await refreshUsersIndex(); await App.refreshAll(); }
      return user;
    },
    debugAdvance: async (hours) => {
      window.NH_Clock.advance(hours * 3600000);
      if (App.myNick) { await window.NH_Game.touchLogin(App.myNick); await window.NH_Game.sync(App.myNick); }
      await App.store.expireReferrals?.();
      await App.refreshAll();
    },
    debugGrantCoins: async (n) => { const u = App.getMyUser(); if (u) { await App.store.updateUser(u.nick, { coins: u.coins + n }); await App.refreshAll(); } },
    debugGrantXp: async (n) => { const u = App.getMyUser(); if (u) { await window.NH_Game.act(u.nick, (g, uu, ctx) => { window.NH_Game._addXp(g, ctx, n); }); await App.refreshAll(); } },
    simulateReferral: (nick, opts) => window.NH_Game.simulateReferral(nick, opts),
    findBuilding: (nick) => findOrRegister(nick),
  };

  function buildAmbientFX() {
    const layer = $("#light-streaks");
    const hues = ["cyan", "magenta"];
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "streak " + hues[i % 2];
      s.style.top = (8 + Math.random() * 60) + "%";
      s.style.animationDuration = (4.5 + Math.random() * 5) + "s";
      s.style.animationDelay = (-Math.random() * 10) + "s";
      layer.appendChild(s);
    }
    const colors = ["#7ef9ff", "#ff7ef0", "#ffd36a"];
    for (let i = 0; i < 18; i++) {
      const g = document.createElement("div");
      g.className = "glint";
      g.style.left = Math.random() * 100 + "%";
      g.style.top = (10 + Math.random() * 75) + "%";
      g.style.color = colors[i % colors.length];
      g.style.animationDuration = (1.6 + Math.random() * 2.4) + "s";
      g.style.animationDelay = (-Math.random() * 4) + "s";
      layer.appendChild(g);
    }
  }

  App.refreshAll = async () => {
    await refreshUsersIndex(); await refreshStats(); refreshCoinsPill();
    if (window.NH_Panels) await window.NH_Panels.renderHud();
  };

  // visit counter + like button on resident cards (feeds quests/XP)
  App.decorateCard = async (sheet, user) => {
    const G = window.NH_Game, row = sheet.querySelector("#social-row");
    if (!row) return;
    const me = App.myNick;
    if (me && me !== user.nick) await G.visit(me, user.nick);
    const draw = async () => {
      const c = await G.socialCounts(user.nick);
      row.innerHTML = `<span>👁 ${c.visits} ${App.t("visitsLabel")}</span><span>❤️ ${c.likes} ${App.t("likesLabel")}</span>` +
        (me && me !== user.nick ? `<button class="like-btn ${c.likedByMe ? "liked" : ""}" ${c.likedByMe ? "disabled" : ""}>${c.likedByMe ? App.t("likedBtn") : "❤ " + App.t("likeBtn")}</button>` : "");
      const b = row.querySelector(".like-btn");
      if (b) b.addEventListener("click", async () => { await G.like(me, user.nick); await draw(); App.refreshAll(); });
    };
    await draw();
    App.refreshAll();
  };

  async function init() {
    window.NH_currentLang = localStorage.getItem("nh_lang") || window.NH_I18N.detectLang();
    applyLangDir();
    window.NH_UI.renderHeaderTexts(App.t);
    window.NH_UI.populateLangPicker(window.NH_currentLang, setLang);
    buildAmbientFX();

    App.map = await App.city.loadMap();
    await window.NH_Game.load();
    window.NH_Game.captureRef();
    const G = window.NH_Game;
    G.hooks.toast = (m) => window.NH_UI.showToast(m);
    G.hooks.changed = async (nick, ctx) => {
      for (const l of ctx.levelUps.slice(-1)) window.NH_UI.showToast('⭐ ' + App.t('levelUp', { n: l }));
      for (const m of ctx.milestones) window.NH_UI.showToast('🏆 Level ' + m.level + ': +' + m.coins + ' 🪙');
      if (nick === App.myNick) { await refreshUsersIndex(); refreshCoinsPill(); window.NH_Panels.renderHud(); }
    };

    await seedDemoIfEmpty();
    await refreshUsersIndex();
    await G.ensureAllGames();
    await refreshStats();
    refreshCoinsPill();
    if (App.myNick) { await G.touchLogin(App.myNick); await G.pollNotifications(); }
    window.NH_Panels.renderHud();

    const viewport = $("#map-viewport");
    App.renderer = new window.NH_Render.MapView(viewport, {
      map: App.map,
      getUserBySlot: (slotId) => App.usersByPlot.get(slotId),
      onPick: (user) => window.NH_UI.openCard(App, user),
    });
    App.renderer.setLocale(App.t);
    await App.renderer.ready;
    await refreshUsersIndex();
    await refreshStats();

    $("#find-btn").addEventListener("click", () => findOrRegister($("#search-input").value));
    $("#search-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") findOrRegister($("#search-input").value);
    });
    $("#biz-btn").addEventListener("click", () => window.NH_Panels.openBusinesses(App));
    $("#quests-btn").addEventListener("click", () => window.NH_Panels.openQuests(App));
    $("#invite-btn").addEventListener("click", () => window.NH_Panels.openInvite(App));
    $("#faq-btn").addEventListener("click", () => window.NH_Panels.openFaq(App));
    const qp = new URLSearchParams(location.search);
    if (qp.get("admin")) window.NH_Panels.openAdmin();
    if (qp.get("news")) window.NH_Panels.openNews();
    $("#coins-btn").addEventListener("click", () => window.NH_UI.openCoins(App));
    $("#settings-btn").addEventListener("click", () => window.NH_UI.openCoins(App));

    if (location.hash && location.hash.length > 1) {
      const nick = decodeURIComponent(location.hash.slice(1));
      $("#search-input").value = nick;
      findOrRegister(nick);
    }

    setInterval(refreshStats, 15000);
  }

  init();
})();
