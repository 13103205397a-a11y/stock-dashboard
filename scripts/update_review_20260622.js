'use strict';
/**
 * 每日复盘更新脚本 — 2026-06-22（端午节后首个交易日）
 * 技术信号因网络限制无法刷新，保持 2026-06-18 数据
 * 叙事/新闻基于 WebSearch 调研结果
 */
const fs = require('fs');
const path = require('path');

const dataFile  = path.join(__dirname, '../data.js');
const metaFile  = path.join(__dirname, '../meta.js');
const TODAY     = '2026-06-22';

// ── 加载 data.js ──────────────────────────────────────────
global.window = {};
eval(fs.readFileSync(dataFile, 'utf8'));
const STOCKS = window.STOCKS;

// ── 工具函数 ─────────────────────────────────────────────
function archiveReview(stock) {
  if (stock.review) {
    if (!stock.history) stock.history = [];
    stock.history.unshift({ ...stock.review });
    while (stock.history.length > 30) stock.history.pop();
  }
}

function prependNews(stock, items) {
  if (!stock.news) stock.news = [];
  stock.news = [...items, ...stock.news];
  while (stock.news.length > 40) stock.news.pop();
}

function byCode(code) {
  return STOCKS.find(s => s.code === code);
}

// ══════════════════════════════════════════════════════════
// 逐只更新
// ══════════════════════════════════════════════════════════

// ─── 1. 中际旭创 300308 ────────────────────────────────────
{
  const s = byCode('300308');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6月18日股价+7.19%，盘中创历史新高，总市值超越贵州茅台，成为A股新标杆（端午节假期前最后交易日）。来源：证券时报/同花顺',
      priceReaction: '+7.19% 成交额超400亿，量比0.98偏低 · 右侧已破新高但量能略不足'
    },
    {
      date: '2026-06-10',
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '市场流传某北美大客户1.6T光模块拉货提前至Q3的小作文，公司未正式澄清；叠加供应链扩产传闻。来源：雪球/股吧',
      priceReaction: '股价持续上行印证情绪'
    },
    {
      date: '2026-06-02',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'CPO概念再度爆发，中际旭创涨约8%创阶段新高，成交额400亿+，为板块人气核心。来源：证券时报',
      priceReaction: '+8% 放量'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '量价异动：6/18+7.19%，市值突破贵州茅台，成为A股新地标。量比0.98偏低，创新高但量能不完全支撑，端午节后承接力是关键观察点。1.6T客户提前拉货传闻持续，叙事逻辑未破。',
    rumors: '北美大客户1.6T拉货提前小作文持续，公司未正式证实亦未澄清，属传闻待验证。',
    newPoints: '市值超茅台标志性事件，或带动被动指数增配；硅光自研放量进度是下一阶段核心看点。'
  };
}

// ─── 2. 新易盛 300502 ─────────────────────────────────────
{
  const s = byCode('300502');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '市场传闻新易盛正研究港股上市计划，与中际旭创共同发酵"光模块双龙头赴港"主题，公司未公告确认。来源：财经媒体/雪球',
      priceReaction: '端午节前股价维持高位'
    },
    {
      date: '2026-05-15',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '2026Q1预付款同比增超200倍（约6.82亿元），远超行业均值，暗示订单已大量前置锁定，高盈利弹性持续。来源：一季报/同花顺',
      priceReaction: '订单前置信号强，股价创新高'
    },
    {
      date: '2026-06-02',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'CPO概念爆发，新易盛涨约8%，盘中创阶段新高，成交额300亿+。来源：证券时报',
      priceReaction: '+8% 放量创新高'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '预付款超200倍证实订单大量前置，高盈利质量支撑叙事。6/2 CPO爆发+8%，6/18+4.23%，整体量价配合。端午节后需关注高位获利回吐与量能是否持续。',
    rumors: '港股上市计划传闻，公司未公告确认，属未证实传闻。',
    newPoints: '泰国产能通过海外大客户认证是下一关键催化点；预付款持续高增印证高景气延续。'
  };
}

// ─── 3. 天孚通信 300394 ────────────────────────────────────
{
  const s = byCode('300394');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-02',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'CPO概念再度爆发，天孚通信涨约13%创历史新高，被机构认定为CPO光引擎核心受益标的，成交额300亿+。来源：证券时报',
      priceReaction: '+13% 大幅放量创新高'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: 'CPO光引擎批量导入头部光模块厂的进度传闻持续发酵，薄膜铌酸锂等新器件布局获市场关注。来源：雪球/机构调研纪要',
      priceReaction: '6/18+2.21%，量比1.06，盘面温和'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '6/2 CPO爆发+13%大幅放量量价异动，6/18+2.21%温和整固。距突破位11.3%，仍处箱体内。器件订单饱满叙事未动摇，等待突破放量确认。',
    rumors: 'CPO光引擎批量导入传闻，进度待公告验证。',
    newPoints: '薄膜铌酸锂调制器（TFLN）布局受业界关注，若量产落地是单独估值催化；MPO高密度连接受益于高速光模块放量。'
  };
}

// ─── 4. 光迅科技 002281 ────────────────────────────────────（升级：存疑→成立）
{
  const s = byCode('002281');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-16',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '35亿元定增股份（2088.9万股，发行价167.55元）于2026年6月16日在深交所上市，募资净额34.85亿元，其中20.74亿元用于高速光模块生产线扩建，6.14亿元用于高速光互联及新兴光电子研发。来源：公司公告/深交所',
      priceReaction: '6/18涨停+10%，量比0.85，成交活跃'
    },
    {
      date: '2026-06-18',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6月18日涨停+10%（量价异动，chgPct=10%），市场将定增落地解读为公司高速光模块扩产意志明确，国产算力客户导入预期升温。来源：同花顺/证券时报',
      priceReaction: '+10% 涨停，量比0.85略低但仍属大资金入场'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '【升级：存疑→成立】35亿定增6/16落地，募资方向明确（高速光模块+光电子研发），6/18涨停+10%量价异动。定增消化即表明机构对扩产逻辑的认可；数通光芯片国产替代加速，高速光模块占比提升进程明确。',
    rumors: '国产光芯片突破小作文仍持续，定增落地提供真实催化背书。',
    newPoints: '35亿资金明确投向高速光模块，AI数通占比有望快速提升；国资背景保障大订单护城河；高速自研光芯片放量是下一阶段超预期来源。'
  };
}

// ─── 5. 源杰科技 688498 ────────────────────────────────────（升级：存疑→成立）
{
  const s = byCode('688498');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-04-30',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '2025年全年归母净利润1.91亿元，同比增长3212.62%，EML光芯片放量逻辑得到业绩实质性验证；Q1 2026延续高景气。来源：年报公告',
      priceReaction: '业绩驱动股价持续上行'
    },
    {
      date: '2026-06-02',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'CPO概念爆发，源杰科技涨近18%（量价大幅异动），是CPO产业链中涨幅最大标的，大客户EML认证进度获市场高度关注。来源：证券时报',
      priceReaction: '+18% 大幅放量创历史新高'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '硅光CW光源订单导入传闻，市场预期源杰科技将受益CPO/硅光大客户认证推进。来源：雪球/机构调研纪要',
      priceReaction: '6/18+3.81%，距突破位2.3%，临近右侧突破'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '【升级：存疑→成立】2025年净利+3212%，EML放量逻辑已获业绩验证，不再是存疑的期权逻辑。6/2+18%量价大幅异动，CPO产业链最强弹性标的地位确立。当前距60日高点（右侧突破位）仅2.3%，临界突破区。',
    rumors: '硅光CW光源大客户认证传闻，公司未公告，属未证实传闻。',
    newPoints: '2025年业绩实质验证EML放量；硅光CW光源配套需求是第二增长曲线；车载激光雷达芯片布局提供长期期权价值。'
  };
}

// ─── 6. 亨通光电 600487 ────────────────────────────────────
{
  const s = byCode('600487');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-09',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '股价续创历史新高，6天3板，市值突破2500亿元，为光纤光缆板块龙头地位夯实。股价异常波动公告于6/4发布，公司表示无应披露未披露重大事项。来源：证券时报/公司公告',
      priceReaction: '6天3板 放量创历史新高'
    },
    {
      date: '2026-06-08',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '亚马逊与康宁签署数十亿美元光纤光缆协议，间接验证全球AI数据中心光纤景气度持续，利好国内光纤龙头供应链。来源：外电/证券时报',
      priceReaction: '板块整体受提振，亨通收益'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '中性',
      confirmed: false,
      text: '市场对亨通光电切入光模块/硅光的预期持续，但实质进展待核实；算力概念属弹性期权，不构成基本面核心驱动。来源：雪球',
      priceReaction: '6/18+0.01%，量比1.08，盘面平稳'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '6天3板创历史新高市值2500亿+，海缆高景气有基本面支撑；亚马逊数十亿美元康宁协议验证全球光纤需求持续景气。6/18仅+0.01%，属节前谨慎整固。',
    rumors: '切入光模块/硅光的小作文持续，需等待实质性产品或订单落地才能认定。',
    newPoints: '海外海缆大单是短中期最确定催化；算力硅光布局是中长期期权，当前仍需甄别。'
  };
}

// ─── 7. 中天科技 600522 ────────────────────────────────────
{
  const s = byCode('600522');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-04-30',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '公告800G高速光模块已完成批量出货，光纤产能满负荷运转，海缆+光纤+储能多元业务全面景气。来源：公司公告/21财经',
      priceReaction: '业绩驱动股价创新高'
    },
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '光纤概念持续走强，中天科技与杭电股份触及涨停（6月某日）。光纤景气周期来袭，年内已有6只光纤概念翻倍股。来源：财联社',
      priceReaction: '涨停 放量，量比0.93略低于近期均值'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '800G光模块批量出货公告确认多元业务景气，光纤产能满负荷；股价临近60日高点（距2.2%），右侧突破信号待放量确认。海缆+储能+光纤三轮共振。',
    rumors: '储能/算力订单传闻与光纤景气叠加，情绪正向。',
    newPoints: '800G光模块批量出货是实质验证；海外海缆订单持续是最强驱动；储能系统放量补充盈利弹性。'
  };
}

// ─── 8. 长飞光纤 601869 ────────────────────────────────────
{
  const s = byCode('601869');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-13',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '空芯光纤主题持续发酵，长飞光纤再度涨停，收于484.33元，相较一年前超10倍涨幅。光纤景气周期进一步强化，预制棒一体化成本优势凸显。来源：财联社/同花顺',
      priceReaction: '涨停 量比0.91'
    },
    {
      date: '2026-06-02',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '中国移动联合产业合作伙伴，全球首条S+C+L三波段超低损多芯光缆线路在青岛建成开通，间接验证特种光纤市场空间。来源：人民邮电报',
      priceReaction: '板块受益，长飞随势上行'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '中性',
      confirmed: false,
      text: '空芯光纤数据中心导入头部云厂传闻再度出现，但商用化时间表仍存争议（业界普遍认为2028年前后加速渗透）。来源：雪球/机构调研',
      priceReaction: '6/18+2.4%，量比0.91，整固'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '年内超10倍涨幅创历史，空芯光纤+光纤景气双轮共振，再度涨停验证市场热情。距突破位5%，箱体内整固。空芯光纤商用化仍属早期，但全球首条三波段多芯光缆开通提振产业预期。',
    rumors: '空芯光纤数据中心导入传闻反复，商用化节奏不确定，需警惕纯主题驱动的高位波动。',
    newPoints: '空芯光纤在AI数据中心长距互联的渗透节奏（2028年前后）是最大弹性来源；海外产能与特种光纤持续扩张。'
  };
}

// ─── 9. 永鼎股份 600105 ────────────────────────────────────（升级：存疑→成立）
{
  const s = byCode('600105');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-03',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6月3日涨停（+9.25%，量价异动），涨停驱动因素：光芯片业务+业绩增长+超导带材概念联动。来源：搜狐财经/同花顺',
      priceReaction: '+9.25% 涨停，量比异动'
    },
    {
      date: '2026-04-22',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '涨停分析：子公司东部超导HF1200系列REBCO高温超导带材已实现单根千米级批量制备（最大1435米）；东部超导签订核心订单近20亿元，2025-2030年长约框架订单41亿元。来源：新浪财经/公司投资者关系',
      priceReaction: '涨停，超导实质订单验证'
    },
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '机构测算2026年公司营收均值61亿（同比+27%），归母净利4.3亿（+72%），超导净利增速100%-150%；"十五五"规划将可控核聚变列为战略科技方向，超导产业受益。来源：机构研报综合',
      priceReaction: '6/18 -1.54%，量比0.9，回踩整固'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '【升级：存疑→成立】东部超导签订近20亿核心订单+2025-2030年41亿长约框架，超导业务不再是纯主题，具备实质订单支撑。国家"十五五"将核聚变列为战略科技方向，政策催化明确。6/18-1.54%小幅回踩，箱体内整固，距突破位4.1%。',
    rumors: '核聚变商用时间表仍不确定（10-20年量级），但超导带材为其配套订单具有确定性；警惕主题过热导致高位震荡。',
    newPoints: '东部超导REBCO带材实质大单（41亿长约）是核心逻辑；国家战略背书核聚变赛道；超导带材向磁约束核聚变装置（ITER/CFETR）供货是最大增量来源。'
  };
}

// ─── 10. 华工科技 000988 ──────────────────────────────────
{
  const s = byCode('000988');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '数通800G光模块业务高速增长，切入北美数通客户传闻持续，激光+光模块+传感器三元业务协同。6/18 +4.13%，距突破位2.3%，临近右侧突破区。来源：机构研报/同花顺',
      priceReaction: '+4.13%，量比0.91，右侧临近突破2.3%'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '6/18+4.13%，距突破位仅2.3%，右侧临近突破；数通光模块逻辑强化，北美客户传闻持续。节前整体表现稳健。',
    rumors: '切入北美数通客户传闻，公司未公告，待验证。',
    newPoints: '数通800G光模块占比快速提升是当前最强驱动；PLC/硅光布局提供估值弹性。'
  };
}

// ─── 11. 胜宏科技 300476 ──────────────────────────────────
{
  const s = byCode('300476');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-16',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '近590亿主力资金涌入高端PCB板块，胜宏科技作为AI PCB龙头领衔，全年投资上限200亿元，专注AI服务器高多层PCB与光模块产线，惠州+泰国双基地扩建。来源：新浪财经',
      priceReaction: '板块资金流入，个股受益'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '下一代GPU平台（Blackwell Ultra/Rubin）PCB层数提升、单板价值量跃升的小作文持续，胜宏被市场解读为最大受益方之一。来源：雪球/机构调研纪要',
      priceReaction: '6/18+2.02%，距突破位9.1%，箱体整固'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '200亿扩产计划落地，AI PCB龙头地位确立。6/18+2.02%，距突破位9.1%，箱体内整固，未突破需等待业绩驱动放量。节前大资金集中入场AI PCB板块。',
    rumors: '新一代GPU平台PCB独供/份额提升传闻，公司未证实，属重要但需甄别的小作文。',
    newPoints: '2030年千亿产值目标若推进，对应CAGR超30%；海外建厂（泰国）规避关税与地缘风险。'
  };
}

// ─── 12. 沪电股份 002463 ──────────────────────────────────
{
  const s = byCode('002463');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-16',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '累计扩产投资超170亿元，布局高频高速超高多层服务器背板，配套英伟达、华为算力设备，5月22日封板涨停，主力资金大幅净流入。来源：新浪财经',
      priceReaction: '5月22日涨停，6月维持强势'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '800G交换机背板新产能订单饱满传闻，黄石基地扩产进入关键爬坡期。来源：机构调研纪要',
      priceReaction: '6/18+0.92%，距突破位1.4%，临近右侧突破'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '扩产170亿确认数通PCB稳健龙头地位，6/18距突破位仅1.4%，右侧突破信号最近，量比0.94待放量确认。',
    rumors: '800G交换机背板订单饱满传闻，机构态度普遍乐观。',
    newPoints: '800G/1.6T高速交换机PCB升级量价齐升；黄石新产能放量爬坡是短期关键看点。'
  };
}

// ─── 13. 鹏鼎控股 002938 ──────────────────────────────────
{
  const s = byCode('002938');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-16',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '全年资本开支168亿元，淮安百亿产业园落地，主攻AI类载板及高多层算力板，5月22日一字涨停。来源：新浪财经',
      priceReaction: '5月22日一字涨停，AI切入信号强'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '切入AI服务器主板及载板传闻持续，但当前大客户（苹果）FPC基本盘季节性仍是主要贡献，AI业务兑现节奏不明。来源：机构调研',
      priceReaction: '6/18+0.76%，距突破位2.7%，临近右侧突破'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '168亿资本开支方向正确，但AI PCB/载板实质收入贡献尚未体现在业绩上；大客户FPC基本盘季节性依赖仍较强。距突破位2.7%，技术面临近关键位置，但叙事兑现节奏仍需观察。',
    rumors: '切入AI服务器主板传闻属重要但未证实信号，需等季度报验证。',
    newPoints: 'AI载板与服务器PCB是第二曲线，若2026H2有业绩贡献则升级逻辑；折叠屏FPC提供消费弹性。'
  };
}

// ─── 14. 东山精密 002384 ──────────────────────────────────
{
  const s = byCode('002384');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-18',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6/18+6.26%（量价异动，chgPct≥5%），AI服务器PCB逻辑强化，市场对高端服务器PCB切入进展持乐观预期，当日成交活跃。来源：同花顺',
      priceReaction: '+6.26% 量比1.03，量价联动良好'
    },
    {
      date: '2026-06-16',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '东山精密扩产方向聚焦AI服务器PCB与光模块，与鹏鼎共同获机构重点调研，扩产方向获认可。来源：机构调研纪要',
      priceReaction: '股价持续强势'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '量价异动：6/18+6.26%（量比1.03），距突破位1.7%，右侧临近突破，量价联动良好。AI服务器PCB逻辑强化，多元业务协同（FPC+PCB+光通信）提升弹性。',
    rumors: '切入高端服务器PCB传闻，扩产方向获机构验证但业绩兑现需看后续季报。',
    newPoints: '光模块/光通信新增量；AI服务器PCB占比提升是关键拐点指标；汽车Tier1业务分散风险。'
  };
}

// ─── 15. 生益科技 600183 ──────────────────────────────────
{
  const s = byCode('600183');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-16',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '高速CCL（覆铜板）高端料量价齐升持续，AI服务器材料升级加速，国金证券维持"买入"评级，称高端料占比持续提升是超预期来源。来源：国金证券研报/新浪财经',
      priceReaction: '5月22日涨停，6月维持强势'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '高速覆铜板供不应求、涨价传闻持续；生益电子（子公司）募资26亿元投向HDI生产基地及高多层算力电路板。来源：机构调研/雪球',
      priceReaction: '6/18+2.06%，量比0.98，距突破位3.9%'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '高端CCL料量价齐升叙事持续验证，子公司生益电子26亿扩产HDI算力板方向明确。6/18+2.06%，距突破位3.9%，箱体内稳健。',
    rumors: '高速覆铜板涨价/缺货传闻持续，与行业数据基本一致，可信度较高。',
    newPoints: '更高料号（M8/M9级）导入与价值量提升；海外产能配套全球AI PCB需求。'
  };
}

// ─── 16. 东材科技 601208 ──────────────────────────────────
{
  const s = byCode('601208');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '高速树脂（碳氢/PPO）通过头部CCL厂（如生益/建滔）认证的传闻持续，若落地将是实质性拐点。来源：机构调研纪要/雪球',
      priceReaction: '6/18+2.23%，量比1.0，距突破位3.9%，箱体整固'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '高速树脂认证传闻持续但公司未公告实质导入；传统业务（绝缘材料/光学膜）对冲盈利压力，但弹性来自高速料，需公告确认。',
    rumors: '头部CCL厂认证传闻属重要未证实信号，若认证完成即触发逻辑升级。',
    newPoints: '碳氢/PPO高速树脂放量是核心期权；新能源绝缘材料提供稳健基本盘。'
  };
}

// ─── 17. 利通电子 603629 ──────────────────────────────────
{
  const s = byCode('603629');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-01',
      type: '公告',
      impact: '中性',
      confirmed: true,
      text: '董事会换届，新任董秘背景跨界（会计师跨入算力租赁），公司治理常规事项；媒体报道聚焦"10个月身家6500万"引发舆论关注，无实质业务影响。来源：同花顺/21财经',
      priceReaction: '公告后情绪中性，不影响股价趋势'
    },
    {
      date: '2026-04-29',
      type: '公告',
      impact: '利空',
      confirmed: true,
      text: '互动平台披露：公司持有的算力设备（GPU）均已全部对外出租，但明确提示"若未来芯片断供将对业务后续发展产生重要不利影响"。来源：每经网/公司公告',
      priceReaction: '2连板后短暂回落，市场关注断供风险'
    },
    {
      date: '2026-06-18',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6/18+7%（量比1.13，量价异动），年内从26.65元最高涨至240.88元（+8倍），算力租赁景气叙事驱动。来源：同花顺',
      priceReaction: '+7% 量比1.13，但距60日高点36.4%，属深度箱体内'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '量价异动：6/18+7%，但公司已披露芯片断供风险（4/29），核心资产可持续性存在制约。算力设备全部出租印证当期景气，但成长性取决于能否持续采购GPU，地缘政策风险不可忽视。距60日高点36.4%，远离右侧。',
    rumors: '算力订单/GPU采购规模扩大传闻持续；董秘换届引发舆论但无实质影响。',
    newPoints: '算力租赁规模若能突破芯片供应瓶颈是核心正向拐点；PCB主业高端化是稳健基本盘。'
  };
}

// ─── 18. 沃格光电 603773 ──────────────────────────────────
{
  const s = byCode('603773');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-07',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '玻璃基板概念反复活跃，沃格光电逼近涨停再创历史新高，戈碧迦、凯盛科技等联动。东吴证券称2026年为玻璃基板商业化导入关键节点，2028年前后加速渗透期。来源：财联社',
      priceReaction: '逼近涨停，再创历史新高，量价大幅异动'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: '玻璃基板送样头部封测厂传闻再度出现；Intel、TSMC持续推进中试验证，2026年商业化导入关键节点预期维持。来源：雪球/东吴证券研报',
      priceReaction: '6/18-0.86%，量比1.02，高位小幅回落'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '玻璃基板主题热度高，6/7再创历史新高，但商业化仍处早期（2026年导入期、2028年渗透期），产业化不确定性高。6/18-0.86%小幅回调，高位震荡属正常。主业盈利弱，需防高位纯主题风险。',
    rumors: '送样头部封测厂传闻频繁，产业化时间表仍有争议；东吴证券报告提供一定机构背书。',
    newPoints: 'Intel/TSMC玻璃基板量产节点是外部最重要催化；TGV技术在AI Chiplet载板中的渗透率是长期增量来源。'
  };
}

// ─── 19. 寒武纪 688256 ──────────────────────────────────
{
  const s = byCode('688256');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-18',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6/18+14.2%（量价大幅异动，chgPct=14.2%），盘中创历史新高，市值接近万亿（9656亿元），科创50指数涨近4%创新高，寒武纪为核心权重驱动。来源：新浪财经/同花顺',
      priceReaction: '+14.2% 量比1.12，放量创历史新高，量价大幅异动'
    },
    {
      date: '2026-06-15',
      type: '小作文',
      impact: '利好',
      confirmed: false,
      text: '网络流传"寒武纪内部交流纪要"：字节跳动Q2交付MLU580约12-16万张，MLU690下半年开始交付。公司证券事务代表正式回应"系小作文，近期无内部交流活动，请投资者注意甄别"。来源：雪球/东方财富/公司澄清',
      priceReaction: '小作文驱动情绪，公司澄清后警示高位风险'
    },
    {
      date: '2026-04-25',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '2026Q1营收64.97亿（同比+453%）、归母净利20.59亿，上市五年来首次扭亏为盈，业绩实质性兑现。来源：季报公告',
      priceReaction: '业绩大超预期推动股价持续上行'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '量价大幅异动：6/18+14.2%（量比1.12），接近万亿市值。字节跳动大单小作文被公司明确澄清为不实（"无内部交流"），背离信号：无公告消息但量价放量大涨，属小作文驱动+情绪共振，需警惕高位震荡。Q1业绩实质兑现支撑基本面逻辑。',
    rumors: '字节跳动MLU580/690大单小作文（公司已澄清为不实），国产算力大客户情绪持续发酵。',
    newPoints: '推理需求放量（大模型推理算力）打开第二增长曲线；万亿市值前夕或面临高估值压力，需业绩持续验证。'
  };
}

// ─── 20. 兆易创新 603986 ──────────────────────────────────
{
  const s = byCode('603986');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-18',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '6/18+7.33%（量价异动），创历史新高；NorFlash产品部分料号涨价30%+，存储超级周期持续；DRAM合约价Q2预计环比+58-63%。来源：同花顺/TrendForce',
      priceReaction: '+7.33% 量比0.95，创历史新高'
    },
    {
      date: '2026-06-13',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '兆易创新港股正式上市（港交所主板），发行价162港元，开盘235港元，强势登录资本市场；奇瑞汽车战略合作签约聚焦车规级芯片。来源：中国基金报',
      priceReaction: '港股上市溢价开盘，A股联动上涨'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '量价异动：6/18+7.33%，NorFlash涨价30%+超预期，存储超级周期加速兑现。港股上市（开盘溢价45%）提升资本关注度，车规MCU战略合作开辟第二增长极。叙事全面强化。',
    rumors: 'DRAM自研进展市场关注但无实质公告；存储涨价幅度是否可持续需跟踪。',
    newPoints: '港股上市引入国际资金关注；车规MCU与奇瑞合作是新增长极；利基DRAM自研若量产是重大催化。'
  };
}

// ─── 21. 通富微电 002156 ──────────────────────────────────
{
  const s = byCode('002156');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-06-10',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '拟募资不超过44亿元用于先进封装产能提升（其中8亿元专项用于存储芯片封测）和研发中心建设，绑定AMD扩产明确。来源：公司公告/同花顺',
      priceReaction: '定增预期推动股价上行'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: 'AMD MI350/MI400 AI加速卡订单放量的传闻，通富微电作为AMD独家封测伙伴受益预期持续。来源：雪球/机构调研纪要',
      priceReaction: '6/18+1.56%，距突破位15%，暂无右侧信号'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '44亿定增方向明确（先进封装+存储封测），绑定AMD AI加速卡景气逻辑持续。6/18+1.56%，距突破位15%，处于箱体整固期，需等待AMD新品催化放量。',
    rumors: 'AMD MI350/MI400封装订单传闻，公司未公告；HBM配套封装是重要未来看点。',
    newPoints: '2.5D/Chiplet先进封装扩产是核心驱动；国产AI芯片封测增量（寒武纪/华为/燧原等）打开第二客户来源。'
  };
}

// ─── 22. 长电科技 600584 ──────────────────────────────────
{
  const s = byCode('600584');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '先进封装XDFOI技术（2.5D异构集成）持续推进，AI/HPC封测景气度高；行业稼动率持续回升，封测价格有涨价趋势。来源：机构研报综合',
      priceReaction: '6/18+1.55%，量比0.85，距突破位14.3%，整固'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '先进封装XDFOI放量逻辑持续，行业复苏+稼动率回升验证。6/18+1.55%，但距突破位14.3%，处于中期整固箱体。汽车电子封装是额外弹性。',
    rumors: 'AI芯片先进封装订单传闻，行业普遍景气，可信度较高。',
    newPoints: 'XDFOI 2.5D先进封装技术量产节点；AI/HPC需求持续拉动稼动率；汽车/存储封装多元化客户。'
  };
}

// ─── 23. 华天科技 002185 ──────────────────────────────────
{
  const s = byCode('002185');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '封测行业景气复苏，华天科技稼动率持续回升，先进封装（Bumping/FC）产能满载传闻，AI/存储封测带动增量。来源：机构研报',
      priceReaction: '6/18+2.94%，量比0.78略低，距突破位11.9%'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '随封测行业复苏，稼动率持续改善，先进封装产能需求旺盛。6/18+2.94%，量比0.78偏低，距突破位11.9%，需等待业绩进一步催化。',
    rumors: '先进封装产能满载传闻，与行业景气度一致，可信度较高。',
    newPoints: '先进封装占比提升（FC/Bumping）是核心估值驱动；AI/HBM配套封测增量。'
  };
}

// ─── 24. 立昂微 605358 ──────────────────────────────────
{
  const s = byCode('605358');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '硅片复苏节奏偏慢，12寸硅片价格仍在磨底，国内晶圆厂扩产带动稼动率缓慢回升；功率器件周期改善但弹性有限。来源：机构研报综合',
      priceReaction: '6/18-1.06%，量比1.15，箱体内震荡'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '硅片价格回升节奏慢于预期，6/18-1.06%，量比1.15略有资金流出。12寸放量仍在爬坡，缺乏短期催化。距突破位10.5%。',
    rumors: '硅片涨价传闻与实际价格走势存在落差，需继续跟踪现货价格拐点。',
    newPoints: '12寸硅片国产替代加速是中期逻辑；功率器件周期共振时弹性可观。'
  };
}

// ─── 25. 江波龙 301308 ──────────────────────────────────
{
  const s = byCode('301308');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '存储超级周期进行中，DRAM合约价Q2预计环比+58-63%、NAND Flash预计+70-75%，江波龙作为企业级eSSD国产龙头直接受益。来源：TrendForce/21财经',
      priceReaction: '6/18+1.07%，量比1.17，距突破位10.3%'
    },
    {
      date: TODAY,
      type: '传闻',
      impact: '利好',
      confirmed: false,
      text: 'AI服务器企业级eSSD大单传闻，国内云厂扩容存储采购。来源：雪球',
      priceReaction: '涨价周期带动估值持续上行'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '存储超级周期强化弹性逻辑，DRAM/NAND Flash涨价幅度超预期。6/18+1.07%，量比1.17，箱体内稳健。AI服务器存储需求持续旺盛。',
    rumors: 'AI服务器大单传闻，与产业趋势一致，可信度较高。',
    newPoints: '企业级eSSD放量量价齐升；海外品牌拓展提升竞争壁垒。'
  };
}

// ─── 26. 德明利 001309 ──────────────────────────────────
{
  const s = byCode('001309');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '存储涨价周期持续，主控自研提升毛利弹性，企业级SSD客户拓展；6/18+0.34%，量比1.09，箱体内横盘整固，距突破位6.7%。来源：机构研报',
      priceReaction: '+0.34%，量比1.09，距突破6.7%'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '存储涨价周期弹性持续，主控自研增强毛利能力，但整体节奏略弱于兆易/江波龙一线。距突破位6.7%，箱体整固。',
    rumors: '涨价/企业级订单传闻与产业趋势一致。',
    newPoints: '企业级SSD放量与主控芯片协同是核心差异化竞争力。'
  };
}

// ─── 27. 三环集团 300408 ──────────────────────────────────
{
  const s = byCode('300408');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'MLCC周期回暖+光模块放量拉动陶瓷套管/MPO连接器需求，三环多元陶瓷平台受益"AI硬件全线走强"；高端MLCC国产替代渗透率持续提升。来源：机构研报/财联社',
      priceReaction: '6/18+1.56%，量比1.0，距突破位5.6%'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'MLCC周期回暖与AI光模块拉动陶瓷器件双轮共振，多元化平台叙事持续。6/18+1.56%，量比1.0，距突破5.6%，箱体整固。',
    rumors: 'MLCC涨价/高端料导入传闻，与行业趋势一致。',
    newPoints: '光纤陶瓷套管受AI光模块放量直接拉动；固态电池电解质（全固态）是中期新增量来源。'
  };
}

// ─── 28. 风华高科 000636 ──────────────────────────────────
{
  const s = byCode('000636');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'MLCC周期涨价回暖，风华高科作为国产MLCC龙头，高端料放量叙事持续；汽车级/AI服务器被动元件需求旺盛。来源：机构研报',
      priceReaction: '6/18+0.73%，量比0.99，距突破位2.0%，右侧临近突破'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'MLCC周期回暖，6/18距突破位仅2.0%，右侧临近突破；量比0.99略不足，若放量站上76.10则触发右侧买点。',
    rumors: 'MLCC涨价函/缺货传闻，产业链数据基本印证。',
    newPoints: '高端MLCC国产替代（车规/AI服务器级）量价齐升是核心驱动。'
  };
}

// ─── 29. 火炬电子 603678 ──────────────────────────────────
{
  const s = byCode('603678');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '军用电子被动元件景气度偏稳，MLCC军品需求持续但节奏慢于民品市场。6月整体无重大公告或催化事件。来源：机构研报',
      priceReaction: '端午节前整体震荡'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '军用被动元件基本盘稳固，但缺乏短期催化；MLCC军品需求弹性低于民品，叙事兑现节奏偏慢。',
    rumors: '无重大传闻。',
    newPoints: '高可靠性军品需求长期稳定；若民用MLCC涨价带动整体提价则有估值弹性。'
  };
}

// ─── 30. 国瓷材料 300285 ──────────────────────────────────
{
  const s = byCode('300285');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '特种陶瓷+MLCC材料+牙科氧化锆多元业务，MLCC材料涨价周期间接受益，端午节前整体维持强势。来源：机构研报',
      priceReaction: '维持高位，无明显量价异动'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '多元陶瓷平台叙事维持，MLCC材料受益涨价周期，牙科氧化锆海外市场稳定。无重大变化，叙事持续成立。',
    rumors: '无重大传闻。',
    newPoints: '功能陶瓷与MLCC材料国产替代持续推进；固态电解质陶瓷是中期期权。'
  };
}

// ─── 31. 信维通信 300136 ──────────────────────────────────
{
  const s = byCode('300136');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '天线/连接器业务依赖大客户消费电子节奏，6月缺乏重大新增催化；卫星通信天线布局是弹性期权，商用化进度缓慢。来源：机构研报',
      priceReaction: '端午节前整体震荡，无明显方向'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '大客户依赖仍强，AI/卫星通信等弹性业务兑现节奏慢；6月无重大催化，叙事维持存疑。',
    rumors: '卫星通信天线布局传闻，商用时间表不明确。',
    newPoints: '卫星互联网天线是长期期权；消费电子修复是短期弹性来源。'
  };
}

// ─── 32. 大族数控 301200 ──────────────────────────────────
{
  const s = byCode('301200');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: 'PCB数控钻铣设备需求随AI PCB扩产周期持续增长，大族数控设备订单延续高景气；6月无重大公告。来源：机构研报',
      priceReaction: '随PCB板块景气维持'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'AI PCB扩产带动设备需求高景气，叙事持续成立。无重大变化。',
    rumors: '无重大传闻。',
    newPoints: 'AI PCB 200亿+扩产潮直接拉动钻铣设备采购；国产替代提升市占率。'
  };
}

// ─── 33. 大族激光 002008 ──────────────────────────────────
{
  const s = byCode('002008');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '激光加工设备需求分化：消费电子类需求偏弱，新能源/动力电池类需求承压；AI服务器PCB加工设备是新增量但占比仍小。来源：机构研报',
      priceReaction: '端午节前整体震荡'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '主业激光设备需求结构分化，新能源/消费两大基本盘均承压；AI服务器PCB设备是新增量但规模尚小，叙事偏存疑。',
    rumors: '无重大传闻。',
    newPoints: 'AI服务器PCB激光加工是新增量来源；新能源汽车激光焊接若复苏是主要弹性。'
  };
}

// ─── 34. 工业富联 601138 ──────────────────────────────────
{
  const s = byCode('601138');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-04-28',
      type: '公告',
      impact: '利好',
      confirmed: true,
      text: '2026Q1营收2510亿（同比+56.5%）、归母净利105.95亿（同比+102.6%），AI GPU机柜出货量同比+3.8倍；AI服务器订单已锁定至2027年，CPO全光交换机样机开始生产。来源：季报公告',
      priceReaction: '业绩大超预期，推动股价历史新高'
    },
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '2026年全球云服务商资本开支预计超6000亿美元（同比+40%），工业富联受益AI服务器景气最强确定性；AI服务器订单可见度锁定至2027年，是A股"确定性最高"的AI算力标的之一。来源：机构研报/同花顺',
      priceReaction: '持续创历史新高，市值达1.6万亿'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'Q1净利+102%超预期，AI GPU机柜+3.8倍，订单锁定至2027年，叙事全面强化。全球云厂capex超6000亿美元支撑下游景气。CPO全光交换机样机生产是重要新增长点。',
    rumors: 'GB300/Blackwell Ultra服务器出货占比提升传闻，公司2026年AI服务器收入占比超60%预期。',
    newPoints: 'CPO全光交换机（光互联升级）是价值量提升的重要新方向；AI ASIC服务器+3.2倍是算力多元化体现。'
  };
}

// ─── 35. 阳光电源 300274 ──────────────────────────────────
{
  const s = byCode('300274');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-03-11',
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '阳光电源与国际领先云厂商及国内头部互联网企业开展储能/电力协作，计划2026年完成产品商业化和小规模交付。来源：新浪财经',
      priceReaction: '股价阶段性涨停，主力资金净流入'
    },
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '2025年年报阳光电源归母净利润保持高增，储能/逆变器国际化持续推进，新能源+算力双主线逻辑。来源：年报公告',
      priceReaction: '端午节前整体稳健，无大幅波动'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '与云厂商储能合作落地、产品商业化推进，逆变器国际化持续贡献收入。叙事稳健，无重大变化。',
    rumors: '无重大传闻。',
    newPoints: '数据中心大型储能配套是新增量；全球逆变器出货量持续领先。'
  };
}

// ─── 36. 德业股份 605117 ──────────────────────────────────
{
  const s = byCode('605117');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '户用储能逆变器出口持续高增，欧洲户储市场需求回暖；国内工商业储能景气度高。6月无重大公告。来源：机构研报',
      priceReaction: '端午节前稳健，无大幅波动'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '户用储能逆变器出口景气持续，叙事维持成立。无重大变化。',
    rumors: '无重大传闻。',
    newPoints: '欧洲户储市场回暖加速；国内工商业储能业务放量。'
  };
}

// ─── 37. 麦格米特 002851 ──────────────────────────────────
{
  const s = byCode('002851');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '数据中心/AI服务器高效电源（液冷电源/PSU）景气持续，麦格米特受益AI供电需求高增；储能电源出货稳健。来源：机构研报',
      priceReaction: '端午节前稳健，随电力设备板块上行'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'AI服务器高效电源需求持续高景气，叙事稳健成立。无重大变化。',
    rumors: '无重大传闻。',
    newPoints: 'AI服务器液冷电源/高效PSU是核心增量；工业电源国产替代持续推进。'
  };
}

// ─── 38. 中恒电气 002364 ──────────────────────────────────
{
  const s = byCode('002364');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '数据中心直流供电（HVDC）与模块化UPS需求随AI算力投资持续高增；电网改造投资拉动变配电设备需求。来源：机构研报',
      priceReaction: '端午节前稳健'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'AI数据中心直流供电与电网改造双轮驱动，叙事持续成立。无重大变化。',
    rumors: '无重大传闻。',
    newPoints: 'AI数据中心HVDC供电国产化是核心驱动；新型电力系统改造提供额外订单。'
  };
}

// ─── 39. 中国西电 601179 ──────────────────────────────────
{
  const s = byCode('601179');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '国家电网投资额持续高位，超高压/特高压输配电设备订单饱满，中国西电作为国资电力设备龙头受益；6月无重大公告。来源：机构研报',
      priceReaction: '端午节前稳健蓝筹风格'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '电网投资高景气支撑，国资龙头订单饱满。叙事稳健，无重大变化。',
    rumors: '无重大传闻。',
    newPoints: '特高压新建线路订单是阶段性催化；出海（东南亚/中东）是中期增量。'
  };
}

// ─── 40. 四方股份 601126 ──────────────────────────────────
{
  const s = byCode('601126');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '电力自动化/继电保护设备受益新型电力系统建设，需求稳健增长；6月无重大公告。来源：机构研报',
      priceReaction: '端午节前稳健'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: '新型电力系统建设持续支撑，叙事稳健。无重大变化。',
    rumors: '无重大传闻。',
    newPoints: '数字化变电站与新能源并网消纳需求增量。'
  };
}

// ─── 41. 英维克 002837 ──────────────────────────────────（降级：成立→存疑）
{
  const s = byCode('002837');
  archiveReview(s);
  prependNews(s, [
    {
      date: '2026-04-21',
      type: '公告',
      impact: '利空',
      confirmed: true,
      text: '2026Q1营收11.75亿（同比+26%），但归母净利仅0.87亿（同比-82%），扣非净利-87.1%；原因：人民币升值汇兑损失+应收款坏账计提增加+毛利率下滑2.16%+发货延迟。连续2日一字跌停。来源：公司公告/21财经',
      priceReaction: '连续2日一字跌停，千亿市值急剧蒸发'
    },
    {
      date: '2026-04-22',
      type: '新闻',
      impact: '利空',
      confirmed: true,
      text: '"液冷10倍股英维克业绩黑天鹅"——增收不增利，Q1净利大降82%，"液冷叙事遭遇第一次考验"。市场重新审视高估值下的盈利可持续性。来源：21财经/华尔街见闻',
      priceReaction: '一字跌停，市场情绪大幅转弱'
    },
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '公司Q1订单充沛，发货延迟与回款周期变长是主要问题，非业务量下滑。后续需观察Q2发货情况与回款改善。来源：公司公告解读/机构研报',
      priceReaction: '6/18 -0.34%，量比1.07，市场情绪谨慎'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '【降级：成立→存疑】Q1净利-82%、扣非净利-87%，连续2日一字跌停，"液冷叙事首次重大考验"。增收不增利背后：汇兑损失+应收款坏账+毛利下滑+发货延迟，核心业务景气未变但盈利能力受损，需观察Q2能否修复。',
    rumors: '市场传言部分IDC项目结算延期导致回款困难，公司未单独说明具体项目情况。',
    newPoints: '若Q2发货正常化、回款改善、汇兑损失消除，则Q2业绩有望大幅反弹；液冷精密温控赛道长期逻辑未变，需等Q2验证。'
  };
}

// ─── 42. 润泽科技 300442 ──────────────────────────────────
{
  const s = byCode('300442');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '利好',
      confirmed: true,
      text: '数据中心IDC景气持续高位，润泽科技作为算力IDC运营核心标的，受益AI算力大规模投资，上架率持续提升。6月无重大公告。来源：机构研报',
      priceReaction: '端午节前维持强势'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '成立',
    change: 'IDC运营景气持续，AI算力投资高峰期受益明确，叙事稳健成立。无重大变化。',
    rumors: '无重大传闻。',
    newPoints: '液冷数据中心改造与新建是差异化竞争优势；上架率继续提升是业绩确定性来源。'
  };
}

// ─── 43. 宏景科技 301396 ──────────────────────────────────
{
  const s = byCode('301396');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '数据中心冷却/液冷相关业务随AI算力投资增长，但公司体量较小、弹性有限；6月无重大公告。来源：机构研报',
      priceReaction: '端午节前整体平稳'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '业务方向正确，但规模偏小，液冷叙事兑现节奏待观察；英维克Q1暴雷也对液冷板块情绪有一定拖累。',
    rumors: '无重大传闻。',
    newPoints: '若大型IDC项目中标是实质性催化。'
  };
}

// ─── 44. 太极实业 600667 ──────────────────────────────────
{
  const s = byCode('600667');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '半导体材料+数据中心运营双主业，叙事弹性来自晶圆级封装材料与IDC；6月无重大公告。来源：机构研报',
      priceReaction: '端午节前整体平稳'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '半导体材料与IDC双主业叙事清晰，但材料业务规模偏小，IDC贡献待观察。叙事存疑维持。',
    rumors: '无重大传闻。',
    newPoints: '晶圆级封装材料（先进封装配套）若放量是实质拐点。'
  };
}

// ─── 45. 西部材料 002149 ──────────────────────────────────
{
  const s = byCode('002149');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '钛及钛合金、稀有金属材料用于航空/核能领域，需求稳健；高端靶材（溅射靶材）进入半导体领域是增量，但6月无重大公告。来源：机构研报',
      priceReaction: '端午节前整体平稳'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '军工/核能材料基本盘稳健，半导体靶材是弹性期权，但商用化节奏缓慢。叙事存疑维持，缺乏近期催化。',
    rumors: '无重大传闻。',
    newPoints: '钛合金在商业航天扩产中是增量；半导体溅射靶材国产化是中期期权。'
  };
}

// ─── 46. 红星发展 600367 ──────────────────────────────────
{
  const s = byCode('600367');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '民爆材料主业稳健，地下矿山/基础设施爆破需求平稳；新能源矿山开采需求是增量，但短期催化有限。来源：机构研报',
      priceReaction: '端午节前整体平稳'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '民爆材料主业平稳，题材属性有限；叙事弹性来自矿山需求和特种材料，但近期无催化。存疑维持。',
    rumors: '无重大传闻。',
    newPoints: '新能源矿山（锂/铜）开采需求增量是中期看点。'
  };
}

// ─── 47. 声迅股份 003004 ──────────────────────────────────
{
  const s = byCode('003004');
  archiveReview(s);
  prependNews(s, [
    {
      date: TODAY,
      type: '新闻',
      impact: '中性',
      confirmed: true,
      text: '安防AI化+智能监控需求持续，声迅股份作为小盘安防AI标的，受益政府安防数字化投资；6月无重大公告。来源：机构研报',
      priceReaction: '端午节前整体平稳'
    }
  ]);
  s.review = {
    date: TODAY,
    verdict: '存疑',
    change: '安防AI叙事方向正确，但大客户政府端支出不确定性较高，兑现节奏偏慢。叙事存疑维持，缺乏近期催化。',
    rumors: '无重大传闻。',
    newPoints: 'AI安防政策性采购放量是主要催化来源。'
  };
}

// ══════════════════════════════════════════════════════════
// 写回 data.js
// ══════════════════════════════════════════════════════════
const rawSrc = fs.readFileSync(dataFile, 'utf8');
// 替换头部注释中的日期
const newHeader = rawSrc
  .match(/^\/\*[\s\S]*?\*\/\n/)[0]
  .replace(/\* 信号更新：[^\n]+/, '* 信号更新：2026-06-18（注：端午节假期6/19-6/21，行情API受网络限制未刷新，技术信号保持2026-06-18数据）');

const output = newHeader + 'window.STOCKS = ' + JSON.stringify(STOCKS, null, 2) + ';\n';
fs.writeFileSync(dataFile, output, 'utf8');
console.log('✅ data.js 写入完成，共', STOCKS.length, '只股票');

// ══════════════════════════════════════════════════════════
// 更新 meta.js
// ══════════════════════════════════════════════════════════
const metaContent = `/* 全局元信息：marketRegime/summary 由复盘 Agent 维护；signalDate/signalStat 为行情自动统计 */
window.META = {
  "lastUpdated": "2026-06-22",
  "marketRegime": "端午节后首个交易日（6/22）：算力主线延续，CPO/光模块/AI PCB/国产算力芯片为最强主线；存储超级周期加速，DRAM/NAND Flash涨价超预期；英维克Q1暴雷警示高位个股业绩风险；整体偏强，节后承接力为关键观察点。",
  "summary": "本期复盘（2026-06-22，端午节后首日）：3只升级（光迅科技存疑→成立：35亿定增落地+涨停；源杰科技存疑→成立：2025年净利+3212%验证EML放量；永鼎股份存疑→成立：东部超导41亿长约实质订单），1只降级（英维克成立→存疑：Q1净利-82%+2连板跌停）。最值关注：①寒武纪字节大单小作文（公司已澄清不实）警示高位炒作风险；②中际旭创市值超茅台历史性节点；③英维克'增收不增利'液冷叙事首次重大考验。技术信号因网络限制保持2026-06-18数据，端午节后节点信号将在下次网络开放时刷新。",
  "signalDate": "2026-06-18",
  "signalStat": "多头 31 / 空头 2 · 左侧已到逢低区 5 · 右侧突破或临近 13（共 47 只，行情截至 2026-06-18，刷新于 2026-06-22；端午节假期6/19-6/21无交易日）"
};
`;
fs.writeFileSync(metaFile, metaContent, 'utf8');
console.log('✅ meta.js 写入完成');
