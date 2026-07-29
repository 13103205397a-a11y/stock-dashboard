#!/usr/bin/env node
/* 数据新鲜度门禁：活跃模块与阈值统一来自 active_modules.json。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  loadMarketCalendar,
  parseCalendarDate,
  tradingDaysSince,
} = require("./market_calendar");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "active_modules.json");
const strict = process.argv.includes("--strict");
// --scope=market: 只对行情类数据严格把关；AI 模块由本地任务维护。
const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
const scope = scopeArg ? scopeArg.slice(8) : "all";
const nowArg = process.argv.find((arg) => arg.startsWith("--now="));
// 「今天」按北京时间取日历日；toISOString 是 UTC，北京 0:00-8:00 会差一天。
const todayCn = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const nowDate = nowArg ? nowArg.slice(6) : todayCn;

const now = parseCalendarDate(nowDate);
if (!now) {
  console.error(`--now 日期无效: ${nowDate}`);
  process.exit(2);
}
const marketCalendar = loadMarketCalendar();

function loadModules() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.modules) || !manifest.modules.length) {
    throw new Error("active_modules.json 协议无效");
  }
  const ids = new Set();
  const files = new Set();
  for (const module of manifest.modules) {
    if (
      !module || typeof module.id !== "string" || !module.id ||
      typeof module.file !== "string" || path.basename(module.file) !== module.file ||
      typeof module.global !== "string" || !module.global
    ) {
      throw new Error("active_modules.json 中存在无效模块");
    }
    if (ids.has(module.id) || files.has(module.file)) {
      throw new Error("active_modules.json 中存在重复模块");
    }
    ids.add(module.id);
    files.add(module.file);
  }
  return manifest.modules;
}

const modules = loadModules();
const context = { window: {} };
vm.createContext(context);
for (const module of modules) {
  const file = path.join(ROOT, module.file);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, {
    filename: module.file,
    timeout: 1000,
  });
}

function businessDaysSince(value) {
  const start = parseCalendarDate(value);
  // 缺失、非法日期及未来日期都不能伪装成“新鲜”；
  // 上交所/深交所公告休市日与周末一样不计入交易日。
  return tradingDaysSince(start, now, marketCalendar);
}

function getPath(value, selector) {
  return selector.split(".").reduce((current, key) => current == null ? undefined : current[key], value);
}

function selectDate(value, selector) {
  if (selector.startsWith("median:") || selector.startsWith("oldest:")) {
    const [mode, pathSelector] = selector.split(":", 2);
    if (!Array.isArray(value)) return null;
    const dates = value.map((item) => getPath(item, pathSelector)).filter(Boolean).sort();
    if (!dates.length) return null;
    return mode === "oldest" ? dates[0] : dates[Math.floor(dates.length / 2)];
  }
  for (const candidate of selector.split("|")) {
    const selected = getPath(value, candidate);
    if (selected) return selected;
  }
  return null;
}

const checks = [];
for (const module of modules) {
  const value = context.window[module.global];
  for (const rule of module.freshness || []) {
    if (
      !rule || typeof rule.selector !== "string" ||
      !Number.isInteger(rule.limitBusinessDays) || rule.limitBusinessDays < 0 ||
      !["market", "ai"].includes(rule.scope)
    ) {
      throw new Error(`active_modules.json: ${module.id} 新鲜度规则无效`);
    }
    checks.push({
      name: rule.label || module.label || module.id,
      date: selectDate(value, rule.selector),
      limit: rule.limitBusinessDays,
      group: rule.scope,
    });
  }
}

const stale = [];
const softStale = [];
for (const { name, date, limit, group } of checks) {
  const age = businessDaysSince(date);
  const line = `${name}: ${date || "缺失"}（${Number.isFinite(age) ? age : "无效/未来"} 个工作日）`;
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
