/*
 * Workflow Detective invite codes.
 * One short code carries everything a participant would otherwise type: company, name, start date, schedule,
 * and (optionally) what kind of work they do and which computer they use, so the right version can be picked.
 *
 *   WD1.<base64url JSON>.<checksum>      e.g. WD1.eyJ2IjoxLCJjIjoiTk9SVEhMSU5FIn0.1k3f9
 *
 * Only letters, digits, "." "_" "-": safe in links (#anchor), emails, and copy-paste.
 * Works in browsers (window.WDInvite) and Node (module.exports). No dependencies.
 */
(function (root) {
  "use strict";
  var PREFIX = "WD1";
  var FIND = /WD1\.[A-Za-z0-9_-]{8,}\.[a-z0-9]{1,8}/;

  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function b64urlEncode(str) {
    var b64 = typeof Buffer !== "undefined" && typeof btoa === "undefined"
      ? Buffer.from(str, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return typeof Buffer !== "undefined" && typeof atob === "undefined"
      ? Buffer.from(b64, "base64").toString("utf8")
      : decodeURIComponent(escape(atob(b64)));
  }
  function str(v, n) { return typeof v === "string" ? v.trim().slice(0, n) : ""; }
  function int(v, lo, hi, def) { v = Math.round(Number(v)); return isFinite(v) && v >= lo && v <= hi ? v : def; }

  /** invite = { company, participant?, startDate?, weeks?, hourStart?, hourEnd?, scheduleMode?, days?, work?, computer?, contact? } */
  function encode(inv) {
    var o = { v: 1, c: str(inv.company, 40) };
    if (inv.participant) o.n = str(inv.participant, 60);
    if (inv.startDate) o.s = str(inv.startDate, 10);
    if (inv.weeks) o.w = int(inv.weeks, 1, 4, 2);
    if (inv.hourStart != null && inv.hourEnd != null) o.h = [int(inv.hourStart, 0, 23, 8), int(inv.hourEnd, 1, 24, 18)];
    if (inv.scheduleMode === "fixed" && Array.isArray(inv.days)) { o.m = "fixed"; o.d = inv.days.filter(function (d) { return d >= 0 && d <= 6; }); }
    if (inv.work) o.k = str(inv.work, 8);           // "web" | "desktop" | "both"
    if (inv.computer) o.o = str(inv.computer, 8);   // "windows" | "mac"
    var body = b64urlEncode(JSON.stringify(o));
    return PREFIX + "." + body + "." + fnv(body);
  }

  /** Returns the invite object, or null if the code is missing, cut off, or mistyped. */
  function decode(code) {
    var m = FIND.exec(String(code || ""));
    if (!m) return null;
    var parts = m[0].split(".");
    if (fnv(parts[1]) !== parts[2]) return null;
    var o;
    try { o = JSON.parse(b64urlDecode(parts[1])); } catch (e) { return null; }
    if (!o || o.v !== 1 || !str(o.c, 40)) return null;
    var inv = { code: m[0], company: str(o.c, 40), participant: str(o.n, 60) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(o.s || "")) inv.startDate = o.s;
    if (o.w) inv.weeks = int(o.w, 1, 4, 2);
    if (Array.isArray(o.h) && o.h.length === 2) { inv.hourStart = int(o.h[0], 0, 23, 8); inv.hourEnd = int(o.h[1], 1, 24, 18); if (inv.hourEnd <= inv.hourStart) { delete inv.hourStart; delete inv.hourEnd; } }
    if (o.m === "fixed" && Array.isArray(o.d) && o.d.length) { inv.scheduleMode = "fixed"; inv.days = o.d.map(Number).filter(function (d) { return d >= 0 && d <= 6; }); }
    if (/^(web|desktop|both)$/.test(o.k || "")) inv.work = o.k;
    if (/^(windows|mac)$/.test(o.o || "")) inv.computer = o.o;
    return inv;
  }

  /** Finds an invite code inside any text (a pasted email, a link). */
  function find(text) { var m = FIND.exec(String(text || "")); return m ? m[0] : null; }

  var api = { encode: encode, decode: decode, find: find };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WDInvite = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
