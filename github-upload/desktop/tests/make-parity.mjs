// Random schedule cases computed by the browser extension's own settings.js, for the desktop app to match.
import { pathToFileURL } from "url";
import fs from "fs"; import path from "path"; import os from "os";
const src = path.resolve(process.argv[2]);
const tmp = path.join(os.tmpdir(), "wd-settings-" + process.pid + ".mjs");
fs.copyFileSync(src, tmp);
const S = await import(pathToFileURL(tmp).href);
let seed = 7; const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(r() * a.length)];
const cases = [];
for (let i = 0; i < 400; i++) {
  const start = new Date(2026, 9, 1 + Math.floor(r() * 40));
  const settings = { consented: r() > 0.1, withdrawn: r() < 0.05, startDate: S.isoDate(start), weeks: pick([1, 2, 3, 4]),
    scheduleMode: r() < 0.7 ? "rotate" : "fixed", days: [1, 2, 3, 4, 5, 6, 0].filter(() => r() < 0.5), hourStart: pick([0, 7, 8, 9]), hourEnd: pick([12, 17, 18, 24]), pausedUntil: 0 };
  const date = new Date(start); date.setDate(date.getDate() + Math.floor(r() * 40) - 5);
  const minute = Math.floor(r() * 1440);
  const now = new Date(date); now.setMinutes(minute);
  if (r() < 0.1) settings.pausedUntil = now.getTime() + 60e3;
  const st = S.status(settings, now);
  cases.push({ settings, date: S.isoDate(date), minute, active: S.isActiveNow(settings, now), state: st.state, total: st.total, done: st.done });
}
fs.writeFileSync(process.argv[3], JSON.stringify(cases));
fs.unlinkSync(tmp);
console.log("wrote", cases.length, "cases; states:", JSON.stringify(cases.reduce((m, c) => (m[c.state] = (m[c.state] || 0) + 1, m), {})));
