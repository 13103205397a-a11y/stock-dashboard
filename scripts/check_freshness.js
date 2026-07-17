#!/usr/bin/env node
/* 数据新鲜度门禁：按工作日计算，避免周末误报；中国长假由宽限阈值覆盖。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
// --scope=market: 只对行情类数据严格把关（AI 模块由本地 Hermes 维护，
// GitHub Actions 无法自行修复其过期，不应因此阻断行情提交）。
const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
const scope = scopeArg ? scopeArg.slice(8) : "all";
const nowArg = process.argv.find((arg) => arg.startsWith("--now="));
// 「今天」按北京时间取日历日；toISOString 是 UTC，北京 0:00-8:00 会差一天。
const todayCn = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const now = new Date((nowArg ? nowArg.slice(6) : todayCn) + "T12:00:00+08:00");
const context = { window: {} };
vm.createContext(context);
for (const file of [
  "data.js", "meta.js", "market.js", "hot.js", "newsall.js", "industry.js",
  "industry_market.js", "materials.js", "logic.js", "events.js",
  "opportunities.js", "weekend.js", "x_feed.js", "reports.js",
]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
}

function businessDaysSince(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) return Infinity;
  const start = new Date(match[0] + "T12:00:00+08:00");
  if (start > now) return 0;
  let count = 0;
  for (let day = new Date(start); day < now; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

const W = context.window;
const checks = [
  ["行情信号", W.META?.signalDate || W.META?.lastUpdated, 3, "market"],
  ["市场异动", W.MARKET?.date || W.MARKET?.generatedAt, 3, "market"],
  ["今日热点", W.HOT?.date || W.HOT?.generatedAt, 5, "market"],
  ["新闻公告", W.NEWSALL?.date || W.NEWSALL?.generatedAt, 5, "market"],
  ["行业排行", W.INDUSTRY_MARKET?.date || W.INDUSTRY_MARKET?.generatedAt, 5, "market"],
  ["AI复盘", W.REPORTS?.updated, 5, "ai"],
  ["产业雷达", W.INDUSTRY?.date || W.INDUSTRY?.generatedAt, 7, "ai"],
  ["逻辑链", W.LOGIC?.date || W.LOGIC?.generatedAt, 7, "ai"],
  ["事件概率", W.EVENTS?.date || W.EVENTS?.generatedAt, 7, "ai"],
  ["机会清单", W.OPPORTUNITIES?.date || W.OPPORTUNITIES?.generatedAt, 7, "ai"],
  ["材料涨价", W.MATERIALS?.date || W.MATERIALS?.generatedAt, 7, "ai"],
  ["周末发酵", W.WEEKEND?.weekendDate || W.WEEKEND?.generatedAt, 12, "ai"],
  ["X 热议", W.XFEED?.date || W.XFEED?.generatedAt, 5, "ai"],
];
const stale = [];
const softStale = [];
for (const [name, date, limit, group] of checks) {
  const age = businessDaysSince(date);
  const line = `${name}: ${date || "缺失"}（${Number.isFinite(age) ? age : "∞"} 个工作日）`;
  if (age > limit) {
    const enforced = scope === "all" || scope === group;
    (enforced ? stale : softStale).push(`${line}，上限 ${limit}`);
  } else {
    console.log(`OK ${line}`);
  }
}
if (softStale.length) {
  console.warn(softStale.map((item) => `WARN(scope外) ${item}`).join("\n"));
}
if (stale.length) {
  const message = stale.map((item) => `STALE ${item}`).join("\n");
  (strict ? console.error : console.warn)(message);
  if (strict) process.exit(1);
}
console.log(`freshness ok: ${checks.length - stale.length - softStale.length}/${checks.length}`);
