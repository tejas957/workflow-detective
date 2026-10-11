/*
 * Workflow Detective — pattern detection engine
 *
 * Input: an array of activity events captured by the extension, e.g.
 *   { t: 1759900000000, type: "copy", app: "Gmail", page: "/mail/#inbox/:id", title: "Payment received from #", d: { kind: "number" } }
 *
 * Event types: view, copy, paste, entry, submit, click, download, upload, away
 *
 * Output: { version, summary, findings[] } — every finding is written in plain English and
 * carries its evidence (occurrences), a time estimate, and a suggested way to automate it.
 *
 * Runs in the browser (window.WDDetector) and in Node (module.exports). No dependencies.
 */
(function (root) {
  "use strict";
  const VERSION = "0.1.0";
  const MIN = 60000;

  const EMAIL_APPS = new Set(["Gmail", "Outlook", "Apple Mail"]);
  // Chat is communication, not a process: typing or pasting into it is never flagged on its own.
  const COMM_APPS = new Set(["Slack", "Microsoft Teams", "Google Chat", "Discord", "WhatsApp", "Zoom", "Messenger", "Messages"]);
  const WRITING_LABEL = /reply|message|body|comment|note|description|response|post/i;
  // In a spreadsheet, editing cells *is* the work. It only counts as a process when the data comes from another app.
  const SHEET_APPS = new Set(["Excel", "Excel Online", "Google Sheets", "Numbers"]);
  const DOC_HINT = /\.pdf\b|invoice|receipt|statement|order|purchase order|\bpo\b|bill|quote|application|resume|cv\b/i;
  const SEARCH_LABEL = /^(search|find|filter|search mail|search\b.*|query|q)$/i;

  /* ---------- small helpers ---------- */
  function dayKey(t) {
    const d = new Date(t);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function minuteOfDay(t) { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); }
  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdev(a) {
    if (a.length < 2) return 0;
    const mu = a.reduce((s, x) => s + x, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1));
  }
  function counts(arr) {
    const c = new Map();
    for (const x of arr) if (x != null && x !== "") c.set(x, (c.get(x) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }
  function mode(arr) { const c = counts(arr); return c.length ? c[0][0] : null; }
  function distinctDays(occ) { return new Set(occ.map(o => dayKey(o.t0))).size; }
  function list(words) {
    const w = words.filter(Boolean);
    if (w.length <= 1) return w.join("");
    if (w.length === 2) return w[0] + " and " + w[1];
    return w.slice(0, -1).join(", ") + ", and " + w[w.length - 1];
  }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function clockLabel(mins) {
    let h = Math.floor(mins / 60), m = Math.round(mins % 60);
    if (m === 60) { h += 1; m = 0; }
    const ap = h >= 12 ? "pm" : "am", hh = ((h + 11) % 12) + 1;
    return hh + ":" + String(m).padStart(2, "0") + " " + ap;
  }
  function overlaps(a, b) { return a.t0 <= b.t1 && b.t0 <= a.t1; }
  /** Drop the trailing " - Google Sheets" / " | Greenhouse" style app suffix from a page title. */
  function short(title, app) {
    if (!title) return title;
    const word = String(app || "").split(" ").pop().toLowerCase();
    let parts = title.split(/\s+[-–|·:]\s+/);
    while (parts.length > 1 && (parts[parts.length - 1].toLowerCase().includes(word) || /^google( \w+)?$/i.test(parts[parts.length - 1]))) parts.pop();
    return parts.join(" · ");
  }

  /* ---------- sessions & time accounting ---------- */
  function splitSessions(ev, gapMin) {
    const out = []; let cur = [];
    for (const e of ev) {
      const prev = cur[cur.length - 1];
      if (e.type === "away" || (prev && e.t - prev.t > gapMin * MIN)) {
        if (cur.length) out.push(cur);
        cur = e.type === "away" ? [] : [e];
      } else cur.push(e);
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function timeByApp(sessions) {
    const per = new Map(); let total = 0;
    for (const s of sessions) {
      let app = null;
      for (let i = 0; i < s.length; i++) {
        if (s[i].app) app = s[i].app;
        const next = s[i + 1];
        if (!next || !app) continue;
        const gap = Math.min(next.t - s[i].t, 5 * MIN);
        per.set(app, (per.get(app) || 0) + gap); total += gap;
      }
    }
    return { total, apps: [...per.entries()].sort((a, b) => b[1] - a[1]).map(([app, ms]) => ({ app, minutes: Math.round(ms / MIN) })) };
  }

  /* ---------- detector 1: copy in one app, paste into another ---------- */
  function detectTransfers(ev) {
    const pairs = []; let lastCopy = null;
    for (const e of ev) {
      if (e.type === "copy") lastCopy = e;
      else if (e.type === "paste" && lastCopy && e.app && lastCopy.app && e.app !== lastCopy.app && !COMM_APPS.has(e.app) && e.t - lastCopy.t <= 5 * MIN) {
        pairs.push({ from: lastCopy.app, to: e.app, t0: lastCopy.t, t1: e.t, kind: (e.d && e.d.kind !== "unknown" && e.d.kind) || (lastCopy.d && lastCopy.d.kind) || "unknown", field: e.d && e.d.field, srcTitle: lastCopy.title, dstTitle: e.title });
      }
    }
    const byKey = new Map();
    for (const p of pairs) { const k = p.from + "→" + p.to; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
    const out = [];
    for (const [k, ps] of byKey) {
      ps.sort((a, b) => a.t0 - b.t0);
      const bursts = [];
      for (const p of ps) {
        const b = bursts[bursts.length - 1];
        if (b && p.t0 - b.t1 <= 3 * MIN) { b.items.push(p); b.t1 = Math.max(b.t1, p.t1); }
        else bursts.push({ t0: p.t0, t1: p.t1, items: [p] });
      }
      const n = bursts.length, days = distinctDays(bursts);
      if (!(n >= 5 || (n >= 3 && days >= 2))) continue;
      const [from, to] = k.split("→");
      const fields = median(bursts.map(b => b.items.length));
      const kinds = counts(ps.map(p => p.kind).filter(x => x && x !== "unknown")).slice(0, 3).map(x => kindWord(x[0]));
      const labels = counts(ps.map(p => p.field).filter(f => f && f !== "[sensitive]")).slice(0, 4).map(x => x[0]);
      const srcTitle = short(mode(ps.map(p => p.srcTitle)), from), dstTitle = short(mode(ps.map(p => p.dstTitle)), to);
      const fromDoc = EMAIL_APPS.has(from) || DOC_HINT.test(srcTitle || "");
      out.push({
        type: "transfer", key: "transfer|" + from + "|" + to, apps: [from, to],
        title: "Copying information from " + from + " into " + to,
        detail: "Usually " + Math.round(fields) + " " + plural(Math.round(fields), "piece") + " of information at a time" +
          (kinds.length ? " (mostly " + list(kinds) + ")" : "") + (labels.length ? ", into fields like " + list(labels.map(q)) : "") + ".",
        context: { from: srcTitle, to: dstTitle, fieldsEach: Math.round(fields) },
        occurrences: bursts.map(b => ({ t0: b.t0, t1: b.t1, note: b.items.length + " " + plural(b.items.length, "paste") + (b.items[0].srcTitle ? " · from “" + short(b.items[0].srcTitle, from) + "”" : "") })),
        minutesEach: Math.max(0.5, median(bursts.map(b => (b.t1 - b.t0) / MIN)) + 0.25),
        base: fromDoc ? 88 : 85,
        automation: fromDoc ? {
          method: "AI reads it, then an automation fills it in",
          how: "Each time a new " + (EMAIL_APPS.has(from) ? "email like this" : "item like this") + " shows up in " + from + ", AI picks out the " + (labels.length ? list(labels.map(x => x.toLowerCase())) : "details") + " and an automation adds them to " + to + ".",
          ai: true, why: "Reading a message and picking out the right details used to need a person. AI can now do this reliably, and you review anything it isn’t sure about."
        } : {
          method: "Connect the two apps",
          how: "An integration (Zapier, Make, or a built-in connector) copies these fields from " + from + " to " + to + " the moment they change.",
          ai: false
        }
      });
    }
    return out;
  }
  function kindWord(k) { return ({ number: "numbers and amounts", text: "short text", email: "email addresses", date: "dates", link: "links", table: "rows of cells", "long text": "paragraphs", cells: "cells" })[k] || k; }
  function q(s) { return "“" + s + "”"; }

  /* ---------- detector 2: filling in the same form again and again ---------- */
  function detectEntry(ev) {
    const groups = new Map();
    const lastViewByIdx = [];
    let lastView = null, prevApp = null, prevAppT = 0;
    for (const e of ev) {
      if (e.type === "view") {
        if (lastView && lastView.app !== e.app) { prevApp = lastView.app; prevAppT = e.t; }
        lastView = e;
      }
      if (e.type !== "entry" || !e.app || COMM_APPS.has(e.app)) continue;
      const labels = (e.d && e.d.labels) || [];
      if (labels.length && labels.every(l => SEARCH_LABEL.test(l))) continue; // searching, not data entry
      const k = e.app + "|" + (e.page || "");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ e, src: prevApp && e.t - prevAppT < 10 * MIN ? prevApp : null, viewT: lastView && lastView.app === e.app ? lastView.t : e.t });
    }
    const out = [];
    for (const [k, items] of groups) {
      const occ = [];
      for (const it of items) {
        const o = occ[occ.length - 1];
        if (o && it.e.t - o.t1 <= 3 * MIN) { o.t1 = it.e.t; (it.e.d.labels || []).forEach(l => o.labels.add(l)); o.n += it.e.d.n || 0; }
        else occ.push({ t0: Math.max(it.viewT, it.e.t - 5 * MIN), t1: it.e.t, labels: new Set(it.e.d.labels || []), n: it.e.d.n || 0, src: it.src, title: it.e.title });
      }
      const n = occ.length, days = distinctDays(occ);
      if (!(n >= 4 && days >= 2)) continue;
      const [app, page] = k.split("|");
      const lab = counts(occ.flatMap(o => [...o.labels])).filter(([l, c]) => c >= n * 0.5 && l !== "[sensitive]").map(x => x[0]);
      const fieldsEach = Math.round(median(occ.map(o => Math.max(o.n, o.labels.size))));
      const srcs = counts(occ.map(o => o.src).filter(Boolean));
      const src = srcs.length && srcs[0][1] >= n * 0.5 ? srcs[0][0] : null;
      const title = short(mode(occ.map(o => o.title)), app);
      const consistent = lab.length >= 2;
      if (SHEET_APPS.has(app) && !src) continue;
      const isEmail = EMAIL_APPS.has(app);
      if (isEmail || (fieldsEach <= 2 && lab.some(l => WRITING_LABEL.test(l)))) {
        const what = isEmail ? "emails" : "replies";
        out.push({
          type: "drafting", key: "drafting|" + app + "|" + page, apps: src && !isEmail ? [src, app] : [app],
          title: "Writing similar " + what + " in " + app + (!isEmail && title ? " (" + q(title) + ")" : ""),
          detail: "You wrote " + n + " " + what + " like this. Ones that follow a pattern can start from an AI draft.",
          occurrences: occ.map(o => ({ t0: o.t0, t1: o.t1, note: (o.labels.size ? [...o.labels].slice(0, 3).join(", ") : "email") })),
          minutesEach: Math.max(1, median(occ.map(o => (o.t1 - o.t0) / MIN)) + 0.5),
          base: 45,
          automation: { method: "AI drafts, you send", how: "AI writes a first draft in your usual wording, filling in the facts from your other apps. You read it and press send.", ai: true, why: "AI is good at first drafts that follow a pattern. You keep the final say because these go to people." }
        });
        continue;
      }
      out.push({
        type: "entry", key: "entry|" + app + "|" + page, apps: src ? [src, app] : [app],
        title: (src ? "Typing details from " + src + " into " + app : "Filling in the same form in " + app) + (title ? " (" + q(title) + ")" : ""),
        detail: "About " + fieldsEach + " " + plural(fieldsEach, "field") + " each time" + (lab.length ? ": " + list(lab.slice(0, 6)) : "") + "." + (src ? " You usually look at " + src + " right before." : ""),
        context: { page, title, source: src, fields: lab },
        occurrences: occ.map(o => ({ t0: o.t0, t1: o.t1, note: (o.n || o.labels.size) + " fields" + (o.src ? " · after " + o.src : "") })),
        minutesEach: Math.max(0.75, median(occ.map(o => (o.t1 - o.t0) / MIN)) + 0.25),
        base: 70 + (consistent ? 6 : 0) + (src ? 6 : 0),
        automation: src ? (EMAIL_APPS.has(src) || DOC_HINT.test(title || "") ? {
          method: "AI fills in the form for you",
          how: "AI reads what you were looking at in " + src + ", fills in " + (lab.length ? list(lab.slice(0, 4).map(x => x.toLowerCase())) : "the form") + " in " + app + ", and leaves it for you to check and save.",
          ai: true, why: "Turning a message or document into form fields is exactly what newer AI tools can do. You stay the one who clicks save."
        } : {
          method: "Send the data over automatically",
          how: "The details you copy by eye from " + src + " can flow into " + app + " automatically, so the form is already filled in when you open it.",
          ai: false
        }) : {
          method: "Templates or auto-fill",
          how: "Most of these fields are the same every time. A saved template or an auto-fill rule in " + app + " fills them in, so you only type what actually changes.",
          ai: false
        }
      });
    }
    return out;
  }

  /* ---------- detector 3 & 4: downloading files and uploading them elsewhere / regular exports ---------- */
  function detectFiles(ev) {
    const downloads = ev.filter(e => e.type === "download" && e.app);
    const uploads = ev.filter(e => e.type === "upload" && e.app);
    const used = new Set(); const shuttles = new Map();
    for (const dl of downloads) {
      const up = uploads.find(u => u.t > dl.t && u.t - dl.t <= 30 * MIN && u.app !== dl.app && (!u.d.ext || !dl.d.ext || u.d.ext === dl.d.ext));
      if (!up) continue;
      used.add(dl);
      const k = dl.app + "→" + up.app + "|" + (dl.d.ext || "");
      if (!shuttles.has(k)) shuttles.set(k, []);
      shuttles.get(k).push({ t0: dl.t, t1: up.t, title: dl.title, ext: dl.d.ext });
    }
    const out = [];
    for (const [k, occ] of shuttles) {
      const n = occ.length, days = distinctDays(occ);
      if (!(n >= 3 && days >= 2)) continue;
      const [route, ext] = k.split("|"); const [from, to] = route.split("→");
      out.push({
        type: "shuttle", key: "shuttle|" + from + "|" + to + "|" + ext, apps: [from, to],
        title: "Downloading " + (ext ? "." + ext + " " : "") + "files from " + from + " and uploading them to " + to,
        detail: "The same download-then-upload, " + n + " times.",
        context: { from, to, ext },
        occurrences: occ.map(o => ({ t0: o.t0, t1: o.t1, note: (o.ext ? "." + o.ext : "file") + (o.title ? " · " + q(short(o.title, from)) : "") })),
        minutesEach: Math.max(1, Math.min(15, median(occ.map(o => (o.t1 - o.t0) / MIN)) + 0.5)),
        base: 82,
        automation: { method: "Sync the file automatically", how: "An automation pulls the file from " + from + " and puts it in " + to + " on a schedule or as soon as it’s ready. No downloading.", ai: false }
      });
    }
    const exp = new Map();
    for (const dl of downloads) {
      if (used.has(dl)) continue;
      const k = dl.app + "|" + (dl.d.ext || "");
      if (!exp.has(k)) exp.set(k, []);
      exp.get(k).push({ t0: dl.t, t1: dl.t, title: dl.title, ext: dl.d.ext });
    }
    for (const [k, occ] of exp) {
      const n = occ.length, days = distinctDays(occ);
      if (!(n >= 3 && days >= 2)) continue;
      const [app, ext] = k.split("|");
      out.push({
        type: "export", key: "export|" + app + "|" + ext, apps: [app],
        title: "Exporting " + (ext ? "." + ext + " " : "") + "files from " + app,
        detail: "You downloaded the same kind of file " + n + " times. Reports like this can usually be sent or refreshed automatically.",
        occurrences: occ.map(o => ({ t0: o.t0, t1: o.t1, note: (o.ext ? "." + o.ext : "file") + (o.title ? " · " + q(o.title) : "") })),
        minutesEach: 3, base: 72,
        automation: { method: "Scheduled report", how: "Set " + app + " (or an automation) to produce this file on a schedule and send it where it goes next.", ai: false }
      });
    }
    return out;
  }

  /* ---------- detector 5: flipping back and forth between two apps ---------- */
  function detectLookups(sessions) {
    const eps = new Map();
    for (const s of sessions) {
      const v = [];
      for (const e of s) if (e.type === "view" && e.app && (!v.length || v[v.length - 1].app !== e.app)) v.push(e);
      let i = 0;
      while (i < v.length - 1) {
        const A = v[i].app, B = v[i + 1].app; let j = i + 1;
        while (j < v.length && (v[j].app === A || v[j].app === B) && v[j].app !== v[j - 1].app && v[j].t - v[j - 1].t < 90000) j++;
        const switches = j - 1 - i;
        const busy = switches >= 6 ? s.filter(e => e.t >= v[i].t && e.t <= v[j - 1].t && (e.type === "copy" || e.type === "paste" || e.type === "entry")).length : 0;
        if (switches >= 6 && busy < 2) {
          const pair = [A, B].sort(); const k = pair.join("|");
          if (!eps.has(k)) eps.set(k, []);
          eps.get(k).push({ t0: v[i].t, t1: v[j - 1].t + 30000, switches, titleA: v[i].title, titleB: v[i + 1].title });
          i = j - 1;
        } else i++;
      }
    }
    const out = [];
    for (const [k, occ] of eps) {
      const n = occ.length, days = distinctDays(occ);
      if (!(n >= 3 && days >= 2)) continue;
      const [A, B] = k.split("|");
      out.push({
        type: "lookup", key: "lookup|" + k, apps: [A, B],
        title: "Switching back and forth between " + A + " and " + B,
        detail: "About " + Math.round(median(occ.map(o => o.switches))) + " switches each time, a few seconds per look. This usually means checking or matching information by eye.",
        occurrences: occ.map(o => ({ t0: o.t0, t1: o.t1, note: o.switches + " switches" })),
        minutesEach: Math.max(1, median(occ.map(o => (o.t1 - o.t0) / MIN))),
        base: 58,
        automation: { method: "Match it automatically", how: "If you’re checking that " + A + " and " + B + " agree, an automation can compare them and only show you the rows that don’t match. If you’re looking things up, the data can be pulled into one place.", ai: false }
      });
    }
    return out;
  }

  /* ---------- detector 6: multi-step routines (frequent step sequences) ---------- */
  function token(e) {
    if (e.type !== "view" && COMM_APPS.has(e.app)) return null;
    if (e.type === "entry" && (e.d.labels || []).length && e.d.labels.every(l => SEARCH_LABEL.test(l))) return null;
    switch (e.type) {
      case "view": return "Open " + e.app;
      case "copy": return "Copy from " + e.app;
      case "paste": return "Paste into " + e.app;
      case "entry": return "Fill in fields in " + e.app;
      case "submit": return "Submit in " + e.app;
      case "click": return e.d && e.d.label ? "Click “" + e.d.label + "” in " + e.app : null;
      case "download": return "Download " + (e.d.ext ? "." + e.d.ext : "a file") + " from " + e.app;
      case "upload": return "Upload " + (e.d.ext ? "." + e.d.ext : "a file") + " to " + e.app;
      default: return null;
    }
  }
  function detectRoutines(sessions, observedDays) {
    const seqs = sessions.map(s => {
      const out = [];
      for (const e of s) {
        if (!e.app) continue;
        const tk = token(e); if (!tk) continue;
        if (out.length && out[out.length - 1].tk === tk) { out[out.length - 1].t1 = e.t; continue; }
        out.push({ tk, t0: e.t, t1: e.t, app: e.app });
      }
      return out;
    });
    const grams = new Map();
    seqs.forEach((seq, si) => {
      for (let L = 3; L <= 8; L++) {
        const lastEnd = new Map();
        for (let i = 0; i + L <= seq.length; i++) {
          const g = seq.slice(i, i + L).map(x => x.tk).join(" ▸ ");
          if ((lastEnd.get(g) ?? -1) >= i) continue; // non-overlapping within a session
          lastEnd.set(g, i + L - 1);
          if (!grams.has(g)) grams.set(g, { L, steps: seq.slice(i, i + L).map(x => x.tk), occ: [] });
          grams.get(g).occ.push({ t0: seq[i].t0, t1: seq[i + L - 1].t1, si });
        }
      }
    });
    let cand = [...grams.values()].filter(g => {
      const apps = new Set(g.steps.map(s => s.replace(/^.* (?:in|from|into|to) /, "").replace(/^Open /, "")));
      const actions = g.steps.filter(s => !s.startsWith("Open ")).length;
      const productive = g.steps.filter(s => /^(Paste into|Fill in fields|Submit in|Download|Upload|Click)/.test(s)).length;
      return g.occ.length >= 3 && distinctDays(g.occ) >= Math.min(2, observedDays) && apps.size >= 2 && actions >= 2 && productive >= 1;
    });
    cand.sort((a, b) => b.L - a.L || b.occ.length - a.occ.length);
    const kept = [];
    for (const g of cand) {
      const key = " ▸ " + g.steps.join(" ▸ ") + " ▸ ";
      if (kept.some(h => (" ▸ " + h.steps.join(" ▸ ") + " ▸ ").includes(key) && h.occ.length >= g.occ.length * 0.75)) continue;
      kept.push(g);
    }
    kept.sort((a, b) => b.occ.length * b.L - a.occ.length * a.L);
    return kept.slice(0, 8).map(g => {
      const apps = [...new Set(g.steps.map(s => s.replace(/^.* (?:in|from|into|to) /, "").replace(/^Open /, "")))];
      return {
        type: "routine", key: "routine|" + g.steps.join("|"), apps,
        title: "A " + g.L + "-step routine across " + list(apps),
        detail: "You did these same steps in the same order " + g.occ.length + " times.",
        steps: g.steps,
        occurrences: g.occ.map(o => ({ t0: o.t0, t1: o.t1, note: g.L + " steps" })),
        minutesEach: Math.max(0.5, median(g.occ.map(o => (o.t1 - o.t0) / MIN))),
        base: 62,
        automation: { method: "One workflow runs the steps", how: "A workflow automation can run these steps in order, starting from the first one. You only step in where a decision is needed.", ai: false }
      };
    });
  }

  /* ---------- finishing: rates, regularity, confidence, ranking ---------- */
  function finalize(f, observedDays, workdaysPerWeek) {
    const occ = f.occurrences.sort((a, b) => a.t0 - b.t0);
    const n = occ.length, days = distinctDays(occ);
    const perDay = n / observedDays;
    const weeklyMinutes = perDay * workdaysPerWeek * f.minutesEach;
    const firstByDay = new Map();
    occ.forEach(o => { const k = dayKey(o.t0); if (!firstByDay.has(k)) firstByDay.set(k, minuteOfDay(o.t0)); });
    const firsts = [...firstByDay.values()];
    const regular = firsts.length >= 3 && stdev(firsts) <= 45 && perDay <= 2.5 ? { around: clockLabel(median(firsts)) } : null;
    const confidence = n >= 8 && days >= 3 ? "high" : n >= 4 && days >= 2 ? "medium" : "low";
    const score = Math.min(97, f.base + (regular ? 5 : 0) + (confidence === "high" ? 3 : confidence === "low" ? -8 : 0));
    const out = Object.assign({}, f, {
      count: n, days, perDay: +perDay.toFixed(2), minutesEach: +f.minutesEach.toFixed(1),
      weeklyMinutes: Math.round(weeklyMinutes), regular, confidence, automatability: score,
      rank: weeklyMinutes * score / 100,
      when: regular ? "Usually around " + regular.around + (days >= observedDays ? " every day we watched" : "") + "." : null
    });
    if (regular && (f.type === "export" || f.type === "shuttle" || f.type === "routine")) {
      out.automation = Object.assign({}, out.automation, { how: out.automation.how + " It happens around " + regular.around + ", so it can run on a schedule before you start." });
    }
    delete out.base;
    return out;
  }

  /** One real-world process often trips two detectors (e.g. download a resume + type the candidate in). Fold them into one finding. */
  function mergeSameProcess(findings) {
    const rankOf = { entry: 3, transfer: 2, shuttle: 1, drafting: 0.5 };
    const pool = findings.slice().sort((a, b) => (rankOf[b.type] || 0) - (rankOf[a.type] || 0));
    const absorbed = new Set(), out = [];
    const near = p => ({ t0: p.t0 - 2 * MIN, t1: p.t1 + 2 * MIN });
    for (const f of pool) {
      if (absorbed.has(f)) continue;
      if (rankOf[f.type]) for (const g of pool) {
        if (g === f || absorbed.has(g) || !rankOf[g.type] || rankOf[g.type] >= rankOf[f.type]) continue;
        if (!g.apps.every(a => f.apps.includes(a))) continue;
        const frac = g.occurrences.filter(o => f.occurrences.some(p => overlaps(o, near(p)))).length / g.occurrences.length;
        if (frac < 0.6) continue;
        absorbed.add(g);
        f.occurrences = f.occurrences.map(p => {
          const hits = g.occurrences.filter(o => overlaps(o, near(p)));
          if (!hits.length) return p;
          return { t0: Math.min(p.t0, ...hits.map(h => h.t0)), t1: Math.max(p.t1, ...hits.map(h => h.t1)), note: p.note + " · " + hits[0].note };
        });
        f.minutesEach = Math.max(f.minutesEach, median(f.occurrences.map(o => (o.t1 - o.t0) / MIN)) + 0.25);
        f.detail += g.type === "shuttle" ? " It also includes downloading a " + (g.context.ext ? "." + g.context.ext + " " : "") + "file from " + g.context.from + " and uploading it to " + g.context.to + "."
          : g.type === "drafting" ? " Each time, you also write a similar message in " + g.apps[0] + "."
          : " It also includes copying and pasting from " + g.apps[0] + " into " + g.apps[1] + ".";
        if (f.type === "entry" && g.type === "transfer") f.title = f.title.replace(/^Typing details/, "Copying details");
        f.base = Math.max(f.base, g.base);
        f.merged = (f.merged || []).concat(g.key);
      }
      out.push(f);
    }
    return out;
  }

  /** Trim lead-in/lead-out "Open X" steps for unrelated apps, and fold a repeated cycle (copy▸paste ×3) into one pass. */
  function tidySteps(steps, apps) {
    let st = steps.slice();
    const unrelated = s => s.startsWith("Open ") && !apps.includes(s.slice(5));
    while (st.length && unrelated(st[0])) st.shift();
    while (st.length && unrelated(st[st.length - 1])) st.pop();
    for (let k = 2; k <= st.length / 2; k++) {
      if (st.length % k) continue;
      if (st.every((x, i) => x === st[i % k])) return st.slice(0, k).concat(["Repeat for each piece of information"]);
    }
    return st;
  }

  function attachRoutines(findings, routines) {
    const standalone = [];
    for (const r of routines) {
      let best = null, bestFrac = 0;
      for (const f of findings) {
        if (!r.apps.every(a => f.apps.includes(a)) && !f.apps.every(a => r.apps.includes(a))) continue;
        const frac = r.occurrences.filter(o => f.occurrences.some(p => overlaps(o, p))).length / r.occurrences.length;
        if (frac > bestFrac) { bestFrac = frac; best = f; }
      }
      if (best && bestFrac >= 0.5) { const st = tidySteps(r.steps, best.apps); if (!best.steps || best.steps.length < st.length) best.steps = st; }
      else standalone.push(r);
    }
    return standalone;
  }

  function analyze(events, opts) {
    opts = opts || {};
    const workdaysPerWeek = opts.workdaysPerWeek || 5;
    const ev = (events || []).filter(e => e && e.t && e.type).slice().sort((a, b) => a.t - b.t).map(e => Object.assign({ d: {} }, e, { d: e.d || {} }));
    const days = [...new Set(ev.filter(e => e.type !== "away").map(e => dayKey(e.t)))].sort();
    const observedDays = Math.max(1, days.length);
    const sessions = splitSessions(ev, opts.sessionGapMin || 10);
    const time = timeByApp(sessions);

    let base = mergeSameProcess([...detectTransfers(ev), ...detectEntry(ev), ...detectFiles(ev), ...detectLookups(sessions)]);
    const routines = detectRoutines(sessions, observedDays);
    const standalone = attachRoutines(base, routines);
    // keep only routines that add something new
    base = base.concat(standalone.slice(0, 4));

    const findings = base.map(f => finalize(f, observedDays, workdaysPerWeek))
      .filter(f => f.weeklyMinutes >= (opts.minWeeklyMinutes ?? 5))
      .sort((a, b) => b.rank - a.rank);

    const automatableMinutes = findings.reduce((s, f) => s + f.weeklyMinutes * (f.automatability >= 60 ? 1 : 0), 0);
    return {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        events: ev.length, days, observedDays,
        activeMinutes: Math.round(time.total / MIN),
        activeMinutesPerDay: Math.round(time.total / MIN / observedDays),
        timeByApp: time.apps.slice(0, 12),
        findings: findings.length,
        automatableWeeklyMinutes: automatableMinutes
      },
      findings
    };
  }

  /** Plain-text brief for one finding — pasteable into an AI assistant or a consultant's notes. Contains no raw activity. */
  function brief(f, who) {
    const lines = [];
    lines.push("PROCESS: " + f.title);
    if (who) lines.push("WHO: " + who);
    lines.push("WHAT WE SAW: " + f.detail + " Seen " + f.count + " times over " + f.days + " " + plural(f.days, "day") + " (about " + f.minutesEach + " min each, ≈" + fmtMin(f.weeklyMinutes) + " a week)." + (f.when ? " " + f.when : ""));
    if (f.steps) lines.push("STEPS: " + f.steps.map((s, i) => (i + 1) + ". " + s).join("  "));
    lines.push("APPS: " + f.apps.join(", "));
    lines.push("SUGGESTED APPROACH: " + f.automation.method + ". " + f.automation.how);
    if (f.automation.ai) lines.push("WHY AI HELPS: " + f.automation.why);
    lines.push("CONFIDENCE: " + f.confidence + " · automatability " + f.automatability + "/100");
    return lines.join("\n");
  }
  function fmtMin(m) { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? h + "h " + r + "m" : r + "m"; }

  const api = { VERSION, analyze, brief, fmtMin, dayKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WDDetector = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
