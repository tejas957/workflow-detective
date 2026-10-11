# Workflow Detective for Windows

The browser extension only sees the browser. The Windows app sees **every app**: Excel, Outlook, Word, QuickBooks Desktop, Teams, file folders, and browser windows too. It writes the same kind of activity log, uses the same pattern engine, and shows the same setup and findings pages, so the console works unchanged.

It's one file, `WorkflowDetective.exe` (about 180 KB). It runs on the .NET Framework that comes with Windows 10 and 11, so there's nothing else to install and no admin rights needed.

## What it watches, and how

| Signal | How Windows provides it | What's kept |
|---|---|---|
| Which app and window is in front | Windows "foreground changed" and "title changed" notifications | App name + window title with numbers/emails removed (e.g. `Excel · AR Tracker #.xlsx`) |
| Copying | Windows clipboard-changed notification | Only the **kind** of thing (number, date, cells, text). The text is looked at in memory to classify it, then dropped. |
| Typing into a field | Windows accessibility "value changed" notification | The field's **label** (`Customer:Job`, `Subject`). Never the value. Password fields are counted, never named. |
| Pressing a button | Accessibility "invoked" notification | The button's label (`Save & Close`, `Send`) |
| Excel | Excel's own event interface (classic desktop Excel) | Workbook and sheet name (numbers removed) and the **column headings** of edited cells. Never cell values. |
| Outlook (classic) | Outlook's object model, while Outlook is in front | The selected email's subject, with numbers removed |
| Files | Folder watching on Downloads, Desktop, Documents | That a new file appeared, and its type (`.xlsx`). Never the name or contents. |
| File pickers | "Open / Upload / Attach" dialogs opening | That a file was picked (counted as an upload) |
| Idle / screen lock | Last-input time, lock events | "Away" markers |

**It never uses a keyboard hook, never sees keystrokes, and never takes screenshots.**

"Paste" is inferred: Windows doesn't announce pastes, so the first field or cell edited in a *different* app within 90 seconds of a copy counts as the paste. That's exactly the copy-from-A-into-B pattern the detector looks for. Events from it are marked `inferred: true`.

Always skipped, whatever the settings: password managers (1Password, Bitwarden, LastPass, KeePass, and others), Windows sign-in and permission prompts, banking, investing, and patient-portal windows, the app's own pages, and anything on the participant's never-watch list (app names or websites).

## Install (participant)

1. Save `WorkflowDetective.exe` somewhere it will stay, like `Documents\Workflow Detective\`. Don't run it from inside a zip.
2. Double-click it. Until the exe is code-signed, Windows shows **"Windows protected your PC"**. Click **More info → Run anyway**. See *Before the pilot* below.
3. The setup page opens in the browser. Enter the company code and name, keep the schedule, tick consent, and click **Start the study**.
4. A magnifying-glass icon appears near the clock. It shows a **green dot** during watch hours. Right-click it for **Open my findings**, **Pause for 1 hour**, **Settings and privacy**, or **Quit**.
5. After consent, it starts with Windows automatically (per-user, no admin) until the study ends or they stop.

**To stop and delete everything:** right-click the icon → **Settings and privacy** → **Stop and delete everything** → right-click → **Quit** → delete the exe.

Data lives in `%LOCALAPPDATA%\WorkflowDetective\`: `kv.json` (settings + ratings), `events\YYYY-MM-DD.jsonl` (activity), and `log.txt` (errors, for troubleshooting). It's deleted automatically 14 days after the study ends.

The findings page, ratings, and **Save results file** work exactly as in the extension. Results files from the Windows app are marked `"source": "desktop"` and named `workflow-detective_windows_…json`.

## Using both

For someone who lives in Outlook and Excel *and* web apps, install both. The Windows app sees browser windows only by their titles and copies. The extension sees inside web pages. Ask them to include the activity log in both results files. The console then **combines the two files for that person** and re-analyzes them together, so it can catch things like "copying from Outlook desktop into a web CRM." It shows as one row marked *Browser + Windows*.

## Before the pilot

- **Sign the exe.** An unsigned app that watches windows and the clipboard will trigger SmartScreen warnings and may be flagged by antivirus or blocked by company IT. A code-signing certificate fixes most of this. Get it before installs, not after.
- **Talk to each company's IT if they have one.** Send them this file. The short version: per-user app, no admin, no drivers, no keyboard hooks, no screenshots, no network traffic except a local web page on `127.0.0.1`. Data stays on the PC until the employee chooses to send a results file.
- **Run the smoke test on one real Windows PC with Office** (see `WINDOWS_TESTING.md`). I built and tested this on Linux, where Windows' own notifications, Excel, and Outlook can't run.

## Known limits

- **Not yet run on real Windows.** Everything platform-independent is tested (see below). The Windows notification layer and the Excel/Outlook connections need the smoke test on a real PC before participants get it.
- **Field labels depend on the app.** Office, most standard Windows apps, and QuickBooks Desktop expose labels through accessibility. Some custom-drawn apps don't, and typing there is invisible (window switches and copies still work).
- **New Outlook** (the web-based one) has no object model, so you get window titles but not the selected email's subject. Classic Outlook works fully.
- **Remote desktop / Citrix:** only "Remote Desktop" is visible, not the apps inside the remote session.
- **File pickers count as uploads even if cancelled.**
- **Windows only.** Mac would need a separate app.

## What's tested, and where

| Test | Where | Result |
|---|---|---|
| 32 built-in self-checks (privacy redaction, app naming, recorder logic, local server security) | Linux (Mono) | All pass |
| Schedule matches the extension on 400 random cases, including across a daylight-saving change | Linux | Identical |
| Two simulated weeks of Outlook + Excel + QuickBooks Desktop + Teams through the real recorder → detector | Linux | Finds all 4 planted processes, nothing extra, no private data stored |
| Setup and findings pages served by the exe, driven in Chromium (13 checks) | Linux | All pass |
| Browser + Windows files combined in the console | Linux | One row, findings from both |
| Windows notifications, clipboard, files, Excel | **Real Windows**: `tests\windows-smoke.ps1` or the GitHub Actions workflow | **You need to run this** |

## Rebuilding

- **On Windows:** run `desktop\build.bat`. It uses the C# compiler built into Windows, nothing to install.
- **On Linux/Mac:** run `desktop/build.sh` (needs Mono).
- **On GitHub:** upload the project, and `.github/workflows/publish.yml` builds it on a real Windows machine, runs the self-checks and smoke test, and publishes it as the download participants get from their personal link.

## First run

When opened from anywhere else (usually Downloads), the app copies itself to `%LOCALAPPDATA%\Programs\WorkflowDetective\`, adds a **Workflow Detective** Start menu shortcut, and starts that copy, so the study survives a cleaned-out Downloads folder. No admin rights needed. If the participant's invite code is on the clipboard (the setup page copies it when they click Download), setup fills itself in. `--data` or `--port` (used by tests) skip the install step.
