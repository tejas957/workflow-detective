// Run: node test/robustness.test.js — same expectations across many random weeks, plus a noise-only person.
"use strict";
const D = require("../extension/lib/detector.js");
const { generate } = require("./synth.js");
const expect = {
  ar: [["transfer", ["Gmail", "Google Sheets"]], ["shuttle", ["Stripe", "Google Sheets"]], ["entry", ["HubSpot", "QuickBooks"]], ["lookup", ["Google Sheets", "Salesforce"]]],
  ecom: [["transfer", ["Shopify", "ShipStation"]], ["shuttle", ["Shopify", "Gmail"]], ["entry", ["Gmail", "Airtable"]], ["drafting", ["Zendesk"]]],
  hr: [["entry", ["Gmail", "Greenhouse"]], ["lookup", ["Gmail", "Google Calendar"]]]
};
let planted = 0, found = 0, extra = 0, noiseFindings = 0;
for (let seed = 1; seed <= 25; seed++) {
  for (const [persona, exp] of Object.entries(expect)) {
    const r = D.analyze(generate(persona, "2026-10-12", 2, seed));
    planted += exp.length;
    const matched = new Set();
    for (const [type, apps] of exp) { const f = r.findings.find(f => f.type === type && apps.every(a => f.apps.includes(a))); if (f) { found++; matched.add(f); } }
    extra += r.findings.filter(f => !matched.has(f)).length;
  }
  noiseFindings += D.analyze(generate("noise", "2026-10-12", 2, seed)).findings.length;
}
console.log(`Recall: ${found}/${planted} planted processes found (${(found / planted * 100).toFixed(1)}%)`);
console.log(`Extra findings beyond planted ones: ${extra} across ${25 * 3} simulated people (${(extra / 75).toFixed(2)} each)`);
console.log(`Noise-only people (no real process): ${noiseFindings} findings across 25 people`);
