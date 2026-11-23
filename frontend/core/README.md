<!-- SPDX-License-Identifier: Apache-2.0 -->

# @skaile/skailify-core

The framework-free Skailify client. It makes an app agent-controllable inside a Skaile session, over
the Skailify app channel (`@skaile/workspaces/app-sdk`), without a UI framework: the app creates one
client with its app id and tells it, in plain function calls, which view is on screen, what state the
agent may read and which actions it may call.

The React and Angular adapters ([`@skaile/skailify-react`](../react/),
[`@skaile/skailify-angular`](../angular/)) wrap this client; an app that uses one of them does not
install this package itself. Use it directly in an app without a framework: plain JavaScript, a page
rendered on the server, a script injected into HTML.

It connects only when the app is embedded in Skaile as a preview app with the app channel switched
on (`"protocol": true`): an iframe whose URL carries `skaileParentOrigin`. Opened on its own, the app
does not connect, and the registrations cost next to nothing.

## Two ways to load it

With a bundler:

```sh
npm install @skaile/skailify-core @skaile/workspaces zod
```

```ts
import { createSkailify, z } from "@skaile/skailify-core";
```

Without one, from a single `<script>` tag: `dist/skailify.iife.js` has zod and the app SDK bundled
in and puts every export of the package on the global `Skailify`. It ships in the npm package, so a
CDN that serves npm packages serves it too:

```html
<script src="https://cdn.jsdelivr.net/npm/@skaile/skailify-core@0.1/dist/skailify.iife.js"></script>
<script>
  const { createSkailify, z } = Skailify;
</script>
```

The bundle is about 410 kB minified (about 98 kB gzipped), most of it zod. Pin the version you
tested; serve a copy from the app's own origin when the app must not load scripts from elsewhere.

## Wiring

```js
const skailify = createSkailify({ appId: "deck" }); // the id in skaile.preview.json

const view = skailify.registerView({ id: "slide-1", title: "Welcome" });
skailify.registerState("deck", () => ({ slide: current, slides: count }));
skailify.registerAction({
  name: "slides.go_to",            // relative: the agent sees app.<appId>.slides.go_to
  description: "Show a slide of the deck by its number, starting at 1.",
  input: z.object({ slide: z.number().int().min(1) }),
  kind: "effect",
  handler: async ({ slide }) => {
    show(slide);                   // the same function the app's own buttons call
    return { slide };
  },
});

void skailify.start();
```

- `registerView` returns `{ update, remove }`: call `update` when the view on screen changes, with
  `loading: true` while it fetches what it shows. Of several registered views the last one added is on
  screen.
- `registerState` and `registerAction` return the function that removes the registration.
- `subscribe(listener)` and `getSnapshot()` give the connection status, the capabilities and the
  activity log (the agent's latest calls, newest first) for a panel in the app's own UI.
- `navigation` (option) hands the client the app's views and how to show one; the agent then gets
  `list_views` and `navigate`. `assistant` (option) places Skaile's agent button over the app, or
  leaves it out with `{ kind: "none" }`; `setAssistant` changes it later.

## Capabilities

The agent sees each one as `app.<appId>.<name>`.

| Name | Kind | When | What it does |
|---|---|---|---|
| `get_view_state` | query | always | The view on screen, the registered state, and the actions available now. Waits until no view is loading |
| `list_views` | query | with `navigation` | The app's views: id, title, whether they are in the menu, and the parameters they take |
| `navigate` | effect | with `navigation` | Shows a view with its parameters, waits until it has loaded, and returns the view state |
| your actions | query / effect | while registered | Whatever `registerAction` declares |

Actions that change data are declared with `requiresApproval: true`, and optionally an `effectClass`;
the platform then asks the user before it forwards the call. After every effect the client waits for
the next rendered frame and for every view to stop loading, then sends the view report and `settled`.
A call waits at most `settleTimeoutMs` (default 3 s, at most 10 s).

## For framework adapters

Two options exist for an adapter that wraps the client: `rendered`, a promise for "the framework has
rendered the latest change" that settling waits for before the next frame, and `zone`, which runs the
connection outside and the handlers inside a framework's async tracking (Angular's zone.js). An app
without a framework leaves both unset.

## Example

[`../_example/plain-html/`](../_example/plain-html/) is a three-slide deck in one HTML file that loads
the bundle with a `<script>` tag. The tests load the bundle as a page would and drive it through the
app SDK's fake gateway.

## SDK version

Peer `@skaile/workspaces` ^10.14.0 and `zod` ^4.4.0. CI runs the tests and the conformance checks
against the lowest and the latest `@skaile/workspaces` in that range. The bundle carries the versions
it was built with.

## Development

```sh
bun install            # at the repository root
cd frontend/core
bun run test           # builds dist/, then the unit tests and the bundle smoke test
bun run conformance    # the app SDK's conformance checks
bun run type-check
```

The React, Angular and vue-tsm adapters resolve `@skaile/skailify-core` to `src/` through their
`tsconfig.json` `paths`, so their tests and type-checks need no build of this package. Their published
builds import it (React, Angular) or bundle it in (vue-tsm, which an app serves through its import
map).

## License

Apache-2.0, see [LICENSE](../../LICENSE).
