import { expect, test } from "@playwright/test";

const VIEWS = [
  "home",
  "holdings",
  "watch",
  "logic",
  "market",
  "hot",
  "news",
  "events",
  "agent",
  "chain",
  "weekend",
];
const REMOVED_NAV_VIEWS = new Set(["holdings", "opportunities", "market", "fundflow", "hot", "news"]);

test("11 个视图可深链接且无页面级横向溢出", async ({ page }) => {
  for (const view of VIEWS) {
    // hash 同文档导航下 tracing 会使 networkidle 无法安定，改用 domcontentloaded；视图切换由下方断言轮询保证
    await page.goto(`/index.html#${view}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveClass(new RegExp(`view-${view}`));
    const navItem = page.locator(`#sidebar .nav-item[data-view="${view}"]`);
    if (REMOVED_NAV_VIEWS.has(view)) await expect(navItem).toHaveCount(0);
    else await expect(navItem).toHaveAttribute("aria-current", "page");
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);
  }
});

test("已移除的模块不再显示导航入口", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });
  for (const view of REMOVED_NAV_VIEWS) {
    await expect(page.locator(`.nav-item[data-view="${view}"]`)).toHaveCount(0);
  }
});

test("模块名称已更新且旧名称不再出现在导航", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });
  await expect(page.locator('#sidebar .nav-item[data-view="xbrief"]')).toContainText("外围热点");
  await expect(page.locator('#sidebar .nav-item[data-view="events"]')).toContainText("今日热点事件");
  const navigationText = await page.locator("#sidebar").innerText();
  expect(navigationText).not.toContain("X 简报");
  expect(navigationText).not.toContain("事件概率");
  expect(navigationText).not.toContain("机会清单");
});

test("巨头概览位于卡片上方且顶栏数据不遮挡搜索", async ({ page }) => {
  await page.goto("/index.html#watch", { waitUntil: "networkidle" });
  const viewport = page.viewportSize();
  const overview = await page.locator(".watch-overview").boundingBox();
  const filters = await page.locator(".board .main-col > .filters").boundingBox();
  expect(overview).not.toBeNull();
  expect(filters).not.toBeNull();
  expect(overview.y + overview.height).toBeLessThanOrEqual(filters.y + 1);

  if ((viewport?.width || 0) >= 981) {
    const search = await page.locator(".global-search").boundingBox();
    const data = await page.locator(".sb-data").boundingBox();
    expect(search).not.toBeNull();
    expect(data).not.toBeNull();
    expect(search.x + search.width).toBeLessThanOrEqual(data.x + 1);
  }
});

test("外围热点排版清晰且正文不含乱码字符", async ({ page }) => {
  await page.goto("/index.html#xbrief", { waitUntil: "networkidle" });
  await expect(page.locator(".xb-hero-title")).toHaveText("外围热点");
  await expect(page.locator(".xb-article.active")).toBeVisible();
  const text = await page.locator("#viewXbrief").innerText();
  expect(text).not.toMatch(/�|ï¿½|Ã|Â|â€™|â€œ|â€|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/);
  expect(text).not.toMatch(/[⏱◎⌘]/);

  const rail = await page.locator(".xb-rail").boundingBox();
  const article = await page.locator(".xb-article.active").boundingBox();
  expect(rail).not.toBeNull();
  expect(article).not.toBeNull();
  expect(rail.y + rail.height).toBeLessThanOrEqual(article.y + 1);
});

test("导航写入历史并支持浏览器前进后退", async ({ page }) => {
  await page.goto("/index.html#logic", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveClass(/view-logic/);
  await page.evaluate(() => document.querySelector('.nav-item[data-view="chain"]').click());
  await expect(page).toHaveURL(/#chain$/);
  await expect(page).toHaveTitle(/产业链涨价 · A股盘面/);
  await page.goBack();
  await expect(page).toHaveURL(/#logic$/);
  await expect(page.locator("body")).toHaveClass(/view-logic/);
});

test("视图切换会记住各自滚动位置", async ({ page }) => {
  await page.goto("/index.html#logic", { waitUntil: "networkidle" });
  const before = await page.evaluate(() => {
    const content = document.querySelector(".content-in");
    const root = content && /auto|scroll/.test(getComputedStyle(content).overflowY)
      ? content
      : document.scrollingElement;
    root.scrollTop = Math.min(320, root.scrollHeight - root.clientHeight);
    return root.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector('.nav-item[data-view="chain"]').click());
  await page.evaluate(() => document.querySelector('.nav-item[data-view="logic"]').click());
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

test("研究内容不会直出内部字段、生成过程语或残缺括号", async ({ page }) => {
  for (const view of ["logic", "events", "hot", "agent"]) {
    // hash 同文档导航下 tracing 会使 networkidle 无法安定，改用 domcontentloaded
    await page.goto(`/index.html#${view}`, { waitUntil: "domcontentloaded" });
    const text = await page.locator("#mainContent").innerText();
    expect(text).not.toMatch(/\b(?:thsStrong|thsHot|break\s*=\s*\d+)\b/i);
    expect(text).not.toMatch(/^(?:I'll generate|现在我已经(?:获取|掌握))/m);
    // 生成过程语(工具流水账)不应出现在正文里;页脚出处说明(.rep-foot)合法含脚本名,排除
    const body = await page.evaluate(() => {
      const el = document.querySelector("#mainContent").cloneNode(true);
      el.querySelectorAll(".rep-foot").forEach((n) => n.remove());
      return el.innerText;
    });
    expect(body).not.toMatch(/(?:[\w-]+\.py\b|web_search|让我重试|数据已全部?到位|现在综合所有信息|获取了所有所需数据|现在让我来)/i);
    expect(text).not.toContain("京东方A（");
  }
});

// 报告断言使用固定夹具：AI 报告内容每天由 Hermes 重写，
// 不 mock 的话测试会随当天数据（如完整度为“全部正常”）而失败。
const REPORTS_FIXTURE = `window.REPORTS = ${JSON.stringify({
  updated: "2026-07-14 07:35",
  reports: [
    {
      type: "盘前简报",
      title: "每日盘前简报 · Jul 14 07:30",
      time: "2026-07-14 07:30",
      id: "cron_fixture_20260714_0730",
      content: [
        "数据完整度：部分缺失（自选股行情接口超时，其余正常）",
        "",
        "# 盘前简报（2026-07-14）",
        "",
        "## 1. 隔夜美股",
        "",
        "| 指数 | 收盘 | 涨跌幅 |",
        "|---|---|---|",
        "| 道琼斯 | 52,000 | -0.20% |",
        "",
        `正文段落，用于测量报告的行宽与阅读字号。${"市场情绪偏谨慎，注意仓位控制。".repeat(12)}`,
      ].join("\n"),
    },
    {
      type: "收盘复盘",
      title: "收盘复盘 · Jul 14 15:33",
      time: "2026-07-14 15:33",
      id: "cron_fixture_20260714_1533",
      content: [
        // 模型有时会把完整度行加粗，前端必须仍识别为状态条而非正文。
        "**数据完整度：[全部正常]**",
        "- 指数、板块、个股与龙虎榜数据均获取成功。",
        "",
        "## 1. 指数表现",
        "",
        `今日市场震荡整理，权重护盘、题材分化。${"成交额与昨日基本持平，情绪面中性。".repeat(6)}`,
      ].join("\n"),
    },
  ],
})};\n`;

test("核心阅读文字保持可读字号和报告行宽", async ({ page }) => {
  await page.route(/\/reports\.js(\?.*)?$/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: REPORTS_FIXTURE })
  );
  await page.goto("/index.html#logic", { waitUntil: "networkidle" });
  const researchSize = await page.locator(".sd-v, .sd-field-list .sum-txt").first().evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize)
  );
  expect(researchSize).toBeGreaterThanOrEqual(14);

  await page.goto("/index.html#agent", { waitUntil: "networkidle" });
  const report = page.locator(".rep-md").first();
  await expect(report).toBeVisible();
  await expect(report).not.toContainText("```markdown");
  await expect(report).not.toContainText("全部正常");
  await expect(report.locator(".rep-quality.is-partial").first()).toBeVisible();
  await expect(page.locator(".rep-head h2").first()).toContainText("07月14日 07:30");

  // 加粗的完整度行也应渲染成状态条，而不是混进正文段落。
  const closingBody = page.locator(".rep-body").nth(1).locator(".rep-md");
  await expect(closingBody.locator(".rep-quality.is-complete")).toHaveCount(1);
  await expect(closingBody).not.toContainText("数据完整度");
  await expect(closingBody).not.toContainText("**");

  const reportStyle = await report.evaluate((node) => {
    const style = getComputedStyle(node);
    return { fontSize: Number.parseFloat(style.fontSize), fontWeight: Number.parseFloat(style.fontWeight), width: node.getBoundingClientRect().width };
  });
  expect(reportStyle.fontSize).toBeGreaterThanOrEqual(15);
  expect(reportStyle.fontWeight).toBeGreaterThanOrEqual(450);
  expect(reportStyle.width).toBeLessThanOrEqual(760);
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
  await page.locator('.pf-del-btn[data-scope="watch"]').click();
  await expect(page.locator('.pf-del-btn[data-scope="watch"]')).toHaveText("再点一次确认");
  await page.locator('.pf-del-btn[data-scope="watch"]').click();
  await expect(page.locator(".watch-row")).toHaveCount(0);
});

test("自选可只填准确名称，并通过表单提交", async ({ page }) => {
  let portfolio = { updated: "2026-07-11", holdings: [], watchlist: [] };
  await page.route(/\/api\/portfolio$/, async (route) => {
    if (route.request().method() === "POST") portfolio = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ json: { ok: true, data: portfolio, msg: "已保存" } });
  });
  await page.route(/\/api\/portfolio\/refresh$/, (route) => route.fulfill({ status: 202, json: { ok: true, running: true, msg: "已开始更新" } }));
  await page.route(/\/api\/portfolio\/refresh\/status/, (route) => route.fulfill({ json: { running: true, done: false, error: null } }));
  await page.goto("/index.html#holdings", { waitUntil: "networkidle" });
  await page.locator("#pfWatchBtn").click();
  await page.locator("#pfName").fill("兆易创新");
  await expect(page.locator("#pfCode")).toHaveValue("603986");
  await page.locator("#pfAddForm").press("Enter");
  await expect(page.locator(".watch-row")).toContainText("兆易创新");
});
