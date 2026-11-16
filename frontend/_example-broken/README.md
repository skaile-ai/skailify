<!-- SPDX-License-Identifier: Apache-2.0 -->

# Example adapter

A minimal, dummy frontend adapter. It is not for use in an app: it exists so the reusable
[adapter workflow](../../.github/workflows/adapter.yml) has an adapter to run on, and as the smallest
working shape of a JavaScript adapter for [the CI template](../../docs/ci-template.md).

It registers two capabilities, `app.example.open` (changes the view and reports it) and
`app.example.whoami` (returns who invoked it), which is what the app SDK's conformance checks need.

```sh
bun install          # at the repository root
bun run test         # its own tests
bun run conformance  # the app SDK's conformance checks
```
