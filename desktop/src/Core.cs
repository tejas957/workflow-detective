// Privacy rules, app naming, study settings and the watch schedule.
// The schedule rules mirror extension/lib/settings.js exactly (checked by a parity test).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace WorkflowDetective
{
    public static class Privacy
    {
        static readonly Regex Email = new Regex(@"[\w.+-]+@[\w-]+\.[\w.-]+");
        static readonly Regex Phone = new Regex(@"\+?\d[\d\s().-]{6,}\d");
        static readonly Regex Digits = new Regex(@"\d+");
        static readonly Regex Seg = new Regex(@"\s+[-–|]\s+");
        static readonly Regex Spaces = new Regex(@"\s+");
        static readonly Regex SensitiveLabel = new Regex(@"pass(word|code)?\b|\bssn\b|social.?security|card.?(number|no)|credit.?card|\bcvv\b|\bcvc\b|security.?code|\biban\b|routing|account.?(number|no)|\bpin\b|tax.?id|\bein\b|date.?of.?birth|\bdob\b|one.?time", RegexOptions.IgnoreCase);

        /// Titles keep their words but lose numbers, email addresses and phone numbers.
        public static string RedactTitle(string title)
        {
            if (string.IsNullOrEmpty(title)) return "";
            string t = Email.Replace(title, "[email]");
            t = Phone.Replace(t, "#");
            t = Digits.Replace(t, "#");
            var parts = new List<string>();
            foreach (var p in Seg.Split(t)) if (p.Trim() != "[email]") parts.Add(p);
            t = string.Join(" - ", parts.ToArray());
            return t.Length > 90 ? t.Substring(0, 90) : t;
        }

        /// Field and button labels: short, no digits, no email addresses.
        public static string CleanLabel(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            string t = Spaces.Replace(s.Replace('_', ' '), " ").Trim();
            t = Email.Replace(t, "[email]");
            t = Digits.Replace(t, "#");
            return t.Length > 40 ? t.Substring(0, 40) : t;
        }

        public static bool IsSensitiveLabel(string s) { return !string.IsNullOrEmpty(s) && SensitiveLabel.IsMatch(s); }

        static readonly Regex KEmail = new Regex(@"^[\w.+-]+@[\w-]+\.[\w.-]+$");
        static readonly Regex KNumber = new Regex(@"^[-+]?[$€£¥]?\s?[\d,]+(\.\d+)?%?$");
        static readonly Regex KDate1 = new Regex(@"^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$");
        static readonly Regex KDate2 = new Regex(@"^[A-Za-z]{3,9}\.? \d{1,2},? \d{2,4}$");
        static readonly Regex KLink = new Regex(@"^https?://\S+$");

        /// What *kind* of thing was copied. The text itself is never kept.
        public static string KindOf(string text)
        {
            string t = (text ?? "").Trim();
            if (t.Length == 0) return "unknown";
            if (KEmail.IsMatch(t)) return "email";
            if (KNumber.IsMatch(t)) return "number";
            if (KDate1.IsMatch(t) || (t.Length < 30 && KDate2.IsMatch(t))) return "date";
            if (KLink.IsMatch(t)) return "link";
            if (t.IndexOf('\t') >= 0 || t.Split('\n').Length > 2) return "table";
            return t.Length > 200 ? "long text" : "text";
        }
        public static string LenBucket(int n) { return n == 0 ? "0" : n < 20 ? "short" : n < 200 ? "medium" : "long"; }
    }

    public class AppInfo
    {
        public string App;      // friendly name, e.g. "Excel", "Gmail"
        public string Proc;     // process name, lower case
        public string Page;     // title without the app/browser suffix (not yet redacted)
        public bool IsBrowser;
    }

    public static class AppNames
    {
        static readonly Dictionary<string, string> Procs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            {"excel","Excel"},{"outlook","Outlook"},{"olk","Outlook"},{"winword","Word"},{"powerpnt","PowerPoint"},
            {"onenote","OneNote"},{"msaccess","Access"},{"mspub","Publisher"},{"ms-teams","Microsoft Teams"},{"teams","Microsoft Teams"},
            {"slack","Slack"},{"zoom","Zoom"},{"explorer","File Explorer"},{"acrobat","Adobe Acrobat"},{"acrord32","Adobe Acrobat"},
            {"qbw32","QuickBooks Desktop"},{"qbw","QuickBooks Desktop"},{"notepad","Notepad"},{"notepad++","Notepad++"},
            {"mstsc","Remote Desktop"},{"sage","Sage"},{"sage50accounting","Sage 50"},{"peachw","Sage 50"},{"whatsapp","WhatsApp"},
            {"spotify","Spotify"},{"code","VS Code"},{"thunderbird","Thunderbird"},{"chrome","Chrome"},{"msedge","Edge"},
            {"firefox","Firefox"},{"brave","Brave"},{"opera","Opera"},{"vivaldi","Vivaldi"},{"arc","Arc"},{"calc","Calculator"},
            {"snippingtool","Snipping Tool"},{"mspaint","Paint"}
        };
        static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc" };
        // Never watched, whatever the settings: password managers, Windows sign-in/permission prompts, this app.
        static readonly HashSet<string> Never = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "1password", "keepass", "keepassxc", "bitwarden", "lastpass", "dashlane", "nordpass", "roboform",
            "logonui", "credentialuibroker", "consent", "lockapp", "workflowdetective", "searchhost", "shellexperiencehost", "startmenuexperiencehost" };

        static readonly Regex BrowserSuffix = new Regex(@"\s[-—–]\s(Google Chrome|Microsoft​?\s?Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)\s*$", RegexOptions.IgnoreCase);
        static readonly Regex MorePages = new Regex(@"\s+and \d+ more pages?", RegexOptions.IgnoreCase);
        static readonly Regex ProfileSeg = new Regex(@"\s[-—–]\s(Personal|Work|Default|Profile \d+|InPrivate)\s*$", RegexOptions.IgnoreCase);

        static readonly string[,] Web = {
            {@"\bGmail\b","Gmail"},{@"Google Sheets","Google Sheets"},{@"Google Docs","Google Docs"},{@"Google Drive","Google Drive"},
            {@"Google Calendar","Google Calendar"},{@"\bQuickBooks\b","QuickBooks"},{@"\bSalesforce\b","Salesforce"},{@"\bHubSpot\b","HubSpot"},
            {@"\bShopify\b","Shopify"},{@"\bShipStation\b","ShipStation"},{@"\bAirtable\b","Airtable"},{@"\bAsana\b","Asana"},
            {@"\bTrello\b","Trello"},{@"\bJira\b","Jira"},{@"\bNotion\b","Notion"},{@"\bSlack\b","Slack"},{@"Microsoft Teams","Microsoft Teams"},
            {@"\bOutlook\b","Outlook"},{@"\bZendesk\b","Zendesk"},{@"\bGreenhouse\b","Greenhouse"},{@"\bWorkday\b","Workday"},
            {@"\bNetSuite\b","NetSuite"},{@"\bXero\b","Xero"},{@"\bStripe\b","Stripe"},{@"\bLinkedIn\b","LinkedIn"},{@"\bDocuSign\b","DocuSign"},
            {@"\.xlsx?\b.*\bExcel\b|Excel Online","Excel Online"},{@"\bmonday\.com\b","monday.com"},{@"\bClickUp\b","ClickUp"},{@"\bGusto\b","Gusto"}
        };

        public static AppInfo Name(string proc, string fileDescription, string title)
        {
            var r = new AppInfo();
            r.Proc = (proc ?? "").ToLowerInvariant();
            r.IsBrowser = Browsers.Contains(r.Proc);
            string t = title ?? "";
            string name;
            if (!Procs.TryGetValue(r.Proc, out name))
            {
                name = !string.IsNullOrEmpty(fileDescription) ? fileDescription.Trim() : (proc ?? "Unknown app");
                if (name.Length > 40) name = name.Substring(0, 40);
            }
            if (r.IsBrowser)
            {
                t = BrowserSuffix.Replace(t, "");
                t = MorePages.Replace(t, "");
                t = ProfileSeg.Replace(t, "");
                for (int i = 0; i < Web.GetLength(0); i++)
                    if (Regex.IsMatch(t, Web[i, 0], RegexOptions.IgnoreCase)) { name = Web[i, 1]; break; }
            }
            else
            {
                // "Book1.xlsx - Excel" -> "Book1.xlsx"
                string word = name.Split(' ')[name.Split(' ').Length - 1];
                var parts = new List<string>(Regex.Split(t, @"\s+[-—–|]\s+"));
                while (parts.Count > 1 && (parts[parts.Count - 1].IndexOf(word, StringComparison.OrdinalIgnoreCase) >= 0 || parts[parts.Count - 1].StartsWith("Microsoft", StringComparison.OrdinalIgnoreCase)))
                    parts.RemoveAt(parts.Count - 1);
                t = string.Join(" - ", parts.ToArray());
            }
            r.App = name;
            r.Page = t;
            return r;
        }

        public static bool NeverWatch(string proc) { return Never.Contains(proc ?? ""); }
    }

    public class StudySettings
    {
        public bool Consented, Withdrawn;
        public string Participant = "", Company = "", StartDate = null, ScheduleMode = "rotate";
        public int Weeks = 2, HourStart = 8, HourEnd = 18, RetentionDaysAfter = 14;
        public List<int> Days = new List<int> { 2, 3, 4 };
        public bool CaptureTitles = true, CaptureFieldLabels = true;
        public List<string> Blocked = new List<string>();
        public double PausedUntil, PurgedAt;

        public static StudySettings From(Dictionary<string, object> d)
        {
            var s = new StudySettings();
            if (d == null) return s;
            s.Consented = Json.GetBool(d, "consented", false);
            s.Withdrawn = Json.GetBool(d, "withdrawn", false);
            s.Participant = Json.GetString(d, "participant", "");
            s.Company = Json.GetString(d, "company", "");
            s.StartDate = Json.GetString(d, "startDate", null);
            s.ScheduleMode = Json.GetString(d, "scheduleMode", "rotate");
            s.Weeks = (int)Json.GetNumber(d, "weeks", 2);
            s.HourStart = (int)Json.GetNumber(d, "hourStart", 8);
            s.HourEnd = (int)Json.GetNumber(d, "hourEnd", 18);
            s.RetentionDaysAfter = (int)Json.GetNumber(d, "retentionDaysAfter", 14);
            s.CaptureTitles = Json.GetBool(d, "captureTitles", true);
            s.CaptureFieldLabels = Json.GetBool(d, "captureFieldLabels", true);
            s.PausedUntil = Json.GetNumber(d, "pausedUntil", 0);
            s.PurgedAt = Json.GetNumber(d, "purgedAt", 0);
            var days = Json.GetList(d, "days");
            if (days != null) { s.Days = new List<int>(); foreach (var x in days) if (x is double) s.Days.Add((int)(double)x); }
            var bl = Json.GetList(d, "blocked");
            if (bl != null) foreach (var x in bl) if (x is string) s.Blocked.Add((string)x);
            return s;
        }
    }

    public class StudyStatus
    {
        public string State, Label;
        public int Total, Done, DayNumber;
    }

    public static class Schedule
    {
        public static DateTime? ParseDate(string iso)
        {
            DateTime d;
            if (iso != null && DateTime.TryParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) return d.Date;
            return null;
        }
        static DateTime MondayOf(DateTime d) { var m = d.Date; return m.AddDays(-(((int)m.DayOfWeek + 6) % 7)); }
        public static DateTime? Start(StudySettings s) { return ParseDate(s.StartDate); }
        public static DateTime? End(StudySettings s) { var st = Start(s); if (st == null) return null; return st.Value.AddDays(s.Weeks * 7); }

        public static List<int> WatchDaysFor(StudySettings s, DateTime date)
        {
            if (s.ScheduleMode == "fixed") return s.Days;
            int w = (int)Math.Round((MondayOf(date) - MondayOf(Start(s).Value)).TotalDays / 7.0);
            return w % 2 == 0 ? new List<int> { 1, 3, 5 } : new List<int> { 2, 3, 4 };
        }
        public static bool IsWatchDay(StudySettings s, DateTime date)
        {
            var st = Start(s); var en = End(s);
            if (st == null) return false;
            var d = date.Date;
            return d >= st.Value && d < en.Value && WatchDaysFor(s, d).Contains((int)d.DayOfWeek);
        }
        public static List<DateTime> AllWatchDays(StudySettings s)
        {
            var o = new List<DateTime>();
            var st = Start(s); var en = End(s);
            if (st == null) return o;
            for (var d = st.Value; d < en.Value; d = d.AddDays(1)) if (IsWatchDay(s, d)) o.Add(d);
            return o;
        }
        static bool InHours(StudySettings s, DateTime now) { double h = now.Hour + now.Minute / 60.0; return h >= s.HourStart && h < s.HourEnd; }

        public static bool IsActiveNow(StudySettings s, DateTime now, double nowMs)
        {
            return s.Consented && !s.Withdrawn && IsWatchDay(s, now) && InHours(s, now) && !(s.PausedUntil > nowMs);
        }

        static string FmtDay(DateTime d) { return d.ToString("ddd, MMM d", CultureInfo.InvariantCulture); }
        static string FmtHour(int h) { int hh = ((h + 11) % 12) + 1; return hh + ":00 " + (h >= 12 ? "pm" : "am"); }

        public static StudyStatus Status(StudySettings s, DateTime now, double nowMs)
        {
            var days = AllWatchDays(s);
            var today = now.Date;
            var r = new StudyStatus { Total = days.Count };
            int idx = -1; DateTime? next = null;
            for (int i = 0; i < days.Count; i++)
            {
                if (days[i] < today || (days[i] == today && now.Hour >= s.HourEnd)) r.Done++;
                if (days[i] == today) idx = i;
                if (next == null && (days[i] > today || (days[i] == today && now.Hour < s.HourStart))) next = days[i];
            }
            r.DayNumber = idx >= 0 ? idx + 1 : 0;
            if (s.Withdrawn) { r.State = "withdrawn"; r.Label = "Stopped"; }
            else if (!s.Consented) { r.State = "setup"; r.Label = "Not set up yet"; }
            else if (now >= End(s).Value) { r.State = "done"; r.Label = "Study complete"; r.Done = days.Count; }
            else if (s.PausedUntil > nowMs) { r.State = "paused"; r.Label = "Paused until " + DateTimeOffset.FromUnixTimeMilliseconds((long)s.PausedUntil).LocalDateTime.ToString("h:mm tt", CultureInfo.InvariantCulture).ToLowerInvariant(); }
            else if (IsActiveNow(s, now, nowMs)) { r.State = "active"; r.Label = "Watching now"; }
            else if (now < Start(s).Value) { r.State = "before"; r.Label = "Starts " + FmtDay(next ?? Start(s).Value); }
            else if (idx >= 0 && now.Hour < s.HourStart) { r.State = "later"; r.Label = "Starts at " + FmtHour(s.HourStart) + " today"; }
            else { r.State = "off"; r.Label = next != null ? "Off now · next: " + FmtDay(next.Value) : "No watch days left"; }
            return r;
        }
    }

    public static class Log
    {
        public static string PathFile;
        static readonly object Gate = new object();
        public static void Write(string msg)
        {
            try
            {
                lock (Gate)
                {
                    if (PathFile == null) return;
                    var fi = new FileInfo(PathFile);
                    if (fi.Exists && fi.Length > 1024 * 1024) File.Delete(PathFile);
                    File.AppendAllText(PathFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + msg + Environment.NewLine, new UTF8Encoding(false));
                }
            }
            catch { }
        }
    }
}
