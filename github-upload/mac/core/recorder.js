/*
 * Workflow Detective — recording core for the Mac app.
 * Runs inside the Mac app (Apple's JavaScriptCore) and in Node for tests. Turns raw signals from macOS into
 * the same events the browser extension and Windows app write. It mirrors desktop/src/Recorder.cs.
 *
 * The Mac app calls:  WDMac.init(host)  then  foreground / copy / field / file / away / active / tick
 * host = { now(): ms, store(jsonString), log(msg) }   settings arrive through WDMac.setSettings(json)
 * Needs WDSchedule (core/schedule.js, generated from the extension's settings.js) loaded first.
 */
var WDMac = (function () {
  "use strict";
  var Sched = typeof WDSchedule !== "undefined" ? WDSchedule : require("./schedule.js");

  /* ---------- privacy ---------- */
  var EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g, PHONE = /\+?\d[\d\s().-]{6,}\d/g, DIGITS = /\d+/g;
  var SENSITIVE_LABEL = /pass(word|code)?\b|\bssn\b|social.?security|card.?(number|no)|credit.?card|\bcvv\b|\bcvc\b|security.?code|\biban\b|routing|account.?(number|no)|\bpin\b|tax.?id|\bein\b|date.?of.?birth|\bdob\b|one.?time/i;
  function redactTitle(t) {
    if (!t) return "";
    t = String(t).replace(EMAIL, "[email]").replace(PHONE, "#").replace(DIGITS, "#");
    t = t.split(/\s+[-–—|]\s+/).filter(function (p) { return p.trim() !== "[email]"; }).join(" - ");
    return t.slice(0, 90);
  }
  function cleanLabel(s) {
    if (!s) return "";
    return String(s).replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(EMAIL, "[email]").replace(DIGITS, "#").slice(0, 40);
  }
  function isSensitiveLabel(s) { return !!s && SENSITIVE_LABEL.test(s); }

  /* ---------- app names (macOS bundle identifiers) ---------- */
  var BUNDLES = {
    "com.microsoft.excel": "Excel", "com.microsoft.outlook": "Outlook", "com.microsoft.word": "Word", "com.microsoft.powerpoint": "PowerPoint",
    "com.microsoft.onenote.mac": "OneNote", "com.microsoft.teams": "Microsoft Teams", "com.microsoft.teams2": "Microsoft Teams",
    "com.tinyspeck.slackmacgap": "Slack", "us.zoom.xos": "Zoom", "com.apple.finder": "Finder", "com.apple.mail": "Apple Mail",
    "com.apple.iwork.numbers": "Numbers", "com.apple.iwork.pages": "Pages", "com.apple.iwork.keynote": "Keynote", "com.apple.notes": "Notes",
    "com.apple.mobilesms": "Messages", "com.apple.ical": "Calendar", "com.apple.preview": "Preview", "com.adobe.acrobat.pro": "Adobe Acrobat",
    "com.adobe.reader": "Adobe Acrobat", "com.intuit.quickbooks2024": "QuickBooks Desktop", "com.intuit.quickbooks2023": "QuickBooks Desktop",
    "com.apple.safari": "Safari", "com.google.chrome": "Chrome", "com.microsoft.edgemac": "Edge", "org.mozilla.firefox": "Firefox",
    "company.thebrowser.browser": "Arc", "com.brave.browser": "Brave", "com.operasoftware.opera": "Opera", "com.vivaldi.vivaldi": "Vivaldi",
    "net.whatsapp.whatsapp": "WhatsApp", "com.spotify.client": "Spotify", "com.apple.textedit": "TextEdit", "com.apple.terminal": "Terminal"
  };
  var BROWSERS = { "com.apple.safari": 1, "com.google.chrome": 1, "com.microsoft.edgemac": 1, "org.mozilla.firefox": 1, "company.thebrowser.browser": 1, "com.brave.browser": 1, "com.operasoftware.opera": 1, "com.vivaldi.vivaldi": 1 };
  // never watched: password managers, macOS security prompts and sign-in, this app
  var NEVER = /^(com\.1password\.|com\.agilebits\.|com\.bitwarden\.|com\.lastpass\.|org\.keepassxc\.|com\.dashlane\.|com\.nordpass\.|com\.apple\.passwords|com\.apple\.keychainaccess|com\.apple\.securityagent|com\.apple\.loginwindow|com\.apple\.systemuiserver|com\.workflowdetective\.)/i;
  var WEB = [[/\bGmail\b/i, "Gmail"], [/Google Sheets/i, "Google Sheets"], [/Google Docs/i, "Google Docs"], [/Google Drive/i, "Google Drive"],
    [/Google Calendar/i, "Google Calendar"], [/\bQuickBooks\b/i, "QuickBooks"], [/\bSalesforce\b/i, "Salesforce"], [/\bHubSpot\b/i, "HubSpot"],
    [/\bShopify\b/i, "Shopify"], [/\bShipStation\b/i, "ShipStation"], [/\bAirtable\b/i, "Airtable"], [/\bAsana\b/i, "Asana"], [/\bTrello\b/i, "Trello"],
    [/\bJira\b/i, "Jira"], [/\bNotion\b/i, "Notion"], [/\bSlack\b/i, "Slack"], [/Microsoft Teams/i, "Microsoft Teams"], [/\bOutlook\b/i, "Outlook"],
    [/\bZendesk\b/i, "Zendesk"], [/\bGreenhouse\b/i, "Greenhouse"], [/\bWorkday\b/i, "Workday"], [/\bNetSuite\b/i, "NetSuite"], [/\bXero\b/i, "Xero"],
    [/\bStripe\b/i, "Stripe"], [/\bLinkedIn\b/i, "LinkedIn"], [/\bDocuSign\b/i, "DocuSign"], [/\.xlsx?\b.*\bExcel\b|Excel Online/i, "Excel Online"],
    [/\bmonday\.com\b/i, "monday.com"], [/\bClickUp\b/i, "ClickUp"], [/\bGusto\b/i, "Gusto"]];
  var COMM = { "Slack": 1, "Microsoft Teams": 1, "Messages": 1, "Zoom": 1, "WhatsApp": 1, "Discord": 1, "Google Chat": 1 };

  function appInfo(bundle, name, title) {
    var b = String(bundle || "").toLowerCase();
    var app = BUNDLES[b] || (name ? String(name).slice(0, 40) : (bundle || "Unknown app"));
    var isBrowser = !!BROWSERS[b];
    var t = String(title || "");
    if (isBrowser) {
      t = t.replace(/\s[-—–]\s(Google Chrome|Microsoft​?\s?Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc|Safari)\s*$/i, "")
           .replace(/\s[-—–]\s(Personal|Work|Default|Profile \d+)\s*$/i, "");
      for (var i = 0; i < WEB.length; i++) if (WEB[i][0].test(t)) { app = WEB[i][1]; break; }
    } else {
      var word = app.split(" ").pop().toLowerCase();
      var parts = t.split(/\s+[-—–|]\s+/);
      while (parts.length > 1 && parts[parts.length - 1].toLowerCase().indexOf(word) >= 0) parts.pop();
      t = parts.join(" - ");
    }
    return { app: app, bundle: b, page: t, isBrowser: isBrowser };
  }

  /* ---------- recorder ---------- */
  var host = null, S = Object.assign({}, Sched.DEFAULTS);
  var cur = null, curTitleRaw = "", enteredAt = 0, away = false, lastViewKey = "";
  var lastCopyT = -1, lastCopyApp = null, lastCopyKind = null, copyUsed = false;
  var batch = null;
  var PASTE_WINDOW = 90000, FLUSH_MS = 4000, SWITCH_DWELL = 2000;
  var SENSITIVE_TITLE = /online banking|\bchase\b|wells fargo|bank of america|capital one|\bciti(bank)?\b|fidelity|vanguard|schwab|robinhood|coinbase|mychart|patient portal|password manager/i;

  function now() { return host.now(); }
  function active() { return Sched.isActiveNow(S, new Date(now())); }

  function allowed(ignoreApp) {
    if (!active()) return false;
    if (ignoreApp || !cur) return true;
    if (NEVER.test(cur.bundle)) return false;
    if (/Workflow Detective/i.test(curTitleRaw)) return false;
    var hay = cur.app + " " + curTitleRaw;
    if (SENSITIVE_TITLE.test(hay)) return false;
    var list = S.blocked || [];
    for (var i = 0; i < list.length; i++) {
      var b = String(list[i] || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (!b) continue;
      var word = b.indexOf(".") >= 0 ? b.slice(0, b.lastIndexOf(".")) : b;
      if (!word) continue;
      if (cur.app.toLowerCase() === word || cur.bundle === word) return false;
      if (word.length >= 3 && new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(hay)) return false;
    }
    return true;
  }

  function page() { return S.captureTitles ? redactTitle(cur.page) : ""; }
  function title() { return S.captureTitles ? redactTitle(cur.page) : ""; }

  function base(type, app, bundle, pg, ttl, t) { return { t: t, type: type, app: app, host: bundle, page: pg, title: ttl }; }
  function emit(type, d) {
    var ev = type === "away" ? { t: now(), type: "away" } : base(type, cur.app, cur.bundle, page(), title(), now());
    if (type !== "away") ev.d = d || {};
    host.store(JSON.stringify(ev));
  }
  function emitView() {
    if (!cur || !allowed()) return;
    var key = cur.app + "|" + page() + "|" + title();
    if (key === lastViewKey) return;
    lastViewKey = key;
    emit("view", null);
  }

  function maybePaste(field, how) {
    if (lastCopyT < 0 || !lastCopyApp || lastCopyApp === cur.app || copyUsed) return;
    if (now() - lastCopyT > PASTE_WINDOW) return;
    copyUsed = true;
    var d = { kind: lastCopyKind, len: "unknown", inferred: how };
    if (field && S.captureFieldLabels) d.field = field;
    emit("paste", d);
  }

  function addToBatch(label, sensitive, key) {
    var pg = page();
    if (batch && (batch.app !== cur.app || batch.page !== pg)) flush();
    if (!batch) batch = { app: cur.app, bundle: cur.bundle, page: pg, title: title(), labels: [], sensitive: {}, last: 0 };
    if (sensitive) batch.sensitive[key] = 1;
    else if (label && batch.labels.indexOf(label) < 0) batch.labels.push(label);
    batch.last = now();
  }
  function flush() {
    if (!batch) return;
    var ns = Object.keys(batch.sensitive).length;
    if ((batch.labels.length || ns) && active()) {
      var ev = base("entry", batch.app, batch.bundle, batch.page, batch.title, batch.last);
      ev.d = { n: batch.labels.length + ns, sensitive: ns, labels: S.captureFieldLabels ? batch.labels.slice(0, 12) : [] };
      host.store(JSON.stringify(ev));
    }
    batch = null;
  }

  var api = {
    init: function (h) { host = h; },
    setSettings: function (json) {
      try { S = Object.assign({}, Sched.DEFAULTS, typeof json === "string" ? JSON.parse(json || "{}") : (json || {})); }
      catch (e) { if (host && host.log) host.log("bad settings: " + e); }
    },
    isActive: function () { return active(); },
    status: function () { return JSON.stringify(Sched.status(S, new Date(now()))); },
    currentApp: function () { return cur ? cur.app : ""; },

    /** The app or window in front changed (also called when its title changes). */
    foreground: function (bundle, name, rawTitle) {
      var info = appInfo(bundle, name, rawTitle);
      var appChanged = !cur || cur.app !== info.app || cur.bundle !== info.bundle;
      if (appChanged || curTitleRaw !== (rawTitle || "")) flush();
      if (appChanged && cur && allowed()) {
        // Copied in one app, spent a moment in this one, now leaving: most likely pasted here.
        if (lastCopyT >= 0 && !copyUsed && cur.app !== lastCopyApp && !COMM[cur.app] &&
            enteredAt >= lastCopyT && enteredAt - lastCopyT <= PASTE_WINDOW && now() - enteredAt >= SWITCH_DWELL) maybePaste(null, "switch");
      }
      if (appChanged) enteredAt = now();
      cur = info; curTitleRaw = rawTitle || "";
      if (away) { away = false; lastViewKey = ""; }
      emitView();
    },

    /** The clipboard changed. kind comes from the clipboard's types only; its contents are never read. */
    copy: function (kind) {
      flush();
      if (!cur || !allowed()) return;
      emit("copy", { kind: kind || "unknown", len: "unknown" });
      lastCopyT = now(); lastCopyApp = cur.app; lastCopyKind = kind || "unknown"; copyUsed = false;
    },

    /** A field's contents changed in the app in front. label = its accessibility label. */
    field: function (label, sensitive) {
      if (!cur || !allowed()) return;
      var l = cleanLabel(label) || "Field";
      if (sensitive || isSensitiveLabel(l)) { maybePaste("[sensitive]", "edit"); addToBatch(null, true, l); }
      else { maybePaste(l, "edit"); addToBatch(l, false, l); }
    },

    /** A new file appeared (Downloads). Only its type is kept. */
    file: function (fileName, where) {
      if (!cur || !allowed() || !fileName) return;
      if (/^(~\$|\.)/.test(fileName)) return;
      var m = /\.([^.]+)$/.exec(fileName), ext = m ? m[1].toLowerCase() : "file";
      if (ext.length > 6 || /^(tmp|crdownload|partial|part|download|lnk|ini|db|log|lock|temp|opdownload|ds_store)$/.test(ext)) return;
      flush();
      emit("download", { ext: ext, where: where });
    },

    away: function () { flush(); if (away) return; away = true; if (allowed(true)) emit("away", null); },
    active: function () { if (!away) return; away = false; lastViewKey = ""; if (cur) emitView(); },
    tick: function () { if (batch && now() - batch.last > FLUSH_MS) flush(); },
    /** True once the study is over plus the retention period: the app then deletes the activity log. */
    retentionDue: function () {
      var e = Sched.studyEnd(S);
      return !!(S.consented && e && !S.purgedAt && now() > e.getTime() + (S.retentionDaysAfter || 14) * 864e5);
    },

    // exposed for tests
    _redactTitle: redactTitle, _cleanLabel: cleanLabel, _appInfo: appInfo,
    _reset: function () { cur = null; curTitleRaw = ""; enteredAt = 0; away = false; lastViewKey = ""; lastCopyT = -1; lastCopyApp = null; copyUsed = false; batch = null; }
  };
  return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = WDMac;
