// Settings, the study schedule, and the "should we be watching right now?" rule.

export const DEFAULT_BLOCKED = [
  "facebook.com", "instagram.com", "tiktok.com", "reddit.com", "youtube.com", "netflix.com", "hulu.com",
  "spotify.com", "x.com", "twitter.com", "mychart.com", "match.com", "tinder.com", "bumble.com", "hinge.co"
];
// Always skipped, whatever the list says: banking, investing, and patient portals.
const SENSITIVE_HOST = /bank|creditunion|fidelity\.com|vanguard\.com|schwab\.com|robinhood\.com|coinbase\.com|mychart|patient|healthportal/i;

export const DEFAULTS = {
  consented: false,
  withdrawn: false,
  participant: "",
  company: "",
  startDate: null,          // "YYYY-MM-DD"
  weeks: 2,
  scheduleMode: "rotate",   // "rotate": week A Mon/Wed/Fri, week B Tue/Wed/Thu — every weekday gets covered
  days: [2, 3, 4],          // used when scheduleMode === "fixed" (0=Sun … 6=Sat)
  hourStart: 8,
  hourEnd: 18,
  captureTitles: true,
  captureFieldLabels: true,
  blocked: DEFAULT_BLOCKED,
  pausedUntil: 0,
  retentionDaysAfter: 14
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return Object.assign({}, DEFAULTS, settings || {});
}
export async function saveSettings(patch) {
  const next = Object.assign(await getSettings(), patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

const DAY = 864e5;
export function parseDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
export function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function mondayOf(d) { const m = midnight(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
export function nextMonday(from = new Date()) { const m = mondayOf(from); if (midnight(from).getTime() !== m.getTime()) m.setDate(m.getDate() + 7); return m; }

export function studyStart(s) { return s.startDate ? parseDate(s.startDate) : null; }
export function studyEnd(s) { const st = studyStart(s); if (!st) return null; const e = new Date(st); e.setDate(e.getDate() + s.weeks * 7); return e; }

export function watchDaysFor(s, date) {
  if (s.scheduleMode === "fixed") return s.days;
  const w = Math.round((mondayOf(date) - mondayOf(studyStart(s))) / (7 * DAY));
  return w % 2 === 0 ? [1, 3, 5] : [2, 3, 4];
}
export function isWatchDay(s, date) {
  const st = studyStart(s), en = studyEnd(s); if (!st) return false;
  const d = midnight(date);
  return d >= st && d < en && watchDaysFor(s, d).includes(d.getDay());
}
export function allWatchDays(s) {
  const out = [], st = studyStart(s), en = studyEnd(s); if (!st) return out;
  for (let d = new Date(st); d < en; d.setDate(d.getDate() + 1)) if (isWatchDay(s, d)) out.push(new Date(d));
  return out;
}
function inHours(s, now) { const h = now.getHours() + now.getMinutes() / 60; return h >= s.hourStart && h < s.hourEnd; }

export function isActiveNow(s, now = new Date()) {
  return !!(s.consented && !s.withdrawn && isWatchDay(s, now) && inHours(s, now) && !(s.pausedUntil > now.getTime()));
}
export function isBlocked(s, host) {
  host = String(host || "").replace(/^www\./, "").toLowerCase();
  return SENSITIVE_HOST.test(host) || (s.blocked || []).some(b => { b = b.trim().toLowerCase().replace(/^www\./, ""); return b && (host === b || host.endsWith("." + b)); });
}

export function fmtDay(d) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
export function fmtHour(h) { const hh = ((h + 11) % 12) + 1; return hh + ":00 " + (h >= 12 ? "pm" : "am"); }

/** Everything the popup and report need to say where the study stands. */
export function status(s, now = new Date()) {
  const days = allWatchDays(s);
  const today = midnight(now).getTime();
  const done = days.filter(d => d.getTime() < today || (d.getTime() === today && now.getHours() >= s.hourEnd)).length;
  const idx = days.findIndex(d => d.getTime() === today);
  const base = { total: days.length, done, dayNumber: idx >= 0 ? idx + 1 : null, hours: fmtHour(s.hourStart) + "–" + fmtHour(s.hourEnd) };
  const next = days.find(d => d.getTime() > today || (d.getTime() === today && now.getHours() < s.hourStart));
  if (s.withdrawn) return Object.assign(base, { state: "withdrawn", label: "Stopped" });
  if (!s.consented) return Object.assign(base, { state: "setup", label: "Not set up yet" });
  if (now >= studyEnd(s)) return Object.assign(base, { state: "done", label: "Study complete", done: days.length });
  if (s.pausedUntil > now.getTime()) return Object.assign(base, { state: "paused", label: "Paused until " + new Date(s.pausedUntil).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) });
  if (isActiveNow(s, now)) return Object.assign(base, { state: "active", label: "Watching now" });
  if (now < studyStart(s)) return Object.assign(base, { state: "before", label: "Starts " + fmtDay(next || studyStart(s)) });
  if (idx >= 0 && now.getHours() < s.hourStart) return Object.assign(base, { state: "later", label: "Starts at " + fmtHour(s.hourStart) + " today" });
  return Object.assign(base, { state: "off", label: next ? "Off now · next: " + fmtDay(next) : "No watch days left" });
}
