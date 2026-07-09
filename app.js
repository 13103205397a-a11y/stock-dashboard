/* A股盘面 · 左侧导航 12 模块 — 渲染 / 筛选 / 详情抽屉 */
(function () {
  const STOCKS = window.STOCKS || [];
  const META = window.META || {};
  const MARKET = window.MARKET || {};
  const HOLDINGS = window.HOLDINGS || null;
  const INDUSTRY = window.INDUSTRY || null;
  const NEWSALL = window.NEWSALL || null;
  const REPORTS = window.REPORTS || {};
  const HOT = window.HOT || {};

  const state = { sector: "全部", verdict: "all", q: "", sort: "default" };
  const marketState = { anomaly: "gainers", q: "" };
  // 视图滚动位置记忆(A2):curView 跟踪当前视图,viewScroll 存各视图上次 scrollY
  let curView = "home";
  const viewScroll = new Map();

  const $ = (s) => document.querySelector(s);
  const grid = $("#grid");
  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const safeUrl = (u) => {
    try {
      const url = new URL(String(u), location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };

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
    // 2. 北向资金流向条
    if (nb.total_yi != null) {
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
      b.addEventListener("click", () => { state.sector = b.dataset.sector; renderChips(); render(); })
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
  const pct = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%");  // 主力净流入（亿元，A股惯例：流入为红、流出为绿）
  const fundChip = (s) => {
    const f = s.fund;
    if (!f || f.netInflow == null) return "";
    const n = f.netInflow, cls = n > 0 ? "up" : n < 0 ? "down" : "";
    return `<span class="fund ${cls}" title="主力净流入 · 同花顺问财（${esc(f.date || "")}）">主力 ${n > 0 ? "+" : ""}${n}亿</span>`;
  };
  const trendCls = (t) => (t === "多头排列" ? "t-up" : t === "空头排列" ? "t-down" : "t-flat");
  // 左/右信号状态 → 强度色：可介入=亮，观望/不足=暗
  function stateTone(txt, side) {
    if (!txt) return "";
    if (side === "left") return /已回踩至逢低区/.test(txt) ? "go" : /跌破|转弱/.test(txt) ? "warn" : "wait";
    return /已放量突破/.test(txt) ? "go" : /临近突破/.test(txt) ? "near" : /量能不足/.test(txt) ? "warn" : "wait";
  }

  function card(s, i) {
    const v = s.review?.verdict || "—";
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
        ${sparkline(g.spark, g.trend)}
      </div>` : "";
    // 买点状态：左侧命中/右侧命中/无 → 一句话
    const leftHit = /已回踩至逢低区/.test(g.leftState || "");
    const rightHit = /已放量突破|临近突破/.test(g.rightState || "");
    const hitTag = leftHit ? `<span class="hit-tag left-hit">左侧逢低</span>` : rightHit ? `<span class="hit-tag right-hit">右侧突破</span>` : "";
    return `<article class="card v-${v}${feat}" data-code="${esc(s.code)}" style="--i:${i ?? 0}">
      <div class="card-head">
        <div class="name-wrap">
          <span class="name">${esc(s.name)}</span>
          <span class="code">${esc(s.code)} · <span class="sector-tag">${esc(s.sector)}</span></span>
        </div>
        <span class="verdict-badge ${v}">${esc(v)}</span>
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

  function render() {
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

  function openDrawer(code) {
    document.body.style.overflow = "hidden";   // A1: 抽屉打开锁背景滚动
    const s = STOCKS.find((x) => x.code === code);
    if (!s) return;
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
      <div class="dh">
        <div>
          <div class="dname">${esc(s.name)} <span class="verdict-badge ${esc(r.verdict)}">${esc(r.verdict || "—")}</span></div>
          <div class="dcode">${esc(s.code)} · ${esc(s.sector)}</div>
        </div>
        <button class="dclose" id="dclose" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>

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
    $("#drawer").classList.add("show");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#backdrop").classList.add("show");
    $("#dclose").addEventListener("click", closeDrawer);
  }

  function closeDrawer() {
    $("#drawer").classList.remove("show");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#backdrop").classList.remove("show");
    document.body.style.overflow = "";          // A1: 关闭恢复背景滚动
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
    const chg = m.chgPct;
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
    return `<article class="market-card ${chgCls}" data-code="${esc(code)}">
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
      ${nb && nb.total_yi != null ? `<div class="sent-group"><span class="sent-label">北向资金</span><span class="sent-val ${sgn(nb.total_yi)}">净${nb.total_yi > 0 ? "流入" : "流出"} ${Math.abs(nb.total_yi).toFixed(2)}亿</span><span class="sent-mini">沪${(nb.hgt_yi ?? 0).toFixed(2)} 深${(nb.sgt_yi ?? 0).toFixed(2)}</span></div>` : ""}
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
    el.querySelectorAll(".market-card").forEach((c) =>
      c.addEventListener("click", () => openMarketDrawer(c.dataset.code))
    );
    const count = $("#count");
    if (count) count.textContent = `${def.title} · 显示 ${shown.length} / ${list.length} 只`;
  }

  // 异动票详情抽屉(降级版:若在 STOCKS 里则用完整叙事抽屉,否则只显示行情)
  function openMarketDrawer(code) {
    document.body.style.overflow = "hidden";   // A1: 抽屉打开锁背景滚动
    const inWatch = STOCKS.find((x) => x.code === code);
    if (inWatch) { openDrawer(code); return; }
    // 从 MARKET 各池里找这只票
    const pools = ["topGainers","topLosers","topTurnover","topInflow","topOutflow",
                   "limitUp","limitDown","brokeUp","hotRank"];
    let m = null;
    for (const p of pools) {
      const found = (MARKET[p] || []).find((x) => x.code === code);
      if (found) { m = found; break; }
    }
    if (!m) { closeDrawer(); return; }
    const chg = m.chgPct;
    const industry = typeof m.industry === "string" ? m.industry : (m.industry || []).join("/");
    const netflow = m.netInflow != null ? m.netInflow / 1e8 : null;
    $("#drawerInner").innerHTML = `
      <div class="dh">
        <div>
          <div class="dname">${esc(m.name)} <span class="mc-hl up">${m.lbc ? m.lbc + "连板" : ""}</span></div>
          <div class="dcode">${esc(m.code)} · ${esc(industry || "—")}</div>
        </div>
        <button class="dclose" id="dclose" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="dsec">
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
      </div>
      ${m.reason ? `<div class="dsec"><h3>异动原因 / 题材</h3><p class="dnarr">${esc(m.reason)}</p></div>` : ""}
      <div class="dsec">
        <h3>说明</h3>
        <p class="dnarr" style="color:var(--muted)">此为全市场异动池中的票,非巨头核心自选,仅展示轻量行情。如需深度叙事/买卖计划,需手动加入巨头清单。</p>
      </div>
    `;
    $("#drawer").classList.add("show");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#backdrop").classList.add("show");
    $("#dclose").addEventListener("click", closeDrawer);
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
    const hd = $("#hotDate");
    if (hd) hd.textContent = HOT.date ? `更新于 ${HOT.generatedAt || HOT.date}` : "";
  }

  // 11 个模块的视图切换 + 懒渲染调度
  const VIEW_RENDER = {
    home: () => renderHome(),
    holdings: () => renderHoldings(),
    opportunities: () => renderOpportunities(),
    logic: () => renderLogic(),
    agent: () => renderReports(),
    industry: () => renderIndustry(),
    materials: () => renderMaterials(),
    weekend: () => renderWeekend(),
    events: () => renderEvents(),
    news: () => renderNewsAll(),
    watch: () => render(),
    market: () => renderMarket(),
    hot: () => renderHot(),
  };
  function switchView(view) {
    // A2: 切走前记住当前视图滚动位置
    viewScroll.set(curView, window.scrollY);
    // 清掉所有 view-* class,再设当前
    document.body.classList.forEach((c) => { if (c.startsWith("view-")) document.body.classList.remove(c); });
    document.body.classList.add("view-" + view);
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    // 懒渲染:切到该视图才调对应 render(已有数据则重渲染,无数据则显示待生成)
    const fn = VIEW_RENDER[view];
    if (fn) { try { Promise.resolve(fn()).catch((e) => console.warn("render " + view + " failed", e)); } catch (e) { console.warn("render " + view + " failed", e); } }
    // 移动端:切完关侧栏
    document.body.classList.remove("sidebar-open");
    // A2: 恢复该视图上次滚动位置;首次访问回顶(与原行为一致)
    window.scrollTo(0, viewScroll.get(view) ?? 0);
    curView = view;
    // 更新计数文案
    const cnt = $("#count");
    if (cnt && view === "watch") cnt.textContent = `显示 ${STOCKS.length} / ${STOCKS.length} 只`;
  }
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );
  // 汉堡菜单(移动端)
  const mt = $("#menuToggle");
  if (mt) mt.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  const sb = $("#sidebarBackdrop");
  if (sb) sb.addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  /* ---------- 事件 ---------- */
  $("#backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  // 搜索功能已移除
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  document.querySelectorAll(".verdict-chip").forEach((b) =>
    b.addEventListener("click", () => { state.verdict = b.dataset.verdict; renderChips(); render(); })
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

  // 状态栏数据（北向/涨跌/涨停，从现有数据读取）
  const updateSbData = () => {
    if (!sbData) return;
    const M = window.META || {};
    const items = [];
    // 北向资金
    if (M.northbound) {
      const nb = M.northbound;
      const net = nb.net_total ?? nb.net;
      if (net != null) {
        const cls = net >= 0 ? "up" : "down";
        const sign = net >= 0 ? "+" : "";
        items.push(`<span class="sb-item"><span class="sb-lbl">北向</span><span class="sb-val ${cls}">${sign}${(net).toFixed(1)}亿</span></span>`);
      }
    }
    // 涨跌家数
    if (M.breadth) {
      const b = M.breadth;
      if (b.up != null) items.push(`<span class="sb-item"><span class="sb-lbl">▲</span><span class="sb-val up">${b.up}</span></span>`);
      if (b.down != null) items.push(`<span class="sb-item"><span class="sb-lbl">▼</span><span class="sb-val down">${b.down}</span></span>`);
    }
    // 涨停/炸板
    if (M.limitUp) {
      const lu = M.limitUp;
      if (lu.zt_count != null) items.push(`<span class="sb-item"><span class="sb-lbl">涨停</span><span class="sb-val up">${lu.zt_count}</span></span>`);
      if (lu.zb_count != null) items.push(`<span class="sb-item"><span class="sb-lbl">炸板</span><span class="sb-val" style="color:var(--warn)">${lu.zb_count}</span></span>`);
      if (lu.dt_count != null) items.push(`<span class="sb-item"><span class="sb-lbl">跌停</span><span class="sb-val down">${lu.dt_count}</span></span>`);
    }
    sbData.innerHTML = items.join("");
  };
  setTimeout(updateSbData, 300); // 等数据加载

  /* ===================================================================
     新增 6 个模块渲染: Home / 持仓决策 / 机会清单 / 逻辑链 / 产业雷达 / 事件概率 / 新闻
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
  // summaryHtml 概述文字保持段落，不列化（避免斜杠/句号被误拆）
  const summaryHtml = (s) => {
    if (!s) return "";
    if (Array.isArray(s)) {
      const items = s.map((x) => String(x).trim()).filter(Boolean);
      if (!items.length) return "";
      if (items.length === 1) return `<div class="sd-summary"><p class="sd-v">${esc(items[0])}</p></div>`;
      const lis = items.map((it, i) => `<li><span class="sum-idx">${i + 1}</span><span class="sum-txt">${esc(it)}</span></li>`).join("");
      return `<div class="sd-summary"><ol class="sd-field-list">${lis}</ol></div>`;
    }
    const t = String(s).trim();
    if (!t) return "";
    return `<div class="sd-summary"><p class="sd-v">${esc(t)}</p></div>`;
  };
  // 亿/万 格式化
  const fmtYi = (n) => n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(2) + "亿";
  const fmtWan = (n) => n == null ? "—" : (n > 0 ? "+" : "") + (n / 1e4).toFixed(0) + "万";

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
    // 产业雷达: confidence 最高(高>中高>中),取第一个
    const confRank = { "高": 3, "中高": 2, "中": 1 };
    const bestInd = (I && I.directions || []).slice().sort((a, b) => (confRank[b.confidence] || 0) - (confRank[a.confidence] || 0))[0];
    // 材料涨价: intensity 最高(极强>强>中强)
    const intRank = { "极强": 4, "强": 3, "中强": 2, "中": 1 };
    const bestMat = (M && M.directions || []).slice().sort((a, b) => (intRank[b.intensity] || 0) - (intRank[a.intensity] || 0))[0];
    // 机会清单: priority 星最多
    const bestOpp = (O && O.directions || []).slice().sort((a, b) => (b.priority || "").length - (a.priority || "").length)[0];
    // 事件概率: importance 最高
    const impRank = { "高": 3, "中高": 2, "中": 1 };
    const bestEvt = (E && E.events || []).slice().sort((a, b) => (impRank[b.importance] || 0) - (impRank[a.importance] || 0))[0];
    // 逻辑链: 取第一个(产业链本身无强弱,取首位)
    const bestLogic = (L && L.chains || [])[0];

    // 精华卡: 标签 + 标题 + 一句话精华 + 强度徽章 + 跳转目标
    const cards = [
      bestOpp ? {
        tag: "机会清单", tagCls: "ok", go: "opportunities",
        title: bestOpp.name,
        essence: bestOpp.logic ? trunc(bestOpp.logic) : "—",
        badge: bestOpp.stage || "", badgeCls: "warn"
      } : null,
      bestInd ? {
        tag: "产业雷达", tagCls: "up", go: "industry",
        title: bestInd.name,
        essence: bestInd.price_signal ? trunc(bestInd.price_signal) : "—",
        badge: "置信度 " + (bestInd.confidence || "—"), badgeCls: "ok"
      } : null,
      bestMat ? {
        tag: "材料涨价", tagCls: "warn", go: "materials",
        title: bestMat.name,
        essence: bestMat.price ? trunc(bestMat.price) : "—",
        badge: bestMat.intensity || "", badgeCls: "up"
      } : null,
      bestEvt ? {
        tag: "事件概率", tagCls: "up", go: "events",
        title: bestEvt.title,
        essence: bestEvt.importance_reason ? trunc(bestEvt.importance_reason) : "—",
        badge: bestEvt.importance || "", badgeCls: "ok"
      } : null,
      bestLogic ? {
        tag: "逻辑链", tagCls: "ok", go: "logic",
        title: bestLogic.name,
        essence: bestLogic.bottleneck ? trunc(bestLogic.bottleneck) : "—",
        badge: "卡点", badgeCls: "warn"
      } : null,
    ].filter(Boolean);

    const cardHtml = cards.map((c) => `
      <article class="home-best ${c.tagCls}" data-go="${esc(c.go)}">
        <div class="hb-top">
          <span class="hb-tag ${c.tagCls}">${esc(c.tag)}</span>
          <span class="hb-badge ${c.badgeCls}">${esc(c.badge)}</span>
        </div>
        <h3 class="hb-title">${esc(c.title)}</h3>
        <p class="hb-essence">${esc(c.essence)}</p>
      </article>`).join("");

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
          ${nb && nb.total_yi != null ? `<div class="sent-block ${sgn(nb.total_yi)}"><div class="sb-n">${nb.total_yi > 0 ? "+" : ""}${nb.total_yi.toFixed(2)}<span class="sb-u">亿</span></div><div class="sb-l">北向净额</div></div>` : ""}
        </div>
      </section>
      ${secTitle("今日最强", "5个分析模块各取第1 · 点击查看详情")}
      <div class="home-best-grid">${cardHtml || emptyState("分析数据待生成")}</div>
      <div class="home-foot">数据时点 ${esc(MARKET.date || META.signalDate || "")} · 非投资建议</div>
    `;
    el.querySelectorAll(".home-best").forEach((c) => c.addEventListener("click", () => switchView(c.dataset.go)));
  }

  /* ---------- 2. 持仓决策 ---------- */
  // 持仓配置：优先 portfolio.json，降级 localStorage
  let PORTFOLIO_CFG = null;
  const PF_LS_KEY = "portfolio_cfg_v1";
  const isLocalServer = () => location.origin === "http://localhost:8787" || location.origin === "http://127.0.0.1:8787";
  const loadPortfolio = async () => {
    try {
      const r = await fetch("portfolio.json?t=" + Date.now());
      if (r.ok) {
        const data = await r.json();
        if (data.holdings && data.holdings.length) return data;
      }
    } catch {}
    // 降级 localStorage
    try {
      const ls = localStorage.getItem(PF_LS_KEY);
      if (ls) return JSON.parse(ls);
    } catch {}
    return { holdings: [] };
  };
  const savePortfolio = async (data) => {
    data.updated = new Date().toISOString().slice(0, 10);
    PORTFOLIO_CFG = data;
    try { localStorage.setItem(PF_LS_KEY, JSON.stringify(data)); } catch {}
    if (!isLocalServer()) {
      return { ok: true, msg: "已保存到浏览器本地（如需写入文件，请从本地服务器打开）" };
    }
    try {
      const r = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        const res = await r.json().catch(() => null);
        if (res && res.ok === false) return { ok: false, msg: res.msg || "保存失败" };
        return { ok: true, msg: (res && res.msg) || "已保存（同步到文件）" };
      }
      return { ok: true, msg: "已保存到本地（app_server 未启动）" };
    } catch {
      return { ok: true, msg: "已保存到本地（app_server 未启动）" };
    }
  };
  // 启动时同步：如果 localStorage 有数据但 portfolio.json 没有，推送上去
  const syncPortfolioToServer = async () => {
    try {
      if (!isLocalServer()) return;
      const ls = localStorage.getItem(PF_LS_KEY);
      if (!ls) return;
      const lsData = JSON.parse(ls);
      if (!lsData.holdings || !lsData.holdings.length) return;
      const r = await fetch("/api/portfolio");
      if (!r.ok) return;
      const srv = await r.json();
      const srvList = srv.data?.holdings || [];
      // localStorage 比 server 多或不同，同步上去
      if (JSON.stringify(lsData.holdings) !== JSON.stringify(srvList)) {
        await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lsData),
        });
        console.log("[portfolio] localStorage → portfolio.json 同步完成");
      }
    } catch {}
  };
  const portfolioToast = (msg, type = "info") => {
    const t = document.createElement("div");
    t.className = "pf-toast " + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3000);
  };
  // 评级 → 颜色 class
  const ratingClass = (r) => ({ "买入": "up", "增持": "up", "持有": "ok", "减持": "warn", "卖出": "down" }[r] || "");

  async function renderHoldings() {
    const el = $("#viewHoldings");
    if (!el) return;
    if (!PORTFOLIO_CFG) PORTFOLIO_CFG = await loadPortfolio();
    syncPortfolioToServer(); // 后台同步，不阻塞渲染
    const cfg = PORTFOLIO_CFG || { holdings: [] };
    const cfgList = cfg.holdings || [];
    // 行情数据 map（holdings.js）
    const hMap = {};
    (HOLDINGS?.list || []).forEach((h) => { hMap[h.code] = h; });
    // 分析数据 map（portfolio_analysis.js）
    const an = window.PORTFOLIO_ANALYSIS || { analyses: [] };
    const aMap = {};
    (an.analyses || []).forEach((a) => { aMap[a.code] = a; });

    const addBtn = `<div class="pf-toolbar"><button class="pf-add-btn" id="pfAddBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> 加持仓</button><span class="pf-updated">配置更新于 ${esc(cfg.updated || "—")}</span></div>`;

    if (!cfgList.length) {
      el.innerHTML = secTitle("持仓决策", "") + addBtn + emptyState("暂无持仓，点击「加持仓」添加");
      bindPfAdd(el);
      return;
    }

    const cards = cfgList.map((h) => {
      const code = h.code;
      const hd = hMap[code] || {};
      const v = hd.valuation || {};
      const f = hd.fund || {};
      const chg = hd.price != null && hd.lastClose ? ((hd.price / hd.lastClose - 1) * 100) : null;
      const a = aMap[code] || null;
      const reports = (hd.research || []).slice(0, 3).map((r) =>
        `<div class="rp-item"><div class="rp-meta"><span class="rp-rating buy">${esc(r.rating || "")}</span><span class="rp-org">${esc(r.org || "")}</span><span class="rp-date">${esc(r.date || "")}</span></div><div class="rp-title">${esc(r.title || "")}</div></div>`
      ).join("");
      // 分析区块
      const analysisHtml = a ? `
        <div class="pf-analysis">
          <div class="pf-an-head">
            <span class="pf-an-badge ${ratingClass(a.rating)}">${esc(a.rating || "—")}</span>
            ${a.score != null ? `<span class="pf-an-score">综合评分 <b>${a.score}</b>/100</span>` : ""}
            <span class="pf-an-updated">${esc(an.updated || "")}</span>
          </div>
          ${a.summary ? `<div class="pf-an-summary">${esc(a.summary)}</div>` : ""}
          ${a.fundamentals ? `<div class="pf-an-sec"><span class="sd-l">基本面+估值</span>${fieldHtml(a.fundamentals)}</div>` : ""}
          ${a.capital ? `<div class="pf-an-sec"><span class="sd-l">资金面</span>${fieldHtml(a.capital)}</div>` : ""}
          ${a.technicals ? `<div class="pf-an-sec"><span class="sd-l">技术面</span>${fieldHtml(a.technicals)}</div>` : ""}
          ${a.risks ? `<div class="pf-an-sec"><span class="sd-l">风险</span>${fieldHtml(a.risks)}</div>` : ""}
          ${a.noiseFilter ? `<div class="pf-an-sec"><span class="sd-l">市场噪音过滤</span>${fieldHtml(a.noiseFilter)}</div>` : ""}
          ${a.action ? `<div class="pf-an-sec pf-an-action"><span class="sd-l">操作建议</span>${fieldHtml(a.action)}</div>` : ""}
          ${(a.targetBuy || a.targetSell || a.stopLoss) ? `<div class="pf-an-points">
            ${a.targetBuy ? `<span class="pf-pt buy">建议买点 ¥${a.targetBuy}</span>` : ""}
            ${a.targetSell ? `<span class="pf-pt sell">建议卖点 ¥${a.targetSell}</span>` : ""}
            ${a.stopLoss ? `<span class="pf-pt stop">止损位 ¥${a.stopLoss}</span>` : ""}
          </div>` : ""}
        </div>` : `<div class="pf-analysis pf-an-empty">AI 综合分析待生成（Hermes 每日收盘后自动更新）</div>`;

      return `<article class="card blk hold-card">
        <div class="hc-top">
          <div><div class="hc-name">${esc(h.name || hd.name || code)} <span class="hc-code">${esc(code)}</span></div><div class="hc-sec">${esc((hd.concept || []).join(" / ") || hd.industry || h.note || "")}</div></div>
          <div class="hc-px"><span class="hc-price">¥${hd.price ?? "—"}</span>${chg != null ? `<span class="chg ${sgn(chg)}">${pct(chg)}</span>` : ""}</div>
        </div>
        ${h.buyPrice || h.shares || h.weight ? `<div class="pf-meta">
          ${h.buyPrice ? `<span>买入价 ¥${h.buyPrice}</span>` : ""}
          ${h.shares ? `<span>${h.shares} 股</span>` : ""}
          ${h.weight ? `<span>仓位 ${(h.weight * 100).toFixed(0)}%</span>` : ""}
        </div>` : ""}
        <div class="val-grid">
          <div class="vm"><span class="vm-l">PE(TTM)</span><span class="vm-v">${v.pe_ttm ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">前向PE</span><span class="vm-v">${v.pe_fwd ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">PEG</span><span class="vm-v ${v.peg != null && v.peg < 1 ? "up" : v.peg != null && v.peg > 2 ? "down" : ""}">${v.peg ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">市值</span><span class="vm-v">${v.mcap_yi != null ? v.mcap_yi + "亿" : "—"}</span></div>
          <div class="vm"><span class="vm-l">主力净流入</span><span class="vm-v ${sgn(f.netInflow)}">${fmtYi(f.netInflow)}</span></div>
          <div class="vm"><span class="vm-l">换手率</span><span class="vm-v">${f.turnover != null ? f.turnover + "%" : "—"}</span></div>
        </div>
        ${analysisHtml}
        ${reports ? `<div class="dsec"><h3>近期研报</h3><div class="research-list">${reports}</div></div>` : ""}
        <div class="hc-foot">
          <span class="hc-hint">数据时点 ${esc(HOLDINGS?.date || "")} · 机构覆盖 ${v.analyst_count ?? "—"}家</span>
          <button class="pf-del-btn" data-code="${esc(code)}" data-name="${esc(h.name || hd.name || code)}">删持仓</button>
        </div>
      </article>`;
    }).join("");

    el.innerHTML = secTitle("持仓决策", `${cfgList.length} 只持仓`) + addBtn + `<div class="hold-grid">${cards}</div>`;
    bindPfAdd(el);
    bindPfDel(el);
  }

  // 加持仓表单
  function bindPfAdd(el) {
    const btn = el.querySelector("#pfAddBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const existing = el.querySelector("#pfAddForm");
      if (existing) { existing.remove(); return; }
      const form = document.createElement("div");
      form.id = "pfAddForm";
      form.className = "pf-add-form";
      form.innerHTML = `
        <input class="pf-input" id="pfCode" placeholder="股票代码（如 605117）" maxlength="6" />
        <input class="pf-input" id="pfName" placeholder="股票名称（如 德业股份）" />
        <input class="pf-input" id="pfBuy" type="number" step="0.01" placeholder="买入价（可选）" />
        <input class="pf-input" id="pfShares" type="number" placeholder="股数（可选）" />
        <input class="pf-input" id="pfWeight" type="number" step="0.01" min="0" max="1" placeholder="仓位 0-1（可选）" />
        <input class="pf-input" id="pfNote" placeholder="备注（可选）" />
        <div class="pf-form-actions">
          <button class="pf-cancel" id="pfCancel">取消</button>
          <button class="pf-save" id="pfSave">添加</button>
        </div>`;
      btn.after(form);
      el.querySelector("#pfCancel").addEventListener("click", () => form.remove());
      el.querySelector("#pfSave").addEventListener("click", async () => {
        const code = el.querySelector("#pfCode").value.trim();
        const name = el.querySelector("#pfName").value.trim();
        if (!code || !/^\d{6}$/.test(code)) { portfolioToast("请输入 6 位股票代码", "error"); return; }
        if (!name) { portfolioToast("请输入股票名称", "error"); return; }
        if ((PORTFOLIO_CFG?.holdings || []).some((h) => h.code === code)) { portfolioToast("该股票已在持仓中", "error"); return; }
        const buy = parseFloat(el.querySelector("#pfBuy").value) || null;
        const shares = parseInt(el.querySelector("#pfShares").value) || null;
        const weight = parseFloat(el.querySelector("#pfWeight").value) || null;
        const note = el.querySelector("#pfNote").value.trim();
        const data = { ...PORTFOLIO_CFG };
        data.holdings = [...(data.holdings || []), { code, name, buyPrice: buy, shares, weight, note, addedAt: new Date().toISOString().slice(0, 10) }];
        const r = await savePortfolio(data);
        if (r.ok) { portfolioToast(r.msg || "持仓已添加", "success"); renderHoldings(); }
        else portfolioToast(r.msg || "保存失败", "error");
      });
    });
  }

  // 删持仓
  function bindPfDel(el) {
    el.querySelectorAll(".pf-del-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        const name = btn.dataset.name;
        if (!confirm(`确认删除 ${name}(${code})？`)) return;
        const data = { ...PORTFOLIO_CFG };
        data.holdings = (data.holdings || []).filter((h) => h.code !== code);
        const r = await savePortfolio(data);
        if (r.ok) { portfolioToast(r.msg || "持仓已删除", "success"); renderHoldings(); }
        else portfolioToast(r.msg || "删除失败", "error");
      });
    });
  }

  /* ---------- 3. 机会清单 ---------- */
  function renderOpportunities() {
    const el = $("#viewOpportunities");
    if (!el) return;
    const OPP = window.OPPORTUNITIES || null;
    if (!OPP || !OPP.directions || !OPP.directions.length) {
      el.innerHTML = secTitle("机会清单", "当日热点发酵分析") + emptyState("机会分析数据待生成。");
      return;
    }
    const stageCls = (st) => /初起/.test(st) ? "ok" : /扩散/.test(st) ? "warn" : /高潮/.test(st) ? "up" : /退潮/.test(st) ? "down" : "";
    const cards = OPP.directions.map((d) => {
      const stocks = (d.stocks || []).map((s) => {
        const posCls = /龙头/.test(s.position) ? "up" : /二线/.test(s.position) ? "ok" : "";
        return `<button class="ev-stock ${posCls}" data-code="${esc(s.code)}"><span class="is-name">${esc(s.name)}</span><span class="is-code">${esc(s.code)}</span><span class="ev-impact">${esc(s.position)}</span><span class="is-role">${esc(s.detail || "")}</span></button>`;
      }).join("");
      return `<article class="card blk opp-card">
        <div class="opp-head">
          <h3 class="sd-name">${esc(d.name)}</h3>
          <div class="opp-badges">
            <span class="ev-badge ev-stage ${stageCls(d.stage)}">${esc(d.stage || "")}</span>
            <span class="ev-badge ev-priority">${esc(d.priority || "")}</span>
          </div>
        </div>
        <div class="sd-grid">
          <div class="sd-item"><span class="sd-l">背后逻辑</span>${fieldHtml(d.logic || "—")}</div>
          <div class="sd-item"><span class="sd-l">发酵信号</span>${fieldHtml(d.signals || "—")}</div>
          <div class="sd-item sd-price"><span class="sd-l">机会挖掘</span>${fieldHtml(d.opportunity || "—")}</div>
          <div class="sd-item sd-risk"><span class="sd-l">风险提示</span>${fieldHtml(d.risk || "—")}</div>
        </div>
        <div class="sd-stocks"><span class="sd-l">相关个股</span><div class="sd-stock-list">${stocks}</div></div>
        <div class="sd-foot">数据时点 ${esc(d.asof || "")}</div>
      </article>`;
    }).join("");
    el.innerHTML = secTitle("机会清单", `当日热点发酵分析 · ${esc(OPP.date || "")}`) +
      (OPP.market_state ? summaryHtml(OPP.market_state) : "") +
      (OPP.summary ? summaryHtml(OPP.summary) : "") +
      `<div class="sd-grid-cards">${cards}</div>`;
    el.querySelectorAll(".ev-stock").forEach((b) => b.addEventListener("click", () => openMarketDrawer(b.dataset.code)));
  }

  /* ---------- 4. 逻辑链 ---------- */
  // 底层逻辑成立条件提取 + 强弱评分
  // 强信号关键词（好：成立强）
  const STRONG_POS = ["涨停", "成交最大", "全市场最大", "涨价落地", "正式落地", "紧缺加剧", "供不应求",
    "龙头确认", "产能停产", "停产", "2连板", "3连板", "4天3板", "暴涨", "爆发", "大幅上涨", "确认涨价",
    "涨幅超", "创新高", "历史新高", "订单爆满", "满产满销", "量产交付", "量产元年"];
  // 弱信号关键词（中：成立偏弱/预期）
  const WEAK_POS = ["偏紧", "预期", "有望", "预计", "反弹", "回暖", "复苏", "趋势", "拉动", "受益",
    "高景气", "渗透率提升", "国产替代", "需求爆发", "爬坡", "扩张"];
  // 负面/风险关键词（坏：不成立或风险）
  const NEGATIVE = ["自承不可持续", "不可持续", "透支", "下跌", "风险提示", "疲软", "调整",
    "回落", "下修", "不及预期", "否认", "占比小", "概念关联", "纯正标的稀缺",
    "回调风险", "获利盘", "压力", "质疑", "预警", "亏损", "下滑", "减产"];

  // 提取关键词所在短句（按标点切分，取关键词所在那一句）
  const extractSentence = (text, kw) => {
    if (!text || !kw) return null;
    // 按中文标点切分成短句
    const sentences = text.split(/[，。；,;\n。]/).map(s => s.trim()).filter(s => s.length > 3);
    for (const s of sentences) {
      if (s.includes(kw) && s.length >= 4 && s.length <= 60) {
        return s;
      }
    }
    // 如果整句太长，截取关键词前后 12 字
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      const start = Math.max(0, idx - 8);
      const end = Math.min(text.length, idx + kw.length + 12);
      return text.slice(start, end).trim();
    }
    return null;
  };

  const extractConditions = (chain) => {
    const logic = chain.logic || "";
    const bn = chain.bottleneck || "";
    const segs = chain.segments || [];
    const supplyTxt = segs.map((s) => s.supply || "").join(" ");
    const allText = logic + " " + bn + " " + supplyTxt;

    const conditions = [];
    const seen = new Set();
    const add = (text, type, score) => {
      const t = (text || "").trim();
      if (t.length < 4 || t.length > 60) return;
      // 去重：相同或包含关系
      const key = t.slice(0, 20);
      if (seen.has(key)) return;
      seen.add(key);
      conditions.push({ text: t, type, score });
    };

    STRONG_POS.forEach((kw) => {
      const s = extractSentence(allText, kw);
      if (s) add(s, "strong", 3);
    });
    WEAK_POS.forEach((kw) => {
      const s = extractSentence(allText, kw);
      if (s) add(s, "medium", 1);
    });
    NEGATIVE.forEach((kw) => {
      const s = extractSentence(allText, kw);
      if (s) add(s, "risk", -2);
    });
    return conditions;
  };

  const scoreChain = (chain) => {
    const conds = extractConditions(chain);
    const strongCnt = conds.filter((c) => c.type === "strong").length;
    const riskCnt = conds.filter((c) => c.type === "risk").length;
    const mediumCnt = conds.filter((c) => c.type === "medium").length;
    let score = strongCnt * 15 + mediumCnt * 5 - riskCnt * 10;
    score = Math.max(0, Math.min(100, score + 30));
    return { conditions: conds, score, strongCnt, mediumCnt, riskCnt };
  };

  const strengthLabel = (score) => {
    if (score >= 70) return { label: "强成立", cls: "up" };
    if (score >= 45) return { label: "成立", cls: "ok" };
    if (score >= 25) return { label: "弱成立", cls: "warn" };
    return { label: "不成立", cls: "down" };
  };

  function renderLogic() {
    const el = $("#viewLogic");
    if (!el) return;
    const LOGIC = window.LOGIC || null;
    if (!LOGIC || !LOGIC.chains || !LOGIC.chains.length) {
      el.innerHTML = secTitle("逻辑链", "产业链上下游拆解") + emptyState("产业链数据待生成。");
      return;
    }

    const scored = LOGIC.chains.map((c) => {
      const sc = scoreChain(c);
      return { chain: c, ...sc, strength: strengthLabel(sc.score) };
    }).sort((a, b) => b.score - a.score);

    const cards = scored.map((item, idx) => {
      const c = item.chain;
      const segs = (c.segments || []).map((s) => {
        const stocks = (s.stocks || []).map((st) =>
          `<button class="ind-stock" data-code="${esc(st.code)}"><span class="is-name">${esc(st.name)}</span><span class="is-code">${esc(st.code)}</span><span class="is-role">${esc(st.role || "")}</span></button>`
        ).join("");
        return `<div class="lc-seg">
          <div class="lc-seg-head"><span class="lc-stage">${esc(s.stage)}</span><span class="lc-supply ${s.supply && /紧|缺/.test(s.supply) ? "warn" : ""}">${esc((s.supply || "").slice(0, 30))}</span></div>
          <div class="lc-products">${fieldHtml(s.products || "—")}</div>
          ${stocks ? `<div class="sd-stock-list">${stocks}</div>` : '<div class="lc-no-stock">未点名核心A股</div>'}
        </div>`;
      }).join("");

      const strongList = item.conditions.filter((x) => x.type === "strong");
      const mediumList = item.conditions.filter((x) => x.type === "medium");
      const riskList = item.conditions.filter((x) => x.type === "risk");
      const condHtml = `
        <div class="lc-conditions">
          <div class="lc-cond-head">
            <span class="lc-cond-title">底层逻辑成立条件</span>
            <span class="lc-strength ${item.strength.cls}">${item.strength.label} ${item.score}</span>
          </div>
          <div class="lc-cond-meta">
            <span class="lc-cond-cnt up">强成立 ${strongList.length}</span>
            <span class="lc-cond-cnt ok">弱成立 ${mediumList.length}</span>
            <span class="lc-cond-cnt down">风险 ${riskList.length}</span>
          </div>
          ${strongList.length ? `<div class="lc-cond-group"><span class="lc-cond-lbl up">✓ 强成立</span><div class="lc-cond-items">${strongList.map((x) => `<div class="lc-cond-item up">${esc(x.text)}</div>`).join("")}</div></div>` : ""}
          ${mediumList.length ? `<div class="lc-cond-group"><span class="lc-cond-lbl ok">○ 弱成立</span><div class="lc-cond-items">${mediumList.map((x) => `<div class="lc-cond-item ok">${esc(x.text)}</div>`).join("")}</div></div>` : ""}
          ${riskList.length ? `<div class="lc-cond-group"><span class="lc-cond-lbl down">✗ 风险</span><div class="lc-cond-items">${riskList.map((x) => `<div class="lc-cond-item down">${esc(x.text)}</div>`).join("")}</div></div>` : ""}
        </div>`;

      return `<article class="card blk lc-chain ${item.strength.cls}">
        <div class="lc-chain-head">
          <div class="lc-chain-title"><span class="lc-rank">#${idx + 1}</span><h3 class="sd-name">${esc(c.name)}</h3></div>
          <span class="lc-asof">${esc(c.asof || "")}</span>
        </div>
        ${condHtml}
        <div class="lc-logic"><span class="sd-l">核心逻辑</span>${fieldHtml(c.logic || "—")}</div>
        <div class="lc-bottleneck"><span class="sd-l">卡脖子环节</span>${fieldHtml(c.bottleneck || "—")}</div>
        <div class="lc-segs"><span class="sd-l">上下游拆解</span>${segs}</div>
      </article>`;
    }).join("");

    el.innerHTML = secTitle("逻辑链", `产业链上下游拆解 · 按成立强度排序 · ${esc(LOGIC.date || "")}`) +
      (LOGIC.summary ? summaryHtml(LOGIC.summary) : "") +
      `<div class="sd-grid-cards">${cards}</div>`;
    el.querySelectorAll(".ind-stock").forEach((b) => b.addEventListener("click", () => openMarketDrawer(b.dataset.code)));
  }

  /* ---------- 6. 产业雷达 ---------- */
  function renderIndustry() {
    const el = $("#viewIndustry");
    if (!el) return;
    // 兼容两种数据: 旧的行业排名(type无) + 新的供需调研(type=supply_demand)
    if (!INDUSTRY || (!INDUSTRY.directions && !INDUSTRY.top)) {
      el.innerHTML = secTitle("产业雷达", "供需紧张 / 涨价方向调研") + emptyState("产业调研数据待生成。");
      return;
    }
    // 新版: 供需调研卡片
    if (INDUSTRY.directions) {
      const confCls = { "高": "up", "中高": "ok", "中": "warn", "低": "down" };
      const cards = INDUSTRY.directions.map((d) => {
        const stocks = (d.stocks || []).map((s) =>
          `<button class="ind-stock" data-code="${esc(s.code)}"><span class="is-name">${esc(s.name)}</span><span class="is-code">${esc(s.code)}</span><span class="is-role">${esc(s.role || "")}</span></button>`
        ).join("");
        return `<article class="card blk sd-card">
          <div class="sd-head">
            <h3 class="sd-name">${esc(d.name)}</h3>
            <span class="sd-conf ${confCls[d.confidence] || ""}">置信度 ${esc(d.confidence || "—")}</span>
          </div>
          <div class="sd-grid">
            <div class="sd-item"><span class="sd-l">供需状况</span>${fieldHtml(d.supply || "—")}</div>
            <div class="sd-item sd-price"><span class="sd-l">涨价信号</span>${fieldHtml(d.price_signal || "—")}</div>
            <div class="sd-item"><span class="sd-l">驱动因素</span>${fieldHtml(d.driver || "—")}</div>
            <div class="sd-item"><span class="sd-l">关键证据</span>${fieldHtml(d.evidence || "—")}</div>
            <div class="sd-item sd-risk"><span class="sd-l">风险 / 反向信号</span>${fieldHtml(d.risk || "—")}</div>
          </div>
          <div class="sd-stocks"><span class="sd-l">相关受益股</span><div class="sd-stock-list">${stocks}</div></div>
          <div class="sd-foot">数据时点 ${esc(d.asof || "")} · 仅供研究参考,非投资建议</div>
        </article>`;
      }).join("");
      el.innerHTML = secTitle("产业雷达", `供需紧张 / 涨价方向调研 · ${esc(INDUSTRY.date || "")}`) +
        (INDUSTRY.summary ? summaryHtml(INDUSTRY.summary) : "") +
        `<div class="sd-grid-cards">${cards}</div>`;
      el.querySelectorAll(".ind-stock").forEach((b) => b.addEventListener("click", () => openMarketDrawer(b.dataset.code)));
      return;
    }
    // 旧版兜底: 行业涨跌排名
    const rowHtml = (r) => `<div class="ind-row ${r.change_pct > 0 ? "up" : r.change_pct < 0 ? "down" : ""}"><span class="ind-rank">${esc(r.rank)}</span><span class="ind-name">${esc(r.name)}</span><span class="ind-chg">${r.change_pct > 0 ? "+" : ""}${esc(r.change_pct)}%</span><span class="ind-cnt">↑${esc(r.up_count)} ↓${esc(r.down_count)}</span><span class="ind-leader">龙头 ${esc(r.leader || "—")}</span></div>`;
    el.innerHTML = secTitle("产业雷达", `行业板块涨跌排名 · 共 ${INDUSTRY.total || 0} 个行业`) +
      `<div class="ind-cols"><section class="card blk"><h3 class="blk-h">涨幅前 ${(INDUSTRY.top||[]).length}</h3><div class="ind-list">${(INDUSTRY.top||[]).map(rowHtml).join("")}</div></section></div>`;
  }

  /* ---------- 6.5 材料涨价 ---------- */
  function renderMaterials() {
    const el = $("#viewMaterials");
    if (!el) return;
    const MAT = window.MATERIALS || null;
    if (!MAT || !MAT.directions || !MAT.directions.length) {
      el.innerHTML = secTitle("材料涨价", "原材料/大宗商品涨价调研") + emptyState("材料涨价数据待生成。");
      return;
    }
    const intCls = { "极强": "up", "强": "ok", "中强": "warn", "中": "warn", "弱": "down" };
    const cards = MAT.directions.map((d) => {
      const stocks = (d.stocks || []).map((s) =>
        `<button class="ind-stock" data-code="${esc(s.code)}"><span class="is-name">${esc(s.name)}</span><span class="is-code">${esc(s.code)}</span><span class="is-role">${esc(s.role || "")}</span></button>`
      ).join("");
      return `<article class="card blk mat-card">
        <div class="sd-head">
          <h3 class="sd-name">${esc(d.name)}</h3>
          <span class="sd-conf ${intCls[d.intensity] || ""}">涨价强度 ${esc(d.intensity || "—")}</span>
        </div>
        <div class="sd-grid">
          <div class="sd-item sd-price"><span class="sd-l">价格/涨幅</span>${fieldHtml(d.price || "—")}</div>
          <div class="sd-item"><span class="sd-l">涨价时点</span>${fieldHtml(d.timing || "—")}</div>
          <div class="sd-item"><span class="sd-l">涨价驱动</span>${fieldHtml(d.driver || "—")}</div>
          <div class="sd-item"><span class="sd-l">供需状况</span>${fieldHtml(d.supply || "—")}</div>
          <div class="sd-item"><span class="sd-l">下游应用</span>${fieldHtml(d.downstream || "—")}</div>
          <div class="sd-item sd-risk"><span class="sd-l">风险/反向信号</span>${fieldHtml(d.risk || "—")}</div>
        </div>
        <div class="sd-stocks"><span class="sd-l">相关受益股</span><div class="sd-stock-list">${stocks}</div></div>
        <div class="sd-foot">数据时点 ${esc(d.asof || "")} · 仅供研究参考,非投资建议</div>
      </article>`;
    }).join("");
    el.innerHTML = secTitle("材料涨价", `原材料/大宗商品涨价调研 · ${esc(MAT.date || "")}`) +
      (MAT.summary ? summaryHtml(MAT.summary) : "") +
      `<div class="sd-grid-cards">${cards}</div>`;
    el.querySelectorAll(".ind-stock").forEach((b) => b.addEventListener("click", () => openMarketDrawer(b.dataset.code)));
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
      const stocks = (h.impactStocks || []).map((s) =>
        `<button class="we-stock" data-code="${esc(s.code)}">${esc(s.name)} <span class="we-dir ${s.direction === "利好" ? "up" : s.direction === "利空" ? "down" : ""}">${esc(s.direction || "")}</span></button>`
      ).join("");
      return `<article class="card blk we-card">
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
    el.querySelectorAll(".we-stock[data-code]").forEach((b) => b.addEventListener("click", () => openMarketDrawer(b.dataset.code)));
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
    const cards = EVENTS.events.map((e) => {
      const stocks = (e.stocks || []).map((s) => {
        const impCls2 = s.impact === "受益" ? "up" : s.impact === "受损" ? "down" : "";
        return `<button class="ev-stock ${impCls2}" data-code="${esc(s.code)}"><span class="is-name">${esc(s.name)}</span><span class="is-code">${esc(s.code)}</span><span class="ev-impact">${esc(s.impact)}</span><span class="is-role">${esc(s.role || "")}</span></button>`;
      }).join("");
      return `<article class="card blk ev-card">
        <div class="ev-head">
          <h3 class="ev-title">${esc(e.title)}</h3>
          <div class="ev-badges">
            <span class="ev-badge ev-cat">${esc(e.category || "")}</span>
            <span class="ev-badge ev-imp ${impCls[e.importance] || ""}">${esc(e.importance || "")}</span>
            <span class="ev-badge ev-dir ${dirCls(e.direction)}">${esc(e.direction || "")}</span>
            <span class="ev-time">${esc(e.time || "")}</span>
          </div>
        </div>
        <div class="ev-content">${fieldHtml(e.content || "")}</div>
        <div class="ev-grid-info">
          <div class="ev-info"><span class="sd-l">重要性原因</span>${fieldHtml(e.importance_reason || "—")}</div>
          <div class="ev-info"><span class="sd-l">影响板块</span>${fieldHtml(e.sectors || "—")}</div>
          <div class="ev-info"><span class="sd-l">影响时效</span>${fieldHtml(e.timeliness || "—")}</div>
        </div>
        ${stocks ? `<div class="ev-stocks"><span class="sd-l">受影响个股</span><div class="sd-stock-list">${stocks}</div></div>` : ""}
        <div class="sd-foot">来源: ${esc(e.source || "—")}</div>
      </article>`;
    }).join("");
    el.innerHTML = secTitle("事件概率", `重要新闻影响分析 · ${esc(EVENTS.date || "")}`) +
      (EVENTS.summary ? summaryHtml(EVENTS.summary) : "") +
      `<div class="sd-grid-cards">${cards}</div>`;
    el.querySelectorAll(".ev-stock").forEach((b) => b.addEventListener("click", () => openMarketDrawer(b.dataset.code)));
  }

  /* ---------- 8. 新闻 ---------- */
  function renderNewsAll() {
    const el = $("#viewNews");
    if (!el) return;
    if (!NEWSALL) { el.innerHTML = secTitle("新闻", "个股新闻 / 全球资讯 / 公告") + emptyState("新闻数据待生成(每日由 fetch_news_all.py 自动更新)。"); return; }
    const globalHtml = (NEWSALL.global || []).slice(0, 20).map((n) =>
      `<div class="nf-item"><div class="nf-meta"><span class="nf-date">${esc((n.time || n.date || "").toString().slice(0, 16))}</span></div><div class="nf-text">${esc(n.title || "")}</div></div>`
    ).join("");
    const annHtml = (NEWSALL.announcements || []).slice(0, 30).map((n) =>
      `<div class="nf-item"><div class="nf-meta"><span class="nf-date">${esc((n.date || "").slice(0, 10))}</span><span class="nf-type">公告</span></div><div class="nf-text">${esc(n.title || n.announcementTitle || "")}</div></div>`
    ).join("");
    el.innerHTML = secTitle("新闻", "全球资讯 / 公告 · " + esc(NEWSALL.date || "")) +
      `<div class="news-cols">
        <section class="card blk"><h3 class="blk-h">全球资讯 7×24</h3><div class="newsfeed">${globalHtml || emptyState("无资讯")}</div></section>
        <section class="card blk"><h3 class="blk-h">近期公告</h3><div class="newsfeed">${annHtml || emptyState("无公告")}</div></section>
      </div>`;
  }



  // 极简 markdown → HTML（标题/表格/加粗/列表/分隔线）。不引外部库，够用。
  function md2html(md) {
    // 去 AI 味：移除 emoji 和装饰性符号（📊🔥🔴🟢⭐⚠️等），保留文字内容
    let text = (md || "")
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
    const list = REPORTS.reports || [];
    if (!list.length) { el.innerHTML = ""; return; }
    const tabs = list.map((r, i) =>
      `<button class="rep-tab ${i === 0 ? "active" : ""}" data-i="${i}">${esc(r.type)}<span class="rep-time">${esc((r.time || "").slice(5, 16))}</span></button>`
    ).join("");
    const bodies = list.map((r, i) =>
      `<div class="rep-body ${i === 0 ? "active" : ""}" data-i="${i}">
        <div class="rep-head"><h2>${esc(r.title || "")}</h2><span class="rep-updated">Hermes · ${esc(r.time || "")}</span></div>
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

  /* ---------- 启动 ---------- */
  renderMeta();
  renderStats();
  renderChips();
  // 默认进 Home 视图(其他视图切到时再懒渲染)
  switchView("home");
})();
