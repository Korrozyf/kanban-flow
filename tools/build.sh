#!/usr/bin/env bash
#
# Builds the distributable Kanban Flow packages into dist/.
#
#   ./tools/build.sh
#
# Produces:
#   dist/kanban-flow-<version>.zip   → Chrome (unpacked load / Web Store)
#   dist/kanban-flow-<version>.xpi   → Firefox (same content, .xpi extension)
#
# The version is read from manifest.json: that is the single source of truth.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json | head -1 | sed 's/.*"\([0-9][^"]*\)"/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "ERROR: version not found in manifest.json" >&2
  exit 1
fi

# Files shipped inside the extension (everything else belongs to the repository,
# not to the product itself).
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
)

for f in "${FILES[@]}"; do
  [[ -e "$f" ]] || { echo "ERROR: missing file: $f" >&2; exit 1; }
done

# Syntax check on every shipped JS file (except the minified third-party library).
if command -v node >/dev/null 2>&1; then
  while IFS= read -r js; do
    node --check "$js" || { echo "SYNTAX ERROR: $js" >&2; exit 1; }
  done < <(find . -maxdepth 2 -name '*.js' -not -name '*.min.js' -not -path './dist/*' -not -path './node_modules/*')
else
  echo "WARNING: node not available, syntax check skipped." >&2
fi

rm -rf dist
mkdir -p dist

ZIP="dist/kanban-flow-${VERSION}.zip"
XPI="dist/kanban-flow-${VERSION}.xpi"

zip -qr "$ZIP" "${FILES[@]}" -x '*.DS_Store'
cp "$ZIP" "$XPI"

COUNT="$(unzip -Z1 "$ZIP" | grep -vc '/$' || true)"
echo "Version : $VERSION"
echo "Files   : $COUNT"
echo "Chrome  : $ROOT/$ZIP"
echo "Firefox : $ROOT/$XPI"
