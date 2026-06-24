/* 自选股盘面 · 叙事复盘 — 渲染 / 筛选 / 详情抽屉 */
(function () {
  const STOCKS = window.STOCKS || [];
  const META = window.META || {};

  const state = { sector: "全部", verdict: "all", q: "", sort: "default" };

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
      { k: STOCKS.length, l: "自选股总数", cls: "" },
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
    const sectors = ["全部", ...Object.keys(counts)];
    $("#sectorChips").innerHTML = sectors
      .map((sec) => {
        const n = sec === "全部" ? STOCKS.length : counts[sec];
        const active = state.sector === sec ? "active" : "";
        return `<button class="chip ${active}" data-sector="${esc(sec)}">${esc(sec)}<span class="badge">${n}</span></button>`;
      })
      .join("");
    $("#sectorChips").querySelectorAll(".chip").forEach((b) =>
      b.addEventListener("click", () => { state.sector = b.dataset.sector; renderChips(); render(); })
    );
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
    return `<article class="card v-${v}${feat}" data-code="${esc(s.code)}">
      <div class="card-head">
        <div class="name-wrap">
          <span class="name">${esc(s.name)}</span>
          <span class="code">${esc(s.code)} · <span class="sector-tag">${esc(s.sector)}</span></span>
        </div>
        <span class="verdict-badge ${v}">${esc(v)}</span>
      </div>
      ${priceRow}
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
        <div class="feat-note">
          <div class="fn-k">今日买点</div>
          <div class="fn-v">${esc(featReason)}</div>
        </div>
      </div>
      <div class="card-foot">
        <div class="tagrow">${tags}</div>
        ${fundChip(s)}
        ${freshNews(s) ? `<span class="news-flag">新消息 ${freshNews(s)}</span>` : ""}
        <span class="change-dot ${changed ? "has" : "none"}"><span class="d"></span>${changed ? "今日有变化" : "无变化"}</span>
      </div>
    </article>`;
  }

  function render() {
    const list = sortList(STOCKS.filter(matches));
    grid.innerHTML = list.length ? list.map(card).join("") : `<div class="empty">没有匹配的标的，调整筛选试试。</div>`;
    grid.querySelectorAll(".card").forEach((el) =>
      el.addEventListener("click", () => openDrawer(el.dataset.code))
    );
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
          <div class="rn-row rumor"><span class="lab">小作文/传闻：</span>${esc(r.rumors || "无")}</div>
          <div class="rn-row grow"><span class="lab">新变化点：</span>${esc(r.newPoints || "无")}</div>
        </div>
      </div>

      <div class="dsec">
        <h3>新闻 / 传闻 / 小作文 流水 <span class="src-note">同花顺问财 · 自动</span></h3>
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
        <h3>需盯的小作文 / 催化</h3>
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

  /* ---------- 今日热点 TOP30 ---------- */
  const HOT = window.HOT || {};

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

  function switchView(view) {
    document.body.classList.toggle("view-hot", view === "hot");
    document.querySelectorAll(".vtab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "hot") renderHot();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".vtab").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );

  /* ---------- 事件 ---------- */
  $("#backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  $("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  document.querySelectorAll(".verdict-chip").forEach((b) =>
    b.addEventListener("click", () => { state.verdict = b.dataset.verdict; renderChips(); render(); })
  );

  /* ---------- AI 复盘（Hermes 报告） ---------- */
  const REPORTS = window.REPORTS || {};

  // 极简 markdown → HTML（标题/表格/加粗/列表/分隔线）。不引外部库，够用。
  function md2html(md) {
    const lines = esc(md).split("\n");
    let html = "", inTable = false, inList = false;
    const flushList = () => { if (inList) { html += "</ul>"; inList = false; } };
    const flushTable = () => { if (inTable) { html += "</tbody></table>"; inTable = false; } };
    for (let raw of lines) {
      const line = raw.replace(/\r$/, "");
      // 分隔线
      if (/^---+$/.test(line.trim())) { flushList(); flushTable(); continue; }
      // 表格：---|--- 分隔行，跳过；数据行 → <tr><td>
      if (line.includes("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
        if (cells.every((c) => /^:?-+:?$/.test(c))) { if (!inTable) { html += "<table><tbody>"; inTable = true; } continue; }
        if (cells.length) { flushList(); if (!inTable) { html += "<table><tbody>"; inTable = true; } html += "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>"; continue; }
      }
      flushTable();
      // 标题
      const hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) { flushList(); html += `<h${hm[1].length + 2}>${hm[2]}</h${hm[1].length + 2}>`; continue; }
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
    el.innerHTML = `<div class="rep-tabs">${tabs}</div><div class="rep-bodies">${bodies}</div><div class="rep-foot">报告由本地 Hermes Agent 定时任务生成（全网搜索调研），scripts/fetch_hermes.py 导出。仅供研究参考，非投资建议。更新于 ${esc(REPORTS.updated || "")}</div>`;
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
  render();
  renderHot();
  renderReports();
})();
