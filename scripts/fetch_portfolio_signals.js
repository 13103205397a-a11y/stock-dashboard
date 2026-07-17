#!/usr/bin/env node
/* 私有持仓/自选技术筛选。仅复用 fetch_signals.js 的既有信号，不改变指标逻辑。 */
const fs = require("fs");
const path = require("path");
const { computeSignal } = require("./fetch_signals.js");

const ROOT = path.join(__dirname, "..");
const PORTFOLIO = path.join(ROOT, "portfolio.json");
const OUT = path.join(ROOT, "portfolio_signals.js");

const marketCode = (code) => (code[0] === "6" ? "sh" : ["8", "4"].includes(code[0]) ? "bj" : "sz") + code;

function classifySignal(signal) {
  const left = signal.leftState || "";
  const right = signal.rightState || "";
  if (signal.trend === "空头排列" || /转弱|跌破/.test(left)) {
    return { status: "风险回避", tone: "down", reason: "空头排列或左侧结构转弱" };
  }
  if (/已放量突破/.test(right) || /已回踩至逢低区/.test(left)) {
    return { status: "重点关注", tone: "up", reason: /已放量突破/.test(right) ? "右侧已放量突破" : "价格已进入既定逢低区" };
  }
  if (/临近突破/.test(right) || (signal.pullbackPct != null && signal.pullbackPct >= 0 && signal.pullbackPct <= 3)) {
    return { status: "接近触发", tone: "warn", reason: /临近突破/.test(right) ? "距既定突破位不超过 3%" : "距既定逢低区不超过 3%" };
  }
  return { status: "继续观察", tone: "neutral", reason: "尚未满足左侧或右侧触发条件" };
}

async function fetchJson(url, retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));
    }
  }
  throw last;
}

async function fetchKlines(code) {
  const mk = marketCode(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${mk},day,,,330,qfq`;
  const json = await fetchJson(url);
  const rows = json?.data?.[mk]?.qfqday || json?.data?.[mk]?.day;
  if (!Array.isArray(rows) || rows.length < 20) throw new Error(`${code} K线不足`);
  return rows.map((p) => ({ date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], vol: +p[5] }));
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(PORTFOLIO, "utf8"));
  const entries = [
    ...(cfg.holdings || []).map((x) => ({ ...x, scope: "holding" })),
    ...(cfg.watchlist || []).map((x) => ({ ...x, scope: "watch" })),
  ];
  const list = [];
  for (const entry of entries) {
    const computed = computeSignal(await fetchKlines(entry.code));
    list.push({
      code: entry.code,
      name: entry.name,
      scope: entry.scope,
      signal: computed.signal,
      left: { zone: computed.leftZone, trigger: computed.leftTrigger },
      right: { zone: computed.rightZone, trigger: computed.rightTrigger },
      screen: classifySignal(computed.signal),
    });
    process.stdout.write(`✓ ${entry.name}(${entry.code}) ${list.at(-1).screen.status}\n`);
  }
  const dates = list.map((x) => x.signal.date).filter(Boolean).sort();
  const data = {
    schemaVersion: 1,
    date: dates.at(-1) || "",
    generatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
    rules: ["空头排列或结构转弱 → 风险回避", "已放量突破或进入逢低区 → 重点关注", "距突破位或逢低区不超过 3% → 接近触发", "其余 → 继续观察"],
    list,
  };
  const content = `/* 私有持仓/自选筛选快照。指标逻辑复用 fetch_signals.js。 */\nwindow.PORTFOLIO_SIGNALS = ${JSON.stringify(data, null, 2)};\n`;
  fs.writeFileSync(OUT + ".tmp", content);
  fs.renameSync(OUT + ".tmp", OUT);
  console.log(`完成：${list.length} 只，行情截至 ${data.date}`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { classifySignal };
