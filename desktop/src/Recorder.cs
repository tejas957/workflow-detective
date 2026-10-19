// Turns raw signals from Windows (window switches, clipboard changes, field edits, button presses, Excel and
// Outlook events, new files) into the same event format the browser extension writes. Platform-independent,
// so it is unit-tested on any OS with a fake clock.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace WorkflowDetective
{
    public interface IClock { double NowMs(); DateTime Now(); }
    public class SystemClock : IClock
    {
        public double NowMs() { return DateTimeOffset.Now.ToUnixTimeMilliseconds(); }
        public DateTime Now() { return DateTime.Now; }
    }

    public class Recorder
    {
        readonly KvStore kv;
        readonly EventStore store;
        readonly IClock clock;
        readonly object gate = new object();

        // what's in front right now
        AppInfo cur;
        string curTitleRaw = "";
        string excelPage;          // "Workbook.xlsx › Sheet" while Excel is in front
        string outlookSubject;     // selected email subject while Outlook is in front
        bool away;
        string lastViewKey = "";

        // last copy, for spotting copy-in-one-app → paste/edit-in-another
        double lastCopyT = -1;
        string lastCopyApp, lastCopyKind, lastCopyLen;
        bool copyUsed;   // one copy is credited to the first other app edited after it

        // field edits are batched per screen, labels only
        string batchApp, batchProc, batchPage, batchTitle;
        readonly List<string> batchLabels = new List<string>();
        readonly HashSet<string> batchSensitive = new HashSet<string>();
        double batchLastT;

        public const double PasteWindowMs = 90000;
        public const double EntryFlushMs = 4000;

        public Recorder(KvStore kv, EventStore store, IClock clock) { this.kv = kv; this.store = store; this.clock = clock; }

        /* ---------- signals ---------- */

        public void OnForeground(string proc, string fileDescription, string rawTitle)
        {
            lock (gate)
            {
                var info = AppNames.Name(proc, fileDescription, rawTitle);
                bool appChanged = cur == null || cur.App != info.App || cur.Proc != info.Proc;
                if (appChanged || curTitleRaw != rawTitle) FlushEntry();
                if (appChanged) { excelPage = null; outlookSubject = null; }
                cur = info; curTitleRaw = rawTitle ?? "";
                if (away) { away = false; lastViewKey = ""; }
                EmitView();
            }
        }

        public void OnCopy(string text, bool isFiles)
        {
            lock (gate)
            {
                FlushEntry();
                if (cur == null || !Allowed()) return;
                string kind = isFiles ? "files" : Privacy.KindOf(text);
                string len = Privacy.LenBucket(text == null ? 0 : text.Length);
                Emit("copy", D("kind", kind, "len", len));
                lastCopyT = clock.NowMs(); lastCopyApp = cur.App; lastCopyKind = kind; lastCopyLen = len;
                copyUsed = false;
            }
        }

        public void OnFieldEdited(string label, bool sensitive)
        {
            lock (gate)
            {
                if (cur == null || !Allowed()) return;
                string l = Privacy.CleanLabel(label);
                if (l.Length == 0) l = "Field";
                if (sensitive || Privacy.IsSensitiveLabel(l)) { MaybePaste("[sensitive]"); AddToBatch(null, true, Page(), l); }
                else { MaybePaste(l); AddToBatch(l, false, Page(), l); }
            }
        }

        /// Excel told us cells changed. headers = the column headings in row 1 for the changed columns.
        public void OnExcelChange(string workbook, string sheet, IList<string> headers, int cells)
        {
            lock (gate)
            {
                if (cur == null || cur.App != "Excel" || !Allowed()) return;
                excelPage = Privacy.RedactTitle(workbook) + " › " + Privacy.RedactTitle(sheet);
                var labels = new List<string>();
                foreach (var h in headers) { string c = Privacy.CleanLabel(h); if (c.Length > 0) labels.Add(c); }
                MaybePaste(labels.Count > 0 ? labels[0] : null);
                if (labels.Count == 0) labels.Add("Cells");
                foreach (var l in labels) AddToBatch(l, false, Page(), l);
            }
        }

        public void OnButton(string label)
        {
            lock (gate)
            {
                FlushEntry();
                if (cur == null || !Allowed()) return;
                string l = Privacy.CleanLabel(label);
                if (l.Length == 0 || l.Length > 40 || Privacy.IsSensitiveLabel(l)) return;
                Emit("click", D("label", l));
            }
        }

        /// A file picker (Open / Upload / Attach) was used in the app in front. We never see which file.
        public void OnUpload()
        {
            lock (gate) { FlushEntry(); if (cur != null && Allowed()) Emit("upload", D("n", 1.0)); }
        }

        static readonly HashSet<string> IgnoreExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "tmp", "crdownload", "partial", "part", "download", "lnk", "ini", "db", "log", "lock", "temp", "opdownload" };

        /// A new file appeared in Downloads / Desktop / Documents. Only its type is kept.
        public void OnFileCreated(string fileName, string where)
        {
            lock (gate)
            {
                if (cur == null || !Allowed() || string.IsNullOrEmpty(fileName)) return;
                if (fileName.StartsWith("~$") || fileName.StartsWith(".")) return;
                int dot = fileName.LastIndexOf('.');
                string ext = dot > 0 && dot < fileName.Length - 1 ? fileName.Substring(dot + 1).ToLowerInvariant() : "file";
                if (ext.Length > 6 || IgnoreExt.Contains(ext)) return;
                FlushEntry();
                Emit("download", D("ext", ext, "where", where));
            }
        }

        /// The selected email in Outlook changed. The subject is redacted like a title.
        public void OnOutlookItem(string subject)
        {
            lock (gate)
            {
                if (cur == null || cur.App != "Outlook") return;
                if (subject == outlookSubject) return;
                FlushEntry();
                outlookSubject = subject;
                EmitView();
            }
        }

        public void OnAway()
        {
            lock (gate)
            {
                FlushEntry();
                if (away) return;
                away = true;
                if (Allowed(true)) Emit("away", null);
            }
        }

        public void OnActive()
        {
            lock (gate) { if (!away) return; away = false; lastViewKey = ""; if (cur != null) EmitView(); }
        }

        public void Tick()
        {
            lock (gate) { if (batchApp != null && clock.NowMs() - batchLastT > EntryFlushMs) FlushEntry(); }
        }

        public string CurrentApp { get { lock (gate) return cur == null ? null : cur.App; } }
        public string CurrentProc { get { lock (gate) return cur == null ? null : cur.Proc; } }

        /* ---------- internals ---------- */

        StudySettings S { get { return kv.Settings(); } }

        static readonly Regex OutlookCompose = new Regex(@"(^|\s[-–]\s)(Message|Meeting|Appointment) \((HTML|Plain Text|Rich Text)\)$|^Untitled - Message", RegexOptions.IgnoreCase);

        string Page()
        {
            if (!S.CaptureTitles) return "";
            if (cur.App == "Excel" && excelPage != null) return excelPage;
            if (cur.App == "Outlook" && OutlookCompose.IsMatch(curTitleRaw)) return "Compose message";  // every draft is the same screen
            if (cur.App == "Outlook" && outlookSubject != null) return "Mail";
            return Privacy.RedactTitle(cur.Page);
        }
        string Title()
        {
            if (!S.CaptureTitles) return "";
            if (cur.App == "Outlook" && outlookSubject != null) return Privacy.RedactTitle(outlookSubject);
            if (cur.App == "Excel" && excelPage != null) return excelPage;
            return Privacy.RedactTitle(cur.Page);
        }

        static readonly Regex SensitiveTitle = new Regex(@"online banking|\bchase\b|wells fargo|bank of america|capital one|\bciti(bank)?\b|fidelity|vanguard|schwab|robinhood|coinbase|mychart|patient portal|password manager", RegexOptions.IgnoreCase);

        bool Allowed() { return Allowed(false); }
        bool Allowed(bool ignoreApp)
        {
            var s = S;
            if (!Schedule.IsActiveNow(s, clock.Now(), clock.NowMs())) return false;
            if (ignoreApp || cur == null) return true;
            if (AppNames.NeverWatch(cur.Proc)) return false;
            if (curTitleRaw.IndexOf("Workflow Detective", StringComparison.OrdinalIgnoreCase) >= 0) return false; // our own pages
            string hay = cur.App + " " + curTitleRaw + " " + (outlookSubject ?? "");
            if (SensitiveTitle.IsMatch(hay)) return false;
            foreach (var raw in s.Blocked)
            {
                string b = (raw ?? "").Trim().ToLowerInvariant();
                b = Regex.Replace(b, @"^https?://", ""); b = Regex.Replace(b, @"^www\.", ""); b = Regex.Replace(b, @"/.*$", "");
                if (b.Length == 0) continue;
                string word = b.Contains(".") ? b.Substring(0, b.LastIndexOf('.')) : b;
                if (word.Length == 0) continue;
                if (string.Equals(cur.App, word, StringComparison.OrdinalIgnoreCase) || cur.Proc == word) return false;
                if (word.Length >= 3 && Regex.IsMatch(hay, @"\b" + Regex.Escape(word) + @"\b", RegexOptions.IgnoreCase)) return false;
            }
            return true;
        }

        void EmitView()
        {
            if (cur == null || !Allowed()) return;
            string key = cur.App + "|" + Page() + "|" + Title();
            if (key == lastViewKey) return;
            lastViewKey = key;
            Emit("view", null);
        }

        void MaybePaste(string field)
        {
            if (lastCopyT < 0 || lastCopyApp == null || lastCopyApp == cur.App) return;
            if (clock.NowMs() - lastCopyT > PasteWindowMs || copyUsed) return;
            copyUsed = true;
            var d = D("kind", lastCopyKind, "len", lastCopyLen, "inferred", true);
            if (field != null && S.CaptureFieldLabels) d["field"] = field;
            Emit("paste", d);
        }

        void AddToBatch(string label, bool sensitive, string page, string key)
        {
            if (batchApp != null && (batchApp != cur.App || batchPage != page)) FlushEntry();
            if (batchApp == null) { batchApp = cur.App; batchProc = cur.Proc; batchPage = page; batchTitle = Title(); }
            if (sensitive) batchSensitive.Add(key);
            else if (label != null && !batchLabels.Contains(label)) batchLabels.Add(label);
            batchLastT = clock.NowMs();
        }

        void FlushEntry()
        {
            if (batchApp == null) return;
            if (batchLabels.Count > 0 || batchSensitive.Count > 0)
            {
                var d = D("n", (double)(batchLabels.Count + batchSensitive.Count), "sensitive", (double)batchSensitive.Count);
                d["labels"] = S.CaptureFieldLabels ? batchLabels.GetRange(0, Math.Min(12, batchLabels.Count)) : new List<string>();
                var ev = Base("entry", batchApp, batchProc, batchPage, batchTitle, batchLastT);
                ev["d"] = d;
                if (Schedule.IsActiveNow(S, clock.Now(), clock.NowMs())) store.Add(ev);
            }
            batchApp = null; batchLabels.Clear(); batchSensitive.Clear();
        }

        void Emit(string type, Dictionary<string, object> d)
        {
            Dictionary<string, object> ev;
            if (type == "away") ev = new Dictionary<string, object> { { "t", clock.NowMs() }, { "type", "away" } };
            else
            {
                ev = Base(type, cur.App, cur.Proc, Page(), Title(), clock.NowMs());
                ev["d"] = d ?? new Dictionary<string, object>();
            }
            store.Add(ev);
        }

        static Dictionary<string, object> Base(string type, string app, string proc, string page, string title, double t)
        {
            return new Dictionary<string, object> { { "t", t }, { "type", type }, { "app", app }, { "host", proc }, { "page", page }, { "title", title } };
        }

        static Dictionary<string, object> D(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2) if (kv[i + 1] != null) d[(string)kv[i]] = kv[i + 1];
            return d;
        }
    }
}
