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
  const shortName = shortThemeName(name);
  const compactName = compactTheme(name);
  const logicPoints = splitSentences(chain.logic, 5);
  const riskPoints = splitSentences(chain.bottleneck, 4);
  const segments = (chain.segments || []).slice(0, 4);
  const stocks = stockNamesFromSegments(chain.segments);

  return {
    date: logic.date,
    theme: name,
    angle: "产业链主线",
    titles: [
      `${compactName}明天别急追`,
      `这条主线，明天看承接`,
      `${compactName}强不强，看这3点`,
      `别只看涨停，看资金态度`,
      `盘后复盘：资金在押哪里`,
    ],
    cover: {
      headline: `${compactName}明天别急追`,
      subline: "真正要看的，是资金还愿不愿意接",
      tags: ["盘后复盘", "主线观察", "不荐股"],
    },
    slides: [
      {
        title: "今天为什么拎它出来",
        label: "01 主线",
        verdict: "强，但不是无脑强",
        bullets: [
          "盘面里最有辨识度的不是单个涨停，而是科技线的集体反馈。",
          `${name}今天有资金共振，已经从个股行情变成主线观察。`,
          "明天的重点不是继续喊强，而是看有没有承接。",
        ].filter(Boolean),
      },
      {
        title: "资金在买什么预期",
        label: "02 催化",
        verdict: "买的是供需紧和国产替代",
        bullets: [
          "AI大模型继续推高算力、服务器、IDC、光通信关注度。",
          "国产算力、超节点、服务器订单，是这条线的叙事核心。",
          stocks.length ? `样本只用来观察强弱：${stocks.slice(0, 4).join("、")}` : "只观察扩散和承接，不做个股推荐。",
        ],
      },
      {
        title: "一张图看产业链",
        label: "03 路径",
        verdict: "强弱会沿链条扩散",
        bullets: segments.map((seg) => `${seg.stage.replace(/中游·|上游·|下游·/g, "")}：${truncate(seg.supply || seg.products, 32)}`),
      },
      {
        title: "明天只看3个信号",
        label: "04 验证",
        verdict: "满足越多，持续性越好",
        bullets: [
          "龙头高开后能不能稳住，而不是冲高回落。",
          "资金有没有从少数个股扩散到上下游。",
          "指数震荡时，这条线还能不能主动承接。",
        ],
      },
      {
        title: "最容易踩的坑",
        label: "05 风险",
        verdict: "热度越高，越要防分歧",
        bullets: [
          "短期涨幅过快，次日最容易出现冲高分歧。",
          riskPoints.find((item) => item.includes("分歧")) || riskPoints[0],
          "如果指数继续走弱，题材承接也会被一起压制。",
        ].filter(Boolean).slice(0, 3),
      },
    ],
    caption: [
      `今天盘后我会把${name}单独拎出来，但不是让你明天直接追。`,
      "",
      "小红书这篇只讲一个判断框架：热度已经出来了，接下来真正重要的是“承接”。",
      "",
      "明天我重点看3个细节：",
      "1. 龙头高开后能不能稳住。",
      "2. 板块有没有继续扩散，而不是只剩几个前排。",
      "3. 指数震荡时，资金还愿不愿意留在这条线。",
      "",
      "如果三个都弱，就别被情绪带着走；如果承接继续强，再看它能不能从题材变成阶段主线。",
      "",
      "仅做市场复盘和题材观察，不构成投资建议。",
    ].join("\n"),
    hashtags: ["A股", "股市复盘", "盘后复盘", "题材观察", "投资需谨慎"],
    comment: `你觉得${compactName}明天是继续承接，还是先冲高分歧？`,
  };
}

function buildFromMaterial(topic, materials) {
  const item = topic.item;
  const name = item.name;
  return {
    date: materials.date,
    theme: name,
    angle: "涨价逻辑",
    titles: [
      `${compactTheme(name)}涨价别只看热闹`,
      `这条涨价线，明天看承接`,
      `涨价题材强不强，看这3点`,
      `别只看涨价，看谁能受益`,
      `盘后复盘：涨价线怎么跟`,
    ],
    cover: {
      headline: `${compactTheme(name)}涨价别只看热闹`,
      subline: "价格只是表面，关键是能不能传导",
      tags: [item.intensity || "观察", "涨价线", "不荐股"],
    },
    slides: [
      { title: "今天发生了什么", label: "01 事件", verdict: "先看催化真假", bullets: [truncate(item.price, 80), truncate(item.timing, 80)] },
      { title: "资金为什么会看", label: "02 驱动", verdict: "不是所有涨价都能炒", bullets: splitSentences(item.driver, 4) },
      { title: "供需是不是够硬", label: "03 供需", verdict: "紧缺比涨价更重要", bullets: splitSentences(item.supply, 3) },
      { title: "可能扩散到哪里", label: "04 传导", verdict: "看下游是否能接受", bullets: splitSentences(item.downstream, 3) },
      { title: "最容易踩的坑", label: "05 风险", verdict: "防一日游和兑现", bullets: splitSentences(item.risk, 4) },
    ],
    caption: [
      `今天涨价线里，${name}值得单独看一眼。`,
      "",
      "涨价题材不能只看价格涨了多少，还要看三个问题：",
      "1. 是供给紧缺，还是短期事件刺激？",
      "2. 下游能不能接受涨价？",
      "3. A股相关方向有没有资金扩散？",
      "",
      "明天如果继续发酵，我会重点看板块扩散和成交承接。",
      "",
      "仅做市场复盘和题材观察，不构成投资建议。",
    ].join("\n"),
    hashtags: ["A股", "涨价逻辑", "股市复盘", "题材观察", name.replace(/[()（）/]/g, "")],
    comment: `你觉得${name}这条涨价线有持续性吗？还是偏一日游？`,
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
      label: "明天别急追",
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
  ${card.cover ? `<div class="coverbox"><small>今天这篇只看一件事</small><strong>热度出来以后，资金还接不接？</strong></div>` : ""}
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
  background: #11100e;
  color: #191714;
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
  background: #f6f1e7;
  border: 1px solid #d8cbbb;
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
  background: #11100e;
}
.card::before { top: 0; }
.card::after { bottom: 0; height: 128px; }
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
  color: #191714;
  font-size: 70px;
  line-height: 1.2;
  letter-spacing: 0;
  position: relative;
  z-index: 1;
}
.subtitle {
  margin: 0 0 260px;
  color: #756f66;
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
  border: 2px solid #d8cbbb;
  border-radius: 22px;
  background: #fffaf2;
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
  border: 2px solid #d8cbbb;
  border-radius: 20px;
  background: #fffaf2;
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
