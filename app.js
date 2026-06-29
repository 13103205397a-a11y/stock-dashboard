/* A股盘面 · 左侧导航 11 模块 — 渲染 / 筛选 / 详情抽屉 */
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

  const $ = (s) => document.querySelector(s);
  const grid = $("#grid");
  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  /* ---------- 顶栏 / 统计 ---------- */
  function renderMeta() {
    const day = META.signalDate || META.lastUpdated || "—";
    $("#updated").textContent = day;
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
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  }

  const sgn = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
  const pct = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%");
  // 主力净流入（亿元，A股惯例：流入为红、流出为绿）
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

  function card(s) {
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
    return `<article class="card v-${v}${feat}" data-code="${esc(s.code)}">
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
    grid.innerHTML = list.length ? list.map(card).join("") : `<div class="empty">没有匹配的标的，调整筛选试试。</div>`;
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
      const body = it.url
        ? `<a class="nf-text nf-link" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(title)}</a>`
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
      ${nb ? `<div class="sent-group"><span class="sent-label">北向资金</span><span class="sent-val ${sgn(nb.total_yi)}">净${nb.total_yi > 0 ? "流入" : "流出"} ${Math.abs(nb.total_yi).toFixed(2)}亿</span><span class="sent-mini">沪${nb.hgt_yi.toFixed(2)} 深${nb.sgt_yi.toFixed(2)}</span></div>` : ""}
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
    const news = (h.news || []).slice(0, 2).map((n) =>
      n.url ? `<a class="hc-news" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`
            : `<span class="hc-news">${esc(n.title)}</span>`
    ).join("");
    const metric = (lab, val) => `<div class="hm"><span class="hm-l">${lab}</span><span class="hm-v">${val}</span></div>`;
    return `<article class="hotcard">
      <div class="hc-head">
        <span class="hc-rank">${h.rank}</span>
        <div class="hc-name-wrap">
          <span class="hc-name">${esc(h.name)}</span>
          <span class="hc-code">${esc(h.code)}${h.board ? " · " + esc(h.board) : ""}${(h.industry || []).length ? " · " + esc(h.industry.join("/")) : ""}</span>
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
    events: () => renderEvents(),
    news: () => renderNewsAll(),
    watch: () => render(),
    market: () => renderMarket(),
    hot: () => renderHot(),
  };
  function switchView(view) {
    // 清掉所有 view-* class,再设当前
    document.body.classList.forEach((c) => { if (c.startsWith("view-")) document.body.classList.remove(c); });
    document.body.classList.add("view-" + view);
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    // 懒渲染:切到该视图才调对应 render(已有数据则重渲染,无数据则显示待生成)
    const fn = VIEW_RENDER[view];
    if (fn) { try { fn(); } catch (e) { console.warn("render " + view + " failed", e); } }
    // 移动端:切完关侧栏
    document.body.classList.remove("sidebar-open");
    window.scrollTo(0, 0);
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
  $("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
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

  /* ===================================================================
     新增 6 个模块渲染: Home / 持仓决策 / 机会清单 / 逻辑链 / 产业雷达 / 事件概率 / 新闻
  =================================================================== */
  // 通用区块标题
  const secTitle = (t, sub) => `<h2 class="vsec-title">${esc(t)}${sub ? `<span class="vsec-sub">${esc(sub)}</span>` : ""}</h2>`;
  // 通用空态
  const emptyState = (msg) => `<div class="empty">${esc(msg)}</div>`;
  // 亿/万 格式化
  const fmtYi = (n) => n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(2) + "亿";
  const fmtWan = (n) => n == null ? "—" : (n > 0 ? "+" : "") + (n / 1e4).toFixed(0) + "万";

  /* ---------- 1. Home 首页总览 ---------- */
  function renderHome() {
    const el = $("#viewHome");
    if (!el) return;
    // 大盘指数
    const ms = META.marketSnapshot;
    const ixHtml = ms && ms.indices && ms.indices.length
      ? ms.indices.map((i) => {
          const cls = i.pct > 0 ? "up" : i.pct < 0 ? "down" : "";
          return `<span class="ix"><span class="ix-n">${esc(i.name)}</span><span class="ix-p">${esc(i.price)}</span><span class="ix-c ${cls}">${i.pct > 0 ? "+" : ""}${esc(i.pct)}%</span></span>`;
        }).join("")
      : `<span class="empty-inline">大盘数据待生成</span>`;
    // 打板情绪
    const s = MARKET.sentiment || {};
    const nb = MARKET.northbound;
    // 巨头快照(前4只)
    const giants = STOCKS.slice(0, 4).map((st) => {
      const g = st.signal || {};
      const chg = g.chgPct;
      return `<article class="mini-card" data-code="${esc(st.code)}">
        <div class="mc-head"><span class="mc-name">${esc(st.name)}</span><span class="mc-code">${esc(st.code)}</span></div>
        <div class="mc-px"><span class="mc-price">¥${g.price ?? "—"}</span>${chg != null ? `<span class="chg ${sgn(chg)}">${pct(chg)}</span>` : ""}</div>
        <div class="mc-mini">${st.sector || ""}</div>
      </article>`;
    }).join("");
    // 异动摘要(各类数量)
    const summary = [
      { k: "涨停", v: (MARKET.limitUp || []).length, cls: "up" },
      { k: "炸板", v: (MARKET.brokeUp || []).length, cls: "warn" },
      { k: "跌停", v: (MARKET.limitDown || []).length, cls: "down" },
      { k: "涨幅TOP50", v: (MARKET.topGainers || []).length, cls: "" },
      { k: "龙虎榜", v: ((MARKET.dragonTiger || {}).stocks || []).length, cls: "" },
      { k: "人气榜", v: (MARKET.hotRank || []).length, cls: "" },
    ];
    const sumHtml = summary.map((x) => `<div class="stat ${x.cls}"><div class="k">${x.v}</div><div class="l">${x.k}</div></div>`).join("");
    el.innerHTML = `
      <div class="home-grid">
        <section class="card blk">
          <h3 class="blk-h">大盘指数</h3>
          <div class="ix-row">${ixHtml}<span class="ix-date">截至 ${esc((ms && ms.date) || "")}</span></div>
        </section>
        <section class="card blk">
          <h3 class="blk-h">打板情绪</h3>
          <div class="em-line"><span class="em up">涨停 ${s.zt_count ?? "—"}</span><span class="em warn">炸板 ${s.zb_count ?? "—"}</span><span class="em down">跌停 ${s.dt_count ?? "—"}</span><span class="em">炸板率 ${s.break_rate ?? "—"}%</span><span class="em">最高 ${s.max_height ?? "—"}连板</span></div>
          ${nb ? `<div class="em-line"><span class="em ${sgn(nb.total_yi)}">北向 ${nb.total_yi > 0 ? "流入" : "流出"} ${Math.abs(nb.total_yi).toFixed(2)}亿</span><span class="em-mini">沪${nb.hgt_yi.toFixed(2)} 深${nb.sgt_yi.toFixed(2)}</span></div>` : ""}
        </section>
      </div>
      <section class="card blk"><h3 class="blk-h">异动摘要</h3><div class="stats">${sumHtml}</div></section>
      ${secTitle("巨头快照", "前4只自选")}
      <div class="mini-grid">${giants || emptyState("自选数据待生成")}</div>
    `;
    el.querySelectorAll(".mini-card").forEach((c) => c.addEventListener("click", () => openDrawer(c.dataset.code)));
  }

  /* ---------- 2. 持仓决策 ---------- */
  function renderHoldings() {
    const el = $("#viewHoldings");
    if (!el) return;
    if (!HOLDINGS || !HOLDINGS.list || !HOLDINGS.list.length) {
      el.innerHTML = secTitle("持仓决策", "德业股份 · 信维通信") + emptyState("持仓数据待生成(每日收盘后由 fetch_holdings.py 自动更新)。");
      return;
    }
    const cards = HOLDINGS.list.map((h) => {
      const v = h.valuation || {};
      const f = h.fund || {};
      const chg = h.price != null && h.lastClose ? ((h.price / h.lastClose - 1) * 100) : null;
      const reports = (h.research || []).slice(0, 3).map((r) =>
        `<div class="rp-item"><div class="rp-meta"><span class="rp-rating buy">${esc(r.rating || "")}</span><span class="rp-org">${esc(r.org || "")}</span><span class="rp-date">${esc(r.date || "")}</span></div><div class="rp-title">${esc(r.title || "")}</div></div>`
      ).join("");
      return `<article class="card blk hold-card">
        <div class="hc-top">
          <div><div class="hc-name">${esc(h.name)} <span class="hc-code">${esc(h.code)}</span></div><div class="hc-sec">${esc((h.concept || []).join(" / ") || h.industry || "")}</div></div>
          <div class="hc-px"><span class="hc-price">¥${h.price ?? "—"}</span>${chg != null ? `<span class="chg ${sgn(chg)}">${pct(chg)}</span>` : ""}</div>
        </div>
        <div class="val-grid">
          <div class="vm"><span class="vm-l">PE(TTM)</span><span class="vm-v">${v.pe_ttm ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">前向PE</span><span class="vm-v">${v.pe_fwd ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">PEG</span><span class="vm-v ${v.peg != null && v.peg < 1 ? "up" : v.peg != null && v.peg > 2 ? "down" : ""}">${v.peg ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">市值</span><span class="vm-v">${v.mcap_yi != null ? v.mcap_yi + "亿" : "—"}</span></div>
          <div class="vm"><span class="vm-l">今年EPS</span><span class="vm-v">${v.eps_cur ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">明年EPS</span><span class="vm-v">${v.eps_next ?? "—"}</span></div>
          <div class="vm"><span class="vm-l">主力净流入</span><span class="vm-v ${sgn(f.netInflow)}">${fmtYi(f.netInflow)}</span></div>
          <div class="vm"><span class="vm-l">换手率</span><span class="vm-v">${f.turnover != null ? f.turnover + "%" : "—"}</span></div>
        </div>
        ${reports ? `<div class="dsec"><h3>近期研报</h3><div class="research-list">${reports}</div></div>` : ""}
        <div class="hc-hint">数据时点 ${esc(HOLDINGS.date || "")} · 机构覆盖 ${v.analyst_count ?? "—"}家 · 仅供研究参考</div>
      </article>`;
    }).join("");
    el.innerHTML = secTitle("持仓决策", "德业股份 · 信维通信") + `<div class="hold-grid">${cards}</div>`;
  }

  /* ---------- 3. 机会清单 ---------- */
  function renderOpportunities() {
    const el = $("#viewOpportunities");
    if (!el) return;
    // 聚合异动池里有"机会信号"的票:涨停 + 主力大流入 + 龙虎榜净买
    const zt = (MARKET.limitUp || []).slice(0, 20).map((m) => ({ ...m, _tag: "涨停", _tagCls: "up" }));
    const inflow = (MARKET.topInflow || []).slice(0, 20).map((m) => ({ ...m, _tag: "主力流入", _tagCls: "ok" }));
    const dt = ((MARKET.dragonTiger || {}).stocks || []).slice(0, 20).map((m) => ({ ...m, _tag: "龙虎榜", _tagCls: "change" }));
    const all = [...zt, ...inflow, ...dt];
    if (!all.length) { el.innerHTML = secTitle("机会清单", "异动池买点") + emptyState("机会数据待生成。"); return; }
    const cards = all.map((m) => {
      const chg = m.chgPct != null ? m.chgPct : m.change_pct;
      const nf = m.netInflow != null ? m.netInflow / 1e8 : m.net_buy_wan != null ? m.net_buy_wan / 1e4 : null;
      return `<article class="market-card" data-code="${esc(m.code)}">
        <div class="mc-head"><span class="mc-name">${esc(m.name)}</span><span class="mc-code">${esc(m.code)}</span><span class="mc-tag ${m._tagCls}">${m._tag}</span></div>
        <div class="mc-px"><span class="mc-price">¥${m.price ?? m.close ?? "—"}</span>${chg != null ? `<span class="chg ${sgn(chg)}">${pct(chg)}</span>` : ""}${nf != null ? `<span class="mc-hl ${sgn(nf)}">主力 ${nf > 0 ? "+" : ""}${nf.toFixed(2)}亿</span>` : ""}${m.lbc ? `<span class="mc-hl up">${m.lbc}连板</span>` : ""}</div>
        <div class="mc-mini">${esc(m.industry || (m.reason || "").slice(0, 30) || "")}</div>
      </article>`;
    }).join("");
    el.innerHTML = secTitle("机会清单", "异动池买点 · 涨停/主力流入/龙虎榜") + `<div class="market-grid">${cards}</div>`;
    el.querySelectorAll(".market-card").forEach((c) => c.addEventListener("click", () => openMarketDrawer(c.dataset.code)));
  }

  /* ---------- 4. 逻辑链 ---------- */
  function renderLogic() {
    const el = $("#viewLogic");
    if (!el) return;
    // 以巨头为锚,展示每只自选的板块归属 + 同概念关联
    const chains = STOCKS.slice(0, 12).map((st) => {
      const blocks = st.blocks || (st.valuation ? null : null);
      const tags = (st.tags || []).slice(0, 6).map((t) => `<span class="lc-tag">${esc(t)}</span>`).join("");
      const concept = (st._concept || []).slice(0, 4).map((c) => `<span class="lc-concept">${esc(c)}</span>`).join("");
      return `<article class="card blk lc-card" data-code="${esc(st.code)}">
        <div class="lc-head"><span class="lc-name">${esc(st.name)}</span><span class="lc-code">${esc(st.code)}</span><span class="lc-sec">${esc(st.sector || "")}</span></div>
        <div class="lc-narr">${esc((st.narrative || "").slice(0, 80))}${st.narrative && st.narrative.length > 80 ? "…" : ""}</div>
        ${tags ? `<div class="lc-tags">${tags}</div>` : ""}
        ${concept ? `<div class="lc-concepts">${concept}</div>` : ""}
      </article>`;
    }).join("");
    el.innerHTML = secTitle("逻辑链", "巨头产业链 · 板块/概念归属") +
      (chains ? `<div class="lc-grid">${chains}</div>` : emptyState("自选数据待生成。"));
    el.querySelectorAll(".lc-card").forEach((c) => c.addEventListener("click", () => openDrawer(c.dataset.code)));
  }

  /* ---------- 6. 产业雷达 ---------- */
  function renderIndustry() {
    const el = $("#viewIndustry");
    if (!el) return;
    if (!INDUSTRY || !INDUSTRY.top) { el.innerHTML = secTitle("产业雷达", "行业板块涨跌排名") + emptyState("行业数据待生成(每日收盘后由 fetch_industry.py 自动更新)。"); return; }
    const rowHtml = (r) => `<div class="ind-row ${r.change_pct > 0 ? "up" : r.change_pct < 0 ? "down" : ""}">
      <span class="ind-rank">${r.rank}</span><span class="ind-name">${esc(r.name)}</span>
      <span class="ind-chg">${r.change_pct > 0 ? "+" : ""}${r.change_pct}%</span>
      <span class="ind-cnt">↑${r.up_count} ↓${r.down_count}</span>
      <span class="ind-leader">龙头 ${esc(r.leader || "—")} ${r.leader_change != null ? (r.leader_change > 0 ? "+" : "") + r.leader_change + "%" : ""}</span>
    </div>`;
    const top = (INDUSTRY.top || []).map(rowHtml).join("");
    const bottom = (INDUSTRY.bottom || []).map(rowHtml).join("");
    el.innerHTML = secTitle("产业雷达", `行业板块涨跌排名 · 共 ${INDUSTRY.total || 0} 个行业 · ${esc(INDUSTRY.date || "")}`) +
      `<div class="ind-cols"><section class="card blk"><h3 class="blk-h">涨幅前 ${INDUSTRY.top ? INDUSTRY.top.length : 0}</h3><div class="ind-list">${top}</div></section>
      <section class="card blk"><h3 class="blk-h">跌幅前 ${INDUSTRY.bottom ? INDUSTRY.bottom.length : 0}</h3><div class="ind-list">${bottom}</div></section></div>`;
  }

  /* ---------- 7. 事件概率 ---------- */
  function renderEvents() {
    const el = $("#viewEvents");
    if (!el) return;
    const s = MARKET.sentiment || {};
    const ladder = s.ladder || {};
    const ladHtml = Object.entries(ladder).sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([k, v]) => `<div class="ev-lad"><span class="ev-lad-h">${k}板</span><span class="ev-lad-n">${v}</span><span class="ev-lad-bar" style="width:${Math.min(v * 8, 100)}%"></span></div>`).join("");
    // 涨停原因题材分布(从 limitUp 的 zt_stat 提取)
    const reasons = {};
    (MARKET.limitUp || []).forEach((m) => {
      const r = m.industry || m.zt_stat || "其他";
      reasons[r] = (reasons[r] || 0) + 1;
    });
    const reasonHtml = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, v]) => `<div class="ev-reason"><span class="ev-r-name">${esc(k)}</span><span class="ev-r-n">${v}</span><span class="ev-r-bar" style="width:${Math.min(v * 4, 100)}%"></span></div>`).join("");
    el.innerHTML = secTitle("事件概率", "异动催化 · 连板梯队 / 题材分布 / 炸板率") +
      `<div class="ev-grid">
        <section class="card blk"><h3 class="blk-h">打板情绪</h3>
          <div class="em-line"><span class="em up">涨停 ${s.zt_count ?? "—"}</span><span class="em warn">炸板 ${s.zb_count ?? "—"}</span><span class="em down">跌停 ${s.dt_count ?? "—"}</span></div>
          <div class="em-line"><span class="em">炸板率 ${s.break_rate ?? "—"}%</span><span class="em">最高 ${s.max_height ?? "—"}连板</span></div>
        </section>
        <section class="card blk"><h3 class="blk-h">连板梯队</h3><div class="ev-lad-list">${ladHtml || emptyState("无数据")}</div></section>
      </div>
      ${reasonHtml ? `<section class="card blk"><h3 class="blk-h">涨停题材分布</h3><div class="ev-reason-list">${reasonHtml}</div></section>` : ""}`;
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
      <button class="rep-toggle" id="repToggle"><span class="rep-toggle-txt">展开报告全文</span> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
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
    // 展开/收起全文
    const toggle = el.querySelector("#repToggle");
    const bodiesEl = el.querySelector("#repBodies");
    const toggleTxt = el.querySelector(".rep-toggle-txt");
    toggle.addEventListener("click", () => {
      const open = bodiesEl.classList.toggle("open");
      toggle.classList.toggle("open", open);
      if (toggleTxt) toggleTxt.textContent = open ? "收起报告" : "展开报告全文";
    });
  }

  /* ---------- 启动 ---------- */
  renderMeta();
  renderStats();
  renderChips();
  // 默认进 Home 视图(其他视图切到时再懒渲染)
  switchView("home");
})();
