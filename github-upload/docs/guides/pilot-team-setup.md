# Pilot Team Guide: How the Three Versions Fit Together

All three versions record the same kind of activity log, use the same pattern engine, show the same setup and findings pages, and produce results files the same console reads. **To launch, follow [the launch checklist](../LAUNCH_CHECKLIST.md).** This page is the background.

## How each person gets the right version

You don't choose. Each participant's personal link (from the invite tool) opens a setup page that:

1. **Knows who they are.** The link carries their name, company, start date and hours, so they never type them.
2. **Detects their computer and browser** (Windows, Mac, Chromebook, phone; Chrome, Edge, Safari, Firefox).
3. **Asks one question if you didn't fill it in:** "Where do you do most of your work? Websites / Programs on my computer / A mix or not sure."
4. **Shows only their steps**, each with one big button, and hands their details to whatever they install:
   - Browser extension: the extension reads their details from the page as soon as it's added, and opens its setup already filled in.
   - Windows / Mac app: clicking **Download** copies their invite code, and the app reads it the first time it opens.
5. **Ticks off each step** as it's done (the extension reports back to the page live).

| They mostly work in… | On a… | They get |
|---|---|---|
| Web apps (Gmail, Google Sheets, QuickBooks Online, Salesforce, Shopify) | any computer with Chrome or Edge | **Browser extension** |
| Desktop programs (Outlook, Excel, QuickBooks Desktop) | Windows 10/11 | **Windows app** |
| Desktop programs (Outlook, Excel, Apple Mail, Numbers) | Mac, macOS 12+ | **Mac app** |
| Both, or not sure | Chrome or Edge | **Both**, in order. The console merges their two results files into one person. |
| Anything | Safari or Firefox | The Windows or Mac app (it sees websites by window title) |

If something isn't available yet (for example, the extension before Google approves it, or the Mac app if its build failed), the page quietly falls back to what is available, or tells the person to contact you.

## What each version can see

| | Browser extension | Windows app | Mac app |
|---|---|---|---|
| Which app or site is in front, and for how long | Web only | All apps | All apps |
| Page or window titles (numbers and emails removed) | ✓ | ✓ | ✓ (needs Accessibility) |
| Copy: that it happened, and the kind of thing copied | ✓ (number, date…) | ✓ (number, date…) | ✓ type only (text, cells, file); never reads the clipboard |
| Paste | Seen directly | Inferred from the next edit in another app | Inferred from the next edit, or time spent in the next app |
| Field labels typed into | ✓ | ✓ (most apps) | ✓ (most apps; needs Accessibility) |
| Button labels clicked | ✓ | ✓ | ✗ |
| Excel sheet + column headings edited | Web Excel only | ✓ desktop Excel | ✗ (workbook name only) |
| Outlook: subject of the email being read | Web Outlook titles | ✓ classic Outlook | Opened-message windows only |
| New files | Downloads (by type) | Downloads, Desktop, Documents (by type) | Downloads (by type) |
| Keyboard / screenshots | Never | Never | Never |

## Where the versions come from

The **Publish pilot** GitHub workflow (`.github/workflows/publish.yml`) runs every time you upload a change. It:

1. Runs the core checks (findings engine, invite codes, setup pages in a real browser). If these fail, nothing is published.
2. Builds the **Windows app** on a real Windows machine and runs its self-checks and smoke test.
3. Builds the **Mac app** on a real Mac (both chip types), runs its self-checks and smoke test, and signs and notarizes it if you've added Apple secrets.
4. Zips the **browser extension** for the Chrome Web Store.
5. Attaches all three to a GitHub release called **pilot**, publishes the setup page, invite tool and privacy policy to GitHub Pages, and records which downloads exist, so the setup page only offers working ones.

**Browser extension:** goes through the Chrome Web Store as **Unlisted** (`docs/CHROME_WEB_STORE.md`). Edge uses the same link. For a quick test on your own computer: `chrome://extensions` → **Developer mode** → **Load unpacked** → the `extension` folder.

**Windows app:** unsigned, so people see "Windows protected your PC" once, and the setup page walks them through it. On first run it installs itself into the user's own folder (no admin), so cleaning out Downloads doesn't break it. A code-signing certificate removes the warning. Test on a real PC with `docs/WINDOWS_TESTING.md`.

**Mac app:** without Apple notarization, people go to **System Settings → Privacy & Security → Open Anyway** once, and the setup page walks them through it. Add the Apple secrets listed in `publish.yml` to notarize automatically. Notarizing also keeps the Accessibility permission from resetting when you ship an update.

## Collecting results

Participants click **Save results file** at the closeout call and send it to you:

| Version | File name starts with |
|---|---|
| Browser extension | `workflow-detective_` |
| Windows app | `workflow-detective_windows_` |
| Mac app | `workflow-detective_mac_` |

Drop all of them into the console (`console/index.html`, or the published console link). Files are read in the browser and never uploaded. People who sent both a browser file and a desktop file show as one row marked **Browser + Windows** or **Browser + Mac**.

## What's tested, and where

| | Tested here (Linux) | Still needs a real machine |
|---|---|---|
| Pattern engine | 250/250 planted processes across 75 simulated people, 0 false findings | Real people (that's the pilot) |
| Setup page + invite tool | 50 checks in a real browser: every computer/browser combination, phones, missing downloads, company-wide links, damaged links, the invite tool's links, emails and notices | — |
| Browser extension | 25 checks in real Chromium with the extension loaded, including opening a personal link and setup filling itself in | A day of real use |
| Windows app | Compiled; 31 self-checks; schedule matches the extension on 400 cases; simulated Outlook/Excel/QuickBooks weeks; 16 page checks including the copied invite code filling in setup | Notifications, Excel and Outlook connections, first-run install: `docs/WINDOWS_TESTING.md` |
| Mac app | Recording core: 21 checks; pages: 15 checks with the Mac bridge emulated, including pasting an invite; Swift files parse | **Compiling** (the GitHub workflow does this) and Accessibility on a real Mac |

If the Mac build fails, copy the error from the GitHub run and paste it to Claude to fix.
