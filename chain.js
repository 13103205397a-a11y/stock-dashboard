/* 产业链涨价数据：供需紧张/涨价方向 + 卡脖子 + 产业链逻辑
 * 由 Hermes Agent 每日盘后分析生成（见 agent/chain-radar.md，阶段5期B启用）
 * 统一模型：directions[]{name,category,chain,driver_type[],bottleneck,price_signal,driver,supply,evidence?,downstream?,stocks[],risk,intensity,asof}
 * 过渡期本文件为空壳(null)，看板自动用旧 industry.js + materials.js 兼容映射渲染。
 * 仅供研究参考，非投资建议。
 */
window.CHAIN = null;
