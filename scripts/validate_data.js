#!/usr/bin/env node
/* 公开数据结构校验：活跃模块统一来自 active_modules.json。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "active_modules.json");
const context = { window: {} };
vm.createContext(context);

const errors = [];
const warn = [];
const fail = (message) => errors.push(message);
const todayCn = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

function parseCalendarDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const parsed = new Date(`${yearText}-${monthText}-${dayText}T12:00:00+08:00`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getFullYear() !== Number(yearText) ||
    parsed.getMonth() + 1 !== Number(monthText) ||
    parsed.getDate() !== Number(dayText)
  ) {
    return null;
  }
  return parsed;
}

const today = parseCalendarDate(todayCn);
const isDate = (value) => {
  const parsed = parseCalendarDate(value);
  return Boolean(parsed && parsed <= today);
};

function loadModules() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (error) {
    fail(`active_modules.json: 无法读取: ${error.message}`);
    return [];
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.modules) || !manifest.modules.length) {
    fail("active_modules.json: 协议无效");
    return [];
  }
  const ids = new Set();
  const files = new Set();
  const globals = new Set();
  const validModules = [];
  for (const module of manifest.modules) {
    if (
      !module || typeof module.id !== "string" || !module.id ||
      typeof module.file !== "string" || path.basename(module.file) !== module.file ||
      typeof module.global !== "string" || !module.global ||
      !module.contract || typeof module.contract !== "object"
    ) {
      fail("active_modules.json: 存在无效模块");
      continue;
    }
    if (ids.has(module.id) || files.has(module.file) || globals.has(module.global)) {
      fail(`active_modules.json: 模块重复 ${module.id}`);
      continue;
    }
    ids.add(module.id);
    files.add(module.file);
    globals.add(module.global);
    validModules.push(module);
  }
  return validModules;
}

const modules = loadModules();
for (const module of modules) {
  const abs = path.join(ROOT, module.file);
  if (!fs.existsSync(abs)) {
    fail(`${module.file}: 文件不存在`);
    continue;
  }
  try {
    vm.runInContext(fs.readFileSync(abs, "utf8"), context, {
      filename: module.file,
      timeout: 1000,
    });
  } catch (error) {
    fail(`${module.file}: JS 执行失败: ${error.message}`);
  }
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

for (const module of modules) {
  const value = context.window[module.global];
  const contract = module.contract || {};
  const expectedType = contract.rootType;
  if (!["array", "object"].includes(expectedType)) {
    fail(`active_modules.json: ${module.id} contract.rootType 无效`);
    continue;
  }
  const isExpectedRoot =
    expectedType === "array" ? Array.isArray(value) :
    expectedType === "object" ? Boolean(value && typeof value === "object" && !Array.isArray(value)) :
    false;
  if (!isExpectedRoot) {
    fail(`${module.file}: window.${module.global} 必须是${expectedType === "array" ? "数组" : "对象"}`);
    continue;
  }
  if (expectedType === "array" && Number.isInteger(contract.minItems) && value.length < contract.minItems) {
    fail(`${module.file}: window.${module.global} 至少需要 ${contract.minItems} 项`);
  }
  for (const key of contract.requiredArrays || []) {
    if (!Array.isArray(value[key])) fail(`${module.file}: ${key} 必须是数组`);
  }
  for (const key of contract.nonEmptyArrays || []) {
    if (!Array.isArray(value[key]) || !value[key].length) fail(`${module.file}: ${key} 必须是非空数组`);
  }
  for (const key of contract.requiredNumbers || []) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      fail(`${module.file}: ${key} 必须是有限数值`);
    }
  }
  if (
    Array.isArray(contract.nonEmptyAnyArrays) &&
    !contract.nonEmptyAnyArrays.some((key) => Array.isArray(value[key]) && value[key].length)
  ) {
    warn.push(`${module.file}: 主要数据池均为空`);
  }
  for (const freshness of module.freshness || []) {
    if (
      !freshness || typeof freshness.selector !== "string" || !freshness.selector ||
      !Number.isInteger(freshness.limitBusinessDays) || freshness.limitBusinessDays < 0 ||
      !["market", "ai"].includes(freshness.scope)
    ) {
      fail(`active_modules.json: ${module.id} 新鲜度规则无效`);
      continue;
    }
    const selected = selectDate(value, freshness.selector);
    if (!isDate(selected)) {
      fail(`${module.file}: ${freshness.selector} 缺少有效且非未来的日期`);
    }
  }
}

const stocksModule = modules.find((module) => module.contract?.validateStockRecords);
const stocks = stocksModule ? context.window[stocksModule.global] : null;
if (Array.isArray(stocks)) {
  const seen = new Set();
  stocks.forEach((stock, index) => {
    if (!/^\d{6}$/.test(String(stock?.code || ""))) fail(`STOCKS[${index}]: code 必须是 6 位数字`);
    if (!stock?.name) fail(`STOCKS[${index}]: 缺少 name`);
    if (!stock?.sector) fail(`STOCKS[${index}]: 缺少 sector`);
    if (seen.has(stock?.code)) fail(`STOCKS: 重复代码 ${stock.code}`);
    seen.add(stock?.code);
    if (stocksModule.contract?.requireSignalDate) {
      if (!stock?.signal || typeof stock.signal !== "object" || !isDate(stock.signal.date)) {
        fail(`${stock.code}: 缺少有效且非未来的 signal.date`);
      }
    } else if (stock?.signal?.date && !isDate(stock.signal.date)) {
      fail(`${stock.code}: signal.date 格式异常或晚于今天`);
    }
  });
}

const referenceArrays = new Set(["stocks", "impactStocks", "watchlist"]);
function validateReferences(value, trail = "window", depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateReferences(item, `${trail}[${index}]`, depth + 1));
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    const next = `${trail}.${key}`;
    if (referenceArrays.has(key) && Array.isArray(child)) {
      child.forEach((item, index) => {
        if (!item || !/^\d{6}$/.test(String(item.code || "")) || !String(item.name || "").trim()) {
          fail(`${next}[${index}]: 可点击股票必须包含 6 位 code 和 name`);
        }
      });
    }
    validateReferences(child, next, depth + 1);
  });
}
for (const module of modules.filter((item) => item.contract?.validateReferences)) {
  validateReferences(context.window[module.global], module.global);
}

const editorial = { processText: [], internalTokens: [], runOnText: [] };
const aiProcessStart = /^(?:I(?:'ll| will) (?:generate|prepare)|I (?:now )?have all the data|Let me |All data verified|Here(?:'s| is) the |现在我已经(?:获取|掌握).*(?:让我来|下面))/i;
const internalToken = /\b(?:thsStrong|thsHot|break\s*=\s*\d+)\b|\bconfidence\s*=/i;
function validateEditorialText(value, trail = "window", depth = 0) {
  if (value == null || depth > 10) return;
  if (typeof value === "string") {
    const roundOpen = (value.match(/（/g) || []).length;
    const squareOpen = (value.match(/【/g) || []).length;
    const squareClose = (value.match(/】/g) || []).length;
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
    value.forEach((item, index) => validateEditorialText(item, `${trail}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => validateEditorialText(child, `${trail}.${key}`, depth + 1));
  }
}
for (const module of modules) {
  validateEditorialText(context.window[module.global], module.global);
}
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
const appPos = html.indexOf('src="app.js');
if (appPos < 0) fail("index.html: 缺少 app.js 脚本标签");
for (const module of modules) {
  const scriptPos = html.indexOf(`src="${module.file}`);
  if (scriptPos < 0) fail(`index.html: 缺少活跃模块 ${module.file} 脚本标签`);
  if (scriptPos > appPos) fail(`index.html: ${module.file} 必须在 app.js 之前加载`);
}

if (warn.length) console.warn(warn.map((message) => `WARN ${message}`).join("\n"));
if (errors.length) {
  console.error(errors.map((message) => `FAIL ${message}`).join("\n"));
  process.exit(1);
}
console.log(`validate_data ok: ${modules.length} active modules, ${Array.isArray(stocks) ? stocks.length : 0} stocks`);
