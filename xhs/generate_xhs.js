#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "xhs", "output");

function loadWindowData(file, key) {
  const fullPath = path.join(ROOT, file);
  const source = fs.readFileSync(fullPath, "utf8");
  const marker = `window.${key}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${file} 中未找到 ${marker}`);
  const eq = source.indexOf("=", start);
  if (eq === -1) throw new Error(`${file} 中 ${marker} 缺少赋值`);

  let i = eq + 1;
  while (/\s/.test(source[i] || "")) i += 1;
  const open = source[i];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) throw new Error(`${file} 中 ${marker} 不是 JSON 对象/数组`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(eq + 1, i + 1));
    }
  }
  throw new Error(`${file} 中 ${marker} JSON 未闭合`);
}

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[🚀🔥📊📈📉💰💸⚠️🟢🔴⭐]/g, "")
    .trim();
}

function truncate(text, max) {
  const value = clean(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function compactTheme(name) {
  return String(name || "")
    .replace(/产业链/g, "")
    .replace(/AI服务器/g, "AI")
    .replace(/算力租赁\/AI/g, "算力")
    .replace(/[()（）]/g, "")
    .split(/[·/]/)[0]
    .slice(0, 6);
}

function splitSentences(text, limit = 4) {
  return clean(text)
    .split(/[。；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => truncate(item, 54))
    .slice(0, limit);
}

function firstMatch(text, pattern) {
  const m = clean(text).match(pattern);
  return m ? m[0] : "";
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function extractQuotedFacts(text, limit = 5) {
  const value = clean(text);
  const facts = [];
  const patterns = [
    /[^。；;，,]*涨停[^。；;，,]*(?:成交[\d.]+亿)?[^。；;]*/g,
    /[^。；;，,]*(?:机构|深股通|龙虎榜)[^。；;，,]*(?:净买入|净卖出)[^。；;]*/g,
    /[^。；;，,]*(?:涨价|缺口|产能|供给|紧缺)[^。；;]*/g,
    /[^。；;，,]*(?:热度榜|成交)[^。；;，,]*[\d.]+亿[^。；;]*/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const fact = truncate(match[0].replace(/^[:：,，\s]+/, ""), 58);
      if (fact && fact.length >= 8) facts.push(fact);
    }
  }
  return uniq(facts).slice(0, limit);
}

function extractRiskFacts(text, limit = 4) {
  const value = clean(text);
  const riskWords = ["净卖出", "分歧", "追高", "回调", "净流出", "估值", "压制", "波动"];
  return uniq(
    value
      .split(/[。；;]/)
      .map((item) => item.trim())
      .filter((item) => riskWords.some((word) => item.includes(word)))
      .map((item) => truncate(item, 62))
  ).slice(0, limit);
}

function chainMetrics(chain) {
  const text = clean(`${chain.logic} ${chain.bottleneck}`);
  return {
    limitUps: (text.match(/涨停/g) || []).length,
    turnoverMax: firstMatch(text, /成交[\d.]+亿/),
    instBuy: firstMatch(text, /机构[^。；,，]*净买入[^。；]*/),
    instSell: firstMatch(text, /机构[^。；,，]*净卖出[^。；]*/),
    shortage: firstMatch(text, /缺口[\d.]+万片|缺口[\d.]+%|缺口[\d.]+/),
    priceHike: firstMatch(text, /涨价[^。；,，]*[\d.]+%/),
  };
}

function segmentLine(seg) {
  const label = String(seg.stage || "").replace(/上游·|中游·|下游·/g, "");
  const supply = truncate(seg.supply || seg.products || "", 40);
  const names = (seg.stocks || []).map((s) => s.name).filter(Boolean).slice(0, 2).join("/");
  return `${label}｜${supply}${names ? `｜${names}` : ""}`;
}

function stockFactsFromSegments(segments, limit = 5) {
  const facts = [];
  for (const seg of segments || []) {
    for (const stock of seg.stocks || []) {
      if (!stock.name || !stock.role) continue;
      facts.push(`${stock.name}：${truncate(stock.role, 52)}`);
    }
  }
  return uniq(facts).slice(0, limit);
}

function scoreChain(chain) {
  const text = `${chain.name} ${chain.logic} ${chain.bottleneck}`;
  let score = 0;
  for (const word of ["涨停", "20cm", "最强", "爆发", "紧缺", "涨价", "主线", "高景气"]) {
    score += (text.match(new RegExp(word, "g")) || []).length * 3;
  }
  for (const word of ["风险", "分歧", "回调", "减弱", "反噬", "流出"]) {
    score += (text.match(new RegExp(word, "g")) || []).length;
  }
  return score;
}

function pickTopic(logic, materials) {
  const chains = Array.isArray(logic.chains) ? logic.chains : [];
  const rankedChains = chains
    .map((chain) => ({ type: "chain", score: scoreChain(chain), item: chain }))
    .sort((a, b) => b.score - a.score);

  const directions = Array.isArray(materials.directions) ? materials.directions : [];
  const rankedMaterials = directions
    .map((item) => ({
      type: "material",
      score: item.intensity === "强" ? 12 : item.intensity === "中强" ? 8 : 4,
      item,
    }))
    .sort((a, b) => b.score - a.score);

  const bestChain = rankedChains[0];
  const bestMaterial = rankedMaterials[0];

  if (bestChain && (!bestMaterial || bestChain.score >= bestMaterial.score)) return bestChain;
  return bestMaterial || bestChain;
}

function stockNamesFromSegments(segments) {
  const names = [];
  for (const seg of segments || []) {
    for (const stock of seg.stocks || []) {
      if (stock.name && !names.includes(stock.name)) names.push(stock.name);
    }
  }
  return names.slice(0, 6);
}

function shortThemeName(name) {
  if (name.includes("算力")) return "算力主线";
  if (name.includes("半导体")) return "半导体主线";
  if (name.includes("光")) return "光通信主线";
  if (name.includes("存储")) return "存储芯片";
  return name.split(/[·/]/)[0].slice(0, 8);
}

function buildFromChain(topic, logic) {
  const chain = topic.item;
  const name = chain.name.replace(/产业链$/, "");
  const compactName = compactTheme(name);
  const metrics = chainMetrics(chain);
  const risks = extractRiskFacts(chain.bottleneck, 4);
  const segments = (chain.segments || []).slice(0, 4);
  const evidence = [
    ...stockFactsFromSegments(segments, 5),
    ...extractQuotedFacts(chain.logic, 3),
  ].slice(0, 5);
  const stocks = stockNamesFromSegments(chain.segments);
  const mainRisk = risks[0] || "短线热度已经抬高，次日最怕高开后承接不足。";
  const verdict = metrics.instSell ? "强主线里有分歧，明天先看承接质量" : "强主线成立，明天看扩散和放量承接";

  return {
    date: logic.date,
    theme: name,
    angle: "产业链主线",
    titles: [
      `${compactName}盘后拆解：强在哪，弱在哪`,
      `${compactName}不是一句“主线”就够了`,
      `${compactName}明天只看这张验证表`,
      `${compactName}涨停潮背后的分歧点`,
      `${compactName}产业链传导路径`,
    ],
    cover: {
      headline: `${compactName}盘后拆解`,
      subline: verdict,
      tags: [
        metrics.turnoverMax || `${metrics.limitUps}处涨停信号`,
        metrics.priceHike || metrics.shortage || "产业链验证",
        "非荐股",
      ].filter(Boolean),
    },
    slides: [
      {
        title: "结论先放前面",
        label: "01 结论",
        verdict,
        bullets: [
          `${name}今天不是单点异动，而是产业链多个环节同时被资金定价。`,
          evidence[0] || `${stocks.slice(0, 4).join("、")}成为盘面观察样本。`,
          mainRisk,
        ].filter(Boolean),
      },
      {
        title: "盘面证据",
        label: "02 证据",
        verdict: "只看可回溯的事实，不讲情绪形容词",
        bullets: evidence.slice(0, 4),
      },
      {
        title: "产业链传导路径",
        label: "03 链条",
        verdict: "真正的强度，看能不能从个股扩到环节",
        bullets: segments.map(segmentLine),
      },
      {
        title: "明天的验证表",
        label: "04 验证",
        verdict: "不是猜涨跌，是看资金是否继续承认这条线",
        bullets: [
          "前排高开后不能只冲一波，至少要有换手后的回封或横住。",
          "中后排不能大面积掉队，否则就是前排抱团而非板块主线。",
          "指数弱震时仍有主动买盘，才说明资金把它当避风方向。",
          metrics.instBuy || "龙虎榜如果继续出现机构净买入，持续性会更好。",
        ],
      },
      {
        title: "风险点别省略",
        label: "05 风险",
        verdict: "最容易亏钱的位置，通常在一致之后",
        bullets: [
          ...risks,
          "如果只剩标题热度，没有成交承接，次日很容易从主线变成兑现。",
        ].filter(Boolean).slice(0, 4),
      },
    ],
    caption: [
      `${name}今天值得单独拆，不是因为“热”，而是因为它同时出现了产业逻辑、资金动作和风险分歧。`,
      "",
      `我会先看事实：${evidence.slice(0, 2).join("；") || "产业链多环节出现资金反馈"}`,
      "",
      "明天不急着下判断，只盯三件事：",
      "1. 前排换手后能不能继续横住。",
      "2. 资金有没有从少数个股扩散到上下游。",
      "3. 分歧票会不会拖累整条线的风险偏好。",
      "",
      `我最警惕的是：${mainRisk}`,
      "",
      "仅做市场复盘和题材观察，不构成投资建议。",
    ].join("\n"),
    hashtags: ["A股", "盘后复盘", compactName, "产业链", "题材观察"],
    comment: `你觉得${compactName}这次是阶段主线，还是一致后的短线兑现？`,
  };
}

function buildFromMaterial(topic, materials) {
  const item = topic.item;
  const name = item.name;
  const compactName = compactTheme(name);
  const driverFacts = splitSentences(item.driver, 4);
  const supplyFacts = splitSentences(item.supply, 4);
  const riskFacts = splitSentences(item.risk, 4);
  return {
    date: materials.date,
    theme: name,
    angle: "涨价逻辑",
    titles: [
      `${compactName}涨价线拆解`,
      `${compactName}先看传导，再看情绪`,
      `${compactName}涨价背后的供需表`,
      `${compactName}谁受益，谁只是蹭热度`,
      `${compactName}明天验证三件事`,
    ],
    cover: {
      headline: `${compactName}涨价线拆解`,
      subline: "价格只是表层，关键看供需和利润传导",
      tags: [item.intensity || "观察", truncate(item.price, 10) || "价格信号", "非荐股"],
    },
    slides: [
      { title: "事件本身", label: "01 事件", verdict: "先确认价格信号，不把传闻当结论", bullets: [truncate(item.price, 70), truncate(item.timing, 70)].filter(Boolean) },
      { title: "资金为什么会看", label: "02 驱动", verdict: "能炒的是供需，不是涨价两个字", bullets: driverFacts },
      { title: "供需硬度", label: "03 供需", verdict: "越靠近真实短缺，持续性越强", bullets: supplyFacts },
      { title: "传导路径", label: "04 传导", verdict: "下游能否接受涨价，决定利润弹性", bullets: splitSentences(item.downstream, 4) },
      { title: "风险点", label: "05 风险", verdict: "涨价线最怕证伪和一日游", bullets: riskFacts },
    ],
    caption: [
      `${name}今天值得单独看，不是因为“涨价”两个字，而是要拆供给、需求和传导。`,
      "",
      `当前价格线索：${truncate(item.price, 90)}`,
      "",
      "明天只验证三件事：",
      "1. 涨价是否继续被产业侧确认。",
      "2. 下游能不能接受，利润是否能留在相关环节。",
      "3. A股资金有没有从概念扩散到真正受益公司。",
      "",
      riskFacts[0] ? `最大风险：${riskFacts[0]}` : "最大风险：只有价格故事，没有成交承接。",
      "",
      "仅做市场复盘和题材观察，不构成投资建议。",
    ].join("\n"),
    hashtags: ["A股", "涨价逻辑", "盘后复盘", "题材观察", name.replace(/[()（）/]/g, "")],
    comment: `你觉得${compactName}这条涨价线能传导利润，还是只停留在题材热度？`,
  };
}

function toMarkdown(plan) {
  const slideText = plan.slides
    .map((slide, index) => {
      const bullets = slide.bullets.map((bullet) => `- ${bullet}`).join("\n");
      return `## 图${index + 1}：${slide.title}\n${bullets}`;
    })
    .join("\n\n");

  return `# 小红书发布稿 ${plan.date}

主题：${plan.theme}
角度：${plan.angle}

## 推荐标题
${plan.titles.map((title, index) => `${index + 1}. ${title}`).join("\n")}

## 封面
大字：${plan.cover.headline}
副标题：${plan.cover.subline}
标签：${plan.cover.tags.join(" / ")}

## 发布建议
发布时间：18:30-19:30
形式：6张图文卡片
口径：题材观察，不荐股

${slideText}

## 正文
${plan.caption}

## 标签
${plan.hashtags.map((tag) => `#${tag}`).join(" ")}

## 置顶评论
${plan.comment}
`;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toCardsHtml(plan) {
  const cards = [
    {
      kicker: plan.date,
      title: plan.cover.headline,
      subtitle: plan.cover.subline,
      bullets: plan.cover.tags,
      label: plan.angle || "盘后拆解",
      cover: true,
    },
    ...plan.slides.map((slide, index) => ({
      kicker: slide.label || `图 ${index + 1}`,
      label: slide.label || `图 ${index + 1}`,
      title: slide.title,
      subtitle: index === plan.slides.length - 1 ? "不荐股，只做复盘观察" : plan.theme,
      verdict: slide.verdict || "",
      bullets: slide.bullets,
    })),
  ];

  const cardHtml = cards
    .map((card, index) => {
      const bullets = card.bullets
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<section class="card ${card.cover ? "cover" : ""}">
  <div class="top">
    <span>${escapeHtml(card.kicker)}</span>
    <span>A股题材看板</span>
  </div>
  <div class="label">${escapeHtml(card.label || "观察")}</div>
  <h1>${escapeHtml(card.title)}</h1>
  ${card.cover ? `<p class="subtitle">${escapeHtml(card.subtitle)}</p>` : `<div class="verdict"><b>判断</b><span>${escapeHtml(card.verdict || card.subtitle)}</span></div>`}
  ${card.cover ? `<div class="coverbox"><small>这张卡只回答一个问题</small><strong>强弱是否落到了证据上？</strong></div>` : ""}
  <ul>${bullets}</ul>
  <div class="foot">
    <span>复盘 / 观察 / 风险</span>
    <span>${index + 1}/${cards.length}</span>
  </div>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plan.date)} 小红书卡片</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #101216;
  color: #f7f2e8;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.wrap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 24px;
  padding: 24px;
}
.card {
  width: 1080px;
  height: 1440px;
  max-width: 100%;
  aspect-ratio: 3 / 4;
  background: linear-gradient(180deg, #101216 0%, #1e2329 100%);
  border: 1px solid #343a40;
  padding: 76px 72px 64px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 80px rgba(0,0,0,.22);
  position: relative;
  overflow: hidden;
}
.card::before, .card::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 170px;
  background: rgba(255,255,255,.035);
}
.card::before { top: 0; border-bottom: 1px solid #343a40; }
.card::after { bottom: 0; height: 128px; border-top: 1px solid #343a40; }
.cover::before { height: 170px; }
.cover h1 {
  font-size: 104px;
  margin-top: 76px;
}
.top, .foot {
  display: flex;
  justify-content: space-between;
  color: #756f66;
  font-size: 28px;
  position: relative;
  z-index: 1;
}
.top { color: #f6f1e7; }
.foot { color: #f6f1e7; margin-top: auto; padding-top: 48px; }
.label {
  align-self: flex-start;
  margin-top: 112px;
  padding: 12px 24px;
  border-radius: 28px;
  background: #eadfce;
  color: #191714;
  font-size: 30px;
  position: relative;
  z-index: 1;
}
h1 {
  margin: 34px 0 32px;
  color: #f7f2e8;
  font-size: 70px;
  line-height: 1.2;
  letter-spacing: 0;
  position: relative;
  z-index: 1;
}
.subtitle {
  margin: 0 0 260px;
  color: #c9d0d6;
  font-size: 42px;
  line-height: 1.35;
  position: relative;
  z-index: 1;
}
.verdict {
  display: flex;
  align-items: center;
  gap: 34px;
  padding: 28px 38px;
  margin-bottom: 52px;
  border-radius: 18px;
  background: #11100e;
  color: #fff7ef;
  font-size: 42px;
  position: relative;
  z-index: 1;
}
.verdict b { color: #b88435; font-size: 28px; font-weight: 400; }
.coverbox {
  padding: 40px;
  border: 2px solid #343a40;
  border-radius: 22px;
  background: #f4efe4;
  display: grid;
  gap: 22px;
  margin-bottom: 52px;
  position: relative;
  z-index: 1;
}
.coverbox small { color: #756f66; font-size: 28px; }
.coverbox strong { font-size: 44px; font-weight: 400; }
.coverbox::after {
  content: "";
  display: block;
  height: 6px;
  background: #d9382f;
  margin-top: 20px;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 26px;
  position: relative;
  z-index: 1;
}
li {
  border: 2px solid #343a40;
  border-radius: 20px;
  background: #f4efe4;
  padding: 28px 34px;
  font-size: 38px;
  line-height: 1.45;
  color: #191714;
}
@media print {
  body { background: #fff; }
  .wrap { display: block; padding: 0; }
  .card { page-break-after: always; max-width: none; }
}
</style>
</head>
<body>
<main class="wrap">
${cardHtml}
</main>
</body>
</html>
`;
}

function main() {
  const logic = loadWindowData("logic.js", "LOGIC");
  const materials = loadWindowData("materials.js", "MATERIALS");
  const topic = pickTopic(logic, materials);
  if (!topic) throw new Error("没有找到可生成小红书内容的数据");

  const plan = topic.type === "material" ? buildFromMaterial(topic, materials) : buildFromChain(topic, logic);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const date = plan.date || new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `${date}-xhs.json`);
  const mdPath = path.join(OUT_DIR, `${date}-xhs.md`);
  const htmlPath = path.join(OUT_DIR, `${date}-cards.html`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(mdPath, toMarkdown(plan));
  fs.writeFileSync(htmlPath, toCardsHtml(plan));

  console.log(`已生成：${mdPath}`);
  console.log(`已生成：${jsonPath}`);
  console.log(`已生成：${htmlPath}`);
  console.log(`推荐标题：${plan.titles[0]}`);
}

main();
