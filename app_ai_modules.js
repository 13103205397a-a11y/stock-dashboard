(function (App) {
  const { $, esc, trunc, secTitle, emptyState, fieldHtml, titleShort, leadOf, blockHtml, safeUrl, cleanDisplayText, openDrawer } = App;

  /* ---------- 3. 机会清单 ---------- */
  function renderOpportunities() {
    const el = $("#viewOpportunities");
    if (!el) return;
    const OPP = window.OPPORTUNITIES || null;
    if (!OPP || !OPP.directions || !OPP.directions.length) {
      el.innerHTML = secTitle("机会清单", "当日热点发酵分析") + emptyState("机会分析数据待生成。");
      return;
    }

    const stageShort = (st) => {
      const t = String(st || "");
      const hit = t.match(/高潮期|扩散期|初起期|退潮期|高潮|扩散|初起|退潮/);
      return hit ? hit[0] : trunc(t, 6);
    };
    const stageCls = (st) => /初起/.test(st) ? "ok" : /扩散/.test(st) ? "warn" : /高潮/.test(st) ? "up" : /退潮/.test(st) ? "down" : "";

    const cards = OPP.directions.map((d, i) => {
      const stage = stageShort(d.stage);
      const title = titleShort(d.name);
      const lead = leadOf(d.logic || d.opportunity || "");
      const stocks = (d.stocks || []).map((s) => {
        const role = s.role || s.position;  // 统一字段 role,兜底旧 position
        const posCls = /龙头/.test(role) ? "up" : /二线/.test(role) ? "ok" : /补涨/.test(role) ? "warn" : "";
        const tip = [role, s.note || s.detail].filter(Boolean).join(" · ");
        return `<button class="opp-chip ${posCls}" data-code="${esc(s.code)}" title="${esc(tip)}">
          <span class="opp-chip-name">${esc(s.name)}</span>
          <span class="opp-chip-pos">${esc(role || "")}</span>
        </button>`;
      }).join("");

      return `<article class="opp-row" data-xname="${esc(d.name)}">
        <header class="opp-row-head">
          <div class="opp-rank">${String(i + 1).padStart(2, "0")}</div>
          <div class="opp-row-main">
            <div class="opp-row-meta">
              <span class="opp-stage ${stageCls(d.stage)}">${esc(stage)}</span>
              ${d.priority ? `<span class="opp-stars" title="优先级">${esc(d.priority)}</span>` : ""}
              ${d.asof ? `<span class="opp-asof">${esc(d.asof)}</span>` : ""}
            </div>
            <h3 class="opp-title" title="${esc(d.name)}">${esc(title)}</h3>
            ${lead ? `<p class="opp-lead">${esc(lead)}</p>` : ""}
          </div>
        </header>
        ${stocks ? `<div class="opp-stocks">${stocks}</div>` : ""}
        <div class="opp-cols">
          ${blockHtml("机会挖掘", d.opportunity, "pick", "opp")}
          ${blockHtml("风险提示", d.risk, "risk", "opp")}
        </div>
        <details class="opp-more">
          <summary>背后逻辑与发酵信号</summary>
          <div class="opp-more-body">
            ${blockHtml("背后逻辑", d.logic, "logic", "opp")}
            ${blockHtml("发酵信号", d.signals, "signal", "opp")}
          </div>
        </details>
      </article>`;
    }).join("");

    el.innerHTML = secTitle("机会清单", `${OPP.directions.length} 个方向 · ${esc(OPP.date || "")}`) +
      `<div class="opp-board">${cards}</div>`;
    el.querySelectorAll(".opp-chip").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.code)));
  }

  /* ---------- 4. 逻辑链（事件驱动推理链：事件 → 传导 → 受益股） ---------- */
  // 强度由生成 Agent 在数据中直接给出(strength: 强/中/弱)，前端不再做关键词评分
  const logicStrengthRank = { "强": 3, "中": 2, "弱": 1 };
  const logicStrengthCls = { "强": "up", "中": "warn", "弱": "down" };

  function renderLogic() {
    const el = $("#viewLogic");
    if (!el) return;
    const LOGIC = window.LOGIC || null;
    const chains = (LOGIC && Array.isArray(LOGIC.chains)) ? LOGIC.chains : [];
    // 新版 schema: chains[].path 传导路径；旧数据(segments) 不再兼容，提示重新生成
    const valid = chains.filter((c) => Array.isArray(c.path) && c.path.length);
    if (!valid.length) {
      el.innerHTML = secTitle("逻辑链", "事件 → 传导 → 受益股") + emptyState("逻辑链数据待生成（新版事件驱动格式）。");
      return;
    }

    const ranked = valid.slice().sort((a, b) => (logicStrengthRank[b.strength] || 0) - (logicStrengthRank[a.strength] || 0));
    const cards = ranked.map((c, idx) => {
      const sCls = logicStrengthCls[c.strength] || "";
      const nodes = c.path.map((p, i) => {
        const stocks = (p.stocks || []).map((st) =>
          `<button class="ind-stock" data-code="${esc(st.code)}"><span class="is-name">${esc(st.name)}</span><span class="is-code">${esc(st.code)}</span><span class="is-role">${esc(st.role || "")}</span></button>`
        ).join("");
        return `${i ? '<div class="lc-arrow"></div>' : ""}<div class="lc-node">
          <div class="lc-node-head"><span class="lc-node-no">${String(i + 1).padStart(2, "0")}</span><span class="lc-node-step">${esc(p.step || "")}</span></div>
          <div class="lc-node-detail">${fieldHtml(p.detail || "—")}</div>
          ${stocks ? `<div class="sd-stock-list">${stocks}</div>` : ""}
        </div>`;
      }).join("");

      return `<article class="card blk lc-chain ${sCls}" data-xname="${esc(c.name)}">
        <div class="lc-chain-head">
          <div class="lc-chain-title"><span class="lc-rank">#${idx + 1}</span><h3 class="sd-name">${esc(c.name)}</h3></div>
          <div class="lc-head-meta">
            ${c.event_type ? `<span class="lc-etype">${esc(c.event_type)}</span>` : ""}
            ${c.strength ? `<span class="lc-strength ${sCls}">${esc(c.strength)}</span>` : ""}
            <span class="lc-asof">${esc(c.event_date || c.asof || "")}</span>
          </div>
        </div>
        <div class="lc-event">
          <div class="lc-event-text">${fieldHtml(c.event || "—")}</div>
          ${c.strength_reason ? `<div class="lc-event-reason">评级依据：${esc(c.strength_reason)}</div>` : ""}
        </div>
        <div class="lc-logic"><span class="sd-l">核心逻辑</span>${fieldHtml(c.logic || "—")}</div>
        <div class="lc-flow-head"><span class="sd-l">传导路径</span><span class="lc-flow-hint">事件 → 传导 → 受益股</span></div>
        <div class="lc-path">${nodes}</div>
        ${c.invalidation ? `<div class="lc-invalidation"><span class="sd-l">证伪条件</span>${fieldHtml(c.invalidation)}</div>` : ""}
      </article>`;
    }).join("");

    el.innerHTML = secTitle("逻辑链", `事件 → 传导 → 受益股 · 按强度排序 · ${esc(LOGIC.date || "")}`) +
      (LOGIC.summary ? `<p class="lc-board-summary">${esc(LOGIC.summary)}</p>` : "") +
      `<div class="sd-grid-cards lc-board">${cards}</div>`;
    el.querySelectorAll(".ind-stock").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.code)));
  }

  /* ---------- 6.4 产业链涨价(合并原产业雷达+材料涨价) ---------- */
  // 旧 industry/materials direction -> 新 chain 模型(过渡期 CHAIN 为空时兜底)
  const confToIntensity = { "高": "强", "中高": "中强", "中": "中", "低": "弱" };
  function normalizeChainDir(d, src) {
    if (src === "chain" || d.driver_type) return d;
    if (src === "industry") {
      return { name: d.name, category: d.category || "", chain: d.chain || "",
        driver_type: d.driver_type || [], bottleneck: d.bottleneck || "",
        price_signal: d.price_signal || "", driver: d.driver || "",
        supply: d.supply || "", evidence: d.evidence || "", downstream: d.downstream || "",
        stocks: d.stocks || [], risk: d.risk || "",
        intensity: d.intensity || confToIntensity[d.confidence] || "中", asof: d.asof || "" };
    }
    // materials
    return { name: d.name, category: d.category || "",
      chain: d.chain || (d.downstream ? `-> ${d.downstream}` : ""),
      driver_type: d.driver_type || [], bottleneck: d.bottleneck || "",
      price_signal: d.price_signal || d.price || "", driver: d.driver || "",
      supply: d.supply || "", evidence: d.evidence || "", downstream: d.downstream || "",
      stocks: d.stocks || [], risk: d.risk || "",
      intensity: d.intensity || "中", asof: d.asof || "" };
  }
  // 合并数据源: CHAIN 优先, 否则 INDUSTRY+MATERIALS 映射
  function getChainDirections() {
    const CHAIN = window.CHAIN || null;
    const INDUSTRY = window.INDUSTRY || null;
    if (CHAIN && Array.isArray(CHAIN.directions) && CHAIN.directions.length) {
      return { dirs: CHAIN.directions.map((d) => normalizeChainDir(d, "chain")), date: CHAIN.date, summary: CHAIN.summary, src: "chain" };
    }
    const merged = [];
    let date = "", summary = "";
    if (INDUSTRY && Array.isArray(INDUSTRY.directions)) {
      INDUSTRY.directions.forEach((d) => merged.push(normalizeChainDir(d, "industry")));
      date = INDUSTRY.date || date; summary = INDUSTRY.summary || summary;
    }
    if (window.MATERIALS && Array.isArray(window.MATERIALS.directions)) {
      window.MATERIALS.directions.forEach((d) => merged.push(normalizeChainDir(d, "materials")));
      date = date || window.MATERIALS.date; summary = summary || window.MATERIALS.summary;
    }
    return { dirs: merged, date, summary, src: "legacy" };
  }
  function renderChain() {
    const el = $("#viewChain");
    if (!el) return;
    const INDUSTRY_MARKET = window.INDUSTRY_MARKET || null;
    const { dirs, date, summary, src } = getChainDirections();
    if (!dirs.length && (!INDUSTRY_MARKET || !Array.isArray(INDUSTRY_MARKET.top))) {
      el.innerHTML = secTitle("产业链涨价", "供需紧张 / 涨价方向 · 卡脖子与产业链逻辑") + emptyState("产业链涨价数据待生成。");
      return;
    }
    const intCls = { "极强": "up", "强": "ok", "中强": "warn", "中": "warn", "弱": "down" };
    const intRank = { "极强": 5, "强": 4, "中强": 3, "中": 2, "弱": 1 };
    const driverCls = { "卡脖子": "driver-bottleneck", "政策": "driver-policy", "事件": "driver-event", "供需": "driver-supply", "成本": "driver-cost", "技术": "driver-tech" };
    const rowHtml = (r) => `<div class="ind-row ${r.change_pct > 0 ? "up" : r.change_pct < 0 ? "down" : ""}"><span class="ind-rank">${esc(r.rank)}</span><span class="ind-name">${esc(r.name)}</span><span class="ind-chg">${r.change_pct > 0 ? "+" : ""}${esc(r.change_pct)}%</span><span class="ind-cnt">↑${esc(r.up_count)} ↓${esc(r.down_count)}</span><span class="ind-leader">龙头 ${esc(r.leader || "-")}</span></div>`;

    let filters = "", cards = "";
    if (dirs.length) {
      const ranked = dirs.slice().sort((a, b) => (intRank[b.intensity] || 0) - (intRank[a.intensity] || 0));
      const cats = [...new Set(ranked.map((d) => d.category).filter(Boolean))].sort();
      const drivers = [...new Set(ranked.flatMap((d) => d.driver_type || []).filter(Boolean))];
      cards = ranked.map((d, i) => {
        const stocks = (d.stocks || []).map((s) =>
          `<button class="dir-chip" data-code="${esc(s.code)}" title="${esc(s.role || "")}">
            <span class="dir-chip-name">${esc(s.name)}</span>
            <span class="dir-chip-pos">${esc(trunc(s.role || "", 18))}</span>
          </button>`
        ).join("");
        const lead = leadOf(d.price_signal || d.supply || d.driver || "", true);
        const drvTags = (d.driver_type || []).map((t) => `<span class="chain-driver ${driverCls[t] || ""}">${esc(t)}</span>`).join("");
        const drvData = (d.driver_type || []).join(" ");
        return `<article class="chain-card" data-driver="${esc(drvData)}" data-cat="${esc(d.category || "")}">
          <header class="dir-row-head">
            <div class="dir-rank">${String(i + 1).padStart(2, "0")}</div>
            <div class="dir-row-main">
              <div class="dir-row-meta">
                <span class="dir-badge ${intCls[d.intensity] || ""}">强度 ${esc(d.intensity || "-")}</span>
                ${d.asof ? `<span class="dir-asof">${esc(d.asof)}</span>` : ""}
              </div>
              <h3 class="dir-title" title="${esc(d.name)}">${esc(titleShort(d.name, 36))}</h3>
              ${d.chain ? `<p class="chain-chain">${esc(d.chain)}</p>` : ""}
              ${lead ? `<p class="dir-lead">${esc(lead)}</p>` : ""}
            </div>
          </header>
          ${drvTags ? `<div class="chain-drivers">${drvTags}</div>` : ""}
          ${d.bottleneck ? `<div class="chain-bottleneck"><span class="chain-bottleneck-lbl">卡脖子</span><p>${esc(d.bottleneck)}</p></div>` : ""}
          ${stocks ? `<div class="dir-stocks">${stocks}</div>` : ""}
          <div class="dir-cols">
            ${blockHtml("价格信号", d.price_signal, "pick", "dir")}
            ${blockHtml("风险 / 反向", d.risk, "risk", "dir")}
          </div>
          <details class="dir-more">
            <summary>供需、驱动与证据</summary>
            <div class="dir-more-body">
              ${blockHtml("供需状况", d.supply, "logic", "dir")}
              ${blockHtml("涨价驱动", d.driver, "logic", "dir")}
              ${d.evidence ? blockHtml("关键证据", d.evidence, "logic", "dir") : ""}
              ${d.downstream ? blockHtml("下游应用", d.downstream, "logic", "dir") : ""}
            </div>
          </details>
        </article>`;
      }).join("");
      const driverFilters = ["全部", ...drivers].map((t) =>
        `<button class="chain-filter ${t === "全部" ? "active" : ""}" data-driver="${t === "全部" ? "all" : esc(t)}">${esc(t)}</button>`
      ).join("");
      const catFilters = ["全部", ...cats].map((t) =>
        `<button class="chain-filter ${t === "全部" ? "active" : ""}" data-cat="${t === "全部" ? "all" : esc(t)}">${esc(t)}</button>`
      ).join("");
      filters = `<div class="chain-filters">` +
        (drivers.length ? `<div class="chain-filter-group"><span class="chain-filter-lbl">驱动</span>${driverFilters}</div>` : "") +
        (cats.length ? `<div class="chain-filter-group"><span class="chain-filter-lbl">行业</span>${catFilters}</div>` : "") +
        `</div>`;
    }
    const sourceNote = INDUSTRY_MARKET?.source === "market-snapshot-fallback" ? ` · 异动样本 ${INDUSTRY_MARKET.coverage || 0} 只（非全市场）` : "";
    const ranking = INDUSTRY_MARKET?.top?.length
      ? `<section class="dir-rank-panel"><h3 class="dir-rank-title">今日行业涨幅前 ${INDUSTRY_MARKET.top.length}<span class="dir-rank-note">${sourceNote}</span></h3><div class="ind-list">${INDUSTRY_MARKET.top.map(rowHtml).join("")}</div></section>`
      : "";
    const rankingBottom = INDUSTRY_MARKET?.bottom?.length
      ? `<section class="dir-rank-panel"><h3 class="dir-rank-title">今日行业跌幅前 ${INDUSTRY_MARKET.bottom.length}<span class="dir-rank-note">${sourceNote}</span></h3><div class="ind-list">${INDUSTRY_MARKET.bottom.map(rowHtml).join("")}</div></section>`
      : "";
    const srcNote = src === "legacy" ? " · 旧数据兼容映射(待 Hermes 产出新模型)" : "";
    el.innerHTML = secTitle("产业链涨价", `${dirs.length} 个方向 · ${esc(date || "")}${srcNote}`) +
      (summary ? `<p class="sec-summary">${esc(summary)}</p>` : "") +
      filters + `<div class="chain-board">${cards}</div>${ranking}${rankingBottom}`;
    el.querySelectorAll(".dir-chip").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.code)));
    let curDriver = "all", curCat = "all";
    el.querySelectorAll(".chain-filter").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.driver) { curDriver = b.dataset.driver; el.querySelectorAll('.chain-filter[data-driver]').forEach((x) => x.classList.toggle("active", x === b)); }
        if (b.dataset.cat) { curCat = b.dataset.cat; el.querySelectorAll('.chain-filter[data-cat]').forEach((x) => x.classList.toggle("active", x === b)); }
        el.querySelectorAll(".chain-card").forEach((c) => {
          const drvOk = curDriver === "all" || (c.dataset.driver || "").split(" ").includes(curDriver);
          const catOk = curCat === "all" || c.dataset.cat === curCat;
          c.style.display = drvOk && catOk ? "" : "none";
        });
      });
    });
  }

  /* ---------- 7b. 周末发酵 ---------- */
  const fermentClass = (lv) => ({ "高": "up", "中": "warn", "低": "" }[lv] || "");
  const catClass = (c) => ({
    "政策利好": "up", "产业催化": "up", "公司公告": "ok",
    "海外映射": "warn", "情绪传闻": "warn", "政策利空": "down", "风险利空": "down",
  }[c] || "");
  const signalClass = (s) => ({ "真信号": "up", "待验证": "warn", "噪音": "down" }[s] || "");

  function renderWeekend() {
    const el = $("#viewWeekend");
    if (!el) return;
    const W = window.WEEKEND;
    if (!W || (!W.hotspots && !W.scenario)) {
      el.innerHTML = secTitle("周末发酵", "Hermes 每周日下午 21:00 自动搜集") + emptyState("周末发酵数据待生成（每周日下午由 Hermes 自动搜集周末热点并解读）。");
      return;
    }
    const hotspots = W.hotspots || [];
    const sc = W.scenario || {};
    // 热点卡片
    const cards = hotspots.map((h) => {
      const stocks = ((h.stocks || h.impactStocks) || []).map((s) =>  // 统一字段 stocks,兜底旧 impactStocks
        `<button class="we-stock" data-code="${esc(s.code)}">${esc(s.name)} <span class="we-dir ${s.direction === "利好" ? "up" : s.direction === "利空" ? "down" : ""}">${esc(s.direction || "")}</span></button>`
      ).join("");
      return `<article class="card blk we-card" data-xname="${esc(h.title || "")}">
        <div class="we-top">
          <span class="we-cat ${catClass(h.category)}">${esc(h.category || "—")}</span>
          <span class="we-ferment ${fermentClass(h.fermentLevel)}">发酵 ${esc(h.fermentLevel || "—")}</span>
          <span class="we-signal ${signalClass(h.signalType)}">${esc(h.signalType || "—")}</span>
        </div>
        <h3 class="we-title">${esc(h.title || "—")}</h3>
        ${h.event ? `<div class="we-sec"><span class="sd-l">事件</span>${fieldHtml(h.event)}</div>` : ""}
        ${h.interpretation ? `<div class="we-sec"><span class="sd-l">解读</span>${fieldHtml(h.interpretation)}</div>` : ""}
        ${h.falsifyRisk ? `<div class="we-sec we-risk"><span class="sd-l">证伪风险</span>${fieldHtml(h.falsifyRisk)}</div>` : ""}
        ${h.mondayStrategy ? `<div class="we-sec we-action"><span class="sd-l">周一策略</span>${fieldHtml(h.mondayStrategy)}</div>` : ""}
        ${Array.isArray(h.impactSectors) && h.impactSectors.length ? `<div class="we-sectors">${h.impactSectors.map((s) => `<span class="we-sector">${esc(s)}</span>`).join("")}</div>` : ""}
        ${stocks ? `<div class="we-stocks">${stocks}</div>` : ""}
      </article>`;
    }).join("");
    // 周一盘面推演
    const scenarioHtml = sc.openForecast || sc.watchlist || sc.chaseList || sc.avoidList ? `
      <div class="we-scenario">
        <h3 class="we-sc-title">周一盘面推演</h3>
        ${sc.openForecast ? `<div class="we-sc-sec"><span class="sd-l">开盘预判</span><p>${esc(sc.openForecast)}</p></div>` : ""}
        ${sc.watchlist && sc.watchlist.length ? `<div class="we-sc-sec"><span class="sd-l">重点关注</span><div class="we-watchlist">${sc.watchlist.map((w) =>
          `<div class="we-watch-item"><button class="we-stock" data-code="${esc(w.code)}">${esc(w.name)}</button><div class="we-watch-reason">${esc(w.reason || "")}</div>${w.confirmSignal ? `<div class="we-watch-sig"><span class="we-sig-label">确认</span>${esc(w.confirmSignal)}</div>` : ""}${w.falsifySignal ? `<div class="we-watch-sig"><span class="we-sig-label falsify">证伪</span>${esc(w.falsifySignal)}</div>` : ""}</div>`
        ).join("")}</div></div>` : ""}
        ${sc.chaseList && sc.chaseList.length ? `<div class="we-sc-sec"><span class="sd-l">接力方向</span><div class="we-chips up">${sc.chaseList.map((c) => `<span class="we-chip up">${esc(c)}</span>`).join("")}</div></div>` : ""}
        ${sc.avoidList && sc.avoidList.length ? `<div class="we-sc-sec"><span class="sd-l">回避清单</span><div class="we-chips down">${sc.avoidList.map((c) => `<span class="we-chip down">${esc(c)}</span>`).join("")}</div></div>` : ""}
      </div>` : "";
    // 噪音过滤
    const noiseHtml = W.noiseFilter ? `<div class="we-noise"><span class="sd-l">噪音过滤</span><p>${esc(W.noiseFilter)}</p></div>` : "";

    const wDate = W.weekendDate || "";
      const daysAgo = wDate ? Math.floor((Date.now() - new Date(wDate).getTime()) / 86400000) : 0;
      const stale = daysAgo > 4;
      const dateHint = stale ? `周末 ${esc(wDate)} · ${hotspots.length} 个热点 · ⚠ ${daysAgo}天前数据` : `周末 ${esc(wDate)} · ${hotspots.length} 个热点`;
      el.innerHTML = secTitle("周末发酵", dateHint) +
      (W.summary ? `<div class="we-summary">${esc(W.summary)}</div>` : "") +
      `<div class="we-grid">${cards}</div>` +
      scenarioHtml + noiseHtml +
      `<div class="home-foot">由 Hermes Agent 每周日下午 21:00 自动搜集周末热点并解读 · 仅供研究参考，非投资建议</div>`;
    // 个股点击
    el.querySelectorAll(".we-stock[data-code]").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.code)));
  }

  /* ---------- 7. 事件概率 ---------- */
  function renderEvents() {
    const el = $("#viewEvents");
    if (!el) return;
    const EVENTS = window.EVENTS || null;
    if (!EVENTS || !EVENTS.events || !EVENTS.events.length) {
      el.innerHTML = secTitle("事件概率", "重要新闻影响分析") + emptyState("事件分析数据待生成。");
      return;
    }

    const impCls = { "高": "up", "中高": "ok", "中": "warn", "低": "dim" };
    const dirCls = (d) => /利好/.test(d) && !/谨慎|利空/.test(d) ? "up" : /利空/.test(d) && !/受益/.test(d) ? "down" : /结构性/.test(d) ? "warn" : "";
    const sectorChips = (sectors) => {
      const parts = String(sectors || "")
        .split(/[\/、,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!parts.length) return "";
      return `<div class="ev-sectors">${parts.map((s) => `<span class="ev-sector">${esc(s)}</span>`).join("")}</div>`;
    };

    // 重要性：高 > 中高 > 中 > 低
    const impRank = { "高": 4, "中高": 3, "中": 2, "低": 1 };
    const ranked = EVENTS.events.slice().sort((a, b) => (impRank[b.importance] || 0) - (impRank[a.importance] || 0));

    const cards = ranked.map((e, i) => {
      const title = titleShort(e.title, 42);
      const lead = leadOf(e.importance_reason || e.content || "");
      const stocks = (e.stocks || []).map((s) => {
        const dir = s.direction || s.impact;  // 统一字段 direction,兜底旧 impact
        const tone = dir === "受益" ? "up" : dir === "受损" ? "down" : "";
        const tip = [dir, s.note || s.role].filter(Boolean).join(" · ");
        return `<button class="ev-chip ${tone}" data-code="${esc(s.code)}" title="${esc(tip)}">
          <span class="ev-chip-name">${esc(s.name)}</span>
          <span class="ev-chip-pos">${esc(dir || "")}</span>
        </button>`;
      }).join("");

      return `<article class="ev-row" data-xname="${esc(e.title)}">
        <header class="ev-row-head">
          <div class="ev-rank">${String(i + 1).padStart(2, "0")}</div>
          <div class="ev-row-main">
            <div class="ev-row-meta">
              <span class="ev-imp ${impCls[e.importance] || ""}">重要度 ${esc(e.importance || "—")}</span>
              ${e.direction ? `<span class="ev-dir ${dirCls(e.direction)}">${esc(e.direction)}</span>` : ""}
              ${e.category ? `<span class="ev-cat">${esc(e.category)}</span>` : ""}
              ${e.time ? `<span class="ev-asof">${esc(e.time)}</span>` : ""}
            </div>
            <h3 class="ev-title" title="${esc(e.title)}">${esc(title)}</h3>
            ${lead ? `<p class="ev-lead">${esc(lead)}</p>` : ""}
          </div>
        </header>
        ${sectorChips(e.sectors)}
        ${stocks ? `<div class="ev-stocks-row">${stocks}</div>` : ""}
        <div class="ev-cols">
          ${blockHtml("重要性原因", e.importance_reason, "why", "ev")}
          ${blockHtml("影响时效", e.timeliness, "time", "ev")}
        </div>
        <details class="ev-more">
          <summary>事件详情与来源</summary>
          <div class="ev-more-body">
            ${blockHtml("事件内容", e.content, "content", "ev")}
            ${e.source ? `<div class="ev-source">来源：${esc(e.source)}</div>` : ""}
          </div>
        </details>
      </article>`;
    }).join("");

    el.innerHTML = secTitle("事件概率", `${EVENTS.events.length} 件 · ${esc(EVENTS.date || "")}`) +
      `<div class="ev-board">${cards}</div>`;
    el.querySelectorAll(".ev-chip").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.code)));
  }

  /* ---------- 8. 新闻 ---------- */
  function renderNewsAll() {
    const el = $("#viewNews");
    if (!el) return;
    const NEWSALL = window.NEWSALL || null;
    if (!NEWSALL) { el.innerHTML = secTitle("新闻", "个股新闻 / 全球资讯 / 公告") + emptyState("新闻数据待生成(每日由 fetch_news_all.py 自动更新)。"); return; }
    const globalHtml = (NEWSALL.global || []).slice(0, 20).map((n) => {
      const title = n.title || "";
      const summary = n.summary || n.content || "";
      const url = safeUrl(n.url);
      return `<div class="nf-item">
        <div class="nf-meta"><span class="nf-date">${esc((n.time || n.date || "").toString().slice(0, 16))}</span>${n.source ? `<span class="nf-type">${esc(n.source)}</span>` : ""}${url ? `<a class="nf-source-link" href="${esc(url)}" target="_blank" rel="noopener">查看来源</a>` : ""}</div>
        ${summary ? `<details class="nf-details"><summary class="nf-text">${esc(title)}</summary><div class="nf-summary">${esc(summary)}</div></details>` : `<div class="nf-text">${esc(title)}</div>`}
      </div>`;
    }).join("");
    const annHtml = (NEWSALL.announcements || []).slice(0, 30).map((n) => {
      const code = /^\d{6}$/.test(String(n.code || "")) ? String(n.code) : "";
      const url = safeUrl(n.url);
      const title = n.title || n.announcementTitle || "";
      return `<div class="nf-item">
        <div class="nf-meta"><span class="nf-date">${esc((n.date || "").slice(0, 10))}</span><span class="nf-type">公告</span>${code ? `<button class="ann-stock-link" data-code="${esc(code)}">${esc(code)}</button>` : ""}${url ? `<a class="nf-source-link" href="${esc(url)}" target="_blank" rel="noopener">查看原文</a>` : ""}</div>
        <div class="nf-text">${esc(title)}</div>
      </div>`;
    }).join("");
    el.innerHTML = secTitle("新闻", "全球资讯 / 公告 · " + esc(NEWSALL.date || "")) +
      `<div class="news-cols">
        <section class="card blk"><h3 class="blk-h">全球资讯 7×24</h3><div class="newsfeed">${globalHtml || emptyState("无资讯")}</div></section>
        <section class="card blk"><h3 class="blk-h">近期公告</h3><div class="newsfeed">${annHtml || emptyState("无公告")}</div></section>
      </div>`;
    el.querySelectorAll(".ann-stock-link[data-code]").forEach((button) =>
      button.addEventListener("click", () => openDrawer(button.dataset.code))
    );
  }

  /* ---------- 8b. X 简报（每 2 小时推送，早上看隔夜完整流水） ---------- */
  function renderXBriefs() {
    const el = $("#viewXbrief");
    if (!el) return;
    const XB = window.XBRIEFS || null;
    const list = (XB && Array.isArray(XB.briefs)) ? XB.briefs.filter((b) => cleanDisplayText(b.content || "").trim().length >= 40) : [];
    if (!list.length) {
      el.innerHTML = secTitle("X 简报", "AI + 股市 · 每 2 小时筛选推送") +
        emptyState("暂无简报。定时任务搜完会自动写入，早上打开本页即可看到一整晚的内容。");
      return;
    }
    const overnightHint = `<p class="xb-hint">中国早晨 ≈ 美国交易时段刚过完。下面按时间倒序，最新在最上；往下翻就是整晚流水。</p>`;
    const tabs = list.map((b, i) => {
      const t = String(b.time || "").slice(5, 16);
      const focus = b.hasFocusStock ? " · 重点票" : "";
      return `<button class="rep-tab ${i === 0 ? "active" : ""}" data-i="${i}">${esc(t || "—")}<span class="rep-time">AI${b.aiCount || 0}/市${b.marketCount || 0}${esc(focus)}</span></button>`;
    }).join("");
    const bodies = list.map((b, i) => {
      const head = `${b.title || "X资讯简报"} · ${b.time || ""}${b.period ? " · " + b.period : ""}`;
      return `<div class="rep-body ${i === 0 ? "active" : ""}" data-i="${i}">
        <div class="rep-head"><h2>${esc(head)}</h2><span class="rep-updated">X 筛选 · ${esc(b.time || "")}</span></div>
        <div class="rep-md">${md2html(b.content || "")}</div>
      </div>`;
    }).join("");
    el.innerHTML = secTitle("X 简报", `${list.length} 期 · 更新 ${esc(XB.updated || XB.generatedAt || "")}`) +
      overnightHint +
      `<div class="rep-tabs">${tabs}</div>
      <div class="rep-bodies">${bodies}</div>
      <div class="rep-foot">来源：X 公开讨论，经垃圾筛选后推送（scripts/push_xbrief.py）。保留最近约 4 天。仅供研究参考，非投资建议。</div>`;
    el.querySelectorAll(".rep-tab").forEach((btn) =>
      btn.addEventListener("click", () => {
        const i = btn.dataset.i;
        el.querySelectorAll(".rep-tab").forEach((t) => t.classList.toggle("active", t.dataset.i === i));
        el.querySelectorAll(".rep-body").forEach((d) => d.classList.toggle("active", d.dataset.i === i));
      })
    );
  }



  // 极简 markdown → HTML（标题/表格/加粗/列表/分隔线）。不引外部库，够用。
  function normalizeReportText(value) {
    let text = cleanDisplayText(value || "").trim();
    text = text
      .replace(/^\s*```(?:markdown|md)?\s*\r?\n/i, "")
      .replace(/\r?\n\s*```\s*$/i, "")
      .trim();
    const lines = text.split("\n");
    if (lines[0] && /\u6570\u636e\u5b8c\u6574\u5ea6/.test(lines[0]) && /\u5168\u90e8\u6b63\u5e38/.test(lines[0]) && /\u7f3a\u5931|\u672a\u80fd|\u5931\u8d25|\u6682\u7f3a|\u62a5\u9519/.test(lines[0])) {
      lines[0] = lines[0].replace(/[\[\uff3b]\u5168\u90e8\u6b63\u5e38[\]\uff3d]/, "[部分缺失]");
    }
    return lines.join("\n");
  }

  function reportDisplayTitle(report) {
    const time = String(report.time || "");
    const match = time.match(/^\d{4}-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
    const label = report.type === "盘前简报" ? "每日盘前简报" : (report.type || "AI 复盘");
    return match ? `${label} · ${match[1]}月${match[2]}日 ${match[3]}` : (report.title || label);
  }

  function md2html(md) {
    // 去 AI 味：移除 emoji 和装饰性符号（📊🔥🔴🟢⭐⚠️等），保留文字内容
    let text = normalizeReportText(md)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
      .replace(/[🔴🟢🟡⭐⚠️📊📈📉🔥✅❌➡️📍🎯🇺🇸🇨🇳]/g, "")
      // 去 AI 过渡语：报告开头的英文思考过程（Let me.../I have.../All data... 等）
      .replace(/^(I (?:now )?have all the data[^]*?\n---+\n)/, "")
      .replace(/^(Let me [^\n]*\n)/, "")
      .replace(/^(All data verified[^\n]*\n)/, "")
      .replace(/^(Here(?:'s| is) the [^\n]*:\s*\n)/, "");
    const lines = esc(text).split("\n");
    let html = "", inTable = false, inList = false;
    const flushList = () => { if (inList) { html += "</ul>"; inList = false; } };
    const flushTable = () => { if (inTable) { html += "</tbody></table>"; inTable = false; } };
    // 涨跌着色：单元格里的 +X%/-X% 或 利多/利空 标红绿
    // toneCell: 对已转义的单元格内容着色，只匹配纯文本符号（不含 HTML 标签）
    const toneCell = (c) => c
      .replace(/(\+[\d.]+%)/g, '<span class="up">$1</span>')
      .replace(/(-[\d.]+%)/g, '<span class="down">$1</span>')
      .replace(/(利[多空])/g, (m) => `<span class="${m === "利多" ? "up" : "down"}">${m}</span>`);
    for (let raw of lines) {
      const line = raw.replace(/\r$/, "");
      // 分隔线
      if (/^---+$/.test(line.trim())) { flushList(); flushTable(); continue; }
      // 表格：---|--- 分隔行，跳过；数据行 → <tr><td>
      if (line.includes("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
        if (cells.every((c) => /^:?-+:?$/.test(c))) { if (!inTable) { html += "<table><tbody>"; inTable = true; } continue; }
        if (cells.length) { flushList(); if (!inTable) { html += "<table><tbody>"; inTable = true; } html += "<tr>" + cells.map((c) => `<td>${toneCell(c)}</td>`).join("") + "</tr>"; continue; }
      }
      flushTable();
      // 标题
      const hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) { flushList(); html += `<h${hm[1].length + 2}>${hm[2].trim()}</h${hm[1].length + 2}>`; continue; }
      // 列表
      const lm = line.match(/^[-*]\s+(.*)/);
      if (lm) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${lm[1]}</li>`; continue; }
      // 空行
      if (!line.trim()) { flushList(); continue; }
      // 数据完整度是可信度状态，不应混在普通正文中。模型有时会加粗该行。
      const qualityLine = line.trim().replace(/^\*\*(.*?)\*\*$/, "$1").trim();
      if (/^数据完整度[\uff1a:]/.test(qualityLine)) {
        flushList();
        const partial = /部分缺失|缺失|未能|失败|暂缺|报错/.test(qualityLine);
        html += `<div class="rep-quality ${partial ? "is-partial" : "is-complete"}"><strong>${partial ? "数据部分缺失" : "数据完整"}</strong><span>${qualityLine.replace(/^数据完整度[\uff1a:]\s*/, "").replace(/^[\[［]|[\]］]$/g, "")}</span></div>`;
        continue;
      }
      // 普通段落（内联：加粗 **x** / `code`）
      flushList();
      html += `<p>${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`;
    }
    flushList(); flushTable();
    return html;
  }

  function renderReports() {
    const el = $("#reports");
    if (!el) return;
    const REPORTS = window.REPORTS || {};
    const list = (REPORTS.reports || []).filter((report) => cleanDisplayText(report.content || "").trim().length >= 80);
    if (!list.length) { el.innerHTML = ""; return; }
    const tabs = list.map((r, i) =>
      `<button class="rep-tab ${i === 0 ? "active" : ""}" data-i="${i}">${esc(r.type)}<span class="rep-time">${esc((r.time || "").slice(5, 16))}</span></button>`
    ).join("");
    const bodies = list.map((r, i) =>
      `<div class="rep-body ${i === 0 ? "active" : ""}" data-i="${i}">
        <div class="rep-head"><h2>${esc(reportDisplayTitle(r))}</h2><span class="rep-updated">Hermes · ${esc(r.time || "")}</span></div>
        <div class="rep-md">${md2html(r.content || "")}</div>
      </div>`
    ).join("");
    el.innerHTML = `<div class="rep-tabs">${tabs}</div>
      <div class="rep-bodies" id="repBodies">${bodies}</div>
      <div class="rep-foot">报告由本地 Hermes Agent 定时任务生成（全网搜索调研），scripts/fetch_hermes.py 导出。仅供研究参考，非投资建议。更新于 ${esc(REPORTS.updated || "")}</div>`;
    // tab 切换
    el.querySelectorAll(".rep-tab").forEach((b) =>
      b.addEventListener("click", () => {
        const i = b.dataset.i;
        el.querySelectorAll(".rep-tab").forEach((t) => t.classList.toggle("active", t.dataset.i === i));
        el.querySelectorAll(".rep-body").forEach((d) => d.classList.toggle("active", d.dataset.i === i));
      })
    );
  }
  App.renderOpportunities = renderOpportunities;
  App.renderLogic = renderLogic;
  App.renderChain = renderChain;
  App.renderWeekend = renderWeekend;
  App.renderEvents = renderEvents;
  App.renderNewsAll = renderNewsAll;
  App.renderXBriefs = renderXBriefs;
  App.renderReports = renderReports;
  if (window.App.start) window.App.start();
})(window.App);
