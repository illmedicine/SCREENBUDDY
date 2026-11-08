#!/bin/bash
# Installs (or updates) Screen Buddy for Mac into ~/Applications. No administrator password, nothing system-wide.
#
#   curl -fsSL https://raw.githubusercontent.com/illmedicine/SCREENBUDDY/main/screen-buddy-starter/macos/scripts/install.sh | bash
#
# It downloads the newest macos-v release's zip, checks its size and SHA-256 against the release's update.json,
# replaces any copy already in ~/Applications, and opens the app. The app then keeps itself up to date.
set -euo pipefail
REPO="${SCREENBUDDY_REPO:-illmedicine/SCREENBUDDY}"
DEST="$HOME/Applications"
APP="$DEST/Screen Buddy.app"
DL="https://github.com/$REPO/releases/download/"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "Screen Buddy: $*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail "this installer is for macOS."

# Reads a JSON file with the JavaScript that ships with every Mac (no Python or jq needed).
js() { /usr/bin/osascript -l JavaScript -e "function run(a){const j=JSON.parse(\$.NSString.stringWithContentsOfFileEncodingError(a[0],\$.NSUTF8StringEncoding,null).js);$1}" "$2"; }

echo "Looking for the newest Screen Buddy for Mac..."
curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases?per_page=30" -o "$TMP/releases.json" \
  || fail "couldn't reach GitHub."
manifest_url=$(js "
  const v=t=>t.slice(7).split('.').map(Number), gt=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
  let best=null;
  for (const r of j) {
    if (r.draft||r.prerelease||!/^macos-v\\d+\\.\\d+\\.\\d+\$/.test(r.tag_name)) continue;
    const m=r.assets.find(x=>x.name==='update.json'); if(!m) continue;
    if (!best||gt(v(r.tag_name),v(best.tag_name))>0) best={tag_name:r.tag_name,url:m.browser_download_url};
  }
  return best?best.url:'';" "$TMP/releases.json")
[[ "$manifest_url" == "$DL"* ]] || fail "no Mac release has been published yet."

curl -fsSL "$manifest_url" -o "$TMP/update.json" || fail "couldn't download update.json."
read -r version url sha size < <(js "return [j.version,j.url,j.sha256,j.size].join(' ');" "$TMP/update.json")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$url" == "$DL"* && "$sha" =~ ^[0-9a-f]{64}$ && "$size" =~ ^[0-9]+$ ]] \
  || fail "the release's update.json doesn't look right."

echo "Downloading Screen Buddy $version..."
curl -fL --progress-bar "$url" -o "$TMP/app.zip" || fail "the download failed."
[[ "$(stat -f%z "$TMP/app.zip")" == "$size" ]] || fail "the download is the wrong size."
[[ "$(shasum -a 256 "$TMP/app.zip" | cut -d' ' -f1)" == "$sha" ]] || fail "the download didn't match its checksum."
ditto -x -k "$TMP/app.zip" "$TMP/x"
[[ -x "$TMP/x/Screen Buddy.app/Contents/MacOS/ScreenBuddy" ]] || fail "the download doesn't contain the app."

# Quit a running copy, then swap it.
osascript -e 'tell application id "ai.illyrobotic.screenbuddy.mac" to quit' >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "Screen Buddy.app/Contents/MacOS/ScreenBuddy" >/dev/null || break; sleep 0.5; done
mkdir -p "$DEST"
rm -rf "$APP"
ditto "$TMP/x/Screen Buddy.app" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "Installed Screen Buddy $version in $APP"
[[ -d "/Applications/Screen Buddy.app" ]] && echo "Note: an older copy is also in /Applications. You can drag it to the Trash."
[[ -n "${SCREENBUDDY_NO_OPEN:-}" ]] || open "$APP"
