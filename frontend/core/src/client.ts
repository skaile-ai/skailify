// SPDX-License-Identifier: Apache-2.0

/**
 * The Skailify client: one per page. It owns the connection to Skaile (the
 * host handshake, the app channel, a fresh token on every reconnect), keeps
 * the capabilities in step with what the mounted components register, tells
 * the agent which view is on screen, and keeps a short activity log the app
 * can show. It also lets the app hand work to the agent (`requestAgentTurn`)
 * and read the signed-in user (`user`). It imports no UI framework: an app without one calls it directly,
 * and the React and Angular adapters are thin wrappers around it.
 *
 * It connects only inside a Skaile session: the platform embeds an app with the
 * app channel switched on in an iframe whose URL carries `skaileParentOrigin`.
 * Opened on its own, the app does not connect and registrations cost nothing.
 */
import {
  type AppAssistantPresentation,
  type AppConnectionParams,
  type AppHandlerContext,
  type AppLogger,
  type AppSession,
  type AppTransport,
  AppTurnRefusedError,
  type AppTurnRequest,
  type AppUser,
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
  setAssistantPresentation,
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
  DefineAppCapabilityArgs<T, R> & {
    /** @internal the handler waits for the view itself */
    [SETTLES_ITSELF]?: boolean;
  };

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
  /** As registered: `app.board.add_card` */
  name: string;
  /** As the agent calls it: `app.<appId>.board.add_card` */
  agentName: string;
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
  /** The signed-in user while connected (see {@link Skailify.user}) */
  user: AppUser | undefined;
}

interface WindowLike {
  readonly parent: unknown;
  readonly location: { readonly search: string };
}

export interface SkailifyOptions {
  /** The app's id: the `id` of its entry in the workspace's `skaile.preview.json` */
  appId: string;
  /** `auto` (default): connect when embedded in Skaile; `false`: never, not even over `transport` */
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
  /**
   * Resolves once the framework has rendered the latest change (Angular: `ApplicationRef.whenStable()`). Settling
   * waits for it, then for the next frame. A framework adapter sets it; without it settling waits for the next frame.
   */
  rendered?: () => Promise<unknown>;
  /**
   * Where code runs, for a framework that tracks async work (Angular's zone.js). The connection and the settle timers
   * run `outside`, so they never keep the app from becoming stable; the handlers run `inside`, so the app sees what
   * they change. The Angular adapter sets it from `NgZone`; without it everything runs where it is called.
   */
  zone?: { inside<T>(fn: () => T): T; outside<T>(fn: () => T): T };
  /** Entries the activity log keeps; default 40 */
  activityLimit?: number;
  /**
   * Connect over this transport instead of the host handshake and the WebSocket (tests, or an app that
   * resolves its own connection). The client then connects whether or not it is embedded.
   */
  transport?: AppTransport;
  /**
   * How Skaile shows its agent button over the app: `{ kind: "none" }` hides it, `{ kind: "floating", corner,
   * offset, size, accent }` places it. Without it Skaile shows the button where it chooses. Change it later with
   * {@link Skailify.setAssistant}.
   */
  assistant?: AppAssistantPresentation;
  /** For tests: the window, the host handshake, the transport factory and the assistant message */
  windowRef?: WindowLike;
  resolveParams?: (appId: string, parentOrigin: string, assistant?: AppAssistantPresentation) => Promise<AppConnectionParams>;
  postAssistant?: (appId: string, parentOrigin: string, presentation: AppAssistantPresentation) => void;
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
   * Changes how Skaile shows its agent button over the app (see {@link SkailifyOptions.assistant}). Before the
   * connection it replaces the option; standalone it does nothing.
   */
  setAssistant(presentation: AppAssistantPresentation): void;
  /**
   * Adds an action; returns the function that removes exactly this registration. Of several actions with the same
   * name the one registered last is offered; removing it offers the one before again.
   */
  registerAction<T extends z.ZodTypeAny, R extends z.ZodTypeAny | undefined = undefined>(action: AgentAction<T, R>): () => void;
  /**
   * Adds a view; returns the function that updates it and the one that removes it. Of several mounted views the one
   * with the highest `order` is on screen; without one, the view added last. Pass an order from {@link viewOrder}
   * taken while rendering, so a parent and the child it contains, mounted together, keep the child on top.
   */
  registerView(view: ViewRegistration, order?: number): { update(view: ViewRegistration): void; remove(): void };
  /** A new view order, increasing; take it when a view first renders */
  viewOrder(): number;
  /** Exposes a named piece of state to `get_view_state`; `read` is called on every read. */
  registerState(name: string, read: () => unknown): () => void;
  /** The view on screen: the last one mounted, else the navigation's current view */
  currentView(): ViewRegistration | null;
  /** Every registered state, read now */
  readState(): Record<string, unknown>;
  /** Whether a mounted view says it is still loading */
  loading(): boolean;
  /**
   * Waits until the app has rendered and no mounted view is loading, then tells the agent what is on screen and
   * that it has settled. Resolves false when the timeout came first. The client calls it after every effect.
   */
  settle(timeoutMs?: number): Promise<boolean>;
  /** The full name of a relative one: `board.add_card` → `app.board.add_card` */
  fullName(name: string): string;
  /** The name the agent calls: `board.add_card` → `app.<appId>.board.add_card` */
  agentName(name: string): string;
  /** For the UI: React's `useSyncExternalStore`, Angular's signals, or a plain listener */
  subscribe(listener: () => void): () => void;
  getSnapshot(): SkailifySnapshot;
  /** Adds a line to the activity log, for events of the app's own */
  log(entry: Omit<ActivityEntry, "id" | "at">): void;
  /**
   * Asks the agent to act now: Skaile starts a turn with `text` as the signed-in user's own message, marked as sent
   * through the app; `context` (JSON-serialisable) goes along as detail. Resolves once the turn started; rejects with
   * an `AppTurnRefusedError` naming the reason (`viewer`, `rate_limited` with `retryAfterMs`, `not_declared`,
   * `not_connected`, `timeout`, …). Standalone or before the connection it rejects with `not_connected`. For a note the
   * agent should read later, not now, report it in the view state instead.
   */
  requestAgentTurn(request: AppTurnRequest): Promise<void>;
  /**
   * The signed-in user who opened the app: `{ userId, displayName?, sessionRole? }`. Undefined standalone, before the
   * connection, while reconnecting, and when Skaile does not say. Also in {@link getSnapshot}.
   */
  readonly user: AppUser | undefined;
  /** Calls `handler` whenever {@link user} changes (a connect, a change of name or role, a lost connection); returns the unsubscribe. */
  onUserChange(handler: (user: AppUser | undefined) => void): () => void;
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

/**
 * Resolves after the browser had a chance to render: the next frame, or after {@link RENDER_FALLBACK_MS} when no frame
 * comes. Browsers pause animation frames in background tabs and hidden iframes, so a frame alone could wait forever.
 */
function afterRender(): Promise<void> {
  return new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    setTimeout(() => {
      if (!raf) return resolve();
      const fallback = setTimeout(resolve, RENDER_FALLBACK_MS);
      raf(() => {
        clearTimeout(fallback);
        resolve();
      });
    }, 0);
  });
}

/** What stands in for state that JSON cannot carry (a BigInt, a cycle) */
export const NOT_SERIALISABLE = { error: "state is not JSON-serialisable" } as const;

/** The value itself when JSON can carry it, else {@link NOT_SERIALISABLE}: one bad value never fails a whole answer. */
export function jsonSafe(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return NOT_SERIALISABLE;
  }
}

/** How long to wait for an animation frame before treating the page as rendered */
const RENDER_FALLBACK_MS = 50;

/** The longest agent-visible name the gateway registers, `app.<appId>.<name>` */
export const MAX_AGENT_NAME_CHARS = 64;

/** Marks a capability whose handler waits for the view itself, so the wrapper does not wait a second time. */
export const SETTLES_ITSELF: unique symbol = Symbol("skailify.settlesItself");

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
  const baseLogger = options.logger ?? consoleLogger;
  // The SDK says it has given up reconnecting only through its logger; turn that into a status.
  const logger: AppLogger = {
    ...baseLogger,
    error(message: string, fields?: Record<string, unknown>) {
      baseLogger.error(message, fields);
      if (!closed && (message === "app reconnect gave up" || message === "app reconnect refused permanently")) {
        setStatus({ state: "error", message: message.replace(/^app /, "") });
        log({ direction: "out", label: "connection lost", detail: message, error: true });
      }
    },
  };
  const zone = options.zone ?? { inside: <T>(fn: () => T) => fn(), outside: <T>(fn: () => T) => fn() };
  const settleTimeout = Math.min(options.settleTimeoutMs ?? 3000, MAX_WAIT_MS);
  const activityLimit = options.activityLimit ?? 40;
  const fullName = (name: string) => `app.${name}`;
  const agentName = (name: string) => `app.${options.appId}.${name}`;

  let app: SkaileApp | null = null;
  let started: Promise<void> | null = null;
  let closed = false;
  // The hints the next ping carries, and the host to send a change to once connecting
  let assistant = options.assistant;
  let hostOrigin: string | null = null;

  // ── Snapshot for the UI ───────────────────────────────────────────────────
  let status: ConnectionStatus = { state: "idle" };
  let activity: ActivityEntry[] = [];
  let activitySeq = 0;
  let capabilityInfo: CapabilityInfo[] = [];
  let user: AppUser | undefined;
  let snapshot: SkailifySnapshot = { status, activity, capabilities: capabilityInfo, user };
  const listeners = new Set<() => void>();
  const userListeners = new Set<(user: AppUser | undefined) => void>();
  const emit = () => {
    snapshot = { status, activity, capabilities: capabilityInfo, user };
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
  /** Each view with its order: the view rendered last is the one on screen. */
  const views = new Map<number, { view: ViewRegistration; order: number }>();
  const states = new Map<number, { name: string; read: () => unknown }>();
  const viewListeners = new Set<() => void>();
  // A view removed and re-added in one render (React's double mount in development, an Angular component re-created in
  // one change detection) is reported once, after it
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
    let top: { view: ViewRegistration; order: number } | undefined;
    for (const entry of views.values()) if (!top || entry.order > top.order) top = entry;
    if (top) return top.view;
    const id = options.navigation?.current?.();
    if (!id) return null;
    const descriptor = options.navigation?.views().find((v) => v.id === id);
    return { id, title: descriptor?.title };
  }

  function readState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { name, read } of states.values()) {
      try {
        out[name] = jsonSafe(read());
      } catch (error) {
        out[name] = { error: describe(error) };
      }
    }
    return out;
  }

  const loading = () => [...views.values()].some((v) => v.view.loading === true);
  /** Effects running now: while one runs, the view is not settled even when no view is loading */
  let inFlight = 0;
  const busy = () => inFlight > 0 || loading();

  /** What goes out in `view_report`; the app id stands in when no view is known, since the report needs one. */
  function report(): AppViewReport {
    const view = currentView();
    return view ? { viewId: view.id, title: view.title, state: view.state } : { viewId: options.appId };
  }

  // The SDK keeps the last report and phase while disconnected and replays them on every bind, so they are sent
  // whether or not a session is bound: what the platform sees after a reconnect is then what is true now.
  let lastReport = "";
  const unserialisableLogged = new Set<string>();
  let sentLoading = false;
  /**
   * Reports the view when it changed (always with `force`), and says `loading` when the app becomes busy and `settled`
   * when it stops (with `force`, whenever it is not busy).
   */
  function reportIfChanged(force = false): void {
    if (!app) return;
    let next = report();
    let key: string;
    try {
      key = JSON.stringify(next);
    } catch (error) {
      // a BigInt or a cycle in the view's state: report the view without it, and say why (once per view)
      if (!unserialisableLogged.has(next.viewId)) {
        unserialisableLogged.add(next.viewId);
        logger.error(`skailify: the state of view ${next.viewId} is not JSON-serialisable`, { message: describe(error) });
      }
      next = { viewId: next.viewId, title: next.title, state: NOT_SERIALISABLE };
      key = JSON.stringify(next);
    }
    if (force || key !== lastReport) {
      lastReport = key;
      try {
        app.reportView(next);
      } catch (error) {
        logger.error("skailify: could not report the view", { message: describe(error) });
      }
    }
    const now = busy();
    if (now && !sentLoading) {
      sentLoading = true;
      app.loading("view loading");
    } else if (!now && (sentLoading || force)) {
      sentLoading = false;
      app.settled();
    }
  }

  function settle(timeoutMs = settleTimeout): Promise<boolean> {
    const limit = Math.min(Math.max(timeoutMs, 0), MAX_WAIT_MS);
    return zone.outside(() => new Promise<boolean>((resolve) => {
      let finished = false;
      let rendered = false;
      const finish = (settled: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        viewListeners.delete(check);
        // The report may not have changed, but the agent waits for this settled. While the app is still busy (a view
        // loading at the timeout, another effect running) it is not sent: it goes out when the app stops being busy.
        reportIfChanged(true);
        resolve(settled);
      };
      const check = () => {
        if (rendered && !loading()) finish(true);
      };
      // the deadline covers the wait for the render too
      const timer = setTimeout(() => finish(!loading()), limit);
      viewListeners.add(check);
      void Promise.resolve()
        .then(() => options.rendered?.())
        .catch(() => undefined)
        .then(afterRender)
        .then(() => {
          rendered = true;
          check();
        });
    }));
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
    const settlesItself = (action as { [SETTLES_ITSELF]?: boolean })[SETTLES_ITSELF] === true;
    let capability: DefinedAppCapability | null;
    try {
      if (agentName(action.name).length > MAX_AGENT_NAME_CHARS) {
        throw new Error(`${agentName(action.name)} is longer than ${MAX_AGENT_NAME_CHARS} characters, the gateway would drop it`);
      }
      capability = defineAppCapability({
        ...action,
        name,
        handler: async (args: unknown, ctx: AppHandlerContext) => {
          log({ direction: "in", label: action.name, detail: summarize(args) });
          if (isEffect) {
            inFlight++;
            sentLoading = true;
            app?.loading(action.name);
          }
          try {
            const result = await zone.inside(() => action.handler(args, ctx));
            log({ direction: "out", label: action.name, detail: summarize(result) });
            return result;
          } catch (error) {
            log({ direction: "out", label: action.name, detail: describe(error), error: true });
            throw error;
          } finally {
            if (isEffect) {
              inFlight--;
              if (settlesItself) reportIfChanged(true);
              else await settle();
            }
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
      agentName: agentName(c.name.slice(4)),
      displayName: c.displayName,
      description: c.description,
      kind: c.kind,
      requiresApproval: c.requiresApproval,
      effectClass: c.effectClass,
    }));
    wanted = now;
    emit();
    // An action removed and re-added in one render (a double mount, a re-created component): send the difference once, after it
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
    reportIfChanged(true);
    // Registered before onSessionChange: the SDK sets the user with the session, so the status and the user agree.
    app.onUserChange((next) => {
      user = next;
      emit();
      for (const handler of [...userListeners]) {
        try {
          handler(next);
        } catch (error) {
          logger.error("skailify: a user change handler threw", { message: describe(error) });
        }
      }
    });
    app.onSessionChange((session: AppSession | null) => {
      if (session) {
        // the SDK replays the last report and phase on a bind; they are kept current while disconnected
        setStatus({ state: "connected", sessionId: session.sessionId, userId: session.userId });
        log({ direction: "out", label: "connected", detail: `session ${session.sessionId}` });
      } else if (!closed) {
        log({ direction: "out", label: "disconnected" });
        setStatus(options.reconnect === false ? { state: "error", message: "connection lost" } : { state: "reconnecting" });
      }
    });
    if (closed) {
      await app.close();
      return;
    }
    await app.connect();
  }

  async function run(): Promise<void> {
    if (closed) return;
    if (options.enabled === false) {
      setStatus({ state: "standalone" });
      return;
    }
    if (options.transport) {
      setStatus({ state: "connecting" });
      return connect(options.transport);
    }
    const parentOrigin = skaileParentOrigin(options.windowRef);
    if (!parentOrigin) {
      setStatus({ state: "standalone" });
      return;
    }
    hostOrigin = parentOrigin;
    const resolve =
      options.resolveParams ??
      ((appId: string, origin: string, presentation?: AppAssistantPresentation) =>
        resolveAppConnectionParams({ appId, parentOrigin: origin, ...(presentation ? { assistant: presentation } : {}) }));
    // Each ping carries the assistant hints; a change made while one was in flight is sent again once it is answered.
    const resolveParams = async (appId: string, origin: string): Promise<AppConnectionParams> => {
      const sent = assistant;
      const params = await resolve(appId, origin, sent);
      if (assistant !== sent && assistant && !closed) postAssistant(assistant);
      return params;
    };
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

  function postAssistant(presentation: AppAssistantPresentation): void {
    if (!hostOrigin) return;
    try {
      (options.postAssistant ?? ((appId, parentOrigin, p) => setAssistantPresentation({ appId, parentOrigin, presentation: p })))(
        options.appId,
        hostOrigin,
        presentation,
      );
    } catch (error) {
      logger.warn("skailify: could not send the assistant hints", { message: describe(error) });
    }
  }

  const handle: Skailify & { app: SkaileApp | null } = {
    appId: options.appId,
    app: null,
    start() {
      if (!started) {
        started = zone.outside(run).catch((error: unknown) => {
          if (closed) return;
          const message = describe(error);
          logger.error("skailify: could not connect to Skaile", { message });
          setStatus({ state: "error", message });
          log({ direction: "out", label: "connect failed", detail: message, error: true });
        });
      }
      return started;
    },
    setAssistant(presentation) {
      assistant = presentation;
      if (started && !closed) postAssistant(presentation);
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
    viewOrder: () => ++viewSeq,
    registerView(view, order) {
      const key = ++viewSeq;
      const entry = { view, order: order ?? key };
      views.set(key, entry);
      viewChanged();
      return {
        update(next) {
          if (!views.has(key)) return;
          views.set(key, { view: next, order: entry.order });
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
    agentName,
    loading,
    settle,
    fullName,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    log,
    async requestAgentTurn(request) {
      if (!app) throw new AppTurnRefusedError("not_connected");
      try {
        await app.requestAgentTurn(request);
        log({ direction: "out", label: "agent turn", detail: summarize(request.text) });
      } catch (error) {
        const detail = error instanceof AppTurnRefusedError ? error.reason : describe(error);
        log({ direction: "out", label: "agent turn refused", detail, error: true });
        throw error;
      }
    },
    get user() {
      return user;
    },
    onUserChange(handler) {
      userListeners.add(handler);
      return () => {
        userListeners.delete(handler);
      };
    },
  };

  generic.push(...genericCapabilities(handle, options.navigation));
  sync();
  return handle;
}
