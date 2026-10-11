# Launch Checklist

What you do once to put Workflow Detective online, and how to invite people after that. About 30 minutes, plus a few days waiting on Google to review the extension. You won't need a terminal or any code.

Once it's set up, a participant's whole experience is: **open their personal link → click one or two big buttons → tick "I agree" → Start.** Their details fill in by themselves. The page works out their computer and browser, so they only see the steps that apply to them.

---

## Part 1: Put it online (once, about 15 minutes)

Free GitHub hosting gives you three things: the participants' setup page, your invite tool, and the downloads for Windows and Mac. Every time you upload a change, GitHub rebuilds, re-tests and republishes everything by itself.

1. **Make a GitHub account** at github.com, if you don't have one.
2. **Create a repository.** Click **+** (top right) → **New repository**.
   - Name: `workflow-detective`
   - Visibility: **Public**. Free hosting needs this. The code holds no participant data; that only ever lives on participants' computers.
   - Click **Create repository**.
3. **Upload the files.** On the new repository's page, click **uploading an existing file**. On your computer, unzip `workflow-detective-pilot.zip` and open its **github-upload** folder. Select **everything inside it** and drag it all onto the GitHub page. That includes the hidden `.github` folder: on a Mac, press **⌘⇧.** in Finder to show it; on Windows, turn on **View → Show → Hidden items**. Click **Commit changes**.
   - If the `.github` folder didn't come along (some browsers skip hidden folders): click **Add file → Create new file**, type `.github/workflows/publish.yml` as the name, paste in that file's contents, and click **Commit changes**.
4. **Turn on the website.** Go to **Settings → Pages**, and under **Build and deployment → Source** choose **GitHub Actions**. That's the only setting.
5. **Run it.** Go to the **Actions** tab, click **Publish pilot** on the left, then **Run workflow → Run workflow**. It takes about 10 minutes: it builds the Windows app and the Mac app, tests everything, and publishes.
6. **Open your links.** Click the finished run. Its summary lists:
   - **Invite tool:** `https://<your-github-name>.github.io/workflow-detective/invite.html` (bookmark this)
   - **Setup page:** `https://<your-github-name>.github.io/workflow-detective/` (participants land here through their personal links)
   - Whether the Windows app, Mac app and extension are ready

**If the Mac app shows "not available yet":** it has never been built on a real Mac before, so the first build may hit a compile error. Everything else still publishes, and Mac users are offered the browser extension (once it's approved) or told to contact you. Open the failed **Mac app** step, copy the red error text, and paste it to Claude (or whoever maintains the code) to fix.

## Part 2: Chrome Web Store (once; do this the same day, since review takes days)

Follow `docs/CHROME_WEB_STORE.md`. It has every field's text ready to paste, plus the screenshots. When Google approves it:

1. In your GitHub repository, open `site/config.json` and click the pencil icon.
2. Paste the store link between the quotes after `"chromeStoreUrl":`.
3. Click **Commit changes**. About 5 minutes later the setup page starts offering **Add to Chrome / Add to Edge**.

Until then, everyone gets the Windows or Mac app, which also sees websites (by window title, less detail than the extension).

## Part 3: Check it yourself (15 minutes, before inviting anyone)

1. In the invite tool, add yourself with your company set to `TEST`.
2. **Copy link**, open it on your own computer, and go through the steps exactly as a participant would.
3. Check that your details fill themselves in, the icon appears (near the clock on Windows, in the menu bar on Mac), and after about an hour of normal work **Open my findings → Your activity log** shows what you've been doing.
4. On Windows, also do the short checks in `docs/WINDOWS_TESTING.md`. On a Mac, check that the Accessibility step works.
5. When you're done, click **Settings and privacy → Stop and delete everything**.

## Part 4: Invite each company (5 minutes per company)

1. Get the company's written OK and the participant list (see `docs/PILOT_RUNBOOK.md`, "Before anyone installs").
2. Open the **invite tool**. Set the start date (it defaults to next Monday) and the work hours.
3. Add people. Either type them in, or use **Paste a list** to paste rows from a spreadsheet: *Name, Company, Computer, Works in*. Computer and "works in" are optional. If you leave them blank, the person's setup page works out their computer itself and asks them one question.
4. For each person, click **Copy email** and paste it into a new email to them. Attach their filled-in consent notice (**Copy consent notice**), or use the signed one from the company.
   - **Copy all emails** gives you every email at once, if you'd rather mail-merge.
   - **Copy as a spreadsheet** gives you a tracking sheet with everyone's link.
5. Optional: book a 15-minute call with anyone likely to struggle, and open their link together.

The invite tool remembers your list in your browser, so you can come back to it on the same computer.

## Part 5: During and after

- Each person's personal-link page shows them what's done. If someone gets stuck, ask them to open their link again and tell you which step number they're on.
- At the end, run the closeout call from `docs/PILOT_RUNBOOK.md`. Participants click **Save results file** and send it to you. Drop all the files into the console (`console/index.html`).

---

## Optional: remove the security warnings (recommended before a bigger rollout)

Participants currently see a one-time warning when they open the apps, because the apps aren't signed yet. The setup page walks them through it, but signing removes it.

| | What to get | What to do |
|---|---|---|
| **Windows** ("Windows protected your PC") | A code-signing certificate from a certificate authority | Sign `WorkflowDetective.exe` with `signtool` before uploading it, or have the GitHub workflow do it (ask Claude to add it) |
| **Mac** ("Apple could not verify…") | Apple Developer Program membership → a **Developer ID Application** certificate | Add the six secrets listed at the top of `.github/workflows/publish.yml` under **Settings → Secrets and variables → Actions**. The next run signs and notarizes it by itself. |

## What participants see

| Their computer | Works mostly in | Steps on their page |
|---|---|---|
| Windows or Mac, Chrome or Edge | Websites | Add the extension (1 click + 1 confirm) |
| Windows | Programs (Outlook, Excel…) | Download the Windows app → open it → Start |
| Mac | Programs | Download the Mac app → drag to Applications → allow Accessibility → Start |
| Either, Chrome or Edge | A mix, or not sure | Both of the above, in order |
| Safari or Firefox | Anything | The Windows or Mac app (it covers websites too) |
| Phone or tablet | — | "Open this link on your work computer" |

Every path ends at the same place: their details are filled in, and they tick **I agree** and click **Start the study**.

