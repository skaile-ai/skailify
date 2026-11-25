// SPDX-License-Identifier: Apache-2.0

import { afterEach, expect, test } from "bun:test";
import {
  ChangeDetectionStrategy,
  Component,
  type EnvironmentProviders,
  Input,
  inject,
  NgZone,
  type Provider,
  provideZonelessChangeDetection,
  signal,
  type Type,
  ɵNoopNgZone as NoopNgZone,
} from "@angular/core";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router, RouterOutlet } from "@angular/router";
import { createFakeGateway, type FakeGateway, type FakeGatewayOptions } from "@skaile/workspaces/app-sdk/testing";
import { type AppLogger, noopLogger } from "@skaile/workspaces/app-sdk";
import { patchState, signalStore, withMethods, withState } from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { createAction, createSelector, props, provideStore } from "@ngrx/store";
import { tap } from "rxjs";
import * as z from "zod";
import {
  AppTurnRefusedError,
  injectAgentAction,
  injectAgentState,
  injectAgentView,
  injectRequestAgentTurn,
  injectSkailifyUser,
  provideSkailify,
  SKAILIFY,
  type Skailify,
} from "../../src/index.ts";
import { actionName, exposeStore, storeAction } from "../../src/ngrx.ts";
import { exposeSignalStore } from "../../src/ngrx-signals.ts";
import { routerNavigation } from "../../src/router.ts";
import { KanbanAppComponent, kanbanProviders } from "../kanban/kanban.app.ts";

let gateway: FakeGateway | undefined;

afterEach(async () => {
  TestBed.resetTestingModule();
  await gateway?.close();
  gateway = undefined;
});


async function mount<T>(
  component: Type<T>,
  providers: (g: FakeGateway) => Array<Provider | EnvironmentProviders> = (g) => [
    provideSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger: noopLogger }),
  ],
  gatewayOptions: FakeGatewayOptions = {},
): Promise<{ gateway: FakeGateway; client: Skailify; fixture: ComponentFixture<T>; el: HTMLElement }> {
  gateway = createFakeGateway(gatewayOptions);
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...providers(gateway)] });
  const fixture = TestBed.createComponent(component);
  fixture.autoDetectChanges();
  const client = TestBed.inject(SKAILIFY);
  await client.start();
  await fixture.whenStable();
  return { gateway, client, fixture, el: fixture.nativeElement as HTMLElement };
}

const mountKanban = () => mount(KanbanAppComponent, (g) => kanbanProviders({ transport: g.transport(), reconnect: false, logger: noopLogger }));

const KANBAN_CAPABILITIES = [
  "app.get_view_state",
  "app.board.add_card",
  "app.board.move_card",
  "app.board.update_card",
  "app.board.remove_card",
  "app.filter.set_query",
  "app.filter.clear",
];

test("the kanban registers its store actions and the filter's methods, and reports its view", async () => {
  const { gateway } = await mountKanban();
  await gateway.waitFor((g) => KANBAN_CAPABILITIES.every((name) => g.capabilities.has(name)));
  expect([...gateway.capabilities.keys()].sort()).toEqual([...KANBAN_CAPABILITIES].sort());
  gateway.expectRegistered("app.board.remove_card", { requiresApproval: true, kind: "effect" });
  gateway.expectRegistered("app.board.add_card", { kind: "effect" });
  await gateway.waitFor((g) => g.view.report?.viewId === "board");
  expect(gateway.view.report).toMatchObject({ viewId: "board", title: "Kanban board", state: { cards: 4, query: "" } });
});

test("the agent reads the store, dispatches actions, and the DOM follows before the call settles", async () => {
  const { gateway, el } = await mountKanban();
  await gateway.waitFor((g) => g.capabilities.has("app.board.add_card"));

  const state = (await gateway.invoke("app.get_view_state")) as {
    state: { board: { id: string; cards: { id: string }[] }[]; filter: { query: string } };
  };
  expect(state.state.board.map((c) => c.cards.length)).toEqual([2, 1, 1]);
  expect(state.state.filter).toEqual({ query: "" });

  const added = (await gateway.invoke("app.board.add_card", { columnId: "todo", title: "QA the deck" })) as { cardId: string };
  expect(added).toEqual({ cardId: "card-5" });
  const view = await gateway.waitForSettled();
  expect(view.report?.state).toEqual({ cards: 5, query: "" });
  expect(el.querySelector('[data-column="todo"] [data-card="card-5"]')?.textContent).toContain("QA the deck");

  expect(await gateway.invoke("app.board.move_card", { cardId: "card-3", columnId: "done" })).toEqual({
    dispatched: "[Board] Move Card",
  });
  await gateway.waitForSettled();
  expect(el.querySelector('[data-column="done"] [data-card="card-3"]')).not.toBeNull();
});

test("invalid input and refused guards come back as errors the agent can read, and nothing is dispatched", async () => {
  const { gateway, el } = await mountKanban();
  await gateway.waitFor((g) => g.capabilities.has("app.board.update_card"));
  const refused = (await gateway.invoke("app.board.update_card", { cardId: "card-1" })) as { error: string };
  expect(refused.error).toContain("provide title and/or description");
  expect(await gateway.invoke("app.board.remove_card", { cardId: "card-99" })).toEqual({ error: 'no card with id "card-99"' });
  expect(el.querySelectorAll("[data-card]")).toHaveLength(4);
});

test("the agent calls a SignalStore method, and the filter's state and the DOM follow", async () => {
  const { gateway, el } = await mountKanban();
  await gateway.waitFor((g) => g.capabilities.has("app.filter.set_query"));
  expect(await gateway.invoke("app.filter.set_query", { query: "deck" })).toEqual({ called: "setQuery" });
  expect((await gateway.waitForSettled()).report?.state).toEqual({ cards: 4, query: "deck" });
  expect([...el.querySelectorAll("[data-card]")].map((c) => c.getAttribute("data-card"))).toEqual(["card-3"]);
  const state = (await gateway.invoke("app.get_view_state")) as { state: { filter: { query: string } } };
  expect(state.state.filter).toEqual({ query: "deck" });
  await gateway.invoke("app.filter.clear");
  await gateway.waitForSettled();
  expect(el.querySelectorAll("[data-card]")).toHaveLength(4);
});

test("the activity panel and status pill show the agent's calls", async () => {
  const { gateway, el } = await mountKanban();
  await gateway.waitFor((g) => g.capabilities.has("app.board.remove_card"));
  await gateway.invoke("app.board.remove_card", { cardId: "card-1" });
  await gateway.waitForSettled();
  expect(el.querySelector(".pill")?.getAttribute("data-status")).toBe("connected");
  const lines = [...el.querySelectorAll(".activity li")].map((li) => li.textContent?.trim());
  expect(lines.slice(0, 2)).toEqual(['board.remove_card {"removed":"card-1"}', 'board.remove_card {"cardId":"card-1"}']);
  expect(el.querySelector(".caps")?.textContent).toContain("app.board.remove_card effect (approval)");
  expect(el.querySelector('[data-card="card-1"]')).toBeNull();
});

test("the app's own buttons dispatch the same actions", async () => {
  const { gateway, el } = await mountKanban();
  (el.querySelector('[data-card="card-2"] .remove') as HTMLButtonElement).click();
  await gateway.waitFor((g) => (g.view.report?.state as { cards: number } | undefined)?.cards === 3);
});

// A setter input that feeds a signal: under JIT without Angular's compiler plugin, signal `input()`s are not seen.
@Component({
  selector: "t-detail",
  template: `<p>detail {{ id() }}</p>`,
})
class DetailComponent {
  readonly id = signal("");
  @Input({ required: true }) set detailId(value: string) {
    this.id.set(value);
  }
  constructor() {
    injectAgentView(() => ({ id: `detail/${this.id()}`, title: `Detail ${this.id()}` }));
    injectAgentAction({
      name: "detail.close",
      description: "Close the detail.",
      input: z.object({}),
      handler: async () => ({ closed: this.id() }),
    });
  }
}

@Component({
  selector: "t-shell",
  imports: [DetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (open(); as id) { <t-detail [detailId]="id" /> } @else { <p>home</p> }`,
})
class ShellComponent {
  readonly open = signal<string | null>(null);
  constructor() {
    injectAgentView({ id: "home" });
    injectAgentState("shell", this.open);
    injectAgentAction({
      name: "detail.open",
      description: "Open a detail.",
      input: z.object({ id: z.string() }),
      handler: async ({ id }) => {
        const wasOpen = this.open();
        this.open.set(id);
        return { opening: id, wasOpen };
      },
    });
  }
}

test("a component's actions and view live as long as it does, and handlers see its current state", async () => {
  const { gateway, el } = await mount(ShellComponent);
  await gateway.waitFor((g) => g.capabilities.has("app.detail.open"));
  expect(gateway.capabilities.has("app.detail.close")).toBe(false);

  expect(await gateway.invoke("app.detail.open", { id: "a" })).toEqual({ opening: "a", wasOpen: null });
  expect((await gateway.waitForSettled()).report?.viewId).toBe("detail/a");
  expect(el.textContent).toContain("detail a");
  await gateway.waitFor((g) => g.capabilities.has("app.detail.close"));
  expect(await gateway.invoke("app.detail.close")).toEqual({ closed: "a" });

  // an input change updates the same view; the action is not registered again
  expect(await gateway.invoke("app.detail.open", { id: "b" })).toEqual({ opening: "b", wasOpen: "a" });
  expect((await gateway.waitForSettled()).report?.viewId).toBe("detail/b");
  expect(await gateway.invoke("app.detail.close")).toEqual({ closed: "b" });
  const registrations = gateway.frames.filter(
    (f) => f.message.type === "capability_register" && JSON.stringify(f.message).includes("app.detail.close"),
  );
  expect(registrations).toHaveLength(1);
  const state = (await gateway.invoke("app.get_view_state")) as { state: { shell: string } };
  expect(state.state.shell).toBe("b");
});

test("destroying a component removes its actions and the view falls back", async () => {
  const { gateway, fixture } = await mount(ShellComponent);
  await gateway.invoke("app.detail.open", { id: "a" });
  await gateway.waitFor((g) => g.capabilities.has("app.detail.close"));
  fixture.componentInstance.open.set(null);
  await gateway.waitFor((g) => !g.capabilities.has("app.detail.close") && g.view.report?.viewId === "home");
  fixture.destroy();
  await gateway.waitFor((g) => !g.capabilities.has("app.detail.open") && g.view.report?.viewId === "kanban");
});

@Component({ selector: "t-inner", template: `<p>card</p>` })
class InnerComponent {
  constructor() {
    injectAgentView({ id: "card/7", title: "Card 7" });
  }
}

@Component({ selector: "t-outer", imports: [InnerComponent], template: `<t-inner />` })
class OuterComponent {
  constructor() {
    injectAgentView(() => ({ id: "board" }));
  }
}

test("a view and the view it contains report the inner one", async () => {
  const { gateway, client } = await mount(OuterComponent);
  await gateway.waitFor((g) => g.view.report?.viewId === "card/7");
  expect(client.currentView()?.id).toBe("card/7");
});

@Component({ selector: "t-big", template: `<p>still rendered</p>` })
class UnserialisableComponent {
  constructor() {
    injectAgentView({ id: "v", state: { big: 1n } });
  }
}

test("state that is not JSON-serialisable breaks neither rendering nor get_view_state, and is logged once", async () => {
  const errors: string[] = [];
  const logger: AppLogger = { ...noopLogger, error: (message: string) => void errors.push(message) };
  const { el, gateway, client } = await mount(UnserialisableComponent, (g) => [
    provideSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger }),
  ]);
  client.registerState("good", () => ({ ok: 1 }));
  client.registerState("bad", () => ({ big: 2n }));
  await gateway.waitFor((g) => g.view.report?.viewId === "v");
  expect(gateway.view.report?.state).toEqual({ error: "state is not JSON-serialisable" });
  expect(el.textContent).toBe("still rendered");
  expect(await gateway.invoke("app.get_view_state")).toMatchObject({
    view: { id: "v", state: { error: "state is not JSON-serialisable" } },
    state: { good: { ok: 1 }, bad: { error: "state is not JSON-serialisable" } },
  });
  await gateway.invoke("app.get_view_state");
  expect(errors.filter((e) => e.includes("not JSON-serialisable"))).toHaveLength(1);
});

@Component({ selector: "t-orders", template: `<p>orders</p>` })
class ScopedStoreComponent {
  constructor() {
    exposeStore({
      state: { count: (s: object) => Object.keys(s).length },
      actions: [storeAction(createAction("[Orders] Refresh"), { description: "Refresh the orders." })],
    });
  }
}

test("exposeStore offers store actions for as long as the component lives", async () => {
  const { gateway, fixture } = await mount(ScopedStoreComponent, (g) => [
    provideStore({ orders: (s: number = 0) => s }),
    provideSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger: noopLogger }),
  ]);
  await gateway.waitFor((g) => g.capabilities.has("app.orders.refresh"));
  expect(await gateway.invoke("app.orders.refresh")).toEqual({ dispatched: "[Orders] Refresh" });
  const state = (await gateway.invoke("app.get_view_state")) as { state: { count: number } };
  expect(state.state.count).toBe(1);
  fixture.destroy();
  await gateway.waitFor((g) => !g.capabilities.has("app.orders.refresh"));
});

test("without provideSkailify, the inject functions say what is missing", () => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  expect(() => TestBed.createComponent(InnerComponent)).toThrow("add provideSkailify({ appId }) to the app's providers");
});

test("outside an injection context, the inject functions say so", () => {
  expect(() => injectAgentState("x", () => 1)).toThrow();
});

test("the client starts with the app and closes when the app is destroyed", async () => {
  const { client } = await mount(InnerComponent);
  expect(client.getSnapshot().status.state).toBe("connected");
  TestBed.resetTestingModule();
  await gateway!.waitFor(() => client.getSnapshot().status.state === "closed").catch(() => undefined);
  expect(client.getSnapshot().status.state).toBe("closed");
});

@Component({ selector: "t-page", template: `<p>page</p>` })
class PageComponent {}

@Component({ selector: "t-routed", imports: [RouterOutlet], template: `<router-outlet />` })
class RoutedComponent {}

const routedProviders = (g: FakeGateway) => [
  provideRouter([
    { path: "", component: PageComponent },
    { path: "cards/:cardId", component: PageComponent },
    { path: "locked", component: PageComponent, canActivate: [() => false] },
    { path: "cards/new", component: PageComponent },
  ]),
  provideSkailify({
    appId: "kanban",
    transport: g.transport(),
    reconnect: false,
    logger: noopLogger,
    navigation: routerNavigation([
      { id: "board", title: "Board", path: "" },
      { id: "card", title: "Card", path: "cards/:cardId", menu: false, params: { cardId: "the card to open" } },
      { id: "locked", title: "Locked", path: "locked" },
      { id: "new-card", title: "New card", path: "cards/new" },
    ]),
  }),
];

test("routerNavigation lists the views and navigates the Router, filling path and query parameters", async () => {
  const { gateway } = await mount(RoutedComponent, routedProviders);
  const router = TestBed.inject(Router);
  await gateway.waitFor((g) => g.capabilities.has("app.navigate"));
  expect(await gateway.invoke("app.list_views")).toEqual({
    current: "board",
    views: [
      { id: "board", title: "Board" },
      { id: "card", title: "Card", menu: false, params: { cardId: "the card to open" } },
      { id: "locked", title: "Locked" },
      { id: "new-card", title: "New card" },
    ],
  });

  const shown = (await gateway.invoke("app.navigate", { view: "card", params: { cardId: "card 7", tab: "notes" } })) as {
    view: { id: string };
    settled: boolean;
  };
  expect(router.url).toBe("/cards/card%207?tab=notes");
  expect(shown).toMatchObject({ view: { id: "card" }, settled: true });

  expect(await gateway.invoke("app.navigate", { view: "card" })).toEqual({ error: "view card needs cardId" });
  // the view already on screen: not an error
  expect(await gateway.invoke("app.navigate", { view: "card", params: { cardId: "card 7", tab: "notes" } })).toMatchObject({
    view: { id: "card" },
  });
  // the most specific view wins, whatever the order; matrix params do not hide a match
  await router.navigateByUrl("/cards/new");
  expect(TestBed.inject(SKAILIFY).currentView()?.id).toBe("new-card");
  await router.navigateByUrl("/cards/7;tab=notes");
  expect(TestBed.inject(SKAILIFY).currentView()?.id).toBe("card");
  expect(await gateway.invoke("app.navigate", { view: "locked" })).toEqual({
    error: "navigation to /locked was cancelled (a guard, or a newer navigation)",
  });
  expect(await gateway.invoke("app.navigate", { view: "nope" })).toEqual({ error: "no view nope; views: board, card, locked, new-card" });
});

test("store action names come from the action's type", () => {
  expect(actionName("[Board] Add Card")).toBe("board.add_card");
  expect(actionName("[Board Page] Card Moved")).toBe("board_page.card_moved");
  expect(actionName("resetAll")).toBe("store.reset_all");
});

test("a store action whose creator takes props needs an input schema", () => {
  const withProps = createAction("[X] Do", props<{ id: string }>());
  const without = createAction("[X] Reset");
  expect(() => storeAction(withProps, { description: "Do." })).toThrow("takes props");
  expect(storeAction(without, { description: "Reset." }).creator).toBe(without);
  // the schema is checked against the creator's props at compile time
  // @ts-expect-error: id is a string in the props
  storeAction(withProps, { description: "Do.", input: z.object({ id: z.number() }) });
});

const RxStore = signalStore(
  withState({ seen: [] as string[] }),
  withMethods((store) => ({
    track: rxMethod<string>(tap((id) => patchState(store, { seen: [...store.seen(), id] }))),
    count: () => ({ seen: store.seen().length }),
  })),
);

@Component({ selector: "t-rx", providers: [RxStore], template: `<p>rx</p>` })
class RxComponent {
  constructor() {
    exposeSignalStore(inject(RxStore), {
      name: "rx",
      methods: {
        track: { description: "Track an id.", input: z.object({ id: z.string() }), args: ["id"] },
        count: { description: "Count.", kind: "query" },
      },
    });
  }
}

test("an rxMethod answers { called }, a method returning data answers the data", async () => {
  const { gateway } = await mount(RxComponent);
  await gateway.waitFor((g) => g.capabilities.has("app.rx.track"));
  expect(await gateway.invoke("app.rx.track", { id: "a" })).toEqual({ called: "track" });
  expect(await gateway.invoke("app.rx.count")).toEqual({ seen: 1 });
  expect((await gateway.invoke("app.get_view_state")) as object).toMatchObject({ state: { rx: { seen: ["a"] } } });
});

test("args without an input schema are refused at registration", () => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideSkailify({ appId: "kanban", enabled: false, logger: noopLogger })],
  });
  const store = TestBed.runInInjectionContext(() => new (signalStore(withMethods(() => ({ go: (_x: string) => undefined }))))());
  expect(() =>
    TestBed.runInInjectionContext(() => exposeSignalStore(store, { name: "s", methods: { go: { description: "Go.", args: ["x"] } } })),
  ).toThrow("names args but has no input schema");
});

interface AppState {
  orders: { ids: string[] };
}
const selectOrderIds = createSelector(
  (s: AppState) => s.orders,
  (o) => o.ids,
);

@Component({ selector: "t-typed", template: `<p>typed</p>` })
class TypedStateComponent {
  constructor() {
    exposeStore({
      state: { ids: selectOrderIds }, // typed on the app's root state
      actions: [
        storeAction(createAction("[Orders] Approve", props<{ id: string }>()), {
          description: "Approve.",
          input: z.object({ id: z.string() }),
          guard: ({ id }, store) => {
            if (!store.selectSignal(selectOrderIds)().includes(id)) throw new Error(`no order ${id}`);
          },
        }),
      ],
    });
  }
}

test("selectors typed on the app's root state work for state and in guards", async () => {
  const { gateway } = await mount(TypedStateComponent, (g) => [
    provideStore({ orders: (s: { ids: string[] } = { ids: ["o1"] }) => s }),
    provideSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger: noopLogger }),
  ]);
  await gateway.waitFor((g) => g.capabilities.has("app.orders.approve"));
  expect(await gateway.invoke("app.orders.approve", { id: "o2" })).toEqual({ error: "no order o2" });
  expect(await gateway.invoke("app.orders.approve", { id: "o1" })).toEqual({ dispatched: "[Orders] Approve" });
  expect((await gateway.invoke("app.get_view_state")) as object).toMatchObject({ state: { ids: ["o1"] } });
});

test("a creator without props takes no input schema (compile time)", () => {
  const reset = createAction("[X] Reset");
  // @ts-expect-error: the creator has no props, so an input schema would be dropped
  storeAction(reset, { description: "Reset.", input: z.object({ anything: z.number() }) });
});

/** Records where the client runs things: the connection and settling outside the zone, handlers inside. */
class RecordingZone extends NoopNgZone {
  readonly calls: string[] = [];
  override run<T>(fn: (...args: unknown[]) => T): T {
    this.calls.push("inside");
    return fn();
  }
  override runOutsideAngular<T>(fn: (...args: unknown[]) => T): T {
    this.calls.push("outside");
    return fn();
  }
}

test("provideSkailify connects and settles outside the Angular zone, and runs handlers inside it", async () => {
  const zone = new RecordingZone();
  const { gateway } = await mount(ShellComponent, (g) => [
    { provide: NgZone, useValue: zone },
    provideSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger: noopLogger }),
  ]);
  expect(zone.calls[0]).toBe("outside"); // start()
  zone.calls.length = 0;
  await gateway.invoke("app.detail.open", { id: "a" });
  expect(zone.calls.slice(0, 2)).toEqual(["inside", "outside"]); // the handler, then settling
});

async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

@Component({
  selector: "t-ask",
  template: `<p class="user">{{ user() ? user()?.displayName + " (" + user()?.sessionRole + ")" : "nobody" }}</p>`,
})
class AskSkaileComponent {
  readonly user = injectSkailifyUser();
  readonly ask = injectRequestAgentTurn();
}

test("injectRequestAgentTurn hands work to the agent and resolves when the turn starts", async () => {
  const seen: { text: string; context?: unknown }[] = [];
  const { fixture } = await mount(AskSkaileComponent, undefined, { answerTurn: (request) => void seen.push(request) });
  await fixture.componentInstance.ask({ text: "Review this card", context: { cardId: "card-1" } });
  expect(seen).toMatchObject([{ text: "Review this card", context: { cardId: "card-1" } }]);
});

test("injectRequestAgentTurn rejects with the reason when the turn is refused", async () => {
  const { fixture } = await mount(AskSkaileComponent, undefined, { answerTurn: () => ({ reason: "rate_limited", retryAfterMs: 500 }) });
  const error = await fixture.componentInstance.ask({ text: "Again" }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppTurnRefusedError);
  expect(error).toMatchObject({ reason: "rate_limited", retryAfterMs: 500 });
});

test("injectRequestAgentTurn settles inside the Angular zone, for accept and refuse", async () => {
  const zone = new RecordingZone();
  let refuse = false;
  const { fixture } = await mount(
    AskSkaileComponent,
    (g) => [
      { provide: NgZone, useValue: zone },
      provideSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger: noopLogger }),
    ],
    { answerTurn: () => (refuse ? { reason: "viewer" } : undefined) },
  );
  zone.calls.length = 0;
  await fixture.componentInstance.ask({ text: "Go" });
  expect(zone.calls.at(-1)).toBe("inside");
  zone.calls.length = 0;
  refuse = true;
  await fixture.componentInstance.ask({ text: "Again" }).catch(() => undefined);
  expect(zone.calls.at(-1)).toBe("inside");
});

test("injectSkailifyUser is a signal of the signed-in user that follows user_update", async () => {
  const { gateway, fixture, el } = await mount(AskSkaileComponent, undefined, { userId: "u1", displayName: "Ada", sessionRole: "Owner" });
  expect(fixture.componentInstance.user()).toEqual({ userId: "u1", displayName: "Ada", sessionRole: "Owner" });
  expect(el.querySelector(".user")?.textContent).toBe("Ada (Owner)");
  gateway.userUpdate({ sessionRole: "Viewer" });
  await until(() => fixture.componentInstance.user()?.sessionRole === "Viewer");
  await fixture.whenStable();
  expect(el.querySelector(".user")?.textContent).toBe("Ada (Viewer)");
  gateway.drop();
  await until(() => fixture.componentInstance.user() === undefined);
});
