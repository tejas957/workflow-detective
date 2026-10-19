// Loads two simulated weeks into the real extension and screenshots the participant report.
const { chromium } = require("playwright"); const path = require("path"), fs = require("fs"), os = require("os");
const { generate } = require("./synth.js");
(async () => {
  const EXT = path.resolve(__dirname, "../extension");
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "wd-s-")), { headless: false, viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const p = await ctx.newPage(); await p.goto(`chrome-extension://${id}/report.html`);
  const ev = generate("ar", "2026-09-21", 2, 42);
  await p.evaluate(async ev => {
    await chrome.storage.local.set({ settings: { consented: true, participant: "Dana R.", company: "NORTHLINE", startDate: "2026-09-21", weeks: 2, scheduleMode: "rotate", days: [2,3,4], hourStart: 8, hourEnd: 18, captureTitles: true, captureFieldLabels: true, blocked: [] } });
    await new Promise(res => { const r = indexedDB.open("workflow-detective", 1); r.onupgradeneeded = () => { const s = r.result.createObjectStore("events", { keyPath: "id", autoIncrement: true }); s.createIndex("t", "t"); }; r.onsuccess = () => { const tx = r.result.transaction("events", "readwrite"); ev.forEach(e => tx.objectStore("events").add(e)); tx.oncomplete = res; }; });
  }, ev);
  await p.reload(); await p.waitForSelector(".finding");
  await p.screenshot({ path: path.resolve(__dirname, "../samples/report.png"), fullPage: true });
  await p.setViewportSize({ width: 400, height: 900 }); await p.screenshot({ path: path.resolve(__dirname, "../samples/report-phone.png") });
  await ctx.close();
})();
