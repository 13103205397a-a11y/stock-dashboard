(function (App) {
  const { $, esc, sgn, pct, fmtYi, secTitle, emptyState, fieldHtml, getStockReferenceIndex, isLocalServer } = App;
  /* ---------- 2. 持仓决策 ---------- */
  // 本地服务器以 portfolio.json API 为准；file/Pages 模式降级 localStorage。
  let PORTFOLIO_CFG = null;
  const PF_LS_KEY = "portfolio_cfg_v1";
  const loadPortfolio = async () => {
    if (isLocalServer()) {
      try {
        const r = await fetch("/api/portfolio", { cache: "no-store" });
        const body = await r.json();
        if (!r.ok || !body.ok) throw new Error(body.msg || `HTTP ${r.status}`);
        try { localStorage.setItem(PF_LS_KEY, JSON.stringify(body.data)); } catch {}
        return body.data;
      } catch (e) {
        portfolioToast(`持仓文件读取失败：${e.message}`, "error");
        return { holdings: [], watchlist: [] };
      }
    }
    if (location.protocol === "file:") {
      try {
        const r = await fetch("portfolio.json?t=" + Date.now());
        if (r.ok) return await r.json();
      } catch {}
    }
    // 降级 localStorage
    try {
      const ls = localStorage.getItem(PF_LS_KEY);
      if (ls) return JSON.parse(ls);
    } catch {}
    return { holdings: [], watchlist: [] };
  };
  const savePortfolio = async (data) => {
    data.updated = new Date().toISOString().slice(0, 10);
    if (!isLocalServer()) {
      PORTFOLIO_CFG = data;
      try { localStorage.setItem(PF_LS_KEY, JSON.stringify(data)); } catch {}
      return { ok: true, msg: "已保存到浏览器本地（如需写入文件，请从本地服务器打开）" };
    }
    try {
      const r = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const res = await r.json().catch(() => null);
      if (!r.ok || !res?.ok) return { ok: false, msg: res?.msg || `保存失败 (HTTP ${r.status})` };
      PORTFOLIO_CFG = res.data || data;
      try { localStorage.setItem(PF_LS_KEY, JSON.stringify(PORTFOLIO_CFG)); } catch {}
      return { ok: true, msg: res.msg || "已保存（同步到文件）" };
    } catch (e) {
      return { ok: false, msg: `保存失败：${e.message}` };
    }
  };
  const portfolioToast = (msg, type = "info") => {
    const t = document.createElement("div");
    t.className = "pf-toast " + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3000);
  };
  const refreshPortfolioData = async () => {
    if (!isLocalServer()) return { ok: false, msg: "当前为静态页面，配置已保存；本地服务启动后可自动刷新行情" };
    try {
      const r = await fetch("/api/portfolio/refresh", { method: "POST" });
      const body = await r.json().catch(() => null);
      return r.ok && body?.ok ? body : { ok: false, msg: body?.msg || `刷新失败 (HTTP ${r.status})` };
    } catch (e) {
      return { ok: false, msg: `刷新失败：${e.message}` };
    }
  };
  const monitorPortfolioRefresh = async () => {
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const r = await fetch("/api/portfolio/refresh/status?t=" + Date.now(), { cache: "no-store" });
        const state = await r.json();
        if (state.running) continue;
        if (state.error) { portfolioToast(`更新失败：${state.error}`, "error"); return false; }
        if (state.done) { portfolioToast("行情、筛选和 Hermes 持仓分析已更新", "success"); location.reload(); return true; }
      } catch (e) {
        portfolioToast(`读取更新进度失败：${e.message}`, "error");
        return false;
      }
    }
    portfolioToast("分析仍在后台运行，请稍后刷新页面查看", "error");
    return false;
  };
  const startPortfolioRefresh = async () => {
    const result = await refreshPortfolioData();
    if (!result.ok) { portfolioToast(result.msg, "error"); return false; }
    portfolioToast(result.msg || "已开始更新行情和分析", "success");
    monitorPortfolioRefresh();
    return true;
  };
  // 评级 → 颜色 class
  const ratingClass = (r) => ({ "买入": "up", "增持": "up", "持有": "ok", "减持": "warn", "卖出": "down" }[r] || "");
  const usablePortfolioAnalysis = (analysis) => {
    if (!analysis || !/^\d{6}$/.test(String(analysis.code || ""))) return false;
    const text = [analysis.fundamentals, analysis.capital, analysis.technicals, analysis.risks, analysis.noiseFilter, analysis.action, analysis.summary].join(" ");
    return text.length >= 120 && !/分析正文|一句话总结|100-200字|字段约束|示例/.test(text);
  };
  const actionLead = (value) => {
    if (Array.isArray(value)) return String(value[0] || "");
    const text = String(value || "").trim();
    return text.split(/(?<=[。！？；;])/)[0] || text.slice(0, 100);
  };
  const conceptSummary = (items, fallback = "") => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return fallback;
    const shown = list.slice(0, 4).join(" / ");
    return list.length > 4 ? `${shown} · 等 ${list.length} 个标签` : shown;
  };

  async function renderHoldings() {
    const el = $("#viewHoldings");
    if (!el) return;
    const HOLDINGS = window.HOLDINGS || null;
    if (!PORTFOLIO_CFG) PORTFOLIO_CFG = await loadPortfolio();
    const cfg = PORTFOLIO_CFG || { holdings: [], watchlist: [] };
    const cfgList = cfg.holdings || [];
    const watchList = cfg.watchlist || [];
    // 行情数据 map（holdings.js）
    const hMap = {};
    (HOLDINGS?.list || []).forEach((h) => { hMap[h.code] = h; });
    // 分析数据 map（portfolio_analysis.js）
    const an = window.PORTFOLIO_ANALYSIS || { analyses: [] };
    const aMap = {};
    (an.analyses || []).filter(usablePortfolioAnalysis).forEach((a) => { aMap[a.code] = a; });
    const screenData = window.PORTFOLIO_SIGNALS || { list: [] };
    const screenMap = {};
    (screenData.list || []).forEach((item) => { screenMap[item.code] = item; });

    const addBtn = `<div class="pf-toolbar"><button class="pf-add-btn" id="pfAddBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> 加持仓</button><button class="pf-add-btn secondary" id="pfWatchBtn">加自选</button><button class="pf-refresh-btn" id="pfRefreshBtn">刷新筛选</button><span class="pf-updated">配置 ${esc(cfg.updated || "—")} · 行情 ${esc(screenData.date || HOLDINGS?.date || "待刷新")}</span></div>`;

    if (!cfgList.length && !watchList.length) {
      el.innerHTML = secTitle("持仓决策", "") + addBtn + emptyState("暂无持仓或自选，添加后将自动更新行情并按既有技术信号筛选");
      bindPfAdd(el);
      bindPfRefresh(el);
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
          ${(a.fundamentals || a.capital || a.technicals || a.risks || a.noiseFilter) ? `<details class="pf-an-details"><summary>展开分析依据</summary>
            ${a.fundamentals ? `<div class="pf-an-sec"><span class="sd-l">基本面+估值</span>${fieldHtml(a.fundamentals)}</div>` : ""}
            ${a.capital ? `<div class="pf-an-sec"><span class="sd-l">资金面</span>${fieldHtml(a.capital)}</div>` : ""}
            ${a.technicals ? `<div class="pf-an-sec"><span class="sd-l">技术面</span>${fieldHtml(a.technicals)}</div>` : ""}
            ${a.risks ? `<div class="pf-an-sec"><span class="sd-l">风险</span>${fieldHtml(a.risks)}</div>` : ""}
            ${a.noiseFilter ? `<div class="pf-an-sec"><span class="sd-l">市场噪音过滤</span>${fieldHtml(a.noiseFilter)}</div>` : ""}
          </details>` : ""}
          ${a.action ? `<div class="pf-an-sec pf-an-action"><span class="sd-l">操作建议</span><div><p class="pf-action-lead">${esc(actionLead(a.action))}</p><details class="pf-action-details"><summary>展开完整操作计划</summary>${fieldHtml(a.action)}</details></div></div>` : ""}
          ${(a.targetBuy || a.targetSell || a.stopLoss) ? `<div class="pf-an-points">
            ${a.targetBuy ? `<span class="pf-pt buy">建议买点 ¥${a.targetBuy}</span>` : ""}
            ${a.targetSell ? `<span class="pf-pt sell">建议卖点 ¥${a.targetSell}</span>` : ""}
            ${a.stopLoss ? `<span class="pf-pt stop">止损位 ¥${a.stopLoss}</span>` : ""}
          </div>` : ""}
        </div>` : `<div class="pf-analysis pf-an-empty">AI 综合分析待生成（Hermes 每日收盘后自动更新）</div>`;

      return `<article class="card blk hold-card">
        <div class="hc-top">
          <div><div class="hc-name">${esc(h.name || hd.name || code)} <span class="hc-code">${esc(code)}</span></div><div class="hc-sec" title="${esc((hd.concept || []).join(" / "))}">${esc(conceptSummary(hd.concept, hd.industry || h.note || ""))}</div></div>
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
          <div class="vm"><span class="vm-l">主力净流入</span><span class="vm-v ${sgn(f.netInflow)}">${f.available === false ? "接口暂不可用" : fmtYi(f.netInflow)}</span></div>
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

    const watchCards = watchList.map((item) => {
      const quote = hMap[item.code] || {};
      const screened = screenMap[item.code] || {};
      const signal = screened.signal || {};
      const screen = screened.screen || { status: "待刷新", tone: "neutral", reason: "添加后尚未生成筛选快照" };
      const change = signal.chgPct ?? (quote.price != null && quote.lastClose ? (quote.price / quote.lastClose - 1) * 100 : null);
      return `<article class="watch-row" data-status="${esc(screen.status)}">
        <div class="watch-identity"><strong>${esc(item.name || quote.name || item.code)}</strong><span>${esc(item.code)}</span></div>
        <div class="watch-quote"><strong>¥${signal.price ?? quote.price ?? "—"}</strong>${change != null ? `<span class="chg ${sgn(change)}">${pct(change)}</span>` : ""}</div>
        <div class="watch-signal"><span class="screen-badge ${esc(screen.tone)}">${esc(screen.status)}</span><span>${esc(screen.reason)}</span></div>
        <div class="watch-state"><span>${esc(signal.trend || "趋势待刷新")}</span><span>${esc(signal.leftState || "左侧信号待刷新")}</span><span>${esc(signal.rightState || "右侧信号待刷新")}</span></div>
        <button class="pf-del-btn" data-scope="watch" data-code="${esc(item.code)}" data-name="${esc(item.name)}">删自选</button>
      </article>`;
    }).join("");
    const watchSection = `<section class="watch-section"><div class="watch-head"><div><h3>自选筛选</h3><span>规则复用现有左侧 / 右侧 / 趋势信号，行情截至 ${esc(screenData.date || "待刷新")}</span></div><div class="watch-filters" role="group" aria-label="自选筛选"><button class="active" data-filter="全部">全部 ${watchList.length}</button><button data-filter="重点关注">重点关注</button><button data-filter="接近触发">接近触发</button><button data-filter="继续观察">继续观察</button><button data-filter="风险回避">风险回避</button></div></div><details class="screen-rules"><summary>查看筛选规则</summary><ol>${(screenData.rules || ["保存后自动刷新行情并生成筛选结果"]).map((rule) => `<li>${esc(rule)}</li>`).join("")}</ol></details><div class="watch-table">${watchCards || emptyState("暂无自选")}</div></section>`;

    el.innerHTML = secTitle("持仓决策", `${cfgList.length} 只持仓 · ${watchList.length} 只自选`) + addBtn + (cfgList.length ? `<div class="hold-grid">${cards}</div>` : "") + watchSection;
    bindPfAdd(el);
    bindPfDel(el);
    bindPfRefresh(el);
    bindWatchFilters(el);
  }

  // 加持仓表单
  function bindPfAdd(el) {
    const openForm = (scope) => {
      const existing = el.querySelector("#pfAddForm");
      if (existing) { existing.remove(); return; }
      const isWatch = scope === "watch";
      const form = document.createElement("form");
      form.id = "pfAddForm";
      form.className = "pf-add-form";
      form.innerHTML = `
        <div class="pf-form-title" style="grid-column:1/-1;font-weight:700">添加${isWatch ? "自选" : "持仓"} <span style="font-size:11px;font-weight:400;color:var(--muted)">输入代码或名称，已收录股票会自动补全</span></div>
        <input class="pf-input" id="pfCode" inputmode="numeric" autocomplete="off" placeholder="股票代码（如 605117）" maxlength="6" />
        <input class="pf-input" id="pfName" autocomplete="off" placeholder="股票名称（如 德业股份）" />
        ${isWatch ? "" : `<input class="pf-input" id="pfBuy" type="number" step="0.01" placeholder="买入价（可选）" /><input class="pf-input" id="pfShares" type="number" placeholder="股数（可选）" /><input class="pf-input" id="pfWeight" type="number" step="0.01" min="0" max="1" placeholder="仓位 0-1（可选）" />`}
        <input class="pf-input" id="pfNote" placeholder="备注（可选）" />
        <div class="pf-form-actions">
          <button type="button" class="pf-cancel" id="pfCancel">取消</button>
          <button type="submit" class="pf-save" id="pfSave">添加${isWatch ? "自选" : "持仓"}</button>
        </div>
        <div class="pf-form-status" id="pfFormStatus" role="status" aria-live="polite" style="grid-column:1/-1;min-height:18px;font-size:12px"></div>`;
      el.querySelector(".pf-toolbar").after(form);
      const codeInput = el.querySelector("#pfCode");
      codeInput.focus();
      codeInput.addEventListener("input", () => {
        const ref = getStockReferenceIndex().get(codeInput.value.trim());
        const nameInput = el.querySelector("#pfName");
        if (ref?.name && !nameInput.value.trim()) nameInput.value = ref.name;
      });
      el.querySelector("#pfName").addEventListener("input", (event) => {
        const wanted = event.currentTarget.value.trim().toLowerCase();
        if (!wanted || codeInput.value.trim()) return;
        const ref = [...getStockReferenceIndex().values()].find((item) => String(item.name || "").trim().toLowerCase() === wanted);
        if (ref?.code) codeInput.value = ref.code;
      });
      el.querySelector("#pfCancel").addEventListener("click", () => form.remove());
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = form.querySelector("#pfFormStatus");
        const save = form.querySelector("#pfSave");
        let code = form.querySelector("#pfCode").value.trim();
        let name = form.querySelector("#pfName").value.trim();
        if (!code && name) {
          const wanted = name.toLowerCase();
          const ref = [...getStockReferenceIndex().values()].find((item) => String(item.name || "").trim().toLowerCase() === wanted);
          if (ref) code = ref.code;
        }
        const showError = (message, input) => {
          status.textContent = message;
          status.className = "pf-form-status error";
          input?.focus();
        };
        if (!code || !/^\d{6}$/.test(code)) { showError("请输入 6 位股票代码；已收录股票也可以只填准确名称", form.querySelector("#pfCode")); return; }
        const ref = getStockReferenceIndex().get(code);
        if (!name && ref?.name) name = ref.name;
        if (!name) { showError("请输入股票名称", form.querySelector("#pfName")); return; }
        if ([...(PORTFOLIO_CFG?.holdings || []), ...(PORTFOLIO_CFG?.watchlist || [])].some((h) => h.code === code)) { showError("该股票已在持仓或自选中"); return; }
        save.disabled = true;
        save.textContent = "保存中…";
        status.textContent = "正在保存配置";
        status.className = "pf-form-status";
        const note = el.querySelector("#pfNote").value.trim();
        const data = { ...PORTFOLIO_CFG };
        if (isWatch) {
          data.watchlist = [...(data.watchlist || []), { code, name, note, addedAt: new Date().toISOString().slice(0, 10) }];
        } else {
          const buy = parseFloat(el.querySelector("#pfBuy").value) || null;
          const shares = parseInt(el.querySelector("#pfShares").value) || null;
          const weight = parseFloat(el.querySelector("#pfWeight").value) || null;
          data.holdings = [...(data.holdings || []), { code, name, buyPrice: buy, shares, weight, note, addedAt: new Date().toISOString().slice(0, 10) }];
        }
        const r = await savePortfolio(data);
        if (!r.ok) { save.disabled = false; save.textContent = `添加${isWatch ? "自选" : "持仓"}`; showError(r.msg || "保存失败"); return; }
        portfolioToast(`已添加${isWatch ? "自选" : "持仓"}`, "success");
        form.remove();
        await renderHoldings();
        startPortfolioRefresh();
      });
    };
    el.querySelector("#pfAddBtn")?.addEventListener("click", () => openForm("holding"));
    el.querySelector("#pfWatchBtn")?.addEventListener("click", () => openForm("watch"));
  }

  // 删持仓
  function bindPfDel(el) {
    el.querySelectorAll(".pf-del-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        const name = btn.dataset.name;
        if (!btn.classList.contains("confirm-delete")) {
          btn.classList.add("confirm-delete");
          btn.textContent = "再点一次确认";
          setTimeout(() => {
            if (!btn.isConnected) return;
            btn.classList.remove("confirm-delete");
            btn.textContent = btn.dataset.scope === "watch" ? "删自选" : "删持仓";
          }, 4000);
          return;
        }
        btn.disabled = true;
        btn.textContent = "删除中…";
        const data = { ...PORTFOLIO_CFG };
        if (btn.dataset.scope === "watch") data.watchlist = (data.watchlist || []).filter((h) => h.code !== code);
        else data.holdings = (data.holdings || []).filter((h) => h.code !== code);
        const r = await savePortfolio(data);
        if (r.ok) {
          portfolioToast(btn.dataset.scope === "watch" ? "自选已删除" : "持仓已删除", "success");
          await renderHoldings();
          startPortfolioRefresh();
        } else { btn.disabled = false; portfolioToast(r.msg || "删除失败", "error"); }
      });
    });
  }

  function bindPfRefresh(el) {
    el.querySelector("#pfRefreshBtn")?.addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = "刷新中…";
      const result = await startPortfolioRefresh();
      if (!result) { btn.disabled = false; btn.textContent = "刷新筛选"; }
    });
  }

  function bindWatchFilters(el) {
    const buttons = el.querySelectorAll(".watch-filters button");
    buttons.forEach((button) => button.addEventListener("click", () => {
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      el.querySelectorAll(".watch-row").forEach((row) => {
        row.hidden = button.dataset.filter !== "全部" && row.dataset.status !== button.dataset.filter;
      });
    }));
  }
  App.renderHoldings = renderHoldings;
})(window.App);
