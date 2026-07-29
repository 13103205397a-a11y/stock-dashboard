(function (App) {
  const { $, esc, secTitle, emptyState, fieldHtml, titleShort, leadOf, blockHtml, cleanDisplayText, openDrawer } = App;

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

  /* ---------- 7. 今日热点事件 ---------- */
  function renderEvents() {
    const el = $("#viewEvents");
    if (!el) return;
    const EVENTS = window.EVENTS || null;
    if (!EVENTS || !EVENTS.events || !EVENTS.events.length) {
      el.innerHTML = secTitle("今日热点事件", "重要新闻影响与市场传导") + emptyState("热点事件分析数据待生成。");
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

    el.innerHTML = secTitle("今日热点事件", `${EVENTS.events.length} 件 · ${esc(EVENTS.date || "")}`) +
      `<div class="ev-board">${cards}</div>`;
    el.querySelectorAll(".ev-chip").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.code)));
  }

  /* ---------- 8b. 外围热点（每 2 小时推送，聚合海外 AI / 宏观 / 市场线索） ---------- */
  function xbFormatTime(t) {
    const s = String(t || "");
    const m = s.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/) || s.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    if (m) return { day: `${m[1]}/${m[2]}`, clock: `${m[3]}:${m[4]}`, full: s };
    if (s.length >= 16) return { day: s.slice(5, 10).replace("-", "/"), clock: s.slice(11, 16), full: s };
    return { day: "—", clock: s || "—", full: s || "—" };
  }

  function xbMdHtml(md) {
    // 去掉与文章页头重复的 Markdown 大标题，并在通用渲染上强化可信度与编号条目。
    const normalized = cleanDisplayText(md || "")
      .replace(/^\s*#\s+[^\n]+\n+/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    let html = md2html(normalized);
    html = html
      .replace(/(可信度[：:]\s*)(高|中高|中|中低|低)/g, (_, p, level) => {
        const cls =
          level === "高" || level === "中高" ? "high" :
          level === "中" ? "mid" : "low";
        return `${p}<span class="xb-cred xb-cred-${cls}">${level}</span>`;
      })
      .replace(/(【未证实】|未证实)/g, '<span class="xb-flag">$1</span>');
    return html;
  }

  function renderXBriefs() {
    const el = $("#viewXbrief");
    if (!el) return;
    const XB = window.XBRIEFS || null;
    const list = (XB && Array.isArray(XB.briefs))
      ? XB.briefs.filter((b) => cleanDisplayText(b.content || "").trim().length >= 40)
      : [];
    if (!list.length) {
      el.innerHTML =
        `<div class="xb-page">` +
        `<div class="xb-hero">
          <div class="xb-hero-top">
            <span class="xb-live">海外市场 · 定时更新</span>
            <span class="xb-hero-sub">AI / 宏观 / 美股 · 每 2 小时筛选</span>
          </div>
          <h1 class="xb-hero-title">外围热点</h1>
          <p class="xb-hero-desc">汇总海外 AI、宏观与市场讨论，过滤喊单和重复噪音。暂无内容，下一期更新后会自动出现。</p>
        </div>` +
        emptyState("暂无外围热点。下一期更新后会自动出现。") +
        `</div>`;
      return;
    }

    const updated = XB.updated || XB.generatedAt || "";
    const totalAi = list.reduce((n, b) => n + (Number(b.aiCount) || 0), 0);
    const totalMkt = list.reduce((n, b) => n + (Number(b.marketCount) || 0), 0);
    const focusN = list.filter((b) => b.hasFocusStock).length;

    const rail = list.map((b, i) => {
      const ft = xbFormatTime(b.time);
      const focus = b.hasFocusStock ? `<span class="xb-dot focus" title="含重点票"></span>` : "";
      return `<button type="button" class="xb-rail-item ${i === 0 ? "active" : ""}" data-i="${i}" aria-label="第 ${i + 1} 期 ${ft.full}">
        <span class="xb-rail-day">${esc(ft.day)}</span>
        <span class="xb-rail-clock">${esc(ft.clock)}</span>
        <span class="xb-rail-meta">
          <span class="xb-pill ai">AI ${b.aiCount || 0}</span>
          <span class="xb-pill mkt">市 ${b.marketCount || 0}</span>
          ${focus}
        </span>
      </button>`;
    }).join("");

    const bodies = list.map((b, i) => {
      const ft = xbFormatTime(b.time);
      const title = `外围热点 · ${ft.day} ${ft.clock}`;
      const searchName = `外围热点 · ${b.time || b.id || b.period || "最新一期"}`;
      return `<article class="xb-article ${i === 0 ? "active" : ""}" data-i="${i}" data-xname="${esc(searchName)}">
        <header class="xb-article-head">
          <div class="xb-article-kicker">
            <span class="xb-badge">第 ${list.length - i} / ${list.length} 期</span>
            <span class="xb-badge soft">${esc(b.period || "近约 2 小时")}</span>
            ${b.hasFocusStock ? `<span class="xb-badge focus">重点票</span>` : ""}
          </div>
          <h2 class="xb-article-title">${esc(title)}</h2>
          <div class="xb-article-meta">
            <span><b>更新时间</b>${esc(ft.full || "—")}</span>
            <span><b>内容</b>AI ${b.aiCount || 0} 条 · 市场 ${b.marketCount || 0} 条</span>
            <span><b>来源</b>X 公开讨论 · 自动去重筛选</span>
          </div>
        </header>
        <div class="xb-article-body rep-md xb-md">${xbMdHtml(b.content || "")}</div>
      </article>`;
    }).join("");

    el.innerHTML = `<div class="xb-page">
      <div class="xb-hero">
        <div class="xb-hero-top">
          <span class="xb-live"><span class="xb-pulse"></span>海外市场 · 持续更新</span>
          <span class="xb-hero-sub">每 2 小时 · 最新一期优先</span>
        </div>
        <h1 class="xb-hero-title">外围热点</h1>
        <p class="xb-hero-desc">聚焦海外 AI、宏观政策与主要市场变化。情绪帖、喊单和重复内容已过滤；未经证实的消息会明确标注。</p>
        <div class="xb-stats">
          <div class="xb-stat"><span class="xb-stat-k">${list.length}</span><span class="xb-stat-l">更新批次</span></div>
          <div class="xb-stat"><span class="xb-stat-k">${totalAi}</span><span class="xb-stat-l">AI 热点</span></div>
          <div class="xb-stat"><span class="xb-stat-k">${totalMkt}</span><span class="xb-stat-l">市场热点</span></div>
          <div class="xb-stat"><span class="xb-stat-k">${focusN}</span><span class="xb-stat-l">涉及重点票</span></div>
          <div class="xb-stat wide"><span class="xb-stat-k mono">${esc(String(updated).slice(5, 16) || "—")}</span><span class="xb-stat-l">最近更新</span></div>
        </div>
      </div>

      <div class="xb-layout">
        <aside class="xb-rail" aria-label="外围热点更新批次">
          <div class="xb-rail-label">选择更新批次</div>
          <div class="xb-rail-list">${rail}</div>
        </aside>
        <div class="xb-main">
          <div class="xb-bodies">${bodies}</div>
          <footer class="xb-foot">
            来源：X 公开讨论 · 自动去重筛选 · 保留约 4 天 · 仅供研究参考，非投资建议
          </footer>
        </div>
      </div>
    </div>`;

    const activate = (i) => {
      el.querySelectorAll(".xb-rail-item").forEach((t) => t.classList.toggle("active", t.dataset.i === i));
      el.querySelectorAll(".xb-article").forEach((d) => d.classList.toggle("active", d.dataset.i === i));
      const main = el.querySelector(".xb-main");
      if (main) main.scrollTop = 0;
    };
    el.querySelectorAll(".xb-rail-item").forEach((btn) =>
      btn.addEventListener("click", () => activate(btn.dataset.i))
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
    let html = "", inTable = false, inList = false, inOl = false;
    const flushList = () => {
      if (inList) { html += "</ul>"; inList = false; }
      if (inOl) { html += "</ol>"; inOl = false; }
    };
    const flushTable = () => { if (inTable) { html += "</tbody></table>"; inTable = false; } };
    // 涨跌着色：单元格里的 +X%/-X% 或 利多/利空 标红绿
    // toneCell: 对已转义的单元格内容着色，只匹配纯文本符号（不含 HTML 标签）
    const toneCell = (c) => c
      .replace(/(\+[\d.]+%)/g, '<span class="up">$1</span>')
      .replace(/(-[\d.]+%)/g, '<span class="down">$1</span>')
      .replace(/(利[多空])/g, (m) => `<span class="${m === "利多" ? "up" : "down"}">${m}</span>`);
    const inlineMd = (c) => c
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    for (let raw of lines) {
      const line = raw.replace(/\r$/, "");
      // 分隔线
      if (/^---+$/.test(line.trim())) { flushList(); flushTable(); continue; }
      // 表格：---|--- 分隔行，跳过；数据行 → <tr><td>
      if (line.includes("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
        if (cells.every((c) => /^:?-+:?$/.test(c))) { if (!inTable) { html += "<table><tbody>"; inTable = true; } continue; }
        if (cells.length) { flushList(); if (!inTable) { html += "<table><tbody>"; inTable = true; } html += "<tr>" + cells.map((c) => `<td>${inlineMd(toneCell(c))}</td>`).join("") + "</tr>"; continue; }
      }
      flushTable();
      // 标题
      const hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) { flushList(); html += `<h${hm[1].length + 2}>${hm[2].trim()}</h${hm[1].length + 2}>`; continue; }
      // 无序列表
      const lm = line.match(/^[-*]\s+(.*)/);
      if (lm) {
        if (inOl) { html += "</ol>"; inOl = false; }
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${lm[1].replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`;
        continue;
      }
      // 有序列表（外围热点主结构：1. **标题**）
      const om = line.match(/^\d+\.\s+(.*)/);
      if (om) {
        if (inList) { html += "</ul>"; inList = false; }
        if (!inOl) { html += '<ol class="xb-ol">'; inOl = true; }
        html += `<li>${om[1].replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`;
        continue;
      }
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

  App.renderLogic = renderLogic;
  App.renderWeekend = renderWeekend;
  App.renderEvents = renderEvents;
  App.renderXBriefs = renderXBriefs;
  if (window.App.start) window.App.start();
})(window.App);
