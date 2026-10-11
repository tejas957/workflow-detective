// Entry point.
//   WorkflowDetective.exe                    normal use on Windows: tray icon + background capture
//   WorkflowDetective.exe --serve            local pages + API only, no capture (any OS; used by tests)
//   WorkflowDetective.exe --simulate         write two simulated weeks through the real recorder (any OS)
//   WorkflowDetective.exe --selftest         built-in checks (any OS)
// Common options: --data <folder>  --port <n>  --ui <folder>  --start <yyyy-mm-dd>  --parity <cases.json>
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace WorkflowDetective
{
    public static class Program
    {
        public const string Version = "0.1.0";

        [STAThread]
        public static int Main(string[] args)
        {
            var opt = new Dictionary<string, string>();
            for (int i = 0; i < args.Length; i++)
                if (args[i].StartsWith("--")) opt[args[i].Substring(2)] = i + 1 < args.Length && !args[i + 1].StartsWith("--") ? args[++i] : "";

            string data;
            if (!opt.TryGetValue("data", out data))
                data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WorkflowDetective");
            Directory.CreateDirectory(data);
            Log.PathFile = Path.Combine(data, "log.txt");
            string ui; opt.TryGetValue("ui", out ui);
            int port = opt.ContainsKey("port") ? int.Parse(opt["port"]) : 47615;

            if (opt.ContainsKey("selftest")) return SelfTest.Run(opt.ContainsKey("parity") ? opt["parity"] : null);
            if (opt.ContainsKey("simulate")) return Simulation.Run(data, opt.ContainsKey("start") ? opt["start"] : "2026-10-12");
            if (opt.ContainsKey("serve"))
            {
                var kv = new KvStore(data); var store = new EventStore(data);
                var server = new LocalServer(kv, store, new SystemClock(), ui, Version);
                server.Start(port);
                Console.WriteLine(server.Url("onboarding.html"));
                Console.Out.Flush();
                Thread.Sleep(Timeout.Infinite);
                return 0;
            }
            if (Environment.OSVersion.Platform != PlatformID.Win32NT)
            {
                Console.WriteLine("Workflow Detective's capture runs on Windows. Use --serve, --simulate or --selftest elsewhere.");
                return 2;
            }
            bool install = !opt.ContainsKey("data") && !opt.ContainsKey("port") && !opt.ContainsKey("no-install");
            return WindowsApp.Run(data, ui, port, install);
        }
    }

    /* ---------- fake clock for tests and simulation ---------- */
    public class FakeClock : IClock
    {
        public DateTime T;
        public FakeClock(DateTime t) { T = t; }
        public double NowMs() { return new DateTimeOffset(T).ToUnixTimeMilliseconds(); }
        public DateTime Now() { return T; }
        public void Add(double seconds) { T = T.AddSeconds(seconds); }
    }

    /* ---------- simulated weeks: Outlook + Excel + QuickBooks Desktop + Teams ---------- */
    public static class Simulation
    {
        public static int Run(string data, string start)
        {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            var kv = new KvStore(data); var store = new EventStore(data);
            store.Clear();
            kv.Merge(new Dictionary<string, object> { { "settings", new Dictionary<string, object> {
                { "consented", true }, { "participant", "Dana R." }, { "company", "NORTHLINE (sample)" }, { "startDate", start }, { "weeks", 2.0 },
                { "scheduleMode", "rotate" }, { "hourStart", 8.0 }, { "hourEnd", 18.0 }, { "captureTitles", true }, { "captureFieldLabels", true },
                { "blocked", new List<object> { "spotify" } } } } });
            var s = kv.Settings();
            var rnd = new Random(42);
            var clock = new FakeClock(DateTime.Now);
            var rec = new Recorder(kv, store, clock);
            string[] clients = { "Acme Co", "Juniper Bakery", "Lumen Studio", "Northwind", "Harbor Foods" };
            foreach (var day in Schedule.AllWatchDays(s))
            {
                clock.T = day.AddHours(8).AddMinutes(30 + rnd.Next(15));
                var jobs = new List<KeyValuePair<DateTime, Action>>();
                Func<int, int, DateTime> at = (h0, h1) => day.AddMinutes(h0 * 60 + rnd.Next((h1 - h0) * 60));
                // daily A/R aging export from QuickBooks Desktop to Excel, ~9:00
                jobs.Add(new KeyValuePair<DateTime, Action>(day.AddHours(9).AddMinutes(rnd.Next(-8, 10)), () =>
                {
                    rec.OnForeground("QBW32", "QuickBooks", "A/R Aging Summary - Northline Supply - QuickBooks Desktop Pro 2024"); W(clock, rec, 20, 40, rnd);
                    rec.OnButton("Excel"); W(clock, rec, 3, 6, rnd); rec.OnButton("Export"); W(clock, rec, 8, 15, rnd);
                    rec.OnFileCreated("AR Aging " + day.ToString("yyyy-MM-dd") + ".xlsx", "Documents"); W(clock, rec, 3, 6, rnd);
                    rec.OnForeground("EXCEL", "Microsoft Excel", "AR Aging " + day.ToString("yyyy-MM-dd") + ".xlsx - Excel"); W(clock, rec, 60, 180, rnd);
                }));
                // payment emails in Outlook copied into the AR tracker in Excel
                int pay = 4 + rnd.Next(4);
                for (int i = 0; i < pay; i++) jobs.Add(new KeyValuePair<DateTime, Action>(at(9, 17), () =>
                {
                    string c = clients[rnd.Next(clients.Length)];
                    rec.OnForeground("OUTLOOK", "Microsoft Outlook", "Inbox - dana@northline.com - Outlook");
                    rec.OnOutlookItem("Payment received from " + c + " - Invoice " + (1000 + rnd.Next(500))); W(clock, rec, 15, 35, rnd);
                    string[] vals = { "1,200.00", c, "10/14/2026" }; string[] heads = { "Amount", "Client", "Date paid" };
                    for (int f = 0; f < 3; f++)
                    {
                        rec.OnCopy(vals[f], false); W(clock, rec, 2, 6, rnd);
                        rec.OnForeground("EXCEL", "Microsoft Excel", "AR Tracker 2026.xlsx - Excel"); W(clock, rec, 2, 5, rnd);
                        rec.OnExcelChange("AR Tracker 2026.xlsx", "Payments", new[] { heads[f] }, 1); W(clock, rec, 2, 5, rnd);
                        if (f < 2) { rec.OnForeground("OUTLOOK", "Microsoft Outlook", "Inbox - dana@northline.com - Outlook"); W(clock, rec, 1, 3, rnd); }
                    }
                }));
                // re-typing open orders from Excel into QuickBooks Desktop invoices
                int inv = 3 + rnd.Next(3);
                for (int i = 0; i < inv; i++) jobs.Add(new KeyValuePair<DateTime, Action>(at(10, 16), () =>
                {
                    rec.OnForeground("EXCEL", "Microsoft Excel", "Open orders.xlsx - Excel"); W(clock, rec, 40, 90, rnd);
                    rec.OnForeground("QBW32", "QuickBooks", "Create Invoices - Northline Supply - QuickBooks Desktop Pro 2024"); W(clock, rec, 5, 10, rnd);
                    foreach (var f in new[] { "Customer:Job", "Date", "Terms", "Item", "Quantity", "Rate" })
                        for (int k = 0; k < 3; k++) { rec.OnFieldEdited(f, false); W(clock, rec, 1, 4, rnd); }
                    rec.OnButton("Save & Close"); W(clock, rec, 5, 20, rnd);
                }));
                // answering invoice questions in Outlook
                int replies = 2 + rnd.Next(3);
                for (int i = 0; i < replies; i++) jobs.Add(new KeyValuePair<DateTime, Action>(at(9, 17), () =>
                {
                    rec.OnForeground("OUTLOOK", "Microsoft Outlook", "RE: Question about invoice " + (1000 + rnd.Next(500)) + " - Message (HTML)"); W(clock, rec, 5, 10, rnd);
                    rec.OnFieldEdited("Subject", false); W(clock, rec, 30, 90, rnd); rec.OnFieldEdited("Message", false); W(clock, rec, 60, 120, rnd);
                    rec.OnButton("Send"); W(clock, rec, 3, 6, rnd);
                }));
                jobs.Sort((a, b) => a.Key.CompareTo(b.Key));
                var lunch = day.AddHours(12).AddMinutes(rnd.Next(40)); bool lunched = false;
                foreach (var j in jobs)
                {
                    while (clock.T < j.Key) { Noise(clock, rec, rnd); if (!lunched && clock.T > lunch) { rec.OnAway(); clock.Add(1800 + rnd.Next(1200)); lunched = true; } }
                    j.Value();
                }
                while (clock.T < day.AddHours(17)) Noise(clock, rec, rnd);
                rec.OnAway();
            }
            Console.WriteLine("Simulated " + Schedule.AllWatchDays(s).Count + " watch days → " + store.All().Count + " events in " + data);
            return 0;
        }

        static void W(FakeClock clock, Recorder rec, int a, int b, Random rnd) { clock.Add(a + rnd.NextDouble() * (b - a)); rec.Tick(); }

        static void Noise(FakeClock clock, Recorder rec, Random rnd)
        {
            double k = rnd.NextDouble();
            if (k < 0.25) { rec.OnForeground("ms-teams", "Microsoft Teams", "Chat | Microsoft Teams"); W(clock, rec, 20, 90, rnd); rec.OnFieldEdited("Type a message", false); W(clock, rec, 5, 20, rnd); rec.OnButton("Send"); }
            else if (k < 0.4) { rec.OnForeground("chrome", "Google Chrome", "Industry news - Supply Chain Dive - Google Chrome"); W(clock, rec, 30, 200, rnd); }
            else if (k < 0.5) { rec.OnForeground("OUTLOOK", "Microsoft Outlook", "Inbox - dana@northline.com - Outlook"); rec.OnOutlookItem("Team lunch Friday?"); W(clock, rec, 15, 60, rnd); }
            else if (k < 0.58) { rec.OnForeground("EXCEL", "Microsoft Excel", "Budget 2026.xlsx - Excel"); rec.OnCopy("4,500", false); W(clock, rec, 3, 8, rnd); rec.OnExcelChange("Budget 2026.xlsx", "Q4", new[] { "Forecast" }, 1); W(clock, rec, 30, 120, rnd); }
            else if (k < 0.63) { rec.OnForeground("EXCEL", "Microsoft Excel", "Budget 2026.xlsx - Excel"); rec.OnCopy("Q4 numbers\t4500\t5200", false); W(clock, rec, 3, 8, rnd); rec.OnForeground("ms-teams", "Microsoft Teams", "Chat | Microsoft Teams"); rec.OnFieldEdited("Type a message", false); W(clock, rec, 5, 15, rnd); }
            else if (k < 0.66) { rec.OnForeground("Spotify", "Spotify", "Spotify Premium"); W(clock, rec, 10, 30, rnd); }
            else if (k < 0.68) { rec.OnForeground("1Password", "1Password", "1Password"); rec.OnCopy("hunter2-secret", false); W(clock, rec, 3, 8, rnd); }
            else if (k < 0.72) { rec.OnForeground("explorer", "Windows Explorer", "Documents - File Explorer"); W(clock, rec, 10, 40, rnd); }
            else W(clock, rec, 60, 240, rnd);
            W(clock, rec, 20, 150, rnd);
        }
    }
}
