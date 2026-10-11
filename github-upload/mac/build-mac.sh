#!/usr/bin/env bash
# Builds build/Workflow Detective.app (Apple Silicon + Intel) on a Mac with Xcode or the Command Line Tools.
#   ./build-mac.sh                       ad-hoc signed (fine for testing; Gatekeeper will warn)
#   SIGN_ID="Developer ID Application: Your Name (TEAMID)" ./build-mac.sh    signed for distribution (then notarize)
set -euo pipefail
cd "$(dirname "$0")"
VERSION=0.1.0
APP="build/Workflow Detective.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/ui/lib" "$APP/Contents/Resources/ui/icons" "$APP/Contents/Resources/core"

FLAGS=(-O -swift-version 5 -parse-as-library -framework AppKit -framework WebKit -framework JavaScriptCore -framework ApplicationServices -framework ServiceManagement)
swiftc "${FLAGS[@]}" -target arm64-apple-macos12.0  -o build/wd-arm64  Sources/*.swift
swiftc "${FLAGS[@]}" -target x86_64-apple-macos12.0 -o build/wd-x86_64 Sources/*.swift
lipo -create -output "$APP/Contents/MacOS/WorkflowDetective" build/wd-arm64 build/wd-x86_64
rm build/wd-arm64 build/wd-x86_64

sed "s/__VERSION__/$VERSION/" Info.plist > "$APP/Contents/Info.plist"
cp AppIcon.icns "$APP/Contents/Resources/"
EXT=../extension
R="$APP/Contents/Resources"
cp $EXT/onboarding.html $EXT/onboarding.js $EXT/report.html $EXT/report.js $EXT/ui.css "$R/ui/"
cp $EXT/lib/detector.js $EXT/lib/settings.js $EXT/lib/invite.js "$R/ui/lib/"
cp $EXT/icons/48.png "$R/ui/icons/"
cp ../desktop/ui/lib/db.js "$R/ui/lib/db.js"
sed "s/__WD_VERSION__/$VERSION/" ui/wd-mac.js > "$R/ui/wd-mac.js"
cp core/schedule.js core/recorder.js "$R/core/"

if [ -n "${SIGN_ID:-}" ]; then TS=--timestamp; else TS=--timestamp=none; fi   # notarization needs a secure timestamp
codesign --force --deep --options runtime $TS --sign "${SIGN_ID:--}" "$APP"
(cd build && ditto -c -k --keepParent "Workflow Detective.app" "WorkflowDetective-mac-$VERSION.zip")
echo "Built $APP and build/WorkflowDetective-mac-$VERSION.zip"
