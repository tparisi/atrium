// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createWorld } from '../src/world.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// Each test loads its own world to keep state isolated
async function loadWorld() {
  return createWorld(FIXTURE_PATH)
}

test('loads space.gltf and exposes world meta', async () => {
  const world = await loadWorld()
  assert.equal(world.meta.name, 'Space')
})

test('finds a node by name', async () => {
  const world = await loadWorld()
  const node = world.getNode('crate-01')
  assert.ok(node !== null)
})

test('returns null for unknown node', async () => {
  const world = await loadWorld()
  const node = world.getNode('does-not-exist')
  assert.equal(node, null)
})

test('sets translation on a node', async () => {
  const world = await loadWorld()
  const result = world.setField('crate-01', 'translation', [5, 0, 0])
  assert.equal(result.ok, true)
  assert.deepEqual(world.getNodeTranslation('crate-01'), [5, 0, 0])
})

test('returns NODE_NOT_FOUND for unknown node', async () => {
  const world = await loadWorld()
  const result = world.setField('ghost', 'translation', [0, 0, 0])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NODE_NOT_FOUND')
})

test('returns INVALID_FIELD for unknown field', async () => {
  const world = await loadWorld()
  const result = world.setField('crate-01', 'color', 'red')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_FIELD')
})

test('adds a node', async () => {
  const world = await loadWorld()
  const result = world.addNode({ name: 'box-01', translation: [0, 1, 0] })
  assert.equal(result.ok, true)
  assert.ok(world.getNode('box-01') !== null)
})

test('removes a node', async () => {
  const world = await loadWorld()
  const result = world.removeNode('crate-01')
  assert.equal(result.ok, true)
  assert.equal(world.getNode('crate-01'), null)
})

test('returns NODE_NOT_FOUND when removing unknown node', async () => {
  const world = await loadWorld()
  const result = world.removeNode('ghost')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NODE_NOT_FOUND')
})
