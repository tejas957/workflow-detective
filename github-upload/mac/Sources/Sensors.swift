// Everything the Mac app observes. It only *observes*:
//  - which app is in front (NSWorkspace) and its window title (Accessibility)
//  - which text field changed and its label (Accessibility; the field's character count is compared, never kept)
//  - that the clipboard changed and what *type* of thing is on it (the contents are never read)
//  - new files in Downloads (type only), idle time, screen lock and sleep
// It never watches the keyboard and never takes screenshots.
import AppKit
import ApplicationServices

final class Sensors: NSObject {
    private let engine: Engine
    private var pollTimer: Timer?
    private var idleTimer: Timer?
    private var lastPasteboard = NSPasteboard.general.changeCount
    private var lastKey = ""
    private var focused: AXUIElement?
    private var focusedCount = -1
    private var idle = false
    private var downloads: DispatchSourceFileSystemObject?
    private var downloadsSeen = Set<String>()
    private let selfBundle = Bundle.main.bundleIdentifier ?? "com.workflowdetective.pilot"
    static let browsers: Set<String> = ["com.apple.safari", "com.google.chrome", "com.microsoft.edgemac", "org.mozilla.firefox",
                                        "company.thebrowser.browser", "com.brave.browser", "com.operasoftware.opera", "com.vivaldi.vivaldi"]
    var watchBrowserFields = false   // web apps are covered in detail by the browser extension

    init(engine: Engine) { self.engine = engine }

    func start() {
        let wnc = NSWorkspace.shared.notificationCenter
        wnc.addObserver(self, selector: #selector(appActivated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        wnc.addObserver(self, selector: #selector(goneAway(_:)), name: NSWorkspace.willSleepNotification, object: nil)
        wnc.addObserver(self, selector: #selector(cameBack(_:)), name: NSWorkspace.didWakeNotification, object: nil)
        let dnc = DistributedNotificationCenter.default()
        dnc.addObserver(self, selector: #selector(goneAway(_:)), name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        dnc.addObserver(self, selector: #selector(cameBack(_:)), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        pollTimer = Timer.scheduledTimer(timeInterval: 0.75, target: self, selector: #selector(poll), userInfo: nil, repeats: true)
        idleTimer = Timer.scheduledTimer(timeInterval: 5, target: self, selector: #selector(checkIdle), userInfo: nil, repeats: true)
        watchDownloads()
        poll()
    }

    func stop() {
        pollTimer?.invalidate(); idleTimer?.invalidate()
        downloads?.cancel()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        DistributedNotificationCenter.default().removeObserver(self)
    }

    static var accessibilityAllowed: Bool { return AXIsProcessTrusted() }
    static func askForAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    /* ---------- accessibility helpers ---------- */
    private func ax(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
        var v: CFTypeRef?
        return AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success ? v : nil
    }
    private func axString(_ el: AXUIElement, _ attr: String) -> String? {
        return ax(el, attr) as? String
    }
    private func axElement(_ el: AXUIElement, _ attr: String) -> AXUIElement? {
        guard let v = ax(el, attr), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(v, to: AXUIElement.self)
    }
    private func axCount(_ el: AXUIElement) -> Int {
        if let n = ax(el, "AXNumberOfCharacters") as? NSNumber { return n.intValue }   // length without reading the text
        if let s = ax(el, "AXValue") as? String { return s.count }
        return -1
    }
    private func label(of el: AXUIElement) -> String {
        if let t = axElement(el, "AXTitleUIElement") {
            if let s = axString(t, "AXValue"), !s.isEmpty { return s }
            if let s = axString(t, "AXTitle"), !s.isEmpty { return s }
        }
        for attr in ["AXDescription", "AXTitle", "AXPlaceholderValue", "AXHelp"] {
            if let s = axString(el, attr), !s.isEmpty { return s }
        }
        return ""
    }

    /* ---------- polling: app, window title, focused field, clipboard ---------- */
    @objc private func appActivated(_ n: Notification) { poll() }

    @objc func poll() {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        let bundle = app.bundleIdentifier ?? ""
        if bundle == selfBundle { lastPasteboard = NSPasteboard.general.changeCount; return }   // our own window: ignore
        let name = app.localizedName ?? bundle
        var title = ""
        var focusEl: AXUIElement?
        if Sensors.accessibilityAllowed {
            let appEl = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(appEl, 0.25)
            if let win = axElement(appEl, "AXFocusedWindow") { title = axString(win, "AXTitle") ?? "" }
            focusEl = axElement(appEl, "AXFocusedUIElement")
        }
        let key = bundle + "|" + title
        if key != lastKey {
            lastKey = key
            engine.foreground(bundle: bundle, name: name, title: title)
            focused = nil; focusedCount = -1
        }
        checkPasteboard()
        checkField(focusEl, bundle: bundle)
        engine.tick()
    }

    private func checkField(_ el: AXUIElement?, bundle: String) {
        guard let el = el else { focused = nil; return }
        if Sensors.browsers.contains(bundle.lowercased()) && !watchBrowserFields { return }
        let role = axString(el, "AXRole") ?? ""
        guard role == "AXTextField" || role == "AXTextArea" || role == "AXComboBox" else { focused = nil; return }
        let count = axCount(el)
        if let f = focused, CFEqual(f, el) {
            if count >= 0 && focusedCount >= 0 && count != focusedCount {
                let sensitive = (axString(el, "AXSubrole") ?? "") == "AXSecureTextField"
                engine.field(label: sensitive ? "" : label(of: el), sensitive: sensitive)
            }
        } else {
            focused = el
        }
        focusedCount = count
    }

    private func checkPasteboard() {
        let pb = NSPasteboard.general
        guard pb.changeCount != lastPasteboard else { return }
        lastPasteboard = pb.changeCount
        let types = Set((pb.types ?? []).map { $0.rawValue })
        let kind: String
        if types.contains(NSPasteboard.PasteboardType.fileURL.rawValue) { kind = "files" }
        else if types.contains("public.utf8-tab-separated-values-text") || types.contains(NSPasteboard.PasteboardType.tabularText.rawValue) { kind = "table" }
        else if types.contains(NSPasteboard.PasteboardType.URL.rawValue) { kind = "link" }
        else if types.contains(NSPasteboard.PasteboardType.png.rawValue) || types.contains(NSPasteboard.PasteboardType.tiff.rawValue) { kind = "image" }
        else if types.contains(NSPasteboard.PasteboardType.string.rawValue) { kind = "text" }
        else { kind = "other" }
        engine.copy(kind: kind)
    }

    /* ---------- idle, lock, sleep ---------- */
    @objc private func checkIdle() {
        let anyInput = CGEventType(rawValue: UInt32.max)!
        let secs = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        if secs > 120 && !idle { idle = true; engine.away() }
        else if secs < 5 && idle { idle = false; engine.active(); poll() }
    }
    @objc private func goneAway(_ n: Notification) { engine.away() }
    @objc private func cameBack(_ n: Notification) { engine.active(); lastKey = ""; poll() }

    /* ---------- new files in Downloads (type only) ---------- */
    private func watchDownloads() {
        guard let url = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else { return }
        downloadsSeen = Set((try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? [])
        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else { Log.write("can't watch Downloads"); return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write, queue: .main)
        src.setEventHandler { [weak self] in self?.scanDownloads(url) }
        src.setCancelHandler { close(fd) }
        src.resume()
        downloads = src
    }
    private func scanDownloads(_ url: URL) {
        let now = Set((try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? [])
        for name in now.subtracting(downloadsSeen) {
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.appendingPathComponent(name).path, isDirectory: &isDir), isDir.boolValue { continue }
            engine.file(name: name, whereFound: "Downloads")
        }
        downloadsSeen = now
    }
}
