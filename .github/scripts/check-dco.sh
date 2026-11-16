#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Checks that every non-merge commit in <base>..<head> carries a
# Signed-off-by line for its author (Developer Certificate of Origin).
#
#   check-dco.sh <base-sha> <head-sha>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: check-dco.sh <base-sha> <head-sha>" >&2
  exit 2
fi
base=$1
head=$2

for rev in "$base" "$head"; do
  if ! git rev-parse --quiet --verify "$rev^{commit}" > /dev/null; then
    echo "::error::$rev is not a commit in this clone; fetch the full history (fetch-depth: 0)"
    exit 1
  fi
done
commits=$(git rev-list --no-merges "$base..$head")

failures=0
checked=0
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  checked=$((checked + 1))
  author=$(git log -1 --format='%an <%ae>' "$sha")
  author_email=$(git log -1 --format='%ae' "$sha" | tr '[:upper:]' '[:lower:]')
  signed=no
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    email=$(printf '%s' "$line" | sed -n 's/.*<\(.*\)>.*/\1/p' | tr '[:upper:]' '[:lower:]')
    if [ "$email" = "$author_email" ]; then
      signed=yes
      break
    fi
  done < <(git log -1 --format='%(trailers:key=Signed-off-by,valueonly,unfold)' "$sha")

  if [ "$signed" = no ]; then
    echo "::error::commit $(git log -1 --format='%h %s' "$sha") has no Signed-off-by for its author $author"
    failures=$((failures + 1))
  fi
done <<< "$commits"

if [ "$failures" -gt 0 ]; then
  echo "$failures of $checked commit(s) are not signed off. Sign them off with" >&2
  echo "  git rebase --signoff $base && git push --force-with-lease" >&2
  echo "See CONTRIBUTING.md, Developer Certificate of Origin." >&2
  exit 1
fi
echo "DCO check passed: $checked commit(s) signed off."
