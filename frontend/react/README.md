<!-- SPDX-License-Identifier: Apache-2.0 -->

# @skaile/skailify-react

Makes a React app agent-controllable inside a Skaile session, over the Skailify app channel
(`@skaile/workspaces/app-sdk`). It contains no app-specific code: the app creates one client with its
app id, and its components say, while they are mounted, which view they show, what state the agent
may read and which actions it may call. It is router-agnostic.

It connects only when the app is embedded in Skaile as a preview app with the app channel switched
on (`"protocol": true`): an iframe whose URL carries `skaileParentOrigin`. Opened on its own, the app
does not connect, and the hooks cost next to nothing.

## Capabilities

The agent sees each one as `app.<appId>.<name>`, because the platform puts the app id in front of
every name.

| Name | Kind | When | What it does |
|---|---|---|---|
| `get_view_state` | query | always | The view on screen (id, title, summary), the state the mounted components expose, and the actions available now. Waits until no view is loading |
| `list_views` | query | with `navigation` | The app's views: id, title, whether they are in the menu, and the parameters they take |
| `navigate` | effect | with `navigation` | Shows a view with its parameters, waits until it has loaded, and returns the view state |
| your actions | query / effect | while the component that registers them is mounted | Whatever `useAgentAction` declares |

Actions that change data are declared with `requiresApproval: true`, and optionally an
`effectClass`; the platform then asks the user before it forwards the call. An action with an effect
class above `routine` and no `requiresApproval` is not registered at all, and an error is logged:
the platform would refuse it.

### Views, loading and settled

The app SDK's conformance checks require a view report and `settled` after every call that changes
the view, so that the agent can wait for the screen before it reads it. (Today the platform accepts
these frames and drops them; the agent reads the screen with `get_view_state`, which waits by itself.)
The adapter sends them for you:

- `loading` when an effect (your actions and `navigate`) starts or a view starts loading;
- after every effect, once React has rendered and no mounted view says it is loading, a fresh view
  report and `settled`, unless another effect is still running;
- `settled` whenever a view stops loading and nothing else is running.

While disconnected the adapter keeps both up to date, and the SDK replays them on the reconnect. The
view on screen is the innermost mounted one: of a view and the view it contains, the inner one.

A view says it is loading with `useAgentView({ id, loading: true })` while it fetches what it shows.
A call waits at most `settleTimeoutMs` (default 3 s, at most 10 s); when the wait times out the
answer carries `settled: false`, so the agent reads again instead of taking a half-loaded list for an
empty one.

## Wiring

Where the app boots:

```tsx
import { createSkailify, SkailifyProvider } from "@skaile/skailify-react";

const skailify = createSkailify({ appId: "kanban" }); // the id in skaile.preview.json
void skailify.start();

createRoot(root).render(
  <SkailifyProvider client={skailify}>
    <App />
  </SkailifyProvider>,
);
```

`start()` is called once, outside React, so React's double mount in development does not connect
twice. In a component:

```tsx
useAgentView({ id: "board", title: "Kanban board", state: { cards: cards.length } });
useAgentState("board", columns); // small and JSON-serialisable: ids and labels
useAgentAction({
  name: "board.remove_card",       // relative: the agent sees app.<appId>.board.remove_card
  description: "Remove a card from the board by id.",
  input: removeInput,              // a Zod schema, best declared outside the component
  kind: "effect",
  requiresApproval: true,
  handler: async ({ cardId }, ctx) => {
    board.removeCard(cardId);      // the handler sees the latest props and state
    return { removed: cardId };
  },
});
```

For a panel in the app's own UI: `useSkailifyStatus()`, `useSkailifyCapabilities()` and
`useSkailifyActivity()` (the agent's latest calls and the connection events, newest first).

### Navigation (optional)

Hand the client your views and how to show one, and the agent gets `list_views` and `navigate`. With
react-router:

```tsx
const router = createBrowserRouter(routes);
const skailify = createSkailify({
  appId: "kanban",
  navigation: {
    views: () => [
      { id: "board", title: "Board" },
      { id: "card", title: "Card", menu: false, params: { cardId: "the card to open" } },
    ],
    navigate: (view, params) => router.navigate(view === "card" ? `/cards/${params.cardId}` : "/"),
  },
});
```

## Example

[`test/kanban/`](test/kanban/) is a small kanban board made agent-controllable with this adapter:
one view, its cards as state, four actions (deleting needs approval) and a panel with the status,
the capabilities and the agent's calls. The tests drive it through the app SDK's fake gateway.

## SDK version

Peer `@skaile/workspaces` ^10.4.0, the first version with view reports, `loading` and `settled`, and
the conformance kit. CI runs the tests and the conformance checks against the lowest and the latest
version in that range (10.4.0 and 10.11.0 today) with React 19; React 18.3.1 was tested by hand.

## Development

```sh
bun install            # at the repository root
cd frontend/react
bun run test           # unit tests, with a DOM (happy-dom)
bun run conformance    # the app SDK's conformance checks
bun run type-check
```

## License

Apache-2.0, see [LICENSE](../../LICENSE).
