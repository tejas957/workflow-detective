// The Mac app's pages in Chromium. Serves the same files the app bundles (with wd-mac.js injected after
// </title>, like SchemeHandler does) and stands in for the Swift bridge with the same API, over simulated Mac data.
// Run: NODE_PATH=$(npm root -g) node mac/tests/pages.test.js
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const FILES = {
  "onboarding.html": "extension/onboarding.html", "onboarding.js": "extension/onboarding.js", "report.html": "extension/report.html",
  "report.js": "extension/report.js", "ui.css": "extension/ui.css", "lib/detector.js": "extension/lib/detector.js",
  "lib/settings.js": "extension/lib/settings.js", "lib/invite.js": "extension/lib/invite.js", "lib/db.js": "desktop/ui/lib/db.js", "icons/48.png": "extension/icons/48.png", "wd-mac.js": "mac/ui/wd-mac.js"
};
const TYPES = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png" };
const results = []; const ok = (n, c, x) => results.push([c ? "✓" : "✗", n, x || ""]);

// in-memory version of the Mac app's DataStore
let nextId = 1;
const events = JSON.parse(fs.readFileSync(path.join(ROOT, "samples/mac-sim-events.json"), "utf8")).map(e => Object.assign(e, { id: nextId++ }));
const kv = { settings: { consented: true, participant: "Ana P.", company: "COPPER & PINE (sample)", startDate: "2026-10-12", weeks: 2, scheduleMode: "rotate", hourStart: 8, hourEnd: 18, captureTitles: true, captureFieldLabels: true, blocked: [] } };
let accessibility = false, saved = null, openedSettings = 0;
function bridge(path, body) {
  switch (path) {
    case "kv": return kv;
    case "kv/set": Object.assign(kv, body); return { ok: true };
    case "kv/remove": (body.keys || []).forEach(k => delete kv[k]); return { ok: true };
    case "events": return events;
    case "events/delete": { const ids = new Set(body.ids); const before = events.length; for (let i = events.length - 1; i >= 0; i--) if (ids.has(events[i].id)) events.splice(i, 1); return { ok: true, deleted: before - events.length }; }
    case "events/clear": events.length = 0; return { ok: true };
    case "permissions": return { accessibility };
    case "openAccessibility": openedSettings++; accessibility = true; return { ok: true };
    case "save": saved = body; return { ok: true, path: "/Users/test/Downloads/" + body.name };
  }
  throw new Error("Unknown request: " + path);
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "report.html";
  const src = FILES[rel];
  if (!src) { res.writeHead(404); return res.end(); }
  let data = fs.readFileSync(path.join(ROOT, src));
  if (rel.endsWith(".html")) data = Buffer.from(String(data).replace("</title>", '</title>\n<script src="/wd-mac.js"></script>'));
  if (rel === "wd-mac.js") data = Buffer.from(String(data).replace("__WD_VERSION__", "0.1.0"));
  res.writeHead(200, { "content-type": TYPES[rel.split(".").pop()] });
  res.end(data);
});

(async () => {
  await new Promise(r => server.listen(8799, r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    await page.exposeBinding("__nodeBridge", (src, msg) => {
      try { return { result: bridge(msg.path, msg.body || {}) }; } catch (e) { return { error: e.message }; }
    });
    // what WKWebView provides: window.webkit.messageHandlers.wd.postMessage, answered via window.__wdReply
    await page.addInitScript(() => {
      window.webkit = { messageHandlers: { wd: { postMessage: msg => {
        window.__nodeBridge(JSON.parse(JSON.stringify(msg))).then(r => setTimeout(() => window.__wdReply(msg.id, r.result ?? null, r.error ?? null), 0));
      } } } };
    });

    await page.goto("http://127.0.0.1:8799/report.html"); await page.waitForSelector(".finding", { timeout: 10000 });
    const titles = await page.$$eval(".finding h3", h => h.map(x => x.textContent));
    ok("findings page shows the Mac findings through the bridge", titles.length === 4 && titles.some(t => /Outlook into Excel/.test(t)), titles.join(" | "));
    ok("Mac uses computer wording", (await page.textContent("#timeTitle")) === "Where your computer time went");
    await page.click('.finding button[data-r="accurate"]'); await page.waitForTimeout(200);
    ok("ratings saved through the bridge", kv.feedback && Object.values(kv.feedback).some(v => v.rating === "accurate"));
    const before = events.length;
    await page.click("#log tr td.x button"); await page.waitForTimeout(300);
    ok("deleting a log line goes through the bridge", events.length === before - 1);
    await page.check("#incLog"); await page.click("#export"); await page.waitForTimeout(400);
    const b = saved && JSON.parse(saved.text);
    ok("Save results file uses the Mac save dialog with a mac_ file name", !!b && /^workflow-detective_mac_/.test(saved.name) && b.source === "desktop" && b.os === "mac" && b.events.length === events.length, saved && saved.name);
    ok("confirmation shown after saving", /Saved/.test(await page.textContent("#exMsg")));
    await page.screenshot({ path: path.join(ROOT, "samples/mac-report.png"), fullPage: true });

    await page.goto("http://127.0.0.1:8799/onboarding.html"); await page.waitForSelector("#company");
    ok("setup page shows the desktop list with Mac wording", await page.isVisible('[data-for="desktop"]') && /never reads what you copied/.test(await page.textContent('[data-for="desktop"]')) && !(await page.isVisible('[data-for="desktop"] [data-mac-hide]')));
    ok("Accessibility step shown on Mac", await page.isVisible("#macPerm") && /Not allowed yet/.test(await page.textContent("#permPill")));
    await page.click("#permBtn"); await page.waitForTimeout(2300);
    ok("button opens System Settings, and the status updates once allowed", openedSettings === 1 && /Allowed/.test(await page.textContent("#permPill")));
    await page.fill("#participant", "Ana Pereira"); await page.click("#save"); await page.waitForSelector("#saved:not([hidden])");
    ok("saving settings writes them through the bridge", kv.settings.participant === "Ana Pereira");
    ok("saved message uses Mac wording (menu bar)", /menu bar/.test(await page.textContent("#saved")));
    await page.screenshot({ path: path.join(ROOT, "samples/mac-setup.png"), fullPage: true });

    // new participant presses ⌘V with the whole invite email on the clipboard
    const code = require(path.join(ROOT, "extension/lib/invite.js")).encode({ company: "COPPER & PINE", participant: "Luis Moreno", startDate: "2026-10-13", weeks: 2, hourStart: 9, hourEnd: 17 });
    kv.settings = { consented: false }; delete kv.pendingInvite;
    await page.goto("http://127.0.0.1:8799/onboarding.html"); await page.waitForSelector("#inviteBox:not([hidden])");
    ok("new participant: just ‘paste your invite code’", await page.isVisible("#inviteCode") && !(await page.isVisible("#company")));
    await page.evaluate(t => { const dt = new DataTransfer(); dt.setData("text/plain", t); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true })); }, "Hi Luis,\n\nOpen your link: https://x.github.io/workflow-detective/#" + code + "\n\nThanks");
    ok("pasting anywhere on the page fills in setup", (await page.textContent("#inviteHello")) === "Hi Luis, you’re all set up");
    await page.check("#consent"); await page.click("#save"); await page.waitForSelector("#saved:not([hidden])");
    ok("Start the study saves the invite’s settings", kv.settings.consented === true && kv.settings.company === "COPPER & PINE" && kv.settings.participant === "Luis Moreno");
    ok("no script errors", errs.length === 0, errs.join("; "));
  } catch (e) { ok("ran without crashing", false, e.stack); }
  finally {
    await browser.close(); server.close();
    results.forEach(([m, n, x]) => console.log(`${m} ${n}${x && m === "✗" ? "  — " + x : ""}`));
    const bad = results.filter(r => r[0] === "✗").length;
    console.log(bad ? `${bad} FAILED` : `All ${results.length} Mac page checks passed`);
    process.exit(bad ? 1 : 0);
  }
})();
