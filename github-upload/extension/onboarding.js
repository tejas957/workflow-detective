import { getSettings, saveSettings, DEFAULT_BLOCKED, nextMonday, isoDate, allWatchDays, fmtDay, fmtHour } from "./lib/settings.js";
import { clearAll } from "./lib/db.js";

const $ = id => document.getElementById(id);
// Same page serves the browser extension and the Windows app; swap the few lines that differ.
if (window.WD_PLATFORM === "desktop") {
  document.querySelectorAll("[data-for]").forEach(el => { el.hidden = el.dataset.for !== "desktop"; });
  document.querySelectorAll("[data-desktop]").forEach(el => { el.textContent = el.dataset.desktop; });
  document.querySelectorAll("[data-desktop-html]").forEach(el => { el.textContent = el.dataset.desktopHtml; });
}
if (window.WD_OS === "mac") {
  document.querySelectorAll("[data-mac]").forEach(el => { el.textContent = el.dataset.mac; });
  document.querySelectorAll("[data-mac-hide]").forEach(el => { el.hidden = true; });
  const box = document.getElementById("macPerm"), pill = document.getElementById("permPill");
  box.hidden = false;
  const check = async () => {
    try {
      const p = await window.WD_API("permissions");
      pill.className = "pill " + (p.accessibility ? "active" : "paused");
      pill.textContent = p.accessibility ? "Allowed" : "Not allowed yet";
    } catch { pill.textContent = "Unknown"; }
  };
  document.getElementById("permBtn").addEventListener("click", () => window.WD_API("openAccessibility"));
  check(); setInterval(check, 2000);
}
const DAYNAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fillHours(sel, val) {
  sel.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === val ? "selected" : ""}>${fmtHour(h)}</option>`).join("");
}
function readForm() {
  const mode = document.querySelector("input[name=mode]:checked").value;
  return {
    company: $("company").value.trim(),
    participant: $("participant").value.trim(),
    startDate: $("startDate").value,
    weeks: +$("weeks").value,
    scheduleMode: mode,
    days: [...document.querySelectorAll("#days input:checked")].map(i => +i.value),
    hourStart: +$("hourStart").value,
    hourEnd: +$("hourEnd").value,
    captureTitles: $("captureTitles").checked,
    captureFieldLabels: $("captureFieldLabels").checked,
    blocked: $("blocked").value.split(/\s+/).map(x => x.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean)
  };
}
function preview() {
  const f = readForm();
  if (invited) $("inviteSummary").textContent = summary();
  if (!f.startDate) { $("preview").textContent = ""; return; }
  const days = allWatchDays(Object.assign({}, f));
  $("preview").innerHTML = days.length
    ? `<b>${days.length} watch days</b>, ${fmtHour(f.hourStart)}–${fmtHour(f.hourEnd)}: ${days.map(fmtDay).join(" · ")}`
    : "No watch days with these settings.";
  $("save").disabled = !days.length || f.hourEnd <= f.hourStart;
}

(async () => {
  const s = await getSettings();
  $("company").value = s.company;
  $("participant").value = s.participant;
  $("startDate").value = s.startDate || isoDate(nextMonday());
  $("weeks").value = String(s.weeks);
  document.querySelector(`input[name=mode][value=${s.scheduleMode}]`).checked = true;
  $("days").innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" value="${d}" ${s.days.includes(d) ? "checked" : ""}>${DAYNAMES[d]}</label>`).join("");
  fillHours($("hourStart"), s.hourStart);
  fillHours($("hourEnd"), s.hourEnd);
  $("captureTitles").checked = s.captureTitles;
  $("captureFieldLabels").checked = s.captureFieldLabels;
  $("blocked").value = (s.blocked || DEFAULT_BLOCKED).join("\n");
  if (s.consented && !s.withdrawn) {
    $("consent").checked = true;
    $("save").textContent = "Save changes";
    $("stopCard").hidden = false;
  } else {
    // New participant: lead with the invite code; the full form stays folded away.
    $("inviteBox").hidden = false;
    $("details").hidden = true;
    let pending = null;
    try { pending = (await chrome.storage.local.get("pendingInvite")).pendingInvite; } catch {}
    const fromHash = window.WDInvite.find(location.hash);
    if (pending || fromHash) applyInvite(pending || fromHash);
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area === "local" && ch.pendingInvite && ch.pendingInvite.newValue && !invited) applyInvite(ch.pendingInvite.newValue);
      });
    } catch {}
  }
  preview();
})();

/* ---------- invite codes ---------- */
let invited = null;
function applyInvite(code) {
  const inv = window.WDInvite.decode(code);
  if (!inv) {
    $("inviteMsg").className = "small invite-msg bad";
    $("inviteMsg").textContent = "That code doesn’t look complete. Copy it again from your email, all of it.";
    return false;
  }
  invited = inv;
  $("company").value = inv.company;
  if (inv.participant) $("participant").value = inv.participant;
  if (inv.startDate) $("startDate").value = inv.startDate;
  if (inv.weeks) $("weeks").value = String(inv.weeks);
  if (inv.hourStart != null) { $("hourStart").value = String(inv.hourStart); $("hourEnd").value = String(Math.min(inv.hourEnd, 23)); }
  document.querySelector(`input[name=mode][value=${inv.scheduleMode === "fixed" ? "fixed" : "rotate"}]`).checked = true;
  if (inv.scheduleMode === "fixed") document.querySelectorAll("#days input").forEach(i => { i.checked = inv.days.includes(+i.value); });
  $("inviteAsk").hidden = true;
  $("inviteDone").hidden = false;
  $("nameOnly").hidden = !!inv.participant;
  $("participantQuick").value = $("participant").value;
  $("inviteHello").textContent = inv.participant ? `Hi ${inv.participant.split(" ")[0]}, you’re all set up` : "You’re all set up";
  preview();
  return true;
}
function summary() {
  const f = readForm();
  const days = allWatchDays(Object.assign({}, f));
  return `${f.company}${f.participant ? " · " + f.participant : ""} · starts ${days.length ? fmtDay(days[0]) : f.startDate} · ${days.length} watch days, ${fmtHour(f.hourStart)}–${fmtHour(f.hourEnd)}`;
}
$("inviteUse").addEventListener("click", () => applyInvite($("inviteCode").value));
$("inviteCode").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyInvite($("inviteCode").value); } });
$("inviteCode").addEventListener("input", () => { if (window.WDInvite.find($("inviteCode").value)) applyInvite($("inviteCode").value); });
document.addEventListener("paste", e => {   // paste anywhere on the page
  if (invited || $("inviteBox").hidden) return;
  const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
  const code = window.WDInvite.find(text);
  if (code) { e.preventDefault(); $("inviteCode").value = code; applyInvite(code); }
});
$("noCode").addEventListener("click", () => { $("details").hidden = false; $("inviteBox").hidden = true; $("company").focus(); });
$("showDetails").addEventListener("click", () => { $("details").hidden = false; $("showDetails").hidden = true; });
$("participantQuick").addEventListener("input", () => { $("participant").value = $("participantQuick").value; preview(); });

$("form").addEventListener("input", preview);
$("form").addEventListener("change", e => {
  if (e.target.closest("#days")) document.querySelector("input[name=mode][value=fixed]").checked = true;
  preview();
});
$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = readForm();
  if (!f.company || !f.startDate) { $("details").hidden = false; $("msg").textContent = "Paste your invite code first, or fill in the company code and start date."; return; }
  if (!f.participant) { if (invited) { $("nameOnly").hidden = false; $("participantQuick").focus(); } else { $("details").hidden = false; $("participant").focus(); } $("msg").textContent = "Please add your name."; return; }
  if (f.hourEnd <= f.hourStart) { $("msg").textContent = "The end time has to be after the start time."; return; }
  if (!$("consent").checked) { $("msg").textContent = "Please read and tick the consent box first."; return; }
  const cur = await getSettings();
  await saveSettings(Object.assign(f, { consented: true, withdrawn: false, consentedAt: cur.consentedAt || Date.now() }));
  $("msg").textContent = "";
  $("saved").hidden = false;
  $("inviteBox").hidden = true;
  try { await chrome.storage.local.remove("pendingInvite"); } catch {}
  $("save").textContent = "Save changes";
  $("stopCard").hidden = false;
});

$("stop").addEventListener("click", () => { $("stop").hidden = true; $("stopYes").hidden = false; $("stopNo").hidden = false; });
$("stopNo").addEventListener("click", () => { $("stop").hidden = false; $("stopYes").hidden = true; $("stopNo").hidden = true; });
$("stopYes").addEventListener("click", async () => {
  await clearAll();
  await chrome.storage.local.remove("feedback");
  await saveSettings({ withdrawn: true, consented: false });
  $("stopYes").hidden = true; $("stopNo").hidden = true;
  $("stopMsg").textContent = "Stopped. Everything was deleted. You can remove the extension now.";
});
