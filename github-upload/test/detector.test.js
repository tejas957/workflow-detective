// Run: node test/detector.test.js
"use strict";
const assert = require("assert");
const D = require("../extension/lib/detector.js");
const { generate } = require("./synth.js");

const cases = [
  { persona: "ar", who: "AR coordinator", expect: [
    ["transfer", ["Gmail", "Google Sheets"]],
    ["shuttle", ["Stripe", "Google Sheets"]],
    ["entry", ["HubSpot", "QuickBooks"]],
    ["lookup", ["Google Sheets", "Salesforce"]]
  ], mustNot: [["transfer", ["Gmail", "Slack"]]] },
  { persona: "ecom", who: "E-commerce ops", expect: [
    ["transfer", ["Shopify", "ShipStation"]],
    ["shuttle", ["Shopify", "Gmail"]],
    ["entry", ["Gmail", "Airtable"]],
    ["drafting", ["Zendesk"]]
  ], mustNot: [["entry", ["Slack"]], ["lookup", ["Shopify", "ShipStation"]]] },
  { persona: "hr", who: "Recruiting coordinator", expect: [
    ["entry", ["Gmail", "Greenhouse"]],
    ["lookup", ["Gmail", "Google Calendar"]]
  ], mustNot: [["shuttle", ["Gmail", "Greenhouse"]], ["routine", ["Slack"]]] }
];

let failed = 0;
for (const c of cases) {
  const ev = generate(c.persona, "2026-10-12", 2, 42);
  const t0 = Date.now();
  const r = D.analyze(ev);
  const ms = Date.now() - t0;
  console.log(`\n=== ${c.who}: ${ev.length} events, ${r.summary.observedDays} days, ${r.findings.length} findings (${ms} ms) ===`);
  r.findings.forEach((f, i) => console.log(
    `${String(i + 1).padStart(2)}. [${f.type}] ${f.title}\n    ${f.detail}\n    ${f.count}× over ${f.days}d · ${f.minutesEach} min each · ≈${D.fmtMin(f.weeklyMinutes)}/wk · ${f.confidence} · auto ${f.automatability}${f.when ? " · " + f.when : ""}${f.steps ? "\n    steps: " + f.steps.join(" ▸ ") : ""}\n    → ${f.automation.method}${f.automation.ai ? " (AI)" : ""}`));
  for (const [type, apps] of c.expect) {
    const hit = r.findings.find(f => f.type === type && apps.every(a => f.apps.includes(a)));
    if (!hit) { failed++; console.log(`  ✗ MISSING expected ${type} ${apps.join(" + ")}`); }
    else console.log(`  ✓ found ${type} ${apps.join(" + ")}`);
  }
  for (const [type, apps] of c.mustNot) {
    const hit = r.findings.find(f => f.type === type && apps.every(a => f.apps.includes(a)));
    if (hit) { failed++; console.log(`  ✗ FALSE POSITIVE ${type} ${apps.join(" + ")}`); }
    else console.log(`  ✓ correctly ignored ${type} ${apps.join(" + ")}`);
  }
  assert.ok(D.brief(r.findings[0], c.who).includes("PROCESS:"));
}
// edge cases
assert.deepStrictEqual(D.analyze([]).findings, []);
assert.strictEqual(D.analyze([{ t: Date.now(), type: "view", app: "Gmail" }]).findings.length, 0);
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
