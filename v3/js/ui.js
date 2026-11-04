// All DOM / modal wiring. Expects a global `App` (defined in app.js) with
// the data + actions this file calls back into.
(function (global) {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  const modalRoot = () => $("#modal-root");

  function showToast(msg, cls) {
    const t = el("div", "toast" + (cls ? " " + cls : ""), msg);
    const n = document.querySelectorAll(".toast").length; // stack instead of overlap
    t.style.marginBottom = (n * 48) + "px";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), cls ? 3200 : 2200);
  }

  function closeOverlay(overlay) {
    overlay.classList.add("hidden");
    setTimeout(() => overlay.remove(), 200);
  }

  function openOverlay(contentEl) {
    const overlay = el("div", "overlay");
    overlay.appendChild(contentEl);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(overlay); });
    modalRoot().appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.remove("hidden"));
    return overlay;
  }

  function sheetWith(innerHtmlNode, { closable = true } = {}) {
    const sheet = el("div", "sheet");
    sheet.style.position = "relative";
    if (closable) {
      const close = el("button", "sheet-close", "✕");
      close.addEventListener("click", () => closeOverlay(sheet.closest(".overlay") || sheet.parentElement));
      sheet.appendChild(close);
    }
    sheet.appendChild(innerHtmlNode);
    return sheet;
  }

  // ---------------- Header ----------------
  function renderHeaderTexts(t) {
    $("#brand-tag").textContent = t("tagline");
    $("#residents-label").textContent = t("residents");
    $("#search-input").placeholder = t("searchPlaceholder");
    $("#find-btn").textContent = t("findBtn");
  }

  function renderStats(stats, t) {
    $("#residents-count").textContent = stats.residents.toLocaleString();
    $("#newtoday-pill").innerHTML = "✨ " + t("newToday", { n: stats.newToday });
  }

  function renderCoins(balance) {
    $("#coins-balance").textContent = balance.toLocaleString();
  }

  function populateLangPicker(current, onChange) {
    const sel = $("#lang-picker");
    sel.innerHTML = "";
    const names = {
      en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch",
      it: "Italiano", ru: "Русский", tr: "Türkçe", ar: "العربية", hi: "हिन्दी",
      id: "Bahasa Indonesia", vi: "Tiếng Việt", th: "ไทย", ja: "日本語", ko: "한국어",
      zh: "中文", pl: "Polski", nl: "Nederlands", uk: "Українська", fa: "فارسی",
    };
    for (const code of global.NH_I18N.SUPPORTED) {
      const opt = el("option", null, names[code] || code);
      opt.value = code;
      if (code === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
  }

  // ---------------- Building card ----------------
  function statusBanner(t, status) {
    if (status === "pending") return `<div class="status-banner status-pending">🚧 ${t("statusPending")}</div>`;
    if (status === "verified") return `<div class="status-banner status-verified">✅ ${t("statusVerified")}</div>`;
    if (status === "unfollowed") return `<div class="status-banner status-unfollowed">💔 ${t("statusUnfollowed")}</div>`;
    return "";
  }

  function openCard(app, user) {
    const t = app.t;
    const district = app.layout.districts[user.districtId];
    const flag = global.NH_flagEmoji(user.country);
    const value = app.economy.computeValue(user);
    const level = app.economy.computeLevel(value);

    const wrap = el("div");
    wrap.innerHTML = `
      ${statusBanner(t, user.status)}
      <div class="card-banner">
        <span class="name">${escapeHtml(user.buildingName)}</span>
        <span class="level-badge">${level}</span>
      </div>
      <div class="card-identity">
        <div class="avatar">🏢</div>
        <div>
          <div class="card-nick">@${escapeHtml(user.displayNick)}</div>
          <div class="card-sub">${escapeHtml(district.name)} · ${t("cardDistrict")} #${user.buildingNumber.toLocaleString()}</div>
        </div>
      </div>
      <div class="district-chip">${flag} ${escapeHtml(district.name)}</div>
      <div class="value-box" id="value-box">
        <div class="value-row">
          <span class="label">${t("cardValue")}</span>
          <span class="amount">${value.total} <span style="font-size:11px;color:var(--text-dimmer)">${t("cardCoins")}</span> ▾</span>
        </div>
        <div class="value-detail" id="value-detail">
          <div class="vd-row"><span>${t("cardLand")}</span><b>${value.land}</b></div>
          <div class="vd-row"><span>${t("cardBuilding")}</span><b>${value.building}</b></div>
          <div class="value-hint">${t("cardValueHint")}</div>
        </div>
      </div>
      <div class="social-row" id="social-row"></div>
      <div class="btn-grid">
        <button class="card-btn primary" data-act="build">🏗️ ${t("btnBuild")}</button>
        <button class="card-btn accent" data-act="share">📤 ${t("btnShare")}</button>
        <button class="card-btn" data-act="live">👥 ${t("btnLive")}</button>
        <button class="card-btn" data-act="upgrade">⬆️ ${t("btnUpgrade")}</button>
        <button class="card-btn" data-act="flag">🚩 ${t("btnFlag")}</button>
        <button class="card-btn" data-act="change">🔄 ${t("btnChange")}</button>
        <button class="card-btn full" data-act="copy">🔗 ${t("btnCopyLink")}</button>
      </div>
      ${user.status === "unfollowed" ? `<button class="btn-wide" id="follow-again-btn">↻ ${t("followAgainBtn")}</button>` : ""}
    `;

    const sheet = sheetWith(wrap);
    sheet.id = "card-sheet";
    const overlay = openOverlay(sheet);

    $("#value-box", sheet).addEventListener("click", () => {
      $("#value-detail", sheet).classList.toggle("open");
    });

    sheet.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => app.onCardAction(btn.dataset.act, user, overlay));
    });

    if (app.decorateCard) app.decorateCard(sheet, user);

    const fab = $("#follow-again-btn", sheet);
    if (fab) fab.addEventListener("click", () => app.onFollowAgain(user, overlay));

    return overlay;
  }

  // ---------------- Registration ----------------
  function openRegistration(app, prefillNick) {
    const t = app.t;
    const wrap = el("div");
    wrap.innerHTML = `
      <h2 class="sheet-title">${t("regTitle")}</h2>
      <div class="field">
        <label>${t("regNick")}</label>
        <input type="text" id="reg-nick" value="${escapeAttr(prefillNick || "")}" placeholder="yourname">
      </div>
      <div class="field">
        <label>${t("regCountry")}</label>
        <select id="reg-country"><option value="">${t("regCountryPick")}</option></select>
      </div>
      <div class="field">
        <label>${t("regSource")}</label>
        <div class="source-toggle">
          <button type="button" data-src="instagram" class="active">📸 ${t("regInstagram")}</button>
          <button type="button" data-src="tiktok">🎵 ${t("regTiktok")}</button>
        </div>
      </div>
      <div class="follow-box">
        <p>🔔 ${t("regFollow")}</p>
        <button class="btn-wide" id="follow-confirm-btn" style="background:rgba(255,255,255,0.08);color:var(--text)">${t("regFollowBtn")}</button>
      </div>
      <button class="btn-wide" id="reg-submit-btn" disabled>${t("regSubmit")}</button>
    `;
    const sheet = sheetWith(wrap);
    const overlay = openOverlay(sheet);

    const countrySel = $("#reg-country", sheet);
    for (const c of global.NH_COUNTRIES) {
      const opt = el("option", null, `${c.flag} ${c.name}`);
      opt.value = c.code;
      countrySel.appendChild(opt);
    }

    let source = "instagram";
    let followed = false;
    sheet.querySelectorAll("[data-src]").forEach(b => {
      b.addEventListener("click", () => {
        sheet.querySelectorAll("[data-src]").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        source = b.dataset.src;
      });
    });

    const submitBtn = $("#reg-submit-btn", sheet);
    $("#follow-confirm-btn", sheet).addEventListener("click", (e) => {
      followed = true;
      e.target.textContent = "✓ " + t("regFollowBtn");
      e.target.style.color = "var(--cyan)";
      submitBtn.disabled = !(followed && $("#reg-nick", sheet).value.trim());
    });
    $("#reg-nick", sheet).addEventListener("input", () => {
      submitBtn.disabled = !(followed && $("#reg-nick", sheet).value.trim());
    });

    submitBtn.addEventListener("click", async () => {
      const nick = $("#reg-nick", sheet).value.trim().replace(/^@/, "");
      const country = countrySel.value || "US";
      if (!nick) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "…";
      try {
        const user = await app.completeRegistration({ nick, country, source });
        closeOverlay(overlay);
        openCodeModal(app, user);
      } catch (err) {
        showToast(String(err.message || err));
        submitBtn.disabled = false;
        submitBtn.textContent = t("regSubmit");
      }
    });

    return overlay;
  }

  function openCodeModal(app, user) {
    const t = app.t;
    const wrap = el("div");
    wrap.innerHTML = `
      <h2 class="sheet-title">🎉 ${t("regCodeTitle")}</h2>
      <p class="sheet-text">${t("regCodeHint")}</p>
      <div class="code-box">${user.code}</div>
      <button class="btn-wide" id="code-gotit-btn">${t("regCodeGotIt")}</button>
    `;
    const sheet = sheetWith(wrap);
    const overlay = openOverlay(sheet);
    $("#code-gotit-btn", sheet).addEventListener("click", () => {
      closeOverlay(overlay);
      app.onAfterRegistration(user);
    });
    return overlay;
  }

  // ---------------- Coins modal ----------------
  function openCoins(app) {
    const t = app.t;
    const user = app.getMyUser();
    const wrap = el("div");
    const balance = user ? user.coins : 0;
    const checkedToday = user && !app.economy.isNewDay(user.lastCheckin);
    const drewToday = user && !app.economy.isNewDay(user.lastDraw);
    const nextCheckin = app.economy.checkinReward(user ? app.economy.nextStreak(user) : 1);
    wrap.innerHTML = `
      <h2 class="sheet-title">🪙 ${t("coinsTitle")}</h2>
      <div class="coin-balance-row">
        <span>${t("coinsBalance")}</span>
        <span class="big">${balance.toLocaleString()}</span>
      </div>
      <div class="list-row">
        <div><div class="lr-label">${t("dailyCheckin")}</div><div class="lr-sub">${t("streakDay", { n: checkedToday ? (user.checkinStreak || 1) : (user ? app.economy.nextStreak(user) : 1) })} · +${nextCheckin} ${t("coins") || "coins"}</div></div>
        <button class="mini-btn" id="checkin-btn" ${checkedToday ? "disabled" : ""}>${checkedToday ? t("dailyCheckinDone") : "+" + nextCheckin}</button>
      </div>
      <div class="list-row">
        <div><div class="lr-label">${t("dailyDraw")}</div><div class="lr-sub">${app.economy.DAILY_DRAW_MIN}–${app.economy.DAILY_DRAW_MAX} ${t("coins") || "coins"}</div></div>
        <button class="mini-btn" id="draw-btn" ${drewToday ? "disabled" : ""}>${drewToday ? t("dailyCheckinDone") : t("dailyDrawBtn")}</button>
      </div>
      <div class="list-row">
        <div><div class="lr-label">${t("inviteFriends")}</div><div class="lr-sub">${t("inviteHint")}</div></div>
        <button class="mini-btn" id="invite-btn">${t("btnCopyLink")}</button>
      </div>
      ${!user ? `<p class="sheet-text" style="margin-top:14px">${t("searchHint")}</p>` : ""}
    `;
    const sheet = sheetWith(wrap);
    const overlay = openOverlay(sheet);

    if (user) {
      $("#checkin-btn", sheet).addEventListener("click", async () => {
        const res = await app.dailyCheckin(user.nick);
        if (res) { showToast(`+${res.checkinGain} 🪙`); closeOverlay(overlay); openCoins(app); }
      });
      $("#draw-btn", sheet).addEventListener("click", async () => {
        const res = await app.dailyDraw(user.nick);
        if (res) { showToast(`+${res.amount} 🪙`); closeOverlay(overlay); openCoins(app); }
      });
      $("#invite-btn", sheet).addEventListener("click", () => {
        app.copyInviteLink(user);
        showToast(t("copySuccess"));
      });
    }
    return overlay;
  }

  // ---------------- Upgrades modal ----------------
  function openUpgrades(app, user) {
    const t = app.t;
    const defs = app.economy.UPGRADE_DEFS;
    const paidDefs = app.economy.PAID_UPGRADE_DEFS;
    const up = user.upgrades || {};
    const floorsCost = app.economy.floorsCost(up.floors || 0);

    const wrap = el("div");
    wrap.innerHTML = `
      <h2 class="sheet-title">⬆️ ${t("upgradesTitle")}</h2>
      <div class="coin-balance-row"><span>${t("coinsBalance")}</span><span class="big" id="up-balance">${user.coins}</span></div>
      <div class="list-row">
        <div><div class="lr-label">🏗️ ${t(defs.floors.label)}</div><div class="lr-sub">${up.floors || 0} ${t("cardDistrict") === "building" ? "" : ""}floors · +${defs.floors.valueAdd} value</div></div>
        <button class="mini-btn" data-up="floors">${floorsCost} 🪙</button>
      </div>
      <div class="list-row">
        <div><div class="lr-label">🎨 ${t(defs.neonColor.label)}</div><div class="lr-sub">+${defs.neonColor.valueAdd} value</div></div>
        <button class="mini-btn" data-up="neonColor">${defs.neonColor.baseCost} 🪙</button>
      </div>
      <div class="list-row">
        <div><div class="lr-label">🌿 ${t(defs.garden.label)}</div><div class="lr-sub">+${defs.garden.valueAdd} value</div></div>
        <button class="mini-btn ${up.garden ? "owned" : ""}" data-up="garden" ${up.garden ? "disabled" : ""}>${up.garden ? t("upgradeOwned") : defs.garden.baseCost + " 🪙"}</button>
      </div>
      <div class="list-row">
        <div><div class="lr-label">📋 ${t(defs.billboard.label)}</div><div class="lr-sub">+${defs.billboard.valueAdd} value</div></div>
        <button class="mini-btn ${up.billboard ? "owned" : ""}" data-up="billboard" ${up.billboard ? "disabled" : ""}>${up.billboard ? t("upgradeOwned") : defs.billboard.baseCost + " 🪙"}</button>
      </div>
      <h2 class="sheet-title" style="margin-top:18px">💎 ${t("paidTitle")}</h2>
      ${Object.keys(paidDefs).map(k => `
        <div class="list-row">
          <div><div class="lr-label">${paidEmoji(k)} ${t(paidDefs[k].label)}</div><div class="lr-sub">+${paidDefs[k].valueAdd} value</div></div>
          <button class="mini-btn paid ${up[k] ? "owned" : ""}" data-paid="${k}" ${up[k] ? "disabled" : ""}>${up[k] ? t("upgradeOwned") : "$" + paidDefs[k].priceUsd.toFixed(2)}</button>
        </div>
      `).join("")}
    `;
    const sheet = sheetWith(wrap);
    const overlay = openOverlay(sheet);

    sheet.querySelectorAll("[data-up]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.up;
        const res = await app.buyUpgrade(user.nick, key);
        if (res.ok) {
          showToast("✅ " + t(defs[key].label));
          closeOverlay(overlay);
          openUpgrades(app, res.user);
        } else {
          showToast(t("upgradeLocked"));
        }
      });
    });
    sheet.querySelectorAll("[data-paid]").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.paid;
        window.open(global.NH_PAYMENT_LINKS[key], "_blank", "noopener");
      });
    });

    return overlay;
  }

  function paidEmoji(key) {
    return { hologram: "🌐", flyingCar: "🚗", rainbow: "🌈", helipad: "🚁", spotlight: "💡" }[key] || "💎";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  global.NH_UI = {
    showToast, renderHeaderTexts, renderStats, renderCoins, populateLangPicker,
    openCard, openRegistration, openCodeModal, openCoins, openUpgrades,
    closeOverlay, openOverlay, sheetWith, el, escapeHtml,
  };
})(window);
