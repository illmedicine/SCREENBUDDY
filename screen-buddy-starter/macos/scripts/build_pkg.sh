#!/bin/bash
# Builds the Mac installer from dist/Screen Buddy.app (run scripts/build_app.sh first):
#   VERSION=0.1.0 scripts/build_pkg.sh   ->  dist/ScreenBuddy-Mac-Installer-0.1.0.pkg
#
# The installer is "for me only": it installs into the user's own ~/Applications, so it never asks for an
# administrator password, and the app can update itself there later. At the end it opens Screen Buddy.
# Test it without a GUI (no sudo):  installer -pkg dist/ScreenBuddy-Mac-Installer-0.1.0.pkg -target CurrentUserHomeDirectory
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-0.1.0}"
OUT="${OUT:-dist}"
APP="$OUT/Screen Buddy.app"
ID="ai.illyrobotic.screenbuddy.mac.pkg"
[[ -d "$APP" ]] || { echo "Build the app first: scripts/build_app.sh"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/root" "$WORK/scripts"
ditto "$APP" "$WORK/root/Screen Buddy.app"

cat > "$WORK/scripts/postinstall" <<'SH'
#!/bin/bash
# For a per-user install this runs as the user. Start the app, except during command-line installs (tests).
[[ -n "${COMMAND_LINE_INSTALL:-}" ]] && exit 0
app="$2/Screen Buddy.app"
[[ -d "$app" ]] || app="$HOME/Applications/Screen Buddy.app"
/usr/bin/open "$app" >/dev/null 2>&1 || true
exit 0
SH
chmod +x "$WORK/scripts/postinstall"

# Install exactly where we say: don't "upgrade" some other copy of the app found elsewhere on the disk.
pkgbuild --analyze --root "$WORK/root" "$WORK/component.plist"
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$WORK/component.plist"

pkgbuild --root "$WORK/root" --component-plist "$WORK/component.plist" --identifier "$ID" --version "$VERSION" \
  --install-location "/Applications" --scripts "$WORK/scripts" "$WORK/ScreenBuddy.pkg"

# enable_currentUserHome only: "/Applications" above becomes ~/Applications and no password is needed.
cat > "$WORK/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Screen Buddy</title>
  <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
  <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
  <volume-check><allowed-os-versions><os-version min="13.0"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="app"/></choices-outline>
  <choice id="app" title="Screen Buddy" visible="false"><pkg-ref id="$ID"/></choice>
  <pkg-ref id="$ID" version="$VERSION" onConclusion="none">ScreenBuddy.pkg</pkg-ref>
</installer-gui-script>
XML

PKG="$OUT/ScreenBuddy-Mac-Installer-$VERSION.pkg"
rm -f "$PKG"
productbuild --distribution "$WORK/distribution.xml" --package-path "$WORK" "$PKG"
echo "Installer $PKG"
