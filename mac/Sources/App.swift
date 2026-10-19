// Menu bar app: status, pause, findings/settings window (the same pages as the browser extension and Windows app,
// shown in a WKWebView), saving the results file, the Accessibility permission, and starting at login.
//
//   WorkflowDetective                       normal use
//   WorkflowDetective --selftest            built-in checks, prints results, exits
//   WorkflowDetective --data DIR --exit-after SECONDS   (used by the smoke test)
import AppKit
import WebKit
import ServiceManagement

@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    static let version = "0.1.0"

    static func main() {
        let args = CommandLine.arguments
        if args.contains("--selftest") { exit(SelfTest.run()) }
        let app = NSApplication.shared
        let delegate = AppDelegate(args: args)
        app.delegate = delegate
        app.setActivationPolicy(.accessory)     // menu bar only, no Dock icon
        withExtendedLifetime(delegate) { app.run() }
    }

    private let args: [String]
    private var store: DataStore!
    private var engine: Engine!
    private var sensors: Sensors!
    private var statusItem: NSStatusItem!
    private let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    private let pauseItem = NSMenuItem(title: "Pause for 1 hour", action: #selector(AppDelegate.togglePause), keyEquivalent: "")
    private let permItem = NSMenuItem(title: "Allow Accessibility access…", action: #selector(AppDelegate.openAccessibility), keyEquivalent: "")
    private var window: NSWindow?
    private var webView: WKWebView?
    private var statusTimer: Timer?

    init(args: [String]) { self.args = args; super.init() }

    private func option(_ name: String) -> String? {
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    static func defaultDataDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("WorkflowDetective", isDirectory: true)
    }
    static var resources: URL { return Bundle.main.resourceURL ?? URL(fileURLWithPath: ".") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // one copy at a time
        if let id = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: id).count > 1 && option("--data") == nil {
            NSApp.terminate(nil); return
        }
        let dir = option("--data").map { URL(fileURLWithPath: $0, isDirectory: true) } ?? AppDelegate.defaultDataDir()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        Log.file = dir.appendingPathComponent("log.txt")
        store = DataStore(dir: dir)
        let st = store!
        engine = Engine(coreDir: AppDelegate.resources.appendingPathComponent("core")) { json in st.add(eventJSON: json) }
        if !engine.loaded { Log.write("recording core failed to load") }
        engine.setSettings(store.settingsJSON)
        store.onChange = { [weak self] in
            guard let self = self else { return }
            self.engine.setSettings(self.store.settingsJSON)
            self.refresh()
        }
        sensors = Sensors(engine: engine)
        sensors.start()
        buildMenu()
        statusTimer = Timer.scheduledTimer(timeInterval: 30, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
        refresh()
        Log.write("started v" + AppDelegate.version)

        if let secs = option("--exit-after"), let s = Double(secs) {
            Timer.scheduledTimer(timeInterval: s, target: self, selector: #selector(quit), userInfo: nil, repeats: false)
        } else if (store.settings["consented"] as? Bool) != true {
            takeInviteFromPasteboard()
            openPage("onboarding.html")
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openPage("report.html"); return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        engine?.away()
        sensors?.stop()
    }

    /* ---------- menu bar ---------- */
    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.autoenablesItems = false      // so isEnabled on each item is respected
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(permItem)
        menu.addItem(NSMenuItem.separator())
        let open = NSMenuItem(title: "Open my findings", action: #selector(openFindings), keyEquivalent: "")
        menu.addItem(open)
        menu.addItem(pauseItem)
        menu.addItem(NSMenuItem(title: "Settings and privacy", action: #selector(openSettings), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit (stops watching until you open it again)", action: #selector(quit), keyEquivalent: ""))
        for item in menu.items where item.action != nil { item.target = self }
        statusItem.menu = menu
    }

    @objc func refresh() {
        guard let engine = engine else { return }
        let st = engine.status()
        let state = st["state"] as? String ?? ""
        let label = st["label"] as? String ?? ""
        let total = (st["total"] as? NSNumber)?.intValue ?? 0
        let done = (st["done"] as? NSNumber)?.intValue ?? 0
        statusLine.title = label + (total > 0 ? "  ·  \(done) of \(total) days done" : "")
        pauseItem.title = state == "paused" ? "Resume watching" : "Pause for 1 hour"
        pauseItem.isEnabled = ["active", "paused", "later", "off"].contains(state)
        permItem.isHidden = Sensors.accessibilityAllowed || state == "setup" || state == "withdrawn"
        if let button = statusItem?.button {
            let symbol = state == "active" ? "magnifyingglass.circle.fill" : "magnifyingglass"
            let img = NSImage(systemSymbolName: symbol, accessibilityDescription: "Workflow Detective")
            img?.isTemplate = true
            button.image = img
            button.toolTip = "Workflow Detective · " + label
        }
        let consented = (store.settings["consented"] as? Bool) == true && (store.settings["withdrawn"] as? Bool) != true
        loginItem(consented)
        if engine.retentionDue {
            store.clear()
            store.patchSettings("purgedAt", Date().timeIntervalSince1970 * 1000)
            Log.write("retention: activity log deleted")
        }
    }

    @objc func togglePause() {
        let now = Date().timeIntervalSince1970 * 1000
        let paused = ((store.settings["pausedUntil"] as? NSNumber)?.doubleValue ?? 0) > now
        store.patchSettings("pausedUntil", paused ? 0 : now + 3_600_000)
    }
    @objc func openFindings() { openPage((store.settings["consented"] as? Bool) == true ? "report.html" : "onboarding.html") }
    @objc func openSettings() { openPage("onboarding.html") }
    @objc func openAccessibility() {
        Sensors.askForAccessibility()
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
    @objc func quit() { NSApp.terminate(nil) }

    private func loginItem(_ on: Bool) {
        if #available(macOS 13.0, *) {
            let svc = SMAppService.mainApp
            do {
                if on && svc.status != .enabled { try svc.register() }
                if !on && svc.status == .enabled { try svc.unregister() }
            } catch { Log.write("login item: \(error)") }
        }
    }

    /// The setup page copies the participant's invite code when they click "Download for Mac". If it's still on the
    /// clipboard the first time the app opens, hand it to the setup window so everything fills in by itself.
    private func takeInviteFromPasteboard() {
        guard let text = NSPasteboard.general.string(forType: .string),
              let r = text.range(of: "WD1\\.[A-Za-z0-9_-]{8,}\\.[a-z0-9]{1,8}", options: .regularExpression) else { return }
        store.merge(["pendingInvite": String(text[r])])
        Log.write("invite code found on the clipboard")
    }

    /* ---------- findings / settings window ---------- */
    func openPage(_ page: String) {
        if webView == nil {
            let config = WKWebViewConfiguration()
            config.setURLSchemeHandler(SchemeHandler(root: AppDelegate.resources.appendingPathComponent("ui")), forURLScheme: "wd")
            config.userContentController.add(Bridge(app: self), name: "wd")
            let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1060, height: 820), configuration: config)
            let w = EditableWindow(contentRect: NSRect(x: 0, y: 0, width: 1060, height: 820),
                             styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
            w.title = "Workflow Detective"
            w.isReleasedWhenClosed = false
            w.contentView = wv
            w.center()
            w.delegate = self
            webView = wv; window = w
        }
        if let url = URL(string: "wd://app/" + page) { webView?.load(URLRequest(url: url)) }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    /* used by the bridge */
    var dataStore: DataStore { return store }
    var appWindow: NSWindow? { return window }
}

/// A menu bar app has no Edit menu, so ⌘V, ⌘C, ⌘X, ⌘A and ⌘Z would do nothing in the window's text boxes.
/// Route them to the web view ourselves (needed to paste an invite code into setup).
final class EditableWindow: NSWindow {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if event.type == .keyDown, mods == .command || mods == [.command, .shift], let key = event.charactersIgnoringModifiers?.lowercased() {
            let action: Selector?
            switch key {
            case "v": action = #selector(NSText.paste(_:))
            case "c": action = #selector(NSText.copy(_:))
            case "x": action = #selector(NSText.cut(_:))
            case "a": action = #selector(NSResponder.selectAll(_:))
            case "z": action = mods.contains(.shift) ? Selector(("redo:")) : Selector(("undo:"))
            case "w": action = #selector(NSWindow.performClose(_:))
            default: action = nil
            }
            if let a = action, NSApp.sendAction(a, to: nil, from: self) { return true }
        }
        return super.performKeyEquivalent(with: event)
    }
}

/// Serves the bundled pages at wd://app/… and adds the Mac bridge script to every page.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        var rel = url.path
        if rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = "report.html" }
        let file = root.appendingPathComponent(rel)
        guard !rel.contains(".."), var data = try? Data(contentsOf: file) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(r); urlSchemeTask.didReceive(Data("Not found".utf8)); urlSchemeTask.didFinish()
            return
        }
        if rel.hasSuffix(".html"), var html = String(data: data, encoding: .utf8), let r = html.range(of: "</title>") {
            html.insert(contentsOf: "\n<script src=\"/wd-mac.js\"></script>", at: r.upperBound)
            data = Data(html.utf8)
        }
        let type: String
        switch (rel as NSString).pathExtension.lowercased() {
        case "html": type = "text/html; charset=utf-8"
        case "js": type = "text/javascript; charset=utf-8"
        case "css": type = "text/css; charset=utf-8"
        case "png": type = "image/png"
        default: type = "application/octet-stream"
        }
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store"])!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/// Pages call window.webkit.messageHandlers.wd.postMessage({id, path, body}); the answer comes back through
/// window.__wdReply(id, result, error). Same API as the Windows app's local server.
final class Bridge: NSObject, WKScriptMessageHandler {
    private weak var app: AppDelegate?
    init(app: AppDelegate) { self.app = app }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let id = (msg["id"] as? NSNumber)?.intValue else { return }
        weak var web = message.webView
        func send(_ result: Any?, _ error: String?) {
            let r: String = result.map { DataStore.json($0) } ?? "null"
            let e: String = error.map { DataStore.json([$0]) + "[0]" } ?? "null"
            let js = "window.__wdReply(" + String(id) + ", " + r + ", " + e + ")"
            web?.evaluateJavaScript(js, completionHandler: nil)
        }
        guard let app = app, let path = msg["path"] as? String else { send(nil, "Bad request"); return }
        let store = app.dataStore
        let body = msg["body"] as? [String: Any] ?? [:]
        switch path {
        case "kv": send(store.kv, nil)
        case "kv/set": store.merge(body); send(["ok": true], nil)
        case "kv/remove": store.remove(body["keys"] as? [String] ?? []); send(["ok": true], nil)
        case "events": send(store.all(), nil)
        case "events/delete":
            let ids = Set((body["ids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue })
            send(["ok": true, "deleted": store.delete(ids: ids)], nil)
        case "events/clear": store.clear(); send(["ok": true], nil)
        case "permissions": send(["accessibility": Sensors.accessibilityAllowed], nil)
        case "openAccessibility": app.openAccessibility(); send(["ok": true], nil)
        case "save":
            let panel = NSSavePanel()
            panel.nameFieldStringValue = body["name"] as? String ?? "workflow-detective.json"
            panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            let text = body["text"] as? String ?? ""
            let done: (NSApplication.ModalResponse) -> Void = { result in
                if result == .OK, let url = panel.url {
                    do { try Data(text.utf8).write(to: url); send(["ok": true, "path": url.path], nil) }
                    catch { send(["ok": false, "error": error.localizedDescription], nil) }
                } else { send(["ok": false, "cancelled": true], nil) }
            }
            if let w = app.appWindow { panel.beginSheetModal(for: w, completionHandler: done) }
            else { done(panel.runModal()) }
        default: send(nil, "Unknown request: " + path)
        }
    }
}
