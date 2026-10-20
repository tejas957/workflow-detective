// End-to-end: load the real extension in Chromium, set it up through the consent form, work on two
// "apps" (two local hosts), then check the log, the privacy rules, the findings, and the export.
// Run: NODE_PATH=$(npm root -g) xvfb-run -a node test/e2e.js
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");

const EXT_SRC = path.resolve(__dirname, "../extension");
// Chrome's "Allow access to all sites" prompt can't be clicked in automation, so the test runs a copy of the extension
// whose manifest already has that access (as if the participant clicked Allow). The shipped manifest is checked below.
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), "wd-ext-"));
fs.cpSync(EXT_SRC, EXT, { recursive: true });
{ const m = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); m.host_permissions = m.host_permissions.concat(m.optional_host_permissions); fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(m)); }
const SHIPPED = JSON.parse(fs.readFileSync(path.join(EXT_SRC, "manifest.json"), "utf8"));
const SITE = path.resolve(__dirname, "site");
const SECRET = "TYPED-SECRET-9431";
const results = []; const ok = (name, cond, extra) => { results.push([cond ? "✓" : "✗", name, extra || ""]); };

const ROOT = path.resolve(__dirname, "..");
const SETUP = { "/setup/": "site/index.html", "/setup/invite.js": "extension/lib/invite.js", "/setup/config.json": "site/config.json" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (SETUP[u]) { res.writeHead(200, { "content-type": u.endsWith(".js") ? "text/javascript" : u.endsWith(".json") ? "application/json" : "text/html" }); return fs.createReadStream(path.join(ROOT, SETUP[u])).pipe(res); }
  const f = path.join(SITE, u);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = f.endsWith(".html") ? "text/html" : "text/csv";
  res.writeHead(200, { "content-type": type, ...(f.endsWith(".csv") ? { "content-disposition": "attachment; filename=export.csv" } : {}) });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8765, r));
  const A = "http://127.0.0.1:8765", B = "http://localhost:8765";
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-e2e-"));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false, acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    const id = new URL(sw.url()).host;
    ok("extension loads and its background worker starts", !!id, id);
    const broad = x => /^(\*|<all_urls>|https?:\/\/\*\/)/.test(x) || x.startsWith("*://*/");
    ok("shipped manifest: no access to every site at install, only the pilot's setup page", !SHIPPED.host_permissions.some(broad) && !SHIPPED.content_scripts.some(c => c.matches.some(broad)) && SHIPPED.optional_host_permissions.some(broad), JSON.stringify(SHIPPED.host_permissions));
    await new Promise(r => setTimeout(r, 800));
    const reg = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map(c => c.id));
    ok("once website access is allowed, the page script is registered for all sites", reg.includes("wd-sites"), JSON.stringify(reg));

    // 1. onboarding opens on install; complete it through the real form
    let ob = ctx.pages().find(p => p.url().includes("onboarding.html"));
    if (!ob) ob = await ctx.waitForEvent("page", { predicate: p => p.url().includes("onboarding.html"), timeout: 8000 }).catch(() => null);
    ok("setup page opens automatically after install", !!ob);
    if (!ob) { ob = await ctx.newPage(); await ob.goto(`chrome-extension://${id}/onboarding.html`); }
    await ob.waitForSelector("#inviteBox:not([hidden])");
    ok("new participant sees ‘paste your invite code’, with the long form folded away", await ob.isVisible("#inviteCode") && !(await ob.isVisible("#company")));
    // 1b. the personal setup page hands the extension the invite → setup fills itself in
    const today = new Date();
    const localIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const code = require(path.join(ROOT, "extension/lib/invite.js")).encode({ company: "NORTHLINE", participant: "Test Person", startDate: localIso, weeks: 1, hourStart: 0, hourEnd: 23, scheduleMode: "fixed", days: [0, 1, 2, 3, 4, 5, 6], work: "web" });
    const setup = await ctx.newPage(); await setup.goto(A + "/setup/#" + code);
    await ob.waitForSelector("#inviteDone:not([hidden])", { timeout: 8000 }).catch(() => {});
    ok("opening the personal link fills in the extension’s setup by itself", await ob.isVisible("#inviteDone") && (await ob.textContent("#inviteHello")) === "Hi Test, you’re all set up" && /NORTHLINE · Test Person/.test(await ob.textContent("#inviteSummary")), await ob.textContent("#inviteSummary"));
    await setup.waitForTimeout(2600);
    ok("the setup page sees the add-on is installed", (await setup.getAttribute("html", "data-wd-extension")) === "installed" && /Added ✓/.test(await setup.textContent("#extStatus")));
    await ob.bringToFront();
    const prev = await ob.textContent("#preview");
    ok("schedule preview lists the watch days", /watch days/.test(prev), prev.slice(0, 80));
    ok("setup explains Chrome's website-access prompt before Start", await ob.isVisible("#accessNote") && /Allow/.test(await ob.textContent("#accessNote")));
    await ob.check("#consent");
    await ob.click("#save");
    await ob.waitForSelector("#saved:not([hidden])", { timeout: 5000 });
    await setup.waitForTimeout(2600);
    ok("…and that it’s set up", (await setup.getAttribute("html", "data-wd-extension")) === "ready" && /set up ✓/.test(await setup.textContent("#extStatus")));
    await setup.close();
    // widen hours so the test passes at any clock time
    await ob.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); settings.hourEnd = 24; await chrome.storage.local.set({ settings }); });
    const s = await ob.evaluate(async () => (await chrome.storage.local.get("settings")).settings);
    ok("consent form saves settings", s.consented && s.company === "NORTHLINE" && s.scheduleMode === "fixed", JSON.stringify({ consented: s.consented, mode: s.scheduleMode, start: s.startDate }));

    // 2. work: 5 rounds of copy from "inbox" (app A) → paste into "tracker" (app B), typing + a password field
    const inbox = await ctx.newPage(); await inbox.goto(A + "/inbox.html");
    const tracker = await ctx.newPage(); await tracker.goto(B + "/tracker.html");
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: A });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: B });
    for (let i = 0; i < 5; i++) {
      await inbox.bringToFront(); await inbox.waitForTimeout(400);
      await inbox.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("amt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
      await inbox.keyboard.press("Control+C");
      await inbox.waitForTimeout(300);
      await tracker.bringToFront(); await tracker.waitForTimeout(400);
      await tracker.click("#amount"); await tracker.fill("#amount", "");
      await tracker.keyboard.press("Control+V");
      await tracker.type("#client", SECRET.slice(0, 6) + i);
      await tracker.type("#pw", "hunter2");
      await tracker.click("#save");
      await tracker.waitForTimeout(3200); // > 3 min burst gap is simulated by pasting once per round
    }
    // download from A, upload to B
    await inbox.bringToFront();
    const dl = inbox.waitForEvent("download"); await inbox.click("#dl"); await (await dl).path();
    await tracker.bringToFront(); await tracker.setInputFiles("#file", path.join(SITE, "upload.csv"));
    await tracker.type("#client", SECRET); await tracker.waitForTimeout(4600); // let the field batch flush

    // 3. read the log back from the extension
    const rep = await ctx.newPage(); await rep.goto(`chrome-extension://${id}/report.html`);
    await rep.waitForSelector("#tiles .tile");
    const ev = await rep.evaluate(() => new Promise(res => { const r = indexedDB.open("workflow-detective"); r.onsuccess = () => { const q = r.result.transaction("events").objectStore("events").getAll(); q.onsuccess = () => res(q.result); }; }));
    const types = ev.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {});
    ok("records page views for both apps", ev.some(e => e.type === "view" && e.app === "127.0.0.1") && ev.some(e => e.type === "view" && e.app === "localhost"), JSON.stringify(types));
    ok("records copies in app A and pastes in app B", (types.copy || 0) >= 5 && (types.paste || 0) >= 5 && ev.filter(e => e.type === "paste").every(e => e.app === "localhost"));
    ok("paste is tagged with the field label", ev.some(e => e.type === "paste" && e.d.field === "Amount"));
    ok("copy records the kind of thing, not the value", ev.some(e => e.type === "copy" && e.d.kind === "number"), JSON.stringify(ev.find(e => e.type === "copy")?.d));
    ok("form entries list field names", ev.some(e => e.type === "entry" && (e.d.labels || []).includes("Client")));
    ok("password field is counted as sensitive, never named", ev.some(e => e.type === "entry" && e.d.sensitive >= 1) && !ev.some(e => (e.d.labels || []).some(l => /password/i.test(l))));
    ok("button clicks are recorded by label", ev.some(e => e.type === "click" && e.d.label === "Save row"));
    ok("download recorded with file type", ev.some(e => e.type === "download" && e.d.ext === "csv"));
    ok("upload recorded with file type", ev.some(e => e.type === "upload" && e.d.ext === "csv"));
    const dump = JSON.stringify(ev);
    ok("nothing typed is stored anywhere (secret, password, copied amount)", !dump.includes(SECRET.slice(0, 6)) && !dump.includes("hunter2") && !dump.includes("1,200") && !dump.includes("1200"));
    ok("page titles lose numbers and email addresses", ev.some(e => e.title && e.title.includes("Invoice #")) && !dump.includes("pat@acme.com") && !dump.includes("1042"), ev.find(e => e.app === "127.0.0.1" && e.type === "view")?.title);

    // 4. findings — the 5 rounds above took seconds; spread them over 2 days (15 min apart) like real work
    await rep.evaluate(() => new Promise(res => {
      const r = indexedDB.open("workflow-detective");
      r.onsuccess = () => {
        const st = r.result.transaction("events", "readwrite").objectStore("events");
        const q = st.getAll();
        q.onsuccess = () => {
          let round = -1;
          for (const e of q.result.sort((a, b) => a.t - b.t)) {
            if (e.type === "copy") round++;
            const k = Math.max(0, round);
            e.t = e.t - 2 * 864e5 + k * 15 * 60e3 + (k >= 3 ? 864e5 : 0);
            st.put(e);
          }
        };
        st.transaction.oncomplete = res;
      };
    }));
    await rep.reload(); await rep.waitForSelector("#tiles .tile");
    const titles = await rep.$$eval(".finding h3", hs => hs.map(h => h.textContent));
    ok("report shows the copy-paste finding", titles.some(t => /Copying (information|details) from 127\.0\.0\.1 into localhost/.test(t)), titles.join(" | "));
    await rep.click('.finding button[data-r="accurate"]');
    const fb = await rep.evaluate(async () => (await chrome.storage.local.get("feedback")).feedback);
    ok("feedback buttons save the participant's rating", fb && Object.values(fb).some(v => v.rating === "accurate"));
    const logRows = await rep.$$eval("#log tr", r => r.length);
    ok("activity log table lists today's events", logRows > 10, logRows + " rows");

    // 5. export
    await rep.check("#incLog");
    const exp = rep.waitForEvent("download"); await rep.click("#export");
    const file = await (await exp).path();
    const b = JSON.parse(fs.readFileSync(file, "utf8"));
    ok("export file has findings, feedback and (opted-in) log", b.schema.startsWith("workflow-detective/bundle") && b.findings.length >= 1 && Object.keys(b.feedback).length >= 1 && b.events.length === ev.length, `${b.findings.length} findings, ${b.events.length} events`);
    fs.writeFileSync(path.resolve(__dirname, "../samples/e2e-export.json"), JSON.stringify(b, null, 1));

    // 6. pause stops recording; never-watch deletes a site's history
    await rep.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); settings.pausedUntil = Date.now() + 3600e3; await chrome.storage.local.set({ settings }); });
    const before = ev.length; await inbox.bringToFront(); await inbox.reload(); await inbox.keyboard.press("Control+C"); await inbox.waitForTimeout(800);
    const after = await rep.evaluate(() => new Promise(res => { const r = indexedDB.open("workflow-detective"); r.onsuccess = () => { const q = r.result.transaction("events").objectStore("events").count(); q.onsuccess = () => res(q.result); }; }));
    ok("pausing stops recording", after === before, `${before} → ${after}`);
    const pop = await ctx.newPage(); await pop.goto(`chrome-extension://${id}/popup.html`);
    await pop.evaluate(() => chrome.runtime.sendMessage({ cmd: "forgetHost", host: "127.0.0.1" }));
    const left = await rep.evaluate(() => new Promise(res => { const r = indexedDB.open("workflow-detective"); r.onsuccess = () => { const q = r.result.transaction("events").objectStore("events").getAll(); q.onsuccess = () => res(q.result.filter(e => e.host === "127.0.0.1").length); }; }));
    ok("“never watch this site” deletes that site's history", left === 0);
    await pop.screenshot({ path: path.resolve(__dirname, "../samples/popup.png") });
    await rep.bringToFront(); await rep.reload(); await rep.waitForSelector("#tiles .tile");
    await rep.setViewportSize({ width: 1100, height: 900 });
    await ob.bringToFront(); await ob.setViewportSize({ width: 1100, height: 900 }); await ob.screenshot({ path: path.resolve(__dirname, "../samples/onboarding.png"), fullPage: true });
    await ctx.close();

    // 2. the shipped extension as installed from the store, before the participant clicks Allow
    const ctx2 = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "wd-e2e2-")), {
      headless: false, args: [`--disable-extensions-except=${EXT_SRC}`, `--load-extension=${EXT_SRC}`]
    });
    try {
      let [sw2] = ctx2.serviceWorkers();
      if (!sw2) sw2 = await ctx2.waitForEvent("serviceworker", { timeout: 15000 });
      const id2 = new URL(sw2.url()).host;
      await new Promise(r => setTimeout(r, 800));
      const before = await sw2.evaluate(async () => ({ all: await chrome.permissions.contains({ origins: ["https://example.com/*"] }), setup: await chrome.permissions.contains({ origins: ["https://tejas957.github.io/*"] }), reg: (await chrome.scripting.getRegisteredContentScripts()).length }));
      ok("shipped extension installs with access to the setup page only", !before.all && before.setup && before.reg === 0, JSON.stringify(before));
      await sw2.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: Object.assign({}, settings, { consented: true, startDate: "2026-10-12" }) }); });
      await new Promise(r => setTimeout(r, 800));
      ok("set up without website access → red ! on the toolbar icon", (await sw2.evaluate(() => chrome.action.getBadgeText({}))) === "!");
      const pop2 = await ctx2.newPage(); await pop2.goto(`chrome-extension://${id2}/popup.html`); await pop2.waitForTimeout(500);
      ok("…and the popup offers ‘Allow website access’", await pop2.isVisible("#access") && await pop2.isVisible("#allow"));
    } finally { await ctx2.close(); }
  } catch (e) {
    ok("test ran without crashing", false, e.stack);
  } finally {
    await ctx.close(); server.close();
    for (const [m, n, x] of results) console.log(`${m} ${n}${x ? "  — " + x : ""}`);
    const bad = results.filter(r => r[0] === "✗").length;
    console.log(bad ? `\n${bad} FAILED` : `\nAll ${results.length} browser checks passed`);
    process.exit(bad ? 1 : 0);
  }
})();
