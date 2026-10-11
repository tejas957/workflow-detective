// Drives the desktop app's own pages (served by WorkflowDetective.exe --serve under Mono) in Chromium.
"use strict";
const { chromium } = require("playwright");
const { spawn } = require("child_process"); const fs = require("fs"), path = require("path");
const data = path.resolve(process.argv[2]);
const results = []; const ok = (n, c, x) => results.push([c ? "✓" : "✗", n, x || ""]);
(async () => {
  const app = spawn("mono", [path.resolve(__dirname, "../build/WorkflowDetective.exe"), "--serve", "--data", data, "--port", "47615"]);
  const url = await new Promise((res, rej) => { app.stdout.on("data", d => { const m = /http:\/\/\S+/.exec(String(d)); if (m) res(m[0]); }); setTimeout(() => rej(new Error("no url")), 15000); });
  const base = new URL(url).origin;
  const browser = await chromium.launch();
  try {
    const stranger = await browser.newPage();
    const r403 = await stranger.goto(base + "/report.html");
    ok("pages refuse visitors without the app's link", r403.status() === 403);
    const api403 = await stranger.evaluate(async b => (await fetch(b + "/api/events")).status, base);
    ok("API refuses visitors without the app's link", api403 === 403);

    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(url.replace("onboarding.html", "report.html")); await p.waitForSelector(".finding", { timeout: 10000 });
    ok("link sets the cookie and lands on the page without the secret in the address", !p.url().includes("k="), p.url());
    const titles = await p.$$eval(".finding h3", h => h.map(x => x.textContent));
    ok("findings page shows the desktop findings", titles.length === 4 && titles.some(t => /Outlook into Excel/.test(t)) && titles.some(t => /QuickBooks Desktop/.test(t)), titles.join(" | "));
    ok("desktop wording is used", (await p.textContent("#timeTitle")) === "Where your computer time went" && (await p.textContent("#tiles")).includes("Computer time per day"));
    await p.click('.finding button[data-r="new"]');
    await p.waitForTimeout(300);
    const kv = JSON.parse(fs.readFileSync(path.join(data, "kv.json"), "utf8"));
    ok("feedback is saved by the app", kv.feedback && Object.values(kv.feedback).some(v => v.rating === "new"));
    const before = (await p.evaluate(() => WD_API("events"))).length;
    await p.click("#log tr td.x button");
    await p.waitForTimeout(500);
    const after = (await p.evaluate(() => WD_API("events"))).length;
    ok("deleting a log line removes it from the app's files", after === before - 1, `${before} → ${after}`);
    await p.check("#incLog");
    const dl = p.waitForEvent("download"); await p.click("#export");
    const bundle = JSON.parse(fs.readFileSync(await (await dl).path(), "utf8"));
    ok("results file is marked as from Windows and includes the log", bundle.source === "desktop" && bundle.events.length === after && bundle.findings.length === 4 && /windows_/.test((await dl).suggestedFilename()), (await dl).suggestedFilename());
    fs.writeFileSync(path.resolve(__dirname, "../../samples/desktop-export.json"), JSON.stringify(bundle, null, 1));
    await p.screenshot({ path: path.resolve(__dirname, "../../samples/desktop-report.png"), fullPage: true });

    await p.goto(base + "/onboarding.html"); await p.waitForSelector("#company");
    const desktopListVisible = await p.isVisible('[data-for="desktop"]'), browserListVisible = await p.isVisible('[data-for="browser"]');
    ok("setup page shows the Windows version of what's recorded", desktopListVisible && !browserListVisible);
    ok("setup page loads the saved study", (await p.inputValue("#company")) === "NORTHLINE (sample)");
    await p.fill("#participant", "Dana Rivera"); await p.click("#save"); await p.waitForSelector("#saved:not([hidden])");
    const kv2 = JSON.parse(fs.readFileSync(path.join(data, "kv.json"), "utf8"));
    ok("saving settings writes them to the app", kv2.settings.participant === "Dana Rivera" && kv2.settings.consented === true);
    ok("saved message uses Windows wording", /near the clock/.test(await p.textContent("#saved")));
    await p.screenshot({ path: path.resolve(__dirname, "../../samples/desktop-setup.png"), fullPage: true });

    // first launch from the setup page: the app found the copied invite code and saved it as pendingInvite
    const code = require(path.resolve(__dirname, "../../extension/lib/invite.js")).encode({ company: "COPPER & PINE", participant: "Luis Moreno", startDate: "2026-10-13", weeks: 2, hourStart: 9, hourEnd: 17 });
    await p.evaluate(c => WD_API("kv/set", { settings: { consented: false }, pendingInvite: c }), code);
    await p.goto(base + "/onboarding.html"); await p.waitForSelector("#inviteDone:not([hidden])", { timeout: 5000 }).catch(() => {});
    ok("copied invite code fills in setup by itself", (await p.textContent("#inviteHello")) === "Hi Luis, you’re all set up" && /COPPER & PINE · Luis Moreno/.test(await p.textContent("#inviteSummary")) && !(await p.isVisible("#company")));
    await p.click("#save");
    ok("can’t start without ticking consent", /consent/.test(await p.textContent("#msg")));
    await p.check("#consent"); await p.click("#save"); await p.waitForSelector("#saved:not([hidden])");
    const kv3 = JSON.parse(fs.readFileSync(path.join(data, "kv.json"), "utf8"));
    ok("Start the study saves the invite’s settings and clears the code", kv3.settings.consented === true && kv3.settings.company === "COPPER & PINE" && kv3.settings.hourStart === 9 && kv3.settings.scheduleMode === "rotate" && !kv3.pendingInvite);
    ok("no script errors", errs.length === 0, errs.join("; "));
  } catch (e) { ok("ran without crashing", false, e.stack); }
  finally {
    await browser.close(); app.kill();
    results.forEach(([m, n, x]) => console.log(`${m} ${n}${x ? "  — " + x : ""}`));
    const bad = results.filter(r => r[0] === "✗").length;
    console.log(bad ? `${bad} FAILED` : `All ${results.length} desktop page checks passed`);
    process.exit(bad ? 1 : 0);
  }
})();
