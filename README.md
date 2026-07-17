# 自选股盘面 · 叙事复盘看板

一个**纯前端、深色专业终端风**的 A 股自选股看板：把每只票的**叙事逻辑**、**左侧（逢低）/ 右侧（突破）买入计划**、**证伪条件**、**新增长点**结构化展示，叠加**真实行情技术信号** + **同花顺问财消息面**（主力资金/新闻/研报），并提供**今日热点 TOP30** 与**每日自动复盘**。

> ⚠️ 全部数据由 AI 整理/脚本测算，**仅供研究参考，不构成任何投资建议**。投资有风险，决策需独立判断。

## 在线访问
- **GitHub Pages**：https://13103205397a-a11y.github.io/stock-dashboard/
- **本地静态**：双击 `index.html` 用浏览器打开即可（无需后端、无需起服务器）。数据通过 `<script>` 注入 `window` 全局，避免 `file://` 下 `fetch` 本地 JSON 被浏览器拦截。
- **本地工作台**：运行 `python3 app_server.py` 后访问 `http://localhost:8787/index.html`，可写入持仓配置并从页面触发本地全量刷新。
- **模块深链接**：可直接收藏或分享 `#market`、`#news`、`#weekend` 等模块地址，浏览器前进/后退会同步切换看板。

## 功能
- **今日复盘**：大盘真实指数（上证/深证/创业板/科创50）+ 市场环境综述 + 多空/左右侧统计。
- **统计带**：总数 / 成立 / 存疑 / 今日叙事变化 / 多头排列 / 左侧已到逢低区 / 右侧突破·临近。
- **筛选 / 搜索**：板块 + 结论（成立/存疑/证伪）+ **⚡今日买点**（左侧已到逢低区 或 右侧突破/临近）+ 叙事有变化；顶部全局搜索支持代码、名称、题材、新闻、事件和跨模块跳转。
- **键盘操作**：`/` 或 `Ctrl/Cmd+K` 聚焦搜索，`↑/↓` 选择结果，`Enter` 打开，`Esc` 关闭搜索或详情抽屉。
- **数据健康**：首页展示各模块更新时间、条目数、数据源和过期状态；本地服务模式下可直接触发统一刷新计划并查看进度。
- **排序**：今日涨幅 / 距突破(右侧最近) / 回踩距离(左侧最近) / 趋势强度。
- **卡片**：现价+涨跌幅+趋势徽章 + **近60日迷你走势图** + 左/右买点与实时信号状态 + 主力资金 + 新消息角标 + 复盘徽章。
- **详情抽屉**：技术信号(均线/高低/量比/ATR + 大走势图) + **风控(左侧止损/目标/盈亏比、右侧止损)** + 主力资金 + 完整叙事/驱动/左右计划/今日复盘/新闻流水/机构研报/证伪/增长点/小作文/复盘历史。
- **今日热点 TOP30**：按个股热度排序，含涨跌/换手/量比/资金/连板/所属概念/行业/市值 + 炒作题材/技术面/情绪面规则化标签 + 催化新闻。

## 文件结构
### 前端（14 个视图模块，对应 `index.html` 侧栏）
| 文件 | 作用 |
|---|---|
| `index.html` / `styles.css` / `design-system.css` / `app.js` | 页面结构 / 基础样式 / 机构级 Design Token 与组件覆盖层 / 渲染·筛选·全局搜索·数据健康·抽屉 |
| `public_files.json` / `scripts/build_site.py` | 本地服务与 GitHub Pages 共用的公开资源清单 / 确定性站点构建 |
| `data.js` | 自选股数据（`window.STOCKS`）：叙事 + 技术信号 + 消息面 |
| `meta.js` | 全局元信息（行情时点 / 统计 / 大盘快照 `marketSnapshot`） |
| `holdings.js` | 持仓决策（本地私有生成，`window.HOLDINGS`，不入库/不发布） |
| `opportunities.js` / `logic.js` | 机会清单 / 逻辑链（`window.OPPORTUNITIES` / `window.LOGIC`） |
| `industry.js` / `industry_market.js` | Hermes 产业调研 / 行业板块涨跌排名（两个独立数据协议） |
| `materials.js` / `events.js` | 材料涨价 / 事件概率（`window.MATERIALS` / `EVENTS`） |
| `newsall.js` / `hot.js` | 全球资讯+公告（`window.NEWSALL`）/ 今日热点 TOP30（`window.HOT`） |
| `market.js` | 全市场异动扫描（`window.MARKET`） |
| `x_feed.js` | X 热议：海外社媒与 A 股相关的讨论风向（`window.XFEED`） |
| `reports.js` | AI 每日复盘报告（`window.REPORTS`） |

### 抓取脚本（`scripts/`）
| 脚本 | 数据源 | 写入 |
|---|---|---|
| `fetch_klines.sh` | 腾讯 `web.ifzq.gtimg.cn`（前复权） | `scripts/raw/<code>.json` |
| `fetch_signals.js` | 上述日K | `data.js` 的 signal/left/right、`meta.js` 的 marketSnapshot |
| `fetch_news.py` | 东方财富（新闻+公告，免key） | `data.js` 的 news |
| `fetch_enhanced.py` | 东财/腾讯 via a-stock-pro（免key） | `data.js` 的 fund/research/valuation |
| `fetch_market.py` | a-stock-pro（免key） | `market.js` |
| `fetch_holdings.py` | 腾讯实时（免key，本地私有） | `holdings.js`（不入库/不发布） |
| `fetch_industry.py` | a-stock-pro 行业排名（免key） | `industry_market.js` |
| `fetch_industry_ai.py` | Hermes Agent 会话（按 `agent/industry-radar.md`） | `industry.js`（AI 调研版） |
| `fetch_news_all.py` | a-stock-pro（免key） | `newsall.js` |
| `fetch_hot.py` | 同花顺问财（需 `IWENCAI_API_KEY`） | `hot.js` |
| `fetch_hermes.py` | Hermes 会话导出 | `reports.js` |
| `sync_hermes_dashboard.py` | Hermes 会话导出 + 公开 AI 数据定时发布 | reports/industry/logic/events/opportunities/materials/weekend/x_feed.js |
| `refresh_plan.json` / `run_refresh.py` | 本地统一刷新计划 / 命令行执行器 | 本地全量刷新 |
| `sanitize_ai_content.py` / `validate_data.js` / `check_freshness.js` | AI 内部字段清理、公开数据结构与新鲜度校验（不读取私有持仓） | 本地/CI 校验 |
| `skills/` | a-stock-pro / hithink-astock-selector / hithink-market-query / news-search / report-search（vendored） | — |
| `.github/workflows/refresh-signals.yml` | GitHub Actions：收盘后自动刷新行情+消息面+异动 | data/meta/market/industry_market/newsall/hot.js（不含持仓与 AI 文件） |
| `agent/*.md` | 各模块 AI 分析提示词（daily-review / industry-radar / logic-chain / materials-analysis / events-analysis / opportunities-analysis / x-pulse） | 驱动 reports.js 等 |
## 数据字段（`data.js` 每条）
- `code` `name` `sector` `tags`：代码 / 名称 / 板块 / 标签
- `narrative`：叙事逻辑
- `drivers`：上涨驱动因子
- `left` / `right`：左侧（逢低）/ 右侧（突破）计划 `{ zone 价位, trigger 触发条件, logic 逻辑 }`
- `falsify`：证伪条件（逻辑被打破的信号）
- `growthPoints`：潜在新增长点
- `watch`：需盯的小作文 / 催化
- `review`：最近一次复盘 `{ date, verdict(成立/存疑/证伪), change, rumors, newPoints }`
- `history`：复盘历史（每日累积）
- `signal`：**真实行情技术信号**（由 `fetch_signals.js` 用真实日K计算）
  `{ date, price, chgPct, ma5/10/20/60/120/250, high20/low20/high60/low60, volRatio, atr, trend, posPct, supportZone, deepSupport, pullbackPct, breakout, toBreakoutPct, leftStop, leftTarget, leftRR, rightStop, leftState, rightState, spark }`
- `fund`：**主力资金流向**（问财）`{ netInflow 亿, turnover %, date, asof }`
- `news`：**新闻/传闻流水**（问财，最新在前）`[{ title, date, source, url }]`
- `research`：**机构研报**（问财）`[{ org, rating, title, date }]`
- `newsAsof`：消息面抓取时点

> `left.zone` / `right.zone` / `trigger` 与 `signal` 均为真实日K计算的具体点位，非估计值。

## 数据怎么来的（真实数据）
技术信号（腾讯日K）与消息面（东财/腾讯，免key）分脚本维护，互不覆盖；只有 `fetch_hot.py` 走问财需 key。

| 脚本 | 数据源 | 写入 |
|---|---|---|
| `scripts/fetch_klines.sh` | 腾讯 `web.ifzq.gtimg.cn`（公开行情，前复权） | `scripts/raw/<code>.json` |
| `scripts/fetch_signals.js` | 上述日K | `data.js` 的 signal/left/right、`meta.js` 的 marketSnapshot |
| `scripts/fetch_enhanced.py` | 东财/腾讯 via a-stock-pro（免key） | `data.js` 的 fund/research/valuation |
| `scripts/fetch_news.py` | 东方财富（免key） | `data.js` 的 news |
| `scripts/fetch_market.py` / `fetch_holdings.py` / `fetch_industry.py` / `fetch_news_all.py` | a-stock-pro / 腾讯（均免key） | market.js / holdings.js（本地私有）/ industry_market.js / newsall.js |
| `scripts/fetch_hot.py` | 同花顺问财（需 `IWENCAI_API_KEY`） | `hot.js` |

本地全量刷新（仅 `fetch_hot.py` 需 `IWENCAI_API_KEY`，其余免key）：
```bash
bash scripts/fetch_klines.sh && node scripts/fetch_signals.js   # 行情 + 技术信号
python3 scripts/fetch_news.py        # 新闻/公告 → data.js
python3 scripts/fetch_enhanced.py    # 资金/研报/估值 → data.js
python3 scripts/fetch_market.py      # 全市场异动 → market.js
python3 scripts/fetch_holdings.py    # 持仓决策 → holdings.js（本地私有，不提交）
python3 scripts/fetch_industry.py    # 行业板块排行 → industry_market.js
python3 scripts/fetch_news_all.py    # 全球资讯+公告 → newsall.js
python3 scripts/fetch_hot.py         # 热点 TOP30 → hot.js（需问财 key）
```
或直接执行统一刷新计划：
```bash
python3 scripts/run_refresh.py
node scripts/validate_data.js
node scripts/check_freshness.js --strict
```
`app_server.py` 和 Mac App 的“刷新数据”也读取同一份 `scripts/refresh_plan.json`，避免多端刷新步骤漂移。

## 质量与交付

项目在每次推送和 Pull Request 中自动执行数据契约、技术信号、服务端、刷新互斥、公开站点构建和浏览器端到端测试。Pages 部署完成后还会检查首页、应用脚本、设计系统和行业数据资源是否真实可访问；官方 GitHub Actions 均固定到已核验的提交 SHA，避免版本漂移。

```bash
npm install                 # 首次安装固定版本的浏览器测试依赖
npm test                    # 算法 + API + 刷新 + 公开构建测试
npm run test:e2e            # 桌面/移动端 13 视图与关键交互
python3 scripts/build_site.py _site
```

浏览器测试覆盖模块深链接、历史导航、全局搜索键盘操作、详情抽屉焦点管理、新闻摘要和公告股票跳转。失败时 GitHub Actions 会保留 7 天的 Playwright 报告。

- **左侧(逢低)**：支撑区 = MA60 / MA20 / 近 20–60 日低点构成的回踩带；状态分「已在支撑区·可分批左侧 / 高于支撑区·等回踩 / 跌破支撑·破位观望」。
- **右侧(突破)**：突破位 = 近 60 日高（平台高）；状态分「已放量突破·右侧持有 / 临近突破 / 箱体内 / 创新高量能不足」，配合量比确认。
- 趋势 = 均线多头/空头/震荡排列。
> 指标为机械计算，**非投资建议**。

## 自动化架构（无人值守）
**GitHub Actions**（`.github/workflows/refresh-signals.yml`，每天跑 4 次以对冲 GitHub 定时器的延迟/丢弃）：
- 15:20 / 16:40 / 18:10 每日 + 工作日 09:00 盘前补跑（北京时间）：抓日K → 重算技术信号 → 补消息面 → 问财取热点 → 自动 commit/push。
- 只提交行情类文件（data/meta/hot/market/industry_market/newsall），AI 分析文件由本地 Hermes 独立发布，两边不争推。
- 新鲜度门禁按域分离：Actions 只对行情数据 `--scope=market` 严格把关，AI 模块过期只告警不阻断。
- 问财消息面/热点步骤 `continue-on-error: true`：问财异常（如**当日配额耗尽**）不阻断技术信号提交，且失败时不覆盖已有数据。
- 需在仓库 Settings → Secrets 配置 `IWENCAI_API_KEY`。

**云端「叙事复盘」Agent**（约 16:00 北京，见 `agent/daily-review.md`）：
- 对全部自选股逐一调研（公告/研报/产业链/舆情），更新 `review`/`history`/`news`/`meta.marketRegime`。
- 沙箱无外网时仅能用 WebSearch；消息面已由上述 Actions 在 15:00 后补入，Agent 可直接读取后再补充。

**本地 Hermes Agent**（`reports.js`/`industry.js`/`logic.js`/`events.js`/`opportunities.js`/`materials.js`/`weekend.js`/`x_feed.js` 这 8 个文件由它生成发布）：
- `scripts/fetch_hermes.py` 依赖本机 `hermes` 命令行工具，从会话库导出复盘报告；产业雷达/逻辑链/事件/机会/材料由对应 Hermes 定时任务（工作日 16:30–16:50）在仓库 workdir 直写。
- Hermes 的 `看板复盘同步` no-agent Cron 每 30 分钟调用 `scripts/sync_hermes_dashboard.py`。发布使用基于最新 `origin/main` 的隔离临时 worktree，不受当前开发工作区未提交改动影响，并会在远端竞争时自动重试；`portfolio_analysis.js` 仍保持本地私有。
- 所有项目 Cron 的 `workdir` 必须指向当前仓库根目录。主提供商不可用时应配置至少一个 `hermes fallback`，否则单个供应商额度耗尽会让全部 Agent 停摆。
- 这 8 个数据文件不进 GitHub Actions，换机器后需自行安装 `hermes` 并配置定时任务（盘前/盘初/午间/收盘/X热议早晚），否则这些模块显示"待生成"。
- `x_feed.js` 由「X热议·盘前」（工作日 07:05）与「X热议·晚间」（工作日 23:00）两个 Hermes 定时任务用 `x_search` 工具生成，任务只写文件不推送，发布统一走「看板复盘同步」。
- 前端对这些文件有 `onerror` 兜底，缺失不会白屏。

> 注：GitHub PAT 若只有 `repo` scope，本地无法 push `.github/workflows/` 改动（HTTP 422），需在 GitHub 网页 UI 编辑 workflow。

## 增删自选股
1. 编辑 `data.js` 的 `window.STOCKS` 数组（加/删一个对象，只需手写叙事/策略等编辑性字段，`signal`/`fund`/`news`/`research` 留给脚本）。
2. 跑 `bash scripts/fetch_klines.sh && node scripts/fetch_signals.js` 补技术信号，按算出的 MA/支撑/突破回填 `left.zone`/`right.zone`。
3. 跑 `python3 scripts/fetch_news.py && python3 scripts/fetch_enhanced.py` 补消息面（免key）。
4. `git add data.js meta.js && git commit && git push`。前端 `app.js` 按数组动态渲染，无需改。

## 每日复盘
- **自动**：GitHub Actions 收盘后刷新行情/消息面/热点；云端 Claude 复盘 Agent 在 16:00 前后更新叙事（需另行调度）。
- **手动**：需要时直接让 Claude 执行 `agent/daily-review.md` 的流程。
每次复盘后刷新浏览器即可看到徽章、今日变化、历史时间轴的更新。

## 自定义
- 配色：`styles.css` 顶部 `:root` 变量（`--up` 涨红 / `--down` 跌绿 / `--accent` 主色）。
- 问财技能：可改用仓库外 `../skills/` 覆盖 `skills/`（设 `IWENCAI_SKILLS_DIR` 环境变量）。
