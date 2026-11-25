// SPDX-License-Identifier: Apache-2.0

/**
 * The shared helpers before any startSkailify. Its own file, so the module state is one no other test has started.
 */
import { expect, it } from 'bun:test'
import { AppTurnRefusedError, requestAgentTurn, skailifyBridge, useSkailifyUser } from '../../src/index.js'

it('before startSkailify, requestAgentTurn rejects with not_connected and there is no user', async () => {
  expect(useSkailifyUser().value).toBeUndefined()
  expect(skailifyBridge()).toBeNull()
  const error = await requestAgentTurn({ text: 'too early' }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(AppTurnRefusedError)
  expect(error).toMatchObject({ reason: 'not_connected' })
})
