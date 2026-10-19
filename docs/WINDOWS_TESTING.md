# Testing the Windows App on a Real PC (about 20 minutes)

Do this once on any Windows 10/11 PC with desktop Office before giving the app to participants. Your own laptop is fine.

## 1. Automatic smoke test (5 minutes)

1. Copy the whole `workflow-detective` folder to the PC.
2. Open PowerShell in that folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File desktop\tests\windows-smoke.ps1 -Excel
   ```
   Leave out `-Excel` if Office isn't installed. **Don't touch the mouse or keyboard while it runs** (about a minute). It opens Notepad and Excel by itself.
3. Every line should say **PASS**. It checks that the app starts, sees Notepad come to the front, records a copy as "a number", records typing as a field edit without storing the text, notices a new `.csv` in Downloads without storing its name, and, with `-Excel`, connects to Excel and records the edited column's heading ("Amount").

If anything fails, send me the full output and the `log.txt` from the data folder it prints at the end.

## 2. The real participant path (5 minutes)

Do this once the site is published (see `docs/LAUNCH_CHECKLIST.md`). In the invite tool, make a link for yourself with **Computer: Windows**, open it in Chrome or Edge, and click **Download for Windows**. Then check:

- [ ] The browser's "isn't commonly downloaded" and SmartScreen steps match what the page says.
- [ ] The setup page opens with **your name and company already filled in** (the app read the copied code).
- [ ] After **Start the study**, the magnifying glass appears near the clock.
- [ ] The app copied itself to `%LOCALAPPDATA%\Programs\WorkflowDetective\WorkflowDetective.exe` and the Start menu has **Workflow Detective**. Delete the downloaded file, sign out and back in: it should start again by itself.

## 2. Hands-on check with real apps (15 minutes)

Run `desktop\build\WorkflowDetective.exe`. Finish setup with **Same days every week** with every day ticked, **Watch from 12:00 am**, and **Until 11:00 pm**, so it's watching right now. Then do each row and look at **Open my findings → Your activity log**:

| Do this | You should see in the log |
|---|---|
| Click between Excel, Outlook, and Chrome | `Opened …` rows with each app and window title, numbers removed |
| In Outlook, click on a few emails | `Opened` rows in Outlook with the email subjects (numbers removed) |
| Copy an amount from an email, then type or paste it into an Excel cell under a heading | `Copied a number` in Outlook, `Pasted a number into "Amount"` in Excel, then `Filled in 1 field: Amount` |
| Type into a form in any Windows app (QuickBooks Desktop if you have it) | `Filled in N fields: Customer, Date…`, with labels only |
| Type into a password box | Counted as `(+1 sensitive, not named)` |
| Click Send, Save, or another button | `Clicked "Send"` |
| Save a `.csv` or `.pdf` into Downloads | `Downloaded a .csv file` |
| Open Spotify, or a site on your never-watch list | Nothing |
| Right-click the tray icon → Pause for 1 hour, then click around | Nothing new until you resume |
| Lock the screen for 3 minutes | An `Away from the computer` row |

Then check that **none of these appear anywhere in the log**: what you typed, cell values, email text, file names, or email addresses.

## 3. Things to note for the pilot

- How long SmartScreen or antivirus made you click through. This is why signing matters.
- Whether CPU stays low with the app running. Task Manager should show near 0%.
- Which of your apps showed field labels and which showed nothing when you typed. Each app is different.
