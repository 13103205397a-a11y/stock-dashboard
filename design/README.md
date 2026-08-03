# 暖色研究台设计稿

高保真单文件视觉基准，对照移植回现网（`warm-desk.css` + `app.js` / `app_ai_modules.js`）。

## 打开

```bash
# 仓库根目录
python3 -m http.server 8791
# 浏览器打开
# http://127.0.0.1:8791/design/index.html
```

## 重建

```bash
node design/build.mjs
```

`seed-data.json` 从当时项目样本数据抽出；现网数据以根目录 `*.js` 为准。
