import { expect, test } from "@playwright/test";

const VIEWS = [
  "home",
  "holdings",
  "watch",
  "opportunities",
  "logic",
  "market",
  "hot",
  "news",
  "events",
  "agent",
  "industry",
  "materials",
  "weekend",
];

test("13 个视图可深链接且无页面级横向溢出", async ({ page }) => {
  for (const view of VIEWS) {
    await page.goto(`/index.html#${view}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toHaveClass(new RegExp(`view-${view}`));
    await expect(page.locator(`.nav-item[data-view="${view}"]`)).toHaveAttribute("aria-current", "page");
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);
  }
});

test("导航写入历史并支持浏览器前进后退", async ({ page }) => {
  await page.goto("/index.html#market", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveClass(/view-market/);
  await page.evaluate(() => document.querySelector('.nav-item[data-view="news"]').click());
  await expect(page).toHaveURL(/#news$/);
  await expect(page).toHaveTitle(/新闻 · A股盘面/);
  await page.goBack();
  await expect(page).toHaveURL(/#market$/);
  await expect(page.locator("body")).toHaveClass(/view-market/);
});

test("视图切换会记住各自滚动位置", async ({ page }) => {
  await page.goto("/index.html#opportunities", { waitUntil: "networkidle" });
  const before = await page.evaluate(() => {
    const content = document.querySelector(".content-in");
    const root = content && /auto|scroll/.test(getComputedStyle(content).overflowY)
      ? content
      : document.scrollingElement;
    root.scrollTop = Math.min(320, root.scrollHeight - root.clientHeight);
    return root.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector('.nav-item[data-view="news"]').click());
  await page.evaluate(() => document.querySelector('.nav-item[data-view="opportunities"]').click());
  const after = await page.evaluate(() => {
    const content = document.querySelector(".content-in");
    const root = content && /auto|scroll/.test(getComputedStyle(content).overflowY)
      ? content
      : document.scrollingElement;
    return root.scrollTop;
  });
  expect(after).toBe(before);
});

test("搜索支持上下键选择、Enter 打开和焦点返回", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "networkidle" });
  const input = page.locator("#globalSearchInput");
  await input.fill("兆易创新");
  await expect(page.locator(".search-hit")).not.toHaveCount(0);
  await input.press("ArrowDown");
  await expect(page.locator(".search-hit.active")).toHaveCount(1);
  await input.press("Enter");
  await expect(page.locator("#drawer")).toHaveClass(/show/);
  await expect(page.locator("#dclose")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).not.toHaveClass(/show/);
  await expect(input).toBeFocused();
});

test("详情抽屉具备对话框语义和键盘关闭后的焦点恢复", async ({ page }) => {
  await page.goto("/index.html#watch", { waitUntil: "networkidle" });
  const card = page.locator(".card[data-code]").first();
  await card.focus();
  await card.press("Enter");
  const drawer = page.locator("#drawer");
  await expect(drawer).toHaveAttribute("role", "dialog");
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
});

test("新闻摘要可展开，公告股票代码可打开详情", async ({ page }) => {
  await page.goto("/index.html#news", { waitUntil: "networkidle" });
  const details = page.locator(".nf-details").first();
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  const stockButton = page.locator(".ann-stock-link[data-code]").first();
  await stockButton.click();
  await expect(page.locator("#drawer")).toHaveClass(/show/);
});

test("自选支持添加、自动刷新后展示和删除", async ({ page }) => {
  let portfolio = { updated: "2026-07-11", holdings: [], watchlist: [] };
  await page.route(/\/api\/portfolio$/, async (route) => {
    if (route.request().method() === "POST") portfolio = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ json: { ok: true, data: portfolio, msg: "已保存" } });
  });
  await page.route(/\/api\/portfolio\/refresh$/, (route) => route.fulfill({ json: { ok: true, msg: "已更新" } }));
  await page.goto("/index.html#holdings", { waitUntil: "networkidle" });
  await page.locator("#pfWatchBtn").click();
  await page.locator("#pfCode").fill("000001");
  await page.locator("#pfName").fill("平安银行");
  await page.locator("#pfSave").click();
  await expect(page.locator(".watch-row")).toContainText("平安银行");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('.pf-del-btn[data-scope="watch"]').click();
  await expect(page.locator(".watch-row")).toHaveCount(0);
});
