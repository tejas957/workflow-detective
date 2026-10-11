// Generates mac/core/schedule.js from the browser extension's lib/settings.js, so all three versions share
// one schedule implementation. Run: node mac/tools/make-schedule.js
"use strict";
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.resolve(__dirname, "../../extension/lib/settings.js"), "utf8");
const names = [...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(m => m[1]);
const body = src.replace(/^export /gm, "");
const out = `// GENERATED from extension/lib/settings.js by mac/tools/make-schedule.js. Do not edit by hand.
var WDSchedule = (function () {
${body}
return { ${names.join(", ")} };
})();
if (typeof module !== "undefined" && module.exports) module.exports = WDSchedule;
`;
fs.writeFileSync(path.resolve(__dirname, "../core/schedule.js"), out);
console.log("mac/core/schedule.js:", names.join(", "));
