#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Fails when <base>..<head> changes what a published adapter ships (its src/,
# package.json or tsdown.config.ts; tests excluded) without adding a changeset.
# Private packages (such as frontend/_example) never need one. A change that
# needs no release takes an empty changeset: `bun run changeset --empty`.
#
#   check-changeset.sh <base-sha> <head-sha>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: check-changeset.sh <base-sha> <head-sha>" >&2
  exit 2
fi
base=$1
head=$2

changed=()
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    *.test.ts | *.test.tsx) continue ;;
  esac
  dir=$(printf '%s' "$file" | sed -nE 's#^((frontend|backend)/[^/]+)/(src/.*|package\.json|tsdown\.config\.ts)$#\1#p')
  [ -n "$dir" ] || continue
  manifest="$dir/package.json"
  [ -f "$manifest" ] || continue
  if [ "$(jq -r '.private // false' "$manifest")" = true ]; then continue; fi
  changed+=("$file")
done < <(git diff --name-only "$base...$head")

if [ "${#changed[@]}" -eq 0 ]; then
  echo "No published adapter source changed; no changeset needed."
  exit 0
fi

echo "Published adapter source changed:"
printf '  %s\n' "${changed[@]}"

changesets=$(git diff --name-only --diff-filter=d "$base...$head" -- .changeset/ | grep -E '\.md$' | grep -v 'README\.md$' || true)
if [ -z "$changesets" ]; then
  echo "::error::no changeset. Run \`bun run changeset\` and commit the file it writes (or \`bun run changeset --empty\` if this needs no release). See docs/releasing.md."
  exit 1
fi
echo "Changeset(s): $changesets"
