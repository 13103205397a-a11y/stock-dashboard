/* 读取真实日K(腾讯行情,前复权)→ 计算技术指标 → 生成左/右侧信号 → 合并写回 data.js
 * 行情抓取见 scripts/fetch_klines.sh（用 curl 拉取到 scripts/raw/<code>.json）。
 * 本脚本仅做技术信号计算；叙事/证伪/增长点等编辑性字段保持不变。
 * 数据源：web.ifzq.gtimg.cn（腾讯公开行情）。仅供研究参考，非投资建议。
 * 用法： bash scripts/fetch_klines.sh && node scripts/fetch_signals.js
 */
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data.js");
const META = path.join(__dirname, "..", "meta.js");
const RAW = path.join(__dirname, "raw");

// 载入现有数据（保留编辑性字段）
global.window = {};
require(DATA);
require(META);
const STOCKS = window.STOCKS;

const mk = (code) => {
  const c = code[0];
  return (c === "6" ? "sh" : c === "8" || c === "4" ? "bj" : "sz") + code; // 6→沪 8/4→北交所 其余→深
};
const r2 = (n) => (n == null || isNaN(n) ? null : Math.round(n * 100) / 100);

// 原子写：先写 .tmp 再 rename，避免写到一半被中断导致 data.js 截断/数据丢失
function writeAtomic(file, content) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
// data.js / meta.js 统一头部（两脚本一致，避免互相覆盖日期标注）
const DATA_HEADER =
  "/* 自选股数据：叙事 + 左/右侧策略 + 技术信号 + 消息面\n" +
  " * 技术信号(signal/left/right) ← scripts/fetch_signals.js（腾讯日K，前复权）\n" +
  " * 消息面：fund/research ← fetch_enhanced.py（东财/腾讯,免key）；news ← fetch_news.py（东财,免key）\n" +
  " * 叙事/证伪/增长点为 AI 整理。仅供研究参考，非投资建议。\n" +
  " * 数据时点见 meta.js 与各字段内 date。\n */\n";
const fmt = (n) => (n == null ? "—" : (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2)));

// 大盘指数：从腾讯实时行情抓真实涨跌，写入 meta.marketSnapshot。
// 目的：综述里的指数数字必须来自真实数据，杜绝复盘 Agent 自行编造/用隔日数据。
const INDEX_CODES = [
  ["sh000001", "上证指数"], ["sz399001", "深证成指"],
  ["sz399006", "创业板指"], ["sh000688", "科创50"],
];
async function fetchIndices() {
  const url = "https://qt.gtimg.cn/q=" + INDEX_CODES.map((x) => x[0]).join(",");
  const res = await fetch(url, { headers: { Referer: "https://gu.qq.com/" } });
  const text = Buffer.from(await res.arrayBuffer()).toString("latin1"); // 数字字段为 ASCII，名称乱码不取
  const out = [];
  for (const [code, name] of INDEX_CODES) {
    const m = text.match(new RegExp('v_' + code + '="([^"]*)"'));
    if (!m) continue;
    const f = m[1].split("~");
    const price = +f[3], prev = +f[4];               // 3=现价 4=昨收
    if (!price || !prev) continue;
    out.push({ code, name, price: r2(price), pct: r2(((price - prev) / prev) * 100) });
  }
  return out;
}

function klines(code) {
  const f = path.join(RAW, code + ".json");
  if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const d = j?.data?.[mk(code)];
  const arr = d?.qfqday || d?.day;
  if (!arr || !arr.length) return null;
  return arr.map((p) => ({ date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], vol: +p[5] }));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const maOf = (closes, p) => (closes.length >= p ? mean(closes.slice(-p)) : null);
const hiOf = (k, p) => (k.length >= p ? Math.max(...k.slice(-p).map((x) => x.high)) : null); // 不足 p 根返回 null,避免"60日高"实为上市以来高
const loOf = (k, p) => (k.length >= p ? Math.min(...k.slice(-p).map((x) => x.low)) : null);
const atrOf = (k, p = 14) => {
  if (k.length < 2) return null;
  const trs = [];
  for (let i = 1; i < k.length; i++) {
    const h = k[i].high, l = k[i].low, pc = k[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return mean(trs.slice(-p));
};

function computeSignal(k) {
  const closes = k.map((x) => x.close);
  const vols = k.map((x) => x.vol);
  const n = k.length;
  const close = closes[n - 1];
  const prev = closes[n - 2] ?? close;
  const chgPct = prev ? ((close - prev) / prev) * 100 : 0;

  const ma5 = maOf(closes, 5), ma10 = maOf(closes, 10), ma20 = maOf(closes, 20);
  const ma60 = maOf(closes, 60), ma120 = maOf(closes, 120), ma250 = maOf(closes, 250);
  const high20 = hiOf(k, 20), low20 = loOf(k, 20);
  const high60 = hiOf(k, 60), low60 = loOf(k, 60);

  const volMa5 = mean(vols.slice(-5));
  const volMa20 = vols.length >= 20 ? mean(vols.slice(-20)) : mean(vols);
  const volRatio = volMa20 ? volMa5 / volMa20 : 1;
  const atr = atrOf(k, 14);

  // 趋势：均线排列
  let trend = "震荡";
  if (ma5 && ma20 && ma60) {
    if (ma5 > ma20 && ma20 > ma60) trend = "多头排列";
    else if (ma5 < ma20 && ma20 < ma60) trend = "空头排列";
  }
  const posPct = ma60 ? (close / ma60 - 1) * 100 : null; // 现价相对MA60

  // ---- 左侧(逢低回踩带)：始终贴近现价，最多 -10% 深；有均线落在窗口内则对齐均线，否则用浅回撤带 ----
  const upTrend = ma20 && ma60 && close > ma20 && ma20 > ma60;
  const maxDepth = 0.10;                       // 逢低带下沿最多低于现价 10%
  const floorP = close * (1 - maxDepth);
  // 落在 [floorP, 现价) 的均线作为近支撑候选（从高到低）
  const nearMAs = [ma5, ma10, ma20, ma60].filter((m) => m && m < close * 0.995 && m >= floorP).sort((a, b) => b - a);
  let supHi, supLo, anchor;
  if (nearMAs.length) {
    supHi = nearMAs[0];                        // 最近(最高)的均线
    supLo = nearMAs.length > 1 ? nearMAs[nearMAs.length - 1] : Math.max(supHi * 0.97, floorP);
    anchor = "均线";
  } else if (ma20 && close < ma20) {
    // 跌破 MA20：用 MA20 上沿（在现价上方时退化为浅带）
    supHi = Math.min(ma20, close * 0.99);
    supLo = floorP;
    anchor = "跌破MA20";
  } else {
    // 急涨无近支撑：固定浅回撤带 -3% ~ -8%
    supHi = close * 0.97;
    supLo = close * 0.92;
    anchor = "浅回撤";
  }
  supLo = Math.max(supLo, floorP);             // 下沿不超过 -10%
  supHi = Math.min(supHi, close * 0.995);      // 上沿略低于现价
  if (supLo >= supHi) supLo = supHi * 0.96;    // 兜底
  const deepSupport = r2(ma60 ?? low60);       // 更深的强支撑（破位才考虑）

  const distToZone = ((close - supHi) / supHi) * 100; // 现价距逢低带上沿(>0 需回踩)
  let leftState;
  if (close <= supHi * 1.015) leftState = "已回踩至逢低区 · 可分批左侧";
  else if (close < supLo) leftState = "已跌破逢低区 · 转弱观望";
  else leftState = `回踩约 ${distToZone.toFixed(1)}% 入场（逢低区）`;

  // ---- 右侧(突破/动量)位 ----
  const brk = high60 ?? high20 ?? close;
  const toBreakout = ((brk - close) / close) * 100; // 距突破位百分比(>0 未突破)
  const newHigh = close >= brk * 0.999;
  let rightState;
  if (newHigh) rightState = volRatio >= 1.3 ? "已放量突破 · 右侧持有/加仓" : "创新高但量能不足 · 谨慎跟进";
  else if (toBreakout <= 3) rightState = `临近突破 · 距 ${toBreakout.toFixed(1)}%`;
  else if (toBreakout <= 12) rightState = `箱体内 · 距突破 ${toBreakout.toFixed(1)}%`;
  else rightState = `远离突破 ${toBreakout.toFixed(1)}% · 暂无右侧`; // 太远不构成右侧机会

  // ---- 风控：止损 / 目标 / 盈亏比 ----
  const entry = (supLo + supHi) / 2;                      // 左侧逢低参考买入价(区间中位)
  const leftStop = r2(Math.max(close * 0.85, supLo * 0.97)); // 跌破逢低区止损(最深 -15%)
  const leftTarget = r2(brk > close * 1.01 ? brk : (high20 ?? close) * 1.05); // 左侧目标≈突破位
  const leftRR = leftTarget && entry > leftStop ? r2(Math.min((leftTarget - entry) / (entry - leftStop), 10)) : null; // 夹顶 10,避免分母极小时出现离谱值
  const rightStop = r2(brk * 0.96);                       // 突破买入后跌回突破位下方止损

  const leftZone = `${fmt(r2(supLo))}–${fmt(r2(supHi))}`;
  const leftTrigger = upTrend
    ? `回踩 MA10(${fmt(r2(ma10))})/MA20(${fmt(r2(ma20))}) 缩量企稳即逢低；强支撑 MA60 ${fmt(deepSupport)}；止损 ${fmt(leftStop)}`
    : `回踩 ${fmt(r2(supHi))} 缩量企稳；失守 ${fmt(r2(supLo))} 转弱；强支撑 ${fmt(deepSupport)}，止损 ${fmt(leftStop)}`;
  const rightZone = newHigh ? `已破 ${fmt(r2(brk))} · 回踩 MA10(${fmt(r2(ma10))}) 不破加仓` : `站上 ${fmt(r2(brk))}`;
  const rightTrigger = `放量站上 ${fmt(r2(brk))}（60日高），量比>1.3 确认；新高回踩不破再加，止损 ${fmt(rightStop)}`;

  // 走势图数据：近 60 根收盘
  const spark = closes.slice(-60).map(r2);

  return {
    signal: {
      date: k[n - 1].date, price: r2(close), chgPct: r2(chgPct),
      ma5: r2(ma5), ma10: r2(ma10), ma20: r2(ma20), ma60: r2(ma60), ma120: r2(ma120), ma250: r2(ma250),
      high20: r2(high20), low20: r2(low20), high60: r2(high60), low60: r2(low60),
      volRatio: r2(volRatio), atr: r2(atr), trend, posPct: r2(posPct),
      supportZone: [r2(supLo), r2(supHi)], deepSupport, pullbackPct: r2(distToZone),
      breakout: r2(brk), toBreakoutPct: r2(toBreakout),
      leftStop, leftTarget, leftRR, rightStop,
      leftState, rightState, spark,
    },
    leftZone, leftTrigger, rightZone, rightTrigger,
  };
}

(async function () {
  let ok = 0, fail = [];
  for (const s of STOCKS) {
    try {
      const k = klines(s.code);
      if (!k || k.length < 20) { fail.push(s.code + s.name + "(数据不足)"); continue; }
      const c = computeSignal(k);
      s.signal = c.signal;
      s.left = s.left || {}; s.right = s.right || {};
      s.left.zone = c.leftZone; s.left.trigger = c.leftTrigger;   // logic 编辑性文案保留
      s.right.zone = c.rightZone; s.right.trigger = c.rightTrigger;
      ok++;
      process.stdout.write(`✓ ${s.name}(${s.code}) ${c.signal.price} ${c.signal.trend} L:${c.signal.leftState.slice(0,8)} R:${c.signal.rightState.slice(0,12)}\n`);
    } catch (e) {
      fail.push(s.code + s.name + "(" + e.message + ")");
    }
  }

  // 写回 data.js（原子写 + 统一头部）
  writeAtomic(DATA, DATA_HEADER + "window.STOCKS = " + JSON.stringify(STOCKS, null, 2) + ";\n");

  // 统计技术面，自动汇总进 meta（不覆盖复盘 Agent 维护的 marketRegime）
  let bull = 0, bear = 0, leftReady = 0, rightReady = 0;
  STOCKS.forEach((s) => {
    const g = s.signal || {};
    if (g.trend === "多头排列") bull++; else if (g.trend === "空头排列") bear++;
    if (/已回踩至逢低区/.test(g.leftState || "")) leftReady++;
    if (/已放量突破|临近突破/.test(g.rightState || "")) rightReady++;
  });
  const latestDate = STOCKS.map((s) => s.signal?.date).filter(Boolean).sort().pop() || "—";
  const today = new Date().toISOString().slice(0, 10);
  const m = window.META || {};

  // 抓真实大盘指数（失败则保留旧快照，不阻断技术信号写入）
  let marketSnapshot = m.marketSnapshot || null;
  try {
    const idx = await fetchIndices();
    if (idx.length) {
      marketSnapshot = { date: latestDate, indices: idx };
      console.log("大盘：" + idx.map((i) => `${i.name} ${i.price} ${i.pct > 0 ? "+" : ""}${i.pct}%`).join(" · "));
    }
  } catch (e) {
    console.log("指数抓取失败，保留旧快照：" + e.message);
  }

  const newMeta =
    "/* 全局元信息：signalDate/signalStat/marketSnapshot 由行情程序自动统计 */\n" +
    "window.META = " + JSON.stringify({
      lastUpdated: latestDate,
      signalDate: latestDate,
      signalStat: `多头 ${bull} / 空头 ${bear} · 左侧已到逢低区 ${leftReady} · 右侧突破或临近 ${rightReady}（共 ${STOCKS.length} 只，行情截至 ${latestDate}，刷新于 ${today}）`,
      marketSnapshot,
    }, null, 2) + ";\n";
  writeAtomic(META, newMeta);

  console.log(`\n完成：成功 ${ok}/${STOCKS.length}`);
  if (fail.length) console.log("失败：", fail.join("; "));
})();

