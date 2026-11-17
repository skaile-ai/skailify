<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: integrate `@skaile/skailify-react` into a React app

You are a coding agent. Follow this file from top to bottom to make an existing React app
agent-controllable inside a Skaile session. Do every step, run every check, and report what you could
not verify.

## What it does

The adapter connects the app to Skaile over the app channel. The app's components then tell the
session agent which view is on screen, what state it may read, and which actions it may call; the
agent calls them as tools, and the platform asks the user first for every action that changes data.

The adapter registers these capabilities itself (declared as `app.<name>`; the agent sees each one as
`app.<appId>.<name>`):

| Name | Kind | Approval | What it does |
|---|---|---|---|
| `app.get_view_state` | query | none | The view on screen, the state the components expose, the actions available now |
| `app.list_views` | query | none | The app's views (only with the `navigation` option) |
| `app.navigate` | effect | none | Shows a view and returns its state (only with the `navigation` option) |

Everything else is an action the app declares with `useAgentAction`, named `app.<sector>.<verb>`.

## What works today, and what does not

Read "What works today" in [Getting started](../../docs/getting-started.md) first. For this adapter:

- The app must run embedded in a Skaile preview, declared as an app with `"protocol": true` in the
  workspace's `skaile.preview.json`. Opened on its own, it does not connect; the hooks still run and
  cost next to nothing.
- **Writes and consent.** Every action that changes data must be declared with
  `requiresApproval: true`. The platform shows the user an approval card and forwards the call only
  after approval. Queries and harmless view changes (opening, filtering, navigating) need none.
- Actions exist only while the app is open in the session and the component that registers them is
  mounted.

## Prerequisites

- React 18.3 or 19, and a bundler that resolves TypeScript sources from `node_modules` (Vite, Next.js,
  webpack with a TypeScript loader)
- `@skaile/workspaces` `^10.4.0` (the app SDK, `@skaile/workspaces/app-sdk`)
- `zod` `^4.4.0`: major 4, because the SDK turns your schemas into JSON Schema with it
- The app's id: the `id` of its entry in the workspace's `skaile.preview.json`

## Step 1: install

```sh
npm install @skaile/skailify-react @skaile/workspaces zod
```

The package is not on npm yet. Until it is, install it from a checkout of this repository:
`npm install <path to checkout>/frontend/react @skaile/workspaces zod`.

Install the adapter once, in the app's own `package.json`. Two copies (for example one in a shared
UI library and one in the app) mean two contexts: the hooks of one copy do not see the provider of the
other and throw "no client".

## Step 2: connect

Where the app boots (for example `main.tsx`), create one client, start it, and wrap the app in the
provider:

```tsx
import { createSkailify, SkailifyProvider } from "@skaile/skailify-react";

export const skailify = createSkailify({ appId: "<id in skaile.preview.json>" });
void skailify.start();

createRoot(document.getElementById("root")!).render(
  <SkailifyProvider client={skailify}>
    <App />
  </SkailifyProvider>,
);
```

- `appId` has no safe default: it must equal the app's `id` in `skaile.preview.json`, or the platform
  refuses the connection.
- Call `start()` outside components, not in a `useEffect`: React mounts effects twice in development.
- Optional: `navigation` (step 3), `settleTimeoutMs` (default 3000), `logger`.

## Step 3: expose what the app shows

In every component that is a view (a page, a screen, a dialog that replaces the screen):

```tsx
useAgentView({ id: "orders", title: "Orders", state: { filter, shown: rows.length }, loading: isLoading });
```

- `id` is stable: a route or screen name, with the record key for a detail (`order/42`).
- `state` is a small JSON-serialisable summary. It is compared on every render, so keep it small.
- Pass `loading: true` while the view fetches what it shows. The agent waits until it is false before
  it reads the screen; a view that loads data and never says so may be read empty.

Expose the data the agent needs to choose its next call, as ids and labels:

```tsx
useAgentState("orders", rows.map((o) => ({ id: o.id, label: o.number, status: o.status })));
```

If the app has a router, hand the client its views, so the agent can move between them:

```tsx
createSkailify({
  appId: "<id>",
  navigation: {
    views: () => [{ id: "orders", title: "Orders" }, { id: "order", menu: false, params: { orderId: "the order" } }],
    navigate: (view, params) => router.navigate(view === "order" ? `/orders/${params.orderId}` : `/${view}`),
  },
});
```

## Step 4: actions that change data

Declare the input schema outside the component and the action inside it, in the component that owns
the data, so it is offered only while that component is mounted:

```tsx
const approveInput = z.object({ orderId: z.string().describe("Id from get_view_state") });

useAgentAction({
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
    await api.approve(orderId);
    return { approved: orderId };
  },
});
```

- Names are relative (`orders.approve`, not `app.orders.approve`); a full name throws.
- Call the same functions the app's own buttons call. Throw an `Error` with a message the agent can act
  on (`no order 42`); it reaches the agent as `{ error }`.
- `ctx.principal` says whose agent turn made the call. Refuse `mixed` and `unknown` when the action acts
  for one person. It is not for authorisation: the app's own login still decides.
- The adapter logs every call in the activity log (`useSkailifyActivity`) and, after an effect, waits
  for React to render and sends the view report and `settled` itself.

## Step 5: verify

Run each of these and report exactly which you ran and what happened.

1. The adapter's own tests, in this repository: `bun install`, then in `frontend/react`
   `bun run test` (22 pass) and `bun run type-check`.
2. The app SDK's conformance checks: `bun run conformance` in `frontend/react` (7 pass). For the app
   itself, copy `test/conformance/conformance.test.ts`, create the client with
   `transport: gateway.transport()` and register your own actions.
3. The app's own type-check and build pass, and the app works as before when it is opened on its own
   (the status is `standalone`).
4. In a Skaile session with the app declared `"protocol": true`: ask the agent what the app shows. It
   should call `get_view_state` and describe the view. Ask it to change something behind an action
   with `requiresApproval: true`: an approval card appears, and the app changes only after you approve.

## Known limits

- Actions come from the browser: they exist only while the app is open in the session and their
  component is mounted. A server-side connection, so a backend can offer them without an open tab, is
  planned on the platform side.
- Settling waits for the next rendered frame and for every mounted view to stop loading. Data an app
  fetches without telling `useAgentView` is not waited for.
- `useAgentView`, `useAgentState` and the action declaration are compared as JSON on every render:
  keep them small.
