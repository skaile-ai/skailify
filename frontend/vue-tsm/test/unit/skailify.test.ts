// SPDX-License-Identifier: Apache-2.0

/**
 * The generic capabilities end to end through the real app SDK, against a
 * fake host and gateway: handshake, registration, invocation, results.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import type { EObject } from '@emfts/core'
import { noopLogger } from '@skaile/workspaces/app-sdk'
import { AgentRegistry, AppTurnRefusedError, requestAgentTurn, startSkailify, useSkailifyUser, z, type SkailifyHandle, type ViewDescriptor } from '../../src/index.js'
import { startSkailify as startUnshared } from '../../src/connect.js'
import { createFakeHost, embedded, standalone, type FakeHost } from '../host.js'
import { create, get, orderForm } from '../fixture.js'

const VIEWS: ViewDescriptor[] = [
  { id: 'orders', title: 'Orders', menu: true, objectTypes: ['Order'] },
  { id: 'customers', title: 'Customers', menu: true, objectTypes: ['Customer'] },
  { id: 'settings', title: 'Settings', menu: false, objectTypes: [] },
]

const customers = [create('Customer', { id: 'c1', name: 'ACME' }), create('Customer', { id: 'c2', name: 'Globex' })]
const resolveReference = (type: string, key: string) =>
  type === 'Customer' ? customers.find((c) => get(c, 'id') === key || get(c, 'name') === key) : undefined

let router: Router
let host: FakeHost
let registry: AgentRegistry
let handle: SkailifyHandle

function start(extra: Record<string, unknown> = {}) {
  handle = startUnshared({
    appId: 'shop',
    views: () => VIEWS,
    router,
    registry,
    resolveReference,
    settleTimeoutMs: 300,
    logger: noopLogger,
    windowRef: embedded,
    resolveParams: host.resolveParams,
    createTransport: host.createTransport,
    ...extra,
  })
  return handle.ready
}

beforeEach(async () => {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] })
  await router.push('/orders')
  host = createFakeHost()
  registry = new AgentRegistry()
})

afterEach(async () => {
  await handle?.close()
  await host.gateway.close()
})

describe('connecting', () => {
  it('does nothing standalone', async () => {
    const statuses: string[] = []
    const standaloneHandle = startSkailify({ appId: 'shop', views: () => VIEWS, router, windowRef: standalone, onStatus: (s) => statuses.push(s.state), resolveParams: host.resolveParams, createTransport: host.createTransport })
    await standaloneHandle.ready
    expect(standaloneHandle.app).toBeNull()
    expect(host.gateway.helloCount).toBe(0)
    expect(statuses).toEqual(['standalone'])
    await standaloneHandle.close()
  })

  it('says hello as the app and registers the generic capabilities', async () => {
    await start()
    expect(host.gateway.helloCount).toBe(1)
    expect(host.gateway.hello?.appId).toBe('shop')
    expect(host.tokens).toEqual(['token-1'])
    expect([...host.gateway.capabilities.keys()]).toEqual([
      'app.list_views', 'app.get_view_state', 'app.navigate', 'app.open', 'app.select', 'app.form.set_fields', 'app.form.submit',
    ])
    expect(host.gateway.capabilities.get('app.get_view_state')!.kind).toBe('query')
    expect(host.gateway.capabilities.get('app.navigate')!.kind).toBe('effect')
  })

  it('puts the capability prefix in one place', async () => {
    await start({ capabilityPrefix: 'shop' })
    expect([...host.gateway.capabilities.keys()][0]).toBe('app.shop.list_views')
  })

  it('reconnects with a fresh token from the host', async () => {
    await start()
    host.gateway.drop()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(host.tokens).toEqual(['token-1', 'token-2'])
    expect(host.gateway.helloCount).toBe(2)
    expect(host.gateway.capabilities.has('app.form.submit')).toBe(true)
  }, 5000)
})

describe('assistant hints', () => {
  const HIDDEN = { kind: 'none' } as const
  const TOP_LEFT = { kind: 'floating', corner: 'top-left' } as const
  const message = (presentation: unknown) => ({ appId: 'shop', origin: 'https://skaile.test', presentation })

  /** Records what each ping carried and each runtime message sent; `hold` keeps the next answer until released. */
  function recording() {
    const pings: unknown[] = []
    const posted: unknown[] = []
    let release: (() => void) | null = null
    let held = false
    return {
      pings,
      posted,
      hold: () => { held = true },
      release: () => release?.(),
      options: {
        resolveParams: async (appId: string, origin: string, assistant?: unknown) => {
          pings.push(assistant)
          if (held) {
            held = false
            await new Promise<void>((resolve) => { release = resolve })
          }
          return host.resolveParams(appId, origin)
        },
        postAssistant: (appId: string, origin: string, presentation: unknown) => posted.push({ appId, origin, presentation }),
      },
    }
  }

  it('sends the option on every ping, and a change once connected as a message that later pings carry', async () => {
    const r = recording()
    await start({ ...r.options, assistant: TOP_LEFT })
    handle.setAssistant(HIDDEN)
    expect(r.posted).toEqual([message(HIDDEN)])
    host.gateway.drop()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(r.pings).toEqual([TOP_LEFT, HIDDEN])
  }, 5000)

  it('sends a change made while a ping is in flight again once the host answered', async () => {
    const r = recording()
    r.hold()
    const ready = start({ ...r.options, assistant: TOP_LEFT })
    while (r.pings.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    handle.setAssistant(HIDDEN)
    r.release()
    await ready
    expect(r.pings).toEqual([TOP_LEFT])
    expect(r.posted).toEqual([message(HIDDEN), message(HIDDEN)])
  })

  it('sends nothing standalone', async () => {
    const r = recording()
    const standaloneHandle = startSkailify({ appId: 'shop', views: () => VIEWS, router, windowRef: standalone, ...r.options })
    standaloneHandle.setAssistant(HIDDEN)
    expect(r.posted).toEqual([])
    await standaloneHandle.close()
  })
})

describe('views and navigation', () => {
  beforeEach(() => start())

  it('lists the views and the current one', async () => {
    expect(await host.invoke('app.list_views')).toEqual({ current: 'orders', views: VIEWS })
  })

  it('navigates to a view with an object selected', async () => {
    const state = await host.invoke('app.navigate', { view: 'customers', objectId: 'c2' }) as Record<string, unknown>
    expect(router.currentRoute.value.fullPath).toBe('/customers?id=c2')
    expect(state).toMatchObject({ view: { id: 'customers', title: 'Customers' }, selected: { id: 'c2' } })
  })

  it('refuses an unknown view with the known ones', async () => {
    expect(await host.invoke('app.navigate', { view: 'nope' })).toEqual({ error: 'no view nope; views: orders, customers, settings' })
  })

  it('opens an object in the view that shows its type', async () => {
    await host.invoke('app.open', { type: 'Customer', id: 'c1' })
    expect(router.currentRoute.value.fullPath).toBe('/customers?id=c1')
    expect(await host.invoke('app.open', { type: 'Invoice', id: 'i1' })).toEqual({ error: 'no view opens Invoice; types with a view: Order, Customer' })
  })
})

describe('lists', () => {
  beforeEach(() => start({ maxRows: 1 }))

  it('shows visible rows capped, with ids and labels', async () => {
    registry.registerList({ id: 'customers', rows: () => customers, total: () => 5 })
    const state = await host.invoke('app.get_view_state') as { lists: unknown[] }
    expect(state.lists).toEqual([{ id: 'customers', type: 'Customer', shown: 2, total: 5, rows: [{ id: 'c1', label: 'ACME' }], truncated: true, loading: false }])
  })

  it('selects a row through the route by default', async () => {
    registry.registerList({ rows: () => customers })
    await host.invoke('app.select', { id: 'c2' })
    expect(router.currentRoute.value.fullPath).toBe('/orders?id=c2')
  })

  it("selects a row the view's own way", async () => {
    const picked: EObject[] = []
    registry.registerList({ rows: () => customers, select: (row) => { picked.push(row) } })
    await host.invoke('app.select', { id: 'c1' })
    expect(picked).toEqual([customers[0]])
    expect(await host.invoke('app.select', { id: 'c9' })).toEqual({ error: 'no row c9 is shown; a search or filter may hide it' })
  })
})

describe('forms', () => {
  let order: EObject
  let saved: EObject[]
  let refusal: string

  beforeEach(async () => {
    await start()
    order = create('Order', { id: 'o1' })
    saved = []
    refusal = ''
    registry.registerForm({
      uiModel: orderForm(),
      model: () => order,
      title: 'Order',
      messages: () => [refusal],
      submit: async () => {
        if (get(order, 'total') === '0') {
          refusal = 'total must be positive'
          return false
        }
        saved.push(order)
        return true
      },
    })
  })

  it('shows the open form with fields, values and what is missing', async () => {
    const state = await host.invoke('app.get_view_state') as { forms: Array<Record<string, unknown>>; selected: unknown }
    expect(state.selected).toEqual({ type: 'Order', id: 'o1', label: 'o1' })
    expect(state.forms[0]).toMatchObject({ id: 'OrderForm', type: 'Order', objectId: 'o1', canSubmit: true, messages: [] })
    expect(state.forms[0].missing).toEqual([{ field: 'number', message: 'is required' }, { field: 'customer', message: 'is required' }])
  })

  it('fills fields and reports the refused ones', async () => {
    const result = await host.invoke('app.form.set_fields', { fields: { number: 'A-1', customer: 'ACME', urgent: 'yes' } })
    expect(result).toEqual({
      form: 'OrderForm',
      applied: ['number', 'customer'],
      errors: [{ field: 'urgent', message: 'expects true or false, got "yes"' }],
      missing: [],
    })
  })

  it('does not submit with required fields empty', async () => {
    expect(await host.invoke('app.form.submit', {})).toEqual({
      form: 'OrderForm', ok: false, objectId: 'o1',
      errors: [{ field: 'number', message: 'is required' }, { field: 'customer', message: 'is required' }],
    })
    expect(saved).toEqual([])
  })

  it("returns the app's refusal, then saves once fixed", async () => {
    await host.invoke('app.form.set_fields', { fields: { number: 'A-1', customer: 'c1', total: '0' } })
    expect(await host.invoke('app.form.submit', {})).toEqual({ form: 'OrderForm', ok: false, objectId: 'o1', errors: [{ message: 'total must be positive' }] })
    await host.invoke('app.form.set_fields', { fields: { total: '12.50' } })
    expect(await host.invoke('app.form.submit', { form: 'OrderForm' })).toEqual({ form: 'OrderForm', ok: true, objectId: 'o1', errors: [] })
    expect(saved).toEqual([order])
  })

  it('names the open forms when the one asked for is not there', async () => {
    expect(await host.invoke('app.form.submit', { form: 'Other' })).toEqual({ error: 'no open form Other; open forms: OrderForm' })
  })
})

describe('actions of a view', () => {
  beforeEach(() => start())

  it('registers and removes them while connected, approval flag included', async () => {
    const remove = registry.registerAction({
      name: 'orders.approve',
      description: 'Approve an order',
      kind: 'effect',
      requiresApproval: true,
      input: z.object({ orderId: z.string() }),
      handler: async ({ orderId }) => ({ approved: orderId }),
    })
    expect(host.gateway.capabilities.get('app.orders.approve')).toMatchObject({ requiresApproval: true, kind: 'effect' })
    expect(await host.invoke('app.orders.approve', { orderId: 'o1' })).toEqual({ approved: 'o1' })
    expect((await host.invoke('app.get_view_state') as { actions: string[] }).actions).toEqual(['app.orders.approve'])
    remove()
    expect(host.gateway.capabilities.has('app.orders.approve')).toBe(false)
  })
})

describe('view state', () => {
  beforeEach(() => start())

  const reports = () => host.gateway.frames.flatMap(({ message }) => (message.type === 'view_report' ? [message] : []))

  it('reports the view it opened on, once settled', async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    expect(host.gateway.view.report).toMatchObject({ viewId: 'orders', title: 'Orders' })
  })

  it('says loading, then reports the view and settles after a call that changes it', async () => {
    await host.invoke('app.navigate', { view: 'customers', objectId: 'c2' })
    const view = await host.gateway.waitForSettled()
    expect(view.report).toMatchObject({ viewId: 'customers', title: 'Customers', state: { path: '/customers', selected: { id: 'c2' } } })
    const types = host.gateway.frames.map((f) => f.message.type)
    expect(types.lastIndexOf('view_loading')).toBeLessThan(types.lastIndexOf('view_report'))
    expect(types.lastIndexOf('view_report')).toBeLessThan(types.lastIndexOf('view_settled'))
  })

  it("reports the user's own navigation", async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    await router.push('/settings')
    await host.gateway.waitFor((g) => g.view.report?.viewId === 'settings' && g.view.phase === 'settled', { timeoutMs: 2000 })
    expect(reports().at(-1)?.title).toBe('Settings')
  })

  it('leaves the rows and field values out of the report', async () => {
    registry.registerList({ id: 'customers', rows: () => customers })
    await host.invoke('app.navigate', { view: 'orders' })
    const { report } = await host.gateway.waitForSettled()
    expect(report?.state).toMatchObject({ lists: [{ id: 'customers', shown: 2 }] })
    expect(JSON.stringify(report)).not.toContain('ACME')
  })

  /** A list whose rows arrive `ms` after `load()`, reporting its loading meanwhile. */
  function lateList(ms: number) {
    let rows: EObject[] = []
    let loading = false
    registry.registerList({ id: 'customers', rows: () => rows, loading: () => loading })
    return () => {
      loading = true
      rows = []
      setTimeout(() => {
        rows = customers
        loading = false
        registry.registerList({ id: 'tick', rows: () => [] })() // the registry is no reactive source: nudge it
      }, ms)
    }
  }

  it("waits for the view after an app's own action before it settles", async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    const load = lateList(400)
    registry.registerAction({ name: 'customers.refresh', description: 'Reload', kind: 'effect', input: z.object({}), handler: async () => { load(); return {} } })
    await host.invoke('app.customers.refresh')
    const view = await host.gateway.waitForSettled({ timeoutMs: 3000 })
    expect(view.report?.state).toMatchObject({ lists: [{ id: 'customers', shown: 2, loading: false }], settled: true })
  })

  it('does not settle while another call still runs', async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    registry.registerAction({ name: 'orders.slow', description: 'Slow', kind: 'effect', input: z.object({}), handler: async () => { await gate; return {} } })
    const slow = host.invoke('app.orders.slow')
    await host.gateway.waitFor((g) => g.view.phase === 'loading', { timeoutMs: 2000 })
    await host.invoke('app.navigate', { view: 'customers' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(host.gateway.view.phase).toBe('loading')
    release()
    await slow
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    expect(host.gateway.view.report?.viewId).toBe('customers')
  })

  it("reports the user's navigation during a call once the view has loaded", async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    registry.registerAction({ name: 'orders.slow', description: 'Slow', kind: 'effect', input: z.object({}), handler: async () => { await gate; return {} } })
    const slow = host.invoke('app.orders.slow')
    await router.push('/customers')
    const load = lateList(400)
    load()
    release()
    await slow
    await host.gateway.waitFor((g) => g.view.phase === 'settled' && g.view.report?.viewId === 'customers', { timeoutMs: 3000 })
    expect(host.gateway.view.report?.state).toMatchObject({ lists: [{ id: 'customers', shown: 2, loading: false }] })
  })

  it('keeps waiting for a view that loads past the settle timeout, and reports it unsettled meanwhile', async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    const load = lateList(900) // the settle timeout is 300 ms
    load()
    await router.push('/customers')
    await host.gateway.waitFor((g) => (g.view.report?.state as { settled?: boolean } | undefined)?.settled === false, { timeoutMs: 2000 })
    expect(host.gateway.view.phase).toBe('loading')
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 3000 })
    expect(host.gateway.view.report?.state).toMatchObject({ lists: [{ shown: 2, loading: false }], settled: true })
  })

  it('reports after an action that declares no kind', async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    registry.registerAction({ name: 'orders.go', description: 'Go', input: z.object({}), handler: async () => { await router.push('/settings'); return {} } })
    await host.invoke('app.orders.go')
    await host.gateway.waitFor((g) => g.view.phase === 'settled' && g.view.report?.viewId === 'settings', { timeoutMs: 2000 })
    expect(host.gateway.frames.some(({ message }) => message.type === 'view_loading' && message.reason === 'app.orders.go')).toBe(true)
  })

  it("keeps a call's result when the view cannot be read", async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    registry.registerList({ id: 'broken', rows: () => customers, labelOf: () => { throw new Error('label boom') } })
    registry.registerAction({ name: 'orders.ok', description: 'Ok', kind: 'effect', input: z.object({}), handler: async () => ({ done: true }) })
    expect(await host.invoke('app.orders.ok')).toEqual({ done: true })
    await new Promise((resolve) => setTimeout(resolve, 400))
  })

  it('does not report a query', async () => {
    await host.gateway.waitFor((g) => g.view.phase === 'settled', { timeoutMs: 2000 })
    const before = reports().length
    await host.invoke('app.get_view_state', { wait: 'none' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reports()).toHaveLength(before)
  })
})

describe('agent turns and the signed-in user', () => {
  async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('condition not met in time')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it('hands work to the agent with turn_request and resolves when the turn starts', async () => {
    const seen: { text: string; context?: unknown }[] = []
    await host.gateway.close()
    host = createFakeHost({ answerTurn: (request) => void seen.push(request) })
    await start()
    await handle.requestAgentTurn({ text: 'Check this order', context: { orderId: 'o1' } })
    expect(seen).toMatchObject([{ type: 'turn_request', text: 'Check this order', context: { orderId: 'o1' } }])
  })

  it('rejects with the reason from turn_refused', async () => {
    await host.gateway.close()
    host = createFakeHost({ answerTurn: () => ({ reason: 'viewer' }) })
    await start()
    const error = await handle.requestAgentTurn({ text: 'Check this order' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppTurnRefusedError)
    expect(error).toMatchObject({ reason: 'viewer' })
  })

  it('rejects with not_connected standalone', async () => {
    const standaloneHandle = startUnshared({ appId: 'shop', views: () => VIEWS, router, registry, windowRef: standalone })
    const error = await standaloneHandle.requestAgentTurn({ text: 'Hi' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ reason: 'not_connected' })
    expect(standaloneHandle.user).toBeUndefined()
  })

  it('has the user from the handshake and follows user_update', async () => {
    await host.gateway.close()
    host = createFakeHost({ displayName: 'Ada', sessionRole: 'Owner' })
    const changes: unknown[] = []
    await start()
    expect(handle.user).toEqual({ userId: 'user-1', displayName: 'Ada', sessionRole: 'Owner' })
    handle.onUserChange((user) => changes.push(user))
    host.gateway.userUpdate({ displayName: 'Ada L.' })
    await until(() => handle.user?.displayName === 'Ada L.')
    expect(changes).toEqual([{ userId: 'user-1', displayName: 'Ada L.', sessionRole: 'Owner' }])
  })

  it('the shared requestAgentTurn and useSkailifyUser follow the started page', async () => {
    const seen: string[] = []
    await host.gateway.close()
    host = createFakeHost({ displayName: 'Ada', sessionRole: 'User', answerTurn: (request) => void seen.push(request.text) })
    const user = useSkailifyUser()
    handle = startSkailify({
      appId: 'shop', views: () => VIEWS, router, logger: noopLogger, windowRef: embedded,
      resolveParams: host.resolveParams, createTransport: host.createTransport,
    })
    await handle.ready
    await until(() => user.value !== undefined)
    expect(user.value).toEqual({ userId: 'user-1', displayName: 'Ada', sessionRole: 'User' })
    await requestAgentTurn({ text: 'Check this order' })
    expect(seen).toEqual(['Check this order'])
    host.gateway.userUpdate({ sessionRole: 'Viewer' })
    await until(() => user.value?.sessionRole === 'Viewer')
  })

  it('useSkailifyUser follows a replacing startSkailify and clears on a drop', async () => {
    const first = createFakeHost({ displayName: 'Ada' })
    const startShared = (h: FakeHost) => startSkailify({
      appId: 'shop', views: () => VIEWS, router, logger: noopLogger, windowRef: embedded,
      resolveParams: h.resolveParams, createTransport: h.createTransport,
    })
    const user = useSkailifyUser()
    await startShared(first).ready
    await until(() => user.value?.displayName === 'Ada')
    await host.gateway.close()
    host = createFakeHost({ displayName: 'Grace' })
    handle = startShared(host)
    await handle.ready
    await until(() => user.value?.displayName === 'Grace')
    host.gateway.drop()
    await until(() => user.value === undefined)
    await first.gateway.close()
  })
})
