/*
 * Synthetic activity generator for testing the detector.
 * Produces events in the exact shape the extension stores, for made-up people at made-up companies,
 * with known ("planted") repetitive processes hidden among realistic noise.
 */
"use strict";

function rng(seed) { // mulberry32
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rotating schedule used by the extension: week 1 Mon/Wed/Fri, week 2 Tue/Wed/Thu
function scheduleDays(mondayISO, weeks) {
  const [y, m, d] = mondayISO.split("-").map(Number);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const days = w % 2 === 0 ? [0, 2, 4] : [1, 2, 3];
    for (const off of days) out.push(new Date(y, m - 1, d + w * 7 + off));
  }
  return out;
}

class Day {
  constructor(date, r) { this.r = r; this.ev = []; this.t = new Date(date).setHours(8, 30 + Math.floor(r() * 20), 0, 0); }
  sec(a, b) { this.t += Math.round((a + this.r() * (b - a)) * 1000); return this; }
  push(type, app, page, title, d) { this.ev.push({ t: this.t, type, app, host: HOST[app] || app, page, title, d: d || {} }); return this; }
  view(app, page, title) { return this.push("view", app, page, title); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
}
const HOST = { "Gmail": "mail.google.com", "Google Sheets": "docs.google.com", "Google Docs": "docs.google.com", "Google Calendar": "calendar.google.com", "Stripe": "dashboard.stripe.com", "HubSpot": "app.hubspot.com", "QuickBooks": "qbo.intuit.com", "Salesforce": "northline.lightning.force.com", "Slack": "app.slack.com", "Shopify": "admin.shopify.com", "ShipStation": "ship.shipstation.com", "Airtable": "airtable.com", "Greenhouse": "app.greenhouse.io", "Zendesk": "copperpine.zendesk.com" };

/* ---------- reusable noise ---------- */
function noise(day) {
  const k = day.r();
  if (k < 0.25) { day.view("Slack", "/client/:id/:id", "general (Channel) - Northline - Slack").sec(20, 120); if (day.r() < 0.5) day.push("entry", "Slack", "/client/:id/:id", "general (Channel) - Northline - Slack", { n: 1, labels: ["Message to general"] }).sec(2, 5).push("click", "Slack", "/client/:id/:id", "", { label: "Send now" }); }
  else if (k < 0.4) day.view("Google Calendar", "/calendar/u/#/r/week", "Google Calendar - Week of #").sec(10, 50);
  else if (k < 0.55) { day.view("Gmail", "/mail/u/#/#inbox", "Inbox (#)").sec(15, 60); if (day.r() < 0.4) day.push("entry", "Gmail", "/mail/u/#/#inbox", "Inbox (#)", { n: 1, labels: ["Search mail"] }).sec(5, 20); }
  else if (k < 0.65) day.view("Google Docs", "/document/d/:id/edit", "Team notes - Google Docs").sec(60, 300);
  else if (k < 0.72) { day.view("Slack", "/client/:id/:id", "DM - Slack").push("copy", "Slack", "/client/:id/:id", "DM - Slack", { kind: "text", len: "short" }).sec(3, 10).push("paste", "Slack", "/client/:id/:id", "DM - Slack", { kind: "text", len: "short", field: "Message" }); }
  else if (k < 0.76) { day.view("Gmail", "/mail/u/#/#inbox/:id", "Re: lunch order").push("copy", "Gmail", "/mail/u/#/#inbox/:id", "Re: lunch order", { kind: "text", len: "short" }).sec(4, 12).view("Slack", "/client/:id/:id", "random - Slack").push("paste", "Slack", "/client/:id/:id", "random - Slack", { kind: "text", len: "short", field: "Message to random" }); }
  else if (k < 0.85) day.view("news.example.com", "/", "Morning briefing").sec(30, 200);
  else day.sec(60, 240); // reading / thinking
  day.sec(30, 180);
}

function runDay(day, jobs, endHour) {
  jobs.sort((a, b) => a.at - b.at);
  const lunch = new Date(day.t).setHours(12, day.int(0, 40), 0, 0);
  let lunched = false;
  for (const j of jobs) {
    while (day.t < j.at) { noise(day); if (!lunched && day.t > lunch) { day.push("away", null, null, null).sec(1800, 3000); lunched = true; } }
    j.run(day);
  }
  const end = new Date(day.t).setHours(endHour, 0, 0, 0);
  while (day.t < end) noise(day);
  day.push("away", null, null, null);
  return day.ev;
}
function spread(day, n, fromH, toH) { const a = new Date(day.t).setHours(fromH, 0, 0, 0), b = new Date(day.t).setHours(toH, 0, 0, 0); return Array.from({ length: n }, () => a + day.r() * (b - a)); }

/* ---------- persona 1: accounts receivable coordinator ---------- */
const CLIENTS = ["Acme Co", "Juniper Bakery", "Lumen Studio", "Northwind", "Brightline", "Harbor Foods"];
function arCoordinator(date, r) {
  const day = new Day(date, r), jobs = [];
  // planted A: daily Stripe export -> import into Sheets (~9:00)
  jobs.push({ at: new Date(day.t).setHours(9, day.int(-8, 10) + 0, 0, 0) + 0, run: d => {
    d.view("Stripe", "/payments", "Payments – Stripe").sec(20, 40).push("click", "Stripe", "/payments", "Payments – Stripe", { label: "Export" }).sec(3, 6)
     .push("click", "Stripe", "/payments", "Payments – Stripe", { label: "Export" }).sec(5, 12).push("download", "Stripe", "/payments", "Payments – Stripe", { ext: "csv" }).sec(8, 20)
     .view("Google Sheets", "/spreadsheets/d/:id/edit", "Daily payments # - Google Sheets").sec(5, 10).push("click", "Google Sheets", "/spreadsheets/d/:id/edit", "Daily payments # - Google Sheets", { label: "Import" }).sec(4, 8)
     .push("upload", "Google Sheets", "/spreadsheets/d/:id/edit", "Daily payments # - Google Sheets", { ext: "csv", n: 1 }).sec(5, 10).push("click", "Google Sheets", "/spreadsheets/d/:id/edit", "Daily payments # - Google Sheets", { label: "Import data" }).sec(20, 60);
  } });
  // planted B: payment emails copied into AR tracker
  spread(day, day.int(4, 7), 9, 17).forEach(at => jobs.push({ at, run: d => {
    const c = d.pick(CLIENTS), title = "Payment received from " + c + " – Invoice #";
    d.view("Gmail", "/mail/u/#/#inbox/:id", title).sec(15, 35);
    for (const kind of ["number", "text", "date"]) {
      d.push("copy", "Gmail", "/mail/u/#/#inbox/:id", title, { kind, len: "short" }).sec(3, 8)
       .view("Google Sheets", "/spreadsheets/d/:id/edit", "AR tracker # - Google Sheets").sec(3, 8)
       .push("paste", "Google Sheets", "/spreadsheets/d/:id/edit", "AR tracker # - Google Sheets", { kind, len: "short" }).sec(3, 6);
      if (kind !== "date") d.view("Gmail", "/mail/u/#/#inbox/:id", title).sec(2, 5);
    }
    d.sec(10, 30);
  } }));
  // planted C: retyping HubSpot deals into QuickBooks invoices
  spread(day, day.int(3, 5), 10, 16).forEach(at => jobs.push({ at, run: d => {
    const c = d.pick(CLIENTS);
    d.view("HubSpot", "/contacts/:id/record/:id/:id", "Deal: " + c + " order #").sec(40, 90)
     .view("QuickBooks", "/app/invoice", "Invoice").sec(10, 20)
     .push("entry", "QuickBooks", "/app/invoice", "Invoice", { n: 3, labels: ["Customer", "Invoice date", d.r() < 0.8 ? "Terms" : "Email"] }).sec(45, 90)
     .push("entry", "QuickBooks", "/app/invoice", "Invoice", { n: 3, labels: ["Product/service", "Qty", "Rate"] }).sec(10, 25)
     .push("click", "QuickBooks", "/app/invoice", "Invoice", { label: "Save and send" }).sec(10, 30);
  } }));
  // planted D: reconciling Salesforce vs the AR sheet by eye
  const recon = date.getDay() % 2 ? 1 : day.int(1, 2);
  spread(day, recon, 14, 17).forEach(at => jobs.push({ at, run: d => {
    const n = d.int(8, 14);
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) d.view("Salesforce", "/lightning/r/Opportunity/:id/view", "Opportunity | Salesforce").sec(15, 50);
      else d.view("Google Sheets", "/spreadsheets/d/:id/edit", "AR tracker # - Google Sheets").sec(15, 50);
    }
  } }));
  return runDay(day, jobs, 17);
}

/* ---------- persona 2: e-commerce operations ---------- */
function ecomOps(date, r) {
  const day = new Day(date, r), jobs = [];
  spread(day, day.int(7, 11), 9, 16).forEach(at => jobs.push({ at, run: d => {
    const title = "Order #" + " · Copper & Pine · Shopify";
    d.view("Shopify", "/store/:id/orders/:id", title).sec(10, 25);
    for (const [kind, field] of [["text", "Recipient name"], ["text", "Street address"], ["text", "City"], ["number", "Weight (oz)"]]) {
      d.push("copy", "Shopify", "/store/:id/orders/:id", title, { kind, len: "short" }).sec(2, 5)
       .view("ShipStation", "/orders/awaiting-shipment", "Awaiting Shipment | ShipStation").sec(2, 5)
       .push("paste", "ShipStation", "/orders/awaiting-shipment", "Awaiting Shipment | ShipStation", { kind, len: "short", field }).sec(2, 4);
      if (field !== "Weight (oz)") d.view("Shopify", "/store/:id/orders/:id", title).sec(1, 3);
    }
    d.push("click", "ShipStation", "/orders/awaiting-shipment", "Awaiting Shipment | ShipStation", { label: "Create label" }).sec(10, 30);
  } }));
  jobs.push({ at: new Date(day.t).setHours(10, day.int(20, 45), 0, 0), run: d => {
    d.view("Shopify", "/store/:id/products/inventory", "Inventory · Copper & Pine · Shopify").sec(30, 60)
     .push("click", "Shopify", "/store/:id/products/inventory", "Inventory · Copper & Pine · Shopify", { label: "Export" }).sec(5, 10)
     .push("download", "Shopify", "/store/:id/products/inventory", "Inventory · Copper & Pine · Shopify", { ext: "csv" }).sec(10, 20)
     .view("Gmail", "/mail/u/#/#inbox?compose=new", "Inbox (#)").sec(5, 10)
     .push("entry", "Gmail", "/mail/u/#/#inbox?compose=new", "Inbox (#)", { n: 3, labels: ["To recipients", "Subject", "Message Body"] }).sec(40, 90)
     .push("upload", "Gmail", "/mail/u/#/#inbox?compose=new", "Inbox (#)", { ext: "csv", n: 1 }).sec(5, 10)
     .push("click", "Gmail", "/mail/u/#/#inbox?compose=new", "Inbox (#)", { label: "Send" }).sec(10, 30);
  } });
  spread(day, day.int(2, 3), 11, 16).forEach(at => jobs.push({ at, run: d => {
    const sup = d.pick(["Fernwood Ceramics", "Ridge Textiles", "Oak & Iron"]);
    d.view("Gmail", "/mail/u/#/#inbox/:id", "PO request – " + sup + " – PO-#.pdf").sec(40, 80)
     .view("Airtable", "/:id/:id/:id", "Purchase orders: Grid view - Airtable").sec(5, 10)
     .push("entry", "Airtable", "/:id/:id/:id", "Purchase orders: Grid view - Airtable", { n: 5, labels: ["Supplier", "SKU", "Qty", "Unit cost", "Expected date"] }).sec(60, 150);
  } }));
  spread(day, day.int(4, 6), 9, 17).forEach(at => jobs.push({ at, run: d => {
    d.view("Zendesk", "/agent/tickets/:id", "Where is my order? – Zendesk").sec(30, 60)
     .push("entry", "Zendesk", "/agent/tickets/:id", "Where is my order? – Zendesk", { n: 1, labels: ["Public reply"] }).sec(60, 140)
     .push("click", "Zendesk", "/agent/tickets/:id", "Where is my order? – Zendesk", { label: "Submit as Solved" });
  } }));
  return runDay(day, jobs, 17);
}

/* ---------- persona 3: HR / recruiting coordinator ---------- */
function hrCoordinator(date, r) {
  const day = new Day(date, r), jobs = [];
  spread(day, day.int(3, 6), 9, 16).forEach(at => jobs.push({ at, run: d => {
    const role = d.pick(["Warehouse Associate", "Account Manager", "Driver"]);
    const t = "Application: " + role + " – resume.pdf";
    d.view("Gmail", "/mail/u/#/#inbox/:id", t).sec(30, 60)
     .push("download", "Gmail", "/mail/u/#/#inbox/:id", t, { ext: "pdf" }).sec(5, 10)
     .view("Greenhouse", "/people/new", "Add a Candidate | Greenhouse").sec(5, 10)
     .push("entry", "Greenhouse", "/people/new", "Add a Candidate | Greenhouse", { n: 6, labels: ["First name", "Last name", "Email", "Phone", "Job", "Source"] }).sec(60, 120)
     .push("upload", "Greenhouse", "/people/new", "Add a Candidate | Greenhouse", { ext: "pdf", n: 1 }).sec(5, 10)
     .push("click", "Greenhouse", "/people/new", "Add a Candidate | Greenhouse", { label: "Add Candidate" }).sec(10, 20);
  } }));
  spread(day, day.int(2, 4), 10, 16).forEach(at => jobs.push({ at, run: d => {
    const n = d.int(7, 12);
    for (let i = 0; i < n; i++) i % 2 ? d.view("Gmail", "/mail/u/#/#inbox/:id", "Re: Interview availability").sec(10, 40) : d.view("Google Calendar", "/calendar/u/#/r/week", "Google Calendar - Week of #").sec(10, 40);
  } }));
  return runDay(day, jobs, 17);
}

function generate(persona, mondayISO, weeks, seed) {
  const r = rng(seed || 7);
  const fn = { ar: arCoordinator, ecom: ecomOps, hr: hrCoordinator, noise: (d, r) => runDay(new Day(d, r), [], 17) }[persona];
  return scheduleDays(mondayISO, weeks || 2).flatMap(d => fn(d, r));
}

module.exports = { generate, scheduleDays };
