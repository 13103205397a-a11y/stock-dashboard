const assert = require("assert");
const { classifySignal } = require("./fetch_portfolio_signals.js");

assert.equal(classifySignal({ trend: "空头排列", leftState: "", rightState: "" }).status, "风险回避");
assert.equal(classifySignal({ trend: "多头排列", leftState: "已回踩至逢低区 · 可分批左侧", rightState: "" }).status, "重点关注");
assert.equal(classifySignal({ trend: "震荡", leftState: "", rightState: "临近突破 · 距 2.0%" }).status, "接近触发");
assert.equal(classifySignal({ trend: "震荡", leftState: "", rightState: "箱体内", pullbackPct: 8 }).status, "继续观察");
console.log("portfolio signal classification tests passed");
