<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: integrate `@skaile/skailify-core` into an app without a framework

You are a coding agent. Follow this file from top to bottom to make an existing app that uses no UI
framework (plain JavaScript, server-rendered HTML, scripts injected into a page) agent-controllable
inside a Skaile session. Do every step, run every check, and report what you could not verify.

For a React or Angular app, follow the `AGENTS.md` of `@skaile/skailify-react` or
`@skaile/skailify-angular` instead: they wrap this client.

## What it does

The client connects the app to Skaile over the app channel. The app then tells the session agent
which view is on screen, what state it may read, and which actions it may call; the agent calls them
as tools, and the platform asks the user first for every action that changes data.

The client registers these capabilities itself (the agent sees each one as `app.<appId>.<name>`):

| Name | Kind | Approval | What it does |
|---|---|---|---|
| `app.get_view_state` | query | none | The view on screen, the registered state, the actions available now |
| `app.list_views` | query | none | The app's views (only with the `navigation` option) |
| `app.navigate` | effect | none | Shows a view and returns its state (only with the `navigation` option) |

Everything else is an action the app registers with `registerAction`, with a relative name
`<sector>.<verb>` (for example `slides.go_to`). Do not write the `app.` prefix yourself: a name that
starts with it throws.

## What works today, and what does not

Read "What works today" in [Getting started](../../docs/getting-started.md) first. For this client:

- The app must run embedded in a Skaile preview, declared as an app with `"protocol": true` in the
  workspace's `skaile.preview.json`. Opened on its own, it does not connect.
- **Writes and consent.** Every action that changes data must be declared with
  `requiresApproval: true`. Queries and harmless view changes need none.
- Actions exist only while the page is open in the session.

## Prerequisites

- The app's id: the `id` of its entry in the workspace's `skaile.preview.json`.
- With a bundler: `@skaile/workspaces` `^10.14.0` and `zod` `^4.4.0` as well.
- Without one: nothing else; the bundle carries both.

## Step 1: load the client

With a bundler:

```sh
npm install @skaile/skailify-core @skaile/workspaces zod
```

```js
import { createSkailify, z } from "@skaile/skailify-core";
```

Without one, add one script tag before the app's own script, with a pinned version, and take the
exports from the global `Skailify`:

```html
<script src="https://cdn.jsdelivr.net/npm/@skaile/skailify-core@0.1/dist/skailify.iife.js"></script>
<script>
  const { createSkailify, z } = Skailify;
</script>
```

If the app must not load scripts from another origin, copy `dist/skailify.iife.js` from the npm
package into the app's static files and load it from there.

## Step 2: connect

Create one client per page and start it once:

```js
const skailify = createSkailify({ appId: "<id in skaile.preview.json>" });
// … register views, state and actions (steps 3 and 4) …
void skailify.start();
```

- `appId` has no safe default: it must equal the app's `id` in `skaile.preview.json`.
- Registrations made before or after `start()` both work.
- Optional: `navigation` (step 3), `settleTimeoutMs` (default 3000), `logger`, and `assistant`
  (where Skaile puts its agent button over the app, or `{ kind: "none" }` to leave it out).

## Step 3: expose what the app shows

Register the view on screen and keep it current:

```js
const view = skailify.registerView({ id: "orders", title: "Orders", state: { filter } });
// when the screen changes:
view.update({ id: "order/42", title: "Order 42", loading: true });
// once its data has arrived:
view.update({ id: "order/42", title: "Order 42" });
```

- `id` is stable: a route or screen name, with the record key for a detail.
- `state` is a small JSON-serialisable summary. State that cannot be serialised reaches the agent as
  `{ error: "state is not JSON-serialisable" }` and breaks nothing else.
- Say `loading: true` while the view fetches what it shows: the agent waits until it is false.

Expose the data the agent needs to choose its next call, as ids and labels; `read` is called on every
read:

```js
skailify.registerState("orders", () => rows.map((o) => ({ id: o.id, label: o.number, status: o.status })));
```

If the app has several pages or screens, hand the client its views and how to show one:

```js
createSkailify({
  appId: "<id>",
  navigation: {
    views: () => [{ id: "orders", title: "Orders" }, { id: "order", menu: false, params: { orderId: "the order" } }],
    navigate: (view, params) => showScreen(view, params),
    current: () => currentScreenId(),
  },
});
```

## Step 4: actions that change data

```js
skailify.registerAction({
  name: "orders.approve",
  description: "Approve an order by id.",
  input: z.object({ orderId: z.string().describe("Id from get_view_state") }),
  kind: "effect",
  requiresApproval: true,
  handler: async ({ orderId }, ctx) => {
    await approve(orderId); // the same function the app's own button calls
    return { approved: orderId };
  },
});
```

- Call the same functions the app's own controls call. Throw an `Error` with a message the agent can
  act on; it reaches the agent as `{ error }`.
- `ctx.principal` says whose agent turn made the call. It is not for authorisation: the app's own
  login still decides.
- After an effect the client waits for the next frame and for every view to stop loading, then sends
  the view report and `settled` itself.

## Step 5: verify

Run each of these and report exactly which you ran and what happened.

1. This package's tests, in this repository: `bun install`, then in `frontend/core` `bun run test`
   and `bun run type-check`: no test fails.
2. The app SDK's conformance checks: `bun run conformance` in `frontend/core`.
3. The app works as before when it is opened on its own; `skailify.getSnapshot().status.state` is
   `standalone`.
4. In a Skaile session with the app declared `"protocol": true`: ask the agent what the app shows. It
   should call `get_view_state` and describe the view. Ask it to do something behind an action with
   `requiresApproval: true`: an approval card appears, and the app changes only after you approve.

## Known limits

- Actions come from the browser: they exist only while the page is open in the session.
- Settling waits for the next rendered frame and for every registered view to stop loading. Data the
  app fetches without saying `loading: true` is not waited for.
