// Builds console/index.html: inlines the detector and four SAMPLE results files (simulated people, marked as samples).
// Run: node test/build-console.js
"use strict";
const fs = require("fs"), path = require("path");
const D = require("../extension/lib/detector.js");
const { generate } = require("./synth.js");
const root = path.resolve(__dirname, "..");

const people = [
  { company: "NORTHLINE (sample)", participant: "Dana R.", persona: "ar", seed: 42 },
  { company: "NORTHLINE (sample)", participant: "Priya S.", persona: "hr", seed: 7 },
  { company: "COPPER & PINE (sample)", participant: "Luis M.", persona: "ecom", seed: 11 },
  { company: "HARBORVIEW (sample)", participant: "Sam T.", persona: "ar", seed: 99 }
];
// Simulated participant ratings so the accuracy columns have something to show. Clearly sample data.
function feedbackFor(p, findings) {
  const fb = {};
  findings.forEach((f, i) => {
    let rating = i === 0 ? "new" : "accurate", note;
    if (f.type === "lookup" && p.participant === "Sam T.") { rating = "wrong"; note = "That's me checking two dashboards before the Monday meeting, not matching data."; }
    if (f.type === "drafting" && p.participant === "Luis M.") { rating = "new"; note = "Half of these are the same 'where is my order' answer."; }
    if (i === 2 && p.participant === "Priya S.") return; // not rated
    fb[f.key] = { rating, note, at: Date.parse("2026-10-23T16:00:00Z") };
  });
  return fb;
}
const samples = people.map(p => {
  const ev = generate(p.persona, "2026-10-12", 2, p.seed);
  const r = D.analyze(ev);
  return {
    schema: "workflow-detective/bundle@1", sample: true, exportedAt: "2026-10-23T16:00:00.000Z", extensionVersion: "0.1.0", detectorVersion: D.VERSION,
    participant: p.participant, company: p.company,
    study: { startDate: "2026-10-12", weeks: 2, scheduleMode: "rotate", hours: [8, 18], watchDaysTotal: 6, watchDaysDone: 6 },
    summary: r.summary, findings: r.findings, feedback: feedbackFor(p, r.findings)
  };
});
// A Windows-app participant, from the desktop simulation (findings only, marked as a sample).
const win = JSON.parse(fs.readFileSync(path.join(root, "samples/desktop-export.json"), "utf8"));
const winFindings = D.analyze(win.events).findings;
samples.push({ schema: win.schema, sample: true, source: "desktop", exportedAt: "2026-10-23T16:00:00.000Z", extensionVersion: win.extensionVersion, detectorVersion: D.VERSION,
  participant: "Marcus L.", company: "HARBORVIEW (sample)", os: "windows", study: win.study, summary: D.analyze(win.events).summary, findings: winFindings,
  feedback: Object.fromEntries(winFindings.map((f, i) => [f.key, { rating: i === 1 ? "new" : "accurate", at: Date.parse("2026-10-23T16:00:00Z") }])) });
// A Mac-app participant, from the Mac core simulation (mac/tests/core.test.js writes samples/mac-sim-events.json).
const macEv = JSON.parse(fs.readFileSync(path.join(root, "samples/mac-sim-events.json"), "utf8"));
const macR = D.analyze(macEv);
samples.push({ schema: "workflow-detective/bundle@1", sample: true, source: "desktop", os: "mac", exportedAt: "2026-10-23T16:00:00.000Z", extensionVersion: "0.1.0", detectorVersion: D.VERSION,
  participant: "Ana P.", company: "COPPER & PINE (sample)", study: { startDate: "2026-10-12", weeks: 2, scheduleMode: "rotate", hours: [8, 18], watchDaysTotal: 6, watchDaysDone: 6 },
  summary: macR.summary, findings: macR.findings,
  feedback: Object.fromEntries(macR.findings.map((f, i) => [f.key, { rating: i === 0 ? "new" : i === 3 ? "wrong" : "accurate", note: i === 3 ? "Those replies are all different." : undefined, at: Date.parse("2026-10-23T16:00:00Z") }])) });
samples.forEach(s => fs.writeFileSync(path.join(root, "samples", `sample_${s.participant.replace(/\W+/g, "")}.json`), JSON.stringify(s, null, 1)));

let html = fs.readFileSync(path.join(root, "console/console.src.html"), "utf8");
const det = fs.readFileSync(path.join(root, "extension/lib/detector.js"), "utf8").replace(/<\/script/gi, "<\\/script");
html = html.replace("/*__DETECTOR__*/", () => det).replace("/*__SAMPLES__*/[]", () => JSON.stringify(samples).replace(/<\//g, "<\\/"));
fs.writeFileSync(path.join(root, "console/artifact.html"), html); // fragment: the artifact host adds the page shell
fs.writeFileSync(path.join(root, "console/index.html"), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' + html.replace("</style>", "</style>\n</head><body>") + "\n</body></html>\n");
console.log("console/index.html", (html.length / 1024).toFixed(0) + " KB,", samples.length, "sample people,", samples.reduce((s, b) => s + b.findings.length, 0), "findings");
