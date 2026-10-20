import { getSettings, saveSettings, status } from "./lib/settings.js";
import { countSince } from "./lib/db.js";

const $ = id => document.getElementById(id);
const ALL_SITES = { origins: ["http://*/*", "https://*/*"] };
let host = null;

async function render() {
  const s = await getSettings();
  const st = status(s);
  $("pill").className = "pill " + st.state;
  $("pill").textContent = st.label;
  $("sub").textContent = st.state === "setup" ? "Finish setup to start the study." :
    st.state === "done" ? "All watch days are done. Open your findings and send them to the pilot team." :
    st.state === "withdrawn" ? "You stopped taking part. Nothing is being recorded." :
    (st.dayNumber ? "Watch day " + st.dayNumber + " of " + st.total + " · " : "") + "Watching " + st.hours + " on watch days.";
  const mid = new Date(); mid.setHours(0, 0, 0, 0);
  try { $("today").textContent = await countSince(mid.getTime()); } catch { $("today").textContent = "0"; }
  $("days").textContent = st.done + " of " + st.total;
  $("pause").textContent = st.state === "paused" ? "Resume watching" : "Pause for 1 hour";
  $("pause").disabled = !["active", "paused", "later", "off"].includes(st.state);
  $("report").textContent = st.state === "setup" ? "Set up" : "Open my findings";
  $("block").hidden = !host || st.state === "setup";
  const access = await chrome.permissions.contains(ALL_SITES).catch(() => true);
  $("access").hidden = access || !s.consented || s.withdrawn;
  $("host").textContent = host || "";
}

$("report").addEventListener("click", async () => {
  const s = await getSettings();
  chrome.tabs.create({ url: chrome.runtime.getURL(s.consented ? "report.html" : "onboarding.html") });
});
$("allow").addEventListener("click", () => { chrome.permissions.request(ALL_SITES).then(render, render); });
$("settings").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }));
$("pause").addEventListener("click", async () => {
  const s = await getSettings();
  await saveSettings({ pausedUntil: s.pausedUntil > Date.now() ? 0 : Date.now() + 3600e3 });
  render();
});
$("block").addEventListener("click", async () => {
  const s = await getSettings();
  if (!s.blocked.includes(host)) await saveSettings({ blocked: [...s.blocked, host] });
  await chrome.runtime.sendMessage({ cmd: "forgetHost", host });
  $("block").hidden = true;
  $("blockNote").hidden = false;
  $("blockNote").textContent = host + " won’t be watched, and everything already logged from it was deleted.";
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, "");
  } catch {}
  render();
})();
