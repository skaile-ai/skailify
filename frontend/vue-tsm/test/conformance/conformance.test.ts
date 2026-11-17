// SPDX-License-Identifier: Apache-2.0

/**
 * The app SDK's conformance checks against the adapter: a small app with two
 * views, started the way an app's shell starts it, on the SDK's fake gateway.
 */
import { describe, it } from 'bun:test'
import { noopLogger } from '@skaile/workspaces/app-sdk'
import { registerAppConformance } from '@skaile/workspaces/app-sdk/testing'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AgentRegistry, z, type TurnPrincipal, type ViewDescriptor } from '../../src/index.js'
import { startSkailify } from '../../src/connect.js'
import { embedded } from '../host.js'

const VIEWS: ViewDescriptor[] = [
  { id: 'orders', title: 'Orders', menu: true, objectTypes: ['Order'] },
  { id: 'customers', title: 'Customers', menu: true, objectTypes: ['Customer'] },
]

registerAppConformance(
  { describe, it },
  {
    title: 'vue-tsm adapter conformance',
    connect: async (gateway) => {
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] })
      await router.push('/orders')
      const registry = new AgentRegistry()
      // A view action that answers with who asked, as an app's own action would read ctx.principal.
      registry.registerAction({
        name: 'whoami',
        description: 'Report who set off the current turn.',
        kind: 'query',
        input: z.object({}),
        handler: async (_input: unknown, ctx: { principal: TurnPrincipal }) => ({ principal: ctx.principal }),
      })
      const handle = startSkailify({
        appId: 'shop',
        views: () => VIEWS,
        router,
        registry,
        settleTimeoutMs: 300,
        logger: noopLogger,
        windowRef: embedded,
        resolveParams: async (appId) => ({ appId, url: 'wss://skaile.test/app-connect', token: 'token' }),
        createTransport: () => gateway.transport(),
      })
      await handle.ready
      if (!handle.app?.session) throw new Error('the adapter did not connect')
      return handle
    },
    view: { name: 'app.navigate', input: { view: 'customers' } },
    principal: { name: 'app.whoami' },
    effectClasses: { 'app.navigate': 'routine', 'app.form.submit': 'routine' },
  },
)
