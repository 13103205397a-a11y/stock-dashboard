#!/usr/bin/env node
/* 公开数据结构校验：不抓网，不读取本地私有持仓。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const context = { window: {} };
vm.createContext(context);

const files = [
  "data.js",
  "meta.js",
  "market.js",
  "hot.js",
  "newsall.js",
  "industry.js",
  "materials.js",
  "logic.js",
  "events.js",
  "opportunities.js",
  "weekend.js",
  "reports.js",
];

const errors = [];
const warn = [];
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
const fail = (msg) => errors.push(msg);

for (const file of files) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    warn.push(`${file}: 文件不存在`);
    continue;
  }
  try {
    vm.runInContext(fs.readFileSync(abs, "utf8"), context, { filename: file, timeout: 1000 });
  } catch (e) {
    fail(`${file}: JS 执行失败: ${e.message}`);
  }
}

const W = context.window;

if (!Array.isArray(W.STOCKS) || !W.STOCKS.length) {
  fail("data.js: window.STOCKS 必须是非空数组");
} else {
  const seen = new Set();
  W.STOCKS.forEach((s, i) => {
    if (!/^\d{6}$/.test(String(s.code || ""))) fail(`STOCKS[${i}]: code 必须是 6 位数字`);
    if (!s.name) fail(`STOCKS[${i}]: 缺少 name`);
    if (!s.sector) fail(`STOCKS[${i}]: 缺少 sector`);
    if (seen.has(s.code)) fail(`STOCKS: 重复代码 ${s.code}`);
    seen.add(s.code);
    if (s.signal && s.signal.date && !isDate(s.signal.date)) fail(`${s.code}: signal.date 格式异常`);
  });
}

if (!W.META || !isDate(W.META.signalDate || W.META.lastUpdated)) {
  fail("meta.js: 缺少有效 signalDate/lastUpdated");
}

if (!W.MARKET || !isDate(W.MARKET.date || W.MARKET.generatedAt)) {
  fail("market.js: 缺少有效 date/generatedAt");
} else {
  const pools = ["topGainers", "topLosers", "topTurnover", "topInflow", "topOutflow", "limitUp", "limitDown", "hotRank"];
  if (!pools.some((k) => Array.isArray(W.MARKET[k]) && W.MARKET[k].length)) {
    warn.push("market.js: 主要异动池均为空");
  }
}

if (!W.HOT || !Array.isArray(W.HOT.list)) fail("hot.js: window.HOT.list 必须是数组");
if (W.NEWSALL && !Array.isArray(W.NEWSALL.global) && !Array.isArray(W.NEWSALL.announcements)) {
  warn.push("newsall.js: global/announcements 均不是数组");
}

[
  ["INDUSTRY", "directions"],
  ["MATERIALS", "directions"],
  ["LOGIC", "chains"],
  ["EVENTS", "events"],
  ["OPPORTUNITIES", "directions"],
  ["WEEKEND", "hotspots"],
].forEach(([key, arr]) => {
  if (W[key] && !Array.isArray(W[key][arr])) warn.push(`${key}: ${arr} 不是数组`);
});

if (warn.length) {
  console.warn(warn.map((x) => `WARN ${x}`).join("\n"));
}
if (errors.length) {
  console.error(errors.map((x) => `FAIL ${x}`).join("\n"));
  process.exit(1);
}
console.log(`validate_data ok: ${files.length} files, ${Array.isArray(W.STOCKS) ? W.STOCKS.length : 0} stocks`);
