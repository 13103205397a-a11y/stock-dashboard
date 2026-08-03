#!/usr/bin/env node
/**
 * Build warm-desk high-fidelity single-file design draft.
 * Output: design/index.html
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data.json"), "utf8"));

const css = fs.readFileSync(path.join(__dirname, "draft.css"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "draft.js"), "utf8");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>A股盘面 · 暖色研究台（设计稿）</title>
  <style>
${css}
  </style>
</head>
<body>
  <a class="skip-link" href="#mainContent">跳到主要内容</a>

  <button class="menu-toggle" id="menuToggle" type="button" aria-label="打开导航菜单" aria-controls="sidebar" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>

  <div class="app-shell" data-component="shell">
    <aside class="sidebar" id="sidebar" data-component="sidebar" aria-label="模块导航">
      <div class="side-brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div class="brand-text">
          <span class="brand-title">A股盘面</span>
          <span class="brand-sub">Research Desk</span>
        </div>
      </div>
      <nav class="side-nav" aria-label="研究模块">
        <button class="nav-item is-active" data-view="home" type="button"><span class="nav-rail"></span><span>首页</span></button>
        <button class="nav-item" data-view="watch" type="button"><span class="nav-rail"></span><span>巨头核心</span></button>
        <button class="nav-item" data-view="market" type="button"><span class="nav-rail"></span><span>市场扫描</span></button>
        <button class="nav-item" data-view="logic" type="button"><span class="nav-rail"></span><span>逻辑链</span></button>
        <button class="nav-item" data-view="xbrief" type="button"><span class="nav-rail"></span><span>外围热点</span></button>
        <button class="nav-item" data-view="events" type="button"><span class="nav-rail"></span><span>今日热点事件</span></button>
        <button class="nav-item" data-view="weekend" type="button"><span class="nav-rail"></span><span>周末发酵</span></button>
      </nav>
      <div class="side-foot">
        <div class="dateline" id="sideDateline">行情截至 —</div>
      </div>
    </aside>

    <div class="sidebar-backdrop" id="sidebarBackdrop" hidden></div>

    <main class="content-area" id="mainContent" tabindex="-1">
      <header class="status-bar" data-component="status-bar">
        <div class="sb-left">
          <span class="sb-brand">盘面研判</span>
          <span class="sb-dim" id="sbDateTime">—</span>
        </div>
        <div class="sb-mid">
          <span class="sb-market" id="sbMarket">收盘</span>
        </div>
        <div class="global-search" id="globalSearch" role="search" data-component="global-search">
          <span class="gs-ico" aria-hidden="true">⌕</span>
          <input id="globalSearchInput" type="search" autocomplete="off" placeholder="代码 / 名称 / 题材 / 新闻" aria-label="全局搜索" role="combobox" aria-autocomplete="list" aria-controls="searchPanel" aria-expanded="false" />
          <kbd class="gs-kbd">/</kbd>
          <div class="search-panel" id="searchPanel" role="listbox" aria-label="搜索结果" hidden></div>
          <div class="sr-only" id="searchStatus" role="status" aria-live="polite"></div>
        </div>
      </header>

      <div class="content-in">
        <section class="view is-active" id="viewHome" data-view-panel="home" data-component="view-home" hidden></section>
        <section class="view" id="viewWatch" data-view-panel="watch" data-component="view-watch" hidden></section>
        <section class="view" id="viewMarket" data-view-panel="market" data-component="view-market" hidden></section>
        <section class="view" id="viewLogic" data-view-panel="logic" data-component="view-logic" hidden></section>
        <section class="view" id="viewXbrief" data-view-panel="xbrief" data-component="view-xbrief" hidden></section>
        <section class="view" id="viewEvents" data-view-panel="events" data-component="view-events" hidden></section>
        <section class="view" id="viewWeekend" data-view-panel="weekend" data-component="view-weekend" hidden></section>
      </div>

      <footer class="data-bar" data-component="data-bar">
        <span class="foot-disc">仅供研究参考，不构成投资建议</span>
      </footer>
    </main>
  </div>

  <nav class="tabbar" data-component="tabbar" aria-label="移动端模块切换">
    <button data-view="home" class="is-active" type="button">首页</button>
    <button data-view="watch" type="button">巨头</button>
    <button data-view="market" type="button">扫描</button>
    <button data-view="logic" type="button">逻辑</button>
    <button data-view="xbrief" type="button">外围</button>
    <button data-view="events" type="button">热点</button>
    <button data-view="weekend" type="button">周末</button>
  </nav>

  <div class="drawer-backdrop" id="drawerBackdrop" hidden></div>
  <aside class="drawer" id="detailDrawer" data-component="detail-drawer" aria-label="个股详情" aria-hidden="true" role="dialog">
    <div class="drawer-head">
      <button type="button" class="drawer-close" id="drawerClose" aria-label="关闭详情">×</button>
      <div id="drawerTitle"></div>
    </div>
    <div class="drawer-body" id="drawerBody"></div>
  </aside>

  <script>
  window.__SEED__ = ${JSON.stringify(seed)};
  </script>
  <script>
${js}
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, "index.html"), html);
console.log("Wrote design/index.html", (Buffer.byteLength(html) / 1024).toFixed(1), "KB");
