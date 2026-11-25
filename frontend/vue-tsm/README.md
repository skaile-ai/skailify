<!-- SPDX-License-Identifier: Apache-2.0 -->

# @skaile/skailify-vue-tsm

Makes a Vue 3 app on the tsm module runtime agent-controllable inside a Skaile session, over the Skailify app channel
(`@skaile/workspaces/app-sdk`). It contains no app-specific code: the app passes in its view registry,
its router and its app id, and its views register what they show.

It connects only when the app is embedded in Skaile as a `protocol` preview app: an iframe whose URL
carries `skaileParentOrigin`. Opened on its own, the app does not connect, and registrations cost nothing.

```sh
npm install @skaile/skailify-vue-tsm
```

Contributed by Data In Motion, who built it for a Vue/tsm app of their own.

## Capabilities

The agent sees them as `app.<appId>.<name>`, because the platform puts the app id in front of each name. `capabilityPrefix` adds a segment of your own if you need one.

| Name | Kind | What it does |
|---|---|---|
| `list_views` | query | The views from the registry: id, title, whether they are in the menu, and the object types they open |
| `get_view_state` | query | The current view and selection, the visible list rows (ids and labels, capped), the open forms with field values, empty required fields and view messages, and the actions available now |
| `navigate` | effect | Show a view, optionally with `?<selectionParam>=<id>` |
| `open` | effect | Open an object by type and id, in the view that declares that type |
| `select` | effect | Select a visible list row, the view's own way or through the route |
| `form.set_fields` | effect | Write field values through the UIModel's Ecore feature bindings. Each field is checked on its own, and refused fields come back as `errors: [{ field, message }]` |
| `form.submit` | effect | Save the form through the view's save. Empty required fields or the app's refusal come back as structured errors |

Views add their own actions with `registerAction` (a relative name, Zod input, `requiresApproval` for
anything that needs the user's consent). Register them in the view's setup, not when the bundle
activates: they are removed with the view, so other views do not offer them.

### Waiting for a view

The registry only sees views register and unregister, not their data arriving. So views report it:
a list or form passes `loading: () => boolean`, true while it fetches. `navigate`, `open`, `select`
and `get_view_state` wait (up to the settle timeout) until no visible list or form is loading, and
every list state carries `loading`. A view without the signal is waited for until it has registered.
The agent can choose per call:

- `wait`: `"loaded"` (default), `"registered"` or `"none"`
- `waitFor: { list?, minRows?, form? }`: until that list shows at least `minRows` rows (any list when
  unnamed) and that form is open; for views without a loading signal
- `timeoutMs`: at most 10 s

A timeout is no error: the state comes back as it is, with `settled: false`, so the agent reads again
instead of taking an empty list for an empty one. There is deliberately no "rows stopped changing"
heuristic: it cannot tell a list still loading from one that is empty.

### View state

The adapter tells the platform what is on screen, as the app SDK's view state asks. Every call that
is not a `query` (the generic ones and the views' own actions, with or without a declared `kind`) sends
`loading` when it starts. Once the last running call has ended, and once the view has settled (no list
or form loading), it reports the view (`reportView`: the view id and title, the path, the selected
object's type and id, the lists with their counts, the open forms' ids, the actions available, and
`settled`) and sends `settled`. Every navigation, the user's own included, is reported the same way. A
view still loading after the settle timeout is reported as it is, with `settled: false`, and the phase
stays `loading` until it has loaded. The call's result goes back at once; the report follows it, and a
failure to read the view is logged, never handed to the call. List rows
and field values are not in the report; the agent reads those with `get_view_state`. The SDK replays the
last report on every reconnect.

### Effect class and principal

- `effectClass: 'routine' | 'external' | 'privileged' | 'never'` on an action declares how sensitive it
  is; the platform runs it at least that strict (or stricter, by the project's floor). A class above
  `routine` needs `requiresApproval: true`. An action that breaks this rule, or names an unknown class,
  is not registered at all and an error is logged; the platform would refuse it anyway.
- Every handler gets `ctx.principal`, whose agent turn made the call: `{ kind: 'human', userId }`,
  `{ kind: 'trigger', source, userId }`, `{ kind: 'mixed', userIds }` or `{ kind: 'unknown' }`. For an
  approved action it is the turn that proposed it, not the approver. It is not used for authorization:
  the app's identity is still its own logged-in user. `audit(ctx, action, details)` writes one line with
  it to the session log; `form.submit` does so on every call.

## Wiring

The package holds one registry per page. In a tsm app whose views are separate bundles, serve it once
through the import map as a shared library, so that the shell and every bundle share that registry.
Integration step by step: [AGENTS.md](AGENTS.md).

Shell (owns the router):

```ts
startSkailify({
  appId: 'shop',                                      // the id in skaile.preview.json
  views: tsmViewSource(context, 'shop.view'),         // or your own () => ViewDescriptor[]
  router,
  resolveReference: (type, idOrName) => /* a loaded EObject */,
})
```

`tsmViewSource` reads the view services' `view`, `order`, `menu` and `objectTypes` properties and the
service's `title`. Each of these can be renamed through `TsmViewContract`.

Views:

```ts
useAgentForm({ uiModel, model: () => editing.value, submit: save, messages: () => [error.value] })
useAgentList({ rows: () => shown.value, select: (row) => open(row), loading: () => loading.value })
registerAction({ name: 'orders.approve', requiresApproval: true, kind: 'effect', input, handler })
```

### The agent button (optional)

When the app fills the screen in Skaile (on a phone, maximised, or with the chat hidden), Skaile
draws a small agent button over it that opens a compact chat with the session's agent. The button is
on by default and the user can drag it. Skaile draws it on top of the app's frame, never inside it.
The `assistant` option tells Skaile where to put it, or to leave it out:

```ts
const skailify = startSkailify({
  appId: 'shop',
  views,
  router,
  assistant: { kind: 'floating', corner: 'bottom-left' }, // or { kind: 'none' } to leave it out
})
```

`{ kind: 'floating' }` takes `corner` (`top-left`, `top-right`, `bottom-left`, `bottom-right`),
`offset` in px from that corner, the chat's `size` in px and an `accent` colour for the button; every
field is optional. Skaile treats them as hints and keeps them inside the frame. Without the option
Skaile picks the place itself. To change the hints while the app runs, for example to hide the button
over a full-screen editor, call `skailify.setAssistant({ kind: 'none' })`. Once the user has dragged the button, their place wins
over `corner` and `offset`.

### Handing work to the agent, and the signed-in user

```ts
import { AppTurnRefusedError, requestAgentTurn, useSkailifyUser } from '@skaile/skailify-vue-tsm'

const user = useSkailifyUser() // ComputedRef<{ userId, displayName?, sessionRole? } | undefined>
async function askSkaile(order: Order) {
  try {
    await requestAgentTurn({ text: 'Check this order', context: { orderId: order.id } })
  } catch (error) {
    if (error instanceof AppTurnRefusedError) notify(`Skaile did not take it: ${error.reason}`)
  }
}
```

`requestAgentTurn` starts a turn with the text as the signed-in user's message, marked as sent
through the app. It resolves once the turn started and rejects with an `AppTurnRefusedError` whose
`reason` says why not (`not_connected` before `startSkailify` or standalone, `viewer`, `rate_limited`
with `retryAfterMs`, `not_declared`, `timeout`, …). `useSkailifyUser()` follows a change of name or
role and is `undefined` standalone or while the connection is down. The handle carries the same as
`handle.requestAgentTurn`, `handle.user` and `handle.onUserChange`.

## SDK version

Peer `@skaile/workspaces` ^10.17.0, the first version with agent turns and the signed-in user;
CI tests the lowest version in that range and npm `latest`. Its app-sdk carries the effect class
and the principal itself: `effectClass` goes out on `capability_register`, and every handler gets
`ctx.principal`. A declaration the gateway would refuse
(an effect class above `routine` without `requiresApproval: true`) is not handed to the SDK, which throws
on it; the connection logs it and never registers it.

## Development

From the repository root (the JavaScript adapters share one bun workspace):

```sh
bun install
cd frontend/vue-tsm
bun run test          # type-check, then the unit tests
bun run conformance   # the app SDK's conformance checks (registerAppConformance)
```

The tests drive the adapter through the real app SDK against its fake gateway
(`@skaile/workspaces/app-sdk/testing`); `test/host.ts` adds the iframe handshake in front of it.

The peers `@emfts/core`, `@emfts/uimodel-composer` and `@eclipse-daanse/tsm` have only prereleases on
npm so far; their peer ranges are tilde ranges on the tested prerelease.

## License

Apache-2.0, see [LICENSE](../../LICENSE).
