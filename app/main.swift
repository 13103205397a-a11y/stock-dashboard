// 股市看板 · 原生 Mac App
// 毛玻璃窗口 + 跟随系统深浅色 + 本地 API 服务
// 菜单栏：CodexBar 式「外围热点」点开即读

import Cocoa
import WebKit
import Foundation

// 项目根目录：优先环境变量 STOCK_DASHBOARD_DIR，否则用默认值（换机器时设环境变量覆盖）
let PROJECT = ProcessInfo.processInfo.environment["STOCK_DASHBOARD_DIR"]
    ?? "/Users/Admin/Projects/股市看板"
let DASHBOARD_APP_ID = "stock-dashboard"
let DASHBOARD_API_VERSION = 1
let XBRIEF_STALE_HOURS: TimeInterval = 26 * 3600
let XBRIEF_POLL_INTERVAL: TimeInterval = 60

struct DashboardServerStatus: Decodable {
    let appId: String
    let apiVersion: Int
    let running: Bool
    let log: [String]
    let done: Bool
    let error: String?
    let failedSteps: [String]
}

struct XBriefLatestItem: Decodable {
    let id: String?
    let time: String?
    let title: String?
    let content: String?
    let period: String?
    let aiCount: Int?
    let marketCount: Int?
}

struct XBriefLatestResponse: Decodable {
    let ok: Bool?
    let updated: String?
    let generatedAt: String?
    let latest: XBriefLatestItem?
}

// 毛玻璃视图子类:允许鼠标拖拽穿透到窗口(解决拖不动问题)
class VisualEffectView: NSVisualEffectView {
    override var mouseDownCanMoveWindow: Bool { true }
}

// MARK: - 菜单栏弹出层（系统菜单式紧凑阅读卡）

final class XBriefPopoverController: NSViewController {
    static let panelWidth: CGFloat = 380
    static let panelMaxHeight: CGFloat = 520
    static let panelMinHeight: CGFloat = 220

    private let titleLabel = NSTextField(labelWithString: "外围热点")
    private let timeLabel = NSTextField(labelWithString: "")
    private let staleDot = NSImageView()
    private let subtitleLabel = NSTextField(labelWithString: "")
    private let scrollView = NSScrollView()
    private let textView = NSTextView()
    private let refreshButton = NSButton()
    private let openButton = NSButton()
    private let moreButton = NSButton()
    private var heightConstraint: NSLayoutConstraint?

    var onOpenDashboard: (() -> Void)?
    var onRefresh: (() -> Void)?
    var onQuit: (() -> Void)?
    var onContentSizeChange: ((NSSize) -> Void)?

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: Self.panelWidth, height: 360))
        view = root

        titleLabel.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = .labelColor
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        timeLabel.font = NSFont.systemFont(ofSize: 12)
        timeLabel.textColor = .secondaryLabelColor
        timeLabel.alignment = .right
        timeLabel.setContentHuggingPriority(.required, for: .horizontal)

        let config = NSImage.SymbolConfiguration(pointSize: 7, weight: .bold)
        staleDot.image = NSImage(systemSymbolName: "circle.fill", accessibilityDescription: "过期")?
            .withSymbolConfiguration(config)
        staleDot.contentTintColor = .systemOrange
        staleDot.isHidden = true
        staleDot.toolTip = "超过3小时未更新"

        let timeRow = NSStackView(views: [staleDot, timeLabel])
        timeRow.orientation = .horizontal
        timeRow.spacing = 4
        timeRow.alignment = .centerY

        let headerRow = NSStackView(views: [titleLabel, NSView(), timeRow])
        headerRow.orientation = .horizontal
        headerRow.alignment = .centerY
        headerRow.spacing = 8
        headerRow.distribution = .fill

        subtitleLabel.font = NSFont.systemFont(ofSize: 11)
        subtitleLabel.textColor = .tertiaryLabelColor
        subtitleLabel.lineBreakMode = .byTruncatingTail
        subtitleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.textContainerInset = NSSize(width: 0, height: 2)
        textView.isRichText = true
        textView.font = NSFont.systemFont(ofSize: 13)
        textView.textColor = .labelColor
        if let container = textView.textContainer {
            container.lineFragmentPadding = 0
            container.widthTracksTextView = true
        }
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView
        scrollView.scrollerStyle = .overlay

        let headerSep = Self.separator()
        let footerSep = Self.separator()

        configureIconButton(refreshButton, symbol: "arrow.clockwise", tooltip: "刷新数据")
        refreshButton.target = self
        refreshButton.action = #selector(tapRefresh)

        openButton.bezelStyle = .inline
        openButton.isBordered = false
        openButton.font = NSFont.systemFont(ofSize: 12)
        openButton.contentTintColor = .labelColor
        openButton.image = NSImage(systemSymbolName: "chevron.right", accessibilityDescription: nil)
        openButton.imagePosition = .imageTrailing
        openButton.title = "打开看板"
        openButton.toolTip = "打开完整看板"
        openButton.target = self
        openButton.action = #selector(tapOpen)

        configureIconButton(moreButton, symbol: "ellipsis", tooltip: "更多")
        moreButton.target = self
        moreButton.action = #selector(tapMore(_:))

        let footer = NSStackView(views: [refreshButton, NSView(), openButton, moreButton])
        footer.orientation = .horizontal
        footer.alignment = .centerY
        footer.spacing = 6
        footer.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)

        let stack = NSStackView(views: [headerRow, subtitleLabel, headerSep, scrollView, footerSep, footer])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)

        let h = root.heightAnchor.constraint(equalToConstant: 360)
        heightConstraint = h

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -12),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -10),
            headerRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            subtitleLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            headerSep.widthAnchor.constraint(equalTo: stack.widthAnchor),
            footerSep.widthAnchor.constraint(equalTo: stack.widthAnchor),
            footer.widthAnchor.constraint(equalTo: stack.widthAnchor),
            headerSep.heightAnchor.constraint(equalToConstant: 1),
            footerSep.heightAnchor.constraint(equalToConstant: 1),
            footer.heightAnchor.constraint(equalToConstant: 28),
            scrollView.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 120),
            staleDot.widthAnchor.constraint(equalToConstant: 8),
            staleDot.heightAnchor.constraint(equalToConstant: 8),
            refreshButton.widthAnchor.constraint(equalToConstant: 24),
            refreshButton.heightAnchor.constraint(equalToConstant: 24),
            moreButton.widthAnchor.constraint(equalToConstant: 24),
            moreButton.heightAnchor.constraint(equalToConstant: 24),
            h,
        ])
    }

    func preferredContentSize() -> NSSize {
        view.layoutSubtreeIfNeeded()
        textView.layoutManager?.ensureLayout(for: textView.textContainer!)
        let textH = textView.layoutManager?.usedRect(for: textView.textContainer!).height ?? 120
        // 顶栏约 40 + 分隔/底栏约 50 + 留白 24 + 正文
        let chrome: CGFloat = 118
        let body = min(max(textH + 8, 120), Self.panelMaxHeight - chrome)
        let total = min(max(body + chrome, Self.panelMinHeight), Self.panelMaxHeight)
        return NSSize(width: Self.panelWidth, height: total)
    }

    func publishContentSize() {
        let size = preferredContentSize()
        heightConstraint?.constant = size.height
        onContentSizeChange?(size)
    }

    func showLoading() {
        titleLabel.stringValue = "外围热点"
        timeLabel.stringValue = ""
        staleDot.isHidden = true
        subtitleLabel.stringValue = "加载中…"
        setBody(Self.attributed("正在读取最新外围热点…", muted: true))
        publishContentSize()
    }

    func showUnavailable(_ message: String) {
        titleLabel.stringValue = "外围热点"
        timeLabel.stringValue = ""
        staleDot.isHidden = true
        subtitleLabel.stringValue = message
        setBody(Self.attributed("\(message)\n请先确保股市看板本地服务已启动。", muted: true))
        publishContentSize()
    }

    func showBrief(_ item: XBriefLatestItem, updated: String?, stale: Bool) {
        titleLabel.stringValue = (item.title?.isEmpty == false) ? (item.title ?? "外围热点") : "外围热点"
        let rawTime = (item.time?.isEmpty == false) ? item.time : updated
        timeLabel.stringValue = AppDelegate.shortTime(from: rawTime) ?? (rawTime ?? "")
        staleDot.isHidden = !stale

        var sub: [String] = []
        if let period = item.period, !period.isEmpty { sub.append(period) }
        if let ai = item.aiCount { sub.append("AI \(ai)") }
        if let mkt = item.marketCount { sub.append("财经 \(mkt)") }
        subtitleLabel.stringValue = sub.joined(separator: " · ")
        subtitleLabel.isHidden = sub.isEmpty

        setBody(Self.markdownToAttributed(item.content ?? ""))
        publishContentSize()
    }

    private func setBody(_ attr: NSAttributedString) {
        textView.textStorage?.setAttributedString(attr)
        textView.scrollToBeginningOfDocument(nil)
    }

    private func configureIconButton(_ button: NSButton, symbol: String, tooltip: String) {
        button.bezelStyle = .inline
        button.isBordered = false
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tooltip)
        button.imagePosition = .imageOnly
        button.contentTintColor = .secondaryLabelColor
        button.toolTip = tooltip
    }

    private static func separator() -> NSBox {
        let box = NSBox()
        box.boxType = .separator
        return box
    }

    @objc private func tapOpen() { onOpenDashboard?() }
    @objc private func tapRefresh() { onRefresh?() }

    @objc private func tapMore(_ sender: NSButton) {
        let menu = NSMenu()
        menu.addItem(withTitle: "打开看板", action: #selector(tapOpen), keyEquivalent: "")
        menu.addItem(withTitle: "刷新数据", action: #selector(tapRefresh), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        let quit = menu.addItem(withTitle: "退出看板", action: #selector(tapQuit), keyEquivalent: "q")
        quit.target = self
        for item in menu.items where item.action != #selector(tapQuit) {
            item.target = self
        }
        let loc = NSPoint(x: 0, y: sender.bounds.height + 2)
        menu.popUp(positioning: nil, at: loc, in: sender)
    }

    @objc private func tapQuit() { onQuit?() }

    private static func attributed(_ text: String, muted: Bool) -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = 1.4
        let font = NSFont.systemFont(ofSize: 13)
        let color: NSColor = muted ? .secondaryLabelColor : .labelColor
        return NSAttributedString(string: text, attributes: [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: style,
        ])
    }

    /// 轻量 Markdown → NSAttributedString（语义色，跟随系统深浅色）
    private static func markdownToAttributed(_ markdown: String) -> NSAttributedString {
        let trimmed = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return attributed("本期暂无正文", muted: true)
        }

        let out = NSMutableAttributedString()
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        let bodyFont = NSFont.systemFont(ofSize: 13)
        let headFont = NSFont.systemFont(ofSize: 13, weight: .semibold)
        let bodyStyle = NSMutableParagraphStyle()
        bodyStyle.lineHeightMultiple = 1.45
        bodyStyle.paragraphSpacing = 4
        let headStyle = NSMutableParagraphStyle()
        headStyle.lineHeightMultiple = 1.35
        headStyle.paragraphSpacingBefore = 10
        headStyle.paragraphSpacing = 4

        func appendParagraph(_ text: String, font: NSFont, style: NSParagraphStyle, color: NSColor = .labelColor) {
            var s = text
            if s.hasPrefix("- ") || s.hasPrefix("* ") {
                s = "• " + String(s.dropFirst(2))
            } else if let r = s.range(of: #"^\d+\.\s+"#, options: .regularExpression) {
                // keep number prefix
                _ = r
            }
            let chunk = NSMutableAttributedString(string: s + "\n", attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: style,
            ])
            applyBoldMarkers(chunk)
            out.append(chunk)
        }

        for raw in lines {
            let t = raw.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { continue }
            if t.hasPrefix("---") && t.unicodeScalars.allSatisfy({ $0 == "-" || $0 == " " }) {
                let hr = NSMutableParagraphStyle()
                hr.paragraphSpacingBefore = 6
                hr.paragraphSpacing = 6
                out.append(NSAttributedString(string: "────────\n", attributes: [
                    .font: NSFont.systemFont(ofSize: 9),
                    .foregroundColor: NSColor.tertiaryLabelColor,
                    .paragraphStyle: hr,
                ]))
                continue
            }
            if t.hasPrefix("### ") {
                appendParagraph(String(t.dropFirst(4)), font: headFont, style: headStyle)
                continue
            }
            if t.hasPrefix("## ") {
                appendParagraph(String(t.dropFirst(3)), font: headFont, style: headStyle)
                continue
            }
            if t.hasPrefix("# ") {
                appendParagraph(String(t.dropFirst(2)), font: headFont, style: headStyle)
                continue
            }
            appendParagraph(t, font: bodyFont, style: bodyStyle)
        }
        return out
    }

    private static func applyBoldMarkers(_ attr: NSMutableAttributedString) {
        guard let regex = try? NSRegularExpression(pattern: #"\*\*(.+?)\*\*"#, options: []) else { return }
        let full = attr.string as NSString
        let matches = regex.matches(in: attr.string, options: [], range: NSRange(location: 0, length: full.length)).reversed()
        for match in matches {
            guard match.numberOfRanges >= 2 else { continue }
            let inner = match.range(at: 1)
            let bold = NSFont.systemFont(ofSize: 13, weight: .semibold)
            attr.addAttribute(.font, value: bold, range: inner)
            // strip ** markers
            let close = NSRange(location: match.range.location + match.range.length - 2, length: 2)
            let open = NSRange(location: match.range.location, length: 2)
            attr.deleteCharacters(in: close)
            attr.deleteCharacters(in: open)
        }
    }
}

// MARK: - App

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSPopoverDelegate {
    var window: NSWindow?
    var webView: WKWebView!
    var statusItem: NSStatusItem?
    var refreshProcesses: [Process] = []
    var serverProcess: Process?
    var xbriefPopover: NSPopover?
    var xbriefController: XBriefPopoverController?
    var xbriefTimer: Timer?
    var latestBrief: XBriefLatestItem?
    var latestUpdated: String?
    var latestStale = false
    var serverAvailable = false

    func appEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let localBin = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin").path
        let entries = (env["PATH"] ?? "").split(separator: ":").map(String.init)
        if !entries.contains(localBin) {
            env["PATH"] = ([localBin] + entries).joined(separator: ":")
        }
        return env
    }

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

        // 4. 启动并核验本项目的本地 API 服务后再加载看板。
        startLocalServerAndLoad()

        // 5. 监听系统深浅色变化
        DistributedNotificationCenter.default.addObserver(
            self, selector: #selector(systemAppearanceChanged),
            name: NSNotification.Name("AppleInterfaceThemeChangedNotification"), object: nil)

        // 6. 状态栏：外围热点点开即读
        setupStatusItem()
        refreshXBriefStatus()
        xbriefTimer = Timer.scheduledTimer(withTimeInterval: XBRIEF_POLL_INTERVAL, repeats: true) { [weak self] _ in
            self?.refreshXBriefStatus()
        }
        if let timer = xbriefTimer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func serverIsReady() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8787/api/status") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.5
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let semaphore = DispatchSemaphore(value: 0)
        var ready = false
        URLSession.shared.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            guard error == nil,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let contentType = http.value(forHTTPHeaderField: "Content-Type")?
                    .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: true)
                    .first?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased(),
                  contentType == "application/json",
                  let data,
                  let status = try? JSONDecoder().decode(DashboardServerStatus.self, from: data),
                  status.appId == DASHBOARD_APP_ID,
                  status.apiVersion == DASHBOARD_API_VERSION else {
                return
            }
            ready = true
        }.resume()
        _ = semaphore.wait(timeout: .now() + 1)
        return ready
    }

    func startLocalServerAndLoad() {
        DispatchQueue.global(qos: .userInitiated).async {
            if !self.serverIsReady() {
                let task = Process()
                task.launchPath = "/usr/bin/env"
                task.arguments = ["python3", "app_server.py", "--no-open"]
                task.currentDirectoryPath = PROJECT
                task.environment = self.appEnvironment()
                task.standardOutput = FileHandle.nullDevice
                task.standardError = FileHandle.nullDevice
                do {
                    try task.run()
                    self.serverProcess = task
                } catch {
                    self.loadFileFallback("本地服务启动失败：\(error.localizedDescription)")
                    return
                }
                for _ in 0..<60 {
                    if self.serverIsReady() { break }
                    Thread.sleep(forTimeInterval: 0.1)
                }
            }
            guard self.serverIsReady(), let url = URL(string: "http://127.0.0.1:8787/index.html") else {
                self.loadFileFallback("本地服务未在规定时间内就绪")
                DispatchQueue.main.async { self.refreshXBriefStatus() }
                return
            }
            DispatchQueue.main.async {
                self.webView.load(URLRequest(url: url))
                self.refreshXBriefStatus()
            }
        }
    }

    func loadFileFallback(_ reason: String) {
        print("⚠ \(reason)，降级为只读文件模式")
        let indexPath = PROJECT + "/index.html"
        DispatchQueue.main.async {
            self.webView.loadFileURL(URL(fileURLWithPath: indexPath),
                                     allowingReadAccessTo: URL(fileURLWithPath: PROJECT))
            self.refreshXBriefStatus()
        }
    }

    // ── 深浅色切换 ──
    @objc func systemAppearanceChanged() {
        let theme = isDarkMode() ? "dark" : "light"
        webView.evaluateJavaScript(
            "document.documentElement.setAttribute('data-theme','\(theme)');", completionHandler: nil)
        // 弹出层用语义色，无需整页重渲
    }

    func isDarkMode() -> Bool {
        let appearance = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
        return appearance == .darkAqua
    }

    // ── 状态栏 ──
    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem?.button {
            button.title = "外围 —"
            button.toolTip = "外围热点（点击查看最新简报）"
            button.target = self
            button.action = #selector(toggleXBriefPopover(_:))
        }

        let controller = XBriefPopoverController()
        controller.onOpenDashboard = { [weak self] in
            self?.xbriefPopover?.performClose(nil)
            self?.showDashboardWindow()
        }
        controller.onRefresh = { [weak self] in
            // 刷新不关弹层，只触发看板刷新；简报本身随文件更新
            self?.showDashboardWindow()
            self?.refreshData()
        }
        controller.onQuit = { [weak self] in
            self?.quitApp()
        }
        controller.onContentSizeChange = { [weak self] size in
            self?.xbriefPopover?.contentSize = size
        }
        xbriefController = controller

        let popover = NSPopover()
        popover.contentSize = NSSize(width: XBriefPopoverController.panelWidth, height: 360)
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        popover.contentViewController = controller
        xbriefPopover = popover
    }

    @objc func toggleXBriefPopover(_ sender: Any?) {
        guard let popover = xbriefPopover, let button = statusItem?.button else { return }
        if popover.isShown {
            popover.performClose(sender)
            return
        }
        applyPopoverContent()
        refreshXBriefStatus()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applyPopoverContent() {
        guard let controller = xbriefController else { return }
        if !serverAvailable {
            controller.showUnavailable("本地服务未就绪")
            return
        }
        if let brief = latestBrief {
            controller.showBrief(brief, updated: latestUpdated, stale: latestStale)
        } else {
            controller.showUnavailable("暂无外围热点数据")
        }
    }

    func refreshXBriefStatus() {
        guard let url = URL(string: "http://127.0.0.1:8787/api/xbrief/latest") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            DispatchQueue.main.async {
                guard error == nil,
                      let http = response as? HTTPURLResponse,
                      http.statusCode == 200,
                      let data,
                      let payload = try? JSONDecoder().decode(XBriefLatestResponse.self, from: data)
                else {
                    self.serverAvailable = false
                    self.latestBrief = nil
                    self.latestUpdated = nil
                    self.latestStale = false
                    self.updateStatusItemTitle(timeText: nil, stale: false, available: false)
                    if self.xbriefPopover?.isShown == true {
                        self.applyPopoverContent()
                    }
                    return
                }
                self.serverAvailable = true
                self.latestBrief = payload.latest
                self.latestUpdated = payload.updated
                let timeText = payload.latest?.time ?? payload.updated
                let stale = Self.isStale(timeText: timeText)
                self.latestStale = stale
                self.updateStatusItemTitle(timeText: timeText, stale: stale, available: true)
                if self.xbriefPopover?.isShown == true {
                    self.applyPopoverContent()
                }
            }
        }.resume()
    }

    func updateStatusItemTitle(timeText: String?, stale: Bool, available: Bool) {
        guard let button = statusItem?.button else { return }
        if !available {
            button.title = "外围 —"
            button.contentTintColor = .secondaryLabelColor
            button.toolTip = "本地服务未就绪，打开股市看板后可查看外围热点"
            return
        }
        let hhmm = Self.shortTime(from: timeText)
        if let hhmm {
            button.title = stale ? "外围 \(hhmm)·旧" : "外围 \(hhmm)"
        } else {
            button.title = "外围 —"
        }
        button.contentTintColor = stale ? .systemOrange : nil
        button.toolTip = stale
            ? "外围热点已超过约26小时未更新（点击查看）"
            : "外围热点（点击查看最新简报）"
    }

    static func shortTime(from text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        // "2026-08-01 23:02" → "23:02"
        if text.count >= 16, text.contains(" ") {
            let part = text.split(separator: " ").last.map(String.init) ?? text
            if part.count >= 5 { return String(part.prefix(5)) }
        }
        if text.count >= 5, text.contains(":") {
            return String(text.suffix(5))
        }
        return text
    }

    static func isStale(timeText: String?) -> Bool {
        guard let timeText, let date = parseBriefDate(timeText) else { return false }
        return Date().timeIntervalSince(date) > XBRIEF_STALE_HOURS
    }

    static func parseBriefDate(_ text: String) -> Date? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let formats = ["yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy/MM/dd HH:mm"]
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        for format in formats {
            formatter.dateFormat = format
            if let date = formatter.date(from: trimmed) { return date }
        }
        return nil
    }

    func showDashboardWindow() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            // 跳到外围热点锚点（若页面已加载）
            webView.evaluateJavaScript(
                "if(location.hash!=='#xbrief'){location.hash='#xbrief';}else{location.hash='';location.hash='#xbrief';}",
                completionHandler: nil)
        }
    }

    // ── 刷新数据(带进度反馈) ──
    @objc func refreshData() {
        if !refreshProcesses.isEmpty { return }
        webView.evaluateJavaScript(
            "document.getElementById('refresh-overlay')?.remove();document.body.insertAdjacentHTML('beforeend','<div id=\"refresh-overlay\" style=\"position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-family:sans-serif\">🔄 刷新中… <span id=\"refresh-step\"></span></div>');",
            completionHandler: nil)

        DispatchQueue.global().async {
            let env = self.appEnvironment()
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
            var refreshSucceeded = false
            var refreshFailure = "刷新失败，请查看日志"
            do {
                try task.run()
                self.refreshProcesses.append(task)
                task.waitUntilExit()
                refreshSucceeded = task.terminationStatus == 0
                if !refreshSucceeded {
                    refreshFailure = "刷新失败（退出码 \(task.terminationStatus)），请查看日志"
                }
            } catch {
                refreshFailure = "刷新启动失败：\(error.localizedDescription)"
            }
            pipe.fileHandleForReading.readabilityHandler = nil
            self.refreshProcesses.removeAll { $0 == task }
            DispatchQueue.main.async {
                if refreshSucceeded {
                    self.webView.reload()
                    self.refreshXBriefStatus()
                } else {
                    self.setRefreshStep(refreshFailure)
                }
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

    @objc func reloadPage() { webView.reload() }

    @objc func quitApp() {
        xbriefPopover?.performClose(nil)
        xbriefTimer?.invalidate()
        refreshProcesses.forEach { $0.terminate() }
        serverProcess?.terminate()
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
        xbriefTimer?.invalidate()
        refreshProcesses.forEach { $0.terminate() }
        serverProcess?.terminate()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
