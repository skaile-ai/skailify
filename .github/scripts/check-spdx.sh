#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Checks that every tracked file that can hold a comment carries an SPDX
# licence identifier in its first lines: EPL-2.0 under backend/emf-mcp/,
# Apache-2.0 everywhere else. Files that cannot hold a comment (JSON,
# lockfiles, LICENSE, NOTICE), build wrappers, changesets and the changelogs
# Changesets writes from them are skipped.
#
#   check-spdx.sh            check every tracked file
#   check-spdx.sh <files…>   check only these files
set -euo pipefail

EPL_ROOT="backend/emf-mcp/"
HEAD_LINES=10

checked_extension() {
  case "$1" in
    *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs | *.vue | *.java | *.kt | *.kts | \
      *.gradle | *.groovy | *.sh | *.py | *.toml | *.sql | *.svelte | *.astro | *.yml | *.yaml | *.md | \
      *.css | *.scss | *.html | *.xml | *.bnd | Dockerfile | */Dockerfile)
      return 0 ;;
    *) return 1 ;;
  esac
}

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=()
  while IFS= read -r -d '' f; do files+=("$f"); done < <(git ls-files -z)
fi

failures=0
for file in "${files[@]}"; do
  [ -f "$file" ] || continue
  checked_extension "$file" || continue
  case "$file" in
    */gradle/wrapper/* | */.mvn/wrapper/*) continue ;;
    .changeset/*.md | CHANGELOG.md | */CHANGELOG.md) continue ;;
  esac

  expected="Apache-2.0"
  case "$file" in "$EPL_ROOT"*) expected="EPL-2.0" ;; esac

  # The whole expression after the tag, so "Apache-2.0 OR MIT" is not read as Apache-2.0.
  found=$(head -n "$HEAD_LINES" "$file" | grep -m 1 -o 'SPDX-License-Identifier:.*' |
    sed -E -e 's/^SPDX-License-Identifier:[[:space:]]*//' -e 's/[[:space:]]*(-->|\*\/)?[[:space:]]*$//' || true)
  if [ -z "$found" ]; then
    echo "::error file=$file::no SPDX-License-Identifier in the first $HEAD_LINES lines (expected $expected)"
    failures=$((failures + 1))
  elif [ "$found" != "$expected" ]; then
    echo "::error file=$file::SPDX-License-Identifier is $found, expected $expected"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures file(s) fail the SPDX check; see CONTRIBUTING.md, License headers." >&2
  exit 1
fi
echo "SPDX check passed."
