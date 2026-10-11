// Turns a URL into a friendly app name and a page pattern with IDs removed.
// e.g. https://qbo.intuit.com/app/invoice?txnId=123  ->  { name: "QuickBooks", page: "/app/invoice" }

const RULES = [
  [/^mail\.google\.com$/, "Gmail"],
  [/^docs\.google\.com$/, u => u.pathname.startsWith("/spreadsheets") ? "Google Sheets" : u.pathname.startsWith("/presentation") ? "Google Slides" : u.pathname.startsWith("/forms") ? "Google Forms" : "Google Docs"],
  [/^drive\.google\.com$/, "Google Drive"],
  [/^calendar\.google\.com$/, "Google Calendar"],
  [/^chat\.google\.com$/, "Google Chat"],
  [/^meet\.google\.com$/, "Google Meet"],
  [/^(outlook\.office(365)?\.com|outlook\.live\.com|outlook\.cloud\.microsoft)$/, "Outlook"],
  [/^teams\.(microsoft|live)\.com$|^teams\.cloud\.microsoft$/, "Microsoft Teams"],
  [/\.officeapps\.live\.com$|^excel\.cloud\.microsoft$/, "Excel Online"],
  [/(^|\.)sharepoint\.com$/, u => /\/:x:\/|\.xlsx/i.test(u.pathname + u.search) ? "Excel Online" : "SharePoint"],
  [/(^|\.)slack\.com$/, "Slack"],
  [/\.lightning\.force\.com$|\.my\.salesforce\.com$|(^|\.)salesforce\.com$/, "Salesforce"],
  [/(^|\.)hubspot\.com$/, "HubSpot"],
  [/(^|\.)qbo\.intuit\.com$/, "QuickBooks"],
  [/(^|\.)xero\.com$/, "Xero"],
  [/^dashboard\.stripe\.com$/, "Stripe"],
  [/^admin\.shopify\.com$|\.myshopify\.com$/, "Shopify"],
  [/(^|\.)shipstation\.com$/, "ShipStation"],
  [/^airtable\.com$/, "Airtable"],
  [/^app\.asana\.com$/, "Asana"],
  [/^trello\.com$/, "Trello"],
  [/\.atlassian\.net$/, u => u.pathname.startsWith("/wiki") ? "Confluence" : "Jira"],
  [/(^|\.)notion\.(so|site)$/, "Notion"],
  [/(^|\.)monday\.com$/, "monday.com"],
  [/^app\.clickup\.com$/, "ClickUp"],
  [/(^|\.)zendesk\.com$/, "Zendesk"],
  [/^app\.intercom\.com$/, "Intercom"],
  [/(^|\.)freshdesk\.com$/, "Freshdesk"],
  [/(^|\.)greenhouse\.io$/, "Greenhouse"],
  [/(^|\.)lever\.co$/, "Lever"],
  [/(^|\.)(myworkday|workday)\.com$/, "Workday"],
  [/(^|\.)netsuite\.com$/, "NetSuite"],
  [/(^|\.)gusto\.com$/, "Gusto"],
  [/(^|\.)adp\.com$/, "ADP"],
  [/(^|\.)bill\.com$/, "BILL"],
  [/(^|\.)expensify\.com$/, "Expensify"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)docusign\.(net|com)$/, "DocuSign"],
  [/(^|\.)pipedrive\.com$/, "Pipedrive"],
  [/(^|\.)zoho\.(com|eu|in)$/, "Zoho"],
  [/(^|\.)canva\.com$/, "Canva"],
  [/(^|\.)figma\.com$/, "Figma"],
  [/(^|\.)dropbox\.com$/, "Dropbox"],
  [/(^|\.)box\.com$/, "Box"],
  [/^github\.com$/, "GitHub"],
  [/^web\.whatsapp\.com$/, "WhatsApp"],
  [/(^|\.)zoom\.us$/, "Zoom"],
  [/^sellercentral\.amazon\.com$/, "Amazon Seller Central"],
  [/(^|\.)amazon\.com$/, "Amazon"],
  [/^(chatgpt\.com|chat\.openai\.com)$/, "ChatGPT"],
  [/^claude\.ai$/, "Claude"]
];

function normSeg(seg) {
  if (!seg) return seg;
  if (/^\d+$/.test(seg)) return ":id";
  if (/^[0-9a-f]{8,}$/i.test(seg)) return ":id";
  if (/^[0-9a-f-]{20,}$/i.test(seg)) return ":id";
  if (seg.length >= 14 && /\d/.test(seg) && /[a-z]/i.test(seg)) return ":id";
  if (seg.includes("@") || seg.length > 40) return ":id";
  return decodeURIComponent(seg).replace(/[^\w.:-]/g, "_").slice(0, 40);
}

export function appFor(u) {
  const host = u.hostname.replace(/^www\./, "");
  let name = null;
  for (const [re, val] of RULES) if (re.test(host)) { name = typeof val === "function" ? val(u) : val; break; }
  if (!name) name = host;
  let page = "/" + u.pathname.split("/").filter(Boolean).slice(0, 5).map(normSeg).join("/");
  if (u.hash && u.hash.length > 1 && /^#[a-z]/i.test(u.hash)) page += "/#" + u.hash.slice(1).split(/[/?]/).filter(Boolean).slice(0, 2).map(normSeg).join("/");
  if (/[?&]compose=/.test(u.search + u.hash)) page += "?compose";
  return { name, page };
}

/** Page titles keep their words but lose numbers, email addresses and phone numbers. */
export function redactTitle(title) {
  if (!title) return "";
  const t = String(title)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "#")
    .replace(/\d+/g, "#")
    .split(/\s+[-–|]\s+/).filter(p => p.trim() !== "[email]").join(" - ");
  return t.slice(0, 90);
}
