# Design QA

## Evidence

- Source visual truth: `/var/folders/22/0z13jwb14vd676xms5lg72y00000gp/T/codex-clipboard-33973182-351a-4f09-b236-0225b1310490.png`
- Normalized source: `/private/tmp/stock-dashboard-ui-refresh.m4Q8XW/qa/sidebar-cleanup-audit/source-top-1280x720.png`
- Browser-rendered implementation: `/private/tmp/stock-dashboard-ui-refresh.m4Q8XW/qa/sidebar-cleanup-audit/01-home-cleanup.png`
- Final hardened implementation: `/private/tmp/stock-dashboard-ui-refresh.m4Q8XW/qa/final-hardening-home.png`
- Focused source crop: `/private/tmp/stock-dashboard-ui-refresh.m4Q8XW/qa/sidebar-cleanup-audit/source-sidebar-bottom-250x220-sharp.png`
- Focused implementation crop: `/private/tmp/stock-dashboard-ui-refresh.m4Q8XW/qa/sidebar-cleanup-audit/implementation-sidebar-bottom-250x220.png`
- Combined comparison input: `/private/tmp/stock-dashboard-ui-refresh.m4Q8XW/qa/sidebar-cleanup-audit/comparison-pass-1.png`
- Local route: `http://127.0.0.1:8787/index.html?v=sidebar-cleanup-20260729#home`
- Browser viewport: `1280 × 720` CSS px
- Source pixels: `2560 × 1720` (`@2x`; normalized and cropped to the same comparison width)
- State: desktop, fixed compact density, 首页

The source screenshot and browser implementation were placed in one comparison image. The sidebar footer also uses equal-size focused crops so the removed density control and the one-line market date remain legible in the same visual comparison input.

## Findings

- No actionable P0/P1/P2 visual mismatch remains within the requested scope.
- Sidebar structure: the four circled group labels (“总览 / 自选股 / 市场扫描 / AI 分析”) are absent, while the six remaining destinations preserve their icons, spacing, active state, and hit areas.
- Homepage structure: the circled “今日最强” heading and its “5个分析模块各取第1 · 点击定位到对应条目” description are absent; the existing analysis cards remain directly below the screening strip.
- Density control: the complete “密度 / 标准 / 紧凑” control is absent. The page retains the prior compact visual density as a deterministic body class, so removal does not change the established layout.
- Market date: “行情截至 2026-07-29 最新” is emitted once and stays on one line. At the accepted viewport its `clientWidth` and `scrollWidth` are both 199 px, computed `white-space` is `nowrap`, and the text has an accessible full label/title.
- Typography and tokens: existing Chinese/system fonts, numeric hierarchy, terracotta accents, positive/negative colors, borders, and card treatment are unchanged.
- Image quality and icons: the brand mark, navigation icons, market visuals, and sparklines retain their original rendering; no source asset was replaced.
- Overflow and rendering: the accepted page has a 1280 px document width in a 1280 px viewport, no horizontal overflow, no replacement-character mojibake, and no browser warning/error log.
- Responsive regression: the Playwright suite passes the same deletion, date-line, overflow, search, navigation, drawer, and reading-size checks at both `1440 × 1024` and `390 × 844`; the one skipped case is the mobile-only menu test in the desktop project.

## Comparison History

1. First comparison pass:
   - Earlier findings: none at P0/P1/P2.
   - Fixes made after comparison: none.
   - Post-fix evidence: not required; the combined input already demonstrates all annotated deletions and the date-line correction.

## Primary Interactions Tested

- Navigated through 首页、巨头核心、逻辑链、外围热点、今日热点事件、周末发酵.
- Filtered 巨头核心 to 半导体 and confirmed exactly eight result cards.
- Searched 兆易创新, opened its accessible details dialog, and closed it with focus restored.
- Switched 外围热点 to the second update batch and confirmed the selected timestamp, clean text, and zero horizontal overflow.
- Opened all retired and unknown hashes; each is normalized to `#home` instead of retaining an invalid URL or showing a blank screen.
- Ran the integrated Playwright suite in desktop and mobile Chromium: 27 passed, 1 expected desktop skip.
- Rechecked all six views in the in-app browser: no horizontal overflow, replacement-character mojibake, console warning, or console error.

## Follow-up Polish

- No blocking polish remains for the requested visual change.
- The former product, data-safety, release, mobile, and maintenance findings have now been remediated or deleted; see `acceptance-report.md`.

final result: passed
