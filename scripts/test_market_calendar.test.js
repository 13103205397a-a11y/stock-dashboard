const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isTradingDay,
  loadMarketCalendar,
  parseCalendarDate,
  tradingDaysSince,
} = require("./market_calendar");

const calendar = loadMarketCalendar();

test("交易日历识别交易日、周末和交易所节假日", () => {
  assert.equal(isTradingDay("2026-02-13", calendar), true);
  assert.equal(isTradingDay("2026-02-14", calendar), false);
  assert.equal(isTradingDay("2026-02-16", calendar), false);
  assert.equal(isTradingDay("2026-02-24", calendar), true);
});

test("春节长假不计入新鲜度交易日", () => {
  assert.equal(tradingDaysSince("2026-02-13", "2026-02-24", calendar), 1);
  // 2026 国庆休市 10/1–10/7；9/24→10/8 之间交易日为 9/24、9/28、9/29、9/30，共 4 天
  assert.equal(tradingDaysSince("2026-09-24", "2026-10-08", calendar), 4);
});

test("日期解析拒绝非法日历日期和未来倒序", () => {
  assert.equal(parseCalendarDate("2026-02-30"), null);
  assert.equal(tradingDaysSince("2026-07-30", "2026-07-29", calendar), Infinity);
});
