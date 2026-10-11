// Built-in checks that run on any OS:  WorkflowDetective.exe --selftest [--parity cases.json]
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;

namespace WorkflowDetective
{
    public static class SelfTest
    {
        static int pass, fail;
        static void Check(string name, bool ok, string detail)
        {
            if (ok) pass++; else fail++;
            Console.WriteLine((ok ? "✓ " : "✗ ") + name + (ok || detail == null ? "" : "  — " + detail));
        }

        public static int Run(string parityFile)
        {
            Console.OutputEncoding = Encoding.UTF8;
            // privacy
            Check("titles lose numbers and emails", Privacy.RedactTitle("Payment received from Acme - Invoice 1042 - pat@acme.com - Outlook") == "Payment received from Acme - Invoice # - Outlook", Privacy.RedactTitle("Payment received from Acme - Invoice 1042 - pat@acme.com - Outlook"));
            Check("phone numbers removed", !Privacy.RedactTitle("Call (512) 555-0199 back").Contains("555"), null);
            Check("labels cleaned", Privacy.CleanLabel("customer_name 2") == "customer name #", Privacy.CleanLabel("customer_name 2"));
            Check("kind: number", Privacy.KindOf("$1,200.00") == "number", Privacy.KindOf("$1,200.00"));
            Check("kind: date", Privacy.KindOf("10/14/2026") == "date", null);
            Check("kind: cells", Privacy.KindOf("a\tb\nc\td") == "table", null);
            Check("kind: email", Privacy.KindOf("pat@acme.com") == "email", null);
            Check("sensitive labels", Privacy.IsSensitiveLabel("Card number") && Privacy.IsSensitiveLabel("Password") && !Privacy.IsSensitiveLabel("Customer"), null);

            // app names
            var x = AppNames.Name("EXCEL", "Microsoft Excel", "AR Tracker 2026.xlsx - Excel");
            Check("Excel window → app + file", x.App == "Excel" && x.Page == "AR Tracker 2026.xlsx", x.App + " | " + x.Page);
            var e = AppNames.Name("msedge", "Microsoft Edge", "Inbox (3) - dana@northline.com - Gmail and 4 more pages - Work - Microsoft​ Edge");
            Check("Edge tab → web app", e.App == "Gmail" && e.IsBrowser && !e.Page.Contains("Edge") && !e.Page.Contains("more pages"), e.App + " | " + e.Page);
            var c = AppNames.Name("chrome", "Google Chrome", "Invoice - QuickBooks - Google Chrome");
            Check("Chrome tab → web app", c.App == "QuickBooks", c.App);
            var u = AppNames.Name("SageAcct", "Sage Accounting", "Sage");
            Check("unknown app uses its description", u.App == "Sage Accounting", u.App);
            Check("password managers never watched", AppNames.NeverWatch("1password") && AppNames.NeverWatch("KeePass"), null);

            // json
            var j = Json.Parse("{\"a\":[1,2.5,\"x\\n\\u00e9\",true,null],\"b\":{\"t\":1760000000000}}") as Dictionary<string, object>;
            Check("JSON round trip", Json.Write(j) == "{\"a\":[1,2.5,\"x\\né\",true,null],\"b\":{\"t\":1760000000000}}", Json.Write(j));

            // recorder
            string dir = Path.Combine(Path.GetTempPath(), "wd-selftest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                var kv = new KvStore(dir); var store = new EventStore(dir);
                var now = new DateTime(2026, 10, 14, 10, 0, 0); // Wednesday
                kv.Merge(new Dictionary<string, object> { { "settings", new Dictionary<string, object> { { "consented", true }, { "startDate", "2026-10-12" }, { "weeks", 2.0 }, { "scheduleMode", "rotate" }, { "hourStart", 8.0 }, { "hourEnd", 18.0 }, { "blocked", new List<object> { "spotify", "reddit.com" } } } } });
                var clock = new FakeClock(now);
                var rec = new Recorder(kv, store, clock);
                rec.OnForeground("OUTLOOK", "Microsoft Outlook", "Inbox - dana@x.com - Outlook");
                rec.OnOutlookItem("Payment received from Acme - Invoice 1042");
                rec.OnCopy("1,200.00", false); clock.Add(5);
                rec.OnForeground("EXCEL", "Microsoft Excel", "AR Tracker.xlsx - Excel"); clock.Add(3);
                rec.OnExcelChange("AR Tracker.xlsx", "Payments", new[] { "Amount" }, 1); clock.Add(2);
                rec.OnExcelChange("AR Tracker.xlsx", "Payments", new[] { "Client" }, 1); clock.Add(5); rec.Tick();
                rec.OnForeground("QBW32", "QuickBooks", "Create Invoices - QuickBooks Desktop Pro 2024");
                rec.OnFieldEdited("Customer:Job", false); clock.Add(1); rec.OnFieldEdited("Customer:Job", false); clock.Add(1);
                rec.OnFieldEdited("Password", true); clock.Add(1); rec.OnFieldEdited("Rate", false);
                rec.OnButton("Save & Close");
                rec.OnForeground("Spotify", "Spotify", "Spotify Premium"); rec.OnCopy("song", false);
                rec.OnForeground("chrome", "Google Chrome", "r/accounting - Reddit - Google Chrome"); rec.OnCopy("post", false);
                rec.OnForeground("1Password", "1Password", "1Password"); rec.OnCopy("hunter2", false);
                var all = store.All();
                var types = new List<string>(); foreach (var o in all) types.Add(Json.GetString(o as Dictionary<string, object>, "type", ""));
                string dump = Json.Write(all);
                Check("copy recorded in Outlook", dump.Contains("\"type\":\"copy\",\"app\":\"Outlook\""), null);
                Check("edit in Excel after copy becomes one inferred paste", types.FindAll(t => t == "paste").Count == 1 && dump.Contains("\"inferred\":true") && dump.Contains("\"field\":\"Amount\""), string.Join(",", types.ToArray()));
                Check("Excel edits batched with column headings", dump.Contains("\"labels\":[\"Amount\",\"Client\"]"), null);
                Check("Excel page is workbook › sheet", dump.Contains("AR Tracker.xlsx › Payments"), null);
                Check("Outlook email subject used as the title, numbers removed", dump.Contains("Payment received from Acme - Invoice #"), null);
                Check("QuickBooks fields batched; password counted not named", dump.Contains("\"labels\":[\"Customer:Job\",\"Rate\"]") && dump.Contains("\"sensitive\":1") && !dump.Contains("Password\""), null);
                Check("button click recorded", dump.Contains("\"label\":\"Save & Close\""), null);
                Check("blocked apps and sites and password managers record nothing", !dump.Contains("Spotify") && !dump.Contains("Reddit") && !dump.Contains("1Password"), null);
                Check("copied text never stored", !dump.Contains("1,200") && !dump.Contains("hunter2") && !dump.Contains("song"), null);
                int before = all.Count;
                clock.T = new DateTime(2026, 10, 14, 19, 0, 0); // after hours
                rec.OnForeground("EXCEL", "Microsoft Excel", "Other.xlsx - Excel"); rec.OnCopy("9", false);
                clock.T = new DateTime(2026, 10, 13, 10, 0, 0); // Tuesday of week 1: not a watch day
                rec.OnForeground("EXCEL", "Microsoft Excel", "Tuesday.xlsx - Excel"); rec.OnCopy("9", false);
                Check("nothing recorded after hours or on non-watch days", store.All().Count == before, store.All().Count + " vs " + before);
                clock.T = now.AddMinutes(30);
                kv.PatchSettings("pausedUntil", clock.NowMs() + 3600000);
                rec.OnForeground("EXCEL", "Microsoft Excel", "Paused.xlsx - Excel"); rec.OnCopy("9", false);
                Check("pausing stops recording", store.All().Count == before, null);
                var ids = new HashSet<long>(); ids.Add(1); ids.Add(2);
                store.Delete(ids);
                Check("deleting log lines works", store.All().Count == before - 2, null);

                // local server security
                var server = new LocalServer(kv, store, clock, null, Program.Version);
                server.Start(47900);
                Check("server refuses requests without the token", Http(server.Port, "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:" + server.Port + "\r\n\r\n").StartsWith("HTTP/1.1 403"), null);
                Check("server refuses other hostnames (DNS rebinding)", Http(server.Port, "GET /?k=" + server.Token + " HTTP/1.1\r\nHost: evil.example:" + server.Port + "\r\n\r\n").StartsWith("HTTP/1.1 403"), null);
                string login = Http(server.Port, "GET /report.html?k=" + server.Token + " HTTP/1.1\r\nHost: 127.0.0.1:" + server.Port + "\r\n\r\n");
                Check("token link sets a cookie and redirects", login.StartsWith("HTTP/1.1 302") && login.Contains("Set-Cookie: wdk=" + server.Token) && login.Contains("SameSite=Strict"), login.Split('\n')[0]);
                string api = Http(server.Port, "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:" + server.Port + "\r\nCookie: wdk=" + server.Token + "\r\n\r\n");
                Check("with the cookie, the log is readable", api.StartsWith("HTTP/1.1 200") && api.Contains("\"type\":\"copy\""), api.Split('\n')[0]);
                string cross = Http(server.Port, "POST /api/events/clear HTTP/1.1\r\nHost: 127.0.0.1:" + server.Port + "\r\nOrigin: https://evil.example\r\nCookie: wdk=" + server.Token + "\r\nContent-Length: 2\r\n\r\n{}");
                Check("writes from other websites are refused", cross.StartsWith("HTTP/1.1 403") && store.All().Count > 0, null);
            }
            finally { try { Directory.Delete(dir, true); } catch { } }

            // schedule parity with extension/lib/settings.js
            if (parityFile != null)
            {
                var cases = Json.Parse(File.ReadAllText(parityFile)) as List<object>;
                int bad = 0; string firstBad = null;
                foreach (var o in cases)
                {
                    var cs = o as Dictionary<string, object>;
                    var s = StudySettings.From(cs["settings"] as Dictionary<string, object>);
                    var now = Schedule.ParseDate(Json.GetString(cs, "date", null)).Value.AddMinutes(Json.GetNumber(cs, "minute", 0));
                    double nowMs = new DateTimeOffset(now).ToUnixTimeMilliseconds();
                    bool active = Schedule.IsActiveNow(s, now, nowMs);
                    var st = Schedule.Status(s, now, nowMs);
                    bool ok = active == Json.GetBool(cs, "active", false) && st.State == Json.GetString(cs, "state", "") && st.Total == (int)Json.GetNumber(cs, "total", -1) && st.Done == (int)Json.GetNumber(cs, "done", -1);
                    if (!ok) { bad++; if (firstBad == null) firstBad = Json.Write(cs) + " → C#: " + active + " " + st.State + " " + st.Total + " " + st.Done; }
                }
                Check("schedule matches the browser extension on " + cases.Count + " random cases", bad == 0, bad + " differ, e.g. " + firstBad);
            }

            Console.WriteLine();
            Console.WriteLine(fail == 0 ? "All " + pass + " self-checks passed" : fail + " FAILED, " + pass + " passed");
            return fail == 0 ? 0 : 1;
        }

        static string Http(int port, string raw)
        {
            using (var c = new TcpClient("127.0.0.1", port))
            {
                var ns = c.GetStream();
                var b = Encoding.UTF8.GetBytes(raw);
                ns.Write(b, 0, b.Length);
                var ms = new MemoryStream(); var buf = new byte[8192]; int n;
                c.ReceiveTimeout = 3000;
                try { while ((n = ns.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n); } catch { }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }
    }
}
