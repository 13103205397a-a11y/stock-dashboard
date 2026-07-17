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
  "industry_market.js",
  "materials.js",
  "logic.js",
  "events.js",
  "opportunities.js",
  "weekend.js",
  "x_feed.js",
  "reports.js",
];

const errors = [];
const warn = [];
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
const fail = (msg) => errors.push(msg);

for (const file of files) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    fail(`${file}: 文件不存在`);
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

if (!W.HOT || !Array.isArray(W.HOT.list) || !W.HOT.list.length) fail("hot.js: window.HOT.list 必须是非空数组");
if (!W.NEWSALL || !Array.isArray(W.NEWSALL.global) || !Array.isArray(W.NEWSALL.announcements)) {
  fail("newsall.js: global/announcements 必须都是数组");
}

[
  ["INDUSTRY", "directions"],
  ["MATERIALS", "directions"],
  ["LOGIC", "chains"],
  ["EVENTS", "events"],
  ["OPPORTUNITIES", "directions"],
  ["WEEKEND", "hotspots"],
].forEach(([key, arr]) => {
  if (!W[key] || !Array.isArray(W[key][arr]) || !W[key][arr].length) {
    fail(`${key}: ${arr} 必须是非空数组`);
  }
});

if (!W.REPORTS || !Array.isArray(W.REPORTS.reports)) {
  fail("reports.js: window.REPORTS.reports 必须是数组");
}

// X 热议允许为空（首次运行前 / 无有效讨论），但结构必须正确
if (!W.XFEED || !Array.isArray(W.XFEED.topics) || !Array.isArray(W.XFEED.watchlist)) {
  fail("x_feed.js: XFEED.topics/watchlist 必须都是数组");
}

if (!W.INDUSTRY_MARKET || !Array.isArray(W.INDUSTRY_MARKET.top) ||
    !Array.isArray(W.INDUSTRY_MARKET.bottom) || typeof W.INDUSTRY_MARKET.total !== "number") {
  fail("industry_market.js: INDUSTRY_MARKET 协议无效");
} else if (!W.INDUSTRY_MARKET.top.length) {
  warn.push("industry_market.js: 行业排行尚无数据");
}

const referenceArrays = new Set(["stocks", "impactStocks", "watchlist"]);
function validateReferences(value, trail = "window", depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => validateReferences(item, `${trail}[${i}]`, depth + 1));
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    const next = `${trail}.${key}`;
    if (referenceArrays.has(key) && Array.isArray(child)) {
      child.forEach((item, i) => {
        if (!item || !/^\d{6}$/.test(String(item.code || "")) || !String(item.name || "").trim()) {
          fail(`${next}[${i}]: 可点击股票必须包含 6 位 code 和 name`);
        }
      });
    }
    validateReferences(child, next, depth + 1);
  });
}
[
  ["OPPORTUNITIES", W.OPPORTUNITIES], ["LOGIC", W.LOGIC], ["INDUSTRY", W.INDUSTRY],
  ["MATERIALS", W.MATERIALS], ["EVENTS", W.EVENTS], ["WEEKEND", W.WEEKEND],
  ["XFEED", W.XFEED],
].forEach(([name, value]) => validateReferences(value, name));

const editorial = { processText: [], internalTokens: [], runOnText: [] };
const aiProcessStart = /^(?:I(?:'ll| will) (?:generate|prepare)|I (?:now )?have all the data|Let me |All data verified|Here(?:'s| is) the |现在我已经(?:获取|掌握).*(?:让我来|下面))/i;
const internalToken = /\b(?:thsStrong|thsHot|break\s*=\s*\d+)\b|\bconfidence\s*=/i;
function validateEditorialText(value, trail = "window", depth = 0) {
  if (value == null || depth > 10) return;
  if (typeof value === "string") {
    const roundOpen = (value.match(/（/g) || []).length;
    const squareOpen = (value.match(/【/g) || []).length;
    const squareClose = (value.match(/】/g) || []).length;
    // “1）2）”属于正常编号，因此忽略多余右括号，但拦截没有闭合的左括号。
    let roundDepth = 0;
    for (const char of value) {
      if (char === "（") roundDepth += 1;
      else if (char === "）" && roundDepth > 0) roundDepth -= 1;
    }
    if (roundOpen > 0 && roundDepth > 0) fail(`${trail}: 中文圆括号不完整`);
    if ((squareOpen || squareClose) && squareOpen !== squareClose) fail(`${trail}: 中文方括号不完整`);
    if (aiProcessStart.test(value.trim())) editorial.processText.push(trail);
    if (internalToken.test(value)) editorial.internalTokens.push(trail);
    if (value.length > 420 && !/[。！？；;\n]/.test(value)) editorial.runOnText.push(trail);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => validateEditorialText(item, `${trail}[${i}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => validateEditorialText(child, `${trail}.${key}`, depth + 1));
  }
}
validateEditorialText(W);
if (editorial.processText.length) {
  warn.push(`内容质检: ${editorial.processText.length} 处 AI 过程语将在前端隐藏；源头需清理 (${editorial.processText.slice(0, 3).join(", ")})`);
}
if (editorial.internalTokens.length) {
  warn.push(`内容质检: ${editorial.internalTokens.length} 处内部字段将在前端转义 (${editorial.internalTokens.slice(0, 3).join(", ")})`);
}
if (editorial.runOnText.length) {
  warn.push(`内容质检: ${editorial.runOnText.length} 处超长无断句文本 (${editorial.runOnText.slice(0, 3).join(", ")})`);
}

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (/document\.write\s*\(/.test(html)) fail("index.html: 禁止使用 document.write 动态注入脚本");
for (const script of ["holdings.js", "portfolio_analysis.js", "weekend.js", "industry_market.js", "app.js"]) {
  if (!html.includes(`src="${script}`)) fail(`index.html: 缺少 ${script} 脚本标签`);
}
const appPos = html.indexOf('src="app.js');
for (const script of ["holdings.js", "portfolio_analysis.js", "weekend.js", "industry_market.js"]) {
  if (html.indexOf(`src="${script}`) > appPos) fail(`index.html: ${script} 必须在 app.js 之前加载`);
}

if (warn.length) {
  console.warn(warn.map((x) => `WARN ${x}`).join("\n"));
}
if (errors.length) {
  console.error(errors.map((x) => `FAIL ${x}`).join("\n"));
  process.exit(1);
}
console.log(`validate_data ok: ${files.length} files, ${Array.isArray(W.STOCKS) ? W.STOCKS.length : 0} stocks`);
