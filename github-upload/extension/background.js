// Background worker: records tab/app switches, downloads and idle time, and receives page actions from content.js.
// Every event is dropped unless the study is active right now (consented, a watch day, within hours, not paused)
// and the site is not on the never-watch list.
import { getSettings, saveSettings, isActiveNow, isBlocked, status, studyEnd } from "./lib/settings.js";
import { addEvent, clearAll, deleteWhere } from "./lib/db.js";
import { appFor, redactTitle } from "./lib/apps.js";

let cache = null;
async function settings() { if (!cache) cache = await getSettings(); return cache; }
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.settings) { cache = null; updateBadge(); } });

let lastViewKey = "";
let queue = Promise.resolve();

function record(type, url, title, d) {
  // serialize writes so events land in order
  queue = queue.then(() => doRecord(type, url, title, d)).catch(() => {});
  return queue;
}
async function doRecord(type, url, title, d) {
  const s = await settings();
  if (!isActiveNow(s)) return;
  const t = Date.now();
  if (type === "away") {
    if (lastViewKey === "away") return;
    lastViewKey = "away";
    return addEvent({ t, type: "away" });
  }
  let u; try { u = new URL(url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || isBlocked(s, u.hostname)) return;
  const a = appFor(u);
  const ev = { t, type, app: a.name, host: u.hostname.replace(/^www\./, ""), page: a.page, title: s.captureTitles ? redactTitle(title) : "", d: d || {} };
  if (type === "view") {
    const k = ev.host + ev.page + ev.title;
    if (k === lastViewKey) return; // same page, nothing new
    lastViewKey = k;
  } else lastViewKey = lastViewKey === "away" ? "" : lastViewKey;
  if (type !== "view" && !s.captureFieldLabels) { delete ev.d.labels; delete ev.d.field; }
  await addEvent(ev);
}

/* ---------- what's on screen ---------- */
async function viewTab(tab) { if (tab && tab.active && tab.url) await record("view", tab.url, tab.title); }
async function viewActive() { try { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); await viewTab(tab); } catch {} }

chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { await viewTab(await chrome.tabs.get(tabId)); } catch {} });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!tab.active) return;
  if (info.url) setTimeout(async () => { try { await viewTab(await chrome.tabs.get(tabId)); } catch {} }, 1200); // let the title catch up
  else if (info.status === "complete") viewTab(tab);
});
chrome.windows.onFocusChanged.addListener(async wid => {
  if (wid === chrome.windows.WINDOW_ID_NONE) return record("away");
  try { const [tab] = await chrome.tabs.query({ active: true, windowId: wid }); await viewTab(tab); } catch {}
});
chrome.idle.setDetectionInterval(120);
chrome.idle.onStateChanged.addListener(st => st === "active" ? viewActive() : record("away"));

/* ---------- downloads (file type only) ---------- */
const MIME_EXT = { "text/csv": "csv", "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/vnd.ms-excel": "xls", "application/zip": "zip", "application/json": "json", "text/plain": "txt", "image/png": "png", "image/jpeg": "jpg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
function extOf(name) { const m = /\.([a-z0-9]{1,6})$/i.exec(String(name || "").split(/[?#]/)[0]); return m ? m[1].toLowerCase() : null; }
const pendingDl = new Map();
chrome.downloads.onCreated.addListener(async item => {
  let tab = null; try { [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch {}
  const src = /^https?:/.test(item.referrer || "") ? item.referrer : (tab && tab.url) || item.url;
  const title = tab ? tab.title : "";
  let ext = extOf(item.filename) || MIME_EXT[item.mime];
  if (!ext) { try { ext = extOf(new URL(item.finalUrl || item.url).pathname); } catch {} }
  if (ext) record("download", src, title, { ext });
  else pendingDl.set(item.id, { src, title });
});
chrome.downloads.onChanged.addListener(delta => {
  if (!delta.filename || !pendingDl.has(delta.id)) return;
  const p = pendingDl.get(delta.id); pendingDl.delete(delta.id);
  record("download", p.src, p.title, { ext: extOf(delta.filename.current) || "file" });
});

/* ---------- page actions from content.js (metadata only, re-checked here) ---------- */
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : undefined;
const num = v => Number.isFinite(v) ? Math.max(0, Math.min(500, Math.round(v))) : undefined;
function sanitize(d) {
  d = d || {};
  const out = { kind: str(d.kind, 12), len: str(d.len, 8), field: str(d.field, 40), n: num(d.n), sensitive: num(d.sensitive), label: str(d.label, 40), ext: str(d.ext, 8) };
  if (Array.isArray(d.labels)) out.labels = d.labels.filter(x => typeof x === "string").slice(0, 12).map(x => x.slice(0, 40));
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}
const PAGE_ACTIONS = new Set(["copy", "paste", "entry", "submit", "click", "upload"]);
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.wd === "invite" && msg.d && typeof msg.d.code === "string") { takeInvite(msg.d.code.slice(0, 400)); return; }
  if (msg && PAGE_ACTIONS.has(msg.wd) && sender.tab) { record(msg.wd, sender.tab.url, sender.tab.title, sanitize(msg.d)); return; }
  if (msg && msg.cmd === "forgetHost" && typeof msg.host === "string") {
    const h = msg.host.replace(/^www\./, "");
    deleteWhere(e => e.host === h || (e.host || "").endsWith("." + h)).then(() => reply({ ok: true }));
    return true;
  }
});

/* ---------- invites from the personal setup page ---------- */
// Keeps the invite for the setup page and opens setup (once) if the participant hasn't finished it yet.
async function takeInvite(code) {
  if (!/^WD1\.[A-Za-z0-9_-]{8,}\.[a-z0-9]{1,8}$/.test(code)) return;
  const s = await settings();
  if (s.consented && !s.withdrawn) return;
  const { pendingInvite } = await chrome.storage.local.get("pendingInvite");
  if (pendingInvite === code) return;
  await chrome.storage.local.set({ pendingInvite: code });
  const url = chrome.runtime.getURL("onboarding.html");
  const open = await chrome.tabs.query({ url });
  if (open.length) await chrome.tabs.update(open[0].id, { active: true });
  else await chrome.tabs.create({ url });
}
// Content scripts don't run in tabs that were already open at install, so add them (the setup page tab included).
async function injectIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
  } catch {}
}

/* ---------- badge, retention, install ---------- */
async function updateBadge() {
  const st = status(await settings());
  const on = st.state === "active";
  await chrome.action.setBadgeText({ text: on ? "ON" : st.state === "paused" ? "II" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: on ? "#1D7A4E" : "#93570A" });
  await chrome.action.setTitle({ title: "Workflow Detective · " + st.label });
}
async function retention() {
  const s = await settings();
  const end = studyEnd(s);
  if (s.consented && end && Date.now() > end.getTime() + s.retentionDaysAfter * 864e5 && !s.purgedAt) {
    await clearAll(); await saveSettings({ purgedAt: Date.now() });
  }
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === "tick") { updateBadge(); retention(); } });
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.alarms.create("tick", { periodInMinutes: 5 });
  updateBadge();
  if (reason === "install") { chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }); injectIntoOpenTabs(); }
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create("tick", { periodInMinutes: 5 }); updateBadge(); });
