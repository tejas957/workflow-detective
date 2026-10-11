#!/usr/bin/env bash
# Mac smoke test: runs the real app for ~30 seconds against a throwaway data folder while switching apps,
# copying, and saving a file to Downloads, then checks what was (and wasn't) recorded.
#   bash mac/tests/mac-smoke.sh            (after mac/build-mac.sh; don't touch the Mac while it runs)
# Window titles and field labels need the Accessibility permission, so they're only checked if it's granted.
set -u
cd "$(dirname "$0")/../.."
BIN="mac/build/Workflow Detective.app/Contents/MacOS/WorkflowDetective"
echo "== built-in self-checks"; "$BIN" --selftest || { echo "self-checks failed"; exit 1; }
DATA=$(mktemp -d)
TODAY=$(date +%F)
cat > "$DATA/kv.json" <<JSON
{"settings":{"consented":true,"startDate":"$TODAY","weeks":1,"scheduleMode":"fixed","days":[0,1,2,3,4,5,6],"hourStart":0,"hourEnd":24,"captureTitles":true,"captureFieldLabels":true,"blocked":[]}}
JSON
echo "== running the app for 30 seconds (data in $DATA)"
"$BIN" --data "$DATA" --exit-after 30 &
PID=$!
sleep 5
open -a TextEdit; sleep 3
printf 'SMOKE-1200.55' | pbcopy; sleep 2
osascript -e 'tell application "Finder" to activate'; sleep 3
F="$HOME/Downloads/wd-smoke-$RANDOM.csv"; echo "a,b" > "$F"; sleep 3
open -a TextEdit; sleep 3
wait $PID
rm -f "$F"; osascript -e 'tell application "TextEdit" to quit saving no' >/dev/null 2>&1
python3 - "$DATA" <<'PY'
import json, glob, sys, os
d = sys.argv[1]
ev = [json.loads(l) for f in sorted(glob.glob(d + "/events/*.jsonl")) for l in open(f) if l.strip()]
raw = "".join(open(f).read() for f in glob.glob(d + "/events/*.jsonl"))
log = open(d + "/log.txt").read() if os.path.exists(d + "/log.txt") else ""
apps = sorted({e.get("app") for e in ev if e.get("type") == "view"})
req = [
  ("app started and logged", "started v" in log),
  ("switching to TextEdit recorded", any(e.get("type") == "view" and e.get("app") == "TextEdit" for e in ev)),
  ("switching to Finder recorded", any(e.get("type") == "view" and e.get("app") == "Finder" for e in ev)),
  ("copy recorded by type only", any(e.get("type") == "copy" and e["d"].get("kind") == "text" for e in ev)),
  ("copied text never stored", "SMOKE-1200" not in raw),
  ("file name never stored", "wd-smoke-" not in raw),
]
opt = [("new file in Downloads recorded (needs Downloads access)", any(e.get("type") == "download" and e["d"].get("ext") == "csv" for e in ev)),
       ("window titles recorded (needs Accessibility)", any(e.get("title") for e in ev))]
bad = 0
for n, ok in req:
    print(("PASS " if ok else "FAIL ") + n); bad += 0 if ok else 1
for n, ok in opt:
    print(("PASS " if ok else "SKIP ") + n)
print(f"\n{len(ev)} events; apps seen: {', '.join(a for a in apps if a)}")
if "error" in log.lower(): print("log.txt mentions errors:\n" + "\n".join(l for l in log.splitlines() if "error" in l.lower())[:2000])
print(f"{bad} required check(s) failed" if bad else "All required Mac checks passed")
sys.exit(1 if bad else 0)
PY
