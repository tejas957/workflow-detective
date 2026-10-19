// The public pages: the participant "Get started" page (site/index.html) and the pilot team's invite tool
// (site/invite.html). Serves site/ the way GitHub Pages will (with invite.js copied in), under three setups:
//   /live/     download links + Chrome Web Store link configured, downloads.json says all three exist
//   /nomac/    no store link yet, Mac download missing
//   /preview/  the repo's own config.json and no downloads.json (a copy opened before publishing)
// and fakes different computers through the user agent.
// Run: NODE_PATH=$(npm root -g) node test/site.test.js
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const I = require(path.join(ROOT, "extension/lib/invite.js"));
const results = []; const ok = (n, c, x) => results.push([c ? "✓" : "✗", n, x || ""]);
const PORT = 8811, BASE = `http://127.0.0.1:${PORT}`;

const SETUPS = {
  live: { config: { contactName: "Tejas Senthil", contactEmail: "tns976@eid.utexas.edu", chromeStoreUrl: "https://chromewebstore.google.com/detail/workflow-detective/abc", windowsDownloadUrl: `${BASE}/files/WorkflowDetective.exe`, macDownloadUrl: `${BASE}/files/WorkflowDetective-mac.zip` }, downloads: { windows: true, mac: true, extension: true } },
  nomac: { config: { contactName: "Tejas Senthil", contactEmail: "tns976@eid.utexas.edu", chromeStoreUrl: "", windowsDownloadUrl: `${BASE}/files/WorkflowDetective.exe`, macDownloadUrl: `${BASE}/files/WorkflowDetective-mac.zip` }, downloads: { windows: true, mac: false, extension: false } },
  preview: { config: null, downloads: null }
};
const server = http.createServer((req, res) => {
  const parts = decodeURIComponent(req.url.split("?")[0]).split("/").filter(Boolean);
  if (parts[0] === "files") { res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename=${parts[1]}` }); return res.end("binary"); }
  const setup = SETUPS[parts[0]], file = parts[1] || "index.html";
  if (!setup) { res.writeHead(404); return res.end(); }
  let body = null, type = "text/html";
  if (file === "invite.js") { body = fs.readFileSync(path.join(ROOT, "extension/lib/invite.js")); type = "text/javascript"; }
  else if (file === "config.json") { body = setup.config ? JSON.stringify(setup.config) : fs.readFileSync(path.join(ROOT, "site/config.json")); type = "application/json"; }
  else if (file === "downloads.json") { if (setup.downloads) { body = JSON.stringify(setup.downloads); type = "application/json"; } }
  else if (/^(index|invite|guide|privacy)\.html$/.test(file)) body = fs.readFileSync(path.join(ROOT, "site", file));
  if (body == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": type }); res.end(body);
});

const UA = {
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
};
const invite = extra => I.encode(Object.assign({ company: "NORTHLINE", participant: "Dana Rivera", startDate: "2026-10-12", weeks: 2, hourStart: 8, hourEnd: 18 }, extra));

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const errs = [];
  async function open(ua, url, opts) {
    const ctx = await browser.newContext(Object.assign({ userAgent: ua, viewport: { width: 1000, height: 900 }, acceptDownloads: true }, opts || {}));
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const p = await ctx.newPage(); p.on("pageerror", e => errs.push(url + ": " + e.message));
    await p.goto(url); await p.waitForTimeout(350);
    return p;
  }
  const visible = (p, sel) => p.isVisible(sel);
  const stepIds = p => p.$$eval("#steps > li", l => l.map(x => x.id || "message"));
  const text = (p, sel) => p.textContent(sel);
  try {
    /* ---------------- participant setup page ---------------- */
    // 1. personal link, Windows + Chrome, work not known yet → one question → extension + Windows app
    let p = await open(UA.winChrome, `${BASE}/live/#${invite()}`);
    ok("personal link greets the person by first name", (await text(p, "#hello")) === "Hi Dana, let’s get you set up");
    ok("no typing needed: name/company form stays hidden", !(await visible(p, "#who")));
    ok("asks exactly one question when the pilot team didn’t know how they work", await visible(p, "#question") && !(await visible(p, "#plan")));
    await p.click('[data-work="both"]');
    ok("Windows + Chrome + ‘a mix’ → add-on, then Windows app", JSON.stringify(await stepIds(p)) === '["st-extension","st-windows"]', JSON.stringify(await stepIds(p)));
    ok("computer is detected and shown", /a Windows PC.*Chrome/.test(await text(p, "#device")));
    ok("store button points at the Chrome Web Store", (await p.getAttribute("#addExt", "href")) === SETUPS.live.config.chromeStoreUrl);
    ok("the page tells the add-on the invite code (meta tag)", (await p.getAttribute('meta[name="workflow-detective-invite"]', "content")) === I.find(p.url()));
    const posted = await p.evaluate(() => new Promise(r => { addEventListener("message", e => { if (e.data && e.data.type === "workflow-detective-invite") r(e.data.code); }); setTimeout(() => r(null), 2500); }));
    ok("…and by postMessage, so the add-on can pick it up after installing", posted === I.find(p.url()));
    const dl = p.waitForEvent("download"); await p.click("#dl-windows"); const d = await dl;
    ok("Download for Windows downloads the app", d.suggestedFilename() === "WorkflowDetective.exe");
    await p.waitForSelector("#copied-windows:not([hidden])");
    ok("clicking Download copies the invite code for the app to read", (await p.evaluate(() => navigator.clipboard.readText())) === I.find(p.url()) && /copied/.test(await text(p, "#copied-windows")));
    ok("Windows steps explain SmartScreen in plain words", /More info.*Run anyway/.test(await text(p, "#st-windows")));
    await p.evaluate(() => document.documentElement.setAttribute("data-wd-extension", "installed")); await p.waitForTimeout(1700);
    ok("status updates when the add-on is installed", /Added ✓/.test(await text(p, "#extStatus")));
    await p.evaluate(() => document.documentElement.setAttribute("data-wd-extension", "ready")); await p.waitForTimeout(1700);
    ok("…and when it’s set up", /set up ✓/.test(await text(p, "#extStatus")) && (await p.getAttribute("#st-extension", "class")).includes("done"));
    ok("contact shown at the bottom", /Tejas Senthil at tns976@eid\.utexas\.edu/.test(await text(p, "#contact")));
    await p.reload(); await p.waitForTimeout(400);
    ok("coming back later remembers the answer", await visible(p, "#plan") && !(await visible(p, "#question")));
    await p.click("#changeWork"); ok("‘Change my answer’ brings the question back", await visible(p, "#question"));
    await p.context().close();

    // 2. pilot team already knew → straight to the steps
    p = await open(UA.winChrome, `${BASE}/live/#${invite({ work: "desktop", computer: "windows" })}`);
    ok("when the invite says how they work, no questions at all", !(await visible(p, "#question")) && JSON.stringify(await stepIds(p)) === '["st-windows"]');
    await p.click("#switchOs");
    ok("‘Not right? Switch to Mac’ swaps the instructions", JSON.stringify(await stepIds(p)) === '["st-mac"]');
    await p.context().close();

    // 3. Mac + Safari: no add-on possible → Mac app covers websites too
    p = await open(UA.macSafari, `${BASE}/live/#${invite({ work: "both" })}`);
    ok("Mac + Safari → just the Mac app, with a reason", JSON.stringify(await stepIds(p)) === '["st-mac"]' && /Safari.*Mac app covers websites/.test(await text(p, "#planNote")));
    ok("Mac steps: Open Anyway, ⌘V, Accessibility", /Open Anyway/.test(await text(p, "#st-mac")) && /⌘V/.test(await text(p, "#st-mac")) && /Accessibility/.test(await text(p, "#st-mac")));
    ok("Mac download link is the zip", /WorkflowDetective-mac\.zip$/.test(await p.getAttribute("#dl-mac", "href")));
    await p.context().close();

    // 4. Windows + Firefox, websites only → Windows app instead of the add-on
    p = await open(UA.winFirefox, `${BASE}/live/#${invite({ work: "web" })}`);
    ok("Firefox, websites → Windows app, with a reason", JSON.stringify(await stepIds(p)) === '["st-windows"]' && /needs Chrome or Edge/.test(await text(p, "#planNote")));
    await p.context().close();

    // 5. Edge
    p = await open(UA.winEdge, `${BASE}/live/#${invite({ work: "web" })}`);
    ok("Edge, websites → ‘Add to Edge’ with the other-stores tip", JSON.stringify(await stepIds(p)) === '["st-extension"]' && /Add to Edge/.test(await text(p, "#addExt")) && /other stores/.test(await text(p, "#st-extension")));
    await p.context().close();

    // 6. phone
    p = await open(UA.iphone, `${BASE}/live/#${invite({ work: "both" })}`, { viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
    ok("on a phone: ‘open this on your work computer’", /work computer/.test(await text(p, "#steps")) && !(await visible(p, "#finish")));
    ok("no sideways scrolling at phone width", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.context().close();

    // 7. Mac download not published yet, no store link → helpful fallbacks
    p = await open(UA.macChrome, `${BASE}/nomac/#${invite({ work: "desktop" })}`);
    ok("nothing available for this computer → contact message, not a dead button", /isn’t supported yet.*Tejas Senthil/.test(await text(p, "#steps")));
    await p.context().close();
    p = await open(UA.winChrome, `${BASE}/nomac/#${invite({ work: "both" })}`);
    ok("no store link yet → the Windows app alone", JSON.stringify(await stepIds(p)) === '["st-windows"]');
    await p.context().close();

    // 8. company-wide link: only the name is asked
    p = await open(UA.winChrome, `${BASE}/live/#${I.encode({ company: "COPPER & PINE", startDate: "2026-10-12", weeks: 2, hourStart: 8, hourEnd: 18 })}`);
    ok("company link asks only for a name", await visible(p, "#whoName") && !(await visible(p, "#whoCompany")) && /COPPER &amp; PINE|COPPER & PINE/.test(await text(p, "#lead")));
    await p.fill("#whoName", "Priya Shah"); await p.click("#whoForm button[type=submit]");
    const inv8 = I.decode(p.url());
    ok("…then greets them and keeps the company’s settings", (await text(p, "#hello")) === "Hi Priya, let’s get you set up" && inv8 && inv8.participant === "Priya Shah" && inv8.company === "COPPER & PINE" && inv8.startDate === "2026-10-12");
    await p.context().close();

    // 9. no invite, or a damaged one
    p = await open(UA.winChrome, `${BASE}/live/#WD1.eyJ2IjoxLCJjIjoiTk9SVEhMSU5FIn0.zzzz`);
    ok("damaged link → asks for name and company code", await visible(p, "#whoName") && await visible(p, "#whoCompany"));
    await p.fill("#whoName", "Sam Lee"); await p.fill("#whoCompany", "NORTHLINE"); await p.click("#whoForm button[type=submit]");
    ok("…and carries on from there", (await text(p, "#hello")) === "Hi Sam, let’s get you set up" && await visible(p, "#question"));
    await p.context().close();
    p = await open(UA.winChrome, `${BASE}/preview/`);
    ok("unpublished copy shows the sample banner", await visible(p, "#preview"));
    await p.click("#sample"); await p.click('[data-work="both"]');
    ok("sample person walks through the plan", JSON.stringify(await stepIds(p)) === '["st-extension","st-windows"]');
    ok("contact from the repo’s config.json", /tns976@eid\.utexas\.edu/.test(await text(p, "#contact")));
    await p.screenshot({ path: path.join(ROOT, "samples/site-setup.png"), fullPage: true });
    await p.context().close();

    /* ---------------- pilot team invite tool ---------------- */
    p = await open(UA.winChrome, `${BASE}/live/invite.html`);
    const start = await p.inputValue("#start");
    const sd = new Date(start + "T12:00"), today = new Date(); today.setHours(0, 0, 0, 0);
    ok("start date defaults to the next Monday", sd.getDay() === 1 && sd >= today && (sd - today) / 864e5 < 8, start);
    ok("your name and email come from config.json", (await p.inputValue("#contact")) === "Tejas Senthil" && (await p.inputValue("#email")) === "tns976@eid.utexas.edu");
    ok("warns when not running from the published site", await visible(p, "#baseWarn"));
    await p.fill("#base", `${BASE}/live/`);
    await p.click("summary");
    await p.fill("#paste", "Name, Company, Computer, Works in\nDana Rivera, NORTHLINE, Windows, programs\nLuis Moreno\tCOPPER & PINE\tMacBook\tboth\nPriya Shah, NORTHLINE");
    await p.click("#addPaste");
    const cards = await p.$$eval("#out .person", a => a.map(x => ({ h: x.querySelector("h3").textContent, chip: x.querySelector(".chip").textContent })));
    ok("pasting a list (commas or tabs, header skipped) adds everyone", cards.length === 3, JSON.stringify(cards));
    ok("recommends the setup for each person", cards[0] && cards[0].chip === "Windows app" && cards[1].chip === "Browser extension + Mac app" && cards[2].chip === "Their setup page asks one question", JSON.stringify(cards.map(c => c.chip)));
    await p.selectOption("#hours", "9-17");
    await p.click('#out [data-act="link"][data-i="0"]'); await p.waitForTimeout(150);
    const link = await p.evaluate(() => navigator.clipboard.readText());
    const li = I.decode(link);
    ok("Copy link: personal link with everything in it", link.startsWith(`${BASE}/live/#WD1.`) && li && li.participant === "Dana Rivera" && li.company === "NORTHLINE" && li.startDate === start && li.weeks === 2 && li.hourStart === 9 && li.hourEnd === 17 && li.work === "desktop" && li.computer === "windows", link);
    await p.click('#out [data-act="email"][data-i="1"]'); await p.waitForTimeout(150);
    const mail = await p.evaluate(() => navigator.clipboard.readText());
    ok("Copy email: subject, first name, their link, signed by you", /^Subject: Your 5-minute setup for the COPPER & PINE workflow pilot/.test(mail) && /Hi Luis,/.test(mail) && mail.includes("#WD1.") && /Tejas Senthil\ntns976@eid\.utexas\.edu$/.test(mail));
    await p.click('#out [data-act="notice"][data-i="2"]'); await p.waitForTimeout(150);
    const notice = await p.evaluate(() => navigator.clipboard.readText());
    ok("Copy consent notice: filled in for that person", /Company: NORTHLINE\s+Participant: Priya Shah/.test(notice) && /9 am – 5 pm/.test(notice) && /Tejas Senthil, tns976@eid\.utexas\.edu/.test(notice));
    await p.click("#copySheet"); await p.waitForTimeout(150);
    const sheet = (await p.evaluate(() => navigator.clipboard.readText())).split("\n");
    ok("Copy as a spreadsheet: header + one row each", sheet.length === 4 && sheet[0].split("\t").length === 5);
    await p.click("#copyAll"); await p.waitForTimeout(150);
    ok("Copy all emails", (await p.evaluate(() => navigator.clipboard.readText())).split("To: ").length === 4 && /3 emails copied/.test(await text(p, "#allMsg")));
    await p.reload(); await p.waitForTimeout(400);
    ok("people and settings are remembered", (await p.$$("#out .person")).length === 3 && (await p.inputValue("#hours")) === "9-17");
    await p.click('#rows [data-del="2"]');
    ok("removing a person", (await p.$$("#out .person")).length === 2);
    await p.click("#addRow"); await p.keyboard.type("Ana Pereira");
    ok("Add a person copies the company from the row above", (await p.$$("#out .person")).length === 3 && /COPPER & PINE/.test(await text(p, "#out .person:last-child h3")));
    ok("client guide link follows the setup page address", (await text(p, "#guideLink")) === `${BASE}/live/guide.html`);
    await p.screenshot({ path: path.join(ROOT, "samples/site-invite.png"), fullPage: true });
    ok("invite tool fits a phone screen", await (async () => { await p.setViewportSize({ width: 375, height: 800 }); await p.waitForTimeout(100); return p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); })());
    await p.context().close();

    // 10. the link the tool made opens straight to Dana's steps on her Windows PC
    p = await open(UA.winChrome, link);
    ok("the tool’s link → Dana’s page goes straight to the Windows app", (await text(p, "#hello")) === "Hi Dana, let’s get you set up" && JSON.stringify(await stepIds(p)) === '["st-windows"]');
    await p.context().close();

    // 11. client guide
    p = await open(UA.winChrome, `${BASE}/live/guide.html`);
    ok("client guide loads with the contact from config.json", /Tejas Senthil at tns976@eid\.utexas\.edu/.test(await text(p, "#contact")) && (await p.$$("section")).length >= 5);
    ok("client guide fits a phone screen", await (async () => { await p.setViewportSize({ width: 375, height: 800 }); await p.waitForTimeout(100); return p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); })());
    await p.setViewportSize({ width: 1000, height: 900 });
    await p.screenshot({ path: path.join(ROOT, "samples/site-guide.png"), fullPage: true });
    await p.context().close();

    ok("no script errors", errs.length === 0, errs.join("; "));
  } catch (e) { ok("ran without crashing", false, e.stack); }
  finally {
    await browser.close(); server.close();
    results.forEach(([m, n, x]) => console.log(`${m} ${n}${x && m === "✗" ? "  — " + x : ""}`));
    const bad = results.filter(r => r[0] === "✗").length;
    console.log(bad ? `${bad} FAILED` : `All ${results.length} site checks passed`);
    process.exit(bad ? 1 : 0);
  }
})();
