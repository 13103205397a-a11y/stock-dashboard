/* A股盘面 · 研究工作台 — 渲染 / 筛选 / 搜索 / 详情抽屉 */
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

  const state = { sector: "全部", verdict: "all", q: "", sort: "default" };
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
  // 退休/内部数据文件名 → 读者可读来源；不用 \b，避免中文粘连时漏替换。
  const RETIRED_SOURCE_FILES = [
    ["newsall.js", "公开资讯"],
    ["hot.js", "热度榜数据"],
    ["chain.js", "公开产业资料"],
    ["reports.js", "历史复盘资料"],
    ["fundflow.js", "资金数据"],
    ["materials.js", "公开材料价格资料"],
    ["industry_market.js", "行业行情数据"],
    ["market.js", "市场异动数据"],
    ["industry.js", "行业数据"],
  ];
  // 逻辑链强度评级：与 app_ai_modules.js 共用同一份（app_ai_modules.js 从 App 解构）
  const logicStrengthRank = { "强": 3, "中": 2, "弱": 1 };
  // 退休文件名 → 预编译正则（避免每次 cleanDisplayText 调用都 new RegExp）
  const RETIRED_SOURCE_PATTERNS = RETIRED_SOURCE_FILES.map(([name, label]) => [
    new RegExp(`(?<![A-Za-z0-9_])${name.replace(".", "\\.")}(?![A-Za-z0-9_])`, "gi"),
    label,
  ]);
  const cleanDisplayText = (value) => {
    if (value == null) return "";
    let text = String(value)
      // 移除上游偶发的替换字符、零宽字符和控制符，避免资讯正文出现乱码。
      .replace(/(?:ï¿½|\uFFFD)/g, "")
      .replace(/â€™/g, "’")
      .replace(/â€œ/g, "“")
      .replace(/â€/g, "”")
      .replace(/â€“/g, "–")
      .replace(/â€”/g, "—")
      .replace(/Â·/g, "·")
      .replace(/Â/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, "")
      // 这些是采集/分析阶段的内部字段，不应直接出现在阅读界面。
      .replace(/(?<![A-Za-z0-9_])(?:thsStrong|thsHot)(?![A-Za-z0-9_])\s*[:：]?\s*/gi, " ")
      .replace(/(?<![A-Za-z0-9_])break\s*=\s*\d+\s*(?:次)?(?![A-Za-z0-9_])/gi, " ")
      .replace(/(?<![A-Za-z0-9_])confidence\s*=\s*([\w\u4e00-\u9fff-]+)/gi, "置信度：$1");
    for (const [pattern, label] of RETIRED_SOURCE_PATTERNS) {
      text = text.replace(pattern, label);
    }
    text = text
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
  const northboundYi = (nb) => {
    if (!nb) return null;
    const value = [nb.total_yi, nb.hgt_yi, nb.sgt_yi].find(Number.isFinite);
    return Number.isFinite(value) ? value : null;
  };
  const isUnverifiedText = (...parts) => /web检索不可用|网页搜索不可用|无法核实/.test(parts.filter(Boolean).join("\n"));
  const researchSessionMeta = (mod) => {
    if (!mod) return { kind: "unknown", label: "", stamp: "" };
    const stamp = String(mod.generatedAt || mod.date || "").trim();
    const hm = stamp.match(/(\d{1,2}):(\d{2})/);
    if (hm) {
      const hour = Number(hm[1]);
      if (hour < 15) return { kind: "midday", label: "午间稿", stamp };
      return { kind: "close", label: "收盘稿", stamp };
    }
    if (/午间/.test(String(mod.summary || ""))) return { kind: "midday", label: "午间稿", stamp };
    return { kind: stamp ? "dated" : "unknown", label: stamp ? `截至 ${stamp}` : "", stamp };
  };
  const isFundStale = (fund) => {
    const signalDate = String((META && META.signalDate) || (META && META.marketSnapshot && META.marketSnapshot.date) || "").slice(0, 10);
    const fundDate = String((fund && fund.date) || "").slice(0, 10);
    return Boolean(signalDate && fundDate && fundDate < signalDate);
  };
  const displayImportance = (event) => {
    const raw = event && event.importance;
    if (isUnverifiedText(event && event.content, event && event.importance_reason, event && event.source, event && event.title)) {
      return { label: "待核实", cls: "warn", demoted: true };
    }
    return { label: raw || "—", cls: "", demoted: false };
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

  // 轻量提示条（当前用于详情数据缺失等全局反馈）
  const showToast = (msg, type = "info") => {
    const t = document.createElement("div");
    t.className = "pf-toast " + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3000);
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
      [MARKET, "市场异动"],
      [window.LOGIC, "逻辑链"],
      [window.EVENTS, "今日热点事件"], [window.WEEKEND, "周末发酵"],
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
    const updated = $("#updated");
    const updatedLabel = `行情截至 ${day}${tip ? ` ${tip}` : ""}`;
    updated.innerHTML = `<span class="fresh ${cls}"></span>行情截至 ${esc(day)}${tip ? ` <span class="fresh-tip ${cls}">${tip}</span>` : ""}`;
    updated.setAttribute("aria-label", updatedLabel);
    updated.title = updatedLabel;
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
    const nbYi = northboundYi(MK.northbound || {});
    if (!sent.zt_count && nbYi == null) { el.style.display = "none"; return; }
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
    // 2. 北向资金流向条（优先 total，否则沪股通/深股通）
    if (nbYi != null) {
      const val = nbYi;
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
    const arr = list.slice();
    const g = (s) => s.signal || {};
    // 「跌超25%」筛选且未显式选排序时，默认按回撤从深到浅排，方便先看最惨的
    if (by === "default" && state.verdict === "drawdown") {
      arr.sort((a, b) => (drawdownPct(g(b)) ?? -1) - (drawdownPct(g(a)) ?? -1));
      return arr;
    }
    if (by === "default") return arr;
    if (by === "chg") arr.sort((a, b) => (g(b).chgPct ?? -99) - (g(a).chgPct ?? -99));
    else if (by === "toBreakout") arr.sort((a, b) => (g(a).toBreakoutPct ?? 999) - (g(b).toBreakoutPct ?? 999));
    else if (by === "pullback") arr.sort((a, b) => (g(a).pullbackPct ?? 999) - (g(b).pullbackPct ?? 999));
    else if (by === "drawdown") arr.sort((a, b) => (drawdownPct(g(b)) ?? -1) - (drawdownPct(g(a)) ?? -1));
    else if (by === "trend") arr.sort((a, b) => (trendRank[g(b).trend] ?? -1) - (trendRank[g(a).trend] ?? -1) || (g(b).posPct ?? -99) - (g(a).posPct ?? -99));
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
  // 安全数值：字段可能是数字字符串或异常值，统一转有限数字，失败返回 NaN。
  const toNum = (v) => {
    if (v == null) return NaN;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const fmtNum = (v, digits, suffix = "") => {
    const n = toNum(v);
    return Number.isFinite(n) ? n.toFixed(digits) + suffix : "—";
  };
  const pct = (n) => { const x = toNum(n); return !Number.isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(1) + "%"; };  // 主力净流入（亿元，A股惯例：流入为红、流出为绿）
  const fundChip = (s) => {
    const f = s.fund;
    if (!f || f.netInflow == null) return "";
    const n = f.netInflow, cls = n > 0 ? "up" : n < 0 ? "down" : "";
    const stale = isFundStale(f);
    const title = stale
      ? `主力净流入 · 同花顺问财（${f.date || ""}）· 早于当日信号，仅供参考`
      : `主力净流入 · 同花顺问财（${f.date || ""}）`;
    return `<span class="fund ${cls}${stale ? " fund-stale" : ""}" title="${esc(title)}">主力 ${n > 0 ? "+" : ""}${n}亿${stale ? " · 非当日" : ""}</span>`;
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
      <div class="card-lens">叙事：${esc(rawVerdict)} · 技术：${esc(g.trend || "—")}</div>
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
    // 每次打开都更新返回焦点引用（含抽屉内跳转另一标的），关闭时回到最后触发的元素。
    const active = document.activeElement;
    if (active instanceof HTMLElement && !drawer.contains(active)) {
      drawerReturnFocus = active;
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

  // 统一入口：巨头核心走完整叙事版，其他关联标的走轻量版。
  function openDrawer(code) {
    try {
      const s = STOCKS.find((x) => x.code === code);
      if (s) return renderWatchDrawer(s);
      const m = findMarketStock(code);
      if (m) return renderMarketDrawer(m);
      showToast(`暂未找到股票 ${code} 的详情数据`, "error");
    } catch (err) {
      console.warn("openDrawer 渲染失败", err);
      const drawer = $("#drawerInner");
      if (drawer) {
        drawer.innerHTML = `
          ${drawerHeadHtml("数据异常", String(code || ""), "无法显示详情")}
          <div class="dsec"><p class="dnarr" role="alert">该条目数据异常，无法显示详情</p></div>`;
      }
      showDrawer();
    }
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
        <p class="sig-lens">两套口径并列：叙事「${esc(r.verdict || "—")}」看故事是否成立；技术「${esc(g.trend || "—")}」看均线结构，二者不必同向。</p>
        <div class="risk-row">
          ${maCell("左侧止损", g.leftStop == null ? "—" : "¥" + g.leftStop)}
          ${maCell("左侧目标", g.leftTarget == null ? "—" : "¥" + g.leftTarget)}
          ${maCell("盈亏比", g.leftRR == null ? "—" : g.leftRR)}
          ${maCell("右侧止损", g.rightStop == null ? "—" : "¥" + g.rightStop)}
        </div>
        ${s.fund ? `<div class="fund-row${isFundStale(s.fund) ? " fund-stale" : ""}">
          <span class="fr-lab">主力资金（同花顺 ${esc(s.fund.date || "")}${isFundStale(s.fund) ? " · 非当日" : ""}）</span>
          <span class="fr-val ${(() => { const ni = toNum(s.fund.netInflow); return Number.isFinite(ni) ? sgn(ni) : ""; })()}">净流入 ${(() => { const ni = toNum(s.fund.netInflow); return Number.isFinite(ni) ? (ni > 0 ? "+" : "") + ni + " 亿" : "—"; })()}</span>
          <span class="fr-val">换手 ${s.fund.turnover == null ? "—" : s.fund.turnover + "%"}</span>
        </div>` : ""}
      </div>` : "";
    $("#drawerInner").innerHTML = `
      ${drawerHeadHtml(s.name, s.code, s.sector, `<span class="verdict-badge ${esc(r.verdict)}">${esc(r.verdict || "—")}</span>`)}

      ${sigBlock}

      ${s.valuation ? `<div class="dsec">
        <h3>估值面板 <span class="src-note">机构一致预期 · ${esc(s.valuation.asof || "")}</span></h3>
        <div class="val-grid">
          <div class="vm"><span class="vm-l">PE(TTM)</span><span class="vm-v">${fmtNum(s.valuation.pe_ttm, 1)}</span></div>
          <div class="vm"><span class="vm-l">前向PE</span><span class="vm-v">${fmtNum(s.valuation.pe_fwd, 1)}</span></div>
          <div class="vm"><span class="vm-l">PEG</span><span class="vm-v ${(() => { const p = toNum(s.valuation.peg); return p < 1 ? "up" : p > 2 ? "down" : ""; })()}">${fmtNum(s.valuation.peg, 2)}</span></div>
          <div class="vm"><span class="vm-l">PB</span><span class="vm-v">${fmtNum(s.valuation.pb, 2)}</span></div>
          <div class="vm"><span class="vm-l">总市值</span><span class="vm-v">${fmtNum(s.valuation.mcap_yi, 0, "亿")}</span></div>
          <div class="vm"><span class="vm-l">今年EPS</span><span class="vm-v">${fmtNum(s.valuation.eps_cur, 2)}</span></div>
          <div class="vm"><span class="vm-l">明年EPS</span><span class="vm-v">${fmtNum(s.valuation.eps_next, 2)}</span></div>
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

  // 非巨头核心标的详情抽屉（行情 + 关联信息 + 说明）
  function renderMarketDrawer(m) {
    const chg = m.chgPct ?? m.pct;
    const industry = typeof m.industry === "string" ? m.industry : (m.industry || []).join("/");
    const netInflowNum = toNum(m.netInflow);
    const netflow = Number.isFinite(netInflowNum) ? netInflowNum / 1e8 : null;
    const mcapYi = toNum(m.mcap_yi);
    const turnoverNum = toNum(m.turnover);
    const amplitudeNum = toNum(m.amplitude);
    $("#drawerInner").innerHTML = `
      ${drawerHeadHtml(m.name, m.code, industry || (m._sources || []).join(" / ") || "分析模块关联标的", m.lbc ? `<span class="mc-hl up">${m.lbc}连板</span>` : "")}
      ${(m.price != null || chg != null || turnoverNum != null || netflow != null) ? `<div class="dsec">
        <h3>实时行情 <span class="src-note">东财 · ${esc(MARKET.date || "")}</span></h3>
        <div class="sig-top">
          <span class="sig-px">¥${m.price ?? "—"}</span>
          ${chg != null ? `<span class="chg ${sgn(chg)}">${pct(chg)}</span>` : ""}
          ${Number.isFinite(turnoverNum) ? `<span class="sig-pos">换手 ${turnoverNum.toFixed(2)}%</span>` : ""}
          ${m.volumeRatio != null ? `<span class="sig-pos">量比 ${m.volumeRatio}</span>` : ""}
          ${Number.isFinite(amplitudeNum) ? `<span class="sig-pos">振幅 ${amplitudeNum.toFixed(2)}%</span>` : ""}
        </div>
        ${netflow != null ? `<div class="fund-row"><span class="fr-lab">主力净流入</span><span class="fr-val ${sgn(netflow)}">${netflow > 0 ? "+" : ""}${netflow.toFixed(2)} 亿</span></div>` : ""}
        ${Number.isFinite(mcapYi) ? `<div class="fund-row"><span class="fr-lab">总市值</span><span class="fr-val">${mcapYi.toFixed(0)} 亿</span></div>` : ""}
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

  // 模块视图切换 + 懒渲染调度
  const VIEW_RENDER = {
    home: () => renderHome(),
    watch: () => renderWatch(),
    market: () => renderMarket(),
    logic: () => App.renderLogic(),
    xbrief: () => App.renderXBriefs(),
    kimi: () => App.renderKimiReview(),
    events: () => App.renderEvents(),
    weekend: () => App.renderWeekend(),
  };
  const VIEW_TITLES = {
    home: "首页",
    watch: "巨头核心",
    market: "市场扫描",
    logic: "逻辑链",
    xbrief: "外围热点",
    kimi: "每日复盘",
    events: "今日热点事件",
    weekend: "周末发酵",
  };

  // 本机看板监听数据文件变化：Grok/Kimi/行情刷新写入后，页面自动重载；公开站点不发起本地请求。
  let localDataWatchTimer = null;
  let localDataVersion = "";
  function startLocalDataWatch() {
    if (localDataWatchTimer || !/^https?:$/.test(location.protocol) || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    const check = async () => {
      try {
        const response = await fetch(`/api/data-version?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const next = String(payload.version || "");
        if (!next) return;
        if (localDataVersion && localDataVersion !== next) {
          location.reload();
          return;
        }
        localDataVersion = next;
      } catch {
        // 本地服务暂时不可用时不打扰当前页面，下一轮继续检查。
      }
    };
    check();
    localDataWatchTimer = window.setInterval(check, 30_000);
  }
  function hashViewName() {
    try {
      return decodeURIComponent(location.hash.replace(/^#/, "").split("/")[0]).trim();
    } catch {
      return "";
    }
  }
  function syncViewLocation(view, replace = false) {
    const hash = `#${view}`;
    if (location.hash === hash) return;
    history[replace ? "replaceState" : "pushState"](null, "", hash);
  }
  const mobileSidebarQuery = window.matchMedia("(max-width: 980px)");
  let sidebarReturnFocus = null;

  function setSidebarTriggerState(expanded) {
    const value = expanded ? "true" : "false";
    const menuToggle = $("#menuToggle");
    const tabMore = $("#tabMore");
    menuToggle?.setAttribute("aria-expanded", value);
    tabMore?.setAttribute("aria-expanded", value);
    if (menuToggle) menuToggle.setAttribute("aria-label", expanded ? "关闭模块菜单" : "打开模块菜单");
    if (tabMore) tabMore.setAttribute("aria-label", expanded ? "关闭更多模块" : "打开更多模块");
  }

  function syncSidebarAccessibility() {
    const sidebar = $("#sidebar");
    const backdrop = $("#sidebarBackdrop");
    if (!sidebar) return;
    const mobile = mobileSidebarQuery.matches;
    const open = mobile && document.body.classList.contains("sidebar-open");
    setSidebarTriggerState(open);
    backdrop?.setAttribute("aria-hidden", open ? "false" : "true");
    if (mobile) {
      sidebar.toggleAttribute("inert", !open);
      sidebar.setAttribute("aria-hidden", open ? "false" : "true");
    } else {
      sidebar.removeAttribute("inert");
      sidebar.removeAttribute("aria-hidden");
    }
  }

  function focusSidebarEntry() {
    const sidebar = $("#sidebar");
    if (!sidebar || sidebar.hasAttribute("inert")) return;
    const target =
      sidebar.querySelector('.nav-item[aria-current="page"]') ||
      sidebar.querySelector(".nav-item.active") ||
      sidebar.querySelector(".nav-item");
    target?.focus({ preventScroll: true });
  }

  function setSidebarOpen(open, options = {}) {
    const sidebar = $("#sidebar");
    const mobile = mobileSidebarQuery.matches;
    const wasOpen = mobile && document.body.classList.contains("sidebar-open");
    const next = mobile && Boolean(open);
    if (next && !wasOpen) sidebarReturnFocus = options.trigger || document.activeElement;
    document.body.classList.toggle("sidebar-open", next);
    setSidebarTriggerState(next);

    if (!next) {
      const returnTarget = sidebarReturnFocus;
      sidebarReturnFocus = null;
      const restoreFocus = options.restoreFocus ?? wasOpen;
      if (restoreFocus && returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      } else if (mobile && sidebar?.contains(document.activeElement)) {
        ($("#menuToggle") || $("#tabMore"))?.focus({ preventScroll: true });
      }
    }

    syncSidebarAccessibility();
    if (next && options.focus !== false) requestAnimationFrame(focusSidebarEntry);
  }

  function handleSidebarBreakpoint() {
    const sidebar = $("#sidebar");
    const enteringMobile = mobileSidebarQuery.matches;
    const focusWasInSidebar = sidebar?.contains(document.activeElement);
    document.body.classList.remove("sidebar-open");
    sidebarReturnFocus = null;
    if (enteringMobile && focusWasInSidebar) {
      ($("#menuToggle") || $("#tabMore"))?.focus({ preventScroll: true });
    }
    syncSidebarAccessibility();
  }

  if (typeof mobileSidebarQuery.addEventListener === "function") {
    mobileSidebarQuery.addEventListener("change", handleSidebarBreakpoint);
  } else {
    mobileSidebarQuery.addListener(handleSidebarBreakpoint);
  }
  syncSidebarAccessibility();
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
      // 桌面侧栏与手机底栏是两个独立导航地标，均需向辅助技术标记当前页。
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    const moreTab = $("#tabMore");
    const moreActive = !["home", "watch"].includes(view);
    moreTab?.classList.toggle("active", moreActive);
    if (moreActive) moreTab?.setAttribute("aria-current", "page");
    else moreTab?.removeAttribute("aria-current");
    // 懒渲染:切到该视图才调对应 render(已有数据则重渲染,无数据则显示待生成)
    const fn = VIEW_RENDER[view];
    if (fn) { try { Promise.resolve(fn()).catch((e) => console.warn("render " + view + " failed", e)); } catch (e) { console.warn("render " + view + " failed", e); } }
    // 移动端:切完关侧栏
    setSidebarOpen(false);
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
  window.addEventListener("hashchange", () => {
    const requested = hashViewName();
    const view = VIEW_RENDER[requested] ? requested : "home";
    switchView(view, {
      syncHash: requested !== view,
      replaceHash: requested !== view,
    });
  });
  // 汉堡菜单(移动端)
  const mt = $("#menuToggle");
  if (mt) mt.addEventListener("click", (event) =>
    setSidebarOpen(!document.body.classList.contains("sidebar-open"), { trigger: event.currentTarget })
  );
  // 底部导航「更多」(移动端):同样开合侧栏抽屉
  const tm = $("#tabMore");
  if (tm) tm.addEventListener("click", (event) =>
    setSidebarOpen(!document.body.classList.contains("sidebar-open"), { trigger: event.currentTarget })
  );
  const sb = $("#sidebarBackdrop");
  if (sb) sb.addEventListener("click", () => setSidebarOpen(false));

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
      if (document.body.classList.contains("sidebar-open")) {
        setSidebarOpen(false, { restoreFocus: true });
      }
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
      renderGlobalSearch(q);
      clearTimeout(gridFilterTimer);
      gridFilterTimer = setTimeout(() => {
        if (curView === "watch") renderWatch();
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

  // 状态栏 + 命令栏（终端风格）
  const sbDateTime = $("#sbDateTime");
  const sbMarket = $("#sbMarket");
  const sbData = $("#sbData");
  const bbClock = $("#bbClock");

  // 交易日历（休市日）缓存：fetch 失败时回退到「工作日 + 交易时段」逻辑
  let closedMarketDates = null;
  const isTrading = (d) => {
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    const mins = d.getHours() * 60 + d.getMinutes();
    if (!((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900))) return false;
    if (Array.isArray(closedMarketDates)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (closedMarketDates.includes(dateStr)) return false;
    }
    return true;
  };
  // 异步加载休市日历（market_calendar.json，格式 closedWeekdays: [...]）；失败静默回退
  if (typeof fetch === "function") {
    fetch("market_calendar.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.closedWeekdays)) closedMarketDates = data.closedWeekdays;
      })
      .catch(() => {});
  }
  const updateClock = () => {
    const d = new Date();
    const dateStr = d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
    const timeStr = d.toLocaleTimeString("zh-CN", { hour12: false });
    const wd = "日一二三四五六"[d.getDay()];
    if (sbDateTime) sbDateTime.textContent = `${dateStr} 周${wd} ${timeStr}`;
    if (bbClock) bbClock.textContent = "实时 " + timeStr;
    if (sbMarket) {
      const open = isTrading(d);
      sbMarket.textContent = open ? "交易中" : "休市";
      sbMarket.classList.toggle("open", open);
    }
    const sessionLabel = $("#sbSessionLabel");
    if (sessionLabel) {
      const m = d.getMonth() + 1;
      const day = d.getDate();
      sessionLabel.textContent = isTrading(d) ? `${m}月${day}日 · 盘中速览` : `${m}月${day}日 · 收盘复盘`;
    }
  };
  updateClock();
  setInterval(updateClock, 1000);

  // 状态栏数据（北向/涨停跌停炸板，读 market.js 的实际字段）
  const updateSbData = () => {
    if (!sbData) return;
    const M = window.MARKET || {};
    const items = [];
    const net = northboundYi(M.northbound);
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
     扩展模块渲染: Home / 市场扫描 / 逻辑链 / 今日热点事件 / 周末发酵等
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

  let searchIndex = null;
  function addSearchItem(list, type, title, meta, text, view, code) {
    const hay = [type, title, meta, text, code].filter(Boolean).join(" ").toLowerCase();
    list.push({ type, title, meta, text, view, code, hay });
  }

  function buildSearchIndex() {
    const list = [];
    STOCKS.forEach((s) => {
      addSearchItem(list, "巨头核心", s.name, `${s.code} · ${s.sector}`, [s.narrative, (s.tags || []).join(" "), s.review?.change].join(" "), "watch", s.code);
      (s.news || []).slice(0, 3).forEach((n) => addSearchItem(list, "个股新闻", n.title, `${s.name} · ${n.date || ""}`, n.source || "", "watch", s.code));
    });
    (window.LOGIC?.chains || []).forEach((c) => addSearchItem(list, "逻辑链", c.name, c.event_type || "", [c.event, c.logic, c.invalidation].filter(Boolean).join(" "), "logic"));
    (window.EVENTS?.events || []).forEach((e) => addSearchItem(list, "事件", e.title, e.importance || "", [e.content, e.sectors].join(" "), "events"));
    // 市场扫描榜单（涨停/异动/热榜等）：股票代码+名称入索引，命中后跳转市场页
    const mkPools = ["topGainers", "topLosers", "topTurnover", "topInflow", "topOutflow", "limitUp", "limitDown", "brokeUp", "hotRank"];
    const MK = window.MARKET || {};
    mkPools.forEach((p) => {
      (MK[p] || []).forEach((x) => {
        if (x && x.code && x.name) {
          addSearchItem(list, "市场扫描", x.name, `${x.code} · ${p}`, [x.industry, x.reason, x.zt_stat, x.lbc && `${x.lbc}连板`].filter(Boolean).join(" "), "market", x.code);
        }
      });
    });
    addSearchItem(list, "外围热点", "外围热点", "每日 23:00", "海外 AI 宏观 财经 股市 中文日报", "xbrief");
    (window.XBRIEFS?.briefs || []).forEach((b) => {
      const title = `外围热点 · ${b.time || b.id || b.period || "最新一期"}`;
      addSearchItem(list, "外围热点", title, b.period || "", b.content || "", "xbrief");
    });
    (window.WEEKEND?.hotspots || []).forEach((h) => {
      addSearchItem(
        list,
        "周末发酵",
        h.title,
        [h.category, h.fermentLevel && `发酵 ${h.fermentLevel}`].filter(Boolean).join(" · "),
        [h.event, h.interpretation, h.falsifyRisk, h.mondayStrategy, ...(h.impactSectors || [])].filter(Boolean).join(" "),
        "weekend"
      );
    });
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
      if (title === key && x.type === "巨头核心") return 950;
      if (title === key) return 900;
      if (code.startsWith(key)) return 800;
      if (title.startsWith(key)) return 700;
      if (x.type === "巨头核心") return 500;
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
    if (item.code) {
      switchView(item.view === "market" ? "market" : "watch");
      setTimeout(() => openDrawer(item.code), 80);
    } else jumpToModuleItem(item.view || "home", item.title);
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
    const nbYi = northboundYi(MARKET.northbound);
    const L = window.LOGIC;
    const E = window.EVENTS;
    const evtMeta = researchSessionMeta(E);
    const logicMeta = researchSessionMeta(L);
    const middayHint = evtMeta.kind === "midday" || logicMeta.kind === "midday"
      ? `<div class="home-snap-hint" role="note">事件/逻辑链为午间快照（${esc([evtMeta.stamp, logicMeta.stamp].filter(Boolean)[0] || "盘中")}），指数与收盘总述以收盘口径为准。</div>`
      : "";

    const regimeText = cleanDisplayText(META.marketRegime || "").trim();
    const summaryText = cleanDisplayText(META.summary || "").trim();
    const regimeHtml = (regimeText || summaryText)
      ? `<section class="home-regime">
          <div class="hm-head">
            <h3 class="hm-title">收盘总述</h3>
            <span class="hm-date">截至 ${esc((ms && ms.date) || META.signalDate || "")} 收盘</span>
          </div>
          ${regimeText ? `<div class="home-regime-block"><div class="home-regime-kicker">指数结构</div><p class="home-regime-body">${esc(regimeText)}</p></div>` : ""}
          ${summaryText && summaryText !== regimeText ? `<div class="home-regime-block"><div class="home-regime-kicker">信号统计</div><p class="home-regime-body">${esc(summaryText)}</p></div>` : (!regimeText && summaryText ? `<p class="home-regime-body">${esc(summaryText)}</p>` : "")}
        </section>`
      : "";

    // 各模块"最强"选取规则
    // 今日热点事件: importance 最高（评级统一取 app_ai_modules.js 挂载的 App.impRank）
    const impRank = (window.App && window.App.impRank) || {};
    const bestEvt = (E && E.events || []).slice().sort((a, b) => (impRank[b.importance] || 0) - (impRank[a.importance] || 0))[0];
    // 逻辑链: 按 Agent 给出的强度评级取最强（模块级唯一定义）
    const bestLogic = (L && L.chains || []).slice().sort((a, b) => (logicStrengthRank[b.strength] || 0) - (logicStrengthRank[a.strength] || 0))[0];

    // 精华卡: 标签 + 标题 + 一句话精华 + 强度徽章 + 跳转目标
    const cards = [
      bestEvt ? {
        tag: "今日热点事件", tagCls: "up", go: "events", xname: bestEvt.title,
        title: bestEvt.title,
        essence: bestEvt.importance_reason ? trunc(bestEvt.importance_reason) : "—",
        badge: bestEvt.importance || "", badgeCls: "ok",
        session: evtMeta
      } : null,
      bestLogic ? {
        tag: "逻辑链", tagCls: "ok", go: "logic", xname: bestLogic.name,
        title: bestLogic.name,
        essence: bestLogic.logic ? trunc(bestLogic.logic) : "—",
        badge: bestLogic.strength || "", badgeCls: "warn",
        session: logicMeta
      } : null,
    ].filter(Boolean);

    const cardHtml = cards.map((c) => `
      <article class="home-best ${c.tagCls}${c.session && c.session.kind === "midday" ? " is-midday" : ""}" data-go="${esc(c.go)}" data-xname="${esc(c.xname || "")}" role="button" tabindex="0" aria-label="打开${esc(c.tag)}：${esc(c.title)}">
        <div class="hb-top">
          <span class="hb-tag ${c.tagCls}">${esc(c.tag)}</span>
          <span class="hb-badges">
            ${c.session && c.session.label ? `<span class="hb-session ${c.session.kind === "midday" ? "warn" : "ok"}">${esc(c.session.label)}</span>` : ""}
            <span class="hb-badge ${c.badgeCls}">${esc(c.badge)}</span>
          </span>
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
          <span class="hm-date">截至 ${esc((ms && ms.date) || "")} 收盘</span>
        </div>
        <div class="idx-grid">${ixHtml}</div>
        <div class="hm-sentiment">
          <div class="sent-block up"><div class="sb-n">${s.zt_count ?? "—"}</div><div class="sb-l">涨停</div></div>
          <div class="sent-block warn"><div class="sb-n">${s.zb_count ?? "—"}</div><div class="sb-l">炸板</div></div>
          <div class="sent-block down"><div class="sb-n">${s.dt_count ?? "—"}</div><div class="sb-l">跌停</div></div>
          <div class="sent-block"><div class="sb-n">${s.break_rate ?? "—"}<span class="sb-u">%</span></div><div class="sb-l">炸板率</div></div>
          <div class="sent-block"><div class="sb-n">${s.max_height ?? "—"}<span class="sb-u">板</span></div><div class="sb-l">最高连板</div></div>
          ${nbYi != null ? `<div class="sent-block ${sgn(nbYi)}"><div class="sb-n">${nbYi > 0 ? "+" : ""}${nbYi.toFixed(2)}<span class="sb-u">亿</span></div><div class="sb-l">北向净额</div></div>` : ""}
        </div>
      </section>
      ${regimeHtml}
      ${middayHint}
      ${ddStrip}
      <button class="home-market-link" id="homeMarketLink" type="button">
        <span class="hml-t">市场扫描</span>
        <span class="hml-d">涨停梯队 · 炸板跌停 · 涨幅/成交异动</span>
        <span class="hml-go">查看 ↗</span>
      </button>
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
    $("#homeMarketLink")?.addEventListener("click", () => switchView("market"));
  }

  /* ---------- 市场扫描（只读，复用 market.js） ---------- */
  function renderMarket() {
    const el = $("#viewMarket");
    if (!el) return;
    const MK = window.MARKET || {};
    const sent = MK.sentiment || {};
    const nbYi = northboundYi(MK.northbound);
    const ladder = sent.ladder || {};
    const ladderHtml = Object.keys(ladder).length
      ? Object.entries(ladder)
          .sort((a, b) => Number(b[0]) - Number(a[0]))
          .map(([boards, count]) => `<div class="ms-ladder-item"><span class="ms-l-n">${esc(boards)}板</span><span class="ms-l-c">${esc(count)}</span></div>`)
          .join("")
      : `<div class="empty-inline">连板梯队待生成</div>`;

    const listBlock = (title, rows, mapRow) => {
      const cap = (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 720px)").matches) ? 6 : 8;
      const items = (rows || []).slice(0, cap);
      if (!items.length) return "";
      return `<section class="ms-block">
        <h3 class="ms-h">${esc(title)}</h3>
        <div class="ms-list">${items.map(mapRow).join("")}</div>
      </section>`;
    };
    const stockRow = (x, extra) => {
      const code = x.code || "";
      const inWatch = STOCKS.some((s) => s.code === code);
      const chg = x.pct != null ? x.pct : x.chgPct;
      const sub = extra || code;
      // 不用 native disabled：移动端会把整行洗成灰字，失去行情表阅读感
      return `<button type="button" class="ms-row${inWatch ? " in-watch" : " is-readonly"}" data-code="${esc(code)}" ${inWatch ? "" : 'aria-disabled="true"'}>
        <span class="ms-left">
          <span class="ms-name">${esc(x.name || "—")}</span>
          ${sub ? `<span class="ms-sub">${esc(sub)}</span>` : ""}
        </span>
        <span class="ms-pct ${sgn(chg)}">${pct(chg)}</span>
      </button>`;
    };

    el.innerHTML = `
      <div class="ms-page">
      ${secTitle("市场扫描", `情绪与异动只读 · ${esc(MK.generatedAt || MK.date || "")}`)}
      <section class="ms-sentiment">
        <div class="sent-block up"><div class="sb-n">${sent.zt_count ?? "—"}</div><div class="sb-l">涨停</div></div>
        <div class="sent-block warn"><div class="sb-n">${sent.zb_count ?? "—"}</div><div class="sb-l">炸板</div></div>
        <div class="sent-block down"><div class="sb-n">${sent.dt_count ?? "—"}</div><div class="sb-l">跌停</div></div>
        <div class="sent-block"><div class="sb-n">${sent.break_rate ?? "—"}<span class="sb-u">%</span></div><div class="sb-l">炸板率</div></div>
        <div class="sent-block"><div class="sb-n">${sent.max_height ?? "—"}<span class="sb-u">板</span></div><div class="sb-l">最高连板</div></div>
        ${nbYi != null ? `<div class="sent-block ${sgn(nbYi)}"><div class="sb-n">${nbYi > 0 ? "+" : ""}${Number(nbYi).toFixed(2)}<span class="sb-u">亿</span></div><div class="sb-l">北向</div></div>` : ""}
      </section>
      <section class="ms-block">
        <h3 class="ms-h">连板梯队</h3>
        <div class="ms-ladder">${ladderHtml}</div>
      </section>
      <div class="ms-grid">
        ${listBlock("涨停摘要", MK.limitUp, (x) => stockRow(x, x.zt_stat || (x.limit_days ? `${x.limit_days}天` : "")))}
        ${listBlock("炸板", MK.brokeUp, (x) => stockRow(x, x.industry || ""))}
        ${listBlock("跌停", MK.limitDown, (x) => stockRow(x, x.industry || ""))}
        ${listBlock("涨幅靠前", MK.topGainers, (x) => stockRow(x, x.industry || ""))}
        ${listBlock("成交额靠前", MK.topTurnover, (x) => { const a = toNum(x.amount); return stockRow(x, Number.isFinite(a) ? `${(a / 1e8).toFixed(1)}亿` : ""); })}
      </div>
      <div class="home-foot">点亮行可打开自选池内标的详情；池外仅展示 · 非投资建议</div>
      </div>
    `;
    el.querySelectorAll(".ms-row.in-watch[data-code]").forEach((btn) => {
      btn.addEventListener("click", () => openDrawer(btn.dataset.code));
    });
  }


  /* ---------- 跨条目定位：首页重点卡片点击后跳到对应模块并高亮 ---------- */
  function jumpToModuleItem(view, name) {
    switchView(view);
    if (!name) return;
    const tryFocus = (attempt) => {
      const target = [...document.querySelectorAll(`.${view}-only [data-xname]`)]
        .find((node) => node.dataset.xname === name);
      if (target) {
        if (view === "xbrief" && target.classList.contains("xb-article") && !target.classList.contains("active")) {
          const railItem = [...document.querySelectorAll(".xbrief-only .xb-rail-item")]
            .find((node) => node.dataset.i === target.dataset.i);
          railItem?.click();
        }
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("flash-target");
        setTimeout(() => target.classList.remove("flash-target"), 1800);
        return;
      }
      if (attempt < 8) requestAnimationFrame(() => tryFocus(attempt + 1));
    };
    requestAnimationFrame(() => tryFocus(0));
  }

  // 暴露核心到 window.App，供拆分模块解构使用。
  // 逻辑链、外围热点、事件和周末模块由 app_ai_modules.js 注册。
  window.App = {
    STOCKS, META, MARKET,
    state,
    get curView() { return curView; },
    $, grid, viewScrollRoot,
    cleanDisplayText, esc, safeUrl, northboundYi, isUnverifiedText, researchSessionMeta, isFundStale, displayImportance,
    logicStrengthRank,
    getStockReferenceIndex, isChanged, isOpportunity, latestDay, freshNews, matches, trendRank,
    sortList, sparkline, sgn, pct, fundChip, trendCls, drawdownPct, isDeepDrawdown, drawdownFlag, stateTone,
    card, liList, newsList, researchList,
    secTitle, trunc, emptyState, fieldHtml, titleShort, leadOf, blockHtml,
    drawerHeadHtml,
    renderMeta, renderMarketSnap, renderGauges, renderStats, renderChips,
    renderWatch, renderMarket, renderHome,
    showDrawer, openDrawer, closeDrawer, renderWatchDrawer, renderMarketDrawer, findMarketStock,
    switchView, syncViewLocation,
    renderGlobalSearch, closeSearchPanel,
  };

  // 启动函数由最后加载的 app_ai_modules.js 调用，确保可见研究模块已注册。
  window.App.start = function () {
    renderMeta();
    renderStats();
    renderChips();
    startLocalDataWatch();
    // 退休或未知 hash 一律规范化为 #home，不保留不可访问的历史地址。
    const requested = hashViewName();
    const initialView = VIEW_RENDER[requested] ? requested : "home";
    switchView(initialView, { replaceHash: !requested || requested !== initialView });

    // 全部脚本均为 defer，首屏渲染时数据已就绪；下方 DOMContentLoaded 重绑仅在
    // 脚本被以非 defer 方式加载（如测试夹具）时兜底，正常页面不会进入。
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        // defer 数据脚本已执行，重新绑定到最新全局数据并重置缓存索引
        STOCKS = window.STOCKS || [];
        META = window.META || {};
        MARKET = window.MARKET || {};
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
