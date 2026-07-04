#!/bin/bash
# 构建 Mac 原生 App
# 用法: bash app/build.sh

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(dirname "$HERE")"
APP="$PROJ/股市看板.app"

echo "▶ 编译 Swift..."
swiftc "$HERE/main.swift" -o "$HERE/stock-dashboard" \
    -framework Cocoa -framework WebKit 2>&1 | grep -v "javaScriptEnabled.*deprecated" || true

echo "▶ 构建 .app 包..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$HERE/stock-dashboard" "$APP/Contents/MacOS/股市看板"
chmod +x "$APP/Contents/MacOS/股市看板"

# 复制图标
if [ -f "$HERE/icon_assets/AppIcon.icns" ]; then
  cp "$HERE/icon_assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
  echo "▶ 图标已嵌入"
else
  echo "⚠ 未找到 AppIcon.icns，跳过图标（运行 python3 app/gen_logo.py 生成）"
fi

cat > "$APP/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>股市看板</string>
    <key>CFBundleDisplayName</key><string>股市看板</string>
    <key>CFBundleIdentifier</key><string>com.local.stock-dashboard</string>
    <key>CFBundleVersion</key><string>1.0</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleExecutable</key><string>股市看板</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF

echo "✓ 构建完成: $APP"
echo "双击启动,或运行: open \"$APP\""
