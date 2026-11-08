#!/bin/bash
# Builds "Screen Buddy.app" and a zip of it from source. Needs macOS with Xcode (or its command line tools).
#   VERSION=0.1.0 scripts/build_app.sh        ->  dist/Screen Buddy.app, dist/ScreenBuddy-mac-0.1.0.zip
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-0.1.0}"
OUT="${OUT:-dist}"
APP="$OUT/Screen Buddy.app"

swift build -c release --arch arm64 --arch x86_64
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/ScreenBuddy"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/buddies"
cp "$BIN" "$APP/Contents/MacOS/ScreenBuddy"

# The sample buddies are the web player's: one set of characters for every platform.
for d in ../web/buddies/*/; do cp -R "$d" "$APP/Contents/Resources/buddies/$(basename "$d")"; done

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Screen Buddy</string>
  <key>CFBundleDisplayName</key><string>Screen Buddy</string>
  <key>CFBundleIdentifier</key><string>ai.illyrobotic.screenbuddy.mac</string>
  <key>CFBundleExecutable</key><string>ScreenBuddy</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# Ad-hoc signature: enough to run on the machine that built it. Other Macs show the "unidentified developer" prompt
# until the app is signed with a Developer ID and notarised.
codesign --force --deep --sign - "$APP"

ZIP="$OUT/ScreenBuddy-mac-$VERSION.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "Built $APP"
echo "Zip   $ZIP"
