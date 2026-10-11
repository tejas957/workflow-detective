// Tests for the Mac recording core (mac/core/recorder.js) in Node, with a fake clock.
// Run: node mac/tests/core.test.js
"use strict";
const path = require("path");
const D = require("../../extension/lib/detector.js");
global.WDSchedule = require("../core/schedule.js");
const R = require("../core/recorder.js");

let t = 0; const events = [];
R.init({ now: () => t, store: j => events.push(JSON.parse(j)), log: m => console.log("log:", m) });
const at = (y, mo, d, h, mi) => { t = new Date(y, mo - 1, d, h, mi || 0).getTime(); };
const wait = s => { t += s * 1000; R.tick(); };
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "✓ " : "✗ ") + n + (ok || !x ? "" : "  — " + x)); };

/* ---------- unit checks (same as the Windows self-test) ---------- */
check("titles lose numbers and emails", R._redactTitle("Payment received from Acme - Invoice 1042 - pat@acme.com") === "Payment received from Acme - Invoice #", R._redactTitle("Payment received from Acme - Invoice 1042 - pat@acme.com"));
check("labels cleaned", R._cleanLabel("customer_name 2") === "customer name #");
const x = R._appInfo("com.microsoft.Excel", "Microsoft Excel", "AR Tracker 2026.xlsx");
check("Excel by bundle id", x.app === "Excel" && x.page === "AR Tracker 2026.xlsx", JSON.stringify(x));
const sf = R._appInfo("com.apple.Safari", "Safari", "Inbox (3) - dana@northline.com - Gmail");
check("Safari tab → web app", sf.app === "Gmail" && sf.isBrowser);
check("unknown app uses its name", R._appInfo("com.sage.accounting", "Sage Accounting", "Sage").app === "Sage Accounting");

R.setSettings(JSON.stringify({ consented: true, startDate: "2026-10-12", weeks: 2, scheduleMode: "rotate", hourStart: 8, hourEnd: 18, captureTitles: true, captureFieldLabels: true, blocked: ["spotify", "reddit.com"] }));
at(2026, 10, 14, 10); // Wednesday, a watch day
R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Payment received from Acme - Invoice 1042");
R.copy("text"); wait(5);
R.foreground("com.microsoft.Excel", "Microsoft Excel", "AR Tracker.xlsx"); wait(3);
R.field("Amount", false); wait(2); R.field("Client", false); wait(5);
R.foreground("com.intuit.quickbooks2024", "QuickBooks", "Create Invoices");
R.field("Customer:Job", false); wait(1); R.field("Customer:Job", false); wait(1); R.field("Password", true); wait(1); R.field("Rate", false); wait(5);
R.foreground("com.spotify.client", "Spotify", "Spotify Premium"); R.copy("text");
R.foreground("com.google.Chrome", "Google Chrome", "r/accounting - Reddit"); R.copy("text");
R.foreground("com.1password.1password", "1Password", "1Password"); R.copy("text");
let dump = JSON.stringify(events);
check("copy recorded in Outlook", events.some(e => e.type === "copy" && e.app === "Outlook"));
check("edit in another app after a copy = one inferred paste with the field", events.filter(e => e.type === "paste").length === 1 && events.find(e => e.type === "paste").d.field === "Amount" && events.find(e => e.type === "paste").d.inferred === "edit");
check("field edits batched per screen", events.some(e => e.type === "entry" && e.app === "Excel" && e.d.labels.join() === "Amount,Client"));
check("password counted, never named", events.some(e => e.type === "entry" && e.d.sensitive === 1 && e.d.labels.join() === "Customer:Job,Rate") && !/Password"/.test(dump));
check("titles redacted", dump.includes("Invoice #") && !dump.includes("1042"));
check("blocked apps/sites and password managers record nothing", !/Spotify|Reddit|1Password/.test(dump));
const n = events.length;
at(2026, 10, 14, 19); R.foreground("com.microsoft.Excel", "Microsoft Excel", "After hours.xlsx"); R.copy("text");
at(2026, 10, 13, 10); R.foreground("com.microsoft.Excel", "Microsoft Excel", "Tuesday.xlsx"); R.copy("text");
check("nothing recorded after hours or on non-watch days", events.length === n, events.length + " vs " + n);

/* switch-based paste: copy in Outlook, spend time in Excel without a visible field edit, leave */
R._reset(); events.length = 0; at(2026, 10, 14, 11);
R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Payment received from Lumen"); R.copy("text"); wait(4);
R.foreground("com.microsoft.Excel", "Microsoft Excel", "AR Tracker.xlsx"); wait(6);
R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Payment received from Lumen");
check("copy → time in Excel → leave counts as a paste into Excel", events.some(e => e.type === "paste" && e.app === "Excel" && e.d.inferred === "switch"));
R._reset(); events.length = 0;
R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Lunch?"); R.copy("text"); wait(2);
R.foreground("com.tinyspeck.slackmacgap", "Slack", "general"); wait(10); R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Lunch?");
check("no paste credited to chat apps", !events.some(e => e.type === "paste"));
R._reset(); events.length = 0;
R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Hi"); R.copy("text"); wait(1);
R.foreground("com.microsoft.Excel", "Microsoft Excel", "A.xlsx"); wait(0.5); R.foreground("com.apple.finder", "Finder", "Downloads");
check("a brief pass through an app isn't a paste", !events.some(e => e.type === "paste"));

/* ---------- two simulated weeks on a Mac → shared detector ---------- */
R._reset(); events.length = 0;
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const W = (a, b) => wait(a + rnd() * (b - a));
const days = WDSchedule.allWatchDays({ startDate: "2026-10-12", weeks: 2, scheduleMode: "rotate" });
const clients = ["Acme Co", "Juniper Bakery", "Lumen Studio", "Northwind"];
function noise() {
  const k = rnd();
  if (k < 0.25) { R.foreground("com.microsoft.teams2", "Microsoft Teams", "Chat | Microsoft Teams"); W(20, 90); R.field("Type a message", false); W(5, 20); }
  else if (k < 0.4) { R.foreground("com.apple.Safari", "Safari", "Industry news - Supply Chain Dive"); W(30, 200); }
  else if (k < 0.5) { R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Inbox • Northline"); W(15, 60); }
  else if (k < 0.58) { R.foreground("com.microsoft.Excel", "Microsoft Excel", "Budget 2026.xlsx"); R.copy("table"); W(3, 8); W(30, 120); }
  else if (k < 0.63) { R.foreground("com.microsoft.Excel", "Microsoft Excel", "Budget 2026.xlsx"); R.copy("table"); W(3, 8); R.foreground("com.microsoft.teams2", "Microsoft Teams", "Chat | Microsoft Teams"); R.field("Type a message", false); W(5, 15); }
  else if (k < 0.66) { R.foreground("com.apple.finder", "Finder", "Documents"); W(10, 40); }
  else W(60, 240);
  W(20, 150);
}
for (const day of days) {
  t = new Date(day).setHours(8, 30 + rint(0, 15));
  const jobs = [];
  const at2 = (h0, h1) => new Date(day).setHours(h0, 0, 0, 0) + rnd() * (h1 - h0) * 3600e3;
  jobs.push([new Date(day).setHours(9, rint(-8, 10)), () => {   // daily QuickBooks report export
    R.foreground("com.intuit.quickbooks2024", "QuickBooks", "A/R Aging Summary"); W(20, 40);
    R.file("AR Aging " + new Date(t).toISOString().slice(0, 10) + ".xlsx", "Downloads"); W(3, 6);
    R.foreground("com.microsoft.Excel", "Microsoft Excel", "AR Aging.xlsx"); W(60, 180);
  }]);
  for (let i = 0, nPay = rint(4, 7); i < nPay; i++) jobs.push([at2(9, 17), () => {   // Outlook payments → Excel (no visible cell edits on Mac)
    const c = clients[rint(0, 3)];
    for (let f = 0; f < 3; f++) {
      R.foreground("com.microsoft.Outlook", "Microsoft Outlook", "Payment received from " + c + " - Invoice " + rint(1000, 1500)); W(f ? 2 : 15, f ? 4 : 30);
      R.copy(f === 0 ? "text" : "text"); W(2, 5);
      R.foreground("com.microsoft.Excel", "Microsoft Excel", "AR Tracker 2026.xlsx"); W(3, 7);
    }
  }]);
  for (let i = 0, nInv = rint(3, 5); i < nInv; i++) jobs.push([at2(10, 16), () => {   // Excel → QuickBooks Desktop invoices
    R.foreground("com.microsoft.Excel", "Microsoft Excel", "Open orders.xlsx"); W(40, 90);
    R.foreground("com.intuit.quickbooks2024", "QuickBooks", "Create Invoices"); W(5, 10);
    for (const f of ["Customer:Job", "Date", "Terms", "Item", "Quantity", "Rate"]) for (let k = 0; k < 3; k++) { R.field(f, false); W(1, 4); }
    W(5, 20);
  }]);
  for (let i = 0, nRep = rint(2, 4); i < nRep; i++) jobs.push([at2(9, 17), () => {   // replies in Apple Mail
    R.foreground("com.apple.mail", "Mail", "Re: Question about invoice " + rint(1000, 1500)); W(5, 10);
    R.field("Subject", false); W(30, 90); R.field("Message body", false); W(60, 120);
  }]);
  jobs.sort((a, b) => a[0] - b[0]);
  const lunch = new Date(day).setHours(12, rint(0, 40)); let lunched = false;
  for (const [when, run] of jobs) { while (t < when) { noise(); if (!lunched && t > lunch) { R.away(); t += (1800 + rint(0, 1200)) * 1000; lunched = true; } } run(); }
  while (t < new Date(day).setHours(17)) noise();
  R.away();
}
const r = D.analyze(events);
console.log(`\nMac simulation: ${events.length} events over ${r.summary.observedDays} days → ${r.findings.length} findings`);
r.findings.forEach((f, i) => console.log(`  ${i + 1}. [${f.type}] ${f.title} · ${f.count}× · ≈${D.fmtMin(f.weeklyMinutes)}/wk${f.automation.ai ? " · AI" : ""}`));
const has = (type, apps) => r.findings.some(f => (type === "*" || f.type === type) && apps.every(a => f.apps.includes(a)));
check("Outlook → Excel copying found from copy-then-switch alone", has("transfer", ["Outlook", "Excel"]));
check("Excel → QuickBooks Desktop re-typing found", has("entry", ["Excel", "QuickBooks Desktop"]));
check("daily QuickBooks export to Downloads found", has("export", ["QuickBooks Desktop"]));
check("Apple Mail replies found as drafting", has("drafting", ["Apple Mail"]));
check("Teams chat and Excel → Teams sharing not flagged", !r.findings.some(f => f.apps.includes("Microsoft Teams")));
check("no extra findings", r.findings.length === 4, r.findings.map(f => f.title).join(" | "));
require("fs").writeFileSync(path.resolve(__dirname, "../../samples/mac-sim-events.json"), JSON.stringify(events));
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nAll ${pass} Mac core checks passed`);
process.exit(fail ? 1 : 0);
