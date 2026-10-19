#!/usr/bin/env bash
# Builds build/WorkflowDetective.exe with Mono's C# compiler (runs on Windows' built-in .NET Framework 4.x).
set -euo pipefail
cd "$(dirname "$0")"
EXT=../extension
rm -rf build && mkdir -p build/ui/lib build/ui/icons
cp $EXT/onboarding.html $EXT/onboarding.js $EXT/report.html $EXT/report.js $EXT/ui.css build/ui/
cp $EXT/lib/detector.js $EXT/lib/settings.js $EXT/lib/invite.js build/ui/lib/
cp $EXT/icons/48.png build/ui/icons/
cp ui/wd-desktop.js build/ui/ && cp ui/lib/db.js build/ui/lib/db.js    # desktop versions
RES=""
while IFS= read -r f; do rel=${f#build/}; RES="$RES -resource:$f,$rel"; done < <(find build/ui -type f | sort)
mcs -langversion:5 -target:winexe -platform:anycpu -optimize+ -nowarn:618 \
  -out:build/WorkflowDetective.exe -win32icon:app.ico \
  -r:System.dll -r:System.Core.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:Accessibility.dll -r:Microsoft.CSharp.dll \
  $RES src/*.cs
ls -la build/WorkflowDetective.exe
