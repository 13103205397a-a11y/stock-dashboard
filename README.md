# 自选股盘面 · 叙事复盘看板

一个**纯前端、深色专业终端风**的 A 股自选股看板：把每只票的**叙事逻辑**、**左侧（逢低）/ 右侧（突破）买入计划**、**证伪条件**、**新增长点**结构化展示，并支持每日自动复盘逻辑变化。

> ⚠️ 全部数据由 AI 整理/测算，**仅供研究参考，不构成任何投资建议**。投资有风险，决策需独立判断。

## 快速开始
直接**双击 `index.html`** 用浏览器打开即可（无需后端、无需起服务器）。
数据通过 `<script src="data.js">` 注入 `window.STOCKS`，避免 `file://` 下 `fetch` 本地 JSON 被浏览器拦截。

## 功能
- **统计带**：总数 / 成立 / 存疑 / 今日叙事变化 / 多头排列 / 左侧已到逢低区 / 右侧突破·临近。
- **筛选**：板块 + 结论（成立/存疑/证伪）+ **⚡今日买点**（左侧已到逢低区 或 右侧突破/临近）+ 叙事有变化 + 全局搜索。
- **排序**：今日涨幅 / 距突破(右侧最近) / 回踩距离(左侧最近) / 趋势强度。
- **卡片**：现价+涨跌幅+趋势徽章 + **近60日迷你走势图** + 左/右买点与实时信号状态 + 复盘徽章。
- **详情抽屉**：技术信号(均线/高低/量比/ATR + 大走势图) + **风控(左侧止损/目标/盈亏比、右侧止损)** + 完整叙事/驱动/左右计划/今日复盘/证伪条件/新增长点/小作文/复盘历史。

## 文件结构
| 文件 | 作用 |
|---|---|
| `index.html` | 页面结构 |
| `styles.css` | 深色终端风样式（涨红跌绿） |
| `app.js` | 渲染 / 筛选 / 搜索 / 抽屉 |
| `data.js` | 全部自选股数据（`window.STOCKS`） |
| `meta.js` | 全局元信息（更新时间 / 市场环境 / 摘要） |
| `agent/daily-review.md` | 每日复盘 Agent 提示词 |

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

- `signal`：**真实行情技术信号**（由 `scripts/fetch_signals.js` 用真实日K计算）
  `{ date, price 现价, chgPct 涨跌%, ma5/10/20/60/120/250 均线, high20/low20/high60/low60, volRatio 量比, trend 趋势(多头/空头/震荡排列), posPct 距MA60%, supportZone 支撑区, breakout 突破位, toBreakoutPct 距突破%, leftState 左侧状态, rightState 右侧状态 }`

> `left.zone` / `right.zone` / `trigger` 与 `signal` 均为真实日K计算的具体点位，非估计值。

## 左/右侧信号怎么来的（真实数据）
| 脚本 | 作用 |
|---|---|
| `scripts/fetch_klines.sh` | 用 `curl` 拉取全部 47 只**真实日K(腾讯前复权)**到 `scripts/raw/<code>.json` |
| `scripts/fetch_signals.js` | 读取日K，计算均线/支撑/压力/突破位/量能，生成左右侧信号，写回 `data.js` |

运行：
```bash
bash scripts/fetch_klines.sh && node scripts/fetch_signals.js
```
- **左侧(逢低)**：支撑区 = MA60 / MA20 / 近 20–60 日低点构成的回踩带；状态分「已在支撑区·可分批左侧 / 高于支撑区·等回踩 / 跌破支撑·破位观望」。
- **右侧(突破)**：突破位 = 近 60 日高(平台高)；状态分「已放量突破·右侧持有 / 临近突破 / 箱体内 / 创新高量能不足」，配合量比确认。
- 趋势 = 均线多头/空头/震荡排列。
> 数据源：腾讯 `web.ifzq.gtimg.cn`（公开行情）。指标为机械计算，**非投资建议**。

## 每日复盘（让看板“活”起来）
**方式 A · 定时云端（推荐，无人值守）**
1. 建议先把本目录 `git init` 成仓库（便于复盘 Agent 提交、你 pull 看历史）。
2. 用 `/schedule` 创建工作日收盘后（约 16:00）的例行任务，提示词指向 `agent/daily-review.md`。

**方式 B · 手动 / 本地循环**
- 需要复盘时直接让 Claude 执行 `agent/daily-review.md` 的流程；或用 `/loop` 在本地会话内按工作日触发（需保持会话开启）。

每次复盘后刷新浏览器即可看到徽章、今日变化、历史时间轴的更新。

## 自定义
- 增删自选股：编辑 `data.js` 的 `window.STOCKS` 数组。
- 改配色：`styles.css` 顶部 `:root` 变量（`--up` 涨红 / `--down` 跌绿 / `--accent` 主色）。
