// SPDX-License-Identifier: Apache-2.0
import { expect, test } from 'bun:test'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { tsmViewSource, type TsmModuleContext } from '../../src/index.js'

// The published types declare the slice of tsm they use instead of importing the optional peer.
// vue-tsc (part of `bun run test`) fails here if a real tsm ModuleContext stops fitting it.
const fits = (context: ModuleContext): TsmModuleContext => context

test('a tsm ModuleContext fits TsmModuleContext', () => {
  expect(typeof fits).toBe('function')
  expect(typeof tsmViewSource).toBe('function')
})
