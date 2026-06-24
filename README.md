# 自选股盘面 · 叙事复盘看板

一个**纯前端、深色专业终端风**的 A 股自选股看板：把每只票的**叙事逻辑**、**左侧（逢低）/ 右侧（突破）买入计划**、**证伪条件**、**新增长点**结构化展示，叠加**真实行情技术信号** + **同花顺问财消息面**（主力资金/新闻/研报），并提供**今日热点 TOP30** 与**每日自动复盘**。

> ⚠️ 全部数据由 AI 整理/脚本测算，**仅供研究参考，不构成任何投资建议**。投资有风险，决策需独立判断。

## 在线访问
- **GitHub Pages**：https://13103205397a-a11y.github.io/stock-dashboard/
- **本地**：双击 `index.html` 用浏览器打开即可（无需后端、无需起服务器）。数据通过 `<script>` 注入 `window` 全局，避免 `file://` 下 `fetch` 本地 JSON 被浏览器拦截。

## 功能
- **今日复盘**：大盘真实指数（上证/深证/创业板/科创50）+ 市场环境综述 + 多空/左右侧统计。
- **统计带**：总数 / 成立 / 存疑 / 今日叙事变化 / 多头排列 / 左侧已到逢低区 / 右侧突破·临近。
- **筛选**：板块 + 结论（成立/存疑/证伪）+ **⚡今日买点**（左侧已到逢低区 或 右侧突破/临近）+ 叙事有变化 + 全局搜索。
- **排序**：今日涨幅 / 距突破(右侧最近) / 回踩距离(左侧最近) / 趋势强度。
- **卡片**：现价+涨跌幅+趋势徽章 + **近60日迷你走势图** + 左/右买点与实时信号状态 + 主力资金 + 新消息角标 + 复盘徽章。
- **详情抽屉**：技术信号(均线/高低/量比/ATR + 大走势图) + **风控(左侧止损/目标/盈亏比、右侧止损)** + 主力资金 + 完整叙事/驱动/左右计划/今日复盘/新闻流水/机构研报/证伪/增长点/小作文/复盘历史。
- **今日热点 TOP30**：按个股热度排序，含涨跌/换手/量比/资金/连板/所属概念/行业/市值 + 炒作题材/技术面/情绪面规则化标签 + 催化新闻。

## 文件结构
| 文件/目录 | 作用 |
|---|---|
| `index.html` | 页面结构 |
| `styles.css` | 深色终端风样式（涨红跌绿） |
| `app.js` | 渲染 / 筛选 / 搜索 / 抽屉 / 热点 |
| `data.js` | 全部自选股数据（`window.STOCKS`） |
| `meta.js` | 全局元信息（更新时间 / 市场环境 / 摘要 / 大盘快照） |
| `hot.js` | 今日热点 TOP30（`window.HOT`） |
| `agent/daily-review.md` | 每日复盘 Agent 提示词 |
| `scripts/fetch_klines.sh` | curl 拉全部日K（腾讯前复权）→ `scripts/raw/` |
| `scripts/fetch_signals.js` | 算均线/支撑/突破/止损/走势图 → 写回 `data.js` 的 signal、`meta.js` |
| `scripts/fetch_iwencai.py` | 问财补主力资金/新闻/研报 → 写回 `data.js` |
| `scripts/fetch_hot.py` | 问财取热度榜 TOP30 + 题材/技术/情绪 → 写回 `hot.js` |
| `skills/` | 问财技能 vendored 副本（market-query / news-search / report-search / astock-selector） |
| `.github/workflows/refresh-signals.yml` | GitHub Actions：每日收盘自动刷新行情+消息面+热点 |

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
技术信号（腾讯日K）与消息面（同花顺问财）分脚本维护，互不覆盖。

| 脚本 | 数据源 | 写入 |
|---|---|---|
| `scripts/fetch_klines.sh` | 腾讯 `web.ifzq.gtimg.cn`（公开行情，前复权） | `scripts/raw/<code>.json` |
| `scripts/fetch_signals.js` | 上述日K | `data.js` 的 signal/left/right、`meta.js` 的 marketSnapshot |
| `scripts/fetch_iwencai.py` | 同花顺问财 SkillHub | `data.js` 的 fund/news/research |
| `scripts/fetch_hot.py` | 同花顺问财 SkillHub | `hot.js` |

本地全量刷新（需 `IWENCAI_API_KEY` 环境变量）：
```bash
bash scripts/fetch_klines.sh && node scripts/fetch_signals.js
python3 scripts/fetch_iwencai.py   # 需 requests/numpy；问财技能
python3 scripts/fetch_hot.py
```
- **左侧(逢低)**：支撑区 = MA60 / MA20 / 近 20–60 日低点构成的回踩带；状态分「已在支撑区·可分批左侧 / 高于支撑区·等回踩 / 跌破支撑·破位观望」。
- **右侧(突破)**：突破位 = 近 60 日高（平台高）；状态分「已放量突破·右侧持有 / 临近突破 / 箱体内 / 创新高量能不足」，配合量比确认。
- 趋势 = 均线多头/空头/震荡排列。
> 指标为机械计算，**非投资建议**。

## 自动化架构（无人值守）
**GitHub Actions**（`.github/workflows/refresh-signals.yml`，工作日收盘后跑 3 次以对冲 GitHub 定时器的延迟/丢弃）：
- 15:20 / 16:40 / 18:10 北京：抓日K → 重算技术信号 → 问财补消息面 → 问财取热点 → 自动 commit/push。
- 问财消息面/热点步骤 `continue-on-error: true`：问财异常（如**当日配额耗尽**）不阻断技术信号提交，且失败时不覆盖已有数据。
- 需在仓库 Settings → Secrets 配置 `IWENCAI_API_KEY`。

**云端「叙事复盘」Agent**（约 16:00 北京，见 `agent/daily-review.md`）：
- 对全部自选股逐一调研（公告/研报/产业链/舆情），更新 `review`/`history`/`news`/`meta.marketRegime`。
- 沙箱无外网时仅能用 WebSearch；消息面已由上述 Actions 在 15:00 后补入，Agent 可直接读取后再补充。

> 注：GitHub PAT 若只有 `repo` scope，本地无法 push `.github/workflows/` 改动（HTTP 422），需在 GitHub 网页 UI 编辑 workflow。

## 增删自选股
1. 编辑 `data.js` 的 `window.STOCKS` 数组（加/删一个对象，只需手写叙事/策略等编辑性字段，`signal`/`fund`/`news`/`research` 留给脚本）。
2. 跑 `bash scripts/fetch_klines.sh && node scripts/fetch_signals.js` 补技术信号，按算出的 MA/支撑/突破回填 `left.zone`/`right.zone`。
3. 跑 `python3 scripts/fetch_iwencai.py` 补消息面（问财配额充足时）。
4. `git add data.js meta.js && git commit && git push`。前端 `app.js` 按数组动态渲染，无需改。

## 每日复盘
- **自动**：GitHub Actions 收盘后刷新行情/消息面/热点；云端 Claude 复盘 Agent 在 16:00 前后更新叙事（需另行调度）。
- **手动**：需要时直接让 Claude 执行 `agent/daily-review.md` 的流程。
每次复盘后刷新浏览器即可看到徽章、今日变化、历史时间轴的更新。

## 自定义
- 配色：`styles.css` 顶部 `:root` 变量（`--up` 涨红 / `--down` 跌绿 / `--accent` 主色）。
- 问财技能：可改用仓库外 `../skills/` 覆盖 `skills/`（设 `IWENCAI_SKILLS_DIR` 环境变量）。
