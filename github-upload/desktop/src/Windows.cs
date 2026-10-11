// Windows-only capture. Everything here only *observes*:
//  - which window is in front (WinEvent foreground / title change)
//  - which field was edited and its label, and which button was pressed (WinEvent value-change / invoked + accessibility name)
//  - that the clipboard changed and what kind of thing is on it (never stored)
//  - file pickers opening, new files in Downloads / Desktop / Documents (type only)
//  - Excel: which sheet and column headings were edited (Excel's own event interface)
//  - Outlook (classic): the subject of the selected email
//  - idle and screen lock
// No keyboard hook is used; keystrokes are never seen.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Accessibility;

namespace WorkflowDetective
{
    static class Native
    {
        public delegate void WinEventDelegate(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr hmod, WinEventDelegate cb, uint pid, uint tid, uint flags);
        [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] public static extern bool AddClipboardFormatListener(IntPtr h);
        [DllImport("user32.dll")] public static extern bool RemoveClipboardFormatListener(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO lii);
        [DllImport("oleacc.dll")] public static extern int AccessibleObjectFromEvent(IntPtr hwnd, int idObject, int idChild, [MarshalAs(UnmanagedType.Interface)] out IAccessible acc, [MarshalAs(UnmanagedType.Struct)] out object child);
        [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

        public const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_SYSTEM_DIALOGSTART = 0x0010, EVENT_SYSTEM_DIALOGEND = 0x0011,
            EVENT_OBJECT_NAMECHANGE = 0x800C, EVENT_OBJECT_VALUECHANGE = 0x800E, EVENT_OBJECT_INVOKED = 0x8013;
        public const uint WINEVENT_OUTOFCONTEXT = 0, WINEVENT_SKIPOWNPROCESS = 2;
        public const int OBJID_WINDOW = 0, CHILDID_SELF = 0;
        public const uint GA_ROOT = 2;
        public const int ROLE_TEXT = 42, ROLE_COMBOBOX = 46, ROLE_PUSHBUTTON = 43, ROLE_MENUITEM = 12, ROLE_SPLITBUTTON = 62, ROLE_BUTTONDROPDOWN = 56, ROLE_SPINBUTTON = 52;
        public const int STATE_PROTECTED = 0x20000000, STATE_READONLY = 0x40;

        public static string WindowText(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
        public static string ClassName(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
    }

    /* ---------- process names, cached ---------- */
    static class Procs
    {
        static readonly Dictionary<uint, string[]> Cache = new Dictionary<uint, string[]>();
        public static readonly uint Self = (uint)Process.GetCurrentProcess().Id;
        public static string[] Of(IntPtr hwnd)
        {
            uint pid; Native.GetWindowThreadProcessId(hwnd, out pid);
            lock (Cache)
            {
                string[] r;
                if (Cache.TryGetValue(pid, out r)) return r;
                string name = "", desc = "";
                try
                {
                    var p = Process.GetProcessById((int)pid);
                    name = p.ProcessName;
                    try { desc = p.MainModule.FileVersionInfo.FileDescription ?? ""; } catch { }
                }
                catch { }
                r = new[] { name, desc, pid.ToString() };
                if (Cache.Count > 500) Cache.Clear();
                Cache[pid] = r;
                return r;
            }
        }
    }

    /* ---------- WinEvent hooks + accessibility, handled on a worker thread ---------- */
    class WinCapture : IDisposable
    {
        readonly Recorder rec;
        readonly List<IntPtr> hooks = new List<IntPtr>();
        readonly Native.WinEventDelegate cb;           // kept alive for the hook's lifetime
        readonly BlockingCollection<Action> work = new BlockingCollection<Action>(2000);
        readonly Dictionary<string, int> lastValue = new Dictionary<string, int>();
        IntPtr openDialog = IntPtr.Zero;
        static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc" };
        static readonly Regex PickerTitle = new Regex(@"^(open|upload|attach|insert|choose|browse|import|select)\b", RegexOptions.IgnoreCase);
        public bool WatchBrowserFields = false; // web apps are covered in detail by the browser extension

        public WinCapture(Recorder rec)
        {
            this.rec = rec;
            cb = OnEvent;
            var t = new Thread(Worker) { IsBackground = true, Name = "wd-capture" };
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }

        public void Start()
        {
            uint f = Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS;
            foreach (var r in new[] {
                new[] { Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND },
                new[] { Native.EVENT_SYSTEM_DIALOGSTART, Native.EVENT_SYSTEM_DIALOGEND },
                new[] { Native.EVENT_OBJECT_NAMECHANGE, Native.EVENT_OBJECT_NAMECHANGE },
                new[] { Native.EVENT_OBJECT_VALUECHANGE, Native.EVENT_OBJECT_VALUECHANGE },
                new[] { Native.EVENT_OBJECT_INVOKED, Native.EVENT_OBJECT_INVOKED } })
            {
                var h = Native.SetWinEventHook(r[0], r[1], IntPtr.Zero, cb, 0, 0, f);
                if (h == IntPtr.Zero) Log.Write("SetWinEventHook failed for 0x" + r[0].ToString("X"));
                else hooks.Add(h);
            }
            var fg = Native.GetForegroundWindow();
            Enqueue(() => Foreground(fg));
        }

        void Enqueue(Action a) { if (!work.IsAddingCompleted) work.TryAdd(a); }

        void Worker()
        {
            foreach (var a in work.GetConsumingEnumerable())
            {
                try { a(); } catch (Exception e) { Log.Write("capture: " + e.GetType().Name + ": " + e.Message); }
            }
        }

        // Runs on the UI thread for every event; keep it cheap and hand off.
        void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (hwnd == IntPtr.Zero) return;
            switch (ev)
            {
                case Native.EVENT_SYSTEM_FOREGROUND:
                    Enqueue(() => Foreground(hwnd)); break;
                case Native.EVENT_OBJECT_NAMECHANGE:
                    if (idObject == Native.OBJID_WINDOW && idChild == Native.CHILDID_SELF && hwnd == Native.GetForegroundWindow())
                        Enqueue(() => Foreground(hwnd));
                    break;
                case Native.EVENT_OBJECT_VALUECHANGE:
                    {
                        var fg = Native.GetForegroundWindow();
                        if (Native.GetAncestor(hwnd, Native.GA_ROOT) != fg) return;      // only the window in front
                        string key = hwnd.ToInt64() + ":" + idObject + ":" + idChild;
                        int now = Environment.TickCount, last;
                        if (lastValue.TryGetValue(key, out last) && now - last < 700) return;  // one note per field per burst of typing
                        lastValue[key] = now;
                        if (lastValue.Count > 300) lastValue.Clear();
                        Enqueue(() => ValueChanged(hwnd, idObject, idChild));
                        break;
                    }
                case Native.EVENT_OBJECT_INVOKED:
                    if (Native.GetAncestor(hwnd, Native.GA_ROOT) == Native.GetForegroundWindow())
                        Enqueue(() => Invoked(hwnd, idObject, idChild));
                    break;
                case Native.EVENT_SYSTEM_DIALOGSTART:
                    Enqueue(() => { if (Native.ClassName(hwnd) == "#32770" && PickerTitle.IsMatch(Native.WindowText(hwnd))) openDialog = hwnd; });
                    break;
                case Native.EVENT_SYSTEM_DIALOGEND:
                    Enqueue(() => { if (hwnd == openDialog) { openDialog = IntPtr.Zero; rec.OnUpload(); } });
                    break;
            }
        }

        void Foreground(IntPtr hwnd)
        {
            var p = Procs.Of(hwnd);
            if (p[2] == Procs.Self.ToString()) return;
            rec.OnForeground(p[0], p[1], Native.WindowText(hwnd));
        }

        bool SameAppInFront(IntPtr hwnd)
        {
            var p = Procs.Of(hwnd);
            if (Browsers.Contains(p[0]) && !WatchBrowserFields) return false;
            if (string.Equals(p[0], "excel", StringComparison.OrdinalIgnoreCase) && OfficeWatch.ExcelAttached) return false; // Excel's own events are better
            return string.Equals(p[0], rec.CurrentProc, StringComparison.OrdinalIgnoreCase);
        }

        void ValueChanged(IntPtr hwnd, int idObject, int idChild)
        {
            if (!SameAppInFront(hwnd)) return;
            IAccessible acc; object child;
            if (Native.AccessibleObjectFromEvent(hwnd, idObject, idChild, out acc, out child) != 0 || acc == null) return;
            try
            {
                int role = ToInt(acc.get_accRole(child));
                if (role != Native.ROLE_TEXT && role != Native.ROLE_COMBOBOX && role != Native.ROLE_SPINBUTTON) return;
                int state = ToInt(acc.get_accState(child));
                if ((state & Native.STATE_READONLY) != 0) return;
                bool sensitive = (state & Native.STATE_PROTECTED) != 0;
                string name = null, value = null;
                try { name = acc.get_accName(child); } catch { }
                try { value = acc.get_accValue(child); } catch { }
                if (name != null && value != null && name.Trim() == value.Trim()) name = null;   // some apps put the contents in the name: never keep it
                value = null;
                rec.OnFieldEdited(name, sensitive);
            }
            finally { Marshal.ReleaseComObject(acc); }
        }

        void Invoked(IntPtr hwnd, int idObject, int idChild)
        {
            if (!SameAppInFront(hwnd) && !string.Equals(Procs.Of(hwnd)[0], "excel", StringComparison.OrdinalIgnoreCase)) return;
            IAccessible acc; object child;
            if (Native.AccessibleObjectFromEvent(hwnd, idObject, idChild, out acc, out child) != 0 || acc == null) return;
            try
            {
                int role = ToInt(acc.get_accRole(child));
                if (role != Native.ROLE_PUSHBUTTON && role != Native.ROLE_MENUITEM && role != Native.ROLE_SPLITBUTTON && role != Native.ROLE_BUTTONDROPDOWN) return;
                string name = null;
                try { name = acc.get_accName(child); } catch { }
                if (!string.IsNullOrEmpty(name)) rec.OnButton(name);
            }
            finally { Marshal.ReleaseComObject(acc); }
        }

        static int ToInt(object o) { try { return Convert.ToInt32(o); } catch { return -1; } }

        public void Dispose()
        {
            foreach (var h in hooks) Native.UnhookWinEvent(h);
            hooks.Clear();
            work.CompleteAdding();
        }
    }

    /* ---------- clipboard: kind of thing copied, never the thing ---------- */
    class ClipboardWatch : NativeWindow, IDisposable
    {
        const int WM_CLIPBOARDUPDATE = 0x031D;
        readonly Recorder rec;
        public ClipboardWatch(Recorder rec)
        {
            this.rec = rec;
            CreateHandle(new CreateParams());
            if (!Native.AddClipboardFormatListener(Handle)) Log.Write("AddClipboardFormatListener failed");
        }
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_CLIPBOARDUPDATE) { try { OnChange(); } catch (Exception e) { Log.Write("clipboard: " + e.Message); } }
            base.WndProc(ref m);
        }
        void OnChange()
        {
            var owner = Native.GetClipboardOwner();
            if (owner != IntPtr.Zero && Procs.Of(owner)[2] == Procs.Self.ToString()) return;
            string text = null; bool files = false;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    if (Clipboard.ContainsFileDropList()) files = true;
                    else if (Clipboard.ContainsText()) text = Clipboard.GetText();
                    else if (Clipboard.ContainsImage()) text = "";
                    break;
                }
                catch (ExternalException) { Thread.Sleep(40); }   // another app has it open
            }
            rec.OnCopy(text, files);
            text = null;
        }
        public void Dispose() { Native.RemoveClipboardFormatListener(Handle); DestroyHandle(); }
    }

    /* ---------- Excel and classic Outlook ---------- */
    [ComVisible(true), Guid("00024413-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IExcelAppEvents
    {
        [DispId(1564)] void SheetChange([In, MarshalAs(UnmanagedType.IDispatch)] object sh, [In, MarshalAs(UnmanagedType.IDispatch)] object target);
        [DispId(1570)] void WorkbookBeforeClose([In, MarshalAs(UnmanagedType.IDispatch)] object wb, [In, Out] ref bool cancel);
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public class ExcelSink : IExcelAppEvents
    {
        readonly Recorder rec; readonly Action closing;
        public ExcelSink(Recorder rec, Action closing) { this.rec = rec; this.closing = closing; }

        public void SheetChange(object sh, object target)
        {
            var heads = new List<string>(); string sheet = "", book = ""; int cells = 1;
            try
            {
                dynamic s = sh, r = target;
                sheet = s.Name;
                dynamic wb = s.Parent; book = wb.Name; Marshal.ReleaseComObject(wb);
                cells = (int)Math.Min(1000.0, (double)r.CountLarge);
                int row = r.Row, col = r.Column;
                dynamic cols = r.Columns; int ncols = cols.Count; Marshal.ReleaseComObject(cols);
                if (row > 1)
                    for (int c = col; c < col + Math.Min(ncols, 6); c++)
                    {
                        dynamic cell = s.Cells[1, c];
                        string h = Convert.ToString(cell.Text);
                        Marshal.ReleaseComObject(cell);
                        string clean = Privacy.CleanLabel(h);
                        // a heading is a word, not a number or date; otherwise call it by its column letter
                        if (clean.Length == 0 || Regex.IsMatch(clean, @"^[#$€£.,/:\s-]+$")) clean = "Column " + ColName(c);
                        heads.Add(clean);
                    }
            }
            catch (Exception e) { Log.Write("excel change: " + e.Message); }
            finally
            {
                try { Marshal.ReleaseComObject(target); } catch { }
                try { Marshal.ReleaseComObject(sh); } catch { }
            }
            rec.OnExcelChange(book, sheet, heads, cells);
        }

        public void WorkbookBeforeClose(object wb, ref bool cancel)
        {
            try { Marshal.ReleaseComObject(wb); } catch { }
            closing();
        }

        static string ColName(int c) { string s = ""; while (c > 0) { int m = (c - 1) % 26; s = (char)('A' + m) + s; c = (c - 1) / 26; } return s; }
    }

    class OfficeWatch : IDisposable
    {
        public static bool ExcelAttached;
        readonly Recorder rec;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 3000 };
        object excel; IConnectionPoint cp; int cookie; ExcelSink sink;
        string lastSubject;
        int closeCountdown = -1;

        public OfficeWatch(Recorder rec)
        {
            this.rec = rec;
            timer.Tick += (s, e) => { try { Tick(); } catch (Exception ex) { Log.Write("office: " + ex.Message); } };
            timer.Start();
        }

        void Tick()
        {
            string front = rec.CurrentProc ?? "";
            // Excel: attach while the person is using it; let go when it closes so Excel can exit normally
            if (closeCountdown > 0 && --closeCountdown == 0) DetachExcel();
            if (excel == null && front == "excel" && closeCountdown < 0) AttachExcel();
            if (excel != null && Process.GetProcessesByName("EXCEL").Length == 0) DetachExcel();
            if (excel != null)
            {
                try { dynamic app = excel; dynamic wbs = app.Workbooks; int n = wbs.Count; Marshal.ReleaseComObject(wbs); if (n == 0) DetachExcel(); }
                catch { DetachExcel(); }
            }
            if (closeCountdown == 0) closeCountdown = -1;
            // Outlook (classic): the selected email's subject, while Outlook is in front
            if (front == "outlook") ReadOutlookSelection();
        }

        void AttachExcel()
        {
            try
            {
                excel = Marshal.GetActiveObject("Excel.Application");
                var cpc = (IConnectionPointContainer)excel;
                Guid iid = typeof(IExcelAppEvents).GUID;
                cpc.FindConnectionPoint(ref iid, out cp);
                sink = new ExcelSink(rec, () => { closeCountdown = 2; });
                cp.Advise(sink, out cookie);
                ExcelAttached = true;
                Log.Write("Excel connected");
            }
            catch (Exception e)
            {
                // Common right after Excel starts (it registers itself a moment later) or when Office is locked down.
                if (excel != null) { try { Marshal.ReleaseComObject(excel); } catch { } }
                excel = null; cp = null; ExcelAttached = false;
                Log.Write("Excel not connected yet: " + e.Message);
            }
        }

        void DetachExcel()
        {
            try { if (cp != null) cp.Unadvise(cookie); } catch { }
            try { if (cp != null) Marshal.ReleaseComObject(cp); } catch { }
            try { if (excel != null) Marshal.ReleaseComObject(excel); } catch { }
            cp = null; excel = null; sink = null; ExcelAttached = false;
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        }

        void ReadOutlookSelection()
        {
            object ol = null;
            try
            {
                ol = Marshal.GetActiveObject("Outlook.Application");
                dynamic app = ol;
                dynamic exp = app.ActiveExplorer();
                if (exp == null) return;
                dynamic sel = exp.Selection;
                string subject = null;
                if (sel.Count >= 1)
                {
                    dynamic item = sel.Item(1);
                    try { if ((int)item.Class == 43) subject = item.Subject; } finally { Marshal.ReleaseComObject(item); }   // 43 = mail item
                }
                Marshal.ReleaseComObject(sel); Marshal.ReleaseComObject(exp);
                if (subject != null && subject != lastSubject) { lastSubject = subject; rec.OnOutlookItem(subject); }
            }
            catch { /* new Outlook or no selection: window titles still work */ }
            finally { if (ol != null) try { Marshal.ReleaseComObject(ol); } catch { } }
        }

        public void Dispose() { timer.Stop(); DetachExcel(); }
    }

    /* ---------- new files in Downloads / Desktop / Documents (type only) ---------- */
    class FileWatch : IDisposable
    {
        readonly List<FileSystemWatcher> ws = new List<FileSystemWatcher>();
        readonly Recorder rec;
        readonly Dictionary<string, DateTime> seen = new Dictionary<string, DateTime>();

        [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);

        public FileWatch(Recorder rec)
        {
            this.rec = rec;
            Add(Downloads(), "Downloads", false);
            Add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Desktop", false);
            Add(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Documents", true);
        }

        static string Downloads()
        {
            IntPtr p;
            if (SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out p) == 0)
            {
                string s = Marshal.PtrToStringUni(p); Marshal.FreeCoTaskMem(p); return s;
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }

        void Add(string dir, string where, bool sub)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;
            var w = new FileSystemWatcher(dir) { IncludeSubdirectories = sub, NotifyFilter = NotifyFilters.FileName };
            w.Created += (s, e) => Seen(e.FullPath, e.Name, where);
            w.Renamed += (s, e) => Seen(e.FullPath, e.Name, where);   // browsers finish downloads with a rename
            w.EnableRaisingEvents = true;
            ws.Add(w);
        }

        void Seen(string full, string name, string where)
        {
            lock (seen)
            {
                DateTime t;
                if (seen.TryGetValue(full, out t) && (DateTime.Now - t).TotalSeconds < 10) return;
                seen[full] = DateTime.Now;
                if (seen.Count > 200) seen.Clear();
            }
            try { if (Directory.Exists(full)) return; } catch { }
            rec.OnFileCreated(Path.GetFileName(name), where);
        }

        public void Dispose() { foreach (var w in ws) w.Dispose(); }
    }

    /* ---------- tray icon, idle/lock, start with Windows ---------- */
    class WindowsApp : ApplicationContext
    {
        readonly KvStore kv; readonly EventStore store; readonly Recorder rec; readonly LocalServer server;
        readonly NotifyIcon tray = new NotifyIcon();
        readonly ToolStripMenuItem statusItem = new ToolStripMenuItem { Enabled = false };
        readonly ToolStripMenuItem pauseItem = new ToolStripMenuItem("Pause for 1 hour");
        WinCapture capture; ClipboardWatch clip; OfficeWatch office; FileWatch files;
        readonly System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer { Interval = 2000 };
        Icon iconOn, iconOff;
        bool idle; int ticks;
        readonly string dataDir;
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public static int Run(string data, string ui, int port, bool install)
        {
            bool created;
            using (var m = new Mutex(true, @"Local\WorkflowDetective", out created))
            {
                if (!created)
                {   // already running: just open the findings page
                    try { var info = Json.Obj(Json.Parse(File.ReadAllText(Path.Combine(data, "server.json")))); Open((string)info["url"]); } catch { }
                    return 0;
                }
                if (install && InstallSelf(m)) return 0;   // the installed copy takes over from here
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new WindowsApp(data, ui, port));
                return 0;
            }
        }

        WindowsApp(string data, string ui, int port)
        {
            dataDir = data;
            kv = new KvStore(data); store = new EventStore(data);
            var clock = new SystemClock();
            rec = new Recorder(kv, store, clock);
            server = new LocalServer(kv, store, clock, ui, Program.Version);
            server.Start(port);
            File.WriteAllText(Path.Combine(data, "server.json"), Json.Write(new Dictionary<string, object> { { "url", server.Url("report.html") } }));
            Log.Write("started v" + Program.Version + " on port " + server.Port);

            if (!kv.Settings().Consented) TakeInviteFromClipboard();
            iconOff = MakeIcon(false); iconOn = MakeIcon(true);
            var menu = new ContextMenuStrip();
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open my findings", null, (s, e) => Open(server.Url(kv.Settings().Consented ? "report.html" : "onboarding.html")));
            menu.Items.Add(pauseItem);
            pauseItem.Click += (s, e) =>
            {
                var st = kv.Settings();
                kv.PatchSettings("pausedUntil", st.PausedUntil > Now() ? 0.0 : Now() + 3600000);
                UpdateStatus();
            };
            menu.Items.Add("Settings and privacy", null, (s, e) => Open(server.Url("onboarding.html")));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit (stops watching until you open it again)", null, (s, e) => ExitThread());
            tray.ContextMenuStrip = menu;
            tray.Icon = iconOff;
            tray.Visible = true;
            tray.DoubleClick += (s, e) => Open(server.Url(kv.Settings().Consented ? "report.html" : "onboarding.html"));
            var uiCtx = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            kv.Changed += () => uiCtx.Post(_ => { try { UpdateStatus(); } catch (Exception ex) { Log.Write("status: " + ex.Message); } }, null);

            capture = new WinCapture(rec); capture.Start();
            clip = new ClipboardWatch(rec);
            office = new OfficeWatch(rec);
            try { files = new FileWatch(rec); } catch (Exception e) { Log.Write("file watch: " + e.Message); }
            SystemEvents.SessionSwitch += OnSessionSwitch;

            tick.Tick += (s, e) => Tick();
            tick.Start();
            UpdateStatus();
            if (!kv.Settings().Consented) Open(server.Url("onboarding.html"));
        }

        static double Now() { return DateTimeOffset.Now.ToUnixTimeMilliseconds(); }

        /// The personal setup page copies the participant's invite code just before the download. If it's still on
        /// the clipboard at first launch, setup opens with everything filled in. Nothing else on the clipboard is kept.
        void TakeInviteFromClipboard()
        {
            try
            {
                if (!Clipboard.ContainsText()) return;
                var m = Regex.Match(Clipboard.GetText(), @"WD1\.[A-Za-z0-9_-]{8,}\.[a-z0-9]{1,8}");
                if (m.Success) { kv.Merge(new Dictionary<string, object> { { "pendingInvite", m.Value } }); Log.Write("invite code picked up from the clipboard"); }
            }
            catch (Exception e) { Log.Write("invite from clipboard: " + e.Message); }
        }
        static void Open(string url) { try { Process.Start(url); } catch (Exception e) { Log.Write("open browser: " + e.Message); } }

        void OnSessionSwitch(object s, SessionSwitchEventArgs e)
        {
            if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.ConsoleDisconnect) rec.OnAway();
            else if (e.Reason == SessionSwitchReason.SessionUnlock || e.Reason == SessionSwitchReason.ConsoleConnect) rec.OnActive();
        }

        void Tick()
        {
            rec.Tick();
            var lii = new Native.LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(Native.LASTINPUTINFO)) };
            if (Native.GetLastInputInfo(ref lii))
            {
                uint idleMs = unchecked((uint)Environment.TickCount - lii.dwTime);
                if (idleMs > 120000 && !idle) { idle = true; rec.OnAway(); }
                else if (idleMs < 5000 && idle) { idle = false; rec.OnActive(); }
            }
            if (++ticks % 15 == 0) UpdateStatus();   // every 30 s
        }

        void UpdateStatus()
        {
            var s = kv.Settings();
            var st = Schedule.Status(s, DateTime.Now, Now());
            statusItem.Text = st.Label + (st.Total > 0 ? "  ·  " + st.Done + " of " + st.Total + " days done" : "");
            pauseItem.Text = st.State == "paused" ? "Resume watching" : "Pause for 1 hour";
            pauseItem.Enabled = st.State == "active" || st.State == "paused" || st.State == "later" || st.State == "off";
            string tip = "Workflow Detective · " + st.Label;
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            tray.Icon = st.State == "active" ? iconOn : iconOff;
            AutoStart(s.Consented && !s.Withdrawn);
            Retention(s);
        }

        /// First run from Downloads (or anywhere else): copy ourselves to %LOCALAPPDATA%\Programs\WorkflowDetective, add a
        /// Start menu shortcut, and start that copy, so the study keeps running even if the Downloads folder is cleaned
        /// out. No admin rights needed. A newer download replaces the installed copy. Returns true if the copy started.
        static bool InstallSelf(Mutex running)
        {
            try
            {
                string me = Assembly.GetExecutingAssembly().Location;
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "WorkflowDetective");
                string target = Path.Combine(dir, "WorkflowDetective.exe");
                if (string.Equals(Path.GetFullPath(me), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) return false;
                Directory.CreateDirectory(dir);
                byte[] bytes = File.ReadAllBytes(me);
                if (!File.Exists(target) || !SameBytes(bytes, File.ReadAllBytes(target)))
                    File.WriteAllBytes(target, bytes);   // a plain write leaves out the "downloaded from the internet" mark, so no second warning
                try
                {
                    string lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Workflow Detective.lnk");
                    dynamic sh = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                    dynamic sc = sh.CreateShortcut(lnk);
                    sc.TargetPath = target; sc.WorkingDirectory = dir; sc.Description = "Workflow Detective pilot";
                    sc.Save();
                }
                catch (Exception e) { Log.Write("shortcut: " + e.Message); }
                Log.Write("installed to " + target);
                running.ReleaseMutex();   // let the installed copy take the one-copy-at-a-time lock
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(target) { UseShellExecute = false, WorkingDirectory = dir });
                return true;
            }
            catch (Exception e) { Log.Write("install: " + e.Message); return false; }   // keep running from where we are
        }
        static bool SameBytes(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        void AutoStart(bool on)
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (k == null) return;
                    string exe = "\"" + Assembly.GetExecutingAssembly().Location + "\"";
                    if (on && (string)k.GetValue("WorkflowDetective") != exe) k.SetValue("WorkflowDetective", exe);
                    if (!on && k.GetValue("WorkflowDetective") != null) k.DeleteValue("WorkflowDetective");
                }
            }
            catch (Exception e) { Log.Write("autostart: " + e.Message); }
        }

        void Retention(StudySettings s)
        {
            var end = Schedule.End(s);
            if (s.Consented && end != null && s.PurgedAt == 0 && DateTime.Now > end.Value.AddDays(s.RetentionDaysAfter))
            {
                store.Clear(); kv.PatchSettings("purgedAt", Now());
                Log.Write("retention: activity log deleted");
            }
        }

        static Icon MakeIcon(bool on)
        {
            var bmp = new Bitmap(32, 32);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (var b = new SolidBrush(Color.FromArgb(28, 90, 134))) g.FillRectangle(b, 1, 1, 30, 30);
                using (var p = new Pen(Color.White, 3)) { g.DrawEllipse(p, 6, 6, 15, 15); }
                using (var p = new Pen(Color.White, 4)) { g.DrawLine(p, 19, 19, 27, 27); }
                using (var p = new Pen(Color.FromArgb(255, 226, 122), 3)) { g.DrawLine(p, 9, 13, 18, 13); }
                if (on) using (var b = new SolidBrush(Color.FromArgb(46, 204, 113))) g.FillEllipse(b, 20, 1, 11, 11);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        protected override void ExitThreadCore()
        {
            try { rec.OnAway(); } catch { }
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            if (capture != null) capture.Dispose();
            if (clip != null) clip.Dispose();
            if (office != null) office.Dispose();
            if (files != null) files.Dispose();
            tray.Visible = false;
            tray.Dispose();
            base.ExitThreadCore();
        }
    }
}
