/* A股盘面 · 左侧导航 14 模块 — 渲染 / 筛选 / 搜索 / 详情抽屉 */
(function () {
  const readabilityCss = document.createElement("style");
  readabilityCss.textContent = `
    html,body,button,input,select,textarea{font-weight:500}
    .rep-md{font-weight:500}
    .rep-time,.rep-updated,.rep-foot,.logo-sub,.bb-hint,.bb-src{font-weight:500}
    .rep-quality{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px;align-items:baseline;margin:0 0 20px;padding:11px 14px;border:1px solid var(--line);border-left-width:4px;border-radius:var(--r-sm);background:var(--card);font-size:13px;line-height:1.65}
    .rep-quality strong{white-space:nowrap}
    .rep-quality.is-partial{border-left-color:var(--warn);background:rgba(196,137,22,.06)}
    .rep-quality.is-complete{border-left-color:var(--ok)}
    @media(max-width:640px){.rep-quality{grid-template-columns:1fr;gap:4px}}
  `;
  document.head.appendChild(readabilityCss);
  let STOCKS = window.STOCKS || [];
  let META = window.META || {};
  let MARKET = window.MARKET || {};
  let HOLDINGS = window.HOLDINGS || null;
  let INDUSTRY = window.INDUSTRY || null;
  let INDUSTRY_MARKET = window.INDUSTRY_MARKET || null;
  let CHAIN = window.CHAIN || null;
  let NEWSALL = window.NEWSALL || null;
  let REPORTS = window.REPORTS || {};
  let HOT = window.HOT || {};

  const state = { sector: "全部", verdict: "all", q: "", sort: "default" };
  const marketState = { anomaly: "gainers", q: "" };
  // 视图滚动位置记忆(A2):curView 跟踪当前视图,viewScroll 存各视图上次 scrollY
  let curView = "home";
  const viewScroll = new Map();
  let drawerReturnFocus = null;
  let searchActiveIndex = -1;
  let searchActiveResults = [];

  const $ = (s) => document.querySelector(s);
  const grid = $("#grid");
  const viewScrollRoot = () => {
    const content = $(".content-in");
    return content && /auto|scroll/.test(getComputedStyle(content).overflowY)
      ? content
      : document.scrollingElement;
  };
  const isLocalServer = () => location.origin === "http://localhost:8787" || location.origin === "http://127.0.0.1:8787";
  const cleanDisplayText = (value) => {
    if (value == null) return "";
    let text = String(value)
      // 这些是采集/分析阶段的内部字段，不应直接出现在阅读界面。
      .replace(/\b(?:thsStrong|thsHot)\b\s*[:：]?\s*/gi, " ")
      .replace(/\bbreak\s*=\s*\d+\s*(?:次)?/gi, " ")
      .replace(/\bconfidence\s*=\s*([\w\u4e00-\u9fff-]+)/gi, "置信度：$1")
      // Hermes 偶尔把生成过程当成报告正文保存；只清理开头，避免误伤正文引用。
      .replace(/^(?:I(?:'ll| will) (?:generate|prepare)[^\n]*|I (?:now )?have all the data[^\n]*|Let me [^\n]*|All data verified[^\n]*|Here(?:'s| is) the [^\n]*|现在我已经(?:获取|掌握)[^\n]*(?:让我来|下面)[^\n]*)\s*(?:\r?\n+|$)/i, "")
      .replace(/[ \t]{2,}/g, " ");

    // 上游摘要截断时，宁可隐藏残片，也不在界面留下半个括号。
    const trimDanglingOpen = (open, close) => {
      const opens = text.split(open).length - 1;
      const closes = text.split(close).length - 1;
      if (opens > closes) {
        const at = text.lastIndexOf(open);
        if (at >= 0 && text.length - at <= 56) text = text.slice(0, at).trimEnd();
      }
    };
    trimDanglingOpen("（", "）");
    trimDanglingOpen("【", "】");
    if (!text.includes("【") && text.includes("】")) text = text.replace(/】/g, "");
    return text;
  };
  const esc = (s) => cleanDisplayText(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => {
    try {
      const url = new URL(String(u), location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };

  let stockReferenceIndex = null;
  function getStockReferenceIndex() {
    if (stockReferenceIndex) return stockReferenceIndex;
    const index = new Map();
    const seen = new WeakSet();
    const add = (item, source) => {
      if (!item || typeof item !== "object") return;
      const code = String(item.code || "").trim();
      if (!/^\d{6}$/.test(code) || !item.name) return;
      const prev = index.get(code) || {};
      index.set(code, {
        ...prev,
        ...item,
        code,
        name: item.name || prev.name,
        _sources: [...new Set([...(prev._sources || []), source].filter(Boolean))],
      });
    };
    const walk = (value, source, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, source, depth + 1));
        return;
      }
      add(value, source);
      Object.values(value).forEach((item) => walk(item, source, depth + 1));
    };
    STOCKS.forEach((s) => add(s, "巨头核心"));
    [
      [MARKET, "市场异动"], [HOT, "今日热点"], [HOLDINGS, "持仓"],
      [window.OPPORTUNITIES, "机会清单"], [window.LOGIC, "逻辑链"],
      [window.CHAIN, "产业链涨价"], [INDUSTRY, "产业雷达"], [window.MATERIALS, "材料涨价"],
      [window.EVENTS, "事件概率"], [window.WEEKEND, "周末发酵"],
    ].forEach(([value, source]) => walk(value, source));
    stockReferenceIndex = index;
    return index;
  }

  /* ---------- 顶栏 / 统计 ---------- */
  function renderMeta() {
    const day = META.signalDate || META.lastUpdated || "—";
    // A3: 数据时效色点。距今天数 ≤1 绿(最新)、2-4 黄(覆盖周末)、>4 红(过期)
    let d = null, cls = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      d = Math.floor((Date.now() - new Date(day + "T00:00:00")) / 86400000);
      cls = d <= 1 ? "ok" : d <= 4 ? "warn" : "bad";
    }
    const tip = d == null ? "" : d <= 1 ? "最新" : d <= 4 ? `${d}天前` : "数据过期";
    $("#updated").innerHTML = `<span class="fresh ${cls}"></span>行情截至 ${esc(day)}${tip ? ` <span class="fresh-tip ${cls}">${tip}</span>` : ""}`;
    const ss = $("#signalStat");
    if (ss) ss.textContent = META.signalStat || "";
    renderMarketSnap();
  }

  // 真实大盘指数行（来自 meta.marketSnapshot，由行情程序写入）
  function renderMarketSnap() {
    const el = $("#marketSnap");
    if (!el) return;
    const ms = META.marketSnapshot;
    const ix = ms && ms.indices;
    if (!ix || !ix.length) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = ix.map((i) => {
      const cls = i.pct > 0 ? "up" : i.pct < 0 ? "down" : "";
      const sign = i.pct > 0 ? "+" : "";
      return `<span class="ix"><span class="ix-n">${esc(i.name)}</span><span class="ix-p">${esc(i.price)}</span><span class="ix-c ${cls}">${sign}${esc(i.pct)}%</span></span>`;
    }).join("") + `<span class="ix-date">截至 ${esc(ms.date || "")} 收盘</span>`;
    renderGauges();
  }

  // 市场情绪仪表盘:打板情绪环形图 + 北向资金流向条
  function renderGauges() {
    const el = $("#marketGauges");
    if (!el) return;
    const MK = window.MARKET || {};
    const sent = MK.sentiment || {};
    const nb = MK.northbound || {};
    if (!sent.zt_count && !nb.total_yi) { el.style.display = "none"; return; }
    el.style.display = "";
    let html = "";
    // 1. 打板情绪环形图(涨停/炸板/跌停 比例)
    if (sent.zt_count != null) {
      const zt = sent.zt_count || 0, zb = sent.zb_count || 0, dt = sent.dt_count || 0;
      const total = zt + zb + dt || 1;
      const r = 16, cx = 20, cy = 20, c = 2 * Math.PI * r;
      const ztPct = zt / total, zbPct = zb / total;
      const ztDash = c * ztPct, zbDash = c * zbPct;
      html += `<div class="gauge">
        <svg class="gauge-ring" viewBox="0 0 40 40">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--up)" stroke-width="5"
            stroke-dasharray="${ztDash} ${c}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--warn)" stroke-width="5"
            stroke-dasharray="${zbDash} ${c}" stroke-dashoffset="${-ztDash}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
        </svg>
        <div class="gauge-label">涨停 <b class="up">${zt}</b></div>
        <div class="gauge-sub">炸${zb} 跌${dt}</div>
      </div>`;
    }
    // 2. 北向资金流向条（NaN/null 都不画）
    if (Number.isFinite(nb.total_yi)) {
      const val = nb.total_yi;
      const cls = val > 0 ? "up" : val < 0 ? "down" : "";
      const sign = val > 0 ? "+" : "";
      const width = Math.min(Math.abs(val) / 100 * 100, 100); // 100亿为满
      const dir = val > 0 ? "right" : "left";
      html += `<div class="gauge gauge-flow">
        <div class="flow-label">北向 <b class="${cls}">${sign}${val}亿</b></div>
        <div class="flow-bar"><div class="flow-fill ${cls}" style="width:${width}%;float:${dir}"></div></div>
      </div>`;
    }
    el.innerHTML = html;
  }

  function renderStats() {
    const c = { 成立: 0, 存疑: 0, 证伪: 0, changed: 0 };
    STOCKS.forEach((s) => {
      const v = s.review?.verdict;
      if (c[v] != null) c[v]++;
      if (isChanged(s)) c.changed++;
    });
    let bull = 0, leftReady = 0, rightReady = 0;
    STOCKS.forEach((s) => {
      const g = s.signal || {};
      if (g.trend === "多头排列") bull++;
      if (/已回踩至逢低区/.test(g.leftState || "")) leftReady++;
      if (/已放量突破|临近突破/.test(g.rightState || "")) rightReady++;
    });
    $("#stats").innerHTML = [
      { k: STOCKS.length, l: "巨头总数", cls: "" },
      { k: c.成立, l: "逻辑成立", cls: "ok" },
      { k: c.存疑, l: "逻辑存疑", cls: "warn" },
      { k: c.changed, l: "今日叙事有变化", cls: "change" },
      { k: bull, l: "技术·多头排列", cls: "ok" },
      { k: leftReady, l: "左侧·已到逢低区", cls: "" },
      { k: rightReady, l: "右侧·突破/临近", cls: "change" },
    ].map((x) => `<div class="stat ${x.cls}"><div class="k">${x.k}</div><div class="l">${x.l}</div></div>`).join("");
  }

  function isChanged(s) {
    const ch = (s.review?.change || "").trim();
    return ch && !/^(无|无变化|无明显变化|—|-)$/.test(ch);
  }

  /* ---------- 板块筛选 ---------- */
  function renderChips() {
    const counts = {};
    STOCKS.forEach((s) => (counts[s.sector] = (counts[s.sector] || 0) + 1));
    // 板块按数量降序，默认只露前 5 个 + "全部"，其余收进「更多」
    const allSectors = Object.entries(counts).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const TOP = 5;
    const top = allSectors.slice(0, TOP);
    const rest = allSectors.slice(TOP);
    const renderChip = (sec) => {
      const n = counts[sec] || 0;
      const active = state.sector === sec ? "active" : "";
      return `<button class="chip ${active}" data-sector="${esc(sec)}">${esc(sec)}<span class="badge">${n}</span></button>`;
    };
    let html = `<button class="chip ${state.sector === "全部" ? "active" : ""}" data-sector="全部">全部<span class="badge">${STOCKS.length}</span></button>`;
    html += top.map(renderChip).join("");
    if (rest.length) {
      const expanded = state._sectorMore ? " expanded" : "";
      html += `<button class="chip sector-more${expanded}" id="sectorMore">更多 ${rest.length}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>`;
      html += `<span class="sector-rest${expanded}">${rest.map(renderChip).join("")}</span>`;
    }
    $("#sectorChips").innerHTML = html;
    $("#sectorChips").querySelectorAll(".chip[data-sector]").forEach((b) =>
      b.addEventListener("click", () => { state.sector = b.dataset.sector; renderChips(); renderWatch(); })
    );
    const more = $("#sectorMore");
    if (more) more.addEventListener("click", () => { state._sectorMore = !state._sectorMore; renderChips(); });
    document.querySelectorAll(".verdict-chip").forEach((b) =>
      b.classList.toggle("active", b.dataset.verdict === state.verdict)
    );
  }

  /* ---------- 主网格 ---------- */
  const isOpportunity = (s) => {
    const g = s.signal || {};
    return /已回踩至逢低区/.test(g.leftState || "") || /已放量突破|临近突破/.test(g.rightState || "");
  };

  // 当前行情日(或之后)补录的新闻条数，用于卡片"新消息"角标
  const latestDay = META.signalDate || META.lastUpdated || "";
  const freshNews = (s) => (s.news || []).filter((n) => n.date && n.date >= latestDay).length;

  function matches(s) {
    if (state.sector !== "全部" && s.sector !== state.sector) return false;
    if (state.verdict === "changed") { if (!isChanged(s)) return false; }
    else if (state.verdict === "opportunity") { if (!isOpportunity(s)) return false; }
    else if (state.verdict === "drawdown") { if (!isDeepDrawdown(s)) return false; }
    else if (state.verdict !== "all" && s.review?.verdict !== state.verdict) return false;
    if (state.q) {
      const hay = [s.name, s.code, s.sector, (s.tags || []).join(" "), s.narrative].join(" ").toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }

  const trendRank = { "多头排列": 2, "震荡": 1, "空头排列": 0 };
  function sortList(list) {
    const by = state.sort;
    if (by === "default") return list;
    const arr = list.slice();
    const g = (s) => s.signal || {};
    if (by === "chg") arr.sort((a, b) => (g(b).chgPct ?? -99) - (g(a).chgPct ?? -99));
    else if (by === "toBreakout") arr.sort((a, b) => (g(a).toBreakoutPct ?? 999) - (g(b).toBreakoutPct ?? 999));
    else if (by === "pullback") arr.sort((a, b) => (g(a).pullbackPct ?? 999) - (g(b).pullbackPct ?? 999));
    else if (by === "drawdown") arr.sort((a, b) => (drawdownPct(g(b)) ?? -1) - (drawdownPct(g(a)) ?? -1));
    else if (by === "trend") arr.sort((a, b) => (trendRank[g(b).trend] ?? -1) - (trendRank[g(a).trend] ?? -1) || (g(b).posPct ?? -99) - (g(a).posPct ?? -99));
    // 「跌超25%」筛选时默认按回撤从深到浅排，方便先看最惨的
    else if (state.verdict === "drawdown") arr.sort((a, b) => (drawdownPct(g(b)) ?? -1) - (drawdownPct(g(a)) ?? -1));
    return arr;
  }

  // 迷你走势图（近60日收盘，颜色随趋势）
  function sparkline(arr, trend) {
    if (!arr || arr.length < 2) return "";
    const w = 100, h = 26, min = Math.min(...arr), max = Math.max(...arr), rng = (max - min) || 1;
    const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - (v - min) / rng * (h - 2) - 1).toFixed(1)}`).join(" ");
    const col = trend === "多头排列" ? "var(--up)" : trend === "空头排列" ? "var(--down)" : "var(--muted)";
    const gid = "sg" + Math.random().toString(36).slice(2, 8);
    // 渐变填充区域:线条下方半透明渐变,顶部连线
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}" stop-opacity=".28"/>
        <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="0,${h} ${pts} ${w},${h}" fill="url(#${gid})"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  const sgn = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
  const pct = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%");  // 主力净流入（亿元，A股惯例：流入为红、流出为绿）
  const fundChip = (s) => {
    const f = s.fund;
    if (!f || f.netInflow == null) return "";
    const n = f.netInflow, cls = n > 0 ? "up" : n < 0 ? "down" : "";
    return `<span class="fund ${cls}" title="主力净流入 · 同花顺问财（${esc(f.date || "")}）">主力 ${n > 0 ? "+" : ""}${n}亿</span>`;
  };
  const trendCls = (t) => (t === "多头排列" ? "t-up" : t === "空头排列" ? "t-down" : "t-flat");
  // 距近 60 日高点的回撤百分比（spark 为 60 日收盘序列）；跌超 25% 需要显式提示
  function drawdownPct(g) {
    const sp = (g && g.spark) || [];
    if (!sp.length || g.price == null) return null;
    const mx = Math.max(...sp, g.price);
    if (!(mx > 0)) return null;
    return ((mx - g.price) / mx) * 100;
  }
  const isDeepDrawdown = (s) => {
    const dd = drawdownPct(s.signal || {});
    return dd != null && dd >= 25;
  };
  const drawdownFlag = (g) => {
    const dd = drawdownPct(g);
    return dd != null && dd >= 25
      ? `<span class="dd-flag" title="现价距近60日最高收盘价回撤 ≥25%">跌超25% · -${dd.toFixed(0)}%</span>`
      : "";
  };
  // 左/右信号状态 → 强度色：可介入=亮，观望/不足=暗
  function stateTone(txt, side) {
    if (!txt) return "";
    if (side === "left") return /已回踩至逢低区/.test(txt) ? "go" : /跌破|转弱/.test(txt) ? "warn" : "wait";
    return /已放量突破/.test(txt) ? "go" : /临近突破/.test(txt) ? "near" : /量能不足/.test(txt) ? "warn" : "wait";
  }

  function card(s, i) {
    const rawVerdict = s.review?.verdict || "—";
    // class 只接受白名单值，防止数据字段破坏 HTML 属性
    const v = /^(成立|存疑|证伪|未跟踪)$/.test(rawVerdict) ? rawVerdict : "—";
    const changed = isChanged(s);
    const g = s.signal || {};
    const feat = isOpportunity(s) ? " feature" : "";
    const featReason = /已回踩至逢低区/.test(g.leftState || "") ? g.leftState : (g.rightState || "信号临近");
    const tags = (s.tags || []).slice(0, 3).map((t) => `<span class="minitag">${esc(t)}</span>`).join("");
    const priceRow = g.price != null ? `
      <div class="px-row">
        <span class="px">¥${g.price}</span>
        <span class="chg ${sgn(g.chgPct)}">${pct(g.chgPct)}</span>
        <span class="trend ${trendCls(g.trend)}">${esc(g.trend)}</span>
        ${drawdownFlag(g)}
        ${sparkline(g.spark, g.trend)}
      </div>` : "";
    // 买点状态：左侧命中/右侧命中/无 → 一句话
    const leftHit = /已回踩至逢低区/.test(g.leftState || "");
    const rightHit = /已放量突破|临近突破/.test(g.rightState || "");
    const hitTag = leftHit ? `<span class="hit-tag left-hit">左侧逢低</span>` : rightHit ? `<span class="hit-tag right-hit">右侧突破</span>` : "";
    return `<article class="card v-${v}${feat}" data-code="${esc(s.code)}" role="button" tabindex="0" aria-label="打开 ${esc(s.name)} ${esc(s.code)} 详情" style="--i:${i ?? 0}">
      <div class="card-head">
        <div class="name-wrap">
          <span class="name">${esc(s.name)}</span>
          <span class="code">${esc(s.code)} · <span class="sector-tag">${esc(s.sector)}</span></span>
        </div>
        <span class="verdict-badge ${v}">${esc(rawVerdict)}</span>
      </div>
      ${priceRow}
      <div class="card-hit">${hitTag}${hitTag ? ` <span class="hit-detail">${esc(featReason)}</span>` : `<span class="hit-detail">${esc(g.leftState || g.rightState || "暂无买点信号")}</span>`}</div>
      <div class="card-more">
        <p class="narrative">${esc(s.narrative)}</p>
        <div class="plans">
          <div class="plan left">
            <div class="ptitle">◂ 左侧 · 逢低</div>
            <div class="zone">${esc(s.left?.zone || "—")}</div>
            <div class="pstate ${stateTone(g.leftState, "left")}">${esc(g.leftState || s.left?.trigger || "")}</div>
          </div>
          <div class="plan right">
            <div class="ptitle">右侧 · 突破 ▸</div>
            <div class="zone">${esc(s.right?.zone || "—")}</div>
            <div class="pstate ${stateTone(g.rightState, "right")}">${esc(g.rightState || s.right?.trigger || "")}</div>
          </div>
        </div>
        <div class="card-foot">
          <div class="tagrow">${tags}</div>
          ${fundChip(s)}
          ${freshNews(s) ? `<span class="news-flag">新消息 ${freshNews(s)}</span>` : ""}
        </div>
      </div>
      <div class="card-expand">展开详情 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></div>
    </article>`;
  }

  function renderWatch() {
    const list = sortList(STOCKS.filter(matches));
    grid.innerHTML = list.length ? list.map((s, i) => card(s, i)).join("") : `<div class="empty">没有匹配的标的，调整筛选试试。</div>`;
    grid.querySelectorAll(".card").forEach((el) => {
      // 点「展开详情」：折叠/展开卡片正文（不跳抽屉）
      const expand = el.querySelector(".card-expand");
      if (expand) expand.addEventListener("click", (e) => {
        e.stopPropagation();
        el.classList.toggle("expanded");
        expand.classList.toggle("open");
      });
      // 点卡片其他区域：打开详情抽屉
      el.addEventListener("click", () => openDrawer(el.dataset.code));
      el.addEventListener("keydown", (e) => {
        if (e.target !== el || !["Enter", " "].includes(e.key)) return;
        e.preventDefault();
        openDrawer(el.dataset.code);
      });
    });
    $("#count").textContent = `显示 ${list.length} / ${STOCKS.length} 只`;
  }

  /* ---------- 详情抽屉 ---------- */
  function liList(arr, cls) {
    if (!arr || !arr.length) return `<div class="li" style="color:var(--dim);border:none">暂无</div>`;
    return arr.map((x) => `<div class="li ${cls || ""}">${esc(x)}</div>`).join("");
  }

  function newsList(arr) {
    if (!arr || !arr.length) return `<div class="li" style="color:var(--dim);border:none">暂无记录。行情刷新（GitHub Actions）会自动补录同花顺问财新闻。</div>`;
    return `<div class="newsfeed">${arr.map((it) => {
      // 兼容两种来源：问财(title/source/url) 与 复盘Agent(text/type/impact)
      const title = it.title || it.text || "";
      const imp = it.impact;
      const impCls = imp === "利好" ? "up" : imp === "利空" ? "down" : "flat";
      const impTag = imp ? `<span class="nf-imp ${impCls}">${esc(imp)}</span>` : "";
      const src = it.source ? `<span class="nf-type">${esc(it.source)}</span>` : (it.type ? `<span class="nf-type">${esc(it.type)}</span>` : "");
      const conf = it.confirmed === false ? `<span class="nf-unconf">未证实</span>` : "";
      const url = safeUrl(it.url);
      const body = url
        ? `<a class="nf-text nf-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a>`
        : `<div class="nf-text">${esc(title)}</div>`;
      return `<div class="nf-item">
        <div class="nf-meta"><span class="nf-date">${esc(it.date || "")}</span>${src}${impTag}${conf}</div>
        ${body}
        ${it.priceReaction ? `<div class="nf-px">量价：${esc(it.priceReaction)}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function researchList(arr) {
    if (!arr || !arr.length) return `<div class="li" style="color:var(--dim);border:none">暂无研报。</div>`;
    return `<div class="research-list">${arr.map((r) => {
      const rt = r.rating || "";
      const rcls = /买入|强烈推荐|增持|推荐|跑赢/.test(rt) ? "buy" : /卖出|减持|跑输/.test(rt) ? "sell" : "hold";
      return `<div class="rp-item">
        <div class="rp-meta">${rt ? `<span class="rp-rating ${rcls}">${esc(rt)}</span>` : ""}<span class="rp-org">${esc(r.org || "")}</span><span class="rp-date">${esc(r.date || "")}</span></div>
        <div class="rp-title">${esc(r.title || "")}</div>
      </div>`;
    }).join("")}</div>`;
  }

  function showDrawer() {
    const drawer = $("#drawer");
    if (!drawer.classList.contains("show") && document.activeElement instanceof HTMLElement) {
      drawerReturnFocus = document.activeElement;
    }
    document.body.style.overflow = "hidden";
    drawer.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    $("#backdrop").classList.add("show");
    $("#dclose")?.addEventListener("click", closeDrawer);
    requestAnimationFrame(() => $("#dclose")?.focus());
  }

  // 抽屉公共头部(两套渲染共用,保留 id=drawerTitle / id=dclose 供 showDrawer 绑定)
  const drawerHeadHtml = (name, code, sub, badgeHtml = "") => `
      <div class="dh">
        <div>
          <div class="dname" id="drawerTitle">${esc(name)} ${badgeHtml}</div>
          <div class="dcode">${esc(code)} · ${esc(sub)}</div>
        </div>
        <button class="dclose" id="dclose" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>`;

  // 统一入口:自选股走叙事版,非自选走轻量版,都找不到给提示
  function openDrawer(code) {
    const s = STOCKS.find((x) => x.code === code);
    if (s) return renderWatchDrawer(s);
    const m = findMarketStock(code);
    if (m) return renderMarketDrawer(m);
    portfolioToast(`暂未找到股票 ${code} 的详情数据`, "error");
  }

  // 从 MARKET 各池里找这只票(含龙虎榜 + 全局引用索引)
  function findMarketStock(code) {
    const pools = ["topGainers","topLosers","topTurnover","topInflow","topOutflow",
                   "limitUp","limitDown","brokeUp","hotRank"];
    for (const p of pools) {
      const found = (MARKET[p] || []).find((x) => x.code === code);
      if (found) return found;
    }
    const dt = ((MARKET.dragonTiger && MARKET.dragonTiger.stocks) || []).find((x) => x.code === code);
    if (dt) return dt;
    return getStockReferenceIndex().get(String(code)) || null;
  }

  function renderWatchDrawer(s) {
    const r = s.review || {};
    const hist = (s.history || []);
    const g = s.signal || {};
    const maCell = (lab, val) => `<div class="mc"><span class="ml">${lab}</span><span class="mv">${val == null ? "—" : val}</span></div>`;
    const sigBlock = g.price != null ? `
      <div class="dsec">
        <h3>技术信号 · 真实行情（截至 ${esc(g.date || "")}）</h3>
        <div class="sig-top">
          <span class="sig-px">¥${g.price}</span>
          <span class="chg ${sgn(g.chgPct)}">${pct(g.chgPct)}</span>
          <span class="trend ${trendCls(g.trend)}">${esc(g.trend)}</span>
          ${drawdownFlag(g)}
          <span class="sig-pos">距MA60 ${g.posPct == null ? "—" : (g.posPct > 0 ? "+" : "") + g.posPct + "%"}</span>
          <span class="sig-pos">量比 ${g.volRatio ?? "—"}</span>
        </div>
        <div class="spark-lg">${sparkline(g.spark, g.trend)}<span class="spark-cap">近60日走势</span></div>
        <div class="ma-grid">
          ${maCell("MA5", g.ma5)}${maCell("MA10", g.ma10)}${maCell("MA20", g.ma20)}
          ${maCell("MA60", g.ma60)}${maCell("MA120", g.ma120)}${maCell("MA250", g.ma250)}
          ${maCell("20日高", g.high20)}${maCell("20日低", g.low20)}
          ${maCell("60日高", g.high60)}${maCell("60日低", g.low60)}
          ${maCell("突破位", g.breakout)}${maCell("ATR", g.atr)}
        </div>
        <div class="sig-states">
          <div class="ss left"><span class="sl">◂ 左侧</span><b class="${stateTone(g.leftState,"left")}">${esc(g.leftState || "—")}</b></div>
          <div class="ss right"><span class="sl">右侧 ▸</span><b class="${stateTone(g.rightState,"right")}">${esc(g.rightState || "—")}</b></div>
        </div>
        <div class="risk-row">
          ${maCell("左侧止损", g.leftStop == null ? "—" : "¥" + g.leftStop)}
          ${maCell("左侧目标", g.leftTarget == null ? "—" : "¥" + g.leftTarget)}
          ${maCell("盈亏比", g.leftRR == null ? "—" : g.leftRR)}
          ${maCell("右侧止损", g.rightStop == null ? "—" : "¥" + g.rightStop)}
        </div>
        ${s.fund ? `<div class="fund-row">
          <span class="fr-lab">主力资金（同花顺 ${esc(s.fund.date || "")}）</span>
          <span class="fr-val ${s.fund.netInflow > 0 ? "up" : s.fund.netInflow < 0 ? "down" : ""}">净流入 ${s.fund.netInflow == null ? "—" : (s.fund.netInflow > 0 ? "+" : "") + s.fund.netInflow + " 亿"}</span>
          <span class="fr-val">换手 ${s.fund.turnover == null ? "—" : s.fund.turnover + "%"}</span>
        </div>` : ""}
      </div>` : "";
    $("#drawerInner").innerHTML = `
      ${drawerHeadHtml(s.name, s.code, s.sector, `<span class="verdict-badge ${esc(r.verdict)}">${esc(r.verdict || "—")}</span>`)}

      ${sigBlock}

      ${s.valuation ? `<div class="dsec">
        <h3>估值面板 <span class="src-note">机构一致预期 · ${esc(s.valuation.asof || "")}</span></h3>
        <div class="val-grid">
          <div class="vm"><span class="vm-l">PE(TTM)</span><span class="vm-v">${s.valuation.pe_ttm == null ? "—" : s.valuation.pe_ttm.toFixed(1)}</span></div>
          <div class="vm"><span class="vm-l">前向PE</span><span class="vm-v">${s.valuation.pe_fwd == null ? "—" : s.valuation.pe_fwd.toFixed(1)}</span></div>
          <div class="vm"><span class="vm-l">PEG</span><span class="vm-v ${s.valuation.peg != null && s.valuation.peg < 1 ? "up" : s.valuation.peg != null && s.valuation.peg > 2 ? "down" : ""}">${s.valuation.peg == null ? "—" : s.valuation.peg.toFixed(2)}</span></div>
          <div class="vm"><span class="vm-l">PB</span><span class="vm-v">${s.valuation.pb == null ? "—" : s.valuation.pb.toFixed(2)}</span></div>
          <div class="vm"><span class="vm-l">总市值</span><span class="vm-v">${s.valuation.mcap_yi == null ? "—" : s.valuation.mcap_yi.toFixed(0) + "亿"}</span></div>
          <div class="vm"><span class="vm-l">今年EPS</span><span class="vm-v">${s.valuation.eps_cur == null ? "—" : s.valuation.eps_cur.toFixed(2)}</span></div>
          <div class="vm"><span class="vm-l">明年EPS</span><span class="vm-v">${s.valuation.eps_next == null ? "—" : s.valuation.eps_next.toFixed(2)}</span></div>
          <div class="vm"><span class="vm-l">覆盖机构</span><span class="vm-v">${s.valuation.analyst_count == null ? "—" : s.valuation.analyst_count + "家"}</span></div>
        </div>
      </div>` : ""}

      <div class="dsec">
        <h3>叙事逻辑</h3>
        <p class="dnarr">${esc(s.narrative)}</p>
      </div>

      <div class="dsec">
        <h3>上涨驱动</h3>
        <div class="chips-list">${(s.drivers || []).map((d) => `<span class="c">${esc(d)}</span>`).join("") || '<span class="c">—</span>'}</div>
      </div>

      <div class="dsec">
        <h3>买入计划</h3>
        <div class="dplans">
          <div class="dplan left">
            <div class="pt">◂ 左侧 · 逢低承接</div>
            <div class="pz">${esc(s.left?.zone || "—")}</div>
            <div class="pl"><b>触发：</b>${esc(s.left?.trigger || "—")}<br><b>逻辑：</b>${esc(s.left?.logic || "—")}</div>
          </div>
          <div class="dplan right">
            <div class="pt">右侧 · 突破跟进 ▸</div>
            <div class="pz">${esc(s.right?.zone || "—")}</div>
            <div class="pl"><b>触发：</b>${esc(s.right?.trigger || "—")}<br><b>逻辑：</b>${esc(s.right?.logic || "—")}</div>
          </div>
        </div>
      </div>

      <div class="dsec">
        <h3>今日复盘 · ${esc(r.date || "—")}</h3>
        <div class="review-now">
          <div class="rn-head"><span class="verdict-badge ${esc(r.verdict)}">${esc(r.verdict || "—")}</span><span class="rn-date">${esc(r.date || "")}</span></div>
          <div class="rn-row"><span class="lab">逻辑变化：</span>${esc(r.change || "无明显变化")}</div>
          <div class="rn-row rumor"><span class="lab">传闻：</span>${esc(r.rumors || "无")}</div>
          <div class="rn-row grow"><span class="lab">新变化点：</span>${esc(r.newPoints || "无")}</div>
        </div>
      </div>

      <div class="dsec">
        <h3>新闻 / 传闻 流水 <span class="src-note">同花顺问财 · 自动</span></h3>
        ${newsList(s.news)}
      </div>

      <div class="dsec">
        <h3>机构研报 <span class="src-note">同花顺问财 · 自动</span></h3>
        ${researchList(s.research)}
      </div>

      <div class="dsec">
        <h3>证伪条件（逻辑被打破的信号）</h3>
        ${liList(s.falsify, "bad")}
      </div>

      <div class="dsec">
        <h3>潜在新增长点</h3>
        ${liList(s.growthPoints, "grow")}
      </div>

      <div class="dsec">
        <h3>需盯的传闻 / 催化</h3>
        ${liList(s.watch, "")}
      </div>

      <div class="dsec">
        <h3>复盘历史</h3>
        ${hist.length ? `<div class="timeline">${hist.map((h) => `
          <div class="tl-item ${esc(h.verdict)}">
            <div class="tl-date">${esc(h.date)} · ${esc(h.verdict)}</div>
            <div class="tl-body">${esc([h.change, h.rumors && ("传闻：" + h.rumors), h.newPoints && ("新点：" + h.newPoints)].filter(Boolean).join("　|　") || "—")}</div>
          </div>`).join("")}</div>` : `<div class="li" style="color:var(--dim);border:none">暂无历史记录，每日复盘后自动累积。</div>`}
      </div>
    `;
    showDrawer();
  }

  function closeDrawer() {
    const drawer = $("#drawer");
    const wasOpen = drawer.classList.contains("show");
    drawer.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    $("#backdrop").classList.remove("show");
    document.body.style.overflow = "";          // A1: 关闭恢复背景滚动
    if (wasOpen && drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }

  /* ---------- 全市场异动视图 ---------- */
  // 异动类型 → 对应数据源 + 卡片字段适配
  const ANOMALY_DEFS = {
    gainers:     { key: "topGainers",  title: "涨幅 TOP50",     field: "chgPct",   fmt: "pct" },
    losers:      { key: "topLosers",   title: "跌幅 TOP50",     field: "chgPct",   fmt: "pct" },
    turnover:    { key: "topTurnover", title: "换手率 TOP50",    field: "turnover", fmt: "pct0" },
    inflow:      { key: "topInflow",   title: "主力净流入 TOP50", field: "netInflow", fmt: "yi" },
    outflow:     { key: "topOutflow",  title: "主力净流出 TOP50", field: "netInflow", fmt: "yi" },
    limitUp:     { key: "limitUp",     title: "涨停池",          field: "lbc",      fmt: "lbc", pool: true },
    limitDown:   { key: "limitDown",   title: "跌停池",          field: "dt_days",  fmt: "days", pool: true },
    brokeUp:     { key: "brokeUp",     title: "炸板池",          field: "break_times", fmt: "times", pool: true },
    hotRank:     { key: "hotRank",     title: "东财人气榜 TOP50", field: "rank",    fmt: "rank" },
    dragonTiger: { key: "dt_stocks",   title: "龙虎榜",          field: "net_buy_wan", fmt: "wan" },
  };

  // 异动轻量卡(只有行情+板块+资金流,无叙事/左右计划)
  function marketCard(m, def) {
    const code = m.code || "";
    const name = m.name || "—";
    const price = m.price != null ? `¥${m.price}` : "—";
    // 涨停/跌停/炸板池的涨跌幅字段是 pct，其余池是 chgPct
    const chg = m.chgPct ?? m.pct;
    const chgCls = sgn(chg);
    // 高亮字段
    let hl = "";
    if (def.fmt === "pct" || def.fmt === "pct0") {
      const v = def.field === "chgPct" ? chg : m[def.field];
      hl = v != null ? `<span class="mc-hl ${sgn(v)}">${def.field === "chgPct" ? pct(v) : v.toFixed(2) + "%"}</span>` : "";
    } else if (def.fmt === "yi") {
      const v = m.netInflow;
      const yi = v != null ? v / 1e8 : null;
      hl = yi != null ? `<span class="mc-hl ${sgn(yi)}">主力 ${yi > 0 ? "+" : ""}${yi.toFixed(2)}亿</span>` : "";
    } else if (def.fmt === "lbc") {
      const lb = m.lbc || m.limit_days;
      hl = lb ? `<span class="mc-hl up">${lb}连板</span>` : `<span class="mc-hl">首板</span>`;
    } else if (def.fmt === "days") {
      const d = m.dt_days || 1;
      hl = `<span class="mc-hl down">${d}日跌停</span>`;
    } else if (def.fmt === "times") {
      const t = m.break_times || 0;
      hl = `<span class="mc-hl warn">炸${t}次</span>`;
    } else if (def.fmt === "rank") {
      hl = `<span class="mc-hl">#${m.rank}</span>`;
    } else if (def.fmt === "wan") {
      const w = m.net_buy_wan;
      hl = w != null ? `<span class="mc-hl ${sgn(w)}">净买 ${w.toFixed(0)}万</span>` : "";
    }
    const industry = m.industry ? `<span class="mc-sec">${esc(typeof m.industry === "string" ? m.industry : (m.industry || []).join("/"))}</span>` : "";
    const turnover = m.turnover != null ? `<span class="mc-mini">换手${m.turnover.toFixed(1)}%</span>` : "";
    const ztStat = m.zt_stat ? `<span class="mc-mini">${esc(m.zt_stat)}</span>` : "";
    const reason = m.reason ? `<div class="mc-reason">${esc(m.reason)}</div>` : "";
    // 龙虎榜特殊:reason 字段
    const dtReason = m.reason ? `<div class="mc-reason">${esc(m.reason)}</div>` : "";
    return `<article class="market-card ${chgCls}" data-code="${esc(code)}" role="button" tabindex="0" aria-label="打开 ${esc(name)} ${esc(code)} 详情">
      <div class="mc-head">
        <span class="mc-name">${esc(name)}</span>
        <span class="mc-code">${esc(code)}</span>
        ${industry}
      </div>
      <div class="mc-px">
        <span class="mc-price">${price}</span>
        ${chg != null ? `<span class="chg ${chgCls}">${pct(chg)}</span>` : ""}
        ${hl}
      </div>
      <div class="mc-meta">${turnover}${ztStat}</div>
      ${reason || dtReason}
    </article>`;
  }

  // 打板情绪条(炸板率/连板梯队/北向)
  function renderSentiment() {
    const el = $("#sentimentBar");
    if (!el) return;
    const s = MARKET.sentiment || {};
    const nb = MARKET.northbound;
    const ladder = s.ladder || {};
    const ladHtml = Object.entries(ladder)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([k, v]) => `<span class="lad-item"><span class="lad-h">${k}板</span><span class="lad-n">${v}</span></span>`).join("");
    el.innerHTML = `
      <div class="sent-group">
        <span class="sent-label">打板情绪</span>
        <span class="sent-val up">涨停 ${s.zt_count ?? "—"}</span>
        <span class="sent-val warn">炸板 ${s.zb_count ?? "—"}</span>
        <span class="sent-val down">跌停 ${s.dt_count ?? "—"}</span>
        <span class="sent-val">炸板率 ${s.break_rate ?? "—"}%</span>
        <span class="sent-val">最高 ${s.max_height ?? "—"}连板</span>
      </div>
      <div class="sent-group lad">${ladHtml ? `<span class="sent-label">连板梯队</span>${ladHtml}` : ""}</div>
      ${nb && Number.isFinite(nb.total_yi) ? `<div class="sent-group"><span class="sent-label">北向资金</span><span class="sent-val ${sgn(nb.total_yi)}">净${nb.total_yi > 0 ? "流入" : "流出"} ${Math.abs(nb.total_yi).toFixed(2)}亿</span><span class="sent-mini">沪${(Number.isFinite(nb.hgt_yi) ? nb.hgt_yi : 0).toFixed(2)} 深${(Number.isFinite(nb.sgt_yi) ? nb.sgt_yi : 0).toFixed(2)}</span></div>` : ""}
      <div class="sent-date">数据时点 ${esc(MARKET.date || "")}</div>
    `;
  }

  function renderMarket() {
    renderSentiment();
    const el = $("#marketGrid");
    if (!el) return;
    const def = ANOMALY_DEFS[marketState.anomaly] || ANOMALY_DEFS.gainers;
    // 龙虎榜数据在 dragonTiger.stocks
    let list;
    if (marketState.anomaly === "dragonTiger") {
      list = (MARKET.dragonTiger && MARKET.dragonTiger.stocks) || [];
    } else {
      list = MARKET[def.key] || [];
    }
    // 搜索过滤
    if (marketState.q) {
      const q = marketState.q.toLowerCase();
      list = list.filter((m) => [m.name, m.code, m.industry, m.reason].filter(Boolean).join(" ").toLowerCase().includes(q));
    }
    // 截断到前 60 张卡(避免卡顿)
    const shown = list.slice(0, 60);
    el.innerHTML = shown.length
      ? shown.map((m) => marketCard(m, def)).join("")
      : `<div class="empty">该异动类型暂无数据(非交易日或盘后未更新)。</div>`;
    el.querySelectorAll(".market-card").forEach((c) => {
      c.addEventListener("click", () => openDrawer(c.dataset.code));
      c.addEventListener("keydown", (e) => {
        if (e.target !== c || !["Enter", " "].includes(e.key)) return;
        e.preventDefault();
        openDrawer(c.dataset.code);
      });
    });
    const count = $("#count");
    if (count) count.textContent = `${def.title} · 显示 ${shown.length} / ${list.length} 只`;
  }

  // 非自选票详情抽屉(轻量版:行情 + 关联信息 + 说明;自选股由 openDrawer 路由转 renderWatchDrawer)
  function renderMarketDrawer(m) {
    const chg = m.chgPct ?? m.pct;
    const industry = typeof m.industry === "string" ? m.industry : (m.industry || []).join("/");
    const netflow = m.netInflow != null ? m.netInflow / 1e8 : null;
    $("#drawerInner").innerHTML = `
      ${drawerHeadHtml(m.name, m.code, industry || (m._sources || []).join(" / ") || "分析模块关联标的", m.lbc ? `<span class="mc-hl up">${m.lbc}连板</span>` : "")}
      ${(m.price != null || chg != null || m.turnover != null || netflow != null) ? `<div class="dsec">
        <h3>实时行情 <span class="src-note">东财 · ${esc(MARKET.date || "")}</span></h3>
        <div class="sig-top">
          <span class="sig-px">¥${m.price ?? "—"}</span>
          ${chg != null ? `<span class="chg ${sgn(chg)}">${pct(chg)}</span>` : ""}
          ${m.turnover != null ? `<span class="sig-pos">换手 ${m.turnover.toFixed(2)}%</span>` : ""}
          ${m.volumeRatio != null ? `<span class="sig-pos">量比 ${m.volumeRatio}</span>` : ""}
          ${m.amplitude != null ? `<span class="sig-pos">振幅 ${m.amplitude.toFixed(2)}%</span>` : ""}
        </div>
        ${netflow != null ? `<div class="fund-row"><span class="fr-lab">主力净流入</span><span class="fr-val ${sgn(netflow)}">${netflow > 0 ? "+" : ""}${netflow.toFixed(2)} 亿</span></div>` : ""}
        ${m.mcap_yi != null ? `<div class="fund-row"><span class="fr-lab">总市值</span><span class="fr-val">${m.mcap_yi.toFixed(0)} 亿</span></div>` : ""}
        ${m.zt_stat ? `<div class="fund-row"><span class="fr-lab">连板</span><span class="fr-val">${esc(m.zt_stat)}</span></div>` : ""}
        ${m.first_seal ? `<div class="fund-row"><span class="fr-lab">封板时间</span><span class="fr-val">${esc(m.first_seal)}</span></div>` : ""}
      </div>` : ""}
      ${m.reason || m.role || m.detail || m.impact || m.position ? `<div class="dsec"><h3>关联信息</h3><p class="dnarr">${esc([m.reason, m.role, m.detail, m.impact, m.position].filter(Boolean).join(" · "))}</p></div>` : ""}
      <div class="dsec">
        <h3>说明</h3>
        <p class="dnarr" style="color:var(--muted)">此股票来自${esc((m._sources || ["市场异动"]).join("、"))}，不是巨头核心自选；当前仅展示已有的轻量信息。</p>
      </div>
    `;
    showDrawer();
  }

  /* ---------- 今日热点 TOP30 ---------- */

  function hotCard(h) {
    const chgCls = sgn(h.chgPct);
    const netCls = h.netInflow > 0 ? "up" : h.netInflow < 0 ? "down" : "";
    const concepts = (h.concepts || []).slice(0, 6).map((c) => `<span class="hc-chip">${esc(c)}</span>`).join("");
    const boards = h.boards > 0 ? `<span class="hc-board">${h.boards}连板</span>` : "";
    const news = (h.news || []).slice(0, 2).map((n) => {
      const url = safeUrl(n.url);
      return url ? `<a class="hc-news" href="${esc(url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`
                 : `<span class="hc-news">${esc(n.title)}</span>`;
    }).join("");
    const metric = (lab, val) => `<div class="hm"><span class="hm-l">${lab}</span><span class="hm-v">${val}</span></div>`;
    return `<article class="hotcard">
      <div class="hc-head">
        <span class="hc-rank">${h.rank}</span>
        <div class="hc-name-wrap">
          <span class="hc-name">${esc(h.name)}</span>
          <span class="hc-code">${esc(h.code)}${h.board ? " · " + esc(h.board) : ""}${Array.isArray(h.industry) && h.industry.length ? " · " + esc(h.industry.join("/")) : (typeof h.industry === "string" && h.industry ? " · " + esc(h.industry) : "")}</span>
        </div>
        <div class="hc-px">
          <span class="hc-price">¥${h.price ?? "—"}</span>
          <span class="chg ${chgCls}">${pct(h.chgPct)}</span>
          ${boards}
        </div>
      </div>
      <div class="hc-metrics">
        ${metric("人气热度", h.heat != null ? (h.heat / 10000).toFixed(0) + "万" : "—")}
        ${metric("换手", h.turnover != null ? h.turnover + "%" : "—")}
        ${metric("量比", h.volRatio ?? "—")}
        ${metric("振幅", h.amplitude != null ? h.amplitude + "%" : "—")}
        ${metric("主力净流入", `<span class="${netCls}">${h.netInflow != null ? (h.netInflow > 0 ? "+" : "") + h.netInflow + "亿" : "—"}</span>`)}
        ${metric("流通市值", h.floatCap != null ? h.floatCap + "亿" : "—")}
      </div>
      <div class="hc-concepts">${concepts || '<span class="hc-chip">—</span>'}</div>
      <div class="hc-analysis">
        <div class="hc-line"><span class="hc-tag theme">炒作题材</span><span class="hc-txt">${esc(h.reason || "—")}</span></div>
        <div class="hc-line"><span class="hc-tag tech">技术面</span><span class="hc-txt">${esc(h.tech || "—")}</span></div>
        <div class="hc-line"><span class="hc-tag senti">情绪面</span><span class="hc-txt">${esc(h.senti || "—")}</span></div>
      </div>
      ${news ? `<div class="hc-newsrow">${news}</div>` : ""}
    </article>`;
  }

  function renderHot() {
    const list = HOT.list || [];
    const el = $("#hotList");
    if (!el) return;
    el.innerHTML = list.length
      ? list.map(hotCard).join("")
      : `<div class="empty">热点数据待生成（每日收盘后由问财自动更新）。</div>`;
  }

  // 13 个模块的视图切换 + 懒渲染调度
  const VIEW_RENDER = {
    home: () => renderHome(),
    holdings: () => App.renderHoldings(),
    opportunities: () => App.renderOpportunities(),
    logic: () => App.renderLogic(),
    agent: () => App.renderReports(),
    chain: () => App.renderChain(),
    weekend: () => App.renderWeekend(),
    events: () => App.renderEvents(),
    news: () => App.renderNewsAll(),
    watch: () => renderWatch(),
    market: () => renderMarket(),
    hot: () => renderHot(),
  };
  const VIEW_TITLES = {
    home: "首页",
    holdings: "持仓决策",
    watch: "巨头核心",
    opportunities: "机会清单",
    logic: "逻辑链",
    market: "市场异动",
    hot: "今日热点",
    news: "新闻",
    events: "事件概率",
    agent: "AI 复盘",
    chain: "产业链涨价",
    weekend: "周末发酵",
  };
  function viewFromHash() {
    try {
      const value = decodeURIComponent(location.hash.replace(/^#/, "").split("/")[0]).trim();
      return VIEW_RENDER[value] ? value : "home";
    } catch {
      return "home";
    }
  }
  function syncViewLocation(view, replace = false) {
    const hash = `#${view}`;
    if (location.hash === hash) return;
    history[replace ? "replaceState" : "pushState"](null, "", hash);
  }
  function switchView(view, options = {}) {
    if (!VIEW_RENDER[view]) view = "home";
    // A2: 切走前记住当前视图滚动位置
    viewScroll.set(curView, viewScrollRoot()?.scrollTop || 0);
    // 清掉所有 view-* class,再设当前
    [...document.body.classList].forEach((c) => { if (c.startsWith("view-")) document.body.classList.remove(c); });
    document.body.classList.add("view-" + view);
    document.querySelectorAll(".nav-item").forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle("active", active);
      // aria-current 只标在侧栏导航上;底部 tabbar 是同一导航的副本,避免页面出现多个 current
      if (active && !b.classList.contains("tab-item")) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    // 懒渲染:切到该视图才调对应 render(已有数据则重渲染,无数据则显示待生成)
    const fn = VIEW_RENDER[view];
    if (fn) { try { Promise.resolve(fn()).catch((e) => console.warn("render " + view + " failed", e)); } catch (e) { console.warn("render " + view + " failed", e); } }
    // 移动端:切完关侧栏
    document.body.classList.remove("sidebar-open");
    // A2: 恢复该视图上次滚动位置;首次访问回顶(与原行为一致)
    const scrollRoot = viewScrollRoot();
    if (scrollRoot) scrollRoot.scrollTop = viewScroll.get(view) ?? 0;
    curView = view;
    document.title = `${VIEW_TITLES[view] || "A股看板"} · A股盘面`;
    if (options.syncHash !== false) syncViewLocation(view, Boolean(options.replaceHash));
  }
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );
  window.addEventListener("hashchange", () => switchView(viewFromHash(), { syncHash: false }));
  // 汉堡菜单(移动端)
  const mt = $("#menuToggle");
  if (mt) mt.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  // 底部导航「更多」(移动端):同样开合侧栏抽屉
  const tm = $("#tabMore");
  if (tm) tm.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  const sb = $("#sidebarBackdrop");
  if (sb) sb.addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  /* ---------- 事件 ---------- */
  $("#backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    const drawer = $("#drawer");
    if (e.key === "Tab" && drawer?.classList.contains("show")) {
      const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hidden && el.getClientRects().length);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    if (e.key === "Escape") {
      closeSearchPanel();
      closeDrawer();
    }
    if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      $("#globalSearchInput")?.focus();
    }
  });
  const gsInput = $("#globalSearchInput");
  if (gsInput) {
    // 搜索面板即时响应；网格重渲染防抖，避免每个按键全量重建卡片
    let gridFilterTimer = null;
    gsInput.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      state.q = q;
      marketState.q = q;
      renderGlobalSearch(q);
      clearTimeout(gridFilterTimer);
      gridFilterTimer = setTimeout(() => {
        if (curView === "watch") renderWatch();
        if (curView === "market") renderMarket();
      }, 200);
    });
    gsInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setSearchActiveIndex(searchActiveIndex + delta);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = searchActiveResults[searchActiveIndex] || searchResults(gsInput.value)[0];
        if (item) activateSearchResult(item);
      }
    });
    document.addEventListener("click", (e) => {
      if (!$("#globalSearch")?.contains(e.target)) closeSearchPanel();
    });
  }
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderWatch(); });
  document.querySelectorAll(".verdict-chip").forEach((b) =>
    b.addEventListener("click", () => { state.verdict = b.dataset.verdict; renderChips(); renderWatch(); })
  );
  document.querySelectorAll(".anomaly-chip").forEach((b) =>
    b.addEventListener("click", () => {
      marketState.anomaly = b.dataset.anomaly;
      document.querySelectorAll(".anomaly-chip").forEach((c) => c.classList.toggle("active", c === b));
      renderMarket();
    })
  );

  // 密度切换（紧凑/标准，localStorage 持久化）
  const savedDensity = localStorage.getItem("density") || "compact";
  document.body.classList.add("density-" + savedDensity);
  document.querySelectorAll(".density-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.density === savedDensity);
    b.addEventListener("click", () => {
      const d = b.dataset.density;
      document.body.classList.remove("density-compact", "density-standard");
      document.body.classList.add("density-" + d);
      localStorage.setItem("density", d);
      document.querySelectorAll(".density-btn").forEach((c) => c.classList.toggle("active", c === b));
    });
  });

  // 状态栏 + 命令栏（终端风格）
  const sbDateTime = $("#sbDateTime");
  const sbMarket = $("#sbMarket");
  const sbData = $("#sbData");
  const bbClock = $("#bbClock");

  const isTrading = (d) => {
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    const mins = d.getHours() * 60 + d.getMinutes();
    return (mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900);
  };
  const updateClock = () => {
    const d = new Date();
    const dateStr = d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
    const timeStr = d.toLocaleTimeString("zh-CN", { hour12: false });
    const wd = "日一二三四五六"[d.getDay()];
    if (sbDateTime) sbDateTime.textContent = `${dateStr} 周${wd} ${timeStr}`;
    if (bbClock) bbClock.textContent = "实时 " + timeStr;
    if (sbMarket) {
      const open = isTrading(d);
      sbMarket.textContent = `● ${open ? "交易中" : "休市"}`;
      sbMarket.classList.toggle("open", open);
    }
  };
  updateClock();
  setInterval(updateClock, 1000);

  // 状态栏数据（北向/涨停跌停炸板，读 market.js 的实际字段）
  const updateSbData = () => {
    if (!sbData) return;
    const M = window.MARKET || {};
    const items = [];
    const nb = M.northbound;
    const net = nb ? [nb.total_yi, nb.hgt_yi].find(Number.isFinite) : null;
    if (net != null) {
      const cls = net >= 0 ? "up" : "down";
      items.push(`<span class="sb-item"><span class="sb-lbl">北向</span><span class="sb-val ${cls}">${net >= 0 ? "+" : ""}${net.toFixed(1)}亿</span></span>`);
    }
    const s = M.sentiment || {};
    if (s.zt_count != null) items.push(`<span class="sb-item"><span class="sb-lbl">涨停</span><span class="sb-val up">${s.zt_count}</span></span>`);
    if (s.zb_count != null) items.push(`<span class="sb-item"><span class="sb-lbl">炸板</span><span class="sb-val" style="color:var(--warn)">${s.zb_count}</span></span>`);
    if (s.dt_count != null) items.push(`<span class="sb-item"><span class="sb-lbl">跌停</span><span class="sb-val down">${s.dt_count}</span></span>`);
    sbData.innerHTML = items.join("");
  };
  setTimeout(updateSbData, 300); // 等数据加载

  /* ===================================================================
     扩展模块渲染: Home / 持仓决策 / 机会清单 / 逻辑链 / 产业雷达 / 事件概率 / 新闻等
  =================================================================== */
  // 通用区块标题
  const secTitle = (t, sub) => `<h2 class="vsec-title">${esc(t)}${sub ? `<span class="vsec-sub">${esc(sub)}</span>` : ""}</h2>`;
  // 安全截断：只对字符串截断，数组/其他类型返回原值交由 fieldHtml 处理
  const trunc = (v, n = 60) => (typeof v === "string" && v.length > n ? v.slice(0, n) + "…" : v);
  // 通用空态
  const emptyState = (msg) => `<div class="empty">${esc(msg)}</div>`;
  // 通用长文本列化：支持数组/字符串，字符串智能按编号/分号/句号拆分
  // - 数组：直接渲染编号列表
  // - 字符串：优先按"1. 2. "/"①②"等已有编号拆；其次按分号；最后按句号
  // - 单条不列化，保持段落
  function fieldHtml(s) {
    if (!s) return "";
    let items = [];
    if (Array.isArray(s)) {
      items = s;
    } else if (typeof s === "string") {
      const t = s.trim();
      if (!t) return "";
      // 已有显式编号：1. 2. / ①② / (1)(2)
      if (/\d+[.、)]\s|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|（\d+）/.test(t)) {
        items = t.split(/(?<=\d+[.、)]\s|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|）)/).map((x) => x.trim()).filter(Boolean);
      } else {
        // 中英文分号优先（实际数据常用英文 ; 分隔多事实点）
        const semiParts = t.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
        if (semiParts.length >= 2) {
          items = semiParts;
        } else {
          // 句号兜底
          const sentParts = t.split(/(?<=[。！？])\s*/).map((x) => x.trim()).filter(Boolean);
          if (sentParts.length >= 2) {
            items = sentParts;
          } else {
            // 斜杠分隔（sectors/downstream 等），仅当每部分都是短词(≤10字)且排除日期 7/3 这种
            const slashParts = t.split("/").map((x) => x.trim()).filter((x) => x && !/^\d+$/.test(x));
            if (slashParts.length >= 3 && slashParts.every((x) => x.length <= 10)) {
              items = slashParts;
            } else {
              // 顿号分隔（products 等），仅当整段无其他分隔符时
              const dunParts = t.split("、").map((x) => x.trim()).filter(Boolean);
              if (dunParts.length >= 3) {
                items = dunParts;
              }
            }
          }
        }
      }
      if (items.length <= 1) return `<p class="sd-v">${esc(t)}</p>`;
    }
    if (!items.length) return "";
    const lis = items.map((it, i) => `<li><span class="sum-idx">${i + 1}</span><span class="sum-txt">${esc(it)}</span></li>`).join("");
    return `<ol class="sd-field-list">${lis}</ol>`;
  }

  // 研究卡片通用 helper（机会/产业/材料/事件四模块共用，各处只传差异参数）
  const titleShort = (name, maxLen = Infinity) => {
    const t = String(name || "").trim();
    const cut = t.split(/[（(]/)[0].trim();
    return trunc(cut || t, maxLen);
  };
  const leadOf = (text, semi = false) => {
    const t = cleanDisplayText(text || "").trim();
    if (!t) return "";
    const m = semi ? t.match(/^[\s\S]{12,110}?[。！？；;]/) : t.match(/^[\s\S]{12,110}?[。！？]/);
    return m ? (semi ? m[0].replace(/[；;]$/, "。") : m[0]) : trunc(t, 96);
  };
  const blockHtml = (label, body, kind, prefix) => {
    const html = fieldHtml(body || "—");
    if (!html) return "";
    return `<section class="${prefix}-block ${kind || ""}"><div class="${prefix}-block-l">${esc(label)}</div><div class="${prefix}-block-b">${html}</div></section>`;
  };

  const fmtYi = (n) => n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(2) + "亿";

  function dateToken(v) {
    const s = v == null ? "" : String(v);
    const m = s.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
  }

  function daysSince(token) {
    if (!token) return null;
    const t = new Date(token + "T00:00:00").getTime();
    if (!Number.isFinite(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function healthTone(item) {
    if (item.missing) return item.optional ? "muted" : "bad";
    const d = daysSince(dateToken(item.date));
    if (d == null) return "warn";
    const ok = item.weekly ? 7 : (item.relaxed ? 2 : 1);
    const warn = item.weekly ? 14 : (item.relaxed ? 5 : 4);
    return d <= ok ? "ok" : d <= warn ? "warn" : "bad";
  }

  function healthText(item) {
    if (item.missing) return item.optional ? "本地未生成" : "缺失";
    const d = daysSince(dateToken(item.date));
    if (d == null) return "待核对";
    if (d <= 0) return "今日";
    return `${d}天前`;
  }

  function poolCount(obj, keys) {
    return keys.reduce((sum, k) => sum + (Array.isArray(obj?.[k]) ? obj[k].length : 0), 0);
  }

  function dataHealthItems() {
    const W = window.WEEKEND || null;
    const MAT = window.MATERIALS || null;
    const EV = window.EVENTS || null;
    const OPP = window.OPPORTUNITIES || null;
    const LOG = window.LOGIC || null;
    const holdingPrivate = !isLocalServer() && location.protocol !== "file:";
    return [
      { name: "行情信号", date: META.signalDate || META.lastUpdated, count: `${STOCKS.length}只`, source: "data/meta", view: "watch" },
      { name: "市场异动", date: MARKET.generatedAt || MARKET.date, count: `${poolCount(MARKET, ["topGainers","topLosers","topTurnover","topInflow","topOutflow","limitUp","limitDown","hotRank"])}条`, source: "market.js", view: "market" },
      { name: "今日热点", date: HOT.generatedAt || HOT.date, count: `${(HOT.list || []).length}只`, source: "hot.js", view: "hot" },
      { name: "新闻公告", date: NEWSALL?.generatedAt || NEWSALL?.date, count: `${(NEWSALL?.global || []).length + (NEWSALL?.announcements || []).length}条`, source: "newsall.js", view: "news", missing: !NEWSALL },
      { name: "持仓决策", date: HOLDINGS?.generatedAt || HOLDINGS?.date, count: holdingPrivate ? "线上隐藏" : `${(HOLDINGS?.list || []).length}只`, source: "本地私有", view: "holdings", optional: true, missing: !HOLDINGS },
      { name: "AI复盘", date: REPORTS.updated, count: `${(REPORTS.reports || []).length}篇`, source: "Hermes", view: "agent", relaxed: true, optional: true, missing: !(REPORTS.reports || []).length },
      { name: "机会清单", date: OPP?.generatedAt || OPP?.date, count: `${(OPP?.directions || []).length}项`, source: "Hermes", view: "opportunities", relaxed: true, missing: !OPP },
      { name: "逻辑链", date: LOG?.generatedAt || LOG?.date, count: `${(LOG?.chains || []).length}条`, source: "Hermes", view: "logic", relaxed: true, missing: !LOG },
      { name: "产业链涨价", date: window.CHAIN?.generatedAt || window.CHAIN?.date || INDUSTRY?.generatedAt || INDUSTRY?.date || MAT?.generatedAt || MAT?.date, count: `${(window.CHAIN?.directions || INDUSTRY?.directions || []).length + (MAT?.directions || []).length}项`, source: "Hermes", view: "chain", relaxed: true, missing: !(window.CHAIN?.directions?.length || INDUSTRY?.directions?.length || MAT?.directions?.length) },
      { name: "事件概率", date: EV?.generatedAt || EV?.date, count: `${(EV?.events || []).length}件`, source: "Hermes", view: "events", relaxed: true, missing: !EV },
      { name: "周末发酵", date: W?.generatedAt || W?.weekendDate || W?.date, count: `${(W?.hotspots || []).length}项`, source: "Hermes", view: "weekend", weekly: true, optional: true, missing: !W },
    ];
  }

  function renderDataHealthPanel() {
    const items = dataHealthItems();
    const cards = items.map((it) => {
      const tone = healthTone(it);
      const date = dateToken(it.date) || "—";
      return `<button class="health-card ${tone}" data-go="${esc(it.view)}">
        <span class="health-dot"></span>
        <span class="health-main">
          <span class="health-name">${esc(it.name)}</span>
          <span class="health-meta">${esc(date)} · ${esc(it.count)} · ${esc(it.source)}</span>
        </span>
        <span class="health-age">${esc(healthText(it))}</span>
      </button>`;
    }).join("");
    const refresh = isLocalServer()
      ? `<div class="refresh-panel">
          <button class="refresh-btn" id="localRefreshBtn">刷新数据</button>
          <div class="refresh-status" id="refreshStatus">本地服务已连接</div>
        </div>`
      : `<div class="refresh-panel muted"><div class="refresh-status">本地刷新需从 http://localhost:8787 打开</div></div>`;
    return `${secTitle("数据健康", "更新时间 / 完整度 / 本地刷新")}
      <div class="health-grid">${cards}</div>
      ${refresh}`;
  }

  let refreshPollTimer = null;
  async function pollRefreshStatus(once = false) {
    if (!isLocalServer()) return;
    const el = $("#refreshStatus");
    if (!el) return;
    // 单一轮询链：重复进入首页时不叠加定时器
    clearTimeout(refreshPollTimer);
    try {
      const r = await fetch("/api/status?t=" + Date.now());
      const st = await r.json();
      const lines = st.log || [];
      el.innerHTML = `
        <div class="rs-line ${st.error ? "bad" : st.running ? "warn" : st.done ? "ok" : ""}">
          ${st.running ? "刷新中" : st.error ? esc(st.error) : st.done ? "刷新完成" : "待刷新"}
        </div>
        ${lines.length ? `<pre>${esc(lines.slice(-6).join("\n"))}</pre>` : ""}`;
      const btn = $("#localRefreshBtn");
      if (btn) btn.disabled = !!st.running;
      if (st.running) refreshPollTimer = setTimeout(() => pollRefreshStatus(), 1500);
      else if (!once && st.done) setTimeout(() => location.reload(), 800);
    } catch {
      el.textContent = "无法读取本地刷新状态";
    }
  }

  async function startLocalRefresh() {
    if (!isLocalServer()) return;
    const btn = $("#localRefreshBtn");
    if (btn) btn.disabled = true;
    const el = $("#refreshStatus");
    if (el) el.textContent = "正在启动刷新...";
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      const res = await r.json().catch(() => null);
      if (!r.ok || (res && res.ok === false)) {
        if (el) el.textContent = (res && res.msg) || "刷新启动失败";
        if (btn) btn.disabled = false;
        return;
      }
      pollRefreshStatus();
    } catch {
      if (el) el.textContent = "刷新启动失败，请确认 app_server.py 正在运行";
      if (btn) btn.disabled = false;
    }
  }

  function bindHomeControls() {
    $("#viewHome")?.querySelectorAll(".health-card").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.go)));
    $("#localRefreshBtn")?.addEventListener("click", startLocalRefresh);
    pollRefreshStatus(true);
  }

  let searchIndex = null;
  function addSearchItem(list, type, title, meta, text, view, code) {
    const hay = [type, title, meta, text, code].filter(Boolean).join(" ").toLowerCase();
    list.push({ type, title, meta, text, view, code, hay });
  }

  function buildSearchIndex() {
    const list = [];
    STOCKS.forEach((s) => {
      addSearchItem(list, "自选股", s.name, `${s.code} · ${s.sector}`, [s.narrative, (s.tags || []).join(" "), s.review?.change].join(" "), "watch", s.code);
      (s.news || []).slice(0, 3).forEach((n) => addSearchItem(list, "个股新闻", n.title, `${s.name} · ${n.date || ""}`, n.source || "", "watch", s.code));
    });
    ["topGainers","topLosers","topTurnover","topInflow","topOutflow","limitUp","limitDown","brokeUp","hotRank"].forEach((key) => {
      (MARKET[key] || []).slice(0, 40).forEach((m) => addSearchItem(list, "市场异动", m.name, `${m.code} · ${m.industry || ""}`, m.reason || "", "market", m.code));
    });
    ((MARKET.dragonTiger && MARKET.dragonTiger.stocks) || []).slice(0, 40).forEach((m) =>
      addSearchItem(list, "龙虎榜", m.name, `${m.code} · ${m.industry || ""}`, m.reason || "", "market", m.code));
    (HOT.list || []).forEach((h) => addSearchItem(list, "热点", h.name, `${h.code} · 热度${h.rank || ""}`, [h.reason, (h.concepts || []).join(" ")].join(" "), "hot", h.code));
    (NEWSALL?.global || []).slice(0, 60).forEach((n) => addSearchItem(list, "新闻", n.title, n.time || n.date || "", "", "news"));
    (NEWSALL?.announcements || []).slice(0, 60).forEach((n) => addSearchItem(list, "公告", n.title || n.announcementTitle, n.date || "", "", "news"));
    (window.OPPORTUNITIES?.directions || []).forEach((d) => addSearchItem(list, "机会", d.name, d.stage || "", [d.logic, d.risk].join(" "), "opportunities"));
    (window.LOGIC?.chains || []).forEach((c) => addSearchItem(list, "逻辑链", c.name, "", [c.logic, c.bottleneck].join(" "), "logic"));
    const chainDirs = (window.CHAIN?.directions && window.CHAIN.directions.length ? window.CHAIN.directions : [...(INDUSTRY?.directions || []), ...(window.MATERIALS?.directions || [])].map((d) => d.driver_type ? d : { ...d, driver_type: [], bottleneck: "", chain: "", category: "", intensity: d.intensity || ({ "高": "强", "中高": "中强", "中": "中", "低": "弱" })[d.confidence] || "中", price_signal: d.price_signal || d.price || "" }));
    chainDirs.forEach((d) => addSearchItem(list, "产业链", d.name, d.intensity || "", [d.price_signal, d.bottleneck, d.driver, d.risk].filter(Boolean).join(" "), "chain"));
    (window.EVENTS?.events || []).forEach((e) => addSearchItem(list, "事件", e.title, e.importance || "", [e.content, e.sectors].join(" "), "events"));
    return list;
  }

  function searchResults(q) {
    const key = q.trim().toLowerCase();
    if (!key) return [];
    if (!searchIndex) searchIndex = buildSearchIndex();
    const score = (x) => {
      const title = String(x.title || "").toLowerCase();
      const code = String(x.code || "").toLowerCase();
      if (code === key) return 1000;
      if (title === key && x.type === "自选股") return 950;
      if (title === key) return 900;
      if (code.startsWith(key)) return 800;
      if (title.startsWith(key)) return 700;
      if (x.type === "自选股") return 500;
      return 100;
    };
    return searchIndex
      .filter((x) => x.hay.includes(key))
      .map((x, order) => ({ x, order, score: score(x) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 12)
      .map((item) => item.x);
  }

  function activateSearchResult(item) {
    if (!item) return;
    switchView(item.view || "watch");
    if (item.code) {
      setTimeout(() => {
        if (item.type === "自选股" || item.type === "个股新闻") openDrawer(item.code);
        else openDrawer(item.code);
      }, 80);
    }
    closeSearchPanel();
  }

  function setSearchActiveIndex(next) {
    const hits = [...document.querySelectorAll("#searchPanel .search-hit")];
    if (!hits.length) return;
    const count = hits.length;
    searchActiveIndex = ((next % count) + count) % count;
    hits.forEach((hit, index) => {
      const active = index === searchActiveIndex;
      hit.classList.toggle("active", active);
      hit.setAttribute("aria-selected", active ? "true" : "false");
    });
    const selected = hits[searchActiveIndex];
    $("#globalSearchInput")?.setAttribute("aria-activedescendant", selected.id);
    selected.scrollIntoView({ block: "nearest" });
  }

  function closeSearchPanel() {
    const panel = $("#searchPanel");
    if (panel) {
      panel.innerHTML = "";
      panel.setAttribute("aria-hidden", "true");
    }
    searchActiveIndex = -1;
    searchActiveResults = [];
    const input = $("#globalSearchInput");
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    const status = $("#searchStatus");
    if (status) status.textContent = "";
  }

  function renderGlobalSearch(q) {
    const panel = $("#searchPanel");
    if (!panel) return;
    const results = searchResults(q);
    if (!q.trim()) { closeSearchPanel(); return; }
    searchActiveIndex = -1;
    searchActiveResults = results;
    panel.setAttribute("aria-hidden", "false");
    $("#globalSearchInput")?.setAttribute("aria-expanded", "true");
    const status = $("#searchStatus");
    if (status) status.textContent = results.length ? `${results.length} 个搜索结果` : "没有匹配结果";
    panel.innerHTML = results.length
      ? results.map((r, i) => `<button class="search-hit" id="searchOption${i}" role="option" aria-selected="false" data-i="${i}">
          <span class="sh-type">${esc(r.type)}</span>
          <span class="sh-main"><span class="sh-title">${esc(r.title || "—")}</span><span class="sh-meta">${esc(r.meta || "")}</span></span>
        </button>`).join("")
      : `<div class="search-empty">没有匹配结果</div>`;
    panel.querySelectorAll(".search-hit").forEach((b) => b.addEventListener("click", () => activateSearchResult(results[Number(b.dataset.i)])));
  }

  /* ---------- 1. Home 首页总览 ---------- */
  function renderHome() {
    const el = $("#viewHome");
    if (!el) return;
    const ms = META.marketSnapshot;
    // 指数:每个做成独立卡片块(名称+价格+涨跌幅+涨跌色背景)
    const ixHtml = ms && ms.indices && ms.indices.length
      ? ms.indices.map((i) => {
          const cls = i.pct > 0 ? "up" : i.pct < 0 ? "down" : "flat";
          const sign = i.pct > 0 ? "+" : "";
          return `<div class="idx-card ${cls}">
            <div class="idx-name">${esc(i.name)}</div>
            <div class="idx-price">${esc(i.price)}</div>
            <div class="idx-chg">${sign}${esc(i.pct)}%</div>
          </div>`;
        }).join("")
      : `<div class="empty-inline">大盘数据待生成</div>`;
    const s = MARKET.sentiment || {};
    const nb = MARKET.northbound;
    const I = window.INDUSTRY;
    const L = window.LOGIC;
    const E = window.EVENTS;
    const O = window.OPPORTUNITIES;
    const M = window.MATERIALS;

    // 各模块"最强"选取规则
    // 产业链涨价: CHAIN 优先, 否则旧 industry+materials 合并映射, 取 intensity 最高
    const intRankChain = { "极强": 5, "强": 4, "中强": 3, "中": 2, "弱": 1 };
    const chainDirsAll = (window.CHAIN?.directions && window.CHAIN.directions.length ? window.CHAIN.directions : [...(I && I.directions || []), ...(M && M.directions || [])].map((d) => d.driver_type ? d : { ...d, driver_type: [], intensity: d.intensity || ({ "高": "强", "中高": "中强", "中": "中", "低": "弱" })[d.confidence] || "中", price_signal: d.price_signal || d.price || "" }));
    const bestChain = chainDirsAll.slice().sort((a, b) => (intRankChain[b.intensity] || 0) - (intRankChain[a.intensity] || 0))[0];
    // 机会清单: priority 星最多
    const bestOpp = (O && O.directions || []).slice().sort((a, b) => (b.priority || "").length - (a.priority || "").length)[0];
    // 事件概率: importance 最高
    const impRank = { "高": 3, "中高": 2, "中": 1 };
    const bestEvt = (E && E.events || []).slice().sort((a, b) => (impRank[b.importance] || 0) - (impRank[a.importance] || 0))[0];
    // 逻辑链: 与逻辑链页一致，按成立强度取最高分
    const bestLogic = (L && L.chains || []).slice().sort((a, b) => App.scoreChain(b).score - App.scoreChain(a).score)[0];

    // 精华卡: 标签 + 标题 + 一句话精华 + 强度徽章 + 跳转目标
    const cards = [
      bestOpp ? {
        tag: "机会清单", tagCls: "ok", go: "opportunities", xname: bestOpp.name,
        title: bestOpp.name,
        essence: bestOpp.logic ? trunc(bestOpp.logic) : "—",
        badge: bestOpp.stage || "", badgeCls: "warn"
      } : null,
      bestChain ? {
        tag: "产业链涨价", tagCls: "up", go: "chain", xname: bestChain.name,
        title: bestChain.name,
        essence: bestChain.bottleneck ? ("卡脖子:" + trunc(bestChain.bottleneck)) : (bestChain.price_signal ? trunc(bestChain.price_signal) : "—"),
        badge: bestChain.intensity || "", badgeCls: "ok"
      } : null,
      bestEvt ? {
        tag: "事件概率", tagCls: "up", go: "events", xname: bestEvt.title,
        title: bestEvt.title,
        essence: bestEvt.importance_reason ? trunc(bestEvt.importance_reason) : "—",
        badge: bestEvt.importance || "", badgeCls: "ok"
      } : null,
      bestLogic ? {
        tag: "逻辑链", tagCls: "ok", go: "logic", xname: bestLogic.name,
        title: bestLogic.name,
        essence: bestLogic.bottleneck ? trunc(bestLogic.bottleneck) : "—",
        badge: "卡点", badgeCls: "warn"
      } : null,
    ].filter(Boolean);

    const cardHtml = cards.map((c) => `
      <article class="home-best ${c.tagCls}" data-go="${esc(c.go)}" data-xname="${esc(c.xname || "")}" role="button" tabindex="0" aria-label="打开${esc(c.tag)}：${esc(c.title)}">
        <div class="hb-top">
          <span class="hb-tag ${c.tagCls}">${esc(c.tag)}</span>
          <span class="hb-badge ${c.badgeCls}">${esc(c.badge)}</span>
        </div>
        <h3 class="hb-title">${esc(c.title)}</h3>
        <p class="hb-essence">${esc(c.essence)}</p>
      </article>`).join("");

    const ddHits = STOCKS.filter(isDeepDrawdown);
    const ddStrip = ddHits.length
      ? `<button class="home-dd-strip" id="homeDdStrip" type="button">
          <span class="hdd-n">${ddHits.length}</span>
          <span class="hdd-t">只巨头距 60 日高点跌超 25%</span>
          <span class="hdd-go">去筛选 ↗</span>
        </button>`
      : "";

    el.innerHTML = `
      <section class="home-market">
        <div class="hm-head">
          <h3 class="hm-title">大盘速览</h3>
          <span class="hm-date">截至 ${esc((ms && ms.date) || "")}</span>
        </div>
        <div class="idx-grid">${ixHtml}</div>
        <div class="hm-sentiment">
          <div class="sent-block up"><div class="sb-n">${s.zt_count ?? "—"}</div><div class="sb-l">涨停</div></div>
          <div class="sent-block warn"><div class="sb-n">${s.zb_count ?? "—"}</div><div class="sb-l">炸板</div></div>
          <div class="sent-block down"><div class="sb-n">${s.dt_count ?? "—"}</div><div class="sb-l">跌停</div></div>
          <div class="sent-block"><div class="sb-n">${s.break_rate ?? "—"}<span class="sb-u">%</span></div><div class="sb-l">炸板率</div></div>
          <div class="sent-block"><div class="sb-n">${s.max_height ?? "—"}<span class="sb-u">板</span></div><div class="sb-l">最高连板</div></div>
          ${nb && Number.isFinite(nb.total_yi) ? `<div class="sent-block ${sgn(nb.total_yi)}"><div class="sb-n">${nb.total_yi > 0 ? "+" : ""}${nb.total_yi.toFixed(2)}<span class="sb-u">亿</span></div><div class="sb-l">北向净额</div></div>` : ""}
        </div>
      </section>
      ${ddStrip}
      ${renderDataHealthPanel()}
      ${secTitle("今日最强", "5个分析模块各取第1 · 点击定位到对应条目")}
      <div class="home-best-grid">${cardHtml || emptyState("分析数据待生成")}</div>
      <div class="home-foot">数据时点 ${esc(MARKET.date || META.signalDate || "")} · 非投资建议</div>
    `;
    el.querySelectorAll(".home-best").forEach((c) => {
      const go = () => jumpToModuleItem(c.dataset.go, c.dataset.xname);
      c.addEventListener("click", go);
      c.addEventListener("keydown", (e) => {
        if (e.target !== c || !["Enter", " "].includes(e.key)) return;
        e.preventDefault();
        go();
      });
    });
    $("#homeDdStrip")?.addEventListener("click", () => {
      state.verdict = "drawdown";
      renderChips();
      switchView("watch");
      renderWatch();
    });
    bindHomeControls();
  }


  /* ---------- 跨条目定位：首页「今日最强」点击后跳到对应模块并高亮 ---------- */
  function jumpToModuleItem(view, name) {
    switchView(view);
    if (!name) return;
    const tryFocus = (attempt) => {
      const target = [...document.querySelectorAll(`.${view}-only [data-xname]`)]
        .find((node) => node.dataset.xname === name);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("flash-target");
        setTimeout(() => target.classList.remove("flash-target"), 1800);
        return;
      }
      if (attempt < 8) requestAnimationFrame(() => tryFocus(attempt + 1));
    };
    requestAnimationFrame(() => tryFocus(0));
  }

  // 暴露核心到 window.App，供 src/ 下拆分模块(holdings.js / ai-modules.js)解构使用。
  // scoreChain / strengthLabel / renderHoldings / renderOpportunities 等由各 src 模块自行注册。
  window.App = {
    STOCKS, META, MARKET, HOLDINGS, INDUSTRY, INDUSTRY_MARKET, CHAIN, NEWSALL, REPORTS, HOT,
    state, marketState, viewScroll,
    get curView() { return curView; }, set curView(v) { curView = v; },
    $, grid, viewScrollRoot, isLocalServer,
    cleanDisplayText, esc, safeUrl,
    getStockReferenceIndex, isChanged, isOpportunity, latestDay, freshNews, matches, trendRank,
    sortList, sparkline, sgn, pct, fundChip, trendCls, drawdownPct, isDeepDrawdown, drawdownFlag, stateTone,
    card, liList, newsList, researchList,
    secTitle, trunc, emptyState, fieldHtml, titleShort, leadOf, blockHtml, fmtYi,
    dateToken, daysSince, healthTone, healthText, poolCount,
    ANOMALY_DEFS, drawerHeadHtml,
    renderMeta, renderMarketSnap, renderGauges, renderStats, renderChips,
    renderWatch, renderMarket, renderSentiment, renderHot, marketCard, hotCard,
    showDrawer, openDrawer, closeDrawer, renderWatchDrawer, renderMarketDrawer, findMarketStock,
    switchView, viewFromHash, syncViewLocation,
    renderGlobalSearch, closeSearchPanel,
  };

  // 启动函数：由最后一个同步加载的模块(app_ai_modules.js)末尾调用，
  // 确保 holdings/opportunities/logic/chain/... 都已注册到 App 后再渲染。
  window.App.start = function () {
    renderMeta();
    renderStats();
    renderChips();
    // 支持直接打开 #market 等视图；无 hash 时用首页替换当前历史记录。
    switchView(viewFromHash(), { replaceHash: !location.hash });

    // 数据脚本是 defer，首次渲染时可能尚未就绪；DOMContentLoaded 后数据已可用，再刷新一次当前视图。
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        // defer 数据脚本已执行，重新绑定到最新全局数据并重置缓存索引
        STOCKS = window.STOCKS || [];
        META = window.META || {};
        MARKET = window.MARKET || {};
        HOLDINGS = window.HOLDINGS || null;
        INDUSTRY = window.INDUSTRY || null;
        INDUSTRY_MARKET = window.INDUSTRY_MARKET || null;
        CHAIN = window.CHAIN || null;
        NEWSALL = window.NEWSALL || null;
        REPORTS = window.REPORTS || {};
        HOT = window.HOT || {};
        stockReferenceIndex = null;
        renderMeta();
        renderStats();
        renderChips();
        const fn = VIEW_RENDER[curView];
        if (fn) {
          try { Promise.resolve(fn()).catch((e) => console.warn("render " + curView + " failed", e)); }
          catch (e) { console.warn("render " + curView + " failed", e); }
        }
      });
    }
  };
})();
