// 股市看板 · 原生 Mac App
// 毛玻璃窗口 + 跟随系统深浅色 + file:// 加载本地看板

import Cocoa
import WebKit
import Foundation

// 项目根目录：优先环境变量 STOCK_DASHBOARD_DIR，否则用默认值（换机器时设环境变量覆盖）
let PROJECT = ProcessInfo.processInfo.environment["STOCK_DASHBOARD_DIR"]
    ?? "/Users/Admin/Documents/开发项目/股市看板"

// 毛玻璃视图子类:允许鼠标拖拽穿透到窗口(解决拖不动问题)
class VisualEffectView: NSVisualEffectView {
    override var mouseDownCanMoveWindow: Bool { true }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow?
    var webView: WKWebView!
    var statusItem: NSStatusItem?
    var refreshProcesses: [Process] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 1. 创建窗口(毛玻璃:NSVisualEffectView)
        let contentRect = NSRect(x: 0, y: 0, width: 1280, height: 860)
        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window?.title = "股市看板"
        window?.titlebarAppearsTransparent = true
        window?.titleVisibility = .hidden
        window?.isMovableByWindowBackground = true
        window?.center()
        window?.minSize = NSSize(width: 800, height: 600)

        // 2. 毛玻璃背景层(NSVisualEffectView)
        let visualEffect = VisualEffectView()
        visualEffect.blendingMode = .behindWindow
        visualEffect.material = .sidebar  // 跟随系统深浅色
        visualEffect.state = .active
        visualEffect.autoresizingMask = [.width, .height]
        window?.contentView = visualEffect

        // 3. WKWebView(透明,让毛玻璃透出来)
        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        userContentController.add(self, name: "appBridge")
        config.userContentController = userContentController
        webView = WKWebView(frame: visualEffect.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")  // 透明
        visualEffect.addSubview(webView)

        window?.makeKeyAndOrderFront(nil)

        // 4. 加载本地看板
        let indexPath = PROJECT + "/index.html"
        webView.loadFileURL(URL(fileURLWithPath: indexPath),
                            allowingReadAccessTo: URL(fileURLWithPath: PROJECT))

        // 5. 监听系统深浅色变化
        DistributedNotificationCenter.default.addObserver(
            self, selector: #selector(systemAppearanceChanged),
            name: NSNotification.Name("AppleInterfaceThemeChangedNotification"), object: nil)

        // 6. 状态栏图标
        setupStatusItem()
    }

    // ── 深浅色切换 ──
    @objc func systemAppearanceChanged() {
        let theme = isDarkMode() ? "dark" : "light"
        webView.evaluateJavaScript(
            "document.documentElement.setAttribute('data-theme','\(theme)');", completionHandler: nil)
    }

    func isDarkMode() -> Bool {
        let appearance = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
        return appearance == .darkAqua
    }

    // ── 状态栏 ──
    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "📊"
        let menu = NSMenu()
        menu.addItem(withTitle: "刷新数据", action: #selector(refreshData), keyEquivalent: "r")
        menu.addItem(withTitle: "重新加载页面", action: #selector(reloadPage), keyEquivalent: "R")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "退出看板", action: #selector(quitApp), keyEquivalent: "q")
        statusItem?.menu = menu
    }

    // ── 刷新数据(带进度反馈) ──
    @objc func refreshData() {
        if !refreshProcesses.isEmpty { return }
        webView.evaluateJavaScript(
            "document.getElementById('refresh-overlay')?.remove();document.body.insertAdjacentHTML('beforeend','<div id=\"refresh-overlay\" style=\"position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-family:sans-serif\">🔄 刷新中… <span id=\"refresh-step\"></span></div>');",
            completionHandler: nil)

        DispatchQueue.global().async {
            let env = self.getEnvWithIwencai()
            let task = Process()
            task.launchPath = "/usr/bin/env"
            task.arguments = ["python3", "scripts/run_refresh.py"]
            task.currentDirectoryPath = PROJECT
            task.environment = env
            let pipe = Pipe()
            task.standardOutput = pipe
            task.standardError = pipe
            pipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard data.count > 0,
                      let text = String(data: data, encoding: .utf8) else { return }
                let line = text.split(separator: "\n").last.map(String.init) ?? text
                DispatchQueue.main.async {
                    self.setRefreshStep(line)
                }
            }
            do {
                try task.run()
                self.refreshProcesses.append(task)
                task.waitUntilExit()
            } catch {
                DispatchQueue.main.async {
                    self.setRefreshStep("刷新启动失败")
                }
            }
            pipe.fileHandleForReading.readabilityHandler = nil
            self.refreshProcesses.removeAll { $0 == task }
            DispatchQueue.main.async {
                self.webView.reload()
            }
        }
    }

    func setRefreshStep(_ text: String) {
        let literal = jsString("· " + text)
        webView.evaluateJavaScript(
            "var el=document.getElementById('refresh-step');if(el)el.textContent=\(literal);",
            completionHandler: nil)
    }

    func jsString(_ text: String) -> String {
        var out = "\""
        for ch in text {
            switch ch {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.append(ch)
            }
        }
        out += "\""
        return out
    }

    func getEnvWithIwencai() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        if env["IWENCAI_API_KEY"] != nil { return env }
        let account = env["IWENCAI_KEYCHAIN_ACCOUNT"] ?? "Admin"
        let task = Process()
        task.launchPath = "/usr/bin/security"
        task.arguments = ["find-generic-password", "-a", account, "-s", "iwencai-api-key", "-w"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        do { try task.run(); task.waitUntilExit() }
        catch { return env }
        let key = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !key.isEmpty { env["IWENCAI_API_KEY"] = key }
        return env
    }

    @objc func reloadPage() { webView.reload() }

    @objc func quitApp() {
        refreshProcesses.forEach { $0.terminate() }
        NSApplication.shared.terminate(nil)
    }

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        if message.name == "appBridge", let body = message.body as? String, body == "refresh" {
            refreshData()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("✓ 看板加载完成")
        systemAppearanceChanged()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        refreshProcesses.forEach { $0.terminate() }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
