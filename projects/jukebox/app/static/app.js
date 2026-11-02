// Jukebox dashboard. Reads /api/assessment and draws everything; charts are plain SVG.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x, d = 1) => (x == null ? "–" : `${(x * 100).toFixed(d)}%`);
  const num = (x, d = 2) => (x == null ? "–" : x.toFixed(d));
  const money = (x, ccy) => (x == null ? "–" : new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy || "GBP" }).format(x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SVGNS = "http://www.w3.org/2000/svg";

  let report = null;
  let strategyId = null;

  async function api(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = body.detail;
      const msg = Array.isArray(d) ? d.map((x) => `${(x.loc || []).slice(-1)[0] || "input"}: ${x.msg}`).join("; ") : d;
      throw new Error(msg || `${res.status} ${res.statusText}`);
    }
    return body;
  }

  // ---------- charts ----------
  function svg(el) {
    el.innerHTML = "";
    const s = document.createElementNS(SVGNS, "svg");
    const w = el.clientWidth || 600, h = el.clientHeight || 260;
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    el.appendChild(s);
    return { s, w, h };
  }
  function add(parent, tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.appendChild(n);
    return n;
  }
  function ticks(min, max, count) {
    const span = max - min || 1, step0 = span / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) out.push(+v.toFixed(10));
    return out;
  }

  // series: [{x: [Date|number], y: [number], color, width, fill}], opts: {log, yfmt, xfmt, bands}
  function lineChart(el, series, opts = {}) {
    const { s, w, h } = svg(el);
    const pad = { l: 52, r: 12, t: 8, b: 24 };
    const tf = opts.log ? Math.log : (v) => v;
    const xs = series.flatMap((d) => d.x), ys = series.flatMap((d) => d.y).concat((opts.bands || []).flatMap((b) => [...b.lo, ...b.hi]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (opts.zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    const ty0 = tf(y0), ty1 = tf(y1);
    const X = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - ((tf(v) - ty0) / (ty1 - ty0 || 1)) * (h - pad.t - pad.b);

    const g = add(s, "g", { class: "grid" });
    const yt = opts.log ? ticks(Math.log2(y0), Math.log2(y1), 5).map((v) => 2 ** v) : ticks(y0, y1, 5);
    for (const v of yt) {
      if (v < y0 || v > y1) continue;
      add(g, "line", { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v) });
      add(s, "text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end" }).textContent = (opts.yfmt || ((v) => v))(v);
    }
    for (const v of opts.xticks ? opts.xticks(x0, x1) : ticks(x0, x1, 6)) {
      add(s, "text", { x: X(v), y: h - 6, "text-anchor": "middle" }).textContent = (opts.xfmt || ((v) => v))(v);
    }
    for (const b of opts.bands || []) {
      const top = b.x.map((x, i) => `${X(x)},${Y(b.hi[i])}`);
      const bot = b.x.map((x, i) => `${X(x)},${Y(b.lo[i])}`).reverse();
      add(s, "polygon", { points: [...top, ...bot].join(" "), fill: b.color, stroke: "none" });
    }
    for (const d of series) {
      const pts = d.x.map((x, i) => `${X(x)},${Y(d.y[i])}`).join(" ");
      if (d.fill) add(s, "polygon", { points: `${X(d.x[0])},${Y(0)} ${pts} ${X(d.x[d.x.length - 1])},${Y(0)}`, fill: d.fill, stroke: "none" });
      add(s, "polyline", { points: pts, fill: "none", stroke: d.color, "stroke-width": d.width || 1.6, "stroke-linejoin": "round" });
    }
  }
  const yearTicks = (x0, x1) => {
    const a = new Date(x0).getFullYear(), b = new Date(x1).getFullYear();
    const step = Math.max(1, Math.ceil((b - a) / 6));
    const out = [];
    for (let y = Math.ceil(a / step) * step; y <= b; y += step) out.push(Date.UTC(y, 0, 1));
    return out.filter((t) => t >= x0 && t <= x1);
  };
  const toX = (dates) => dates.map((d) => Date.parse(d));
  const legend = (el, items) => { el.innerHTML = items.map(([label, c]) => `<span style="--c:${c}">${esc(label)}</span>`).join(""); };

  // ---------- rendering ----------
  function table(el, head, rows, opts = {}) {
    el.innerHTML = `<thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r, i) => `<tr class="${opts.highlight === i ? "hl" : ""}">${r.map((c) => (typeof c === "object" && c ? `<td class="${c.cls || ""}">${esc(c.v)}</td>` : `<td>${esc(c)}</td>`)).join("")}</tr>`)
      .join("")}</tbody>`;
  }
  const signed = (x, d = 1) => ({ v: pct(x, d), cls: x == null ? "" : x >= 0 ? "pos" : "neg" });

  function renderSignal(r) {
    const s = r.signal;
    const invested = s.target > 0;
    $("state").innerHTML = `<span class="big ${invested ? "in" : "out"}">${invested ? "Invested" : "In cash"}</span><span class="fine">target ${pct(s.target, 0)} of the strategy's allocation</span>`;
    const ch = $("change");
    ch.className = `change${s.changed ? " alert" : ""}`;
    ch.textContent = s.changed
      ? `Changed at the last close (${s.as_of}): action needed. Size the order below.`
      : `No change at the last close (${s.as_of}). Holding since ${s.since}.`;
    const d = s.detail || {};
    const facts = [["Signal close", s.as_of], ["In this state since", s.since]];
    if (d.sma != null) {
      facts.push([`${r.market.research} close`, num(d.price)], [`${d.params.window}-day average`, num(d.sma)], ["Distance from average", pct(d.distance, 2)]);
    }
    facts.push(["Parameters", Object.entries(d.params || {}).map(([k, v]) => `${k} ${v}`).join(", ") || "–"]);
    $("signalFacts").innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
    $("signalNote").textContent = `Researched on ${r.market.research}; traded in ${r.market.trade} (UK-listed, ${r.trade_price.currency}). Orders are assumed to fill at the next close after the signal.`;
    $("ccy").textContent = r.trade_price.currency;
    $("tradeSym").textContent = r.market.trade;
  }

  function renderEvidence(r) {
    const c = r.comparison;
    $("lookahead").className = `pill ${r.lookahead_check ? "ok" : "bad"}`;
    $("lookahead").textContent = r.lookahead_check ? "Look-ahead check passed" : "Look-ahead check FAILED";
    const wf = c.walk_forward;
    $("evidenceNote").textContent = `${wf.start} to ${wf.end} (${wf.years} years). Parameters re-chosen each year from the previous ${r.walk_forward.train_years} years only; ${r.walk_forward.trials_per_window} settings tried each time. Costs ${r.market.cost_bps} bp per trade; cash earns 3-month T-bills.`;
    const rows = [
      ["Strategy (walk-forward)", wf],
      ["Buy and hold", c.buy_and_hold],
      [`Fixed ${Object.entries(c.fixed_default.params).map(([k, v]) => `${k} ${v}`).join(", ")}`, c.fixed_default],
      ["Strategy before costs", c.walk_forward_before_costs],
    ].map(([name, m]) => [name, signed(m.cagr), pct(m.vol), num(m.sharpe), num(m.sortino), signed(m.max_drawdown), `${m.max_dd_days} d`, pct(m.cvar95, 2), m.exposure == null ? "–" : pct(m.exposure, 0), m.turnover == null ? "–" : num(m.turnover, 1)]);
    table($("comparison"), ["", "CAGR", "Volatility", "Sharpe", "Sortino", "Max drawdown", "Longest drawdown", "CVaR 95% (1 day)", "Time invested", "Turnover / yr"], rows, { highlight: 0 });
  }

  function renderCharts(r) {
    const s1 = css("--s1"), s2 = css("--s2");
    const ch = r.charts;
    legend($("equityLegend"), [["Strategy", s1], ["Buy and hold", s2]]);
    lineChart($("equityChart"), [
      { x: toX(ch.equity_buy_hold.dates), y: ch.equity_buy_hold.values, color: s2 },
      { x: toX(ch.equity.dates), y: ch.equity.values, color: s1, width: 2 },
    ], { log: true, yfmt: (v) => `${+v.toFixed(2)}×`, xticks: yearTicks, xfmt: (t) => new Date(t).getUTCFullYear() });
    legend($("ddLegend"), [["Strategy", s1], ["Buy and hold", s2]]);
    lineChart($("ddChart"), [
      { x: toX(ch.drawdown_buy_hold.dates), y: ch.drawdown_buy_hold.values, color: s2 },
      { x: toX(ch.drawdown.dates), y: ch.drawdown.values, color: s1, width: 2, fill: css("--band") },
    ], { zero: true, yfmt: (v) => `${Math.round(v * 100)}%`, xticks: yearTicks, xfmt: (t) => new Date(t).getUTCFullYear() });
  }

  function renderRisk(r) {
    const m = r.monte_carlo.one_year, b = r.monte_carlo.buy_and_hold_one_year, f = m.fan;
    $("mcNote").textContent = `${m.paths.toLocaleString()} simulated years, built by resampling blocks of the strategy's own out-of-sample daily returns (seed ${m.seed}). Bands: middle 50% and 90% of outcomes.`;
    lineChart($("fanChart"), [{ x: f.day, y: f.p50, color: css("--s1"), width: 2 }], {
      bands: [{ x: f.day, lo: f.p5, hi: f.p95, color: css("--band") }, { x: f.day, lo: f.p25, hi: f.p75, color: css("--band2") }],
      yfmt: (v) => `${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`,
      xticks: () => [63, 126, 189, 252], xfmt: (d) => `${Math.round(d / 21)} mo`,
    });
    table($("mcTable"), ["One year ahead", "Strategy", "Buy and hold"], [
      ["Bad year (5th percentile)", signed(m.terminal.p5), signed(b.terminal.p5)],
      ["Typical (median)", signed(m.terminal.p50), signed(b.terminal.p50)],
      ["Good year (95th percentile)", signed(m.terminal.p95), signed(b.terminal.p95)],
      ["Chance of losing money", pct(m.prob_loss, 0), pct(b.prob_loss, 0)],
      [`Chance of a drawdown beyond ${pct(m.drawdown_limit, 0)}`, pct(m.prob_drawdown_beyond, 0), pct(b.prob_drawdown_beyond, 0)],
      ["Worst drawdown, median path", signed(m.max_drawdown.p50), signed(b.max_drawdown.p50)],
    ]);
    const z = r.sizing, t = r.tracking;
    const facts = [
      ["Kelly leverage (upper bound)", `${num(z.kelly)}×`],
      ["Half Kelly", `${num(z.half_kelly)}×`],
      ["Expected long-run growth, unlevered", pct(z.growth_unlevered)],
      ["Trades per year", num(r.trades_per_year, 1)],
      [`${r.market.research} vs ${r.market.trade}, monthly correlation`, num(t.monthly_correlation, 3)],
      [`${r.market.trade} history since`, t.since || "–"],
    ];
    $("sizing").innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
    $("sizingNote").textContent = `${z.note} The ticket uses ${r.market.trade} because UK retail accounts generally can't buy US-listed ETFs; it tracks the same index, in GBP, so its returns also include USD/GBP moves.`;
    table($("trades"), ["Trade close", "Symbol", "From", "To"], r.recent_trades.slice().reverse().map((t) => [t.date, t.symbol, pct(t.from, 0), pct(t.to, 0)]));
  }

  function renderRobustness(r) {
    const best = Math.max(...r.sensitivity_in_sample.map((x) => x.sharpe ?? -9));
    table($("sensitivity"), ["Setting", "CAGR", "Volatility", "Sharpe", "Max drawdown", "Turnover / yr"],
      r.sensitivity_in_sample.map((x) => [Object.entries(x.params).map(([k, v]) => `${k} ${v}`).join(", "), signed(x.cagr), pct(x.vol), num(x.sharpe), signed(x.max_drawdown), num(x.turnover, 1)]),
      { highlight: r.sensitivity_in_sample.findIndex((x) => x.sharpe === best) });
    $("wfNote").textContent = `Each year's setting was picked by the best Sharpe ratio over the previous ${r.walk_forward.train_years} years, then used for the next ${r.walk_forward.test_years} year unseen.`;
    table($("windows"), ["Test year", "Chosen", "Train Sharpe", "Test Sharpe"],
      r.walk_forward.windows.slice().reverse().map((w) => [`${w.test_start} → ${w.test_end}`, Object.entries(w.params).map(([k, v]) => `${k} ${v}`).join(", "), num(w.train_sharpe), num(w.test_sharpe)]));
  }

  function renderSources(r) {
    $("description").textContent = r.strategy.description;
    $("citations").innerHTML = r.strategy.citations.map((c) => `<li>${esc(c)}</li>`).join("") +
      "<li>Metrics: Sharpe [Chan QT2e, pp. 49-50]; drawdowns [Chan QT2e, pp. 23, 54-55]; Kelly [Chan QT2e, pp. 112-113, 131]; VaR [Hardle et al. AQF, p. 64]; expected shortfall [Fabozzi MFM, p. 749]</li>" +
      "<li>Monte Carlo: stationary block bootstrap (Politis &amp; Romano, 1994). Outside library.</li>";
    table($("dataTable"), ["Series", "Source", "From", "To", "Rows", "Downloaded", "Quality"], r.data.map((d) => [
      d.symbol || d.series, d.source, d.first, d.last, d.rows, (d.retrieved || "").replace("T", " ").slice(0, 16),
      d.quality ? (d.quality.ok ? "OK" : d.quality.issues.join("; ")) : "–",
    ]));
  }

  function render(r) {
    report = r;
    renderSignal(r); renderEvidence(r); renderCharts(r); renderRisk(r); renderRobustness(r); renderSources(r);
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = false));
    $("status").hidden = true;
    $("main").setAttribute("aria-busy", "false");
    renderCharts(r); // redraw now the cards have their real widths
    renderRisk(r);
  }

  async function load() {
    $("status").hidden = false;
    $("status").textContent = "Running the assessment…";
    try {
      render(await api(`/api/assessment/${encodeURIComponent(strategyId)}`));
    } catch (e) {
      $("status").textContent = `Couldn't load: ${e.message}`;
    }
  }

  // ---------- ticket ----------
  const saved = (() => { try { return JSON.parse(localStorage.getItem("jukebox.ticket") || "{}"); } catch { return {}; } })();
  for (const id of ["account", "units", "alloc", "commission"]) if (saved[id] != null) $(id).value = saved[id];

  $("ticketForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const values = { account: $("account").value, units: $("units").value, alloc: $("alloc").value, commission: $("commission").value };
    try { localStorage.setItem("jukebox.ticket", JSON.stringify(values)); } catch { /* private mode */ }
    const out = $("ticket");
    try {
      const t = await api(`/api/ticket/${encodeURIComponent(strategyId)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_value: +values.account, current_units: Math.round(+values.units || 0), max_allocation: Math.min(1, (+values.alloc || 100) / 100), commission: +values.commission || 0 }),
      });
      const kind = t.action.toLowerCase();
      const line = t.action === "HOLD"
        ? `<span class="act">HOLD</span> ${t.current_units} × ${esc(t.symbol)} (no trade)`
        : `<span class="act">${t.action}</span> ${t.units} × ${esc(t.symbol)} <span>limit ${money(t.limit, t.currency)}</span>`;
      out.innerHTML = `<div class="order ${kind}">${line}</div>
        <dl class="facts" style="margin-top:12px">
          <div><dt>Order value</dt><dd>${money(t.value, t.currency)}</dd></div>
          <div><dt>Est. cost</dt><dd>${money(t.est_cost, t.currency)}</dd></div>
          <div><dt>Target holding</dt><dd>${t.target_units} units (${pct(t.target_weight, 0)})</dd></div>
          <div><dt>Last close</dt><dd>${money(t.price, t.currency)} on ${esc(t.price_as_of)}</dd></div>
        </dl>
        <ul>${t.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
    } catch (e) {
      out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  });

  $("refresh").addEventListener("click", async () => {
    const b = $("refresh");
    b.disabled = true; b.textContent = "Updating…";
    try {
      await api("/api/update-data", { method: "POST" });
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      b.disabled = false; b.textContent = "Update data";
    }
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (report) { renderCharts(report); renderRisk(report); } }, 150);
  });

  (async () => {
    try {
      const list = await api("/api/strategies");
      $("strategy").innerHTML = list.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
      strategyId = list[0]?.id;
      $("strategy").addEventListener("change", () => { strategyId = $("strategy").value; $("ticket").innerHTML = ""; load(); });
      await load();
    } catch (e) {
      $("status").textContent = `Couldn't start: ${e.message}`;
    }
  })();
})();
