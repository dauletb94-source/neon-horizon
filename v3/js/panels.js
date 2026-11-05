// Progression UI: HUD level pill, Businesses, Invite friends, Quests, Admin, City News, share cards.
(function (global) {
  const U = () => global.NH_UI;
  const G = () => global.NH_Game;
  const App = () => global.App;
  const t = (k, v) => App().t(k, v);
  const el = (tag, cls, html) => U().el(tag, cls, html);
  const esc = (s) => U().escapeHtml(s);
  const fmt = (n) => G().fmt(n);
  const flag = (c) => (global.NH_flagEmoji ? global.NH_flagEmoji(c) : "");
  const me = () => App().myNick;

  function panel(title, render) {
    const wrap = el("div", null, `<h2 class="sheet-title">${title}</h2><div class="pbody"></div>`);
    const sheet = U().sheetWith(wrap);
    sheet.classList.add("panel-sheet");
    const overlay = U().openOverlay(sheet);
    const body = sheet.querySelector(".pbody");
    const p = {
      overlay, sheet, body,
      async refresh() { const sc = sheet.scrollTop; await render(body, p); sheet.scrollTop = sc; },
      alive() { return document.body.contains(sheet); },
    };
    p.refresh();
    return p;
  }
  function needPlayer() {
    if (!App().getMyUser()) { U().showToast("🔎 " + t("searchHint")); return true; }
    return false;
  }
  const bar = (pct, cls) => `<div class="bar ${cls || ""}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  const dur = (h) => (h >= 48 ? (h / 24).toFixed(1).replace(/\.0$/, "") + "d" : h >= 1 ? (h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)) + "h" : Math.max(1, Math.round(h * 60)) + "m");
  const BADGE = { ambassador: "👑", landmark: "🏛️" };

  // ---------------- HUD ----------------
  async function renderHud() {
    const pill = document.getElementById("level-pill");
    if (!pill) return;
    const user = App().getMyUser();
    if (!user) { pill.classList.add("hidden"); document.getElementById("quests-dot").classList.add("hidden"); return; }
    const g = await G().ensureGame(user.nick);
    const li = G().levelInfo(g.xp);
    pill.classList.remove("hidden");
    document.getElementById("lvl-badge").textContent = li.level;
    document.getElementById("lvl-nick").innerHTML = (g.badges.includes("ambassador") ? "👑 " : "") + "@" + esc(user.displayNick);
    document.getElementById("xp-fill").style.width = (li.need ? (li.into / li.need * 100) : 100) + "%";
    document.getElementById("lvl-xp").textContent = li.need ? `${fmt(li.into)}/${fmt(li.need)} XP` : "MAX";
    const n = await G().claimableCount(user.nick);
    const dot = document.getElementById("quests-dot");
    dot.textContent = n; dot.classList.toggle("hidden", !n);
  }

  // ---------------- Businesses ----------------
  function openBusinesses(app) {
    if (needPlayer()) return;
    const nick = me();
    let tab = "mine", timer = null, snap = null;
    const p = panel("🏢 " + t("bz_title"), async (body) => {
      snap = await G().sync(nick).then(() => G().snapshot(nick));
      const { g, user, li, rows, slots, net } = snap;
      const income = rows.reduce((s, r) => s + r.rate, 0);
      let html = `
        <div class="coin-balance-row"><span>${t("coinsBalance")}</span><span class="big">${fmt(user.coins)} 🪙</span></div>
        <div class="stat-grid">
          <div><b>Lv ${li.level}</b><span>${t("bz_level")}</span></div>
          <div><b>${rows.length}/${slots}</b><span>${t("bz_slots")}</span></div>
          <div><b>${fmt(income)}</b><span>${t("bz_perhour")}</span></div>
          <div><b>${fmt(net.total)}</b><span>${t("bz_networth")}</span></div>
        </div>
        <div class="tabs">
          <button data-tab="mine" class="${tab === "mine" ? "active" : ""}">${t("bz_tab_mine")}</button>
          <button data-tab="build" class="${tab === "build" ? "active" : ""}">${t("bz_tab_build")}</button>
          <button data-tab="rank" class="${tab === "rank" ? "active" : ""}">${t("bz_tab_rank")}</button>
        </div>`;
      if (user.status !== "verified") html += `<div class="status-banner status-pending">🚧 ${t("bz_need_verify")}</div>`;
      if (tab === "mine") {
        if (!rows.length) html += `<p class="sheet-text">${t("bz_empty")}</p>`;
        else html += `<p class="sheet-text" id="upkeep-total">🔧 Total upkeep −${fmt(rows.reduce((a, r) => a + r.upkeepDay, 0))} 🪙/day (${(G().cfg.maintenance.dailyPct * 100).toFixed(1)}% of business value, deducted from collected income)</p><button class="btn-wide collect-all" id="collect-all" data-act="collect-all">💰 ${t("bz_collect_all")} <b id="collect-all-amt"></b></button>`;
        for (const r of rows) {
          const b = r.b;
          html += `
          <div class="biz-card" data-uid="${b.uid}">
            <div class="biz-head"><span class="biz-emoji">${r.t.emoji}</span>
              <div class="biz-name"><b>${esc(t("biz_" + r.t.id))}</b><small>${t("bz_lvl")} ${b.level}/${G().cfg.businesses.maxLevel} <span class="stars">${"★".repeat(Math.floor(b.level / 5))}</span></small></div>
              <div class="biz-rate">+${fmt(r.rate)}<small>/h</small></div></div>
            <div class="biz-upkeep" style="font-size:11px;opacity:.75;padding:2px 0">🔧 Upkeep −${fmt(r.upkeepDay)}/day · due ${fmt(r.owed)} 🪙 (paid when you collect)</div>
            <div class="biz-store"><div class="bar gold"><i data-fill></i></div><div class="biz-store-txt"><span data-stored></span><span data-full></span></div></div>
            <div class="biz-actions">
              ${b.manager ? `<span class="chip">🤖 ${t("bz_auto")}</span>` : `<button class="mini-btn" data-act="collect" data-uid="${b.uid}">💰 <span data-amt></span></button>`}
              ${r.upCost !== null ? `<button class="mini-btn alt" data-act="upgrade" data-uid="${b.uid}" title="+${fmt(r.nextRate - r.rate)}/h">⬆️ ${fmt(r.upCost)} 🪙</button>` : `<span class="chip">MAX</span>`}
              ${b.manager ? "" : `<button class="mini-btn ghost" data-act="manager" data-uid="${b.uid}">🤖 ${fmt(r.t.managerCost)}</button>`}
            </div>
          </div>`;
        }
      } else if (tab === "build") {
        html += `<p class="sheet-text">${t("bz_slots_hint", { n: G().cfg.plotSlots.everyLevels })}</p>`;
        for (const bt of G().biz) {
          const locked = g.level < bt.unlockLevel;
          html += `
          <div class="list-row biz-type ${locked ? "locked" : ""}">
            <div class="biz-head"><span class="biz-emoji">${locked ? "🔒" : bt.emoji}</span>
              <div class="biz-name"><b>${esc(t("biz_" + bt.id))}</b>
                <small>${locked ? t("bz_unlock_at", { n: bt.unlockLevel }) : `+${fmt(bt.baseIncomePerHour)}/h · ${t("bz_payback")} ${dur(bt.buildCost / bt.baseIncomePerHour)}`}</small></div></div>
            <button class="mini-btn" data-act="build" data-type="${bt.id}" ${locked ? "disabled" : ""}>${fmt(bt.buildCost)} 🪙</button>
          </div>`;
        }
      } else {
        const lb = await G().leaderboard("networth");
        html += `<p class="sheet-text">${t("bz_rank_hint")}</p>` + lb.slice(0, 15).map((r, i) => `
          <div class="list-row lb-row ${r.nick === user.nick ? "me" : ""}"><div><div class="lr-label">${i + 1}. ${flag(r.country)} @${esc(r.display)} <span class="lvl-chip">Lv ${r.level}</span></div>
          <div class="lr-sub">${r.businesses} ${t("bz_tab_mine").toLowerCase()}</div></div><b class="gold">${fmt(r.net)}</b></div>`).join("");
      }
      body.innerHTML = html;
      tick();
    });

    function tick() {
      if (!snap || !p.alive()) { clearInterval(timer); return; }
      const now = global.NH_Clock.now();
      let all = 0;
      for (const r of snap.rows) {
        const card = p.body.querySelector(`.biz-card[data-uid="${r.b.uid}"]`);
        if (!card) continue;
        const stored = r.b.manager ? 0 : Math.floor(G().bizStored(r.b, now));
        const cap = Math.floor(r.rate * r.capHours);
        all += stored;
        card.querySelector("[data-fill]").style.width = (cap ? stored / cap * 100 : 0) + "%";
        card.querySelector("[data-stored]").textContent = `${fmt(stored)} / ${fmt(cap)} 🪙`;
        const left = (cap - stored) / r.rate;
        card.querySelector("[data-full]").textContent = r.b.manager ? t("bz_auto") : stored >= cap ? "⚠️ " + t("bz_full") : "⏱ " + dur(left);
        const amt = card.querySelector("[data-amt]");
        if (amt) { amt.textContent = fmt(stored); amt.parentElement.disabled = stored < 1; }
      }
      const ca = p.body.querySelector("#collect-all-amt");
      if (ca) { ca.textContent = "+" + fmt(all); ca.parentElement.disabled = all < 1; }
    }
    timer = setInterval(tick, 1000);

    p.sheet.addEventListener("click", async (e) => {
      const tb = e.target.closest("[data-tab]");
      if (tb) { tab = tb.dataset.tab; return p.refresh(); }
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const a = btn.dataset.act;
      let res;
      if (a === "collect") res = await G().collect(nick, btn.dataset.uid);
      else if (a === "collect-all") res = await G().collect(nick, "all");
      else if (a === "upgrade") res = await G().upgradeBiz(nick, btn.dataset.uid);
      else if (a === "build") { res = await G().build(nick, btn.dataset.type); if (res.ok) tab = "mine"; }
      else if (a === "manager") res = await G().buyManager(nick, btn.dataset.uid);
      if (!res) return;
      if (res.ok) {
        U().showToast(a.startsWith("collect") ? `+${fmt(res.total)} 🪙` : a === "upgrade" ? `⬆️ Lv ${res.level}` : a === "build" ? "🏗️ " + t("bz_built") : "🤖 OK");
      } else U().showToast("⚠️ " + t("bz_err_" + res.reason));
      p.refresh();
    });
    return p;
  }

  // ---------------- Quests ----------------
  function openQuests(app) {
    if (needPlayer()) return;
    const nick = me();
    let tab = "newbie";
    const p = panel("🎯 " + t("qs_title"), async (body) => {
      const q = await G().questRows(nick);
      const tabs = ["newbie", "daily", "weekly", "chests"];
      let html = `<div class="tabs">${tabs.map((k) => `<button data-tab="${k}" class="${tab === k ? "active" : ""}">${t("qs_tab_" + k)}${k === "chests" && q.chests.length ? ` (${q.chests.length})` : ""}</button>`).join("")}</div>`;
      if (tab === "newbie") html += `<p class="sheet-text">${q.newbieExpired ? t("qs_newbie_over") : t("qs_newbie_day", { d: q.newbieDay, n: G().quests.newbieDays })}</p>`;
      if (tab === "chests") {
        if (!q.chests.length) html += `<p class="sheet-text">${t("qs_no_chests")}</p>`;
        else html += `<button class="btn-wide" data-act="chest-all">🎁 ${t("qs_open_all")}</button>` + q.chests.map((c) => `
          <div class="list-row"><div><div class="lr-label">🎁 ${t("chest_" + c.type)}${c.level ? " " + c.level : ""}</div><div class="lr-sub">+${fmt(c.coins)} 🪙${c.xp ? " · +" + c.xp + " XP" : ""}</div></div>
          <button class="mini-btn" data-act="chest" data-id="${c.id}">${t("qs_open")}</button></div>`).join("");
      } else {
        html += q[tab].map((x) => `
          <div class="list-row quest ${x.claimed ? "claimed" : ""}">
            <div class="q-main"><div class="lr-label">${x.icon} ${esc(t("q_" + x.id))}</div>
              ${bar(x.value / x.target * 100, x.done ? "green" : "")}
              <div class="lr-sub">${x.value}/${x.target} · +${x.coins} 🪙 · +${x.xp} XP</div></div>
            ${x.claimed ? `<span class="chip ok">✓</span>` : x.expired ? `<span class="chip">${t("qs_expired")}</span>` :
              `<button class="mini-btn" data-act="claim" data-id="${x.id}" ${x.done ? "" : "disabled"}>${t("qs_claim")}</button>`}
          </div>`).join("");
      }
      body.innerHTML = html;
    });
    p.sheet.addEventListener("click", async (e) => {
      const tb = e.target.closest("[data-tab]");
      if (tb) { tab = tb.dataset.tab; return p.refresh(); }
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const a = btn.dataset.act;
      if (a === "claim") {
        const r = await G().claimQuest(nick, btn.dataset.id);
        if (r && r.ok) U().showToast(`🎯 +${r.q.coins} 🪙 +${r.q.xp} XP`);
      } else if (a === "chest") {
        const c = await G().openChest(nick, btn.dataset.id);
        if (c) U().showToast(`🎁 +${fmt(c.coins)} 🪙`);
      } else if (a === "chest-all") {
        const cs = await G().openAllChests(nick);
        U().showToast(`🎁 +${fmt(cs.reduce((s, c) => s + (c ? c.coins : 0), 0))} 🪙`);
      }
      p.refresh();
    });
    return p;
  }

  // ---------------- Invite friends ----------------
  const PREMIUM_LABEL = { flyingCar: "🚗 " + "paidFlyingCar", hologram: "🌐 paidHologram", rainbow: "🌈 paidRainbow" };
  function openFaq() {
    panel("❓ " + t("faq_title"), (body) => {
      let html = "";
      for (let i = 1; i <= 6; i++) html += `<div class="faq-item"><b>${esc(t("faq_q" + i))}</b><p class="sheet-text">${esc(t("faq_a" + i))}</p></div>`;
      html += `<div class="faq-credits"><div>${esc(t("faq_credits"))}</div>` +
        `<div>CC0 / public domain only: Poly Haven HDRI (CC0) · self-authored procedural towers, skyline, cars &amp; metro (CC0) · three.js (MIT)</div></div>`;
      body.innerHTML = html;
    });
  }
  function openInvite(app) {
    if (needPlayer()) return;
    const nick = me();
    let qrOpen = false, choosing = false;
    const p = panel("👥 " + t("ref_title"), async (body) => {
      const info = await G().referralInfo(nick);
      const link = G().referralLink(nick);
      const goal = 5;
      let html = `
        <p class="sheet-text">${t("ref_hint")}</p>
        <div class="code-box link-box" id="ref-link">${esc(link)}</div>
        <div class="share-row">
          <button class="mini-btn" data-act="copy">🔗 ${t("btnCopyLink")}</button>
          <button class="mini-btn alt" data-act="ig">📸 ${t("ref_ig")}</button>
          <button class="mini-btn alt" data-act="tt">🎵 ${t("ref_tt")}</button>
          <button class="mini-btn ghost" data-act="qr">▦ QR</button>
        </div>
        ${qrOpen ? `<div class="qr-box">${global.NH_QR.toSvg(link, 180)}</div>` : ""}
        <div class="ref-progress"><div class="rp-top"><b>${t("ref_progress")}</b><span>${Math.min(info.verified, goal)}/${goal}${info.verified > goal ? " (+" + (info.verified - goal) + ")" : ""}</span></div>
          ${bar(Math.min(info.verified, goal) / goal * 100, "green")}
          <div class="lr-sub">${info.pending ? info.pending + " " + t("ref_st_pending") + " · " : ""}${t("ref_rule")}</div></div>
        <h3 class="sub-title">${t("ref_rewards")}</h3>`;
      for (const tier of info.ladder) {
        const claimed = info.g.refClaimed.includes(tier.friends), can = info.verified >= tier.friends;
        html += `<div class="list-row"><div><div class="lr-label">${tier.friends} ${t("ref_friends")}</div><div class="lr-sub">${t("ref_tier_" + tier.friends)}</div></div>
          ${claimed ? `<span class="chip ok">✓ ${t("qs_claimed")}</span>` : `<button class="mini-btn" data-act="claim" data-n="${tier.friends}" ${can ? "" : "disabled"}>${can ? t("qs_claim") : info.verified + "/" + tier.friends}</button>`}</div>`;
      }
      if (choosing) html += `<div class="choice-box"><b>${t("ref_choose")}</b><div class="share-row">${Object.keys(PREMIUM_LABEL).map((k) => `<button class="mini-btn paid" data-act="choose" data-k="${k}">${PREMIUM_LABEL[k].split(" ")[0]} ${t(PREMIUM_LABEL[k].split(" ")[1])}</button>`).join("")}</div></div>`;
      html += `<h3 class="sub-title">${t("ref_invited")} (${info.refs.length})</h3>`;
      html += info.refs.length ? info.refs.map((r) => `<div class="list-row"><div><div class="lr-label">@${esc(r.referee)}</div><div class="lr-sub">${new Date(r.createdAt).toISOString().slice(0, 10)}${r.reason ? " · " + esc(r.reason) : ""}</div></div><span class="chip st-${r.status}">${t("ref_st_" + r.status)}</span></div>`).join("")
        : `<p class="sheet-text">${t("ref_none")}</p>`;
      const lb = (await G().leaderboard("refs")).slice(0, 8);
      html += `<h3 class="sub-title">🏆 ${t("ref_leaderboard")}</h3>` + lb.map((r, i) => `<div class="list-row lb-row ${r.nick === nick ? "me" : ""}"><div class="lr-label">${i + 1}. ${flag(r.country)} @${esc(r.display)}</div><b class="gold">${r.refs} 👥</b></div>`).join("");
      body.innerHTML = html;
    });
    p.sheet.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const a = btn.dataset.act, user = App().getMyUser(), link = G().referralLink(nick);
      if (a === "copy") { try { await navigator.clipboard.writeText(link); } catch (er) {} U().showToast(t("copySuccess")); }
      else if (a === "qr") { qrOpen = !qrOpen; }
      else if (a === "ig") { const c = await renderShareCard(user); download(c, `neon-horizon-${nick}.png`); await G().recordShare(nick); U().showToast("📸 " + t("ref_card_saved")); }
      else if (a === "tt") { await shareNative(user, link); await G().recordShare(nick); }
      else if (a === "claim") {
        const n = Number(btn.dataset.n);
        if (n === 5) { choosing = true; } else { const r = await G().claimReferral(nick, n); if (r.ok) U().showToast("🎁 " + t("ref_tier_" + n)); }
      } else if (a === "choose") {
        const r = await G().claimReferral(nick, 5, btn.dataset.k);
        choosing = false;
        if (r.ok) U().showToast("🎁 " + t("ref_tier_5"));
      }
      p.refresh();
    });
    return p;
  }

  async function shareNative(user, link) {
    const text = t("ref_share_text", { nick: user.displayNick });
    if (navigator.share) {
      try {
        const c = await renderShareCard(user);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        const file = new File([blob], "neon-horizon.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text, url: link });
        else await navigator.share({ title: "NEON HORIZON", text, url: link });
      } catch (e) {}
    } else { try { await navigator.clipboard.writeText(text + " " + link); } catch (e) {} U().showToast(t("copySuccess")); }
  }

  function download(canvas, name) {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  }

  // ---------------- Canvas cards (1080x1920) ----------------
  function baseCard() {
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
    const x = c.getContext("2d");
    const bg = x.createLinearGradient(0, 0, 0, 1920);
    bg.addColorStop(0, "#050716"); bg.addColorStop(0.55, "#14123a"); bg.addColorStop(1, "#2a0f45");
    x.fillStyle = bg; x.fillRect(0, 0, 1080, 1920);
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    x.fillStyle = "#fff";
    for (let i = 0; i < 160; i++) { x.globalAlpha = 0.3 + rnd() * 0.7; x.fillRect(rnd() * 1080, rnd() * 900, 2, 2); }
    x.globalAlpha = 1;
    // skyline
    for (let i = 0; i < 26; i++) {
      const w = 50 + rnd() * 70, h = 160 + rnd() * 520, px = i * 44 - 20;
      x.fillStyle = "#0b0d26"; x.fillRect(px, 1250 - h, w, h);
      x.strokeStyle = i % 2 ? "#52f2ff" : "#ff58e6"; x.globalAlpha = 0.65; x.lineWidth = 3; x.strokeRect(px, 1250 - h, w, h); x.globalAlpha = 1;
      x.fillStyle = "#ffd98a";
      for (let wy = 1250 - h + 18; wy < 1230; wy += 26) for (let wx = px + 9; wx < px + w - 9; wx += 16) if (rnd() < 0.35) x.fillRect(wx, wy, 6, 10);
    }
    const gl = x.createLinearGradient(0, 1250, 0, 1920);
    gl.addColorStop(0, "rgba(82,242,255,0.25)"); gl.addColorStop(1, "rgba(5,7,22,0)");
    x.fillStyle = gl; x.fillRect(0, 1250, 1080, 670);
    return { c, x };
  }
  function glowText(x, text, px, py, size, color, align = "center", weight = "900") {
    x.font = `${weight} ${size}px Inter, system-ui, sans-serif`; x.textAlign = align;
    x.shadowColor = color; x.shadowBlur = 28; x.fillStyle = color; x.fillText(text, px, py);
    x.shadowBlur = 0; x.fillStyle = "#fff"; x.fillText(text, px, py);
  }
  function roundRect(x, px, py, w, h, r, fill, stroke) {
    x.beginPath(); x.roundRect(px, py, w, h, r);
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = 3; x.stroke(); }
  }

  async function renderShareCard(user) {
    const g = await G().ensureGame(user.nick);
    const net = G().netWorthOf(user, g), info = await G().referralInfo(user.nick);
    const link = G().referralLink(user.nick);
    const { c, x } = baseCard();
    glowText(x, "NEON HORIZON", 540, 190, 96, "#52f2ff");
    x.font = "600 38px Inter, system-ui, sans-serif"; x.fillStyle = "#93a6cf"; x.textAlign = "center";
    x.fillText(t("card_sub"), 540, 255);
    glowText(x, "@" + user.displayNick, 540, 430, 92, "#ff58e6");
    x.font = "700 44px Inter, system-ui, sans-serif"; x.fillStyle = "#eaf3ff"; x.fillText(`${flag(user.country)}  ${user.buildingName}`, 540, 500);
    roundRect(x, 290, 560, 500, 130, 65, "rgba(255,193,87,0.15)", "#ffc157");
    glowText(x, `${t("bz_level").toUpperCase()} ${g.level}`, 540, 650, 72, "#ffc157");
    const stats = [[fmt(net.total), t("bz_networth")], [String(g.businesses.length), t("bz_tab_mine")], [String(info.verified + (g.demoRefs || 0)), t("ref_friends")]];
    stats.forEach((s, i) => {
      const px = 90 + i * 300;
      roundRect(x, px, 760, 270, 170, 28, "rgba(8,12,26,0.7)", "rgba(110,200,255,0.4)");
      glowText(x, s[0], px + 135, 850, 62, "#52f2ff");
      x.font = "600 28px Inter, system-ui, sans-serif"; x.fillStyle = "#93a6cf"; x.textAlign = "center"; x.fillText(s[1], px + 135, 905);
    });
    // QR
    roundRect(x, 290, 1300, 500, 500, 36, "#ffffff");
    global.NH_QR.draw(x, link, 310, 1320, 460, "#04131a", "#ffffff", 2);
    glowText(x, t("card_join"), 540, 1235, 54, "#ffffff");
    x.font = "600 30px Inter, system-ui, sans-serif"; x.fillStyle = "#93a6cf"; x.textAlign = "center";
    x.fillText(link.replace(/^https?:\/\//, "").slice(0, 52), 540, 1860);
    return c;
  }

  async function renderNewsCanvas(d) {
    const { c, x } = baseCard();
    glowText(x, "CITY NEWS", 540, 170, 110, "#ff58e6");
    x.font = "700 40px Inter, system-ui, sans-serif"; x.fillStyle = "#93a6cf"; x.textAlign = "center";
    x.fillText("NEON HORIZON · " + d.date, 540, 235);
    let y = 330;
    const section = (title, color, lines) => {
      glowText(x, title, 70, y, 46, color, "left");
      y += 22;
      lines.slice(0, 3).forEach((l) => { y += 62; x.font = "600 40px Inter, system-ui, sans-serif"; x.fillStyle = "#eaf3ff"; x.textAlign = "left"; x.fillText(l[0], 90, y); x.textAlign = "right"; x.fillStyle = "#ffc157"; x.fillText(l[1] || "", 1010, y); });
      if (!lines.length) { y += 62; x.font = "600 36px Inter"; x.fillStyle = "#64749c"; x.textAlign = "left"; x.fillText("—", 90, y); }
      y += 70;
    };
    roundRect(x, 60, 275, 960, 85, 30, "rgba(82,242,255,0.12)", "#52f2ff");
    glowText(x, `✨ ${d.newResidents} ${t("news_new_res")}`, 540, 335, 50, "#52f2ff");
    y = 440;
    section("🏗️ " + t("news_builds"), "#52f2ff", d.builds.map((b) => [`${b.emoji || ""} ${b.nick} · ${b.biz}`, fmt(b.value)]));
    section("⬆️ " + t("news_upgrades"), "#9d6bff", d.upgrades.map((b) => [`${b.nick} · ${b.biz} → ${b.level}`, fmt(b.value)]));
    section("💎 " + t("news_richest"), "#ffc157", d.richest.slice(0, 3).map((r, i) => [`${i + 1}. ${r.nick}`, fmt(r.net)]));
    section("👥 " + t("news_refs"), "#ff58e6", d.refLeaders.map((r, i) => [`${i + 1}. ${r.nick}`, r.refs + " 👥"]));
    glowText(x, d.record || "", 540, 1700, 40, "#ffc157");
    x.font = "600 34px Inter, system-ui, sans-serif"; x.fillStyle = "#93a6cf"; x.textAlign = "center";
    x.fillText("Follow @nextepisode.tv · claim your building", 540, 1800);
    return c;
  }

  async function openNews() {
    const d = await G().newsData();
    const c = await renderNewsCanvas(d);
    const wrap = el("div", null, `<h2 class="sheet-title">📰 ${t("news_title")}</h2><div class="news-preview"></div><button class="btn-wide" id="news-dl">⬇️ ${t("news_download")}</button>`);
    c.style.width = "100%"; c.style.borderRadius = "14px"; c.id = "news-canvas";
    wrap.querySelector(".news-preview").appendChild(c);
    const sheet = U().sheetWith(wrap); sheet.classList.add("panel-sheet", "news-sheet");
    U().openOverlay(sheet);
    sheet.querySelector("#news-dl").addEventListener("click", () => download(c, `city-news-${d.date}.png`));
    return { data: d, canvas: c };
  }

  // ---------------- Admin ----------------
  function openAdmin() {
    const p = panel("🛠️ Admin · Referrals", async (body) => {
      const refs = await App().store.listReferrals();
      const users = await App().store.listAll();
      const who = (n) => { const u = users.find((x) => x.nick === n); return u ? "@" + esc(u.displayNick) : esc(n); };
      body.innerHTML = `
        <div class="share-row">
          <button class="mini-btn" data-a="t1">+1h</button><button class="mini-btn" data-a="t24">+24h</button><button class="mini-btn" data-a="t168">+7d</button>
          <button class="mini-btn alt" data-a="coins">+10k 🪙</button><button class="mini-btn alt" data-a="xp">+5k XP</button>
          <button class="mini-btn ghost" data-a="news">📰 News</button></div>
        <p class="sheet-text">${refs.length} referrals · ${refs.filter((r) => r.status === "verified").length} verified · ${refs.filter((r) => r.status === "pending").length} pending · ${refs.filter((r) => r.status === "revoked").length} revoked</p>
        <div id="admin-refs">${refs.slice().reverse().map((r) => `
          <div class="list-row"><div><div class="lr-label">${who(r.referrer)} → ${who(r.referee)}</div>
            <div class="lr-sub">${new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} · dev ${esc(r.deviceHash || "—")}${r.reason ? " · " + esc(r.reason) : ""}</div></div>
            <div class="admin-actions"><span class="chip st-${r.status}">${r.status}</span>
            <button class="mini-btn ghost" data-a="ver" data-id="${r.id}">✓</button><button class="mini-btn ghost" data-a="rev" data-id="${r.id}">✕</button></div></div>`).join("") || "<p class='sheet-text'>—</p>"}</div>`;
    });
    p.sheet.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const a = b.dataset.a, nm = me();
      if (a === "ver") await App().store.updateReferral(b.dataset.id, { status: "verified", verifiedAt: global.NH_Clock.now(), reason: null });
      else if (a === "rev") await App().store.updateReferral(b.dataset.id, { status: "revoked", revokedAt: global.NH_Clock.now(), reason: "admin" });
      else if (a.startsWith("t")) await global.NH.debugAdvance(Number(a.slice(1)));
      else if (a === "coins") await global.NH.debugGrantCoins(10000);
      else if (a === "xp") await global.NH.debugGrantXp(5000);
      else if (a === "news") openNews();
      await G().pollNotifications();
      p.refresh();
    });
    return p;
  }

  global.NH_Panels = { renderHud, openBusinesses, openQuests, openInvite, openFaq, openAdmin, openNews, renderShareCard, renderNewsCanvas, download, shareNative };
})(window);
