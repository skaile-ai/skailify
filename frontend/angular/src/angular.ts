// SPDX-License-Identifier: Apache-2.0

/**
 * The Angular bindings: a provider for the app's one client, and `inject*` functions with which a component (or a
 * service) tells the agent what it shows and what it can do, for as long as it lives.
 */
import {
  ApplicationRef,
  assertInInjectionContext,
  DestroyRef,
  effect,
  type EnvironmentProviders,
  InjectionToken,
  type Injector,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type Signal,
  signal,
  untracked,
} from "@angular/core";
import type * as z from "zod";
import type { Navigation } from "./capabilities";
import {
  type ActivityEntry,
  type AgentAction,
  type CapabilityInfo,
  type ConnectionStatus,
  createSkailify,
  type Skailify,
  type SkailifyOptions,
  type SkailifySnapshot,
  type ViewRegistration,
} from "./client";

/** The app's Skailify client. Provided by {@link provideSkailify}. */
export const SKAILIFY = new InjectionToken<Skailify>("skailify");

/** How long settling waits at most for Angular to become stable before it looks at the screen anyway. */
const STABLE_MAX_MS = 1000;

export interface ProvideSkailifyOptions extends Omit<SkailifyOptions, "navigation"> {
  /**
   * The app's views and how to show one. A function is called in an injection context, so it can `inject(Router)`:
   * `routerNavigation(...)` from `@skaile/skailify-angular/router` returns one.
   */
  navigation?: Navigation | (() => Navigation);
}

/**
 * Creates the app's client, starts it when the app boots and closes it when the app is destroyed. Settling after an
 * agent's call waits for Angular to render (`ApplicationRef.whenStable()`), then for the next frame.
 *
 * ```ts
 * bootstrapApplication(App, { providers: [provideSkailify({ appId: "kanban" })] });
 * ```
 */
export function provideSkailify(options: ProvideSkailifyOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: SKAILIFY,
      useFactory: () => {
        const appRef = inject(ApplicationRef);
        const { navigation, ...rest } = options;
        return createSkailify({
          ...rest,
          navigation: typeof navigation === "function" ? navigation() : navigation,
          // An app with a never-ending timer under zone.js never becomes stable: look anyway after a while.
          rendered: rest.rendered ?? (() => Promise.race([appRef.whenStable(), delay(STABLE_MAX_MS)])),
        });
      },
    },
    provideEnvironmentInitializer(() => {
      const client = inject(SKAILIFY);
      void client.start();
      inject(DestroyRef).onDestroy(() => void client.close());
    }),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** For calls outside the constructor: the injector whose lifetime the registration takes. */
export interface InjectOptions {
  injector?: Injector;
}

function context(fn: (...args: never[]) => unknown, options: InjectOptions | undefined): { client: Skailify; destroyRef: DestroyRef } {
  const injector = options?.injector;
  if (!injector) assertInInjectionContext(fn);
  const client = injector ? injector.get(SKAILIFY, null) : inject(SKAILIFY, { optional: true });
  if (!client) throw new Error("skailify: no client; add provideSkailify({ appId }) to the app's providers");
  return { client, destroyRef: injector ? injector.get(DestroyRef) : inject(DestroyRef) };
}

/** The app's client. */
export function injectSkailify(options?: InjectOptions): Skailify {
  return context(injectSkailify, options).client;
}

function snapshotSignal<T>(fn: (...args: never[]) => unknown, pick: (s: SkailifySnapshot) => T, options?: InjectOptions): Signal<T> {
  const { client, destroyRef } = context(fn, options);
  const value = signal(pick(client.getSnapshot()));
  destroyRef.onDestroy(client.subscribe(() => value.set(pick(client.getSnapshot()))));
  return value.asReadonly();
}

/** The connection status, for a status pill. */
export function injectSkailifyStatus(options?: InjectOptions): Signal<ConnectionStatus> {
  return snapshotSignal(injectSkailifyStatus, (s) => s.status, options);
}

/** The latest calls and connection events, newest first. */
export function injectSkailifyActivity(options?: InjectOptions): Signal<readonly ActivityEntry[]> {
  return snapshotSignal(injectSkailifyActivity, (s) => s.activity, options);
}

/** The capabilities the agent sees now, with their full names. */
export function injectSkailifyCapabilities(options?: InjectOptions): Signal<readonly CapabilityInfo[]> {
  return snapshotSignal(injectSkailifyCapabilities, (s) => s.capabilities, options);
}

/**
 * Offers an action to the agent while the component (or service) lives. The handler is a closure over the instance,
 * so it sees its current fields and signals. Call it in a field initialiser or the constructor.
 *
 * Mark every action that changes data with `requiresApproval: true`, so the platform asks the user first.
 */
export function injectAgentAction<T extends z.ZodTypeAny, R extends z.ZodTypeAny | undefined = undefined>(
  action: AgentAction<T, R>,
  options?: InjectOptions,
): void {
  const { client, destroyRef } = context(injectAgentAction, options);
  destroyRef.onDestroy(client.registerAction(action));
}

/**
 * Tells the agent this view is on screen while the component lives: its id, title, a small summary of what it shows,
 * and whether it is still loading. Pass a function that reads signals (and signal inputs) to keep it current:
 *
 * ```ts
 * constructor() {
 *   injectAgentView(() => ({ id: `card/${this.cardId()}`, title: "Card", loading: this.loading() }));
 * }
 * ```
 *
 * Of a view and a view it contains, the inner one is on screen.
 */
export function injectAgentView(view: ViewRegistration | (() => ViewRegistration), options?: InjectOptions): void {
  const { client, destroyRef } = context(injectAgentView, options);
  // Taken now: Angular creates a parent before the children in its template, so the child is on top.
  const order = client.viewOrder();
  if (typeof view !== "function") {
    destroyRef.onDestroy(client.registerView(view, order).remove);
    return;
  }
  let registration: ReturnType<Skailify["registerView"]> | null = null;
  // A function may read signal inputs, which are set only once the component is created: read it in an effect.
  const ref = effect(
    () => {
      const next = view();
      untracked(() => {
        if (registration) registration.update(next);
        else registration = client.registerView(next, order);
      });
    },
    { injector: options?.injector, manualCleanup: true },
  );
  destroyRef.onDestroy(() => {
    ref.destroy();
    registration?.remove();
    registration = null;
  });
}

/**
 * Exposes a piece of state to the agent's `get_view_state`, under `name`, while the component (or service) lives.
 * `read` is called on every read; a signal works as it is. Keep it small and JSON-serialisable: ids and labels.
 */
export function injectAgentState(name: string, read: () => unknown, options?: InjectOptions): void {
  const { client, destroyRef } = context(injectAgentState, options);
  destroyRef.onDestroy(client.registerState(name, read));
}
