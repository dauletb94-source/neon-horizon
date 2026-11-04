// NEON HORIZON progression layer: levels/XP, businesses (idle income), referrals,
// quests + chests, social (likes/visits), leaderboards, city-news data.
// All persistence goes through App.store (see js/store.js) so a Supabase adapter can replace it.
// All mutations are serialised through act() so concurrent UI taps can't corrupt state.
(function (global) {
  const Clock = global.NH_Clock;
  const G = { cfg: null, biz: [], bizById: {}, quests: null, ready: null, hooks: {} };
  let queue = Promise.resolve();
  const S = () => global.App.store;
  const HOUR = 3600000;

  async function load() {
    const get = (u) => fetch(u).then((r) => r.json());
    const [cfg, biz, quests] = await Promise.all([get("data/economy.json"), get("data/businesses.json"), get("data/quests.json")]);
    G.cfg = cfg; G.biz = biz.types; G.quests = quests;
    G.bizById = Object.fromEntries(G.biz.map((t) => [t.id, t]));
    if (global.NH_Economy) global.NH_Economy.setCheckinLadder(cfg.dailyCheckinLadder);
    return G;
  }
  G.load = load;

  // ---------------- math ----------------
  const xpToNext = (l) => Math.round(G.cfg.levelCurve.coef * Math.pow(l, G.cfg.levelCurve.exp));
  function levelInfo(xp) {
    const max = G.cfg.levelCurve.maxLevel;
    let l = 1, rem = xp;
    while (l < max) { const n = xpToNext(l); if (rem < n) break; rem -= n; l++; }
    return { level: l, into: l >= max ? 0 : rem, need: l >= max ? 0 : xpToNext(l) };
  }
  function cumXp(level) { let x = 0; for (let l = 1; l < level; l++) x += xpToNext(l); return x; }
  const slotsFor = (level) => Math.min(G.cfg.plotSlots.max, G.cfg.plotSlots.base + Math.floor(level / G.cfg.plotSlots.everyLevels));
  const milestoneCoins = (l) => Math.round(G.cfg.levelCurve.milestoneCoinsCoef * Math.pow(l, G.cfg.levelCurve.milestoneCoinsExp) / 10) * 10;
  const chestCoins = (l) => Math.round(G.cfg.levelCurve.levelUpChestCoinsCoef * Math.pow(l, G.cfg.levelCurve.levelUpChestCoinsExp));
  const collectXp = (coins) => Math.max(1, Math.round(G.cfg.xp.collectCoef * Math.pow(coins, G.cfg.xp.collectExp)));

  const B = () => G.cfg.businesses;
  const bizType = (b) => G.bizById[b.type];
  const bizRate = (b) => bizType(b).baseIncomePerHour * Math.pow(B().incomeGrowthPerLevel, b.level - 1);
  function bizCapHours(b) {
    const t = bizType(b);
    return Math.min(B().storageMaxHours, t.storageBaseHours + (b.level - 1) * (B().storageMaxHours - t.storageBaseHours) / (B().maxLevel - 1));
  }
  const upgradeCost = (t, level) => Math.round(t.buildCost * B().upgradeCostFactor * Math.pow(B().costGrowthPerLevel, level - 1));
  function bizStored(b, now) {
    const rate = bizRate(b), cap = rate * bizCapHours(b);
    return Math.min(cap, (b.banked || 0) + rate * Math.max(0, now - b.last) / HOUR);
  }
  // Maintenance / tax sink (data/economy.json -> maintenance): upkeep accrues continuously as a % of business value per day,
  // is capped at maxAccrualDays of upkeep, and is only ever deducted from income being collected (coins can't go negative).
  const DAY_MS = 24 * HOUR;
  const MT = () => G.cfg.maintenance || { dailyPct: 0, maxAccrualDays: 3 };
  const upkeepPerDay = (b) => bizValue(b) * MT().dailyPct;
  function accrueUpkeep(b, now) {
    const per = upkeepPerDay(b), since = b.upkeepAt || b.builtAt || b.last || now;
    b.owed = Math.min(per * MT().maxAccrualDays, (b.owed || 0) + per * Math.max(0, now - since) / DAY_MS);
    b.upkeepAt = now;
    return b.owed;
  }
  // Settle upkeep against freshly collected gross coins; returns net coins (>= 0).
  function payUpkeep(g, b, gross, now) {
    const paid = Math.min(Math.floor(accrueUpkeep(b, now)), gross);
    b.owed = Math.max(0, b.owed - paid);
    if (paid > 0) g.t.upkeepPaid = (g.t.upkeepPaid || 0) + paid;
    return gross - paid;
  }
  function bizValue(b) {
    const t = bizType(b);
    let v = t.buildCost;
    for (let l = 1; l < b.level; l++) v += upgradeCost(t, l);
    return v;
  }
  const netWorthOf = (user, g) => {
    const bv = (g ? g.businesses : []).reduce((s, b) => s + bizValue(b), 0);
    const base = global.NH_Economy.computeValue(user).total;
    return { building: base, businesses: bv, total: base + bv };
  };

  // ---------------- game record ----------------
  const uid = () => Math.random().toString(36).slice(2, 9);
  function newGame(extra) {
    return Object.assign({
      v: 1, xp: 0, level: 1, milestones: [], badges: [], flag: false, landmark: false,
      businesses: [], t: {}, periods: { daily: { stamp: null, c: {} }, weekly: { stamp: null, c: {} } },
      claimed: {}, chests: [], refClaimed: [], lastLogin: null, loginStreak: 0, createdAt: Clock.now(),
      demo: false, demoRefs: 0, starterGiven: false,
    }, extra || {});
  }
  function weekStamp(t) {
    const d = new Date(t === undefined ? Clock.now() : t);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(d.getTime() - day * 86400000).toISOString().slice(0, 10);
  }
  function rollPeriods(g) {
    const ds = Clock.stamp(), ws = weekStamp();
    if (g.periods.daily.stamp !== ds) g.periods.daily = { stamp: ds, c: {} };
    if (g.periods.weekly.stamp !== ws) g.periods.weekly = { stamp: ws, c: {} };
  }
  function bump(g, metric, n = 1) {
    rollPeriods(g);
    g.t[metric] = (g.t[metric] || 0) + n;
    g.periods.daily.c[metric] = (g.periods.daily.c[metric] || 0) + n;
    g.periods.weekly.c[metric] = (g.periods.weekly.c[metric] || 0) + n;
  }

  function newCtx() { return { coins: 0, levelUps: [], milestones: [], msgs: [], events: [] }; }
  function addXp(g, ctx, n) {
    n = Math.round(n);
    if (!(n > 0)) return;
    const before = g.level;
    g.xp += n;
    g.level = levelInfo(g.xp).level;
    for (let l = before + 1; l <= g.level; l++) {
      g.chests.push({ id: uid(), type: "levelup", coins: chestCoins(l), xp: 0, level: l, ts: Clock.now() });
      ctx.levelUps.push(l);
      if (l % G.cfg.levelCurve.milestoneEvery === 0) {
        const mc = milestoneCoins(l);
        g.milestones.push(l); ctx.coins += mc; ctx.milestones.push({ level: l, coins: mc });
      }
    }
  }

  // Managers auto-collect (at a fee) whenever state is evaluated; works offline up to a cap.
  function settleManagers(g, ctx, now) {
    for (const b of g.businesses) {
      if (!b.manager) continue;
      const dt = Math.min(now - b.last, B().managerOfflineCapHours * HOUR);
      const gross = (b.banked || 0) + bizRate(b) * dt / HOUR;
      b.banked = 0; b.last = now;
      const net = payUpkeep(g, b, Math.floor(gross * (1 - B().managerFee)), now);
      if (net >= 1) { ctx.coins += net; g.t.earned = (g.t.earned || 0) + net; addXp(g, ctx, collectXp(net)); }
    }
  }

  // ---------------- demo residents (so leaderboards are never empty) ----------------
  function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  async function makeDemoGame(user) {
    const r = rng(hashStr(user.nick));
    const boss = user.nick === "nextepisode.tv";
    const level = boss ? 48 : 3 + Math.floor(r() * 38);
    const g = newGame({ demo: true, level, xp: cumXp(level) + Math.floor(r() * xpToNext(level) * 0.6), createdAt: user.createdAt || Clock.now() });
    const unlocked = G.biz.filter((t) => t.unlockLevel <= level);
    const n = Math.min(slotsFor(level), boss ? 9 : 1 + Math.floor(r() * Math.min(6, unlocked.length)));
    const now = Clock.now();
    for (let i = 0; i < n; i++) {
      const t = i === 0 ? unlocked[0] : unlocked[Math.floor(r() * unlocked.length)];
      const lvl = 1 + Math.floor(r() * Math.min(B().maxLevel - 1, 2 + level * 0.5));
      g.businesses.push({ uid: uid(), type: t.id, level: lvl, banked: 0, last: now - Math.floor(r() * 10 * HOUR), manager: r() < 0.2, builtAt: now - Math.floor(r() * 20 * HOUR) });
      const b = g.businesses[g.businesses.length - 1];
      await S().addEvent({ type: "build", nick: user.nick, biz: t.id, level: 1, value: t.buildCost, ts: now - Math.floor(r() * 20 * HOUR) });
      if (lvl > 1) await S().addEvent({ type: "upgrade", nick: user.nick, biz: t.id, level: lvl, value: upgradeCost(t, lvl - 1), ts: now - Math.floor(r() * 20 * HOUR) });
    }
    g.demoRefs = boss ? 31 : (r() < 0.45 ? Math.floor(r() * 14) : 0);
    g.flag = true;
    await S().setSocial(user.nick, { likes: [], visits: 20 + Math.floor(r() * 400), visitDays: {}, demoLikes: 5 + Math.floor(r() * 120) });
    return g;
  }
  async function ensureGame(nick) {
    let g = await S().getGame(nick);
    if (g) {
      for (const k of ["t", "claimed", "chests", "refClaimed", "businesses", "badges", "milestones"]) if (!g[k]) g[k] = k === "t" || k === "claimed" ? {} : [];
      if (!g.periods) g.periods = newGame().periods;
      return g;
    }
    const user = await S().getUserByNick(nick);
    const isMe = global.App.myNick && global.App.myNick.toLowerCase() === nick.toLowerCase();
    g = (user && !isMe) ? await makeDemoGame(user) : newGame({ createdAt: user ? user.createdAt : Clock.now() });
    await S().setGame(nick, g);
    return g;
  }
  async function ensureAllGames() {
    const users = await S().listAll();
    for (const u of users) await ensureGame(u.nick);
  }
  G.ensureGame = ensureGame; G.ensureAllGames = ensureAllGames;

  // ---------------- act(): serialised read-modify-write ----------------
  function act(nick, fn) {
    const run = async () => {
      const g = await ensureGame(nick);
      const user = await S().getUserByNick(nick);
      const ctx = newCtx();
      settleManagers(g, ctx, Clock.now());
      const res = await fn(g, user, ctx, Clock.now());
      if (ctx.coins && user) {
        const fresh = await S().getUserByNick(nick);
        await S().updateUser(nick, { coins: Math.max(0, fresh.coins + ctx.coins) });
      }
      await S().setGame(nick, g);
      if (G.hooks.changed) { try { await G.hooks.changed(nick, ctx); } catch (e) { console.warn(e); } }
      return res;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }
  G.act = act;
  const sync = (nick) => act(nick, () => true);
  G.sync = sync;

  // ---------------- login / chests ----------------
  async function touchLogin(nick) {
    return act(nick, (g, user, ctx) => {
      const today = Clock.stamp();
      if (g.lastLogin === today) return null;
      const gap = g.lastLogin ? global.NH_Economy.dayDiff(g.lastLogin, today) : 1;
      const cb = G.cfg.chests;
      if (g.lastLogin && gap >= cb.comeback.afterDays) g.chests.push({ id: uid(), type: "comeback", coins: cb.comeback.coins, xp: cb.comeback.xp, ts: Clock.now() });
      g.loginStreak = gap === 1 ? (g.loginStreak || 0) + 1 : 1;
      if (g.loginStreak % cb.streak.everyDays === 0) g.chests.push({ id: uid(), type: "streak", coins: cb.streak.coins, xp: cb.streak.xp, ts: Clock.now() });
      g.lastLogin = today;
      bump(g, "login");
      const x = G.cfg.xp;
      addXp(g, ctx, x.dailyLogin + x.loginStreakBonusPerDay * Math.min(g.loginStreak, x.loginStreakCapDays));
      ctx.msgs.push("login");
      return { streak: g.loginStreak };
    });
  }
  G.touchLogin = touchLogin;

  function openChestIn(g, ctx, id) {
    const i = g.chests.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = g.chests.splice(i, 1)[0];
    ctx.coins += c.coins || 0;
    addXp(g, ctx, c.xp || 0);
    return c;
  }
  G.openChest = (nick, id) => act(nick, (g, u, ctx) => openChestIn(g, ctx, id));
  G.openAllChests = (nick) => act(nick, (g, u, ctx) => {
    const out = [];
    for (const c of g.chests.slice()) out.push(openChestIn(g, ctx, c.id));
    return out;
  });
  G.afterVerify = async (user) => {
    await act(user.nick, (g, u, ctx) => {
      if (!g.starterGiven) { g.starterGiven = true; g.chests.push({ id: uid(), type: "starter", coins: G.cfg.chests.starter.coins, xp: G.cfg.chests.starter.xp, ts: Clock.now() }); }
      addXp(g, ctx, G.cfg.xp.verify);
    });
    await G.pollNotifications();
  };

  // ---------------- building (tower) hooks called from app.js ----------------
  G.onBuildingUpgrade = (nick) => act(nick, (g, u, ctx) => { bump(g, "upgrades"); addXp(g, ctx, G.cfg.xp.buildingUpgrade); });
  G.setFlag = (nick) => act(nick, (g, u, ctx) => { if (!g.flag) { g.flag = true; addXp(g, ctx, 10); return true; } return false; });
  G.recordShare = (nick) => act(nick, (g, u, ctx) => {
    bump(g, "shares");
    const day = Clock.stamp();
    if (g.shareXpDay !== day) { g.shareXpDay = day; addXp(g, ctx, G.cfg.xp.share); }
  });
  G.onRegistered = async (user) => {
    await act(user.nick, (g) => { bump(g, "register"); });
    const cap = readCapture();
    if (!cap) return null;
    const refs = await S().listReferrals();
    const referrer = await S().getUserByNick(cap.nick);
    localStorage.removeItem(CAPTURE_KEY);
    if (!referrer || referrer.nick === user.nick) return null; // no self-referral
    let status = "pending", reason = null;
    if (referrer.deviceHash && referrer.deviceHash === user.deviceHash) { status = "revoked"; reason = "same-device-as-referrer"; }
    else if (user.deviceHash && refs.filter((r) => r.deviceHash === user.deviceHash && r.status !== "revoked").length >= G.cfg.referral.deviceLimit) { status = "revoked"; reason = "device-limit"; }
    return S().addReferral({ referrer: referrer.nick, referee: user.nick, status, reason, deviceHash: user.deviceHash || null, ip: null });
  };

  // ---------------- businesses ----------------
  G.build = (nick, typeId) => act(nick, async (g, user, ctx, now) => {
    const t = G.bizById[typeId];
    if (!t || !user) return { ok: false, reason: "unknown" };
    if (B().requiresVerified && user.status !== "verified") return { ok: false, reason: "verify" };
    if (g.level < t.unlockLevel) return { ok: false, reason: "level" };
    if (g.businesses.length >= slotsFor(g.level)) return { ok: false, reason: "slots" };
    if (user.coins + ctx.coins < t.buildCost) return { ok: false, reason: "coins" };
    ctx.coins -= t.buildCost;
    const b = { uid: uid(), type: t.id, level: 1, banked: 0, last: now, manager: false, builtAt: now, upkeepAt: now, owed: 0 };
    g.businesses.push(b);
    bump(g, "builds"); bump(g, "built_" + t.id);
    addXp(g, ctx, G.cfg.xp.businessBuild * t.tier);
    await S().addEvent({ type: "build", nick: user.nick, biz: t.id, level: 1, value: t.buildCost });
    return { ok: true, biz: b };
  });
  G.upgradeBiz = (nick, buid) => act(nick, async (g, user, ctx, now) => {
    const b = g.businesses.find((x) => x.uid === buid);
    if (!b) return { ok: false, reason: "unknown" };
    const t = bizType(b);
    if (b.level >= B().maxLevel) return { ok: false, reason: "max" };
    const cost = upgradeCost(t, b.level);
    if (user.coins + ctx.coins < cost) return { ok: false, reason: "coins" };
    accrueUpkeep(b, now); // settle upkeep at the old value before it grows
    b.banked = bizStored(b, now); b.last = now; // keep what already accrued at the old rate
    ctx.coins -= cost; b.level++;
    bump(g, "bizUpgrades"); bump(g, "upgrades");
    addXp(g, ctx, G.cfg.xp.businessUpgradeBase + G.cfg.xp.businessUpgradePerLevel * b.level * t.tier);
    await S().addEvent({ type: "upgrade", nick: user.nick, biz: t.id, level: b.level, value: cost });
    return { ok: true, level: b.level, cost };
  });
  G.collect = (nick, target) => act(nick, (g, user, ctx, now) => {
    let total = 0, gross = 0, n = 0;
    for (const b of g.businesses) {
      if (target !== "all" && b.uid !== target) continue;
      if (b.manager) continue;
      const c = Math.floor(bizStored(b, now));
      if (c < 1) continue;
      gross += c; n++; b.banked = bizStored(b, now) - c; b.last = now;
      total += payUpkeep(g, b, c, now);
    }
    if (gross < 1) return { ok: false, reason: "empty" };
    ctx.coins += total; g.t.earned = (g.t.earned || 0) + total;
    bump(g, "collects");
    addXp(g, ctx, collectXp(gross));
    return { ok: true, total, gross, upkeep: gross - total, n };
  });
  G.buyManager = (nick, buid) => act(nick, (g, user, ctx) => {
    const b = g.businesses.find((x) => x.uid === buid);
    if (!b || b.manager) return { ok: false, reason: "unknown" };
    const cost = bizType(b).managerCost;
    if (user.coins + ctx.coins < cost) return { ok: false, reason: "coins" };
    ctx.coins -= cost; b.manager = true;
    return { ok: true, cost };
  });

  // Read-only snapshot for UIs
  G.snapshot = async (nick) => {
    const g = await ensureGame(nick);
    const user = await S().getUserByNick(nick);
    const now = Clock.now();
    const li = levelInfo(g.xp);
    const rows = g.businesses.map((b) => {
      const t = bizType(b);
      return {
        b, t, rate: bizRate(b), capHours: bizCapHours(b), stored: Math.floor(bizStored(b, now)), cap: Math.floor(bizRate(b) * bizCapHours(b)),
        upCost: b.level < B().maxLevel ? upgradeCost(t, b.level) : null, nextRate: bizRate(b) * B().incomeGrowthPerLevel, value: bizValue(b),
        upkeepDay: upkeepPerDay(b), owed: Math.floor(Math.min(upkeepPerDay(b) * MT().maxAccrualDays, (b.owed || 0) + upkeepPerDay(b) * Math.max(0, now - (b.upkeepAt || b.builtAt || b.last || now)) / DAY_MS)),
      };
    });
    return { g, user, li, rows, slots: slotsFor(g.level), net: user ? netWorthOf(user, g) : null, now };
  };
  G.upkeepPerDay = upkeepPerDay;
  G.bizRate = bizRate; G.bizStored = bizStored; G.upgradeCost = upgradeCost; G.bizValue = bizValue; G.slotsFor = slotsFor;
  G.levelInfo = levelInfo; G.xpToNext = xpToNext; G.cumXp = cumXp; G.milestoneCoins = milestoneCoins; G.netWorthOf = netWorthOf;

  // ---------------- social (likes / visits) ----------------
  G.visit = async (visitor, target) => {
    if (!visitor || visitor.toLowerCase() === target.toLowerCase()) return { counted: false };
    const soc = await S().getSocial(target);
    const day = Clock.stamp();
    if (soc.visitDays[visitor] === day) return { counted: false, visits: soc.visits };
    soc.visitDays[visitor] = day; soc.visits = (soc.visits || 0) + 1;
    await S().setSocial(target, soc);
    await act(target, (g, u, ctx) => { bump(g, "visitsReceived"); addXp(g, ctx, G.cfg.xp.visitReceived); });
    await act(visitor, (g, u, ctx) => { bump(g, "visits"); addXp(g, ctx, G.cfg.xp.visitGiven); });
    return { counted: true, visits: soc.visits };
  };
  G.like = async (visitor, target) => {
    if (!visitor || visitor.toLowerCase() === target.toLowerCase()) return { ok: false };
    const soc = await S().getSocial(target);
    if ((soc.likes || []).includes(visitor)) return { ok: false, already: true };
    soc.likes = (soc.likes || []).concat(visitor);
    await S().setSocial(target, soc);
    await act(target, (g, u, ctx) => { bump(g, "likesReceived"); addXp(g, ctx, G.cfg.xp.likeReceived); });
    await act(visitor, (g, u, ctx) => { bump(g, "likesGiven"); addXp(g, ctx, G.cfg.xp.likeGiven); });
    return { ok: true, likes: soc.likes.length + (soc.demoLikes || 0) };
  };
  G.socialCounts = async (nick) => {
    const soc = await S().getSocial(nick);
    return { visits: soc.visits || 0, likes: (soc.likes || []).length + (soc.demoLikes || 0), likedByMe: (soc.likes || []).includes(global.App.myNick) };
  };

  // ---------------- referrals ----------------
  const CAPTURE_KEY = "nh_ref_capture_v1";
  function readCapture() { try { return JSON.parse(localStorage.getItem(CAPTURE_KEY)); } catch (e) { return null; } }
  // First visit with ?ref=NICK stores the referrer; later visits never overwrite it.
  G.captureRef = () => {
    let ref = new URLSearchParams(location.search).get("ref");
    if (!ref) { const m = /[?&]ref=([^&]+)/.exec(location.hash || ""); if (m) ref = decodeURIComponent(m[1]); }
    if (!ref || localStorage.getItem(CAPTURE_KEY)) return readCapture();
    const rec = { nick: ref.trim().replace(/^@/, "").toLowerCase(), ts: Clock.now() };
    localStorage.setItem(CAPTURE_KEY, JSON.stringify(rec));
    return rec;
  };
  G.getCapture = readCapture;
  G.referralLink = (nick) => `${location.origin}${location.pathname}?ref=${encodeURIComponent(nick)}`;

  G.referralInfo = async (nick) => {
    const refs = (await S().listReferrals()).filter((r) => r.referrer === nick.toLowerCase());
    const g = await ensureGame(nick);
    const verified = refs.filter((r) => r.status === "verified").length;
    return { refs, verified, pending: refs.filter((r) => r.status === "pending").length, revoked: refs.filter((r) => r.status === "revoked").length, g, ladder: G.cfg.referralLadder };
  };
  G.claimReferral = (nick, friends, choice) => act(nick, async (g, user, ctx) => {
    const tier = G.cfg.referralLadder.find((x) => x.friends === friends);
    const refs = (await S().listReferrals()).filter((r) => r.referrer === nick.toLowerCase() && r.status === "verified");
    if (!tier || refs.length < friends || g.refClaimed.includes(friends)) return { ok: false };
    const up = Object.assign({}, user.upgrades);
    if (tier.premiumChoice) {
      if (!tier.premiumChoice.includes(choice)) return { ok: false, reason: "choice" };
      up[choice] = true;
    }
    if (tier.neon) {
      const pal = ["magenta", "violet", "amber", "green", "red", "cyan"].filter((c) => c !== up.neonColor);
      up.neonColor = pal[Math.floor(Math.random() * pal.length)];
    }
    if (tier.badge) g.badges.push(tier.badge);
    if (tier.landmark) { g.landmark = true; g.badges.push("landmark"); }
    ctx.coins += tier.coins || 0;
    g.refClaimed.push(friends);
    await S().updateUser(nick, { upgrades: up });
    addXp(g, ctx, 100 * friends);
    return { ok: true, tier };
  });

  // Toast + XP when a friend's referral becomes verified (or is revoked).
  G.pollNotifications = async () => {
    const me = global.App.myNick;
    if (!me) return;
    const refs = await S().listReferrals();
    for (const r of refs) {
      if (r.referrer !== me.toLowerCase()) continue;
      if (r.status === "verified" && !r.notified) {
        await S().updateReferral(r.id, { notified: true });
        await act(me, (g, u, ctx) => { bump(g, "refVerified"); g.t.refVerified = (g.t.refVerified || 0); addXp(g, ctx, G.cfg.referral.perFriendXp); ctx.coins += G.cfg.referral.perFriendCoins || 0; });
        if (G.hooks.toast) G.hooks.toast("🎉 @" + r.referee + " " + global.App.t("ref_joined"));
      } else if (r.status === "revoked" && r.reason === "unfollow" && !r.notifiedRevoked) {
        await S().updateReferral(r.id, { notifiedRevoked: true });
        if (G.hooks.toast) G.hooks.toast("💔 @" + r.referee + " " + global.App.t("ref_revoked"));
      }
    }
  };

  // Dev helper: a brand-new friend registers via my link and passes verification.
  G.simulateReferral = async (nick, opts = {}) => {
    const App = global.App, me = App.myNick;
    if (!me) throw new Error("register first");
    nick = (nick || "friend" + Math.floor(Math.random() * 9000 + 1000)).replace(/^@/, "");
    if (await S().getUserByNick(nick)) throw new Error("nick exists");
    const stats = await S().getStats();
    const free = App.city.findFreePlot(App.map, new Set([...App.usersByPlot.keys()]), stats.residents);
    const cs = ["US", "BR", "DE", "JP", "FR", "TR", "MX", "GB"];
    const user = await S().createUser({ nick, country: cs[Math.floor(Math.random() * cs.length)], source: "instagram", plot: free, deviceHash: "sim" + uid() });
    await ensureGame(user.nick);
    await S().addReferral({ referrer: me.toLowerCase(), referee: user.nick, status: "pending", deviceHash: user.deviceHash });
    if (opts.verify !== false) {
      await S().verify(user.code);
      await G.afterVerify(user);
    }
    if (App.refreshAll) await App.refreshAll();
    return user;
  };

  // ---------------- quests ----------------
  async function questRows(nick) {
    const g = await ensureGame(nick);
    rollPeriods(g);
    const refs = (await S().listReferrals()).filter((r) => r.referrer === nick.toLowerCase() && r.status === "verified").length;
    const today = Clock.stamp();
    const daysSince = global.NH_Economy.dayDiff(Clock.stamp(g.createdAt), today);
    const out = { newbie: [], daily: [], weekly: [], newbieDay: Math.min(daysSince + 1, G.quests.newbieDays), newbieExpired: daysSince >= G.quests.newbieDays };
    for (const type of ["newbie", "daily", "weekly"]) {
      for (const q of G.quests[type]) {
        let value;
        if (type === "newbie") {
          value = q.metric === "register" ? 1 : q.metric === "flag" ? (g.flag ? 1 : 0) : q.metric === "level" ? g.level : q.metric === "refVerified" ? refs : (g.t[q.metric] || 0);
        } else value = g.periods[type].c[q.metric] || 0;
        const key = type === "newbie" ? q.id : q.id + "@" + (type === "daily" ? g.periods.daily.stamp : g.periods.weekly.stamp);
        const done = value >= q.target, claimed = !!g.claimed[key];
        out[type].push(Object.assign({}, q, { type, value: Math.min(value, q.target), done, claimed, key, expired: type === "newbie" && out.newbieExpired && !done }));
      }
    }
    out.chests = g.chests;
    return out;
  }
  G.questRows = questRows;
  G.claimQuest = (nick, id) => act(nick, async (g, user, ctx) => {
    const rows = await questRows(nick);
    const q = [].concat(rows.newbie, rows.daily, rows.weekly).find((x) => x.id === id);
    if (!q || !q.done || q.claimed || q.expired) return { ok: false };
    g.claimed[q.key] = true;
    ctx.coins += q.coins; addXp(g, ctx, q.xp);
    return { ok: true, q };
  });
  G.claimableCount = async (nick) => {
    const r = await questRows(nick);
    return [].concat(r.newbie, r.daily, r.weekly).filter((q) => q.done && !q.claimed && !q.expired).length + r.chests.length;
  };

  // ---------------- leaderboards / news ----------------
  G.leaderboard = async (kind) => {
    const users = await S().listAll();
    const games = await S().listGames();
    const refs = await S().listReferrals();
    const rows = users.map((u) => {
      const g = games[u.nick] || newGame();
      const rv = refs.filter((r) => r.referrer === u.nick && r.status === "verified").length + (g.demoRefs || 0);
      const nw = netWorthOf(u, g);
      return { nick: u.nick, display: u.displayNick, country: u.country, level: g.level, net: nw.total, building: nw.building, bizValue: nw.businesses, refs: rv, businesses: g.businesses.length, badges: g.badges, status: u.status };
    });
    const key = { networth: "net", level: "level", refs: "refs" }[kind] || "net";
    return rows.filter((r) => kind !== "refs" || r.refs > 0).sort((a, b) => b[key] - a[key] || b.level - a.level);
  };

  G.newsData = async () => {
    const today = Clock.stamp();
    const users = await S().listAll();
    const events = (await S().listEvents()).filter((e) => Clock.now() - e.ts < 24 * HOUR);
    const nameOf = (n) => { const u = users.find((x) => x.nick === n); return u ? u.displayNick : n; };
    const bizName = (id) => (G.bizById[id] || {}).name || id;
    const newRes = users.filter((u) => Clock.stamp(u.createdAt) === today);
    const builds = events.filter((e) => e.type === "build").sort((a, b) => b.value - a.value).slice(0, 4);
    const ups = events.filter((e) => e.type === "upgrade").sort((a, b) => b.value - a.value).slice(0, 4);
    const rich = (await G.leaderboard("networth")).slice(0, 5);
    const refl = (await G.leaderboard("refs")).slice(0, 3);
    return {
      date: today, newResidents: newRes.length, newNames: newRes.slice(-4).map((u) => u.displayNick),
      builds: builds.map((e) => ({ nick: nameOf(e.nick), biz: bizName(e.biz), emoji: (G.bizById[e.biz] || {}).emoji, value: e.value })),
      upgrades: ups.map((e) => ({ nick: nameOf(e.nick), biz: bizName(e.biz), level: e.level, value: e.value })),
      richest: rich.map((r) => ({ nick: r.display, net: r.net, level: r.level })),
      refLeaders: refl.map((r) => ({ nick: r.display, refs: r.refs })),
      record: rich[0] ? `${rich[0].display} holds the net worth record` : "",
    };
  };

  G.fmt = (n) => {
    n = Math.round(n);
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
    return n.toLocaleString("en-US");
  };

  G._addXp = addXp;
  global.NH_Game = G;
})(window);
