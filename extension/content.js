// Runs on web pages. Notices actions (copy, paste, filling fields, clicking buttons, uploading files)
// and reports only their shape: "pasted a number into the Amount field". Never the text itself.
(() => {
  if (window.__wdLoaded) return;
  window.__wdLoaded = true;

  let sendOk = true;
  const send = (wd, d) => {
    if (!sendOk) return;
    try { chrome.runtime.sendMessage({ wd, d }).catch(() => {}); } catch { sendOk = false; } // extension reloaded: go quiet
  };

  const SENSITIVE = /pass(word|code)?\b|\bssn\b|social.?security|card.?(number|no)|credit.?card|\bcvv\b|\bcvc\b|security.?code|\biban\b|routing|account.?(number|no)|\bpin\b|tax.?id|\bein\b|date.?of.?birth|\bdob\b|one.?time/i;

  function clean(s) {
    return String(s || "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/\d+/g, "#").slice(0, 40);
  }
  function kindOf(text) {
    const t = String(text || "").trim();
    if (!t) return "unknown";
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return "email";
    if (/^[-+]?[$€£¥]?\s?[\d,]+(\.\d+)?%?$/.test(t)) return "number";
    if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(t) || (t.length < 30 && /\d/.test(t) && /^[A-Za-z]{3,9}\.? \d{1,2},? \d{2,4}$/.test(t))) return "date";
    if (/^https?:\/\/\S+$/.test(t)) return "link";
    if (t.includes("\t") || t.split("\n").length > 2) return "table";
    return t.length > 200 ? "long text" : "text";
  }
  const lenBucket = n => n === 0 ? "0" : n < 20 ? "short" : n < 200 ? "medium" : "long";

  function labelFor(el) {
    try {
      if (!el || !el.getAttribute) return "Field";
      let s = el.getAttribute("aria-label") || "";
      if (!s && el.labels && el.labels.length) s = el.labels[0].innerText;
      if (!s) { const lb = el.getAttribute("aria-labelledby"); if (lb) s = lb.split(/\s+/).map(id => (document.getElementById(id) || {}).innerText || "").join(" "); }
      if (!s) s = el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "";
      if (!s && el.isContentEditable) s = "Text box";
      return clean(s) || "Field";
    } catch { return "Field"; }
  }
  function isSensitive(el, label) {
    if (!el) return false;
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    const ac = (el.getAttribute && el.getAttribute("autocomplete") || "").toLowerCase();
    return type === "password" || /^cc-|password|one-time-code/.test(ac) || SENSITIVE.test(label + " " + (el.name || "") + " " + (el.id || ""));
  }
  function fieldOf(target) {
    if (!target) return null;
    if (target.isContentEditable) return target.closest("[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']") || target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return target;
    return null;
  }

  /* copy & paste: record kind and size, never the content */
  document.addEventListener("copy", () => {
    let txt = "";
    try {
      txt = String(window.getSelection() || "");
      const a = document.activeElement;
      if (!txt && a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.selectionStart != null) txt = a.value.slice(a.selectionStart, a.selectionEnd);
    } catch {}
    send("copy", { kind: kindOf(txt), len: lenBucket(txt.length) });
  }, true);
  document.addEventListener("paste", e => {
    let txt = "";
    try { txt = (e.clipboardData && e.clipboardData.getData("text/plain")) || ""; } catch {}
    const el = fieldOf(e.target), label = el ? labelFor(el) : null;
    send("paste", { kind: kindOf(txt), len: lenBucket(txt.length), field: el ? (isSensitive(el, label) ? "[sensitive]" : label) : undefined });
  }, true);

  /* filling in fields: batched per screen, labels only */
  let pending = new Map(), sensitive = 0, timer = null;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!pending.size && !sensitive) return;
    send("entry", { n: pending.size + sensitive, labels: [...pending.keys()].slice(0, 12), sensitive });
    pending = new Map(); sensitive = 0;
  }
  function noteField(e) {
    const el = fieldOf(e.target); if (!el) return;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "file" || type === "hidden") return;
    const label = labelFor(el);
    if (isSensitive(el, label)) { if (!el.__wdSens) { sensitive++; el.__wdSens = true; } }
    else pending.set(label, true);
    clearTimeout(timer); timer = setTimeout(flush, 4000);
  }
  document.addEventListener("input", noteField, true);
  document.addEventListener("change", e => {
    const el = e.target;
    if (el && el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "file") {
      const files = [...(el.files || [])];
      if (files.length) send("upload", { n: files.length, ext: ((/\.([a-z0-9]{1,6})$/i.exec(files[0].name) || [])[1] || "file").toLowerCase() });
      return;
    }
    noteField(e);
  }, true);
  document.addEventListener("drop", e => {
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (files.length) send("upload", { n: files.length, ext: ((/\.([a-z0-9]{1,6})$/i.exec(files[0].name) || [])[1] || "file").toLowerCase() });
  }, true);
  document.addEventListener("submit", e => { flush(); send("submit", { n: (e.target && e.target.elements ? e.target.elements.length : 0) }); }, true);

  /* clicking buttons: short visible label only */
  document.addEventListener("click", e => {
    try {
      const b = e.target && e.target.closest && e.target.closest("button,[role='button'],input[type='submit'],input[type='button'],[role='menuitem'],[role='tab']");
      if (!b) return;
      const label = clean(b.getAttribute("aria-label") || b.innerText || b.value || b.getAttribute("title") || "");
      if (!label || label.length > 40) return;
      flush();
      send("click", { label });
    } catch {}
  }, true);

  /* Personal setup page (Workflow Detective "Get started"): pick up the participant's invite so setup fills itself
     in, and tell the page whether the extension is installed and set up. Only pages that declare themselves with
     <meta name="workflow-detective-page"> are touched. */
  try {
    if (window === window.top && document.querySelector('meta[name="workflow-detective-page"]')) {
      const mark = () => {
        try {
          chrome.storage.local.get("settings").then(r => {
            const s = r && r.settings;
            document.documentElement.setAttribute("data-wd-extension", s && s.consented && !s.withdrawn ? "ready" : "installed");
          }).catch(() => {});
        } catch { sendOk = false; }
      };
      const offer = code => { if (/^WD1\.[A-Za-z0-9_-]{8,}\.[a-z0-9]{1,8}$/.test(code || "")) send("invite", { code }); };
      const meta = document.querySelector('meta[name="workflow-detective-invite"]');
      if (meta) offer(meta.getAttribute("content"));
      window.addEventListener("message", e => {
        if (e.source === window && e.data && e.data.type === "workflow-detective-invite") offer(e.data.code);
        if (e.source === window && e.data && e.data.type === "workflow-detective-ping") mark();
      });
      mark();
      setInterval(mark, 2000);
    }
  } catch {}

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
})();
