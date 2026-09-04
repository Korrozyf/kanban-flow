#!/usr/bin/env bash
#
# Builds the distributable Kanban Flow packages into dist/.
#
#   ./tools/build.sh
#
# Produces:
#   dist/kanban-flow-<version>.zip   → Chrome (unpacked load / Web Store)
#   dist/kanban-flow-<version>.xpi   → Firefox
#
# manifest.json is the version source of truth and the directly loadable Chrome
# manifest. The build generates a Firefox-specific manifest in the XPI because
# Chrome MV3 requires background.service_worker while Firefox MV3 uses
# background.scripts; putting both keys in one manifest makes Chrome report an
# error.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json | head -1 | sed 's/.*"\([0-9][^"]*\)"/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "ERROR: version not found in manifest.json" >&2
  exit 1
fi

# Files shipped inside the extension. The docs/ folder is included so that a user
# who only has the archive still has the full documentation offline, and so that
# the README links to docs/*.md resolve inside the unpacked folder.
# Everything else belongs to the repository, not to the product itself.
FILES=(
  manifest.json
  background.js
  dashboard.html
  dashboard.css
  dashboard.js
  options.html
  options.css
  options.js
  lib
  icons
  README.md
  CHANGELOG.md
  LICENSE
  THIRD-PARTY.md
  docs
)

for f in "${FILES[@]}"; do
  [[ -e "$f" ]] || { echo "ERROR: missing file: $f" >&2; exit 1; }
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required for syntax and manifest checks." >&2
  exit 1
fi

# Syntax check on every shipped JS file (except the minified third-party library).
while IFS= read -r js; do
  node --check "$js" || { echo "SYNTAX ERROR: $js" >&2; exit 1; }
done < <(find . -maxdepth 2 -name '*.js' -not -name '*.min.js' -not -path './dist/*' -not -path './node_modules/*')

rm -rf dist
mkdir -p dist

ZIP="dist/kanban-flow-${VERSION}.zip"
XPI="dist/kanban-flow-${VERSION}.xpi"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/chrome" "$STAGE/firefox"

for f in "${FILES[@]}"; do
  cp -R "$f" "$STAGE/chrome/"
  cp -R "$f" "$STAGE/firefox/"
done

# docs/updates.json is a maintainer template (Firefox self-hosted update manifest),
# not user documentation: it stays out of both packages.
rm -f "$STAGE/chrome/docs/updates.json" "$STAGE/firefox/docs/updates.json"

# Generate browser-specific manifests. Keep the repository manifest Chrome-valid
# so the source folder can be loaded unpacked without a manifest warning.
node - "$STAGE/chrome/manifest.json" "$STAGE/firefox/manifest.json" <<'NODE'
const fs = require("fs");
const [chromePath, firefoxPath] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(chromePath, "utf8"));

const chromeManifest = structuredClone(source);
chromeManifest.background = { service_worker: "background.js" };
delete chromeManifest.browser_specific_settings;

const firefoxManifest = structuredClone(source);
firefoxManifest.background = {
  scripts: ["lib/update.js", "background.js"],
};

fs.writeFileSync(chromePath, `${JSON.stringify(chromeManifest, null, 2)}\n`);
fs.writeFileSync(firefoxPath, `${JSON.stringify(firefoxManifest, null, 2)}\n`);
NODE

# Fail the build if a future edit reintroduces incompatible background keys.
node - "$STAGE/chrome/manifest.json" "$STAGE/firefox/manifest.json" <<'NODE'
const fs = require("fs");
const [chromePath, firefoxPath] = process.argv.slice(2);
const chrome = JSON.parse(fs.readFileSync(chromePath, "utf8"));
const firefox = JSON.parse(fs.readFileSync(firefoxPath, "utf8"));

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
if (chrome.manifest_version !== 3 || chrome.background?.service_worker !== "background.js") {
  fail("Chrome package must use Manifest V3 background.service_worker");
}
if (chrome.background?.scripts) fail("Chrome package must not contain background.scripts");
if (chrome.browser_specific_settings) fail("Chrome package must not contain Firefox-specific settings");
if (firefox.manifest_version !== 3 || !Array.isArray(firefox.background?.scripts)) {
  fail("Firefox package must use Manifest V3 background.scripts");
}
if (firefox.background?.service_worker) fail("Firefox package must not contain background.service_worker");
if (!firefox.browser_specific_settings?.gecko?.id) fail("Firefox package must contain its Gecko id");
NODE

(
  cd "$STAGE/chrome"
  zip -qr "$ROOT/$ZIP" . -x '*.DS_Store'
)
(
  cd "$STAGE/firefox"
  zip -qr "$ROOT/$XPI" . -x '*.DS_Store'
)

CHROME_COUNT="$(unzip -Z1 "$ZIP" | grep -vc '/$' || true)"
FIREFOX_COUNT="$(unzip -Z1 "$XPI" | grep -vc '/$' || true)"
echo "Version: $VERSION"
echo "Chrome:  $ROOT/$ZIP ($CHROME_COUNT files)"
echo "Firefox: $ROOT/$XPI ($FIREFOX_COUNT files)"
