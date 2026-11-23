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

## Plain-HTML app

[`plain-html/index.html`](plain-html/index.html) is a different kind of example: a three-slide deck
in one HTML file, with no framework and no bundler, made agent-controllable with the `<script>`
bundle of [`@skaile/skailify-core`](../core/). It registers the slide on screen as its view, the
deck's position as state, and one action, `slides.go_to`. To open it:

```sh
cd frontend/core && bun run build   # writes dist/skailify.iife.js, which the page loads
cd .. && bunx serve .               # any static server rooted at frontend/
```

Then open `/_example/plain-html/`. Opened on its own it stays standalone; embedded in a Skaile
session as a preview app with `"protocol": true` and the id `deck`, it connects. The core's tests
load the page on the bundle (`frontend/core/test/unit/bundle.test.ts`).
