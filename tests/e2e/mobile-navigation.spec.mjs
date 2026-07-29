import { expect, test } from "@playwright/test";

test("手机底栏三项等分且更多菜单具备完整键盘语义", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) > 980, "仅验证手机导航");

  await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });

  const tabbar = page.locator("#tabbar");
  const items = tabbar.locator(".tab-item");
  const more = page.locator("#tabMore");
  const sidebar = page.locator("#sidebar");
  const currentSidebarItem = sidebar.locator('.nav-item[aria-current="page"]');
  await expect(tabbar).toBeVisible();
  await expect(items).toHaveCount(3);
  await expect(more).toHaveAttribute("aria-controls", "sidebar");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(tabbar.locator('.tab-item[data-view="home"]')).toHaveAttribute("aria-current", "page");

  const layout = await tabbar.evaluate((node) => {
    const style = getComputedStyle(node);
    const widths = [...node.querySelectorAll(".tab-item")].map(
      (item) => item.getBoundingClientRect().width
    );
    return {
      contentWidth:
        node.getBoundingClientRect().width -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
      itemWidth: widths.reduce((total, width) => total + width, 0),
      minItemWidth: Math.min(...widths),
      maxItemWidth: Math.max(...widths),
    };
  });
  expect(layout.maxItemWidth - layout.minItemWidth).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.contentWidth - layout.itemWidth)).toBeLessThanOrEqual(2);

  await more.focus();
  await more.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("body")).toHaveClass(/sidebar-open/);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(currentSidebarItem).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/sidebar-open/);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(more).toBeFocused();

  await more.press("Enter");
  await expect(currentSidebarItem).toBeFocused();
  await sidebar.locator('.nav-item[data-view="logic"]').click();
  await expect(page).toHaveURL(/#logic$/);
  await expect(page.locator("body")).not.toHaveClass(/sidebar-open/);
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toHaveAttribute("aria-current", "page");
  await expect(more).toBeFocused();
});

test("侧栏在跨越 980px 断点时同步可见性和可聚焦状态", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/index.html#home", { waitUntil: "domcontentloaded" });

  const sidebar = page.locator("#sidebar");
  const more = page.locator("#tabMore");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveAttribute("inert", "");

  await more.click();
  await expect(page.locator("body")).toHaveClass(/sidebar-open/);
  await expect(sidebar).not.toHaveAttribute("inert", "");

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.locator("body")).not.toHaveClass(/sidebar-open/);
  await expect(sidebar).not.toHaveAttribute("aria-hidden", /.+/);
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(more).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 980, height: 844 });
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(more).toHaveAttribute("aria-expanded", "false");
});
