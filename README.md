# Workflow Detective: Pilot Build (v0.2)

> **Live:** [Invite tool](https://tejas957.github.io/workflow-detective/site/invite.html) · [Client guide](https://tejas957.github.io/workflow-detective/site/guide.html) · [Results console](https://tejas957.github.io/workflow-detective/console/) · [Downloads](https://github.com/tejas957/workflow-detective/releases/tag/pilot)
>
> **Next steps: [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).** About 5 minutes per company. Participants just open a personal link. Every change to `main` rebuilds, tests and republishes everything (Actions → Publish pilot).

Finds the repetitive work in someone's week **without them having to describe it**. A browser extension watches how a person works on a rotating 3-days-a-week schedule for 2 weeks. It logs only the *shape* of their actions and turns repeated patterns into a plain-English list of processes worth automating, each with evidence and a suggested approach.

The point: the consultant no longer spends hours interviewing someone who can't name their problem. The tool finds the problem, and the participant confirms or rejects each finding.

```
 participant's browser                                         pilot team
 ┌──────────────────────────────────────────────┐              ┌────────────────────┐
 │ content.js ─┐                                 │              │                    │
 │ tabs/idle ──┼─► background.js ─► local log ─► report.html ──► results .json ─────► console │
 │ downloads ──┘   (schedule +       (IndexedDB)  (detector runs, │  (participant      │ (all participants,│
 │                 privacy filter)                participant    │   chooses to send) │  accuracy, briefs)│
 │                                                rates findings)│                    │                    │
 └──────────────────────────────────────────────┘              └────────────────────┘
```

Nothing leaves the participant's computer until they press **Save results file** and send it to you.

## What's in the box

| Folder | What it is |
|---|---|
| `site/` | **What participants and you open:** the personal-link setup page (`index.html`), your invite tool (`invite.html`), the privacy policy, and `config.json` (your contact details and, later, the Chrome Web Store link). Published automatically by GitHub. |
| `.github/workflows/publish.yml` | **One-click publishing:** builds and tests all three versions on real Windows and Mac machines, then puts the downloads and the site online. |
| `extension/` | The Chrome/Edge extension (Manifest V3). Load this folder. |
| `desktop/` | **The Windows app** (`build/WorkflowDetective.exe`): sees every app, including Excel, Outlook, and QuickBooks Desktop. Same log format, pages, and detector. See `docs/WINDOWS_APP.md`. |
| `mac/` | **The Mac app** (menu bar, macOS 12+): sees every app. Its recording logic is JavaScript (tested here); a thin Swift layer has to be built on a Mac or by the GitHub workflow. See `docs/MAC_APP.md`. |
| `docs/LAUNCH_CHECKLIST.md` | **Start here.** Put it online, submit the extension, invite people. |
| `docs/CHROME_WEB_STORE.md` + `store/` | Every Chrome Web Store field ready to paste, plus the icon and screenshots. |
| `docs/guides/` | **Guides:** one per version for participants (backup; the personal link walks them through it), plus how the three versions fit together. |
| `extension/lib/detector.js` | The pattern-detection engine. Same file runs in the extension, the console, and Node tests. |
| `console/index.html` | Pilot console. Open it in a browser and drop in results files. Also published as a private web link. |
| `docs/PILOT_RUNBOOK.md` | How to run the 10-company pilot: consent, install, schedule, closeout, metrics. |
| `docs/PARTICIPANT_NOTICE.md` | The one-page notice to give each participant and their manager (covers all three versions). |
| `docs/WINDOWS_APP.md` / `docs/WINDOWS_TESTING.md` | How the Windows app works and how to test it on a real PC before participants get it. |
| `test/` | Synthetic-week generator, detector tests, robustness test, real-browser end-to-end test. |
| `samples/` | Sample results files (simulated people, marked as samples) and screenshots. |

## What it records, and what it never records

| Records | Never records |
|---|---|
| Which work app is open and for how long (`QuickBooks › /app/invoice`) | What anyone types |
| Page titles with **numbers, emails, and phone numbers stripped** (can be turned off) | Email, message, or document text |
| *That* something was copied or pasted, and its kind (number, date, text). Not the content. | Clipboard contents |
| Names of form fields filled in (`Customer`, `Due date`). Can be turned off. | Field values, passwords, card/bank/SSN fields (counted as "sensitive", never named) |
| Downloads and uploads by file type (`.csv`) | File names or contents |
| Button labels clicked (`Save and send`) | Screenshots or recordings |
| | Anything outside the browser, in incognito, outside watch hours, or on blocked sites (social, banking, health by default) |

The end-to-end test checks this directly. It types a secret value, a password, and copies a dollar amount, then confirms none of them appear anywhere in storage.

## What it detects

| Pattern | What triggers it | Typical fix it suggests |
|---|---|---|
| **Copying between apps** | Copy in app A → paste in app B, in bursts, ≥5 times (or ≥3 across 2+ days) | Integration; **AI extraction** if the source is email or a document |
| **Same form, again** | The same form screen filled in ≥4 times across 2+ days; notes which app was open just before | Auto-fill / data sync; **AI fills the form** if the source is email or a document |
| **Writing similar messages** | Repeated replies in email or helpdesk tools | **AI drafts, you send** |
| **Moving files by hand** | Download from A → upload to B within 30 min, ≥3 times | File sync |
| **Regular export** | Same file type downloaded from the same app ≥3 times | Scheduled report |
| **Back-and-forth checking** | ≥6 quick switches between two apps with no copying, ≥3 times | Automatic matching / pull data into one place |
| **Repeated routine** | The same multi-step, cross-app sequence ≥3 times across 2+ days | One workflow runs the steps |

Each finding gets: count, days seen, minutes each, a projected weekly time (from watch days to a 5-day week), regularity ("usually around 9:00 am"), a confidence level, an automatability score, and a brief you can paste into an AI assistant or a proposal.

Chat apps (Slack, Teams, etc.) count as communication, not process. Typing or pasting into them is never flagged on its own. When two detectors fire on the same real-world process (download a résumé + type the candidate into the ATS), they're merged into one finding.

## How participants get set up

Each person gets an email from the invite tool with **a personal link**. That page:

1. greets them by name (the link carries their company, name, start date and hours),
2. detects their computer and browser,
3. asks at most one question ("websites, programs, or a mix?"),
4. shows only their steps, one big button each: **Add to Chrome/Edge** and/or **Download for Windows/Mac**,
5. hands their details to whatever they install, so setup is already filled in. They tick **I agree** and click **Start the study**.

The extension is installed from the Chrome Web Store (unlisted). The Windows and Mac apps download from the GitHub release the publish workflow creates. Company IT can also force-install the extension through Google Admin or Edge policy (`ExtensionInstallForcelist`) once it's in the store.

## Run the tests

```bash
node test/detector.test.js        # planted processes in 3 simulated roles are all found; known false positives are not
node test/robustness.test.js      # 25 random weeks × 3 roles + 25 "no real process" people
node test/invite.test.js          # invite codes: round trip, damaged codes rejected
NODE_PATH=$(npm root -g) node test/site.test.js   # setup page on every computer/browser + the invite tool (needs playwright)
node test/build-console.js        # rebuild console/index.html after changing the detector
NODE_PATH=$(npm root -g) xvfb-run -a node test/e2e.js   # real Chromium + the extension (needs playwright)
desktop/build.sh && mono desktop/build/WorkflowDetective.exe --selftest   # Windows app self-checks (any OS, needs Mono)
node mac/tests/core.test.js && NODE_PATH=$(npm root -g) node mac/tests/pages.test.js   # Mac recording core + pages (any OS)
bash mac/build-mac.sh && bash mac/tests/mac-smoke.sh    # on a real Mac
powershell -ExecutionPolicy Bypass -File desktop\tests\windows-smoke.ps1 -Excel   # on a real Windows PC
```

Current results: 250/250 planted processes found, 0 extra findings, 0 findings for people with no real process; 50/50 setup-page checks, 25/25 extension checks, 31 + 16 Windows checks, 21 + 15 Mac checks. **These numbers come from simulated weeks I generated, so they show the engine works as designed, not how accurate it is on real people.** Real accuracy is what the pilot measures, through participant ratings.

## Known limitations (say these out loud to the VC)

- **The extension sees only the browser.** For desktop apps use the **Windows app** (`desktop/`) or the **Mac app** (`mac/`). Neither has run on its real OS yet: the Windows app needs the 20-minute check in `docs/WINDOWS_TESTING.md`, and the Mac app still needs its first compile (GitHub workflow or `mac/build-mac.sh`) plus `mac/tests/mac-smoke.sh`.
- **The extension needs Chrome or Edge.** Safari and Firefox users need the Mac or Windows app instead.
- **Time estimates run low.** They count time between first and last step, not reading or thinking time.
- **Some apps hide copy contents** (Google Sheets cells, canvas editors), so the "kind" may show as "something". The transfer still gets detected.
- **Thresholds are tuned on simulated data.** Expect misses and some noise on real people. Participant ratings will tell you which detectors to tighten.
- **No AI in the loop yet.** Findings use rules and plain-English templates. That keeps raw activity on the device and makes results explainable, but naming the business process ("this is invoice reconciliation") is the obvious next step.

## What's next after the pilot

1. Tune thresholds per detector using the accuracy ratings from the console.
2. Add an AI step that takes **only the finding summaries** (never raw logs), names the business process, and drafts the automation spec or a Zapier/Make recipe. Do this after companies agree to it in writing.
3. Sign the Windows app (code-signing certificate) and sign and notarize the Mac app (Apple Developer Program).
4. A manager view that rolls findings up across a team (only with participant opt-in).
