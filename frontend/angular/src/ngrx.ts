// SPDX-License-Identifier: Apache-2.0

/**
 * `@skaile/skailify-angular/ngrx`: offers NgRx Store actions to the agent, and exposes selected state to its
 * `get_view_state`. The agent's call dispatches the action, exactly as the app's own buttons do; the reducers and
 * effects run as usual, and the adapter waits for Angular to render before it answers.
 *
 * ```ts
 * provideStore({ board: boardReducer }),
 * provideSkailify({ appId: "kanban" }),
 * provideSkailifyStore({
 *   state: { board: selectBoard },
 *   actions: storeActions(BoardActions, {
 *     addCard: { description: "Add a card.", input: z.object({ title: z.string() }) },
 *     removeCard: { description: "Remove a card.", input: z.object({ id: z.string() }), requiresApproval: true },
 *   }),
 * }),
 * ```
 */
import {
  DestroyRef,
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type Signal,
} from "@angular/core";
import { type Action, type Selector, Store } from "@ngrx/store";
import * as z from "zod";
import { injectSkailify, type InjectOptions } from "./angular";
import type { AgentAction } from "./client";

/** An action creator from `createAction` or `createActionGroup`: a function with the action's `type` on it. */
// any: a creator takes whatever props its props() declare
export type StoreActionCreator = ((...props: any[]) => Action) & { readonly type: string };

/** The props an action creator takes; `void` for one without (`createAction(type)`, `emptyProps()`). */
export type PropsOf<C> = C extends () => Action ? void : C extends (props: infer P) => Action ? P : never;

/** The app's store, whatever its root state type: selectors typed on an `AppState` interface work with it. */
// any: an app's root state is its own interface, which `object` would reject under strictFunctionTypes
export type AnyStore = Store<any>;

/**
 * How the agent sees one store action: everything an agent action declares but the handler, with the name optional.
 * `P` is the creator's props, so the schema, the guard and the result are checked against them.
 */
export type StoreActionOptions<P = unknown> = Omit<AgentAction, "handler" | "name" | "input"> & {
  /** Relative name; default from the action's type: `[Board] Add Card` → `board.add_card` */
  name?: string;
  /**
   * The action's props, as a Zod schema. Required when the creator takes props: NgRx keeps no runtime schema of them.
   * The parsed input is passed to the creator as its props. Not allowed for a creator without props. Only creators
   * made with `props<...>()` are supported, not function creators (`createAction(type, (a, b) => ...)`).
   */
  input?: [P] extends [void] ? undefined : z.ZodType<P>;
  /**
   * Checked before the dispatch: throw an `Error` the agent can act on (`no card 42`) to refuse the call. Reducers
   * cannot refuse an action, so check here what would make it a no-op. Read state with `store.selectSignal(selector)()`.
   */
  guard?: (props: P, store: AnyStore) => void;
  /** What the agent gets back; default `{ dispatched: "<type>" }`. Called after the dispatch, so selectors see the new state. */
  result?: (props: P, store: AnyStore) => unknown;
};

/** A store action ready for {@link exposeStore}. */
export interface StoreAction {
  readonly creator: StoreActionCreator;
  readonly options: StoreActionOptions<never>;
}

/** Offers one action creator to the agent. */
export function storeAction<C extends StoreActionCreator>(creator: C, options: StoreActionOptions<PropsOf<C>>): StoreAction {
  if (creator.length > 0 && !options.input) {
    throw new Error(`skailify: ${creator.type} takes props; give storeAction an input schema for them`);
  }
  return { creator, options: options as StoreActionOptions<never> };
}

/** Offers the chosen creators of an action group (from `createActionGroup`) to the agent, keyed as in the group. */
export function storeActions<G extends Record<string, StoreActionCreator>>(
  group: G,
  options: { [K in keyof G]?: StoreActionOptions<PropsOf<G[K]>> },
): StoreAction[] {
  return Object.entries(options).flatMap(([key, opts]) => {
    const creator = group[key];
    if (!creator) throw new Error(`skailify: the action group has no ${key}`);
    return opts ? [storeAction(creator, opts as StoreActionOptions<PropsOf<typeof creator>>)] : [];
  });
}

/** `[Board] Add Card` → `board.add_card`; `addCard` → `store.add_card`. */
export function actionName(type: string): string {
  const match = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(type);
  const [source, event] = match ? [match[1] ?? "", match[2] ?? ""] : ["store", type];
  return `${slug(source)}.${slug(event)}`;
}

function slug(text: string): string {
  return (
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "action"
  );
}

export interface ExposeStoreConfig {
  /** The actions the agent may dispatch */
  actions?: readonly StoreAction[];
  /** Selectors whose results `get_view_state` returns, by name. Keep them small: ids and labels, not whole records. */
  // any: selectors are typed on the app's own root state
  state?: Record<string, Selector<any, unknown>>;
}

/**
 * Offers store actions and state to the agent while the calling component or service lives. Call it in an injection
 * context; for actions the app offers everywhere, use {@link provideSkailifyStore}.
 */
export function exposeStore(config: ExposeStoreConfig, options?: InjectOptions): void {
  const client = injectSkailify(options);
  const store: AnyStore = options?.injector ? options.injector.get(Store) : inject(Store);
  const removers: Array<() => void> = [];
  for (const [name, selector] of Object.entries(config.state ?? {})) {
    const value: Signal<unknown> = store.selectSignal(selector);
    removers.push(client.registerState(name, () => value()));
  }
  for (const { creator, options: opts } of config.actions ?? []) {
    const { result, guard, input, name, ...rest } = opts;
    removers.push(
      client.registerAction({
        ...rest,
        name: name ?? actionName(creator.type),
        kind: rest.kind ?? "effect",
        input: input ?? z.object({}),
        handler: async (props: unknown) => {
          guard?.(props as never, store);
          store.dispatch(creator.length > 0 ? creator(props) : creator());
          return result ? result(props as never, store) : { dispatched: creator.type };
        },
      } as AgentAction),
    );
  }
  const destroyRef = options?.injector ? options.injector.get(DestroyRef) : inject(DestroyRef);
  destroyRef.onDestroy(() => {
    for (const remove of removers) remove();
  });
}

/** Offers store actions and state to the agent for as long as the app runs. Add it after `provideSkailify`. */
export function provideSkailifyStore(config: ExposeStoreConfig): EnvironmentProviders {
  return makeEnvironmentProviders([provideEnvironmentInitializer(() => exposeStore(config))]);
}
