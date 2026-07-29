import { defineConfig } from "@playwright/test";

const configuredPort = Number.parseInt(process.env.PW_PORT || "8791", 10);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error(`PW_PORT 必须是 1-65535 的整数，当前值：${process.env.PW_PORT}`);
}
const serverOrigin = `http://127.0.0.1:${configuredPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // 两个视口顺序复用同一份静态数据缓存，降低冷启动抖动并保持截图/日志顺序稳定。
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: serverOrigin,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 app_server.py --no-open",
    env: {
      ...process.env,
      STOCK_DASHBOARD_PORT: String(configuredPort),
    },
    url: `${serverOrigin}/index.html`,
    // 默认拒绝复用未知进程，避免本地 8787 上的另一份工作树造成 E2E 假阳性。
    reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === "1",
    timeout: 15_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "mobile-chromium",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
  ],
});
