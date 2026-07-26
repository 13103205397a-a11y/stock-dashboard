/* fetch_signals.js 的 computeSignal 单元测试（Node 20 内置 node:test）。
 * 运行：node --test scripts/test_signals.test.js
 *
 * computeSignal 是纯函数，接收日K数组，返回 { signal, leftZone, ... }。
 * 这里只测算法逻辑，不碰真实行情/文件读写。
 */
const test = require("node:test");
const assert = require("node:assert");
const { computeSignal } = require("./fetch_signals.js");

// 生成 n 根日K：close 从 start 起，每日 step 递增（step=0 即横盘），high=close+1, low=close-1
function genK(n, start, step, opts = {}) {
  const vol = opts.vol ?? 1000;
  const out = [];
  let c = start;
  for (let i = 0; i < n; i++) {
    const mm = String(Math.floor(i / 28) + 1).padStart(2, "0");
    const dd = String((i % 28) + 1).padStart(2, "0");
    out.push({ date: `2024-${mm}-${dd}`, open: c, close: c, high: c + 1, low: c - 1, vol });
    c += step;
  }
  return out;
}

test("多头排列：close 持续上行 → trend=多头排列, posPct>0", () => {
  const { signal } = computeSignal(genK(120, 10, 0.3));
  assert.equal(signal.trend, "多头排列");
  assert.ok(signal.posPct > 0, `posPct 应 >0, 实际 ${signal.posPct}`);
  assert.ok(signal.ma60 > 0);
});

test("空头排列：close 持续下行 → trend=空头排列, posPct<0", () => {
  const { signal } = computeSignal(genK(120, 50, -0.3));
  assert.equal(signal.trend, "空头排列");
  assert.ok(signal.posPct < 0);
});

test("左侧逢低区：回踩至历史支撑附近 → 可分批左侧", () => {
  // 119 根 close=20 横盘（low=19，历史支撑 19），第 120 根 close=19 落在支撑上
  const k = genK(119, 20, 0);
  k.push({ date: "2024-04-30", open: 19, close: 19, high: 20, low: 18.9, vol: 1000 });
  const { signal } = computeSignal(k);
  assert.ok(/已回踩至逢低区/.test(signal.leftState), `leftState 应命中逢低区, 实际: ${signal.leftState}`);
});

test("左侧逢低区：现价远离支撑 → 回踩约 X% 入场（不误报已到逢低区）", () => {
  // 100 根 close=20 横盘，随后急涨到 24，支撑带远在下方
  const k = genK(100, 20, 0);
  k.push({ date: "2024-04-01", open: 20, close: 21, high: 21.5, low: 19.8, vol: 1000 });
  k.push({ date: "2024-04-02", open: 21, close: 22.5, high: 23, low: 20.8, vol: 1000 });
  k.push({ date: "2024-04-03", open: 22.5, close: 24, high: 24.5, low: 22.2, vol: 1000 });
  const { signal } = computeSignal(k);
  assert.ok(/回踩约 [\d.]+% 入场/.test(signal.leftState), `leftState 应为等回踩, 实际: ${signal.leftState}`);
});

test("左侧逢低区：暴跌跌穿全部历史支撑 → 破位观望（死代码回归）", () => {
  // 119 根 close=10 横盘（low=9），第 120 根崩到 7.5（-25%），
  // 所有均线与历史低都在 9 附近 → 现价下方无支撑 → 必须报破位，不得报"可分批左侧"
  const k = genK(119, 10, 0);
  k.push({ date: "2024-04-30", open: 10, close: 7.5, high: 10, low: 7.4, vol: 3000 });
  const { signal } = computeSignal(k);
  assert.ok(/已跌破逢低区 · 转弱观望/.test(signal.leftState), `leftState 应为破位观望, 实际: ${signal.leftState}`);
});

test("右侧突破：close 创 60 日新高且量比≥1.3 → 已放量突破", () => {
  // 115 根 close=10 横盘，4 根放量（vol=2000），第 120 根 close=12.5 创新高
  const k = genK(115, 10, 0);
  for (let i = 0; i < 4; i++) {
    k.push({ date: `2024-04-0${i + 1}`, open: 10, close: 10, high: 11, low: 9, vol: 2000 });
  }
  k.push({ date: "2024-04-05", open: 11, close: 12.5, high: 12.5, low: 11, vol: 2000 });
  const { signal } = computeSignal(k);
  assert.ok(/已放量突破/.test(signal.rightState), `rightState 应命中突破, 实际: ${signal.rightState}`);
  assert.ok(signal.volRatio >= 1.3, `volRatio 应≥1.3, 实际 ${signal.volRatio}`);
});

test("盈亏比夹顶：任意场景 leftRR ≤ 10 或 null", () => {
  const cases = [genK(120, 10, 0.3), genK(120, 50, -0.3), genK(120, 20, 0)];
  for (const k of cases) {
    const { signal } = computeSignal(k);
    assert.ok(signal.leftRR == null || signal.leftRR <= 10, `leftRR 应≤10, 实际 ${signal.leftRR}`);
  }
});

test("K线不足：少于 60 根时 ma60/high60/low60 为 null，不崩", () => {
  const { signal } = computeSignal(genK(25, 10, 0.1));
  assert.equal(signal.ma60, null);
  assert.equal(signal.high60, null);
  assert.equal(signal.low60, null);
  assert.ok(signal.price > 0);
});
