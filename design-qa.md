# Design QA

## Evidence

- Source visual truth: `/var/folders/22/0z13jwb14vd676xms5lg72y00000gp/T/codex-clipboard-c466ae84-2493-4962-9900-50a70511c5f8.png`
- Implementation screenshot: `/var/folders/22/0z13jwb14vd676xms5lg72y00000gp/T/qa-watch-implementation.png`
- Additional implementation screenshot: `/var/folders/22/0z13jwb14vd676xms5lg72y00000gp/T/qa-xbrief-implementation.png`
- Local route: `http://127.0.0.1:8788/index.html#watch`
- Viewport: `1280 × 860` CSS px
- Source pixels: `2560 × 1720` (`@2x` capture, normalized to `1280 × 860`)
- Implementation pixels: `1280 × 860` (`deviceScaleFactor: 1`)
- State: desktop, compact density, 巨头核心, 全部板块, 默认排序

The source and implementation were rendered together in one vertical comparison at the same normalized size. The full-view comparison confirms that the former left-side summary rail is now a horizontal overview above the filters and stock cards, while preserving the existing warm neutral visual system.

## Findings

- No actionable P0/P1/P2 findings remain.
- Typography: the existing display/body font hierarchy is preserved. The top identity stays on one line at the target viewport; overview numbers and labels retain clear weight contrast.
- Spacing and layout: the overview and sector filter now form a compact two-column band above the controls. This returns the former rail width to the stock-card grid and keeps the circled content out of the left side.
- Colors and tokens: the implementation reuses the existing paper, terracotta, hairline, positive, and negative tokens. No new off-brand palette or decorative gradient was introduced.
- Image quality and assets: the existing brand mark, icons, sparklines, and sentiment ring are preserved at their source quality. No visible source asset was replaced by placeholder art.
- Copy and content: “机会清单” is absent; “X 简报” is now “外围热点”; “事件概率” is now “今日热点事件”. The 外围热点 article has a readable title, metadata, horizontal batch selector, and sanitized inline formatting.
- Behavior and accessibility: the sector chips and 外围热点 batch controls switch state correctly; semantic buttons and labels remain available; no horizontal page overflow is present at the target viewport.

Focused-region review used the same full-view comparison because the top status bar and the complete overview band are both legible at `1280 × 860`. The 外围热点 page was reviewed separately at the same viewport because it has no source mock in the provided image.

## Comparison History

1. Initial browser pass found a P2 top-bar wrapping issue at `1280 × 860`: “盘面研判” wrapped and reduced the available separation between search and market data.
   - Fix: made the identity non-wrapping and rebalanced the desktop status-bar grid to `180px / 280–480px / 290px`.
   - Post-fix evidence: the normalized comparison shows the identity on one line; measured search right edge is `938px`, market-data left edge is `952px`, leaving a `14px` gap with zero horizontal overflow.
2. Initial 外围热点 pass found a P2 readability issue: bold Markdown markers were visible inside generated table cells.
   - Fix: applied inline Markdown formatting inside table cells and retained text sanitization for replacement/control/mojibake characters.
   - Post-fix evidence: the revised 外围热点 screenshot contains no literal `**`, replacement characters, or the previously used decorative glyphs.

## Primary Interactions Tested

- 巨头核心: selected the “半导体” sector chip and confirmed the active filter state.
- 外围热点: selected the second update batch and confirmed both the rail item and article changed to `data-i="1"`.
- 今日热点事件: confirmed the new navigation and page heading, with the old label absent.
- Browser console: checked warnings and errors after the tested routes; none were reported.

## Follow-up Polish

- No blocking polish remains for the requested scope.

final result: passed
