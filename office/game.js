// A small idle clicker to play while the team works. The names and sprite come
// from the current theme (OfficeThemes[...].game); progress is the same across
// themes and is kept in this browser's localStorage.
window.OfficeGame = (() => {
  "use strict";

  // ---------- rules (pure, unit tested) ----------
  const TIERS = [
    { cost: 15, rate: 0.1 },
    { cost: 100, rate: 1 },
    { cost: 1100, rate: 8 },
    { cost: 12000, rate: 47 },
    { cost: 130000, rate: 260 },
    { cost: 1400000, rate: 1400 }
  ];
  const GROWTH = 1.15;
  const AWAY_CAP_S = 3600;

  const fresh = () => ({ coins: 0, total: 0, owned: TIERS.map(() => 0), click: 0, savedAt: 0 });

  // Accepts anything (e.g. corrupt storage) and returns a valid state.
  function normalise(raw) {
    const s = fresh();
    if (!raw || typeof raw !== "object") return s;
    const num = v => (Number.isFinite(v) && v >= 0 ? v : 0);
    s.coins = num(raw.coins);
    s.total = Math.max(num(raw.total), s.coins);
    s.click = Math.min(30, Math.floor(num(raw.click)));
    s.savedAt = num(raw.savedAt);
    if (Array.isArray(raw.owned)) s.owned = TIERS.map((_, i) => Math.floor(num(raw.owned[i])));
    return s;
  }

  const tierCost = (s, i) => Math.ceil(TIERS[i].cost * GROWTH ** s.owned[i]);
  const clickCost = s => Math.ceil(50 * 6 ** s.click);
  const clickValue = s => 2 ** s.click;
  const baseRate = s => s.owned.reduce((sum, n, i) => sum + n * TIERS[i].rate, 0);
  const rate = (s, bonus) => baseRate(s) * (bonus ? 2 : 1);

  function earn(s, amount) { s.coins += amount; s.total += amount; }
  function buyTier(s, i) {
    const cost = tierCost(s, i);
    if (s.coins < cost) return false;
    s.coins -= cost; s.owned[i]++;
    return true;
  }
  function buyClick(s) {
    const cost = clickCost(s);
    if (s.coins < cost) return false;
    s.coins -= cost; s.click++;
    return true;
  }
  // Earnings while the page was closed, at the base rate, capped at an hour.
  function awayEarnings(s, now) {
    if (!s.savedAt || now <= s.savedAt) return 0;
    return baseRate(s) * Math.min(AWAY_CAP_S, (now - s.savedAt) / 1000);
  }

  // RuneScape-style levels: total earned is the XP.
  const XP = [0, 0];
  for (let lvl = 2, pts = 0; lvl <= 99; lvl++) {
    pts += Math.floor(lvl - 1 + 300 * 2 ** ((lvl - 1) / 7));
    XP[lvl] = Math.floor(pts / 4);
  }
  function level(total) {
    let lvl = 1;
    while (lvl < 99 && total >= XP[lvl + 1]) lvl++;
    return lvl;
  }

  function fmt(n) {
    n = Math.floor(n);
    if (n < 1e5) return n.toLocaleString("en-GB");
    for (const [v, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
      if (n >= v) return `${(n / v).toFixed(n >= v * 100 ? 0 : 1).replace(/\.0$/, "")}${u}`;
    }
    return String(n);
  }
  // OSRS coin stack colours: yellow below 100K, white below 10M, then green.
  const stackClass = n => (n < 1e5 ? "stack-y" : n < 1e7 ? "stack-w" : "stack-g");

  const rules = { TIERS, fresh, normalise, tierCost, clickCost, clickValue, rate, earn, buyTier, buyClick, awayEarnings, level, fmt, stackClass };

  // ---------- sprites ----------
  function drawSprite(canvas, kind, frame) {
    const c = canvas.getContext("2d");
    const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    c.clearRect(0, 0, 32, 32);
    if (kind === "rock") {
      r(5, 12, 22, 15, "#5d5850"); r(7, 9, 17, 6, "#6e6a62"); r(10, 7, 10, 3, "#7c776e");
      r(5, 25, 22, 2, "#3f3b35"); r(25, 13, 2, 12, "#47433d"); r(9, 10, 6, 2, "#8a857b");
      const gold = ["#ffd54a", "#e0a82a"];
      for (const [x, y] of [[9, 14], [17, 12], [13, 19], [21, 18], [8, 21]]) { r(x, y, 3, 2, gold[0]); r(x, y + 2, 3, 1, gold[1]); }
      if (frame) r(20, 8, 2, 2, "#fff2a8");
    } else {
      r(8, 12, 15, 15, "#e9e4d8"); r(8, 12, 15, 2, "#ffffff"); r(23, 15, 4, 2, "#e9e4d8"); r(25, 15, 2, 8, "#e9e4d8");
      r(23, 21, 4, 2, "#e9e4d8"); r(10, 14, 11, 3, "#6b3f22"); r(8, 26, 15, 1, "#b9b3a6"); r(12, 19, 7, 4, "#f0b44c");
      const s = frame ? 1 : 0;
      r(11 + s, 6, 2, 4, "#c9c3d6"); r(16 - s, 4, 2, 5, "#c9c3d6"); r(19 + s, 7, 2, 3, "#c9c3d6");
    }
  }

  // ---------- UI ----------
  const KEY = "office.game";
  const safeStore = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } },
    set(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not available */ } }
  };

  function mount(root, { skin, isTeamWorking }) {
    const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const state = normalise(safeStore.get());
    let current = skin;
    let welcome = awayEarnings(state, Date.now());
    if (welcome > 0) earn(state, welcome);

    root.innerHTML = `
      <h2 id="h-game"><span data-g="title"></span> <small>while you wait</small></h2>
      <div class="game-top">
        <button type="button" class="clicker" data-g="click"><canvas width="32" height="32" aria-hidden="true"></canvas></button>
        <div class="game-stats">
          <p class="bank"><span data-g="coins">0</span> <span data-g="cur"></span></p>
          <p class="fine" data-g="rate"></p>
          <p class="fine" data-g="level"></p>
          <p class="bonus" data-g="bonus" hidden></p>
        </div>
      </div>
      <ul class="shop" data-g="shop" aria-label="Upgrades"></ul>
      <div class="game-foot">
        <p class="fine" data-g="note" role="status"></p>
        <button type="button" class="btn ghost small flex0" data-g="reset">Reset</button>
      </div>`;
    root.setAttribute("aria-labelledby", "h-game");
    const el = name => root.querySelector(`[data-g="${name}"]`);
    const clickBtn = el("click"), canvas = clickBtn.querySelector("canvas");
    let shopButtons = [];

    function buildShop() {
      const rows = [{ id: "click", name: current.clickUpgrade }, ...TIERS.map((t, i) => ({ id: i, name: current.upgrades[i] }))];
      el("shop").innerHTML = rows.map(row => `
        <li><button type="button" class="buy" data-buy="${row.id}">
          <span class="nm">${esc(row.name)} <span class="own"></span></span>
          <span class="cost"></span>
          <small class="gain"></small>
        </button></li>`).join("");
      shopButtons = [...el("shop").querySelectorAll("[data-buy]")];
    }

    function setSkin(next) {
      current = next;
      root.dataset.sprite = next.sprite;
      el("title").textContent = next.title;
      el("cur").textContent = next.currency;
      buildShop();
      drawSprite(canvas, next.sprite, 0);
      render();
    }

    function render() {
      const bonus = isTeamWorking();
      const coins = el("coins");
      coins.textContent = fmt(state.coins);
      coins.className = current.stackColours ? stackClass(state.coins) : "";
      const perSec = rate(state, bonus);
      el("rate").textContent = `${perSec < 10 ? perSec.toFixed(1).replace(/\.0$/, "") : fmt(perSec)} per second${state.click ? ` · ${fmt(clickValue(state))} per click` : ""}`;
      el("level").textContent = `${current.levelName} ${level(state.total)}`;
      const b = el("bonus");
      b.hidden = !bonus;
      b.textContent = `${current.bonusName}: ×2 while the team works`;
      clickBtn.setAttribute("aria-label", `${current.clickLabel} (+${fmt(clickValue(state))} ${current.currency})`);
      for (const btn of shopButtons) {
        const id = btn.dataset.buy;
        const isClick = id === "click";
        const cost = isClick ? clickCost(state) : tierCost(state, Number(id));
        btn.disabled = state.coins < cost;
        btn.querySelector(".own").textContent = isClick ? (state.click ? `lvl ${state.click}` : "") : (state.owned[id] ? `×${state.owned[id]}` : "");
        btn.querySelector(".cost").textContent = `${fmt(cost)} ${current.currency}`;
        btn.querySelector(".gain").textContent = isClick ? "Doubles each click" : `+${TIERS[id].rate < 1 ? TIERS[id].rate : fmt(TIERS[id].rate)}/s each`;
        btn.setAttribute("aria-label", `Buy ${btn.querySelector(".nm").firstChild.textContent.trim()} for ${fmt(cost)} ${current.currency}`);
      }
    }

    function floatText(text, e) {
      const span = document.createElement("span");
      span.className = "float";
      span.textContent = text;
      const rect = clickBtn.getBoundingClientRect();
      const x = e && e.clientX ? e.clientX - rect.left : rect.width / 2;
      const y = e && e.clientY ? e.clientY - rect.top : rect.height / 3;
      span.style.left = `${x}px`; span.style.top = `${y}px`;
      clickBtn.appendChild(span);
      setTimeout(() => span.remove(), 900);
    }

    let frame = 0;
    clickBtn.addEventListener("click", e => {
      const gain = clickValue(state);
      earn(state, gain);
      frame = 1 - frame;
      drawSprite(canvas, current.sprite, frame);
      clickBtn.classList.remove("hit"); void clickBtn.offsetWidth; clickBtn.classList.add("hit");
      floatText(`+${fmt(gain)}`, e);
      render();
    });
    el("shop").addEventListener("click", e => {
      const btn = e.target.closest("[data-buy]");
      if (!btn) return;
      const ok = btn.dataset.buy === "click" ? buyClick(state) : buyTier(state, Number(btn.dataset.buy));
      if (ok) { el("note").textContent = `Bought ${btn.querySelector(".nm").firstChild.textContent.trim()}.`; save(); }
      render();
    });
    el("reset").addEventListener("click", () => {
      if (!window.confirm(`Reset ${current.title}? Your ${current.currency} and upgrades will be lost.`)) return;
      Object.assign(state, fresh());
      el("note").textContent = "Progress reset.";
      save(); render();
    });

    function save() { state.savedAt = Date.now(); safeStore.set(state); }
    let lastTick = performance.now(), sinceSave = 0;
    setInterval(() => {
      const now = performance.now(), dt = Math.min(5, (now - lastTick) / 1000);
      lastTick = now;
      earn(state, rate(state, isTeamWorking()) * dt);
      if ((sinceSave += dt) > 5) { sinceSave = 0; save(); }
      render();
    }, 200);
    addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

    setSkin(skin);
    if (welcome >= 1) el("note").textContent = `Welcome back: +${fmt(welcome)} ${skin.currency} while you were away.`;

    return { setSkin };
  }

  return { rules, mount };
})();
