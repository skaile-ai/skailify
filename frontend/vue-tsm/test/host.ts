// SPDX-License-Identifier: Apache-2.0

/**
 * The embedding host for the tests: the app SDK's fake gateway
 * (`@skaile/workspaces/app-sdk/testing`) behind the iframe handshake the host
 * answers with a url and a fresh single-use token. The gateway is the SDK's;
 * only the handshake, which the fake gateway does not play, is here.
 */
import type { AppConnectionParams, AppTransport, SessionTokenProvider } from '@skaile/workspaces/app-sdk'
import { createFakeGateway, type FakeGateway, type FakeInvokeOptions } from '@skaile/workspaces/app-sdk/testing'

export const PARENT_ORIGIN = 'https://skaile.test'

/** The principal the tests' calls come from unless a test names another. */
export const USER = { kind: 'human', userId: 'user-1' } as const

/** Long enough for any wait the bridge allows (MAX_WAIT_MS), so a call never times out before the view does. */
const CALL_TIMEOUT_MS = 15_000

export interface FakeHost {
  gateway: FakeGateway
  /** Every token a connection was opened with, in order */
  tokens: string[]
  resolveParams: (appId: string, parentOrigin: string) => Promise<AppConnectionParams>
  createTransport: (url: string, token: SessionTokenProvider) => AppTransport
  /** Calls a capability as the agent would, from {@link USER}'s turn unless `principal` is given; resolves with the result. */
  invoke(name: string, input?: unknown, options?: FakeInvokeOptions): Promise<unknown>
  /** The capability names sent in register frames, in order, across connections. */
  sent(): string[]
}

export function createFakeHost(): FakeHost {
  const gateway = createFakeGateway({ sessionId: 'session-1', userId: 'user-1' })
  const tokens: string[] = []
  let minted = 0

  return {
    gateway,
    tokens,
    resolveParams: async (appId, parentOrigin) => {
      if (parentOrigin !== PARENT_ORIGIN) throw new Error(`unexpected parent origin ${parentOrigin}`)
      return { appId, url: 'wss://skaile.test/app-connect', token: `token-${++minted}` }
    },
    createTransport: (_url, token) => {
      // One transport for the app's lifetime, as the WebSocket transport is: every connect asks for a token.
      const connection = gateway.transport()
      return {
        get connected() {
          return connection.connected
        },
        async connect() {
          tokens.push(await token())
          await connection.connect()
        },
        disconnect: () => connection.disconnect(),
        send: (message) => connection.send(message),
        onMessage: (handler) => connection.onMessage(handler),
        onDisconnect: (handler) => connection.onDisconnect(handler),
      }
    },
    invoke: (name, input = {}, options = {}) =>
      gateway.invoke(name, input, { principal: USER, timeoutMs: CALL_TIMEOUT_MS, ...options }),
    sent: () =>
      gateway.frames.flatMap(({ message }) =>
        message.type === 'capability_register' ? message.capabilities.map((c) => c.name) : [],
      ),
  }
}

/** A window embedded by Skaile: a parent, and the parent origin on the URL. */
export const embedded = { parent: {}, location: { search: `?skaileParentOrigin=${encodeURIComponent(PARENT_ORIGIN)}` } }
export const standalone = { get parent() { return standalone }, location: { search: '' } }
