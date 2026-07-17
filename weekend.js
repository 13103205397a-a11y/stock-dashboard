/* 周末发酵数据
 * 时点: 2026-07-17
 * 仅供研究参考，非投资建议。
 */
window.WEEKEND = {
  "weekendDate": "2026-07-18",
  "generatedAt": "2026-07-17 16:35",
  "summary": "本周以7/17 科技股崩跌收官。周末焦点：美股周五表现与AI资本开支叙事是否继续恶化；周一A股大概率低开博弈，优先风控与观察止跌信号，不预判V反。",
  "hotspots": [
    {
      "title": "全球科技去杠杆是否延续",
      "category": "海外/流动性",
      "fermentLevel": "高",
      "signalType": "风险",
      "event": "韩国去杠杆与AI CapEx质疑引发的全球科技抛售，周五A股已剧烈映射。",
      "impactSectors": [
        "电子",
        "通信",
        "计算机",
        "创业板"
      ],
      "impactStocks": [
        {
          "code": "300308",
          "name": "中际旭创"
        },
        {
          "code": "000977",
          "name": "浪潮信息"
        },
        {
          "code": "300136",
          "name": "信维通信"
        }
      ],
      "interpretation": "若美股周五继续大跌，周一A股修复难度大；若美股企稳，才有超跌反弹交易环境。",
      "falsifyRisk": "海外情绪快速修复则A股可能低开高走，空头回补。",
      "mondayStrategy": "看外盘与开盘30分钟量价：弱则继续降杠杆，强则只做反抽不追高。"
    },
    {
      "title": "产业涨价逻辑是否被市场抛弃",
      "category": "产业",
      "fermentLevel": "中高",
      "signalType": "分歧",
      "event": "存储/MLCC等涨价事实仍在，但股价连续杀估值。",
      "impactSectors": [
        "存储",
        "被动元件",
        "半导体"
      ],
      "impactStocks": [
        {
          "code": "603986",
          "name": "兆易创新"
        },
        {
          "code": "001309",
          "name": "德明利"
        }
      ],
      "interpretation": "周末研究应把「产业跟踪清单」与「交易仓位」拆开。",
      "falsifyRisk": "若出现产业侧降价/砍单硬证据，则不只是交易问题。",
      "mondayStrategy": "无产业新利空时，不在跌停板情绪里做空产业逻辑；但也绝不轻易抄底。"
    },
    {
      "title": "防御风格能否延续",
      "category": "风格",
      "fermentLevel": "中",
      "signalType": "机会/观察",
      "event": "电力/银行等承接部分资金。",
      "impactSectors": [
        "电力",
        "银行",
        "医药"
      ],
      "impactStocks": [
        {
          "code": "600744",
          "name": "华银电力"
        }
      ],
      "interpretation": "更像避险而非新牛市主线。",
      "falsifyRisk": "科技股若暴力反弹，防御会立刻失血。",
      "mondayStrategy": "防御仓作波动缓冲，不作为进攻主仓。"
    },
    {
      "title": "持仓股深跌后的仓位与纪律",
      "category": "持仓",
      "fermentLevel": "高",
      "signalType": "风控",
      "event": "信维通信约-12%，浪潮信息约-9%，均受科技贝塔拖累。",
      "impactSectors": [
        "消费电子",
        "AI服务器"
      ],
      "impactStocks": [
        {
          "code": "300136",
          "name": "信维通信"
        },
        {
          "code": "000977",
          "name": "浪潮信息"
        }
      ],
      "interpretation": "优先检查杠杆、单票仓位上限与止损条件，而不是寻找「叙事安慰」。",
      "falsifyRisk": "若公司出现单独基本面利空（订单/减持/监管），需单独处理。",
      "mondayStrategy": "预设：跌破关键位减仓；仅在止跌K线+量能萎缩后考虑小仓试错。"
    }
  ],
  "scenario": {
    "openForecast": "周一大概率受外盘影响低开或高波动开局；若美股企稳则可能出现超跌反抽，但趋势修复需要时间。",
    "watchlist": [
      {
        "code": "300136",
        "name": "信维通信",
        "reason": "持仓+深跌至左侧区",
        "confirmSignal": "放量长下影或止跌平台+大盘企稳",
        "falsifySignal": "继续无量阴跌或跌破前低加速"
      },
      {
        "code": "000977",
        "name": "浪潮信息",
        "reason": "持仓+AI服务器贝塔",
        "confirmSignal": "美股科技反弹+个股止跌",
        "falsifySignal": "服务器链继续跌停潮"
      },
      {
        "code": "300308",
        "name": "中际旭创",
        "reason": "主线情绪温度计",
        "confirmSignal": "高位股止跌且未现连续跌停",
        "falsifySignal": "继续跌停或开板即砸"
      }
    ],
    "chaseList": [
      "任何高位算力连板/反包情绪票（今日环境不适合追）"
    ],
    "avoidList": [
      "跌停敢死队式抄底",
      "加杠杆摊平",
      "忽视外盘的盲目抄底"
    ]
  },
  "noiseFilter": "过滤「明天必反」口号式小作文；关注外盘期货、两市跌停家数、算力龙头开板情况等可验证信号。过滤把中报预喜直接等同于短期必涨的线性外推。"
};
