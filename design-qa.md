# Design QA

## Scope

- Reference: `/Users/Admin/.codex/generated_images/019f49d4-d226-7061-ab7f-f5c7ce3c0859/exec-ab5111b5-f00b-4d22-9e70-9aabd61a2649.png`
- Implementation: `http://127.0.0.1:8787/index.html`
- Primary comparison viewport: `1487 x 1058`
- Coverage viewports: `1440 x 1024`, `720 x 1024`, `390 x 844`
- Covered states: 13 views, stock drawer, mobile navigation, search results, keyboard focus, reduced-width layouts

## Iteration 1

- P1 · Fidelity / density: the first “今日最强” card allowed a long dynamic badge to consume the card and force the tag into a vertical stack.
  - Fix: constrained the badge to one line and clamped title and summary copy to two lines.
- P1 · Spacing: the content gutter was looser than the selected terminal reference.
  - Fix: reduced the responsive desktop gutter and top content padding while preserving mobile breathing room.
- P1 · Accessibility: mobile menu and navigation targets were below practical touch dimensions.
  - Fix: increased the menu control to `40 x 40` and mobile navigation rows to `44px`.
- P2 · Fidelity / command emphasis: the search field and top command boundary were too neutral compared with the reference.
  - Fix: applied the restrained amber command border token without adding glow or gradient surfaces.

## Iteration 2

- P0 · Responsive layout: long dynamic stage text expanded opportunity cards beyond the `390px` mobile viewport.
  - Fix: constrained the badge flex item and changed single-column grids to `minmax(0, 1fr)`; all 13 views now pass page-level overflow checks.
- P1 · Navigation: internal views could not be bookmarked, shared, or traversed with browser history.
  - Fix: added stable hash routes, dynamic document titles, back/forward synchronization, and per-view scroll restoration.
- P1 · Keyboard accessibility: search lacked active-result navigation and the drawer did not manage focus.
  - Fix: added combobox/listbox semantics, arrow-key selection, result announcements, dialog semantics, focus entry/trapping/restoration, skip link, and keyboard activation for stock cards.
- P1 · News utility: global news summaries and announcement stock codes were present in data but not actionable.
  - Fix: added expandable summaries, optional source links, and announcement-to-stock-detail navigation.

## Final Verification

- Layout: no horizontal overflow at desktop, tablet, or mobile widths.
- Typography: system Chinese sans hierarchy with monospaced tabular numerals is consistent across all views.
- Color: graphite surfaces, restrained amber commands, Chinese-market red-up/green-down semantics, and neutral blue states are tokenized.
- Components: navigation, cards, buttons, chips, tables, drawer, toast, modal, skeleton, empty, hover, focus, and selected states use shared tokens.
- Interaction: search returned results; stock drawer opened and closed with Escape; navigation and mobile menu remained functional.
- Accessibility: visible keyboard focus, reduced-motion support, practical mobile navigation targets, and responsive text wrapping were verified.
- Delivery: deterministic public manifest build, pre-deploy regression checks, post-deploy asset probes, and a dedicated CI quality workflow were added.
- Browser console: no warnings, page errors, or failed static asset requests during the final capture pass.
- Regression: data validation, signal tests, Python unit tests, news/report skill tests, dependency audit, 12 desktop/mobile browser tests, syntax checks, and `git diff --check` passed.

final result: passed
