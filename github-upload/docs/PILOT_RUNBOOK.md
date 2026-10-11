# Pilot Runbook: 10 Companies, 2 Weeks

**Goal:** show that Workflow Detective finds real, automatable processes people couldn't name themselves, with much less consulting time than a normal discovery engagement.

## Who to recruit

- **10 companies, 1 participant each** (up to 3 is fine). Small and mid-size businesses work best.
- **Pick admin-heavy, browser-based roles:** operations, accounts receivable/payable, bookkeeping, recruiting coordination, customer support, e-commerce ops, sales ops.
- **You don't have to pick a version for anyone.** Each person gets a personal link from the invite tool (`docs/LAUNCH_CHECKLIST.md`). Their setup page detects their computer and browser and asks one question if needed ("websites, programs, or a mix?"), then shows only their steps:
  - Mostly web apps (Gmail, QuickBooks Online, Salesforce, Shopify) → **browser extension**
  - Mostly desktop apps (Outlook, desktop Excel, QuickBooks Desktop) → **Windows app** or **Mac app**
  - A mix → both. The console combines the two results files into one person.
- **Use a company computer, not a personal one.**

## Before anyone installs: consent checklist

This isn't legal advice. Have counsel look over the notice once before the pilot starts.

- [ ] **Written OK from the company** (an email from an owner or exec is fine) that names the participant, the dates, and what's recorded. Send them `PARTICIPANT_NOTICE.md`.
- [ ] **The participant agrees individually.** They read the notice and tick consent on the setup page. Never install it on someone who hasn't agreed.
- [ ] **Monitoring-notice laws.** Some US states require employers to give written notice before electronic monitoring (New York, Connecticut, and Delaware have laws like this). The company's written OK plus the notice should cover it. Ask counsel if any participant is in those states.
- [ ] **EU or UK participants** need a GDPR lawful basis and more paperwork. Easiest to keep this pilot US-only.
- [ ] **Give each company a code** (e.g. `NORTHLINE`) and keep a sheet of company → participant → dates → contact.

## Timeline

| When | What | Time |
|---|---|---|
| Week 0 (by Thu) | Site published and checked yourself (`LAUNCH_CHECKLIST.md`), store listing live, Windows app tested on a real PC (signing recommended), Mac build green and tested on a real Mac (notarizing recommended), IT contacted where needed, consent done, invite emails ready | — |
| **Thu/Fri before** | **Send the invite emails.** Optional 10-minute call for anyone who needs it (below). Start date = the coming Monday. | 0–10 min |
| Week 1 Mon / Wed / Fri | Watch days (automatic, 8 am–6 pm by default) | 0 |
| Week 1 Fri afternoon | **Check-in text or email:** "Is the icon showing ON? Open *My findings*. Anything look off?" | 5 min |
| Week 2 Tue / Wed / Thu | Watch days (the rotation covers every weekday across the two weeks) | 0 |
| Week 3 Mon–Tue | **Closeout call**, 30 min: walk through findings together, they rate each one, they save and send the results file | 30 min |
| Week 3 | Load all files into the console, write a 1-page readout per company | 30 min each |

**Total consulting time per company: about 1.5 hours.** Compare that to a normal discovery process (interviews, shadowing, write-up), which usually takes several hours to days. That comparison is your headline.

## Install (no call needed for most people)

Send each person the email from the invite tool. It has their personal link, and their details fill in by themselves. Most people finish in about 5 minutes on their own. The participant guides in `docs/guides/` cover each path in more detail.

**Optional 10-minute call** for anyone likely to struggle:

1. "This finds the repetitive work in your week so we can automate it. You don't need to change anything about how you work."
2. "Open the link in my email on your work computer." Have them share their screen and click the big buttons in order. The page handles the rest.
3. When the setup page opens with their name on it, read **What it records / never records** out loud together. Point out *pause* and *never watch this site*.
4. They tick **I agree** and click **Start the study**. The link page shows a green check for each finished step.
5. Show them the icon. Extension: puzzle-piece menu → pin; it shows **ON** during watch hours. Windows: the magnifying glass near the clock (drag it out of the ^ area if hidden). Mac: the magnifying glass in the menu bar.
6. "On the last day, you'll open *My findings*, tell us which ones are right, and send us the file. We'll do that together."

**If someone's stuck:** ask them to open their link again and tell you which step number they're on. If their details didn't fill in, they click **Copy my code again** on the link page and paste it on the setup page.

## Closeout call (30 minutes)

1. Participant opens the toolbar icon (Windows app: right-click the tray icon) → **Open my findings**, and shares their screen.
2. For each finding, ask: *"Is this something you do?"* They click **Yes**, **Yes and I hadn't thought of automating it**, or **Not really**, and add a note if it's wrong.
3. Ask the five closeout questions:
   - "Before this, could you have listed these processes yourself?" (Yes / some / no)
   - "Which one would you most want gone?"
   - "Did anything feel uncomfortable about being watched?"
   - "Would your company pay to have the top one automated? Roughly what's it worth?"
   - "Would you use this again, or recommend it to a coworker?" (0–10)
4. They tick **Also include my activity log** (optional, it helps tune detection), then click **Save results file** and email or upload it to you.
5. Remind them that everything on their computer is deleted automatically 14 days after the study ends. They can also delete now or uninstall.

## Metrics to report

Suggested targets are guesses to agree with the mentor before the pilot starts, not promises.

| Metric | How to measure | Suggested target |
|---|---|---|
| **Accuracy** (precision) | Console tile: rated findings marked Yes ÷ all rated | ≥ 70% |
| **New to them** (the discovery claim) | Console tile: "Yes, hadn't thought of automating" ÷ accurate | ≥ 30% |
| **Couldn't have listed it themselves** | Closeout question 1 | Most say "some" or "no" |
| Repeated work found | Console: median per person per week | ≥ 1 hour |
| Findings per person | Console | 3–6 |
| Coverage | Watch days completed ÷ planned (participants table) | ≥ 5 of 6 |
| Consulting time per company | Your own log (install + check-in + closeout + readout) | ≤ 2 hours |
| Comfort | Opt-outs, pauses, closeout question 3 | 0 opt-outs |
| Pull | Closeout questions 4–5 | Note any dollar figures |

**Also track misses.** In the closeout, ask "Is there something repetitive you do that we didn't find?" Each answer is a recall miss. It tells you which detector to build or loosen next.

## Handling the results files

- The files contain finding summaries and ratings. They include the activity log only if the participant opted in, and even then it never contains anything typed.
- Keep them in one access-restricted folder. Delete them 30 days after the pilot unless a company asks you to keep theirs for an automation project.
- Load them into the console. It reads files in the browser and never uploads them.

## If something goes wrong

| Problem | Fix |
|---|---|
| No ON badge during watch hours | Check the start date and hours in Settings. Make sure the browser isn't in incognito. |
| "No activity logged" | They're working outside Chrome/Edge, or the extension was removed. Ask what apps they use. |
| A finding exposes something private | Have them delete those log lines or block that site in *My findings → Your activity log*, then re-save the results file. |
| Participant wants out | Settings → **Stop and delete everything**, then remove the extension. Note it as an opt-out. |
