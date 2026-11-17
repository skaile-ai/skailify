// SPDX-License-Identifier: Apache-2.0

/**
 * The effect class and turn principal fields, carried by the app SDK: the
 * effect class on registration (and its guard) and the turn principal on
 * invocation, through the real SDK against the fake gateway.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import type { AppLogger } from '@skaile/workspaces/app-sdk'
import { AgentRegistry, effectClassRefusal, z, type SkailifyHandle, type TurnPrincipal } from '../../src/index.js'
import { startSkailify } from '../../src/connect.js'
import { createFakeHost, embedded, type FakeHost } from '../host.js'
import { create, orderForm } from '../fixture.js'

interface Line { level: string; message: string; data?: unknown }

let router: Router
let host: FakeHost
let registry: AgentRegistry
let handle: SkailifyHandle
let lines: Line[]

const logger: AppLogger = {
  debug: () => {},
  info: (message, data) => lines.push({ level: 'info', message, data }),
  warn: (message, data) => lines.push({ level: 'warn', message, data }),
  error: (message, data) => lines.push({ level: 'error', message, data }),
}

beforeEach(async () => {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] })
  await router.push('/orders')
  host = createFakeHost()
  registry = new AgentRegistry()
  lines = []
  handle = startSkailify({
    appId: 'shop',
    views: () => [{ id: 'orders', title: 'Orders', menu: true, objectTypes: ['Order'] }],
    router,
    registry,
    settleTimeoutMs: 200,
    logger,
    windowRef: embedded,
    resolveParams: host.resolveParams,
    createTransport: host.createTransport,
  })
  await handle.ready
})

afterEach(async () => {
  await handle?.close()
  await host.gateway.close()
})

const action = (extra: Record<string, unknown>) => ({
  name: 'orders.ship',
  description: 'Ship an order',
  kind: 'effect' as const,
  input: z.object({ orderId: z.string() }),
  handler: async ({ orderId }: { orderId: string }) => ({ shipped: orderId }),
  ...extra,
})

describe('effect class', () => {
  it('goes out on the register frame when declared', () => {
    registry.registerAction(action({ requiresApproval: true, effectClass: 'external' }))
    expect(host.gateway.capabilities.get('app.orders.ship')).toMatchObject({ requiresApproval: true, effectClass: 'external' })
  })

  it('is left out when not declared, and on the generic capabilities', () => {
    registry.registerAction(action({ requiresApproval: true }))
    // the SDK writes `effectClass: undefined`, which JSON leaves off the wire
    expect(host.gateway.capabilities.get('app.orders.ship')?.effectClass).toBeUndefined()
    for (const capability of host.gateway.capabilities.values()) expect(capability.effectClass).toBeUndefined()
  })

  it('goes out again on reconnect', async () => {
    registry.registerAction(action({ requiresApproval: true, effectClass: 'privileged' }))
    // the gateway forgets every registration with the dropped socket
    host.gateway.drop()
    expect(host.gateway.capabilities.has('app.orders.ship')).toBe(false)
    await host.gateway.waitFor((g) => g.capabilities.get('app.orders.ship')?.effectClass === 'privileged', { timeoutMs: 5000 })
  })

  it.each(['external', 'privileged', 'never'])('%s without requiresApproval is never sent', (effectClass) => {
    registry.registerAction(action({ effectClass }))
    registry.registerAction({ ...action({}), name: 'orders.note' }) // a later change syncs again
    expect(host.sent()).not.toContain('app.orders.ship')
    expect(host.sent()).toContain('app.orders.note')
    expect(lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([
      `skailify: not registered, app.orders.ship: effectClass ${effectClass} requires requiresApproval: true`,
    ])
  })

  it('an unknown class is never sent', () => {
    registry.registerAction(action({ requiresApproval: true, effectClass: 'harmless' }))
    expect(host.sent()).not.toContain('app.orders.ship')
  })

  it('a changed declaration under the same name is sent again, and a refused one withdraws it', () => {
    registry.registerAction(action({ requiresApproval: true }))
    registry.registerAction(action({ requiresApproval: true, effectClass: 'external' }))
    expect(host.sent().filter((n) => n === 'app.orders.ship')).toHaveLength(2)
    expect(host.gateway.capabilities.get('app.orders.ship')?.effectClass).toBe('external')
    registry.registerAction(action({ effectClass: 'external' }))
    expect(host.gateway.capabilities.has('app.orders.ship')).toBe(false)
  })

  it('follows the gateway rule', () => {
    expect(effectClassRefusal({ name: 'a' })).toBeNull()
    expect(effectClassRefusal({ name: 'a', effectClass: 'routine' })).toBeNull()
    expect(effectClassRefusal({ name: 'a', effectClass: 'never', requiresApproval: true })).toBeNull()
    expect(effectClassRefusal({ name: 'a', effectClass: 'external', requiresApproval: false })).toMatch(/requires requiresApproval/)
    expect(effectClassRefusal({ name: 'a', effectClass: 7, requiresApproval: true })).toMatch(/must be one of/)
  })
})

describe('turn principal', () => {
  const principals: TurnPrincipal[] = [
    { kind: 'human', userId: 'u1' },
    { kind: 'trigger', source: 'schedule', userId: 'u1' },
    { kind: 'mixed', userIds: ['u1', 'u2'] },
    { kind: 'unknown' },
  ]

  it.each(principals)('reaches the handler as ctx.principal: $kind', async (principal) => {
    registry.registerAction(action({ handler: async (_: unknown, ctx: { principal: TurnPrincipal }) => ctx.principal }))
    expect(await host.invoke('app.orders.ship', { orderId: 'o1' }, { principal })).toEqual(principal)
  })

  it('is unknown when the frame has none or a malformed one', async () => {
    registry.registerAction(action({ handler: async (_: unknown, ctx: { principal: TurnPrincipal }) => ctx.principal }))
    expect(await host.invoke('app.orders.ship', { orderId: 'o1' }, { principal: undefined })).toEqual({ kind: 'unknown' })
    expect(await host.invoke('app.orders.ship', { orderId: 'o1' }, { principal: { kind: 'human' } })).toEqual({ kind: 'unknown' })
    expect(await host.invoke('app.orders.ship', { orderId: 'o1' }, { principal: { kind: 'mixed', userIds: [1] } })).toEqual({ kind: 'unknown' })
  })

  it('stays with its own call when calls overlap', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    registry.registerAction(action({
      handler: async ({ orderId }: { orderId: string }, ctx: { principal: TurnPrincipal }) => {
        if (orderId === 'slow') await gate
        return ctx.principal
      },
    }))
    const slow = host.invoke('app.orders.ship', { orderId: 'slow' }, { principal: { kind: 'human', userId: 'u1' } })
    const fast = await host.invoke('app.orders.ship', { orderId: 'fast' }, { principal: { kind: 'human', userId: 'u2' } })
    release()
    expect(fast).toEqual({ kind: 'human', userId: 'u2' })
    expect(await slow).toEqual({ kind: 'human', userId: 'u1' })
  })

  it('is audited on form.submit', async () => {
    registry.registerForm({ uiModel: orderForm(), model: () => create('Order', { id: 'o1' }), submit: async () => true })
    await host.invoke('app.form.submit', {}, { principal: { kind: 'trigger', source: 'peer-agent', userId: 'u7' } })
    expect(lines.filter((l) => l.message.startsWith('skailify audit'))).toEqual([{
      level: 'info',
      message: 'skailify audit: app.form.submit',
      data: {
        action: 'app.form.submit',
        principal: { kind: 'trigger', source: 'peer-agent', userId: 'u7' },
        sessionId: 'session-1',
        form: 'OrderForm',
        type: 'Order',
        objectId: 'o1',
      },
    }])
  })
})
