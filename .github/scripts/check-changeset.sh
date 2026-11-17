#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Fails when <base>..<head> changes what a published adapter ships (its src/,
# package.json or tsdown.config.ts; tests excluded) without adding a changeset.
# Private packages (such as frontend/_example) never need one, and neither
# does a package whose version in package.json is not on npm yet: the next
# release publishes that version as it is (a new package's first release).
# A change that needs no release takes an empty changeset:
# `bun run changeset --empty`.
#
#   check-changeset.sh <base-sha> <head-sha>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: check-changeset.sh <base-sha> <head-sha>" >&2
  exit 2
fi
base=$1
head=$2

# True when name@version is not on npm. Only a definite answer counts: a
# registry or network error is treated as "published", so a changeset is
# still required.
unpublished() {
  local out status=0
  out=$(npm view "$1@$2" version 2>&1) || status=$?
  if [ "$status" -eq 0 ]; then
    [ -z "$out" ]
  else
    printf '%s' "$out" | grep -q 'E404'
  fi
}

changed=()
first_release=()
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
  name=$(jq -r .name "$manifest")
  version=$(jq -r .version "$manifest")
  if unpublished "$name" "$version"; then
    first_release+=("$name@$version")
    continue
  fi
  changed+=("$file")
done < <(git diff --name-only --no-renames "$base...$head")

if [ "${#first_release[@]}" -gt 0 ]; then
  echo "Not on npm yet, so the next release publishes them as they are (no changeset needed):"
  printf '  %s\n' $(printf '%s\n' "${first_release[@]}" | sort -u)
fi

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
