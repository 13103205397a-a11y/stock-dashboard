#!/usr/bin/env bash
# 拉取全部自选股日K(腾讯行情,前复权)到 scripts/raw/<code>.json
# 用法： bash scripts/fetch_klines.sh
# 数据源：web.ifzq.gtimg.cn（公开行情）。仅供研究参考，非投资建议。
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
RAW="$DIR/raw"
mkdir -p "$RAW"

# 从 data.js 读取代码列表（解析失败或为空则中止，避免空列表静默"成功"后用旧K线继续）
CODES=$(node -e 'global.window={};require("'"$DIR"'/../data.js");console.log(window.STOCKS.map(s=>s.code).join(" "))') \
  || { echo "✗ 读取 data.js 失败，中止抓取。" >&2; exit 1; }
CODE_COUNT=$(printf '%s' "$CODES" | wc -w | tr -d ' ')
if [ "${CODE_COUNT:-0}" -lt 1 ]; then
  echo "✗ 从 data.js 解析出 0 个股票代码，中止（不会用旧K线静默继续）。" >&2
  exit 1
fi

# 清理已不在自选列表的旧K线缓存（删股后残留无意义，避免误用陈旧数据）
removed=0
for f in "$RAW"/*.json; do
  [ -e "$f" ] || continue
  c=$(basename "$f" .json)
  case " $CODES " in *" $c "*) ;; *) rm -f "$f"; removed=$((removed+1));; esac
done
[ "$removed" -gt 0 ] && echo "清理 $removed 个已删股票的旧K线缓存"

ok=0; fail=""
for code in $CODES; do
  case "$code" in 6*) m="sh";; 8*|4*) m="bj";; *) m="sz";; esac
  url="https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${m}${code},day,,,330,qfq"
  # --retry 3: 网络抖动自动重试 3 次；--retry-delay 1: 每次间隔 1s
  curl -s --max-time 18 --retry 3 --retry-delay 1 --retry-connrefused \
    -H "User-Agent: Mozilla/5.0" "$url" -o "$RAW/${code}.json"
  rows=$(node -e "try{const j=require('$RAW/${code}.json');const d=j.data['${m}${code}'];const k=d.qfqday||d.day;process.stdout.write(String(k?k.length:0))}catch(e){process.stdout.write('0')}")
  if [ "${rows:-0}" -ge 20 ] 2>/dev/null; then ok=$((ok+1)); else fail="$fail ${code}(${rows})"; fi
  sleep 0.3
done
echo "K线抓取完成：$ok 只成功"
if [ -n "$fail" ]; then
  echo "✗ 数据不足：$fail；保留对应旧缓存，但本次抓取标记失败。" >&2
  exit 1
fi
exit 0
