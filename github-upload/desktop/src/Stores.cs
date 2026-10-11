// Local storage on this computer only: kv.json (settings + feedback) and one JSON-lines file per day of activity.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace WorkflowDetective
{
    public class KvStore
    {
        readonly string file;
        readonly object gate = new object();
        Dictionary<string, object> data;
        StudySettings cached;
        public event Action Changed;

        public KvStore(string dataDir)
        {
            file = Path.Combine(dataDir, "kv.json");
            data = new Dictionary<string, object>();
            try { if (File.Exists(file)) data = Json.Obj(Json.Parse(File.ReadAllText(file, Encoding.UTF8))); }
            catch (Exception e) { Log.Write("kv.json unreadable, starting fresh: " + e.Message); }
        }

        public Dictionary<string, object> Snapshot() { lock (gate) return Json.Obj(Json.Parse(Json.Write(data))); }

        public void Merge(Dictionary<string, object> patch)
        {
            lock (gate) { foreach (var kv in patch) data[kv.Key] = kv.Value; cached = null; Save(); }
            var h = Changed; if (h != null) h();
        }
        public void Remove(IEnumerable<string> keys)
        {
            lock (gate) { foreach (var k in keys) data.Remove(k); cached = null; Save(); }
            var h = Changed; if (h != null) h();
        }
        public StudySettings Settings()
        {
            lock (gate)
            {
                if (cached == null) { object v; data.TryGetValue("settings", out v); cached = StudySettings.From(v as Dictionary<string, object>); }
                return cached;
            }
        }
        public void PatchSettings(string key, object value)
        {
            lock (gate)
            {
                object v; data.TryGetValue("settings", out v);
                var s = v as Dictionary<string, object> ?? new Dictionary<string, object>();
                s[key] = value; data["settings"] = s; cached = null; Save();
            }
            var h = Changed; if (h != null) h();
        }
        void Save()
        {
            string tmp = file + ".tmp";
            File.WriteAllText(tmp, Json.Write(data), new UTF8Encoding(false));
            if (File.Exists(file)) File.Delete(file);
            File.Move(tmp, file);
        }
    }

    public class EventStore
    {
        readonly string dir;
        readonly object gate = new object();
        long nextId = 1;
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        public EventStore(string dataDir)
        {
            dir = Path.Combine(dataDir, "events");
            Directory.CreateDirectory(dir);
            foreach (var e in All()) { var d = e as Dictionary<string, object>; long id = (long)Json.GetNumber(d, "id", 0); if (id >= nextId) nextId = id + 1; }
        }

        static string DayOf(double t) { return DateTimeOffset.FromUnixTimeMilliseconds((long)t).LocalDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
        string[] Files() { return Directory.GetFiles(dir, "*.jsonl").OrderBy(f => f, StringComparer.Ordinal).ToArray(); }

        public void Add(Dictionary<string, object> ev)
        {
            lock (gate)
            {
                ev["id"] = (double)nextId++;
                File.AppendAllText(Path.Combine(dir, DayOf(Json.GetNumber(ev, "t", 0)) + ".jsonl"), Json.Write(ev) + "\n", Utf8);
            }
        }

        public List<object> All()
        {
            var o = new List<object>();
            lock (gate)
            {
                foreach (var f in Files())
                    foreach (var line in File.ReadAllLines(f, Utf8))
                    {
                        if (line.Length == 0) continue;
                        try { o.Add(Json.Parse(line)); } catch { /* skip a damaged line */ }
                    }
            }
            return o;
        }

        public int Delete(HashSet<long> ids)
        {
            int n = 0;
            lock (gate)
            {
                foreach (var f in Files())
                {
                    var keep = new List<string>(); bool changed = false;
                    foreach (var line in File.ReadAllLines(f, Utf8))
                    {
                        long id = -1;
                        try { id = (long)Json.GetNumber(Json.Obj(Json.Parse(line)), "id", -1); } catch { }
                        if (ids.Contains(id)) { changed = true; n++; } else if (line.Length > 0) keep.Add(line);
                    }
                    if (!changed) continue;
                    if (keep.Count == 0) File.Delete(f); else File.WriteAllText(f, string.Join("\n", keep.ToArray()) + "\n", Utf8);
                }
            }
            return n;
        }

        public void Clear() { lock (gate) foreach (var f in Files()) File.Delete(f); }
    }
}
