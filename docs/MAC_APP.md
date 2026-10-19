# Workflow Detective for Mac

A menu bar app for macOS 12 and newer (Apple Silicon and Intel). It sees every app, writes the same activity log as the other versions, and shows the same setup and findings pages in its own window. Results files work in the console unchanged and are marked `"source": "desktop", "os": "mac"`.

## How it's built

| Part | Language | Where it runs | Tested here? |
|---|---|---|---|
| Recording core: what counts as a copy, paste or field edit, privacy redaction, app names, never-watch rules | JavaScript (`mac/core/recorder.js`) | Inside the app, in Apple's built-in JavaScriptCore | **Yes**: 21 checks in Node, including two simulated weeks through the shared detector |
| Watch schedule | JavaScript, generated from the extension's own `settings.js` (`mac/core/schedule.js`) | Same | Same code as the extension |
| Setup and findings pages | The extension's pages + `mac/ui/wd-mac.js` bridge | In a WKWebView window | **Yes**: 12 checks in Chromium with the Mac bridge emulated |
| Menu bar, macOS sensors, storage, window, save dialog | Swift (`mac/Sources/*.swift`, about 720 lines) | Native | **Parsed only.** It must be compiled and tested on a Mac. |

Keeping the logic in JavaScript means the part most likely to have bugs is the part that could be tested here. The Swift layer only gathers signals and passes them on.

## What it watches, and how

| Signal | macOS source | What's kept |
|---|---|---|
| App in front | NSWorkspace (no permission needed) | App name |
| Window title | Accessibility: focused window's title | Title with numbers/emails removed |
| Field edits | Accessibility: focused text field, polled every ¾ second; its character count is compared (`AXNumberOfCharacters`, so the text usually isn't read at all) | The field's label. Secure (password) fields are counted, never named. |
| Copying | Clipboard change counter + the **types** on the clipboard | Kind only: text, cells, file, link, image. **The clipboard contents are never read.** That also avoids the clipboard-privacy alerts Apple is adding to macOS. |
| Paste (inferred) | First field edit in another app within 90 s of a copy; if the app doesn't expose fields (Excel's grid, for example), spending 2+ seconds in another app after a copy | Marked `inferred: "edit"` or `inferred: "switch"` |
| New files | Downloads folder | File type only |
| Idle, lock, sleep | Input idle time, screen-lock and sleep notifications | "Away" markers |

**Never:** keyboard monitoring, screenshots, screen recording, clipboard contents, or file names. Always skipped: password managers (1Password, Bitwarden, LastPass, KeePassXC, Dashlane, Apple Passwords), Keychain, macOS security prompts, banking and health windows, and the never-watch list.

**Permissions it asks for:** Accessibility (System Settings → Privacy & Security → Accessibility), and access to the Downloads folder (a one-time macOS prompt). Without Accessibility it still records app switches, copies and downloads, but not titles or fields.

Data lives in `~/Library/Application Support/WorkflowDetective/` with the same layout as Windows (`kv.json`, `events/*.jsonl`, `log.txt`). It's deleted automatically 14 days after the study ends, or immediately with **Stop and delete everything**. After consent it registers itself to open at login (macOS 13+) and removes that when stopped.

## Known limits

- **Not compiled yet.** This workspace has no Swift compiler. Expect possibly a round of build fixes on the first real build. The **Publish pilot** GitHub workflow shows the errors (the rest still publishes); paste them to Claude to fix.
- **No button-click events** on Mac (no reliable way to observe them without hooks), so routines that depend on clicks show up less.
- **Excel for Mac:** workbook names from window titles, but not sheet or column headings. Transfers into Excel are still caught through copy-then-switch.
- **Outlook for Mac:** subjects only for opened message windows, not the selected message in the list.
- **Copy-then-switch is a weaker signal** than seeing the paste. It could credit a paste to an app the person only glanced at. The detector needs repeated bursts between the same two apps before it reports a finding, which filters most of that out.
- **Unsigned builds** need **Open Anyway** in System Settings on recent macOS, and the Accessibility permission resets with each new unsigned build.

## Build, test, sign

See `guides/pilot-team-setup.md` → *Mac app*. Short version:

```bash
bash mac/build-mac.sh            # on a Mac with Xcode or Command Line Tools
bash mac/tests/mac-smoke.sh      # self-test + 30-second real run
node mac/tests/core.test.js      # recording core (any OS)
NODE_PATH=$(npm root -g) node mac/tests/pages.test.js   # pages with the bridge emulated (any OS)
```

After changing `extension/lib/settings.js`, run `node mac/tools/make-schedule.js` so the Mac app gets the same schedule.
