#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Publishes version 0.0.0 of the adapter in the current folder as an empty
# placeholder, so the package exists on npm and a trusted publisher can be set
# up for it. Run once per new package, from its folder, logged in to npm with
# publish rights on @skaile. See docs/releasing.md.
#
#   publish-placeholder.sh            publish
#   publish-placeholder.sh --dry-run  show what would be published
set -euo pipefail

dry_run=()
if [ "${1:-}" = "--dry-run" ]; then dry_run=(--dry-run); fi

if [ ! -f package.json ]; then
  echo "run this from an adapter folder (no package.json here)" >&2
  exit 1
fi
name=$(node -p 'require("./package.json").name')
if [ "$(node -p 'require("./package.json").private === true')" = true ]; then
  echo "$name is private; remove \"private\": true first" >&2
  exit 1
fi
if npm view "$name" version > /dev/null 2>&1; then
  echo "$name already exists on npm; nothing to bootstrap" >&2
  exit 1
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
NAME="$name" node -e '
  const p = require("./package.json");
  const out = {
    name: p.name,
    version: "0.0.0",
    description: "Placeholder that reserves the name for trusted publishing. Install the latest version.",
    license: p.license,
    repository: p.repository,
  };
  require("fs").writeFileSync(process.argv[1] + "/package.json", JSON.stringify(out, null, 2) + "\n");
' "$dir"
cat > "$dir/README.md" <<EOF
# $name

Placeholder. Install the latest version: \`npm install $name@latest\`.
EOF

echo "Publishing $name@0.0.0 (placeholder, dist-tag bootstrap)"
(cd "$dir" && npm publish --access public --tag bootstrap --provenance=false ${dry_run[@]+"${dry_run[@]}"})
