// Built-in checks:  WorkflowDetective.app/Contents/MacOS/WorkflowDetective --selftest
// Runs the real storage and the real recording core inside JavaScriptCore with a fake clock.
import Foundation

enum SelfTest {
    private static var pass = 0, fail = 0
    private static func check(_ name: String, _ ok: Bool, _ detail: String = "") {
        if ok { pass += 1 } else { fail += 1 }
        print((ok ? "✓ " : "✗ ") + name + (ok || detail.isEmpty ? "" : "  — " + detail))
    }

    static func run() -> Int32 {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("wd-selftest-" + UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        Log.file = tmp.appendingPathComponent("log.txt")
        let res = AppDelegate.resources

        // bundled files
        for f in ["ui/report.html", "ui/onboarding.html", "ui/wd-mac.js", "ui/lib/detector.js", "ui/lib/db.js", "ui/lib/settings.js", "ui/lib/invite.js", "core/schedule.js", "core/recorder.js"] {
            check("bundled: " + f, FileManager.default.fileExists(atPath: res.appendingPathComponent(f).path))
        }

        // storage
        let store = DataStore(dir: tmp)
        store.merge(["settings": ["consented": true, "startDate": "2026-10-12", "weeks": 2, "scheduleMode": "rotate",
                                  "hourStart": 8, "hourEnd": 18, "captureTitles": true, "captureFieldLabels": true, "blocked": ["spotify"]]])
        check("settings saved", (DataStore(dir: tmp).settings["consented"] as? Bool) == true)

        // recording core in JavaScriptCore
        let engine = Engine(coreDir: res.appendingPathComponent("core")) { json in store.add(eventJSON: json) }
        check("recording core loads in JavaScriptCore", engine.loaded)
        engine.setSettings(store.settingsJSON)
        var c = DateComponents(); c.year = 2026; c.month = 10; c.day = 14; c.hour = 10   // a Wednesday: watch day
        var t = Calendar.current.date(from: c)!.timeIntervalSince1970 * 1000
        func at(_ secs: Double) { t += secs * 1000; engine.fakeNow = t; engine.tick() }
        at(0)
        check("study is active on a watch day", engine.isActive)
        engine.foreground(bundle: "com.microsoft.Outlook", name: "Microsoft Outlook", title: "Payment received from Acme - Invoice 1042")
        engine.copy(kind: "text"); at(4)
        engine.foreground(bundle: "com.microsoft.Excel", name: "Microsoft Excel", title: "AR Tracker.xlsx"); at(2)
        engine.field(label: "Amount", sensitive: false); at(1)
        engine.field(label: "", sensitive: true); at(6)
        engine.foreground(bundle: "com.spotify.client", name: "Spotify", title: "Spotify"); engine.copy(kind: "text")
        engine.foreground(bundle: "com.1password.1password", name: "1Password", title: "1Password"); engine.copy(kind: "text")
        let ev = store.all()
        let types = ev.compactMap { $0["type"] as? String }
        let dump = DataStore.json(ev)
        check("events written: view, copy, paste, entry", types.contains("view") && types.contains("copy") && types.contains("paste") && types.contains("entry"), types.joined(separator: ","))
        check("paste credited to Excel with the field label", ev.contains { ($0["type"] as? String) == "paste" && ($0["app"] as? String) == "Excel" && (($0["d"] as? [String: Any])?["field"] as? String) == "Amount" })
        check("titles redacted", dump.contains("Invoice #") && !dump.contains("1042"))
        check("sensitive field counted, not named", ev.contains { (($0["d"] as? [String: Any])?["sensitive"] as? NSNumber)?.intValue == 1 })
        check("blocked app and password manager record nothing", !dump.contains("Spotify") && !dump.contains("1Password"))
        check("every event has an id", ev.allSatisfy { $0["id"] != nil })

        let n = ev.count
        c.hour = 20; t = Calendar.current.date(from: c)!.timeIntervalSince1970 * 1000; engine.fakeNow = t
        engine.foreground(bundle: "com.microsoft.Excel", name: "Microsoft Excel", title: "Evening.xlsx"); engine.copy(kind: "text")
        check("nothing recorded after hours", store.all().count == n)
        let firstId = (ev.first?["id"] as? NSNumber)?.intValue ?? -1
        check("deleting a line works", store.delete(ids: [firstId]) == 1 && store.all().count == n - 1)
        store.clear()
        check("clearing works", store.all().isEmpty)
        let st = engine.status()
        check("status available for the menu", st["state"] != nil && st["label"] != nil, DataStore.json(st))

        print("")
        print(fail == 0 ? "All \(pass) Mac self-checks passed" : "\(fail) FAILED, \(pass) passed")
        return fail == 0 ? 0 : 1
    }
}
