<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: integrate `@skaile/skailify-angular` into an Angular app

You are a coding agent. Follow this file from top to bottom to make an existing Angular app
agent-controllable inside a Skaile session. Do every step, run every check, and report what you could
not verify.

## What it does

The adapter connects the app to Skaile over the app channel. The app then tells the session agent
which view is on screen, what state it may read, and which actions it may call. The agent calls them
as tools, and the platform asks the user first before every action that changes data. If the app
uses NgRx, the agent dispatches the store's own actions and reads its selectors.

The adapter registers these capabilities itself. Each is declared as `app.<name>`, and the agent sees
it as `app.<appId>.<name>`:

| Name | Kind | Approval | What it does |
|---|---|---|---|
| `app.get_view_state` | query | none | The view on screen, the state the app exposes, the actions available now |
| `app.list_views` | query | none | The app's views (only with the `navigation` option) |
| `app.navigate` | effect | none | Shows a view and returns its state (only with the `navigation` option) |

Everything else is an action the app declares. Each has a relative name `<sector>.<verb>` (for example
`orders.approve`), and the agent sees it as `app.<appId>.orders.approve`. Do not write the `app.`
prefix yourself: a name that starts with it throws.

## What works today, and what does not

Read "What works today" in [Getting started](../../docs/getting-started.md) first. For this adapter:

- The app must run embedded in a Skaile preview, declared as an app with `"protocol": true` in the
  workspace's `skaile.preview.json`. Opened on its own, it does not connect. The registrations still
  run and cost next to nothing.
- **Writes and consent.** Every action that changes data must be declared with
  `requiresApproval: true`. The platform shows the user an approval card and forwards the call only
  after the user approves. Queries and harmless view changes (opening, filtering, navigating) need no
  approval.
- Actions exist only while the app is open in the session and the component or service that
  registers them lives.
- **Handing work to the agent.** `injectRequestAgentTurn()` returns the function that starts an agent
  turn as the signed-in user's message; it rejects with an `AppTurnRefusedError` (`reason`) when
  Skaile refuses or does not answer. `injectSkailifyUser()` is the signed-in user as a signal.

## Prerequisites

- Angular 20, 21 or 22, zoneless or with zone.js
- `@skaile/workspaces` `^10.17.0` (the app SDK, `@skaile/workspaces/app-sdk`)
- `zod` `^4.4.0`: major 4, because the SDK turns your schemas into JSON Schema with it
- Optional: `@angular/router`, `@ngrx/store`, `@ngrx/signals` 20 to 22, if the app uses them
- The app's id: the `id` of its entry in the workspace's `skaile.preview.json`

## Step 1: install

```sh
npm install @skaile/skailify-angular @skaile/workspaces zod
```

Angular, zod and the app SDK are peer dependencies, so the app keeps a single copy of each. To try an
unreleased change, install a packed tarball (`npm pack` in `frontend/angular` of a checkout of this
repository), never the folder by path: a path install links the folder, and the build may then load a
second `@angular/core` from the checkout's `node_modules`, which breaks injection (`NG0203` or "no
provider for InjectionToken skailify").

## Step 2: connect

In `app.config.ts` (or the `providers` of `bootstrapApplication`):

```ts
import { provideSkailify } from "@skaile/skailify-angular";

export const appConfig: ApplicationConfig = {
  providers: [
    // ...the app's providers
    provideSkailify({ appId: "<id in skaile.preview.json>" }),
  ],
};
```

- `appId` has no safe default: it must equal the app's `id` in `skaile.preview.json`, or the platform
  refuses the connection.
- The client starts when the app boots and closes when it is destroyed; do not call `start()`
  yourself.
- An NgModule app adds `provideSkailify(...)` to the root module's `providers`.
- Optional: `navigation` (step 3), `settleTimeoutMs` (default 3000), `logger`, and `assistant`:
  where Skaile puts its agent button over the app, `{ kind: "floating", corner: "bottom-left" }`, or
  `{ kind: "none" }` to leave it out. Leave it unset unless the button would cover the app's own
  controls or the user asked for no button; `injectSkailify().setAssistant(...)` changes it later.

## Step 3: expose what the app shows

In every component that is a view (a routed page, a screen, a dialog that replaces the screen), call
the adapter in the constructor (or a field initialiser):

```ts
constructor() {
  injectAgentView(() => ({ id: "orders", title: "Orders", state: { filter: this.filter(), shown: this.rows().length }, loading: this.loading() }));
}
```

- `id` is stable: a route or screen name, with the record key for a detail (`order/42`).
- Pass a function that reads signals: it is re-read in an `effect` whenever they change. For a
  component without signals, pass a plain object.
- `state` is a small JSON-serialisable summary. State that cannot be serialised (a `BigInt`, a
  cycle), here or in `injectAgentState`, is replaced by `{ error: "state is not JSON-serialisable" }`
  in what the agent reads; the rest of the answer is unaffected, and the error is logged once.
- Pass `loading: true` while the view fetches what it shows. The agent waits until it is false before
  it reads the screen; a view that loads data and never says so may be read empty.

Expose the data the agent needs to choose its next call, as ids and labels:

```ts
injectAgentState("orders", () => this.rows().map((o) => ({ id: o.id, label: o.number, status: o.status })));
```

If the app keeps the data in NgRx, expose selectors instead, as in step 4.

If the app uses the Angular Router, hand the client its views, so the agent can move between them:

```ts
import { routerNavigation } from "@skaile/skailify-angular/router";

provideSkailify({
  appId: "<id>",
  navigation: routerNavigation([
    { id: "orders", title: "Orders", path: "orders" },
    { id: "order", title: "Order", path: "orders/:orderId", menu: false, params: { orderId: "the order" } },
  ]),
});
```

Each `path` is the view's full path from the root: for a child route, join its parents' paths
(`orders` with a child `:orderId` is `orders/:orderId`). `:name` segments are filled from the
parameters, and the other parameters become query parameters. A navigation that a guard cancels
comes back to the agent as an error; showing the view already on screen is not one. Of several
matching views, the most specific (fewest `:name` segments) is the one on screen.

## Step 4: actions that change data

**With NgRx Store.** Offer the actions the app's own UI dispatches. Give each a Zod schema of its
props (TypeScript checks it against them) and a `guard` for what the reducer would silently ignore:

```ts
import { provideSkailifyStore, storeActions } from "@skaile/skailify-angular/ngrx";

provideSkailifyStore({
  state: { orders: selectOrderSummaries },
  actions: storeActions(OrderActions, {
    approve: {
      description: "Approve an order by id.",
      input: z.object({ orderId: z.string().describe("Id from get_view_state") }),
      requiresApproval: true,
      guard: ({ orderId }, store) => {
        if (!store.selectSignal(selectOrderIds)().includes(orderId)) throw new Error(`no order ${orderId}`);
      },
    },
  }),
}),
```

Add it after `provideStore(...)` and `provideSkailify(...)`. For actions that only make sense on one
screen, call `exposeStore({...})` in that component's constructor instead. Selectors may be typed
on the app's root state. Only creators made with `props<...>()` or without props are supported, not
function creators.

**With an NgRx SignalStore.** Offer its methods:

```ts
exposeSignalStore(this.orders, {
  name: "orders",
  methods: { approve: { description: "Approve an order by id.", input: z.object({ orderId: z.string() }), args: ["orderId"], requiresApproval: true } },
});
```

**Without a store**, or for logic that is not one action:

```ts
const approveInput = z.object({ orderId: z.string().describe("Id from get_view_state") });

injectAgentAction({
  name: "orders.approve",
  description: "Approve an order by id.",
  input: approveInput,
  kind: "effect",
  requiresApproval: true,
  effectClass: "routine", // "external" when it reaches outside the app, "privileged" for admin actions
  handler: async ({ orderId }, ctx) => {
    if (ctx.principal.kind !== "human" && ctx.principal.kind !== "trigger") {
      throw new Error("approving needs one person behind the request");
    }
    await this.api.approve(orderId);
    return { approved: orderId };
  },
});
```

- Names are relative (`orders.approve`, not `app.orders.approve`); a full name throws.
- Call the same code the app's own buttons call. Throw an `Error` with a message the agent can act
  on (`no order 42`); it reaches the agent as `{ error }`.
- `ctx.principal` says whose agent turn made the call. Refuse `mixed` and `unknown` when the action acts
  for one person. It is not for authorisation: the app's own login still decides.
- The adapter logs every call in the activity log (`injectSkailifyActivity`). After an effect it
  waits for Angular to become stable and sends the view report and `settled` itself.

## Step 5: verify

Run each of these, and report exactly which ones you ran and what happened.

1. The adapter's own tests, in this repository: run `bun install`, then in `frontend/angular` run
   `bun run test` and `bun run type-check`. No test fails.
2. The app SDK's conformance checks: run `bun run conformance` in `frontend/angular`. There is one test
   per check, and none fails. To check the app itself, copy `test/conformance/conformance.test.ts`,
   pass `transport: gateway.transport()` to `provideSkailify`, and register your own actions.
3. The app's own `ng build` and tests pass, and the app works as before when it is opened on its own
   (the status is `standalone`).
4. In a Skaile session with the app declared `"protocol": true`:
   - Ask the agent what the app shows. It should call `get_view_state` and describe the view.
   - Ask it to change something behind an action with `requiresApproval: true`. An approval card
     appears, and the app changes only after you approve.

## Known limits

- Actions come from the browser: they exist only while the app is open in the session and their
  component or service lives. A server-side connection, so a backend can offer them without an open
  tab, is planned on the platform side.
- Settling waits for Angular to become stable (at most a second), the next frame, and every view to
  stop loading. Data an app fetches without telling `injectAgentView` is not waited for. The
  adapter's connection and timers run outside the Angular zone and the handlers inside it, so with
  zone.js a call settles as soon as the app has rendered.
- An NgRx effect that runs after the dispatch (an HTTP call) is not awaited. Mark the view
  `loading` while it runs, so the agent waits for it.
- Under zone.js, an app with a timer of its own that never stops (a polling `setInterval` started in
  the zone) never becomes stable. Every call then waits the full second before it settles; start
  such timers with `NgZone.runOutsideAngular`.
