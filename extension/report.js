import { getSettings, status } from "./lib/settings.js";
import { allEvents, deleteIds, deleteWhere, clearAll } from "./lib/db.js";

const D = window.WDDetector;
const DESKTOP = window.WD_PLATFORM === "desktop";
if (DESKTOP) document.getElementById("timeTitle").textContent = "Where your computer time went";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TYPE = { transfer: "Copying between apps", entry: "Same form, again", drafting: "Writing similar messages", shuttle: "Moving files by hand", export: "Regular export", lookup: "Back-and-forth checking", routine: "Repeated routine" };
const KIND = { number: "a number", text: "some text", email: "an email address", date: "a date", link: "a link", table: "a block of cells", "long text": "a long passage", unknown: "something" };
const when = t => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const time = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

let S, EV = [], R = null, FB = {};

async function load() {
  S = await getSettings();
  EV = (await allEvents()).sort((a, b) => a.t - b.t);
  FB = (await chrome.storage.local.get("feedback")).feedback || {};
  R = D.analyze(EV);
  render();
}

function render() {
  const st = status(S);
  $("pill").className = "pill " + st.state; $("pill").textContent = st.label;
  $("who").textContent = [S.participant, S.company].filter(Boolean).join(" · ") + (st.total ? " · " + st.done + " of " + st.total + " watch days done" : "");
  const sm = R.summary;
  $("tiles").innerHTML = [
    ["Repeated work found", D.fmtMin(sm.automatableWeeklyMinutes) + " / wk"],
    ["Processes found", sm.findings],
    ["Days observed", sm.observedDays && EV.length ? sm.observedDays : 0],
    [DESKTOP ? "Computer time per day" : "Browser time per day", D.fmtMin(sm.activeMinutesPerDay)]
  ].map(([k, v]) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
  const early = EV.length && sm.observedDays < 3;
  $("early").hidden = !early;
  $("early").textContent = "Early results. Findings get more reliable after 3 watch days, and they’re projected to a 5-day week from the days we’ve seen.";

  $("findings").innerHTML = R.findings.length ? R.findings.map(cardHTML).join("") :
    `<div class="card empty">${EV.length ? "Nothing has repeated enough to call it a process yet. Keep working normally. Findings usually show up after 2 watch days." : "No activity logged yet. Recording starts during your watch hours."}</div>`;

  const max = Math.max(1, ...sm.timeByApp.map(a => a.minutes));
  $("apps").innerHTML = sm.timeByApp.slice(0, 8).map(a => `<div class="bar"><span class="name" title="${esc(a.app)}">${esc(a.app)}</span><i style="width:${Math.max(2, a.minutes / max * 100)}%"></i><span class="n">${D.fmtMin(a.minutes / Math.max(1, sm.observedDays))}</span></div>`).join("") || `<p class="small muted">Nothing yet.</p>`;
  renderLogTools();
}

function cardHTML(f) {
  const fb = FB[f.key] || {};
  const pressed = r => fb.rating === r ? "true" : "false";
  return `<article class="card finding" data-key="${esc(f.key)}">
    <div class="f-main">
      <div class="row"><span class="chip">${TYPE[f.type] || f.type}</span>${f.automation.ai ? `<span class="chip ai">AI can help</span>` : ""}<span class="chip ${f.confidence === "high" ? "good" : f.confidence === "low" ? "warn" : ""}">${f.confidence} confidence</span></div>
      <h3>${esc(f.title)}</h3>
      <p>${esc(f.detail)}${f.when ? " " + esc(f.when) : ""}</p>
      <p class="evid">Seen ${f.count}× over ${f.days} ${f.days === 1 ? "day" : "days"} · about ${f.minutesEach} min each</p>
      ${f.steps ? `<ol class="steps">${f.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      <div class="how"><b>${esc(f.automation.method)}</b><span>${esc(f.automation.how)}</span>${f.automation.ai ? `<span class="why">${esc(f.automation.why)}</span>` : ""}</div>
      <details><summary>Show the ${f.occurrences.length} times we saw it</summary><ul class="occ">${f.occurrences.slice(0, 40).map(o => `<li>${when(o.t0)} · ${esc(o.note || "")}</li>`).join("")}</ul></details>
      <div class="fb"><span>Is this right?</span>
        <button data-r="accurate" aria-pressed="${pressed("accurate")}">Yes, I do this</button>
        <button data-r="new" aria-pressed="${pressed("new")}">Yes, and I hadn’t thought of automating it</button>
        <button data-r="wrong" aria-pressed="${pressed("wrong")}">Not really</button>
        <input type="text" placeholder="Anything we got wrong? (optional)" value="${esc(fb.note || "")}" aria-label="Note about this finding">
      </div>
    </div>
    <div class="f-side"><span class="big">${D.fmtMin(f.weeklyMinutes)}</span><span class="small muted">a week, estimated</span></div>
  </article>`;
}

async function saveFB(key, patch) {
  FB[key] = Object.assign({}, FB[key], patch, { at: Date.now() });
  await chrome.storage.local.set({ feedback: FB });
}
$("findings").addEventListener("click", e => {
  const b = e.target.closest("button[data-r]"); if (!b) return;
  const card = b.closest(".finding");
  card.querySelectorAll("button[data-r]").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  saveFB(card.dataset.key, { rating: b.dataset.r });
});
$("findings").addEventListener("change", e => {
  if (e.target.tagName !== "INPUT") return;
  saveFB(e.target.closest(".finding").dataset.key, { note: e.target.value.slice(0, 500) });
});

/* ---------- activity log ---------- */
function describe(e) {
  const d = e.d || {};
  switch (e.type) {
    case "view": return "Opened " + (e.title || e.page || e.app);
    case "copy": return "Copied " + (KIND[d.kind] || "something");
    case "paste": return "Pasted " + (KIND[d.kind] || "something") + (d.field ? " into “" + d.field + "”" : "");
    case "entry": return "Filled in " + (d.n || 0) + " field" + (d.n === 1 ? "" : "s") + (d.labels && d.labels.length ? ": " + d.labels.join(", ") : "") + (d.sensitive ? " (+" + d.sensitive + " sensitive, not named)" : "");
    case "submit": return "Submitted a form";
    case "click": return "Clicked “" + (d.label || "") + "”";
    case "download": return "Downloaded a ." + (d.ext || "file") + " file";
    case "upload": return "Uploaded " + (d.n > 1 ? d.n + " files" : "a ." + (d.ext || "file") + " file");
    case "away": return DESKTOP ? "Away from the computer" : "Away from the browser";
    default: return e.type;
  }
}
function renderLogTools() {
  const days = [...new Set(EV.map(e => D.dayKey(e.t)))].sort().reverse();
  const daySel = $("logDay"), appSel = $("logApp");
  const curDay = daySel.value || days[0] || "", curApp = appSel.value || "";
  daySel.innerHTML = days.length ? days.map(d => `<option value="${d}" ${d === curDay ? "selected" : ""}>${new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</option>`).join("") : `<option value="">No days yet</option>`;
  const apps = [...new Set(EV.map(e => e.app).filter(Boolean))].sort();
  appSel.innerHTML = `<option value="">All apps</option>` + apps.map(a => `<option ${a === curApp ? "selected" : ""}>${esc(a)}</option>`).join("");
  renderLog();
}
function renderLog() {
  const day = $("logDay").value, app = $("logApp").value;
  const rows = EV.filter(e => D.dayKey(e.t) === day && (!app || e.app === app));
  $("delApp").hidden = !app;
  $("logCount").textContent = EV.length + " actions logged in total";
  $("log").innerHTML = rows.slice(0, 1500).map(e => `<tr><td class="t">${time(e.t)}</td><td>${esc(e.app || "")}</td><td>${esc(describe(e))}</td><td class="x"><button data-id="${e.id}" aria-label="Delete this line" title="Delete this line">×</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nothing logged for this selection.</td></tr>`;
}
$("logDay").addEventListener("change", renderLog);
$("logApp").addEventListener("change", renderLog);
$("log").addEventListener("click", async e => {
  const b = e.target.closest("button[data-id]"); if (!b) return;
  await deleteIds([+b.dataset.id]); await load();
});
$("delApp").addEventListener("click", async () => { const a = $("logApp").value; await deleteWhere(e => e.app === a); $("logApp").value = ""; await load(); });
$("delAll").addEventListener("click", () => { $("delAll").hidden = true; $("delAllYes").hidden = false; });
$("delAllYes").addEventListener("click", async () => { await clearAll(); $("delAllYes").hidden = true; $("delAll").hidden = false; await load(); });
$("refresh").addEventListener("click", load);

/* ---------- export ---------- */
function bundle(includeLog) {
  const st = status(S);
  return {
    schema: "workflow-detective/bundle@1",
    exportedAt: new Date().toISOString(),
    source: DESKTOP ? "desktop" : "browser",
    os: window.WD_OS || (DESKTOP ? "windows" : undefined),
    extensionVersion: chrome.runtime.getManifest().version,
    detectorVersion: D.VERSION,
    participant: S.participant, company: S.company,
    study: { startDate: S.startDate, weeks: S.weeks, scheduleMode: S.scheduleMode, days: S.days, hours: [S.hourStart, S.hourEnd], watchDaysTotal: st.total, watchDaysDone: st.done, captureTitles: S.captureTitles, captureFieldLabels: S.captureFieldLabels },
    summary: R.summary,
    findings: R.findings,
    feedback: FB,
    events: includeLog ? EV.map(({ id, ...e }) => e) : undefined
  };
}
$("export").addEventListener("click", async () => {
  const b = bundle($("incLog").checked);
  const safe = s => String(s || "x").replace(/[^\w-]+/g, "-").slice(0, 30);
  const name = `workflow-detective_${window.WD_OS === "mac" ? "mac_" : DESKTOP ? "windows_" : ""}${safe(S.company)}_${safe(S.participant)}_${new Date().toISOString().slice(0, 10)}.json`;
  if (window.WD_SAVE) {   // Mac app: native save dialog
    const r = await window.WD_SAVE(name, JSON.stringify(b, null, 1));
    $("exMsg").textContent = r && r.ok ? "Saved. Send that file to the pilot team." : r && r.cancelled ? "" : "Couldn’t save the file.";
    return;
  }
  const blob = new Blob([JSON.stringify(b, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $("exMsg").textContent = "Saved to your Downloads folder. Send that file to the pilot team.";
});
$("copy").addEventListener("click", async () => {
  const text = R.findings.map(f => D.brief(f, [S.participant, S.company].filter(Boolean).join(", "))).join("\n\n");
  try { await navigator.clipboard.writeText(text || "No findings yet."); $("exMsg").textContent = "Summary copied."; }
  catch { $("exMsg").textContent = "Couldn’t copy. Use Save results file instead."; }
});

load();
