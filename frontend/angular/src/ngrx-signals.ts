// SPDX-License-Identifier: Apache-2.0

/**
 * `@skaile/skailify-angular/ngrx-signals`: offers an NgRx SignalStore's methods to the agent, and exposes its state to
 * `get_view_state`.
 *
 * ```ts
 * export class BoardComponent {
 *   readonly board = inject(BoardStore);
 *   constructor() {
 *     exposeSignalStore(this.board, {
 *       name: "board",
 *       methods: {
 *         addCard: { description: "Add a card.", input: z.object({ title: z.string() }), args: ["title"] },
 *         removeCard: { description: "Remove a card.", input: z.object({ id: z.string() }), args: ["id"], requiresApproval: true },
 *       },
 *     });
 *   }
 * }
 * ```
 */
import { DestroyRef, inject, isSignal, type Signal } from "@angular/core";
import { getState, type StateSource } from "@ngrx/signals";
import * as z from "zod";
import { injectSkailify, type InjectOptions } from "./angular";
import type { AgentAction } from "./client";

/** How the agent sees one store method. */
export type SignalStoreMethodOptions<T extends z.ZodTypeAny = z.ZodTypeAny> = Omit<AgentAction<T>, "handler" | "name" | "input"> & {
  /** Relative name; default `<store name>.<method in snake case>`: `addCard` → `board.add_card` */
  name?: string;
  /** The method's arguments, as a Zod object schema; omit it for a method without arguments */
  input?: T;
  /**
   * How the input becomes the method's arguments. Default: the whole input object as the one argument. Name keys of
   * the input to pass them positionally instead: `["title", "column"]` calls `addCard(input.title, input.column)`.
   */
  args?: readonly string[];
};

export interface ExposeSignalStoreConfig<S extends object> {
  /** The prefix of the actions' names, and the name under which `get_view_state` shows the state */
  name: string;
  /**
   * What `get_view_state` shows of the store: `true` (default) for its whole state, a function for a projection of it
   * (keep it small: ids and labels), `false` for nothing.
   */
  state?: boolean | ((store: S) => unknown);
  /** The methods the agent may call, by method name */
  methods?: {
    [K in keyof S]?: S[K] extends Signal<unknown> ? never : S[K] extends (...args: never[]) => unknown ? SignalStoreMethodOptions : never;
  };
}

/**
 * Offers a SignalStore's methods and state to the agent while the calling component or service lives. Call it in an
 * injection context (a field initialiser or the constructor), or pass an injector.
 */
export function exposeSignalStore<S extends object>(store: S, config: ExposeSignalStoreConfig<S>, options?: InjectOptions): void {
  const client = injectSkailify(options);
  const removers: Array<() => void> = [];
  const state = config.state ?? true;
  if (state !== false) {
    const read = typeof state === "function" ? () => state(store) : () => getState(store as unknown as StateSource<object>);
    removers.push(client.registerState(config.name, read));
  }
  for (const [method, opts] of Object.entries(config.methods ?? {}) as Array<[string, SignalStoreMethodOptions | undefined]>) {
    if (!opts) continue;
    const fn = (store as Record<string, unknown>)[method];
    if (typeof fn !== "function" || isSignal(fn)) throw new Error(`skailify: the store ${config.name} has no method ${method}`);
    const { name, input, args, ...rest } = opts;
    if (args && !input) throw new Error(`skailify: ${config.name}.${method} names args but has no input schema for them`);
    removers.push(
      client.registerAction({
        ...rest,
        name: name ?? `${config.name}.${snake(method)}`,
        kind: rest.kind ?? "effect",
        input: input ?? z.object({}),
        handler: async (parsed: Record<string, unknown>) => {
          const positional = args ? args.map((key) => parsed[key]) : input ? [parsed] : [];
          const returned = await (fn as (...a: unknown[]) => unknown).apply(store, positional);
          return plain(returned) ? returned : { called: method };
        },
      } as AgentAction),
    );
  }
  const destroyRef = options?.injector ? options.injector.get(DestroyRef) : inject(DestroyRef);
  destroyRef.onDestroy(() => {
    for (const remove of removers) remove();
  });
}

function snake(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * A return value worth sending to the agent: data, not undefined, a function, or a handle such as the
 * `{ destroy }` an `rxMethod` returns (any object with a function in it).
 */
function plain(value: unknown): boolean {
  if (value === undefined || typeof value === "function") return false;
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
    return !Object.values(value).some((v) => typeof v === "function");
  }
  return true;
}
