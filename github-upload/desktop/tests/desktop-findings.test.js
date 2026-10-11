// Two simulated weeks of Windows work (Outlook, Excel, QuickBooks Desktop, Teams, Chrome) written by the real
// recorder → the shared detector must find the planted processes and nothing private may be stored.
"use strict";
const fs = require("fs"), path = require("path");
const D = require("../../extension/lib/detector.js");
const dir = path.resolve(process.argv[2], "events");
const ev = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).flatMap(f => fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map(l => JSON.parse(l)));
const r = D.analyze(ev);
console.log(`${ev.length} events over ${r.summary.observedDays} days → ${r.findings.length} findings`);
r.findings.forEach((f, i) => console.log(`${i + 1}. [${f.type}] ${f.title}\n   ${f.detail}\n   ${f.count}× · ${f.minutesEach} min each · ≈${D.fmtMin(f.weeklyMinutes)}/wk · ${f.confidence}${f.when ? " · " + f.when : ""}\n   → ${f.automation.method}${f.automation.ai ? " (AI)" : ""}`));
const has = (type, apps) => r.findings.some(f => f.type === type && apps.every(a => f.apps.includes(a)));
const checks = [
  ["Outlook → Excel copying found, with AI reading the emails", r.findings.some(f => (f.type === "transfer" || f.type === "entry") && f.apps.includes("Outlook") && f.apps.includes("Excel") && f.automation.ai)],
  ["Excel → QuickBooks Desktop re-typing found", has("entry", ["Excel", "QuickBooks Desktop"])],
  ["daily QuickBooks Desktop export found", has("export", ["QuickBooks Desktop"])],
  ["Outlook replies found as drafting", has("drafting", ["Outlook"])],
  ["Teams chatting not flagged", !r.findings.some(f => f.apps.includes("Microsoft Teams"))],
  ["Excel → Teams sharing not flagged", !has("transfer", ["Excel", "Microsoft Teams"])],
  ["blocked app (Spotify) and password manager never logged", !ev.some(e => /spotify|1password/i.test(JSON.stringify(e)))],
  ["no copied values or invoice numbers stored", !ev.some(e => /1,200|10\/14\/2026|hunter2|Invoice \d/.test(JSON.stringify(e)))],
  ["no email addresses stored", !ev.some(e => /@northline/.test(JSON.stringify(e)))]
];
let bad = 0;
for (const [n, ok] of checks) { console.log((ok ? "✓ " : "✗ ") + n); if (!ok) bad++; }
fs.writeFileSync(path.resolve(process.argv[2], "events.json"), JSON.stringify(ev));
process.exit(bad ? 1 : 0);
