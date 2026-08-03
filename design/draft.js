(() => {
  const SEED = window.__SEED__;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    view: "home",
    sector: "全部",
    verdict: "all",
    sort: "default",
    drawerCode: null,
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtPct(v) {
    if (v == null || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    if (n === 0) return "0.00%";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }

  function pctClass(v) {
    if (v == null || Number.isNaN(Number(v))) return "";
    const n = Number(v);
    return n > 0 ? "up" : n < 0 ? "down" : "";
  }

  function empty(msg) {
    return `<div class="empty-state" role="status">${esc(msg)}</div>`;
  }

  function stripDisclaimer(s) {
    return String(s || "")
      .replace(/仅供研究参考[，,、]?非投资建议[。．]?/g, "")
      .replace(/注：.*$/g, "")
      .trim()
      .replace(/[；;]\s*$/, "");
  }

  function parseDigest(summary) {
    const raw = stripDisclaimer(summary);
    if (!raw) return { lead: "", items: [], note: "" };
    const noteMatch = String(summary || "").match(/注：([^。]+。?)/);
    const note = noteMatch ? noteMatch[1].trim() : "";
    const marks = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
    const chunks = raw.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/).map((x) => x.trim()).filter(Boolean);
    if (chunks.length >= 2 && marks.includes(chunks[0][0])) {
      return {
        lead: "",
        items: chunks.map((c) => c.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/, "").replace(/[；;]\s*$/, "").trim()),
        note,
      };
    }
    // prefix before first circled number
    const idx = raw.search(new RegExp("[①②③④⑤⑥⑦⑧⑨⑩]"));
    if (idx > 0) {
      const lead = raw.slice(0, idx).replace(/[：:]\s*$/, "").trim();
      const rest = raw.slice(idx);
      const items = rest.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/).map((c) =>
        c.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/, "").replace(/[；;]\s*$/, "").trim()
      ).filter(Boolean);
      return { lead, items, note };
    }
    // weekend-style: “本周末共发酵7个热点：A、B、C。”
    const colon = raw.match(/^([^：:]{2,40})[：:](.+)$/);
    if (colon) {
      const body = colon[2].replace(/[。．]\s*$/, "");
      const parts = body.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 3) return { lead: colon[1].trim(), items: parts, note };
    }
    return { lead: raw, items: [], note };
  }

  function pageHeadHtml(eyebrow, title, summary, shortLead) {
    const dig = parseDigest(summary || "");
    const lead = shortLead || dig.lead;
    return `
      <div class="page-head" data-component="page-head">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h1 class="section-title">${esc(title)}</h1>
        ${lead ? `<p class="section-lead">${esc(lead)}</p>` : ""}
        ${dig.items.length ? `
          <ol class="digest" aria-label="导读">
            ${dig.items.map((t, i) => `
              <li class="digest-item">
                <span class="digest-n num">${String(i + 1).padStart(2, "0")}</span>
                <span class="digest-t">${esc(t)}</span>
              </li>`).join("")}
          </ol>` : ""}
        ${dig.note ? `<p class="digest-note">${esc(dig.note)}</p>` : ""}
      </div>`;
  }

  function setView(view) {
    state.view = view;
    $$(".nav-item, .tabbar button").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.view === view);
    });
    $$("[data-view-panel]").forEach((panel) => {
      const on = panel.dataset.viewPanel === view;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    });
    closeSidebar();
    location.hash = view;
    renderView(view);
  }

  function renderView(view) {
    const map = {
      home: renderHome,
      watch: renderWatch,
      market: renderMarket,
      logic: renderLogic,
      xbrief: renderXbrief,
      events: renderEvents,
      weekend: renderWeekend,
    };
    (map[view] || renderHome)();
  }

  /* —— Home —— */
  function renderHome() {
    const root = $("#viewHome");
    const meta = SEED?.meta;
    const stats = SEED?.marketStats;
    if (!meta) {
      root.innerHTML = empty("首页数据缺失（META 为空）");
      return;
    }
    const indices = meta.indices || [];
    const nb = stats?.northbound?.hgt_yi;
    root.innerHTML = `
      <div class="block" data-component="home-overview">
        <p class="eyebrow">NO.01 · MARKET SNAPSHOT</p>
        <h1 class="section-title">大盘速览</h1>
        <p class="section-lead">收盘复盘入口：先看指数与涨跌停结构，再读总述与研究卡。</p>
        <div class="seal"><span class="seal-no">其一</span><span>缩量分歧下的成长修复</span></div>
        <div class="index-strip" aria-label="主要指数">
          ${indices.map((i) => `
            <div class="index-item">
              <div class="index-name">${esc(i.name)}</div>
              <div class="index-price num">${Number(i.price).toFixed(2)}</div>
              <div class="index-chg num ${pctClass(i.pct)}">${fmtPct(i.pct)}</div>
            </div>`).join("")}
        </div>
        <div class="stat-strip" aria-label="盘面统计">
          <div class="stat-item"><div class="stat-v num">${stats?.zt ?? "—"}</div><div class="stat-l">涨停</div></div>
          <div class="stat-item"><div class="stat-v num">${stats?.zb ?? "—"}</div><div class="stat-l">炸板</div></div>
          <div class="stat-item"><div class="stat-v num">${stats?.dt ?? "—"}</div><div class="stat-l">跌停</div></div>
          <div class="stat-item"><div class="stat-v num">${stats?.breakRate != null ? stats.breakRate : "—"}<span class="unit">%</span></div><div class="stat-l">炸板率</div></div>
          <div class="stat-item"><div class="stat-v num">${stats?.maxHeight ?? "—"}<span class="unit">板</span></div><div class="stat-l">最高连板</div></div>
          <div class="stat-item"><div class="stat-v num ${pctClass(nb)}">${nb != null ? nb : "—"}<span class="unit">亿</span></div><div class="stat-l">北向净额</div></div>
        </div>
      </div>

      <div class="block" data-component="home-regime">
        <p class="eyebrow">NO.02 · CLOSING NOTE</p>
        <h2 class="section-title">收盘总述</h2>
        <div class="prose">
          <div class="prose-block">
            <div class="prose-kicker">指数结构</div>
            <p>${esc(meta.marketRegime)}</p>
          </div>
          <div class="prose-block">
            <div class="prose-kicker">信号统计</div>
            <p>${esc(meta.summary)}</p>
          </div>
        </div>
        <div class="risk-bar">风险提示：信号统计偏空头结构，反弹多发生在空头排列下的超跌修复；叙事与技术可背离，勿单看涨跌幅。</div>
      </div>

      <div class="block" data-component="home-preview">
        <p class="eyebrow">NO.03 · RESEARCH PREVIEW</p>
        <h2 class="section-title">研究卡流</h2>
        <div class="preview-grid">
          ${(SEED.events?.events || []).slice(0, 2).map((e) => `
            <button class="preview-card" type="button" data-jump="events">
              <div class="meta-row">${esc(e.category)} · ${esc(e.importance)} · ${esc(e.time || "")}</div>
              <h3 class="clamp-2">${esc(e.title)}</h3>
              <p class="clamp-3 tagline">${esc(e.content)}</p>
            </button>`).join("")}
          ${(SEED.logic?.chains || []).slice(0, 2).map((c) => `
            <button class="preview-card" type="button" data-jump="logic">
              <div class="meta-row">逻辑链 · ${esc(c.strength)} · ${esc(c.direction)}</div>
              <h3 class="clamp-2">${esc(c.name)}</h3>
              <p class="clamp-3 tagline">${esc(c.logic || c.event)}</p>
            </button>`).join("")}
        </div>
      </div>
    `;
    root.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.jump));
    });
  }

  /* —— Watch —— */
  function stockMatches(s) {
    if (state.sector !== "全部" && s.sector !== state.sector) return false;
    if (state.verdict === "all") return true;
    if (state.verdict === "opportunity") {
      return /逢低|左侧|回踩/.test(s.signal?.leftState || "");
    }
    if (state.verdict === "drawdown") {
      return (s.signal?.pullbackPct || 0) >= 25;
    }
    return s.verdict === state.verdict;
  }

  function sortedStocks() {
    const arr = (SEED?.stocks || []).filter(stockMatches);
    if (state.sort === "chgDesc") arr.sort((a, b) => (b.signal?.chgPct ?? -999) - (a.signal?.chgPct ?? -999));
    else if (state.sort === "chgAsc") arr.sort((a, b) => (a.signal?.chgPct ?? 999) - (b.signal?.chgPct ?? 999));
    else if (state.sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    return arr;
  }

  function renderWatch() {
    const root = $("#viewWatch");
    if (!SEED?.stocks) {
      root.innerHTML = empty("巨头核心数据缺失（STOCKS 为空）");
      return;
    }
    const list = sortedStocks();
    root.innerHTML = `
      <div class="block">
        <p class="eyebrow">NO.04 · CORE WATCH</p>
        <h1 class="section-title">巨头核心</h1>
        <p class="section-lead meta-row" style="margin-bottom:14px">${esc(SEED.meta?.signalStat || "")}</p>
      </div>
      <div class="watch-layout" data-component="watch-board">
        <aside class="rail-panel" aria-label="板块筛选">
          <h2 class="rail-h">板块筛选</h2>
          <div class="sector-list" id="sectorList">
            ${(SEED.sectors || []).map((sec) => `
              <button type="button" class="sector-btn ${state.sector === sec ? "is-active" : ""}" data-sector="${esc(sec)}">${esc(sec)}</button>
            `).join("")}
          </div>
        </aside>
        <div>
          <div class="toolbar">
            <div class="chip-row" id="verdictChips">
              ${[
                ["all", "全部结论"],
                ["opportunity", "今日买点"],
                ["drawdown", "跌超25%"],
                ["成立", "成立"],
                ["存疑", "存疑"],
                ["证伪", "证伪"],
              ].map(([k, lab]) => `
                <button type="button" class="chip ${state.verdict === k ? "is-active" : ""}" data-verdict="${k}">${lab}</button>
              `).join("")}
            </div>
            <label class="sr-only" for="sortSelect">排序</label>
            <select class="sort-select" id="sortSelect">
              <option value="default" ${state.sort === "default" ? "selected" : ""}>默认排序</option>
              <option value="chgDesc" ${state.sort === "chgDesc" ? "selected" : ""}>涨幅高→低</option>
              <option value="chgAsc" ${state.sort === "chgAsc" ? "selected" : ""}>涨幅低→高</option>
              <option value="name" ${state.sort === "name" ? "selected" : ""}>名称</option>
            </select>
          </div>
          ${list.length ? `
            <div class="stock-grid">
              ${list.map((s) => {
                const pct = s.signal?.chgPct;
                return `
                <button type="button" class="stock-card" data-code="${esc(s.code)}" aria-label="打开 ${esc(s.name)} 详情">
                  <div class="sc-top">
                    <div><span class="sc-name">${esc(s.name)}</span><span class="sc-code">${esc(s.code)}</span></div>
                    <div class="sc-pct num ${pctClass(pct)}">${fmtPct(pct)}</div>
                  </div>
                  <div class="sc-sector">${esc(s.sector)}${(s.tags || []).length ? " · " + esc(s.tags.join("、")) : ""}</div>
                  <p class="sc-nar clamp-3">${esc(s.narrative)}</p>
                  <div class="sc-foot">
                    <span class="verdict ${esc(s.verdict)}">${esc(s.verdict)}</span>
                    <span>${esc(s.signal?.trend || "—")}</span>
                    <span class="clamp-2" style="flex:1;min-width:120px">${esc(s.signal?.leftState || "")}</span>
                  </div>
                </button>`;
              }).join("")}
            </div>` : empty("当前筛选下无匹配个股")}
        </div>
      </div>
    `;
    root.querySelectorAll("[data-sector]").forEach((b) => {
      b.addEventListener("click", () => { state.sector = b.dataset.sector; renderWatch(); });
    });
    root.querySelectorAll("[data-verdict]").forEach((b) => {
      b.addEventListener("click", () => { state.verdict = b.dataset.verdict; renderWatch(); });
    });
    const sel = $("#sortSelect", root);
    if (sel) sel.addEventListener("change", () => { state.sort = sel.value; renderWatch(); });
    root.querySelectorAll(".stock-card").forEach((card) => {
      card.addEventListener("click", () => openDrawer(card.dataset.code));
    });
  }

  /* —— Market —— */
  function renderMarket() {
    const root = $("#viewMarket");
    if (!SEED?.marketStats) {
      root.innerHTML = empty("市场扫描数据缺失（MARKET 为空）");
      return;
    }
    const ladder = SEED.limitLadder || [];
    const broke = SEED.brokeSample || [];
    const movers = SEED.movers || {};
    root.innerHTML = `
      <div class="block">
        <p class="eyebrow">NO.05 · MARKET SCAN</p>
        <h1 class="section-title">市场扫描</h1>
        <p class="section-lead">涨停梯队 / 炸板跌停 / 涨跌异动，只读面板，服务复盘定位。</p>
      </div>
      <div class="panel-stack">
        <section class="panel" data-component="limit-ladder">
          <div class="panel-h"><h2>涨停梯队</h2><span class="muted num">最高 ${esc(SEED.marketStats.maxHeight)} 板 · 涨停 ${esc(SEED.marketStats.zt)}</span></div>
          <div class="ladder">
            ${ladder.length ? ladder.map((row) => `
              <div class="ladder-row">
                <div class="ladder-board num">${row.board}板<span class="muted" style="display:block;font-size:10px">${row.count}只</span></div>
                <div class="ladder-items">
                  ${row.items.map((it) => `<span><b>${esc(it.name)}</b> <span class="muted">${esc(it.industry || "")}</span></span>`).join("")}
                </div>
              </div>`).join("") : empty("暂无涨停梯队")}
          </div>
        </section>

        <section class="panel" data-component="broke-panel">
          <div class="panel-h"><h2>炸板 / 跌停</h2><span class="muted num">炸板 ${esc(SEED.marketStats.zb)} · 跌停 ${esc(SEED.marketStats.dt)} · 炸板率 ${esc(SEED.marketStats.breakRate)}%</span></div>
          ${broke.length ? `
            <table class="table">
              <thead><tr><th>名称</th><th>行业</th><th class="num">涨跌幅</th><th class="num">开板</th></tr></thead>
              <tbody>
                ${broke.map((s) => `
                  <tr>
                    <td>${esc(s.name)} <span class="muted num">${esc(s.code)}</span></td>
                    <td>${esc(s.industry || "—")}</td>
                    <td class="num ${pctClass(s.pct)}">${fmtPct(s.pct)}</td>
                    <td class="num">${esc(s.break_times ?? "—")}</td>
                  </tr>`).join("")}
              </tbody>
            </table>` : empty("暂无炸板样本")}
          ${(SEED.limitDown || []).length === 0 ? `<div style="padding:10px 12px;font-size:12px;color:var(--fg-muted)">跌停：0（当日无跌停）</div>` : ""}
        </section>

        <section class="panel" data-component="movers-panel">
          <div class="panel-h"><h2>涨跌 · 成交异动</h2><span class="muted">只读</span></div>
          <div class="col-3" style="padding:12px">
            ${[
              ["涨幅居前", movers.gainers],
              ["跌幅居前", movers.losers],
              ["成交额居前", movers.turnover],
            ].map(([title, rows]) => `
              <div>
                <div class="meta-row" style="margin-bottom:8px">${title}</div>
                ${(rows || []).length ? `
                  <table class="table">
                    <tbody>
                      ${(rows || []).map((s) => `
                        <tr>
                          <td>${esc(s.name)}</td>
                          <td class="num ${pctClass(s.pct)}">${s.pct != null ? fmtPct(s.pct) : (s.amount != null ? Number(s.amount).toFixed(0) : "—")}</td>
                        </tr>`).join("")}
                    </tbody>
                  </table>` : empty("暂无数据")}
              </div>`).join("")}
          </div>
        </section>
      </div>
    `;
  }

  /* —— Logic —— */
  function renderLogic() {
    const root = $("#viewLogic");
    const data = SEED?.logic;
    if (!data?.chains) {
      root.innerHTML = empty("逻辑链数据缺失（LOGIC 为空）");
      return;
    }
    root.innerHTML = `
      ${pageHeadHtml("NO.06 · LOGIC CHAIN", "逻辑链", data.summary, "事件 → 产业 → 标的")}
      ${(data.chains || []).map((c) => `
        <article class="chain-card" data-component="logic-card">
          <div class="meta-row">
            <span class="strength">${esc(c.strength)}</span>
            · ${esc(c.event_type)} · ${esc(c.direction)} · ${esc(c.event_date || "")}
          </div>
          <h2 class="section-title" style="font-size:17px;margin-bottom:6px">${esc(c.name)}</h2>
          <p class="clamp-3" style="color:var(--fg-soft);margin:0 0 8px">${esc(c.event)}</p>
          <p style="color:var(--fg-soft);margin:0 0 8px;font-size:13.5px;line-height:1.7">${esc(c.logic)}</p>
          <div class="chain-path" aria-label="映射路径">
            ${(c.path || []).map((step, idx) => {
              let short = "";
              let full = "";
              if (Array.isArray(step)) {
                short = step.filter(Boolean).join(" · ");
                full = short;
              } else if (step && typeof step === "object") {
                short = step.step || step.name || "步骤";
                full = [step.step, step.detail].filter(Boolean).join("：");
                if (Array.isArray(step.stocks) && step.stocks.length) {
                  const names = step.stocks.slice(0, 3).map((s) => s.name || s.code).filter(Boolean);
                  if (names.length) short += ` · ${names.join("、")}`;
                }
              } else {
                short = String(step ?? "");
                full = short;
              }
              return `${idx ? '<span class="chain-arrow">→</span>' : ""}<span class="chain-step" title="${esc(full)}">${esc(short)}</span>`;
            }).join("")}
          </div>
          <div class="tagline">证伪：${esc(c.invalidation || "—")}</div>
        </article>`).join("")}
    `;
  }

  /* —— Xbrief —— */
  function renderXbrief() {
    const root = $("#viewXbrief");
    const data = SEED?.xbriefs;
    if (!data?.briefs) {
      root.innerHTML = empty("外围热点数据缺失（XBRIEFS 为空）");
      return;
    }
    root.innerHTML = `
      <div class="block">
        <p class="eyebrow">NO.07 · EXTERNAL BRIEF</p>
        <h1 class="section-title">外围热点</h1>
        <p class="section-lead">海外 AI + 宏观/市场硬信息，约每 2 小时一期。更新于 ${esc(data.updated || "—")}</p>
      </div>
      <div class="timeline">
        ${(data.briefs || []).map((b) => `
          <article class="brief-card" data-component="xbrief-card">
            <div class="brief-time num">${esc(b.time)} · ${esc(b.period || "")}</div>
            <h2 class="section-title" style="font-size:16px">${esc(b.title)}</h2>
            <div class="meta-row">AI ${esc(b.aiCount)} · 市场 ${esc(b.marketCount)}</div>
            <p class="clamp-3" style="color:var(--fg-soft);white-space:pre-wrap;margin:0">${esc(b.content)}</p>
          </article>`).join("")}
      </div>
    `;
  }

  /* —— Events —— */
  function renderEvents() {
    const root = $("#viewEvents");
    const data = SEED?.events;
    if (!data?.events) {
      root.innerHTML = empty("今日热点事件数据缺失（EVENTS 为空）");
      return;
    }
    root.innerHTML = `
      ${pageHeadHtml("NO.08 · DAILY EVENTS", "今日热点事件", data.summary)}
      ${(data.events || []).map((e) => `
        <article class="event-card" data-component="event-card">
          <div class="meta-row">${esc(e.category)} · 影响 ${esc(e.importance)} · ${esc(e.direction)} · ${esc(e.time || "")}</div>
          <h2 class="section-title" style="font-size:17px">${esc(e.title)}</h2>
          <p style="color:var(--fg-soft);margin:0 0 8px;line-height:1.7">${esc(e.content)}</p>
          <div class="tagline">板块：${esc(e.sectors || "—")}</div>
        </article>`).join("")}
    `;
  }

  /* —— Weekend —— */
  function renderWeekend() {
    const root = $("#viewWeekend");
    const data = SEED?.weekend;
    if (!data?.hotspots) {
      root.innerHTML = empty("周末发酵数据缺失（WEEKEND 为空）");
      return;
    }
    const lead = data.weekendDate ? `${data.weekendDate}` : "";
    root.innerHTML = `
      ${pageHeadHtml("NO.09 · WEEKEND FERMENT", "周末发酵", data.summary, lead)}
      ${(data.hotspots || []).map((h) => `
        <article class="weekend-card" data-component="weekend-card">
          <div class="meta-row">${esc(h.category)} · 发酵 ${esc(h.fermentLevel)} · ${esc(h.signalType)}</div>
          <h2 class="section-title" style="font-size:17px">${esc(h.title)}</h2>
          <p style="color:var(--fg-soft);margin:0 0 8px">${esc(h.event)}</p>
          <p style="color:var(--fg-soft);margin:0 0 8px;line-height:1.7">${esc(h.interpretation)}</p>
          <div class="tagline">方向：${esc((h.impactSectors || []).join("、") || "—")}</div>
          <div class="tagline" style="margin-top:4px">周一策略：${esc(h.mondayStrategy || "—")}</div>
        </article>`).join("")}
    `;
  }

  /* —— Drawer —— */
  function openDrawer(code) {
    const s = (SEED.stocks || []).find((x) => x.code === code);
    const drawer = $("#detailDrawer");
    const body = $("#drawerBody");
    const title = $("#drawerTitle");
    if (!s) return;
    state.drawerCode = code;
    title.innerHTML = `
      <div>
        <div class="sc-name" style="font-size:18px">${esc(s.name)} <span class="sc-code">${esc(s.code)}</span></div>
        <div class="meta-row" style="margin:4px 0 0">${esc(s.sector)} · <span class="verdict ${esc(s.verdict)}">${esc(s.verdict)}</span></div>
      </div>`;
    const g = s.signal || {};
    body.innerHTML = `
      <p>${esc(s.narrative)}</p>
      <h3>技术信号</h3>
      <div class="sig-grid">
        <div><div class="l">现价 / 涨跌</div><div class="num ${pctClass(g.chgPct)}">${g.price != null ? Number(g.price).toFixed(2) : "—"} · ${fmtPct(g.chgPct)}</div></div>
        <div><div class="l">趋势</div><div>${esc(g.trend || "—")}</div></div>
        <div><div class="l">左侧</div><div>${esc(g.leftState || "—")}</div></div>
        <div><div class="l">右侧</div><div>${esc(g.rightState || "—")}</div></div>
      </div>
      <h3>复盘结论</h3>
      <p>${esc(s.review?.change || "暂无复盘文字")}</p>
      <h3>关注点</h3>
      <p>${esc((s.watch || []).join("；") || "—")}</p>
      <h3>相关新闻</h3>
      ${(s.news || []).length ? `<ul style="margin:0;padding-left:18px;color:var(--fg-soft);font-size:13px">${s.news.map((n) => `<li>${esc(n.title)}</li>`).join("")}</ul>` : "<p>暂无新闻样本</p>"}
    `;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    $("#drawerBackdrop").hidden = false;
    $("#drawerClose").focus();
  }

  function closeDrawer() {
    const drawer = $("#detailDrawer");
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    $("#drawerBackdrop").hidden = true;
    state.drawerCode = null;
  }

  /* —— Search —— */
  function search(q) {
    const query = q.trim().toLowerCase();
    const panel = $("#searchPanel");
    const status = $("#searchStatus");
    const input = $("#globalSearchInput");
    if (!query) {
      panel.hidden = true;
      input.setAttribute("aria-expanded", "false");
      status.textContent = "";
      return;
    }
    const hits = [];
    for (const s of SEED.stocks || []) {
      const bag = [s.code, s.name, s.sector, ...(s.tags || []), s.narrative].join(" ").toLowerCase();
      if (bag.includes(query)) hits.push({ type: "个股", title: s.name, sub: s.code + " · " + s.sector, code: s.code });
    }
    for (const e of SEED.events?.events || []) {
      const bag = [e.title, e.content, e.sectors, e.category].join(" ").toLowerCase();
      if (bag.includes(query)) hits.push({ type: "事件", title: e.title, sub: e.category, jump: "events" });
    }
    for (const c of SEED.logic?.chains || []) {
      const bag = [c.name, c.event, c.logic].join(" ").toLowerCase();
      if (bag.includes(query)) hits.push({ type: "逻辑", title: c.name, sub: c.strength, jump: "logic" });
    }
    for (const b of SEED.xbriefs?.briefs || []) {
      const bag = [b.title, b.content].join(" ").toLowerCase();
      if (bag.includes(query)) hits.push({ type: "简报", title: b.title, sub: b.time, jump: "xbrief" });
    }
    const top = hits.slice(0, 12);
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!top.length) {
      panel.innerHTML = `<div class="search-empty">无结果「${esc(q)}」· Esc 关闭 · / 再次聚焦</div>`;
      status.textContent = "无搜索结果";
      return;
    }
    panel.innerHTML = top.map((h, i) => `
      <button type="button" class="search-item" role="option" data-idx="${i}" data-code="${esc(h.code || "")}" data-jump="${esc(h.jump || "")}">
        <div class="si-k">${esc(h.type)}</div>
        <div class="si-t">${esc(h.title)}</div>
        <div class="muted" style="font-size:11px">${esc(h.sub || "")}</div>
      </button>`).join("") + `<div class="search-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div>`;
    status.textContent = `找到 ${top.length} 条`;
    panel.querySelectorAll(".search-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.code) { closeSearch(); openDrawer(btn.dataset.code); setView("watch"); }
        else if (btn.dataset.jump) { closeSearch(); setView(btn.dataset.jump); }
      });
    });
  }

  function closeSearch() {
    const panel = $("#searchPanel");
    const input = $("#globalSearchInput");
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.value = "";
    $("#searchStatus").textContent = "";
  }

  /* —— Sidebar mobile —— */
  function openSidebar() {
    $("#sidebar").classList.add("is-open");
    const bd = $("#sidebarBackdrop");
    bd.hidden = false;
    $("#menuToggle").setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("is-open");
    $("#sidebarBackdrop").hidden = true;
    $("#menuToggle").setAttribute("aria-expanded", "false");
  }

  function bootChrome() {
    const asof = SEED?.meta?.signalDate || SEED?.meta?.lastUpdated || "—";
    const signal = SEED?.meta?.signalStat || "";
    const shortSignal = signal.split("·")[0]?.trim() || signal.slice(0, 24);
    $("#sideDateline").textContent = shortSignal || `行情截至 ${asof}`;
    $("#sbDateTime").textContent = `${asof.replace(/^\d{4}-/, "").replace("-", "月")}日 · 收盘复盘`.replace("月日", "月");
    // prettier date: 2026-07-31 → 7月31日
    const m = String(asof).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) $("#sbDateTime").textContent = `${Number(m[2])}月${Number(m[3])}日 · 收盘复盘`;
    $("#sbMarket").textContent = "收盘";
  }

  function bind() {
    $$(".nav-item, .tabbar button").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });
    $("#menuToggle").addEventListener("click", () => {
      const open = $("#sidebar").classList.contains("is-open");
      open ? closeSidebar() : openSidebar();
    });
    $("#sidebarBackdrop").addEventListener("click", closeSidebar);
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#drawerBackdrop").addEventListener("click", closeDrawer);

    const input = $("#globalSearchInput");
    input.addEventListener("input", () => search(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeSearch(); input.blur(); }
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        input.focus();
        input.select();
      }
      if (e.key === "Escape") {
        if (!$("#searchPanel").hidden) closeSearch();
        else if ($("#detailDrawer").classList.contains("is-open")) closeDrawer();
        else closeSidebar();
      }
    });

    window.addEventListener("hashchange", () => {
      const v = location.hash.replace("#", "");
      if (v && v !== state.view) setView(v);
    });
  }

  bootChrome();
  bind();
  const initial = location.hash.replace("#", "") || "home";
  const allowed = ["home", "watch", "market", "logic", "xbrief", "events", "weekend"];
  setView(allowed.includes(initial) ? initial : "home");
})();
