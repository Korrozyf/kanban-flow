#!/usr/bin/env bash
#
# Construit les paquets distribuables de Kanban Flow dans dist/.
#
#   ./tools/build.sh
#
# Produit :
#   dist/kanban-flow-<version>.zip   → Chrome (chargement décompressé / Web Store)
#   dist/kanban-flow-<version>.xpi   → Firefox (même contenu, extension .xpi)
#
# La version est lue dans manifest.json : c'est la seule source de vérité.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json | head -1 | sed 's/.*"\([0-9][^"]*\)"/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "ERREUR : version introuvable dans manifest.json" >&2
  exit 1
fi

# Fichiers embarqués dans l'extension (tout le reste est du dépôt, pas du produit).
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
)

for f in "${FILES[@]}"; do
  [[ -e "$f" ]] || { echo "ERREUR : fichier manquant : $f" >&2; exit 1; }
done

# Contrôle syntaxique de tous les JS livrés (sauf la bibliothèque minifiée tierce).
if command -v node >/dev/null 2>&1; then
  while IFS= read -r js; do
    node --check "$js" || { echo "ERREUR de syntaxe : $js" >&2; exit 1; }
  done < <(find . -maxdepth 2 -name '*.js' -not -name '*.min.js' -not -path './dist/*' -not -path './node_modules/*')
else
  echo "AVERTISSEMENT : node absent, contrôle syntaxique ignoré." >&2
fi

rm -rf dist
mkdir -p dist

ZIP="dist/kanban-flow-${VERSION}.zip"
XPI="dist/kanban-flow-${VERSION}.xpi"

zip -qr "$ZIP" "${FILES[@]}" -x '*.DS_Store'
cp "$ZIP" "$XPI"

COUNT="$(unzip -Z1 "$ZIP" | grep -vc '/$' || true)"
echo "Version   : $VERSION"
echo "Fichiers  : $COUNT"
echo "Chrome    : $ROOT/$ZIP"
echo "Firefox   : $ROOT/$XPI"
