"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CALENDAR_PATH = path.join(ROOT, "market_calendar.json");

function parseCalendarDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(`${yearText}-${monthText}-${dayText}T12:00:00+08:00`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function dateKey(value) {
  const parsed = value instanceof Date ? value : parseCalendarDate(value);
  if (!parsed) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadMarketCalendar(calendarPath = CALENDAR_PATH) {
  const calendar = JSON.parse(fs.readFileSync(calendarPath, "utf8"));
  if (
    calendar.schemaVersion !== 1 ||
    calendar.market !== "SSE/SZSE" ||
    calendar.timeZone !== "Asia/Shanghai" ||
    !Array.isArray(calendar.closedWeekdays)
  ) {
    throw new Error("market_calendar.json 协议无效");
  }
  const closed = new Set();
  for (const value of calendar.closedWeekdays) {
    const parsed = parseCalendarDate(value);
    const key = dateKey(parsed);
    if (!parsed || key !== value) {
      throw new Error(`market_calendar.json 包含无效日期: ${value}`);
    }
    const weekday = parsed.getUTCDay();
    if (weekday === 0 || weekday === 6) {
      throw new Error(`market_calendar.json 不应重复记录周末: ${value}`);
    }
    if (closed.has(value)) {
      throw new Error(`market_calendar.json 包含重复日期: ${value}`);
    }
    closed.add(value);
  }
  return { ...calendar, closed };
}

function isTradingDay(value, calendar) {
  const parsed = value instanceof Date ? value : parseCalendarDate(value);
  if (!parsed) return false;
  const weekday = parsed.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !calendar.closed.has(dateKey(parsed));
}

function tradingDaysSince(value, now, calendar) {
  const start = value instanceof Date ? new Date(value) : parseCalendarDate(value);
  const end = now instanceof Date ? new Date(now) : parseCalendarDate(now);
  if (!start || !end || start > end) return Infinity;
  let count = 0;
  for (let day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (isTradingDay(day, calendar)) count += 1;
  }
  return count;
}

module.exports = {
  CALENDAR_PATH,
  dateKey,
  isTradingDay,
  loadMarketCalendar,
  parseCalendarDate,
  tradingDaysSince,
};
