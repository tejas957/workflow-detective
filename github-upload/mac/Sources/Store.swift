// Local storage on this Mac only: kv.json (settings + ratings) and one JSON-lines file per day of activity,
// in ~/Library/Application Support/WorkflowDetective. Same layout as the Windows app.
import Foundation

enum Log {
    static var file: URL?
    static func write(_ msg: String) {
        guard let file = file else { return }
        let line = ISO8601DateFormatter().string(from: Date()) + "  " + msg + "\n"
        if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
           let size = attrs[.size] as? NSNumber, size.intValue > 1_000_000 {
            try? FileManager.default.removeItem(at: file)
        }
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile(); h.write(Data(line.utf8)); h.closeFile()
        } else {
            try? Data(line.utf8).write(to: file)
        }
    }
}

final class DataStore {
    let dir: URL
    let eventsDir: URL
    private(set) var kv: [String: Any] = [:]
    private var nextId = 1
    var onChange: (() -> Void)?

    init(dir: URL) {
        self.dir = dir
        eventsDir = dir.appendingPathComponent("events", isDirectory: true)
        try? FileManager.default.createDirectory(at: eventsDir, withIntermediateDirectories: true)
        if let d = try? Data(contentsOf: dir.appendingPathComponent("kv.json")),
           let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
            kv = o
        }
        for e in all() {
            if let id = (e["id"] as? NSNumber)?.intValue, id >= nextId { nextId = id + 1 }
        }
    }

    static func json(_ o: Any) -> String {
        guard JSONSerialization.isValidJSONObject(o),
              let d = try? JSONSerialization.data(withJSONObject: o) else { return "null" }
        return String(data: d, encoding: .utf8) ?? "null"
    }

    var settings: [String: Any] { return kv["settings"] as? [String: Any] ?? [:] }
    var settingsJSON: String { return DataStore.json(settings) }

    func merge(_ patch: [String: Any]) {
        for (k, v) in patch { kv[k] = v }
        saveKV()
    }
    func remove(_ keys: [String]) {
        for k in keys { kv.removeValue(forKey: k) }
        saveKV()
    }
    func patchSettings(_ key: String, _ value: Any) {
        var s = settings
        s[key] = value
        kv["settings"] = s
        saveKV()
    }
    private func saveKV() {
        let d = Data(DataStore.json(kv).utf8)
        try? d.write(to: dir.appendingPathComponent("kv.json"), options: .atomic)
        onChange?()
    }

    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private func files() -> [URL] {
        let list = (try? FileManager.default.contentsOfDirectory(at: eventsDir, includingPropertiesForKeys: nil)) ?? []
        return list.filter { $0.pathExtension == "jsonl" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// Adds one event (a JSON object string from the recording core) and gives it an id.
    func add(eventJSON: String) {
        guard let d = eventJSON.data(using: .utf8),
              var e = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        e["id"] = nextId
        nextId += 1
        let t = (e["t"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970 * 1000
        let day = DataStore.dayFormat.string(from: Date(timeIntervalSince1970: t / 1000))
        let file = eventsDir.appendingPathComponent(day + ".jsonl")
        let line = Data((DataStore.json(e) + "\n").utf8)
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile(); h.write(line); h.closeFile()
        } else {
            try? line.write(to: file)
        }
    }

    func all() -> [[String: Any]] {
        var out: [[String: Any]] = []
        for f in files() {
            guard let text = try? String(contentsOf: f, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n") {
                if let d = String(line).data(using: .utf8),
                   let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                    out.append(o)
                }
            }
        }
        return out
    }

    @discardableResult
    func delete(ids: Set<Int>) -> Int {
        var n = 0
        for f in files() {
            guard let text = try? String(contentsOf: f, encoding: .utf8) else { continue }
            var keep: [String] = []
            var changed = false
            for line in text.split(separator: "\n") {
                let s = String(line)
                var id = -1
                if let d = s.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                    id = (o["id"] as? NSNumber)?.intValue ?? -1
                }
                if ids.contains(id) { changed = true; n += 1 } else if !s.isEmpty { keep.append(s) }
            }
            if !changed { continue }
            if keep.isEmpty { try? FileManager.default.removeItem(at: f) }
            else { try? Data((keep.joined(separator: "\n") + "\n").utf8).write(to: f, options: .atomic) }
        }
        return n
    }

    func clear() {
        for f in files() { try? FileManager.default.removeItem(at: f) }
    }
}
