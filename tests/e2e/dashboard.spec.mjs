import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const VIEWS = [
  "home",
  "watch",
  "market",
  "logic",
  "xbrief",
  "kimi",
  "events",
  "weekend",
];
const REMOVED_NAV_VIEWS = new Set([
  "holdings",
  "opportunities",
  "fundflow",
  "hot",
  "news",
  "agent",
  "chain",
  "reports",
  "industry",
  "materials",
]);

const SAMPLE_XBRIEF = {
  id: "sample-daily-brief",
  time: "2026-08-05 23:00",
  period: "近约1天",
  title: "外围热点",
  aiCount: 1,
  marketCount: 1,
  hasFocusStock: false,
  content: `# X 资讯简报 · AI & 股市
**时段**：近约 1 天（北京时间 2026-08-05 23:00 前后） | **筛选说明**：仅收录可验证的新事实

## 一、AI 要闻（最多 5 条）

1. **OpenAI 发布新的模型能力更新**
   官方公布了明确的能力更新与时间节点。
   **为何重要**：影响模型竞争与算力需求预期。
   **可信度**：高 | **来源**：[@OpenAI](https://x.com/OpenAI/status/2085000000000000000) | **发布时间**：北京时间 2026-08-05 22:30

## 二、股市/财经要闻（最多 5 条）

1. **美股主要指数在财报后出现分化**
   大型科技与周期板块走势不同。
   **为何重要**：影响次日 A 股成长风格风险偏好。
   **可信度**：中高 | **来源**：[@ReutersBiz](https://x.com/ReutersBiz/status/2085000000000000001) | **发布时间**：北京时间 2026-08-05 22:40

## 三、全球战争/地缘（最多 5 条）

1. **某地区冲突双方宣布临时停火并恢复谈判**
   多方斡旋下局势出现缓和迹象。
   **为何重要**：影响原油与航运价格，进而影响全球风险偏好。
   **可信度**：高 | **来源**：[@Reuters](https://x.com/Reuters/status/2085000000000000002) | **发布时间**：北京时间 2026-08-05 22:50

## 四、噪音观察

- 无来源喊单与旧闻重复已过滤。

## 五、一句话结论

- **AI 侧**：关注模型发布后的算力需求。
- **股市侧**：关注科技权重的财报验证。`,
};

async function renderSampleXbrief(page) {
  await page.evaluate((brief) => {
    window.XBRIEFS = { updated: brief.time, generatedAt: brief.time, briefs: [brief] };
    window.App.renderXBriefs();
  }, SAMPLE_XBRIEF);
}

test("8 个活动视图可深链接且无页面级横向溢出", async ({ page }) => {
  for (const view of VIEWS) {
    // hash 同文档导航下 tracing 会使 networkidle 无法安定，改用 domcontentloaded；视图切换由下方断言轮询保证
    await page.goto(`/index.html#${view}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveClass(new RegExp(`view-${view}`));
    const navItem = page.locator(`#sidebar .nav-item[data-view="${view}"]`);
    await expect(navItem).toHaveAttribute("aria-current", "page");
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
  await expect(page.locator("#viewHome")).not.toContainText("数据健康");
  await expect(page.locator("#viewHome .health-grid")).toHaveCount(0);
  await expect(page.locator("#viewHome .refresh-panel")).toHaveCount(0);
  await expect(page.locator("#viewHoldings, #viewFundflow, #viewHot, #viewNews")).toHaveCount(0);
  await expect(page.locator("#viewMarket")).toHaveCount(1);
  const scriptSources = await page.locator("script[src]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("src"))
  );
  expect(scriptSources.join(" ")).not.toMatch(/app_holdings|holdings\.js|portfolio_|fundflow\.js|hot\.js|newsall\.js|industry_market\.js/);
});

test("退休或未知深链会规范化为首页", async ({ page }) => {
  for (const view of [...REMOVED_NAV_VIEWS, "unknown-view"]) {
    await page.goto(`/index.html#${view}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/#home$/);
    await expect(page.locator("body")).toHaveClass(/view-home/);
  }
});

test("本地数据版本变化会自动刷新当前页面", async ({ page }) => {
  let versionCalls = 0;
  let pageLoads = 0;
  page.on("load", () => { pageLoads += 1; });
  await page.route("**/api/data-version?*", async (route) => {
    versionCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, version: versionCalls === 1 ? "v1" : "v2" }),
    });
  });
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout, ...args) =>
      nativeSetInterval(handler, timeout === 30_000 ? 25 : timeout, ...args);
  });

  await page.goto("/index.html#home", { waitUntil: "load" });

  await expect.poll(() => pageLoads, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  expect(versionCalls).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/#home$/);
});

test("侧栏精简且行情时点保持单行", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".nav-group-label")).toHaveCount(0);
  await expect(page.locator(".density-toggle, .density-btn")).toHaveCount(0);
  await expect(page.locator("body")).toHaveClass(/density-compact/);
  await expect(page.locator("#viewHome")).not.toContainText("今日最强");
  await expect(page.locator("#viewHome")).not.toContainText("分析模块各取第1");

  const dateline = await page.locator("#updated").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      text: node.textContent.trim(),
      height: node.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(dateline.text).toMatch(/^行情截至 \d{4}-\d{2}-\d{2}/);
  expect(dateline.whiteSpace).toBe("nowrap");
  expect(dateline.height).toBeLessThanOrEqual(dateline.lineHeight + 1);
  expect(dateline.scrollWidth).toBeLessThanOrEqual(dateline.clientWidth + 1);
});

test("模块名称已更新且旧名称不再出现在导航", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });
  await expect(page.locator('#sidebar .nav-item[data-view="xbrief"]')).toContainText("外围热点");
  await expect(page.locator('#sidebar .nav-item[data-view="kimi"]')).toContainText("每日复盘");
  await expect(page.locator('#sidebar .nav-item[data-view="events"]')).toContainText("今日热点事件");
  const navigationText = await page.locator("#sidebar").innerText();
  expect(navigationText).not.toContain("X 简报");
  expect(navigationText).not.toContain("事件概率");
  expect(navigationText).not.toContain("机会清单");
  expect(navigationText).not.toContain("AI 复盘");
  expect(navigationText).not.toContain("产业链涨价");
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

test("981–1024px 顶栏完整容纳搜索和行情数据", async ({ page }) => {
  for (const width of [981, 1000, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });
    const layout = await page.evaluate(() => {
      const bar = document.querySelector(".status-bar");
      const search = document.querySelector(".global-search").getBoundingClientRect();
      const data = document.querySelector(".sb-data").getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      return {
        barClientWidth: bar.clientWidth,
        barScrollWidth: bar.scrollWidth,
        barRight: barRect.right,
        searchRight: search.right,
        dataLeft: data.left,
        dataRight: data.right,
      };
    });
    expect(layout.barScrollWidth).toBeLessThanOrEqual(layout.barClientWidth + 1);
    expect(layout.searchRight).toBeLessThanOrEqual(layout.dataLeft + 1);
    expect(layout.dataRight).toBeLessThanOrEqual(layout.barRight + 1);
  }
});

test("外围热点空状态与每日情报正文排版清晰", async ({ page }) => {
  await page.goto("/index.html#xbrief", { waitUntil: "networkidle" });
  await expect(page.locator(".xb-hero-title")).toHaveText("外围热点");
  // 空状态断言与仓库数据解耦：pipeline 发布简报后 xbriefs.js 非空，
  // 空状态本就不渲染；显式清空重渲染，避免夜间发刊后门禁误失败。
  await page.evaluate(() => {
    window.XBRIEFS = { updated: null, generatedAt: null, briefs: [] };
    window.App.renderXBriefs();
  });
  await expect(page.locator(".xb-empty-state")).toContainText("今晚 23:00");
  await expect(page.locator(".xb-schedule")).toContainText("每日一次");

  await renderSampleXbrief(page);
  await expect(page.locator(".xb-article.active")).toBeVisible();
  await expect(page.locator(".xb-news-card")).toHaveCount(3);
  await expect(page.locator('.xb-news-meta a[href^="https://x.com/"]')).toHaveCount(3);
  await expect(page.locator(".xb-section-war .xb-section-code")).toHaveText("WAR");
  const text = await page.locator("#viewXbrief").innerText();
  expect(text).not.toMatch(/�|ï¿½|Ã|Â|â€™|â€œ|â€|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/);
  expect(text).not.toMatch(/[⏱◎⌘]/);

  // .xb-article.active 带有入场动画（translateY 6px→0，约 240ms），
  // 量几何前必须等动画结束，否则 y 差值取决于断言执行耗时，会抖动失败。
  await page.locator(".xb-article.active").evaluate(async (el) => {
    await Promise.allSettled(el.getAnimations().map((a) => a.finished));
  });

  const rail = await page.locator(".xb-rail").boundingBox();
  const article = await page.locator(".xb-article.active").boundingBox();
  expect(rail).not.toBeNull();
  expect(article).not.toBeNull();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (viewportWidth > 900) {
    expect(rail.x + rail.width).toBeLessThanOrEqual(article.x + 1);
    expect(Math.abs(rail.y - article.y)).toBeLessThanOrEqual(2);
  } else {
    expect(rail.y + rail.height).toBeLessThanOrEqual(article.y + 1);
  }
});

test("Kimi 复盘视图可用，公开静态快照不携带本地报告", async ({ page }) => {
  await page.goto("/index.html#kimi", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".kimi-page")).toBeVisible();
  await expect(page.locator("#viewKimi")).toContainText("Kimi Code");
  const snapshot = await readFile("kimi_review.js", "utf8");
  expect(snapshot).toContain('"available": false');
});

test("导航写入历史并支持浏览器前进后退", async ({ page }) => {
  await page.goto("/index.html#logic", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveClass(/view-logic/);
  await page.evaluate(() => document.querySelector('.nav-item[data-view="events"]').click());
  await expect(page).toHaveURL(/#events$/);
  await expect(page).toHaveTitle(/今日热点事件 · A股盘面/);
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
  await page.evaluate(() => document.querySelector('.nav-item[data-view="events"]').click());
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

test("搜索覆盖外围热点入口和周末发酵并定位到命中内容", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "networkidle" });
  const input = page.locator("#globalSearchInput");

  await input.fill("每日 23:00");
  await expect(page.locator(".search-hit")).toHaveCount(1);
  await page.locator(".search-hit").click();
  await expect(page.locator("body")).toHaveClass(/view-xbrief/);
  await expect(page.locator(".xb-masthead")).toBeFocused();

  const weekendTitle = await page.evaluate(() =>
    window.WEEKEND?.hotspots?.find((hotspot) => hotspot?.title)?.title || ""
  );
  expect(weekendTitle).not.toBe("");
  await input.fill(weekendTitle);
  await expect(page.locator(".search-hit")).toHaveCount(1);
  await page.locator(".search-hit").click();
  await expect(page.locator("body")).toHaveClass(/view-weekend/);
  const hotspot = page.locator(".weekend-only [data-xname]").filter({ hasText: weekendTitle });
  await expect(hotspot).toHaveAttribute("data-xname", weekendTitle);
  await expect(hotspot).toBeVisible();
  await expect(hotspot).toBeFocused();
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

test("研究内容不会直出内部字段、生成过程语或残缺括号", async ({ page }) => {
  for (const view of ["logic", "events", "weekend"]) {
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

test("核心阅读文字保持可读字号", async ({ page }) => {
  await page.goto("/index.html#logic", { waitUntil: "networkidle" });
  const researchSize = await page.locator(".lc-card-logic, .lc-step-detail, .sd-v, .sd-field-list .sum-txt").first().evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize)
  );
  expect(researchSize).toBeGreaterThanOrEqual(14);
});

test("手机端逻辑链可单手阅读且标的触控达标", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) > 720, "仅验证手机阅读");

  await page.goto("/index.html#logic", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".lc-card").first()).toBeVisible();
  await expect(page.locator(".lc-digest, .lc-board-summary").first()).toBeVisible();
  await expect(page.locator(".lc-digest-lead, .lc-board-summary").first()).toBeVisible();
  const digestWall = await page.locator(".lc-digest").evaluate((node) => {
    const lead = node.querySelector(".lc-digest-lead");
    const items = node.querySelectorAll(".lc-digest-list li");
    return {
      hasLead: Boolean(lead && lead.textContent.trim()),
      itemCount: items.length,
      leadLines: lead ? Math.round(lead.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(lead).lineHeight)) : 0,
    };
  });
  expect(digestWall.hasLead).toBe(true);
  expect(digestWall.itemCount).toBeGreaterThanOrEqual(1);
  expect(digestWall.leadLines).toBeLessThanOrEqual(4);
  const firstPoint = await page.locator(".lc-digest-list li").first().innerText();
  expect(firstPoint.trim()).not.toMatch(/^(?:但|而|且|不过|然而)/);

  const metrics = await page.evaluate(() => {
    const card = document.querySelector(".lc-card");
    const stock = document.querySelector(".lc-stock");
    const title = document.querySelector(".lc-card-title");
    if (!card || !stock || !title) return null;
    const cardBox = card.getBoundingClientRect();
    const stockBox = stock.getBoundingClientRect();
    return {
      cardWiderThanViewport: cardBox.width > window.innerWidth + 1,
      stockHeight: stockBox.height,
      stockFullWidth: Math.abs(stockBox.width - card.querySelector(".lc-stocks").getBoundingClientRect().width) <= 2,
      titleWraps: title.scrollWidth <= title.clientWidth + 1,
      titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics.cardWiderThanViewport).toBe(false);
  expect(metrics.stockHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.stockFullWidth).toBe(true);
  expect(metrics.titleWraps).toBe(true);
  expect(metrics.titleSize).toBeLessThanOrEqual(18);
});

test("手机端市场扫描为单列行情表且触控达标", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) > 720, "仅验证手机阅读");

  await page.goto("/index.html#market", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".ms-page")).toBeVisible();
  await expect(page.locator(".ms-row").first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const grid = document.querySelector(".ms-grid");
    const row = document.querySelector(".ms-row");
    const name = document.querySelector(".ms-name");
    const pctEl = document.querySelector(".ms-pct");
    if (!grid || !row || !name || !pctEl) return null;
    const gridStyle = getComputedStyle(grid);
    const rowBox = row.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect();
    const pctBox = pctEl.getBoundingClientRect();
    return {
      columns: gridStyle.gridTemplateColumns.split(" ").length,
      rowHeight: rowBox.height,
      rowWiderThanViewport: rowBox.width > window.innerWidth + 1,
      nameLeftOfPct: nameBox.right <= pctBox.left + 1,
      nameColor: getComputedStyle(name).color,
      pctFont: Number.parseFloat(getComputedStyle(pctEl).fontSize),
    };
  });
  expect(layout).not.toBeNull();
  expect(layout.columns).toBe(1);
  expect(layout.rowHeight).toBeGreaterThanOrEqual(48);
  expect(layout.rowWiderThanViewport).toBe(false);
  expect(layout.nameLeftOfPct).toBe(true);
  expect(layout.pctFont).toBeGreaterThanOrEqual(15);

  const contrast = await page.locator(".ms-row").first().evaluate((row) => {
    const name = row.querySelector(".ms-name");
    const pctEl = row.querySelector(".ms-pct");
    const parse = (c) => {
      const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const nameRgb = parse(getComputedStyle(name).color);
    return {
      disabled: row.hasAttribute("disabled"),
      readonly: row.classList.contains("is-readonly"),
      nameLum: nameRgb ? lum(nameRgb) : 1,
      pctClass: pctEl.className,
    };
  });
  expect(contrast.disabled).toBe(false);
  expect(contrast.nameLum).toBeLessThan(0.45);
});

test("公开页面使用系统字体且不再加载字体二进制", async ({ page }) => {
  await page.goto("/index.html#home", { waitUntil: "networkidle" });
  await expect(page.locator(".font-credit")).toContainText("系统字体");

  const audit = await page.evaluate(() => {
    const styleText = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join("\n");
    const fontResources = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(name));
    return {
      hasFontFace: /@font-face/i.test(styleText),
      hasMiSans: /MiSans/i.test(styleText),
      fontResources,
    };
  });
  const manifest = JSON.parse(
    await readFile(new URL("../../public_files.json", import.meta.url), "utf8")
  );
  const publishedFonts = manifest.required.filter((name) => /\.(?:woff2?|ttf|otf)$/i.test(name));

  expect(audit.hasFontFace).toBe(false);
  expect(audit.hasMiSans).toBe(false);
  expect(audit.fontResources).toEqual([]);
  expect(publishedFonts).toEqual([]);
});
