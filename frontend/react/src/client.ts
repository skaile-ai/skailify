// SPDX-License-Identifier: Apache-2.0

/**
 * The Skailify client: one per page. It owns the connection to Skaile (the
 * host handshake, the app channel, a fresh token on every reconnect), keeps
 * the capabilities in step with what the mounted components register, tells
 * the agent which view is on screen, and keeps a short activity log the app
 * can show. It imports nothing from React; the hooks in `react.tsx` are thin
 * wrappers around it.
 *
 * It connects only inside a Skaile session: the platform embeds an app with the
 * app channel switched on in an iframe whose URL carries `skaileParentOrigin`.
 * Opened on its own, the app does not connect and registrations cost nothing.
 */
import {
  type AppConnectionParams,
  type AppHandlerContext,
  type AppLogger,
  type AppSession,
  type AppTransport,
  type AppViewReport,
  consoleLogger,
  createSkaileApp,
  createWebSocketAppTransport,
  type DefineAppCapabilityArgs,
  type DefinedAppCapability,
  defineAppCapability,
  PARENT_ORIGIN_QUERY_PARAM,
  type ReconnectOptions,
  resolveAppConnectionParams,
  type SessionTokenProvider,
  type SkaileApp,
} from "@skaile/workspaces/app-sdk";
import type * as z from "zod";
import { genericCapabilities, type Navigation } from "./capabilities.ts";

export type ConnectionStatus =
  | { state: "idle" }
  | { state: "standalone" }
  | { state: "connecting" }
  | { state: "connected"; sessionId: string; userId?: string }
  | { state: "reconnecting" }
  | { state: "error"; message: string }
  | { state: "closed" };

/** One line of the activity log: `in` is a call from the agent, `out` is what the app answered or a connection event. */
export interface ActivityEntry {
  id: number;
  at: number;
  direction: "in" | "out";
  label: string;
  detail?: string;
  error?: boolean;
}

/**
 * An action the agent can call. `name` is relative (`board.add_card`): the client puts `app.` in front, and the
 * platform shows it to the agent as `app.<appId>.board.add_card`. Everything else is the app SDK's
 * `defineAppCapability` arguments, including `requiresApproval` and `effectClass`.
 */
export type AgentAction<T extends z.ZodTypeAny = z.ZodTypeAny, R extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined> =
  DefineAppCapabilityArgs<T, R>;

/** Types an action's handler from its input schema, for an action declared outside a component. */
export function agentAction<T extends z.ZodTypeAny, R extends z.ZodTypeAny | undefined = undefined>(action: AgentAction<T, R>): AgentAction {
  return action as unknown as AgentAction;
}

/** What a mounted view says about itself. The last view mounted is the one on screen. */
export interface ViewRegistration {
  /** Stable id of the view: a route, a screen name, a record key */
  id: string;
  title?: string;
  /** A small JSON-serialisable summary of what the view shows (filters, selection, counts) */
  state?: unknown;
  /** True while the view is still loading what it shows; the agent waits until it is false */
  loading?: boolean;
}

/** A capability as the agent sees it, for a panel in the app's own UI. */
export interface CapabilityInfo {
  name: string;
  displayName?: string;
  description: string;
  kind?: "effect" | "render" | "query";
  requiresApproval?: boolean;
  effectClass?: string;
}

export interface SkailifySnapshot {
  status: ConnectionStatus;
  activity: readonly ActivityEntry[];
  capabilities: readonly CapabilityInfo[];
}

interface WindowLike {
  readonly parent: unknown;
  readonly location: { readonly search: string };
}

export interface SkailifyOptions {
  /** The app's id: the `id` of its entry in the workspace's `skaile.preview.json` */
  appId: string;
  /** `auto` (default): connect when embedded in Skaile; `false`: never */
  enabled?: "auto" | false;
  /**
   * The app's views and how to show one, router-agnostic. With it the agent gets `list_views` and `navigate`;
   * without it, only what the mounted components register.
   */
  navigation?: Navigation;
  logger?: AppLogger;
  reconnect?: ReconnectOptions | false;
  /** How long a call waits for the view to settle after an action; default 3000 ms, at most {@link MAX_WAIT_MS} */
  settleTimeoutMs?: number;
  /** Entries the activity log keeps; default 40 */
  activityLimit?: number;
  /**
   * Connect over this transport instead of the host handshake and the WebSocket (tests, or an app that
   * resolves its own connection). The client then connects whether or not it is embedded.
   */
  transport?: AppTransport;
  /** For tests: the window, the host handshake and the transport factory */
  windowRef?: WindowLike;
  resolveParams?: (appId: string, parentOrigin: string) => Promise<AppConnectionParams>;
  createTransport?: (url: string, token: SessionTokenProvider) => AppTransport;
}

export interface Skailify {
  readonly appId: string;
  /** The SDK peer once connecting; null when standalone or not started */
  readonly app: SkaileApp | null;
  /** Connects (once; later calls return the same promise). Never rejects: a failure shows in the status. */
  start(): Promise<void>;
  close(): Promise<void>;
  /**
   * Adds an action; returns the function that removes exactly this registration. Of several actions with the same
   * name the one registered last is offered; removing it offers the one before again.
   */
  registerAction<T extends z.ZodTypeAny, R extends z.ZodTypeAny | undefined = undefined>(action: AgentAction<T, R>): () => void;
  /** Adds a view; returns the function that updates it and the one that removes it. */
  registerView(view: ViewRegistration): { update(view: ViewRegistration): void; remove(): void };
  /** Exposes a named piece of state to `get_view_state`; `read` is called on every read. */
  registerState(name: string, read: () => unknown): () => void;
  /** The view on screen: the last one mounted, else the navigation's current view */
  currentView(): ViewRegistration | null;
  /** Every registered state, read now */
  readState(): Record<string, unknown>;
  /** Whether a mounted view says it is still loading */
  loading(): boolean;
  /**
   * Waits until React has rendered and no mounted view is loading, then tells the agent what is on screen and
   * that it has settled. Resolves false when the timeout came first. The client calls it after every effect.
   */
  settle(timeoutMs?: number): Promise<boolean>;
  /** The full name of a relative one: `board.add_card` → `app.board.add_card` */
  fullName(name: string): string;
  /** For `useSyncExternalStore` */
  subscribe(listener: () => void): () => void;
  getSnapshot(): SkailifySnapshot;
  /** Adds a line to the activity log, for events of the app's own */
  log(entry: Omit<ActivityEntry, "id" | "at">): void;
}

/** The longest a call may wait for the view to settle */
export const MAX_WAIT_MS = 10_000;

/**
 * The embedding host's origin, or null when the app is not embedded in Skaile. Read once at start: the app's own
 * navigation may drop the query parameter, and every reconnect needs it.
 */
export function skaileParentOrigin(windowRef: WindowLike | undefined = globalThis as unknown as WindowLike): string | null {
  if (!windowRef?.location || !windowRef.parent || windowRef.parent === windowRef) return null;
  const origin = new URLSearchParams(windowRef.location.search).get(PARENT_ORIGIN_QUERY_PARAM);
  return origin && origin !== "*" && origin !== "null" ? origin : null;
}

/** Resolves after the browser had a chance to render: the next frame where there is one, else the next task. */
function afterRender(): Promise<void> {
  return new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    setTimeout(() => (raf ? raf(() => resolve()) : resolve()), 0);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarize(value: unknown, max = 120): string | undefined {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function createSkailify(options: SkailifyOptions): Skailify {
  const logger = options.logger ?? consoleLogger;
  const settleTimeout = Math.min(options.settleTimeoutMs ?? 3000, MAX_WAIT_MS);
  const activityLimit = options.activityLimit ?? 40;
  const fullName = (name: string) => `app.${name}`;

  let app: SkaileApp | null = null;
  let started: Promise<void> | null = null;
  let closed = false;

  // ── Snapshot for React ────────────────────────────────────────────────────
  let status: ConnectionStatus = { state: "idle" };
  let activity: ActivityEntry[] = [];
  let activitySeq = 0;
  let capabilityInfo: CapabilityInfo[] = [];
  let snapshot: SkailifySnapshot = { status, activity, capabilities: capabilityInfo };
  const listeners = new Set<() => void>();
  const emit = () => {
    snapshot = { status, activity, capabilities: capabilityInfo };
    for (const listener of [...listeners]) listener();
  };
  const setStatus = (next: ConnectionStatus) => {
    status = next;
    emit();
  };
  const log = (entry: Omit<ActivityEntry, "id" | "at">) => {
    activity = [{ ...entry, id: ++activitySeq, at: Date.now() }, ...activity].slice(0, activityLimit);
    emit();
  };

  // ── Views and state ───────────────────────────────────────────────────────
  let viewSeq = 0;
  const views = new Map<number, ViewRegistration>();
  const states = new Map<number, { name: string; read: () => unknown }>();
  const viewListeners = new Set<() => void>();
  // React's double mount in development removes and re-adds a view in one commit: report once, after it
  let reportQueued = false;
  const viewChanged = () => {
    for (const listener of [...viewListeners]) listener();
    if (reportQueued) return;
    reportQueued = true;
    queueMicrotask(() => {
      reportQueued = false;
      reportIfChanged();
    });
  };

  function currentView(): ViewRegistration | null {
    const mounted = [...views.values()].at(-1);
    if (mounted) return mounted;
    const id = options.navigation?.current?.();
    if (!id) return null;
    const descriptor = options.navigation?.views().find((v) => v.id === id);
    return { id, title: descriptor?.title };
  }

  function readState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { name, read } of states.values()) {
      try {
        out[name] = read();
      } catch (error) {
        out[name] = { error: describe(error) };
      }
    }
    return out;
  }

  const loading = () => [...views.values()].some((v) => v.loading === true);

  /** What goes out in `view_report`; the app id stands in when no view is known, since the report needs one. */
  function report(): AppViewReport {
    const view = currentView();
    return view ? { viewId: view.id, title: view.title, state: view.state } : { viewId: options.appId };
  }

  let lastReport = "";
  let wasLoading = false;
  /** Reports the view when it changed and says `loading` / `settled` when a view starts or stops loading. */
  function reportIfChanged(): void {
    if (!app?.session) return;
    const next = report();
    const key = JSON.stringify(next);
    if (key !== lastReport) {
      lastReport = key;
      try {
        app.reportView(next);
      } catch (error) {
        logger.error("skailify: could not report the view", { message: describe(error) });
      }
    }
    const now = loading();
    if (now !== wasLoading) {
      wasLoading = now;
      if (now) app.loading("view loading");
      else app.settled();
    }
  }

  function settle(timeoutMs = settleTimeout): Promise<boolean> {
    const limit = Math.min(Math.max(timeoutMs, 0), MAX_WAIT_MS);
    return afterRender().then(
      () =>
        new Promise<boolean>((resolve) => {
          let finished = false;
          const finish = (settled: boolean) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            viewListeners.delete(check);
            // the report may not have changed, but the agent waits for this settled. While a view is still loading
            // (the wait timed out) it is not sent: the view sends it when it stops loading.
            if (app?.session) {
              lastReport = "";
              wasLoading = loading();
              reportIfChanged();
              if (!wasLoading) app.settled();
            }
            resolve(settled);
          };
          const check = () => {
            if (!loading()) finish(true);
          };
          const timer = setTimeout(() => finish(!loading()), limit);
          viewListeners.add(check);
          check();
        }),
    );
  }

  // ── Capabilities ──────────────────────────────────────────────────────────
  let actionSeq = 0;
  /** Registered actions in order; a later one with the same name wins. */
  const actions = new Map<number, AgentAction>();
  const defined = new WeakMap<AgentAction, DefinedAppCapability | null>();
  let registered = new Map<string, DefinedAppCapability>();

  /** Wraps the handler: logs the call, and after an effect waits for the view to settle. */
  function define(action: AgentAction): DefinedAppCapability | null {
    if (defined.has(action)) return defined.get(action) ?? null;
    const name = fullName(action.name);
    const isEffect = (action.kind ?? "effect") === "effect";
    let capability: DefinedAppCapability | null;
    try {
      capability = defineAppCapability({
        ...action,
        name,
        handler: async (args: unknown, ctx: AppHandlerContext) => {
          log({ direction: "in", label: action.name, detail: summarize(args) });
          if (isEffect) app?.loading(action.name);
          try {
            const result = await action.handler(args, ctx);
            log({ direction: "out", label: action.name, detail: summarize(result) });
            return result;
          } catch (error) {
            log({ direction: "out", label: action.name, detail: describe(error), error: true });
            throw error;
          } finally {
            if (isEffect) await settle();
          }
        },
      } as DefineAppCapabilityArgs<z.ZodTypeAny, z.ZodTypeAny | undefined>);
    } catch (error) {
      // the SDK refuses what the gateway would refuse (an effect class above routine without approval)
      logger.error(`skailify: ${name} not registered: ${describe(error)}`, { name });
      capability = null;
    }
    defined.set(action, capability);
    return capability;
  }

  const generic: AgentAction[] = [];

  function sync(): void {
    const now = new Map<string, DefinedAppCapability>();
    for (const action of [...generic, ...actions.values()]) {
      const capability = define(action);
      if (capability) now.set(capability.name, capability);
    }
    capabilityInfo = [...now.values()].map((c) => ({
      name: c.name,
      displayName: c.displayName,
      description: c.description,
      kind: c.kind,
      requiresApproval: c.requiresApproval,
      effectClass: c.effectClass,
    }));
    wanted = now;
    emit();
    // React's double mount in development removes and re-adds an action in one commit: send the difference once, after it
    if (wireQueued) return;
    wireQueued = true;
    queueMicrotask(flushWire);
  }

  let wanted = new Map<string, DefinedAppCapability>();
  let wireQueued = false;
  function flushWire(): void {
    wireQueued = false;
    if (!app) return;
    const before = registered;
    registered = wanted;
    for (const name of before.keys()) if (!wanted.has(name)) app.deregisterCapability(name);
    for (const [name, capability] of wanted) if (before.get(name) !== capability) app.registerCapability(capability);
  }

  // ── Connection ────────────────────────────────────────────────────────────
  async function connect(transport: AppTransport): Promise<void> {
    app = createSkaileApp({ appId: options.appId, transport, logger, reconnect: options.reconnect });
    handle.app = app;
    registered = new Map();
    sync();
    flushWire();
    app.onSessionChange((session: AppSession | null) => {
      if (session) {
        setStatus({ state: "connected", sessionId: session.sessionId, userId: session.userId });
        log({ direction: "out", label: "connected", detail: `session ${session.sessionId}` });
        // the SDK replays the last report on a bind; send it again only when it changed meanwhile
        lastReport = "";
        wasLoading = false;
        reportIfChanged();
      } else if (!closed) {
        setStatus({ state: "reconnecting" });
        log({ direction: "out", label: "disconnected" });
      }
    });
    if (closed) {
      await app.close();
      return;
    }
    await app.connect();
  }

  async function run(): Promise<void> {
    if (options.transport) {
      setStatus({ state: "connecting" });
      return connect(options.transport);
    }
    const parentOrigin = options.enabled === false ? null : skaileParentOrigin(options.windowRef);
    if (!parentOrigin) {
      setStatus({ state: "standalone" });
      return;
    }
    const resolveParams =
      options.resolveParams ?? ((appId: string, origin: string) => resolveAppConnectionParams({ appId, parentOrigin: origin }));
    const createTransport =
      options.createTransport ?? ((url: string, sessionToken: SessionTokenProvider) => createWebSocketAppTransport({ url, sessionToken }));
    setStatus({ state: "connecting" });
    // The first token comes with the url; every reconnect asks the host for a fresh one: the gateway burns it at app_hello.
    let primed: AppConnectionParams | null = await resolveParams(options.appId, parentOrigin);
    if (closed) return;
    const transport = createTransport(primed.url, () => {
      if (primed) {
        const token = primed.token;
        primed = null;
        return token;
      }
      return resolveParams(options.appId, parentOrigin).then((params) => params.token);
    });
    return connect(transport);
  }

  const handle: Skailify & { app: SkaileApp | null } = {
    appId: options.appId,
    app: null,
    start() {
      if (!started) {
        started = run().catch((error: unknown) => {
          if (closed) return;
          const message = describe(error);
          logger.error("skailify: could not connect to Skaile", { message });
          setStatus({ state: "error", message });
          log({ direction: "out", label: "connect failed", detail: message, error: true });
        });
      }
      return started;
    },
    async close() {
      closed = true;
      await app?.close();
      setStatus({ state: "closed" });
    },
    registerAction(added) {
      const action = added as unknown as AgentAction;
      if (action.name.startsWith("app.")) {
        throw new Error(`skailify: action names are relative, write "${action.name.slice(4)}" instead of "${action.name}"`);
      }
      // a later registration with the same name wins; when it is removed, the earlier one is offered again
      const key = ++actionSeq;
      actions.set(key, action);
      sync();
      return () => {
        if (actions.delete(key)) sync();
      };
    },
    registerView(view) {
      const key = ++viewSeq;
      views.set(key, view);
      viewChanged();
      return {
        update(next) {
          if (!views.has(key)) return;
          views.set(key, next);
          viewChanged();
        },
        remove() {
          if (views.delete(key)) viewChanged();
        },
      };
    },
    registerState(name, read) {
      const key = ++viewSeq;
      states.set(key, { name, read });
      return () => {
        states.delete(key);
      };
    },
    currentView,
    readState,
    loading,
    settle,
    fullName,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    log,
  };

  generic.push(...genericCapabilities(handle, options.navigation));
  sync();
  return handle;
}
