// A tiny web server bound to 127.0.0.1 only. It serves the setup and findings pages (the same pages the
// browser extension uses) and a small JSON API over the local log. A secret token, set as a cookie when the
// app opens the page, keeps other programs and websites from reading it.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace WorkflowDetective
{
    public class LocalServer
    {
        public int Port;
        public string Token;
        readonly KvStore kv;
        readonly EventStore store;
        readonly IClock clock;
        readonly string uiDir;     // optional: serve UI from disk (development)
        readonly string version;
        TcpListener listener;
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        public LocalServer(KvStore kv, EventStore store, IClock clock, string uiDir, string version)
        {
            this.kv = kv; this.store = store; this.clock = clock; this.uiDir = uiDir; this.version = version;
            var b = new byte[24];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            Token = BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        public void Start(int preferredPort)
        {
            for (int p = preferredPort; p < preferredPort + 30; p++)
            {
                try { listener = new TcpListener(IPAddress.Loopback, p); listener.Start(); Port = p; break; }
                catch (SocketException) { listener = null; }
            }
            if (listener == null) throw new Exception("No free local port near " + preferredPort);
            var t = new Thread(AcceptLoop) { IsBackground = true, Name = "wd-http" };
            t.Start();
        }

        public string Url(string page) { return "http://127.0.0.1:" + Port + "/" + page + "?k=" + Token; }

        void AcceptLoop()
        {
            while (true)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); }
                catch { return; }
                ThreadPool.QueueUserWorkItem(Handle, c);
            }
        }

        class Req { public string Method, Path, Query = "", Body = ""; public Dictionary<string, string> H = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); }

        void Handle(object o)
        {
            var client = (TcpClient)o;
            try
            {
                using (client)
                {
                    client.ReceiveTimeout = 5000; client.SendTimeout = 5000;
                    var ns = client.GetStream();
                    var req = Read(ns);
                    if (req == null) return;
                    Route(req, ns);
                }
            }
            catch (Exception e) { Log.Write("http: " + e.Message); }
        }

        static Req Read(NetworkStream ns)
        {
            var buf = new MemoryStream();
            var one = new byte[4096];
            int headerEnd = -1;
            while (headerEnd < 0)
            {
                int n = ns.Read(one, 0, one.Length);
                if (n <= 0) return null;
                buf.Write(one, 0, n);
                if (buf.Length > 65536) return null;
                headerEnd = IndexOf(buf.GetBuffer(), (int)buf.Length, new byte[] { 13, 10, 13, 10 });
            }
            var all = buf.ToArray();
            string head = Encoding.ASCII.GetString(all, 0, headerEnd);
            var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = lines[0].Split(' ');
            if (first.Length < 2) return null;
            var r = new Req { Method = first[0].ToUpperInvariant() };
            string target = first[1];
            int q = target.IndexOf('?');
            r.Path = Uri.UnescapeDataString(q >= 0 ? target.Substring(0, q) : target);
            if (q >= 0) r.Query = target.Substring(q + 1);
            for (int i = 1; i < lines.Length; i++) { int c = lines[i].IndexOf(':'); if (c > 0) r.H[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim(); }
            string cl; int len = 0;
            if (r.H.TryGetValue("Content-Length", out cl)) int.TryParse(cl, out len);
            if (len > 20 * 1024 * 1024) return null;
            var body = new MemoryStream();
            body.Write(all, headerEnd + 4, all.Length - headerEnd - 4);
            while (body.Length < len) { int n = ns.Read(one, 0, Math.Min(one.Length, len - (int)body.Length)); if (n <= 0) break; body.Write(one, 0, n); }
            r.Body = Utf8.GetString(body.ToArray());
            return r;
        }

        static int IndexOf(byte[] hay, int len, byte[] needle)
        {
            for (int i = 0; i + needle.Length <= len; i++)
            {
                bool ok = true;
                for (int j = 0; j < needle.Length; j++) if (hay[i + j] != needle[j]) { ok = false; break; }
                if (ok) return i;
            }
            return -1;
        }

        void Send(NetworkStream ns, int status, string type, byte[] body, string extra)
        {
            string reason = status == 200 ? "OK" : status == 302 ? "Found" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 400 ? "Bad Request" : "Error";
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            sb.Append("Content-Type: ").Append(type).Append("\r\n");
            sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            sb.Append("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n");
            if (extra != null) sb.Append(extra);
            sb.Append("\r\n");
            var h = Encoding.ASCII.GetBytes(sb.ToString());
            ns.Write(h, 0, h.Length);
            ns.Write(body, 0, body.Length);
        }
        void Text(NetworkStream ns, int status, string msg) { Send(ns, status, "text/plain; charset=utf-8", Utf8.GetBytes(msg), null); }
        void JsonOut(NetworkStream ns, object o) { Send(ns, 200, "application/json; charset=utf-8", Utf8.GetBytes(Json.Write(o)), null); }

        void Route(Req r, NetworkStream ns)
        {
            // Only our own pages: right host (blocks DNS rebinding), right origin for writes, right token.
            string host; r.H.TryGetValue("Host", out host);
            if (host != "127.0.0.1:" + Port && host != "localhost:" + Port) { Text(ns, 403, "Forbidden"); return; }
            string origin;
            if (r.H.TryGetValue("Origin", out origin) && origin != "http://127.0.0.1:" + Port && origin != "http://localhost:" + Port) { Text(ns, 403, "Forbidden"); return; }

            foreach (var part in r.Query.Split('&'))
                if (part == "k=" + Token)
                {
                    Send(ns, 302, "text/plain", new byte[0], "Set-Cookie: wdk=" + Token + "; HttpOnly; SameSite=Strict; Path=/\r\nLocation: " + (r.Path == "/" ? "/report.html" : r.Path) + "\r\n");
                    return;
                }
            string cookie; r.H.TryGetValue("Cookie", out cookie);
            if (cookie == null || (" " + cookie.Replace(";", " ; ") + " ").IndexOf(" wdk=" + Token + " ", StringComparison.Ordinal) < 0)
            {
                Send(ns, 403, "text/html; charset=utf-8", Utf8.GetBytes("<!doctype html><meta charset=utf-8><title>Workflow Detective</title><p style=\"font:16px system-ui;margin:40px\">Open this page from the Workflow Detective icon near the clock (right-click it, then <b>Open my findings</b>).</p>"), null);
                return;
            }

            if (r.Path.StartsWith("/api/")) { Api(r, ns); return; }
            if (r.Path == "/") { Send(ns, 302, "text/plain", new byte[0], "Location: /report.html\r\n"); return; }
            var bytes = Asset(r.Path.TrimStart('/'));
            if (bytes == null) { Text(ns, 404, "Not found"); return; }
            Send(ns, 200, ContentType(r.Path), bytes, null);
        }

        void Api(Req r, NetworkStream ns)
        {
            try
            {
                switch (r.Method + " " + r.Path)
                {
                    case "GET /api/kv": JsonOut(ns, kv.Snapshot()); return;
                    case "POST /api/kv/set": kv.Merge(Json.Obj(Json.Parse(r.Body))); JsonOut(ns, Ok()); return;
                    case "POST /api/kv/remove":
                        {
                            var keys = new List<string>();
                            var l = Json.GetList(Json.Obj(Json.Parse(r.Body)), "keys");
                            if (l != null) foreach (var k in l) if (k is string) keys.Add((string)k);
                            kv.Remove(keys); JsonOut(ns, Ok()); return;
                        }
                    case "GET /api/events": JsonOut(ns, store.All()); return;
                    case "POST /api/events/delete":
                        {
                            var ids = new HashSet<long>();
                            var l = Json.GetList(Json.Obj(Json.Parse(r.Body)), "ids");
                            if (l != null) foreach (var x in l) if (x is double) ids.Add((long)(double)x);
                            var res = Ok(); res["deleted"] = (double)store.Delete(ids); JsonOut(ns, res); return;
                        }
                    case "POST /api/events/clear": store.Clear(); JsonOut(ns, Ok()); return;
                    case "GET /api/status":
                        {
                            var st = Schedule.Status(kv.Settings(), clock.Now(), clock.NowMs());
                            JsonOut(ns, new Dictionary<string, object> { { "state", st.State }, { "label", st.Label }, { "total", (double)st.Total }, { "done", (double)st.Done }, { "version", version } });
                            return;
                        }
                }
                Text(ns, 404, "Unknown API");
            }
            catch (FormatException) { Text(ns, 400, "Bad JSON"); }
        }

        static Dictionary<string, object> Ok() { return new Dictionary<string, object> { { "ok", true } }; }

        static string ContentType(string p)
        {
            p = p.ToLowerInvariant();
            if (p.EndsWith(".html")) return "text/html; charset=utf-8";
            if (p.EndsWith(".js")) return "text/javascript; charset=utf-8";
            if (p.EndsWith(".css")) return "text/css; charset=utf-8";
            if (p.EndsWith(".png")) return "image/png";
            if (p.EndsWith(".json")) return "application/json";
            return "application/octet-stream";
        }

        byte[] Asset(string rel)
        {
            if (rel.Contains("..") || rel.Contains("\\")) return null;
            byte[] b = null;
            if (uiDir != null)
            {
                string f = Path.Combine(uiDir, rel.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(f)) b = File.ReadAllBytes(f);
            }
            else
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui/" + rel))
                {
                    if (s != null) { var ms = new MemoryStream(); s.CopyTo(ms); b = ms.ToArray(); }
                }
            }
            if (b == null) return null;
            if (rel.EndsWith(".html"))
            {
                string html = Utf8.GetString(b);
                int i = html.IndexOf("</title>", StringComparison.Ordinal);
                if (i >= 0) html = html.Insert(i + 8, "\n<script src=\"/wd-desktop.js\"></script>");
                return Utf8.GetBytes(html);
            }
            if (rel == "wd-desktop.js") return Utf8.GetBytes(Utf8.GetString(b).Replace("__WD_VERSION__", version));
            return b;
        }
    }
}
