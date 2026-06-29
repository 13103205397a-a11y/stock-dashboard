---
name: a-stock-pro
description: A股全栈数据工具包(进化版)。覆盖行情/研报/信号/资金面/新闻/基础数据/公告/打板/ETF期权/舆情互动十层数据,40+端点,直连12个免费数据源(免key,仅iwencai语义搜索需key)。当用户询问A股个股估值、行情报价、K线、研报、龙虎榜、北向资金、融资融券、大宗交易、股东户数、分红送转、解禁预警、行业排名、涨停打板、连板梯队、炸板率、ETF期权希腊字母、互动易问答、人气榜、概念板块、个股新闻、公告、一致预期EPS、综合估值等任何A股相关问题时,必须使用此技能。优先用此技能而非零散网络搜索,数据更准更全。
version: 3.4.0
origin: evolved
license: MIT
---

# A股全栈数据工具包 a-stock-pro V3.4.0

> 基于 [simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data) V3.3.0 进化而来。
> **V3.4 进化点**:① 兼容 Python 3.9+(`from __future__ import annotations`);② 修复龙虎榜空数据崩溃;③ 解禁日期兼容 YYYYMMDD/YYYY-MM-DD 双格式;④ 强势股列名映射不再因字段缺失崩溃;⑤ 涨停池连板数增加 `lbc` 别名;⑥ 函数代码与示例彻底分离,`import` 零副作用;⑦ 全字段名标准化+中文别名;⑶ 端到端 25 场景实测通过(2026-06-29)。

## 技能定位

这是一个**自包含的 A 股数据查询工具包**。所有代码在 `scripts/astock.py`,55 个函数,直连 12 个免费数据源(通达信 TCP、腾讯/百度/东财/同花顺/新浪/巨潮 HTTP),**除 iwencai 语义搜索外全部免 key**。

**什么时候必须用这个技能**:用户问 A 股相关——个股价格/估值/研报/资金面/龙虎榜/打板/期权/公告/互动易等,**优先用这个,而不是去网上搜**。它拿的是一手接口数据,比搜索结果准、全、新。

## 安装与依赖

```bash
pip install mootdx requests pandas stockstats
```

Python 3.9+ 均可(已测试 3.9.6)。

## 调用方式

**方式一(AI 助手推荐)**:把本 SKILL.md 放入 skills 目录,在 A 股对话中自动激活。AI 按需调用 `scripts/astock.py` 里的函数。

**方式二(直接脚本)**:
```python
import sys; sys.path.insert(0, "scripts目录绝对路径")
import astock as a
print(a.tencent_quote(["605117"]))   # 德业股份实时行情
```

**方式三(看示例)**:`python3 scripts/example_usage.py` 跑一遍所有端点 demo。

---

## 十层数据架构(55个函数)

### 第①层 行情层(实时,不封IP)

#### `tencent_quote(codes)` — 腾讯实时行情(最常用)
PE/PB/市值/换手率/涨跌停价,主板/科创板/创业板/北交所通用。

```python
a.tencent_quote(["605117", "300136"])
```
返回 `{code: {name, price, last_close, open, change_amt, change_pct, high, low,
amount_wan(成交额万), turnover_pct(换手率), pe_ttm, pe_static, pb,
mcap_yi(总市值亿), float_mcap_yi(流通市值亿), limit_up(涨停价), limit_down(跌停价), vol_ratio(量比)}}`

#### `baidu_kline_with_ma(code, start_time="")` — 百度K线(带MA5/10/20)
返回 `{keys: [...字段名], rows: ["时间,开,收,量,高,低,额,涨跌,振幅,...,MA5价,MA5量,MA10价,MA10量,MA20价,MA20量"]}`

#### `tdx_client(market='std')` — 通达信客户端(K线/盘口/逐笔/财务/F10)
底层客户端,供下列基础数据函数用。TCP 7709,海外网络可能超时。

### 第②层 研报层

#### `eastmoney_reports(code, max_pages=5)` — 东财个股研报
```python
a.eastmoney_reports("300136")  # 信维通信
```
返回 list,每条含 `title, stockName, stockCode, orgSName(机构简称),
publishDate(YYYY-MM-DD HH:MM:SS), emRatingName(评级:买入/增持/...),
predictThisYearEps, predictNextYearEps(机构预测EPS), infoCode, author`

#### `eastmoney_industry_reports(industry_code="*", max_pages=5)` — 东财行业研报
`industry_code="*"` 拉全行业;传东财行业码(如 `"1238"`)精确过滤。字段同上+`industryName`。

#### `download_pdf(record, target_dir="./reports")` — 下载研报PDF
传 `eastmoney_reports` 返回的某条 record,下载完整 PDF。返回文件路径。

#### `ths_eps_forecast(code)` — 同花顺机构一致预期EPS
```python
a.ths_eps_forecast("605117")  # 返回 DataFrame
```
返回 DataFrame,列:`年度, 预测机构数, 最小值, 均值(=机构一致预期EPS), 最大值, 行业平均数`

#### `iwencai_search(query, channel="report", size=50)` — iwencai语义搜索研报
**唯一需要 API Key 的端点**。`channel="report"` 搜研报,`"news"` 搜新闻。Key 通过环境变量 `IWENCAI_API_KEY` 配置。

### 第③层 信号层

#### `ths_hot_reason(date=None)` — 当日强势股+题材归因
`date=None`=今天,或传 `"YYYY-MM-DD"`。返回 DataFrame,列:`名称, 代码, 题材归因(编辑部人工标注的reason tags), 收盘价, 涨跌额, 涨幅%, 换手率%, 成交额, 大单净量, 市场`

#### `hsgt_realtime()` — 北向资金实时(分钟级)
返回 DataFrame,列:`time(HH:MM), hgt_yi(沪股通净流入亿), sgt_yi(深股通净流入亿)`。约262个时间点。

#### `_load_northbound_history(n=20)` — 北向历史(本地缓存)

#### `eastmoney_concept_blocks(code)` — 个股所属板块
返回 `{total, boards: [{name, code, change_pct, leader}], concept_tags: [概念名]}`

#### `eastmoney_fund_flow_minute(code)` — 个股资金流向(分钟级)
返回 list,每条 `{time, main_net(主力净), small_net, mid_net, large_net, super_net}`,单位元。

#### `dragon_tiger_board(code, trade_date, look_back=30)` — 龙虎榜(个股)
`trade_date` 格式 `YYYY-MM-DD`。返回 `{records: [{date, reason, net_buy(万), turnover}],
seats: {buy: [{name, buy_amt, sell_amt, net}], sell: [...]},
institution: {buy_amt, sell_amt, net_amt(机构净额万)}}`

#### `daily_dragon_tiger(trade_date=None, min_net_buy=None)` — 全市场龙虎榜
`trade_date` 默认今天(YYYY-MM-DD)。`min_net_buy` 净买入下限(万)。返回 `{date, total_records, stocks: [{code, name, reason, close, change_pct, net_buy_wan, buy_wan, sell_wan, turnover_pct}]}`

#### `lockup_expiry(code, trade_date, forward_days=90)` — 限售解禁日历
**`trade_date` 兼容 `YYYYMMDD` 和 `YYYY-MM-DD` 两种格式**。返回 `{history: [{date, type, shares, ratio}], upcoming: [...]}`

#### `industry_comparison(top_n=20)` — 行业板块涨跌排名
返回 `{top: [{rank, name, change_pct, code, up_count, down_count, leader, leader_change}], bottom: [...], total}`

#### `market_top(metric="chgPct", n=50, desc=True)` — 全市场个股排名榜 ⭐新增
全 A 股个股按指标排序取 TOP N。`metric` 支持 `chgPct`(涨幅)/`turnover`(换手)/`netInflow`(主力净流入)/`amplitude`(振幅)/`volumeRatio`(量比)/`amount`(成交额)。`desc=False` 升序(用于跌幅榜/流出榜)。
返回 `[{rank, code, name, price, chgPct, turnover, netInflow(元), amplitude, volumeRatio, amount, industry, mcap_yi(市值亿)}]`

### 第④层 资金面/筹码层

#### `margin_trading(code, page_size=30)` — 融资融券明细(日级)
返回 list,每条 `{date, rzye(融资余额), rzmre(融资买入), rqye(融券余额), ...}`,单位元。

#### `block_trade(code, page_size=20)` — 大宗交易
返回 `{date, price, close, premium_pct(溢价率), vol, amount, buyer, seller}`

#### `holder_num_change(code, page_size=10)` — 股东户数变化(筹码集中度)
返回 `{date, holder_num(户数), change_pct(环比)}`

#### `dividend_history(code)` — 分红送转历史
返回 `{date, bonus_rmb(每股派息元), transfer_ratio(转增), bonus_ratio(送股), plan(方案状态)}`

#### `stock_fund_flow_120d(code)` — 个股资金流(日级,120日)
返回 `{date, main_net, small_net, mid_net, large_net, super_net}`,单位元。

### 第⑤层 新闻层

#### `eastmoney_stock_news(code)` — 个股新闻
返回 list,每条 `{date, title, content, source, url}`

#### `eastmoney_global_news()` — 东财全球资讯(7×24)
财联社快讯的替代(原 cls.cn 已下线)。返回 `{time, title, ...}`

#### `cls_telegraph(page_size=50)` — ⚠️已下线
财联社快讯已失效,改用 `eastmoney_global_news()`。

### 第⑥层 基础数据层

#### `eastmoney_stock_info(code)` — 东财个股信息
返回 `{industry, total_shares, float_shares, mcap, float_mcap, list_date(上市日期)}`

#### `sina_financial_report(code, report_type)` — 新浪财报三表
`report_type`: `"lrb"`(利润表)/`"fzb"`(资产负债表)/`"llb"`(现金流量表)。

### 第⑦层 公告层

#### `cninfo_announcements(code)` — 巨潮公告(沪深北全量)
返回 list,每条 `{announcementTitle, adjunctType, announcementTime, ...}`

### 第⑧层 打板层 ⭐(V3.3新增)

#### `em_zt_pool(date)` — 涨停池
`date` 格式 `YYYYMMDD`。返回每只 `{code, name, price, pct, amount, float_cap, turnover,
limit_days(连板数), lbc(连板数别名=limit_days), first_seal, last_seal, seal_fund(封板资金元),
break_times(炸板次数), industry, zt_stat(N天M板)}`

#### `em_zb_pool(date)` — 炸板池(涨停后开板)
返回 `{code, name, price, limit_price, pct, turnover, first_seal, break_times,
amplitude(振幅), speed(涨速), industry, zt_stat}`

#### `em_dt_pool(date)` — 跌停池
返回 `{code, name, price, pct, turnover, pe, seal_fund, last_seal,
board_amount(板上成交额), dt_days(连续跌停), open_times(开板次数), industry}`

#### `em_yzt_pool(date)` — 昨日涨停池(算晋级率/赚钱效应)
返回 `{code, name, price, pct(今日涨幅), turnover, amplitude, speed,
y_first_seal(昨封板时间), y_limit_days(昨连板), industry, zt_stat}`

#### `ths_limit_up_pool(date)` — 同花顺涨停揭秘
返回 `{code, name, price, pct, reason(涨停原因题材), board_type(换手板/一字板/T字板),
seal_rate(封板成功率0~1), break_times, seal_amount(封单额), high_days(几天几板),
first_time, is_again(是否回封)}`

#### `limit_up_sentiment(date)` — 打板情绪速算(最常用)
```python
a.limit_up_sentiment("20260626")
```
返回 `{date, zt_count(涨停数), zb_count(炸板数), dt_count(跌停数),
break_rate(炸板率%), max_height(最高连板数), ladder: {1: 52, 2: 4, 3: 2, 4: 1, 6: 1}(连板梯队)}`

### 第⑨层 ETF期权层 ⭐(V3.3新增)

#### `sina_option_codes(underlying, call=True)` — 期权合约清单
`underlying` 如 `"510050"`(50ETF)/`"510300"`(300ETF)。`call=True`认购,`False`认沽。返回合约代码集合。

#### `sina_option_tquote(code)` — 期权T型报价
返回 `{bid_vol, bid, last, ask, ask_vol, open_interest(持仓量), pct, strike(行权价),
prev_close, open, limit_up, limit_down, name, amplitude, high, low, volume, amount}`

#### `sina_option_greeks(code)` — 期权希腊字母+IV
返回 `{name, volume, delta, gamma, theta, vega, iv(隐含波动率小数),
high, low, trade_code, strike, last, theory(理论价值)}`

### 第⑩层 舆情互动层 ⭐(V3.3新增)

#### `cninfo_irm(code, page_size=30, page_num=1)` — 互动易问答
**独家信源**:公司官方如何回应投资者提问。返回 `{code, company, question(提问),
answer(回复,None=未回复), answerer(回答方), ask_time}`

#### `ths_hot_list()` — 同花顺热榜
返回 `{rank, code, name, hot(人气值), concepts, rank_change}`

#### `em_hot_rank(n=10)` — 东财人气榜
返回 `{rank, code, name, price, pct(涨跌幅), rank_chg(排名变化)}`

#### `em_hot_concept(code)` — 个股概念命中
返回 `{concept, bk(板块码), hit(热度值)}`

---

## 综合估值(多函数组合)

### `full_valuation(code)` — 一键综合估值 ⭐最常用
```python
a.full_valuation("605117")  # 德业股份
```
返回 `{name, price, mcap_yi, pe_ttm, pb, eps_cur(今年EPS), eps_next(明年EPS),
pe_fwd(前向PE), cagr_pct(预期增速%), peg, digest_years(PE消化年数), analyst_count(覆盖机构数)}`

### `forward_pe(code)` / `pe_digestion(code)` / `calc_peg(code)`
单算前向PE / PE消化年数 / PEG,`full_valuation` 已含全部。

---

## 数据源优先级 & 防封

- **优先用 mootdx/腾讯/百度**(不封IP)
- **东财仅用于其独有数据**(融资融券/龙虎榜/打板/概念等),且统一走 `em_get()` 节流(间隔≥1s+随机抖动)+ 会话复用
- 部分大陆住宅 IP 被东财间歇风控(`HTTP 000`/空),非代码 bug,加重试或换网络

## 鉴权要求

除 `iwencai_search` 外,所有数据源**完全免费无 Key**。iwencai 需配环境变量:
```bash
export IWENCAI_API_KEY="你的key"
```
申请地址 https://www.iwencai.com/skillhub

---

## 使用示例(说什么激活什么)

| 场景 | 调用 |
|------|------|
| 个股估值 | `full_valuation("605117")` |
| 实时行情+PE/PB | `tencent_quote(["605117","300136"])` |
| K线带均线 | `baidu_kline_with_ma("605117")` |
| 概念板块 | `eastmoney_concept_blocks("605117")` |
| 资金流向(分钟) | `eastmoney_fund_flow_minute("605117")` |
| 个股研报 | `eastmoney_reports("300136")` |
| 一致预期EPS | `ths_eps_forecast("605117")` |
| 强势股题材 | `ths_hot_reason()` |
| 北向资金 | `hsgt_realtime()` |
| 龙虎榜(个股) | `dragon_tiger_board("605117","2026-06-26")` |
| 全市场龙虎榜 | `daily_dragon_tiger("2026-06-26")` |
| 解禁预警 | `lockup_expiry("300136","20260626")` |
| 行业排名 | `industry_comparison(20)` |
| 融资融券 | `margin_trading("605117")` |
| 大宗交易 | `block_trade("605117")` |
| 股东户数 | `holder_num_change("605117")` |
| 分红送转 | `dividend_history("605117")` |
| 资金流120日 | `stock_fund_flow_120d("605117")` |
| 个股新闻 | `eastmoney_stock_news("605117")` |
| 全球资讯 | `eastmoney_global_news()` |
| 公告 | `cninfo_announcements("300136")` |
| 涨停池 | `em_zt_pool("20260626")` |
| 打板情绪 | `limit_up_sentiment("20260626")` |
| 炸板池 | `em_zb_pool("20260626")` |
| 跌停池 | `em_dt_pool("20260626")` |
| 昨涨停今表现 | `em_yzt_pool("20260626")` |
| 涨停揭秘 | `ths_limit_up_pool("20260626")` |
| ETF期权合约 | `sina_option_codes("510050")` |
| 期权T型报价 | `sina_option_tquote(合约代码)` |
| 期权希腊字母 | `sina_option_greeks(合约代码)` |
| 互动易问答 | `cninfo_irm("300136")` |
| 人气榜 | `em_hot_rank(10)` |
| 个股概念命中 | `em_hot_concept("605117")` |

## 内置4套调研流程

| 流程 | 组合 | 耗时 |
|------|------|------|
| 单票估值 | `tencent_quote` → `ths_eps_forecast` → `forward_pe`/`calc_peg` → `pe_digestion` | 30秒 |
| 批量对比 | 循环 `full_valuation` 多只 | 1分钟 |
| 打板情绪 | `em_zt_pool` + `em_zb_pool` + `em_dt_pool` → `limit_up_sentiment` | 20秒 |
| 个股全景 | `tencent_quote` + `eastmoney_reports` + `eastmoney_concept_blocks` + `eastmoney_fund_flow_minute` + `dragon_tiger_board` + `margin_trading` + `cninfo_announcements` | 2分钟 |

---

## 注意事项

1. **交易日 vs 盘后**:行情类接口盘中实时;龙虎榜/融资融券等通常盘后更新(T日数据 T+1 早可得)。非交易日查询可能返回空,属正常。
2. **日期格式**:大部分函数用 `YYYY-MM-DD`(带横杠);**打板层 `em_zt_pool` 等用 `YYYYMMDD`(无横杠)**;`lockup_expiry` 两种都支持。看每个函数的文档字符串。
3. **mootdx 海外网络**:通达信走 TCP 7709,海外网络可能全超时。`tdx_client` 内置 3 级 fallback,仍不行需走国内代理。
4. **复权口径**:mootdx `bars` 返回不复权原始价,跨除权日须自行复权。
5. **iwencai 唯一需 key**:其余全免费。

## 变更历史

- **V3.4.1 (2026-06-29, 边界加固)**:边界测试挖出 8 个 bug 全修——`full_valuation` 遇不存在/北交所/指数代码 IndexError→降级返回 error;`_normalize_date` 支持点号/中文日期+空串明确报错;`dragon_tiger_board`/`daily_dragon_tiger` 复用 normalize(原只认横杠格式);`em_zt_pool`/`ths_limit_up_pool` 横杠日期静默返回空→自动转 YYYYMMDD;`stock_fund_flow_120d` 空响应 NoneType 崩溃→加 `(d.get("data") or {})` 保护。已接入 stock-dashboard 项目(补 fund/research/valuation 三字段,47只票实测全通)。
- **V3.4.0 (2026-06-29, 进化版)**:Python 3.9 兼容;修龙虎榜空数据崩溃;解禁日期双格式;强势股列名保护;连板数 lbc 别名;代码/示例分离;25场景实测通过。
- V3.3.0(原版):新增打板层/ETF期权层/舆情互动层,端点28→40。
- V3.2.5:修分钟K线参数bug、复权口径、EPS取列、em_get重试。
- V3.2.4:修mootdx 0.11.x BESTIP空串崩溃。
- V3.0:移除akshare依赖,全直连HTTP。
