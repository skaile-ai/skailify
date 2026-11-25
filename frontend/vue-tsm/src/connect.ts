// SPDX-License-Identifier: Apache-2.0

/**
 * The wiring to Skaile: handshake with the embedding host, the app channel
 * with a token provider for reconnects, the capabilities kept in step with
 * the registry, and the view state (`reportView`, `loading`, `settled`) after
 * every call that changes the view and every navigation. The only file that
 * talks to `@skaile/workspaces/app-sdk`'s transport.
 *
 * It connects only inside a Skaile session: the platform embeds a `protocol`
 * preview app in an iframe whose URL carries `skaileParentOrigin`. Opened on
 * its own, the app has neither, and nothing here runs.
 */
import {
  AppTurnRefusedError,
  consoleLogger,
  createSkaileApp,
  createWebSocketAppTransport,
  resolveAppConnectionParams,
  setAssistantPresentation,
  type AppAssistantPresentation,
  type AppConnectionParams,
  type AppLogger,
  type AppSession,
  type AppTransport,
  type AppTurnRequest,
  type AppUser,
  type SessionTokenProvider,
  type SkaileApp,
} from '@skaile/workspaces/app-sdk'
import { skaileParentOrigin } from '@skaile/skailify-core'
import { createBridge, type Bridge, type BridgeOptions, type SkailifyCapability } from './bridge.js'
import { effectClassRefusal } from './platform.js'
import { registry as sharedRegistry } from './registry.js'

export type ConnectionStatus =
  | { state: 'standalone' }
  | { state: 'connecting' }
  | { state: 'connected'; sessionId: string; userId?: string }
  | { state: 'reconnecting' }
  | { state: 'error'; message: string }

interface WindowLike {
  readonly parent: unknown
  readonly location: { readonly search: string }
}

export interface SkailifyOptions extends BridgeOptions {
  /** `auto` (default): connect when embedded in Skaile; `false`: never */
  enabled?: 'auto' | false
  logger?: AppLogger
  onStatus?: (status: ConnectionStatus) => void
  /**
   * How Skaile shows its agent button over the app: `{ kind: 'none' }` hides it, `{ kind: 'floating', corner,
   * offset, size, accent }` places it. Without it Skaile shows the button where it chooses. Change it later with
   * {@link SkailifyHandle.setAssistant}.
   */
  assistant?: AppAssistantPresentation
  /** For tests: the window, the host handshake, the transport and the assistant message */
  windowRef?: WindowLike
  resolveParams?: (appId: string, parentOrigin: string, assistant?: AppAssistantPresentation) => Promise<AppConnectionParams>
  postAssistant?: (appId: string, parentOrigin: string, presentation: AppAssistantPresentation) => void
  createTransport?: (url: string, token: SessionTokenProvider) => AppTransport
}

export interface SkailifyHandle {
  bridge: Bridge
  /** The SDK peer; null when not embedded */
  app: SkaileApp | null
  /** Resolves when the first connect is done (or failed, or there is nothing to connect) */
  ready: Promise<void>
  /** Changes how Skaile shows its agent button over the app (see {@link SkailifyOptions.assistant}); standalone a no-op */
  setAssistant(presentation: AppAssistantPresentation): void
  /**
   * Asks the agent to act now: Skaile starts a turn with `text` as the signed-in user's message, marked as sent
   * through the app. Resolves once the turn started; rejects with an `AppTurnRefusedError` naming the reason
   * (`viewer`, `rate_limited` with `retryAfterMs`, `not_connected`, `timeout`, …). Standalone: `not_connected`.
   */
  requestAgentTurn(request: AppTurnRequest): Promise<void>
  /** The signed-in user while connected; undefined standalone, before the connection and while reconnecting */
  readonly user: AppUser | undefined
  /** Calls `handler` whenever {@link user} changes; returns the unsubscribe */
  onUserChange(handler: (user: AppUser | undefined) => void): () => void
  close(): Promise<void>
}

const notConnected = () => Promise.reject(new AppTurnRefusedError('not_connected'))

// From the core client, bundled into this package's build: an app's import map needs no entry for the core.
export { skaileParentOrigin }

export function startSkailify(options: SkailifyOptions): SkailifyHandle {
  const bridge = createBridge(options)
  const status = options.onStatus ?? (() => {})
  const parentOrigin = options.enabled === false ? null : skaileParentOrigin(options.windowRef)

  if (!parentOrigin) {
    status({ state: 'standalone' })
    return {
      bridge,
      app: null,
      ready: Promise.resolve(),
      setAssistant: () => {},
      requestAgentTurn: notConnected,
      user: undefined,
      onUserChange: () => () => {},
      close: async () => {},
    }
  }

  const logger = options.logger ?? consoleLogger
  const resolve = options.resolveParams
    ?? ((appId: string, origin: string, presentation?: AppAssistantPresentation) =>
      resolveAppConnectionParams({ appId, parentOrigin: origin, ...(presentation ? { assistant: presentation } : {}) }))
  // The hints the next ping carries; a change made while one was in flight is sent again once it is answered.
  let assistant = options.assistant
  const resolveParams = async (appId: string, origin: string): Promise<AppConnectionParams> => {
    const sent = assistant
    const params = await resolve(appId, origin, sent)
    if (assistant !== sent && assistant && !closed) postAssistant(assistant)
    return params
  }
  function postAssistant(presentation: AppAssistantPresentation): void {
    try {
      const post = options.postAssistant
        ?? ((appId: string, origin: string, p: AppAssistantPresentation) =>
          setAssistantPresentation({ appId, parentOrigin: origin, presentation: p }))
      post(options.appId, parentOrigin!, presentation)
    } catch (error) {
      logger.warn('skailify: could not send the assistant hints', { message: error instanceof Error ? error.message : String(error) })
    }
  }
  const createTransport = options.createTransport
    ?? ((url: string, sessionToken: SessionTokenProvider) => createWebSocketAppTransport({ url, sessionToken }))

  let closed = false
  let app: SkaileApp | null = null
  const userListeners = new Set<(user: AppUser | undefined) => void>()
  const handle: SkailifyHandle = {
    bridge,
    app: null,
    ready: Promise.resolve(),
    setAssistant(presentation) {
      assistant = presentation
      if (!closed) postAssistant(presentation)
    },
    requestAgentTurn: (request) => (app ? app.requestAgentTurn(request) : notConnected()),
    get user() {
      return app?.user
    },
    onUserChange(handler) {
      userListeners.add(handler)
      return () => {
        userListeners.delete(handler)
      }
    },
    close: async () => {},
  }

  /**
   * Brings the registered capabilities in step with the bridge's: new and changed ones register, gone ones
   * deregister. A declaration the platform would refuse (an effect class above `routine` without approval)
   * is never sent; it is logged instead.
   */
  let registered = new Map<string, SkailifyCapability>()
  const refused = new WeakSet<SkailifyCapability>()

  /** Calls running now that may change the view: while one runs, nothing reports `settled`. */
  let running = 0
  /** Bumped by every scheduled report, so an older wait still running gives way to the newer one. */
  let generation = 0
  /** How many settle timeouts a report waits for a view that keeps loading before it leaves the phase at loading. */
  const MAX_REPORT_WAITS = 10

  /** Tells the platform which view is shown and a summary of it; the rows and field values stay with get_view_state. */
  function reportView() {
    if (!app || closed) return
    const state = bridge.viewState()
    app.reportView({
      viewId: state.view?.id ?? (state.path || '/'),
      ...(state.view ? { title: state.view.title } : {}),
      state: {
        path: state.path,
        query: state.query,
        selected: state.selected ? { type: state.selected.type, id: state.selected.id } : null,
        lists: state.lists.map(({ id, type, shown, total, loading }) => ({ id, type, shown, total, loading })),
        forms: state.forms.map(({ id, type, objectId }) => ({ id, type, objectId })),
        actions: state.actions,
        settled: state.settled,
      },
    })
  }

  /**
   * Reports the view once it has settled, then sends `settled`. While it keeps loading past the settle timeout, the
   * view is reported as it is (with `settled: false`) and the wait goes on; the phase stays `loading`. Gives way to a
   * newer report, and to a call still running (which schedules its own when it ends). Never throws: a failure to read
   * or send the view is logged, not handed to the call that changed it.
   */
  function scheduleReport() {
    const mine = ++generation
    const current = () => !closed && !!app && mine === generation && running === 0
    void (async () => {
      try {
        for (let wait = 1; ; wait++) {
          const done = await bridge.settle()
          if (!current()) return
          reportView()
          if (done) {
            app!.settled()
            return
          }
          if (wait >= MAX_REPORT_WAITS) return
        }
      } catch (error) {
        logger.warn('skailify: could not report the view', { message: error instanceof Error ? error.message : String(error) })
      }
    })()
  }

  /**
   * The capability as it goes on the wire: anything but a query says `loading` when it starts, and once the last
   * running call has ended the view is reported when it has settled (see {@link scheduleReport}). The result goes
   * back at once; the report follows. Same input, same object.
   */
  const wired = new WeakMap<SkailifyCapability, SkailifyCapability>()
  function onWire(capability: SkailifyCapability): SkailifyCapability {
    if (capability.kind === 'query') return capability
    let wire = wired.get(capability)
    if (!wire) {
      const handler = capability.handler
      wire = {
        ...capability,
        handler: async (input, ctx) => {
          running++
          app?.loading(capability.name)
          try {
            return await handler(input, ctx)
          } finally {
            running--
            if (running === 0) scheduleReport()
          }
        },
      }
      wired.set(capability, wire)
    }
    return wire
  }

  /** Any navigation, the user's own or a call's: loading, then the view once it has settled. */
  const stopRouter = options.router.afterEach((_to, _from, failure) => {
    if (failure || !app || closed) return
    app.loading('navigation')
    scheduleReport()
  })
  function sync() {
    if (!app) return
    const now = new Map<string, SkailifyCapability>()
    for (const capability of bridge.capabilities()) {
      const refusal = effectClassRefusal(capability)
      if (!refusal) {
        now.set(capability.name, capability)
      } else if (!refused.has(capability)) {
        refused.add(capability)
        logger.error(`skailify: not registered, ${refusal}`, { name: capability.name })
      }
    }
    const before = registered
    registered = now
    for (const name of before.keys()) if (!now.has(name)) app.deregisterCapability(name)
    for (const [name, capability] of now) if (before.get(name) !== capability) app.registerCapability(onWire(capability))
  }
  const unsubscribe = (options.registry ?? sharedRegistry).onActionsChange(sync)

  async function run(): Promise<void> {
    status({ state: 'connecting' })
    // The first token comes with the url; every reconnect asks the host for a fresh one — the gateway burns it at app_hello.
    let primed: AppConnectionParams | null = await resolveParams(options.appId, parentOrigin!)
    if (closed) return
    const transport = createTransport(primed.url, () => {
      if (primed) {
        const token = primed.token
        primed = null
        return token
      }
      return resolveParams(options.appId, parentOrigin!).then((params) => params.token)
    })
    app = createSkaileApp({ appId: options.appId, transport, logger })
    handle.app = app
    sync()
    app.onUserChange((user) => {
      for (const handler of [...userListeners]) {
        try {
          handler(user)
        } catch (error) {
          logger.error('skailify: a user change handler threw', { message: error instanceof Error ? error.message : String(error) })
        }
      }
    })
    app.onSessionChange((session: AppSession | null) => {
      status(session ? { state: 'connected', sessionId: session.sessionId, userId: session.userId } : { state: 'reconnecting' })
    })
    if (closed) {
      await app.close()
      return
    }
    await app.connect()
    // the view the app opened on, once it has settled; the SDK replays the last report on every reconnect
    scheduleReport()
  }

  handle.ready = run().catch((error: unknown) => {
    if (closed) return
    const message = error instanceof Error ? error.message : String(error)
    stopRouter()
    logger.error('skailify: could not connect to Skaile', { message })
    status({ state: 'error', message })
  })
  handle.close = async () => {
    closed = true
    unsubscribe()
    stopRouter()
    await app?.close()
  }
  return handle
}
