// Hosts the shared recording core (core/schedule.js + core/recorder.js) in Apple's JavaScriptCore.
// All calls happen on the main thread.
import Foundation
import JavaScriptCore

final class Engine {
    private let ctx: JSContext
    var fakeNow: Double?            // used by the self-test
    private let onEvent: (String) -> Void
    private(set) var loaded = false

    init(coreDir: URL, onEvent: @escaping (String) -> Void) {
        self.onEvent = onEvent
        ctx = JSContext()!
        ctx.exceptionHandler = { _, exc in
            Log.write("js error: " + (exc?.toString() ?? "unknown"))
        }
        let nowFn: @convention(block) () -> Double = { [weak self] in
            if let f = self?.fakeNow { return f }
            return Date().timeIntervalSince1970 * 1000
        }
        let storeFn: @convention(block) (String) -> Void = { [weak self] json in
            self?.onEvent(json)
        }
        let logFn: @convention(block) (String) -> Void = { msg in
            Log.write("js: " + msg)
        }
        ctx.setObject(nowFn, forKeyedSubscript: "__wdNow" as NSString)
        ctx.setObject(storeFn, forKeyedSubscript: "__wdStore" as NSString)
        ctx.setObject(logFn, forKeyedSubscript: "__wdLog" as NSString)
        var ok = true
        for name in ["schedule.js", "recorder.js"] {
            let url = coreDir.appendingPathComponent(name)
            guard let src = try? String(contentsOf: url, encoding: .utf8) else {
                Log.write("missing " + url.path)
                ok = false
                continue
            }
            ctx.evaluateScript(src, withSourceURL: url)
        }
        ctx.evaluateScript("WDMac.init({ now: __wdNow, store: __wdStore, log: __wdLog });")
        loaded = ok && !(ctx.objectForKeyedSubscript("WDMac")?.isUndefined ?? true)
    }

    @discardableResult
    private func call(_ name: String, _ args: [Any] = []) -> JSValue? {
        guard let mac = ctx.objectForKeyedSubscript("WDMac"), !mac.isUndefined else { return nil }
        return mac.invokeMethod(name, withArguments: args)
    }

    func setSettings(_ json: String) { call("setSettings", [json]) }
    func foreground(bundle: String, name: String, title: String) { call("foreground", [bundle, name, title]) }
    func copy(kind: String) { call("copy", [kind]) }
    func field(label: String, sensitive: Bool) { call("field", [label, sensitive]) }
    func file(name: String, whereFound: String) { call("file", [name, whereFound]) }
    func away() { call("away") }
    func active() { call("active") }
    func tick() { call("tick") }
    var isActive: Bool { return call("isActive")?.toBool() ?? false }
    var retentionDue: Bool { return call("retentionDue")?.toBool() ?? false }

    /// { state, label, total, done, dayNumber, hours }
    func status() -> [String: Any] {
        guard let s = call("status")?.toString(), let d = s.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
        return o
    }
}
