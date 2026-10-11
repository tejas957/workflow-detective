// Run: node test/invite.test.js
"use strict";
const I = require("../extension/lib/invite.js");
let bad = 0; const ok = (n, c) => { console.log((c ? "✓ " : "✗ ") + n); if (!c) bad++; };
const full = { company: "NORTHLINE", participant: "Dana Rivera-Ñúñez", startDate: "2026-10-12", weeks: 2, hourStart: 8, hourEnd: 18, work: "both", computer: "windows" };
const code = I.encode(full);
ok("code uses only link-safe characters", /^WD1\.[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(code));
const d = I.decode(code);
ok("round trip keeps every field (incl. accents)", d.company === "NORTHLINE" && d.participant === full.participant && d.startDate === "2026-10-12" && d.weeks === 2 && d.hourStart === 8 && d.hourEnd === 18 && d.work === "both" && d.computer === "windows");
ok("found inside a pasted email or link", I.decode("Hi Dana, your code is " + code + " — thanks!") !== null && I.find("https://x.github.io/wd/#" + code) === code);
ok("a cut-off code is rejected", I.decode(code.slice(0, -6)) === null);
const typo = code.slice(0, 12) + (code[12] === "A" ? "B" : "A") + code.slice(13);
ok("a mistyped code is rejected", I.decode(typo) === null);
ok("company-only invite works (participant types name)", I.decode(I.encode({ company: "COPPER & PINE" })).participant === "");
ok("fixed days survive", JSON.stringify(I.decode(I.encode({ company: "X", scheduleMode: "fixed", days: [1, 3] })).days) === "[1,3]");
ok("bad hours are dropped", I.decode(I.encode({ company: "X", hourStart: 18, hourEnd: 8 })).hourStart === undefined);
ok("garbage is rejected", I.decode("hello") === null && I.decode("") === null);
console.log("code length for a full invite:", code.length, "characters");
process.exit(bad ? 1 : 0);
