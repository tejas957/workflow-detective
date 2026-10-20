# Putting the Extension on the Chrome Web Store

Everything to copy and paste into the Chrome Web Store form. It takes about 20 minutes to fill in. Google's review usually takes a few days, and can take longer because the extension works on all websites, so start this first.

Edge users install from the same Chrome Web Store link. You don't need a separate Edge listing.

## Before you start

- A Google account to own the listing (a new one like `workflowdetective.pilot@gmail.com` keeps it separate from your personal account).
- The one-time Chrome Web Store developer registration fee.
- **The package:** `workflow-detective-extension.zip`. Download it from the **pilot** release: https://github.com/tejas957/workflow-detective/releases/tag/pilot
- **The images:** the repository's `store/` folder has the 128×128 icon and three 1280×800 screenshots.
- **The privacy policy link:** https://tejas957.github.io/workflow-detective/site/privacy.html.

## Steps

1. Go to the Chrome Web Store Developer Dashboard, sign in, and pay the registration fee.
2. Click **New item** and upload `workflow-detective-extension.zip`.
3. Fill in each tab with the text below.
4. **Distribution → Visibility: Unlisted.** Only people with the link can find it.
5. Click **Submit for review**.
6. When it's approved, copy the listing's link (it looks like `https://chromewebstore.google.com/detail/…`). Paste it into `site/config.json` as `"chromeStoreUrl"`, then upload that file to GitHub. The setup page starts offering the extension within a few minutes.

## Store listing tab

**Name** (from the package): Workflow Detective (Pilot)

**Summary** (from the package): Finds the repetitive work in your week so it can be automated. Records actions, never what you type.

**Description:**

> Workflow Detective is used in workplace pilots to find repetitive computer work that could be automated, without anyone having to describe their job.
>
> During a study you agree to, it runs in the background on 3 days a week for 2 weeks, during work hours only. It notices the shape of your work: which web app you're in, that you copied something from one site and pasted it into another, which form fields you fill in again and again, and which files you download and upload. It turns the patterns it sees into a plain-English list, like "Copying details from Gmail into QuickBooks, about 40 minutes a week", with a suggested way to automate each one.
>
> What it never records: what you type, the contents of emails, messages or documents, what you copy, passwords or payment details, screenshots, or anything in private windows. Banking, health and social media sites are skipped by default, and you can block any site.
>
> Everything stays on your computer. There are no servers. You can see and delete everything it recorded at any time, and at the end you decide whether to send a results file to the pilot team.
>
> This extension is for participants in a Workflow Detective pilot. Your pilot team will send you a personal setup link.

**Category:** Workflow & Planning (or Productivity)
**Language:** English

**Graphic assets:** icon `store/icon-128.png`; screenshots `store/screenshot-1-findings.png`, `store/screenshot-2-setup.png`, `store/screenshot-3-personal-link.png`.

## Privacy practices tab

**Single purpose:**

> Finds repetitive work patterns in the user's web browsing during a workplace study they agreed to, and lists them as automation opportunities for the user to review.

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| `storage`, `unlimitedStorage` | Keeps the study settings and the activity log on the user's own computer for the 2-week study. Nothing is sent anywhere. |
| `tabs` | Needed to know which web app is in use and for how long (the site and page title, with numbers and email addresses removed). This is the core of finding repeated work across apps. |
| `idle` | Stops counting time when the user steps away, so time estimates are accurate. |
| `downloads` | Notices that a file was downloaded and its type (like .csv), to find "export from one app, upload to another" patterns. The file name and contents are never read. |
| `alarms` | Checks the study schedule every few minutes, so the extension only watches on study days and during work hours, and deletes data automatically after the study. |
| `scripting` | Adds the extension's page script to tabs that were already open when it was installed, so the user doesn't have to reload them. |
| Host permission `https://tejas957.github.io/*` | The pilot's own setup page. The extension reads the participant's invite code there so its setup fills itself in, and tells the page that it's installed. |
| Optional host permissions (`http`/`https` sites), asked at consent | Not granted at install. When the participant ticks consent and clicks "Start the study", the extension asks for access with Chrome's own prompt. It needs it because repetitive work spans whatever web apps a business uses (email, accounting, CRM, spreadsheets), which differ by company, so the sites can't be listed in advance. On each page it notices only the shape of actions (a copy happened, a field called "Customer" was filled in), never typed text or page content. Users can block any site, and removing the access stops all page observation. |

**Remote code:** No, I am not using remote code.

**Data usage.** Tick these, because the extension handles them on the device:
- **Web history** (which sites are used, and page titles with numbers and emails removed)
- **User activity** (that a copy, paste, click or form entry happened, never the content)

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://tejas957.github.io/workflow-detective/site/privacy.html

## If the dashboard warns about "Broad Host Permissions"

Version 0.3.0 and later shouldn't trigger this warning: the extension installs with access to the setup page only, and asks for access to other sites when the participant clicks **Start the study**. If you still see it, submit anyway. It means a longer, in-depth review, not a rejection, and the justifications above answer it.

## If review asks questions

Reply with the single-purpose text above, plus: "The extension has no servers and makes no network requests. All data stays in the user's browser storage until the user chooses to export a results file. It is distributed as unlisted, to consenting pilot participants only." Most follow-ups are about the all-sites permission, and that reply covers it.

## Updating it later

Increase `"version"` in `extension/manifest.json`, upload the new zip from the latest GitHub release under **Package → Upload new package**, and submit. Installed copies update by themselves within a day or so.
