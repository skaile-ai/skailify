<!-- SPDX-License-Identifier: Apache-2.0 -->

# @skaile/skailify-angular

Makes an Angular app agent-controllable inside a Skaile session, over the Skailify app channel
(`@skaile/workspaces/app-sdk`). It contains no app-specific code. The app provides one client with
its app id. Its components then say, while they live, which view they show, what state the agent may
read and which actions it may call. If the app keeps its state in NgRx, the agent can dispatch the
store's actions and read its selectors directly.

It connects only when the app is embedded in Skaile as a preview app with the app channel switched
on (`"protocol": true`): an iframe whose URL carries `skaileParentOrigin`. Opened on its own, the app
does not connect, and the registrations cost next to nothing.

```sh
npm install @skaile/skailify-angular @skaile/workspaces zod
```

| Entry point | For |
|---|---|
| `@skaile/skailify-angular` | `provideSkailify`, `injectAgentView`, `injectAgentState`, `injectAgentAction`, the status, activity and capabilities signals |
| `@skaile/skailify-angular/router` | `routerNavigation`: the agent's `list_views` and `navigate` over the Angular Router |
| `@skaile/skailify-angular/ngrx` | `provideSkailifyStore`, `exposeStore`, `storeActions`: NgRx Store actions and selectors |
| `@skaile/skailify-angular/ngrx-signals` | `exposeSignalStore`: an NgRx SignalStore's methods and state |

The Router and NgRx are optional peers: an app that does not use them does not install them.

## Capabilities

The agent sees each one as `app.<appId>.<name>`, because the platform puts the app id in front of
every name.

| Name | Kind | When | What it does |
|---|---|---|---|
| `get_view_state` | query | always | The view on screen (id, title, summary), the state the app exposes, and the actions available now. Waits until no view is loading |
| `list_views` | query | with `navigation` | The app's views: id, title, whether they are in the menu, and the parameters they take |
| `navigate` | effect | with `navigation` | Shows a view with its parameters, waits until it has loaded, and returns the view state |
| store actions | effect | with `provideSkailifyStore` / `exposeStore` | Dispatches an NgRx action: `[Board] Add Card` becomes `board.add_card` |
| store methods | effect | with `exposeSignalStore` | Calls a SignalStore method: `addCard` on the `board` store becomes `board.add_card` |
| your actions | query / effect | while the component or service that registers them lives | Whatever `injectAgentAction` declares |

Declare every action that changes data with `requiresApproval: true`, and optionally give it an
`effectClass`. The platform then asks the user before it forwards the call. An action with an effect
class above `routine` and no `requiresApproval` is not registered at all, and an error is logged,
because the platform would refuse it.

### Views, loading and settled

The app SDK's conformance checks require a view report and `settled` after every call that changes
the view, so the agent can wait for the screen to be ready before it reads it. Today the platform
accepts these frames and drops them; the agent reads the screen with `get_view_state`, which waits
on its own. The adapter sends the frames for you:

- `loading` when an effect starts (a store action, a store method, `navigate`, your own effects) or
  a view starts loading;
- after every effect, once Angular is stable (`ApplicationRef.whenStable()`), the browser has drawn
  a frame and no view says it is loading: a fresh view report and `settled`, unless another effect is
  still running;
- `settled` whenever a view stops loading and nothing else is running.

This works with zoneless change detection and with zone.js. Under zone.js, the adapter keeps its
connection and its own timers outside the Angular zone, so they never hold the app back from
becoming stable, and it runs the handlers inside the zone, so the app renders what they change. An
app with a timer of its own that never stops never becomes stable: settling then gives up on
stability after a second and looks at the screen anyway.

While disconnected, the adapter keeps both up to date, and the SDK replays them on reconnect. The view
on screen is the innermost one: when one view contains another, the inner one counts.

A view says it is loading with `loading: true` while it fetches what it shows. A call waits at most
`settleTimeoutMs` (default 3 s, at most 10 s). When the wait times out, the answer carries
`settled: false`, so the agent reads again instead of taking a half-loaded list for an empty one.

## Wiring

In `app.config.ts`:

```ts
import { provideSkailify } from "@skaile/skailify-angular";
import { routerNavigation } from "@skaile/skailify-angular/router";

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideSkailify({
      appId: "kanban", // the id in skaile.preview.json
      navigation: routerNavigation([
        { id: "board", title: "Board", path: "" },
        { id: "card", title: "Card", path: "cards/:cardId", menu: false, params: { cardId: "the card to open" } },
      ]),
    }),
  ],
};
```

The client starts when the app boots and closes when it is destroyed. In a component:

```ts
export class OrdersComponent {
  private readonly api = inject(OrdersApi);
  readonly rows = signal<Order[]>([]);
  readonly loading = signal(true);

  constructor() {
    injectAgentView(() => ({ id: "orders", title: "Orders", state: { shown: this.rows().length }, loading: this.loading() }));
    injectAgentState("orders", () => this.rows().map((o) => ({ id: o.id, label: o.number, status: o.status })));
    injectAgentAction({
      name: "orders.approve",          // relative: the agent sees app.<appId>.orders.approve
      description: "Approve an order by id.",
      input: approveInput,             // a Zod schema
      kind: "effect",
      requiresApproval: true,
      handler: async ({ orderId }) => {
        await this.api.approve(orderId);
        return { approved: orderId };
      },
    });
  }
}
```

A view given as a function is read in an `effect`, so it follows the signals (and signal inputs) it
reads. The registrations are removed when the component is destroyed. Outside a constructor or field
initialiser, pass `{ injector }`.

For a panel in the app's own UI: `injectSkailifyStatus()`, `injectSkailifyCapabilities()` and
`injectSkailifyActivity()` return signals (the activity is the agent's latest calls and the
connection events, newest first).

### Handing work to the agent, and the signed-in user

```ts
@Component({
  selector: "app-ask",
  template: `<button [disabled]="!user() || user()?.sessionRole === 'Viewer'" (click)="ask()">Ask Skaile</button>`,
})
export class AskSkaileComponent {
  readonly cardId = input.required<string>();
  readonly user = injectSkailifyUser(); // Signal<{ userId, displayName?, sessionRole? } | undefined>
  private readonly requestAgentTurn = injectRequestAgentTurn();
  ask() {
    this.requestAgentTurn({ text: "Review this card", context: { cardId: this.cardId() } }).catch(showError);
  }
}
```

`requestAgentTurn` starts a turn with the text as the signed-in user's message, marked as sent
through the app. It resolves once the turn started and rejects with an `AppTurnRefusedError` whose
`reason` says why not (`not_connected`, `viewer`, `rate_limited` with `retryAfterMs`, `not_declared`,
`timeout`, …). The user signal follows a change of name or role, and is `undefined` standalone or
while the connection is down.

### The agent button (optional)

When the app fills the screen in Skaile (on a phone, maximised, or with the chat hidden), Skaile
draws a small agent button over it that opens a compact chat with the session's agent. The button is
on by default and the user can drag it. Skaile draws it on top of the app's frame, never inside it.
The `assistant` option tells Skaile where to put it, or to leave it out:

```ts
provideSkailify({
  appId: "kanban",
  assistant: { kind: "floating", corner: "bottom-left" }, // or { kind: "none" } to leave it out
});
```

`{ kind: "floating" }` takes `corner` (`top-left`, `top-right`, `bottom-left`, `bottom-right`),
`offset` in px from that corner, the chat's `size` in px and an `accent` colour for the button; every
field is optional. Skaile treats them as hints and keeps them inside the frame. Without the option
Skaile picks the place itself. To change the hints while the app runs, for example to hide the button
over a full-screen editor, call `injectSkailify().setAssistant({ kind: "none" })`. Once the user has dragged the button, their place wins
over `corner` and `offset`.

### NgRx Store

The agent dispatches the same actions the app's buttons dispatch. NgRx keeps no runtime schema of an
action's props, so each one gets a Zod schema; TypeScript checks it against the props:

```ts
provideStore({ board: boardReducer }),
provideSkailify({ appId: "kanban" }),
provideSkailifyStore({
  state: { board: selectBoardSummary },            // selectors, read on every get_view_state
  actions: storeActions(BoardActions, {            // an action group; storeAction(creator, ...) for one creator
    addCard: {
      description: "Add a card to a column.",
      input: z.object({ columnId: z.enum(["todo", "doing", "done"]), title: z.string().min(1) }),
    },
    removeCard: {
      description: "Remove a card by id.",
      input: z.object({ cardId: z.string() }),
      requiresApproval: true,
      guard: ({ cardId }, store) => {               // reducers cannot refuse: refuse here
        if (!store.selectSignal(selectCards)().some((c) => c.id === cardId)) throw new Error(`no card ${cardId}`);
      },
      result: ({ cardId }) => ({ removed: cardId }), // default: { dispatched: "[Board] Remove Card" }
    },
  }),
}),
```

The name comes from the action's type (`[Board] Remove Card` becomes `board.remove_card`) unless you
give one. Only the actions you list are offered. Selectors may be typed on the app's own root state.
Creators made with `props<...>()` (or without props) are supported; function creators
(`createAction(type, (a, b) => ...)`) are not. `exposeStore(config)` does the same for as long as a
component or service lives.

### NgRx SignalStore

```ts
export class BoardComponent {
  readonly filter = inject(FilterStore);
  constructor() {
    exposeSignalStore(this.filter, {
      name: "filter",                                // prefix of the names, and the state's name
      methods: {
        setQuery: { description: "Filter cards by title.", input: z.object({ query: z.string() }), args: ["query"] },
        clear: { description: "Show all cards." },
      },
    });
  }
}
```

`get_view_state` shows the store's whole state under `filter`; pass `state: (store) => ...` for a
smaller projection, or `state: false`. `args` passes input keys as positional arguments; without it,
the method gets the input object as its single argument. A method that returns data answers the
agent with it; one that returns nothing, or a handle such as an `rxMethod`'s, answers
`{ called: "<method>" }`.

## Example

[`test/kanban/`](test/kanban/) is a small kanban board made agent-controllable with this adapter:
- an NgRx Store board whose four actions the agent dispatches (deleting needs approval);
- a selector the agent reads;
- a SignalStore search filter;
- a panel with the status, the capabilities and the agent's calls.

The tests drive it through the app SDK's fake gateway.

## Versions

- Peer `@angular/core` 20, 21 or 22, and NgRx 20 to 22 for the NgRx entry points.
- Peer `@skaile/workspaces` ^10.17.0, the first version with agent turns and the signed-in user.
- CI runs the tests and the conformance checks with Angular 22 against the lowest and the latest
  version in that range.
- Angular 20.0 with NgRx 20.0 and SDK 10.4.0 were tested by hand.
- zone.js was tested by hand in an Angular CLI app over a real WebSocket: an agent's call settles in
  milliseconds, and a handler's change to a plain field is rendered. (The unit tests run on bun,
  whose native `async`/`await` zone.js cannot follow; they check only that the adapter uses `NgZone`
  as described.)

## Development

```sh
bun install            # at the repository root
cd frontend/angular
bun run test           # unit tests: a DOM (happy-dom) and Angular's JIT compiler
bun run conformance    # the app SDK's conformance checks
bun run type-check
```

The tests compile the components at runtime (JIT), without Angular's compiler plugin. A test
component therefore declares its inputs with `@Input`; signal `input()`s need the plugin, which every
app build has.

## License

Apache-2.0, see [LICENSE](../../LICENSE).
