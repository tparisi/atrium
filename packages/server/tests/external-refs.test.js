// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createWorld } from '../src/world.js'
import { createSessionServer } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const FIXTURE_EXT  = resolve(__dirname, '../../../tests/fixtures/space-ext.gltf')
const FIXTURE_BASE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const BASE_PORT = 4300

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function closeServer(server) {
  for (const ws of server.wss.clients) ws.terminate()
  return new Promise(resolve => server.wss.close(resolve))
}

function waitForWsOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForWsMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => { try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
    ws.once('error', reject)
  })
}

function makeWsQueue(ws) {
  const queue = []
  ws.on('message', (raw) => { try { queue.push(JSON.parse(raw)) } catch {} })
  async function waitForType(type, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = queue.findIndex(m => m.type === type)
      if (idx >= 0) return queue.splice(idx, 1)[0]
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 10))
    }
  }
  return { queue, waitForType }
}

async function rawHandshake(ws) {
  await waitForWsOpen(ws)
  ws.send(JSON.stringify({ type: 'hello', id: 'test-client-' + Math.random().toString(36).slice(2), capabilities: { tick: { interval: 5000 } } }))
  return waitForWsMessage(ws)
}

// ---------------------------------------------------------------------------
// Test 1: server resolves external references at startup
// ---------------------------------------------------------------------------

test('server SOM contains prefixed nodes after resolveExternalReferences', async () => {
  const world = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()

  const names = world.listNodeNames()

  // Container nodes present
  assert.ok(names.includes('Crate'), 'Crate container node present')
  assert.ok(names.includes('Light'), 'Light container node present')

  // Externally-loaded children present (prefixed)
  assert.ok(names.includes('Crate/Crate'), 'Crate/Crate ingested')
  assert.ok(names.includes('Light/Lamp'),  'Light/Lamp ingested')

  // getNodeByName works for prefixed nodes
  assert.ok(world.som.getNodeByName('Crate/Crate'), 'getNodeByName finds Crate/Crate')
  assert.ok(world.som.getNodeByName('Light/Lamp'),  'getNodeByName finds Light/Lamp')
})

// ---------------------------------------------------------------------------
// Test 2: som-dump excludes external nodes
// ---------------------------------------------------------------------------

test('som-dump excludes externally-ingested nodes, container nodes present', async () => {
  const world = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()

  const json = await world.serialize()

  const nodeNames = (json.nodes ?? []).map(n => n.name)

  // Container nodes must be in the dump
  assert.ok(nodeNames.includes('Crate'), 'Crate container in dump')
  assert.ok(nodeNames.includes('Light'), 'Light container in dump')

  // Externally-ingested children must NOT be in the dump
  assert.ok(!nodeNames.includes('Crate/Crate'), 'Crate/Crate excluded from dump')
  assert.ok(!nodeNames.includes('Light/Lamp'),  'Light/Lamp excluded from dump')
  assert.ok(!nodeNames.includes('Light/lamp-stand'), 'lamp-stand excluded from dump')
  assert.ok(!nodeNames.includes('Light/lamp-shade'), 'lamp-shade excluded from dump')
})

// ---------------------------------------------------------------------------
// Test 3: set on external node succeeds (no NODE_NOT_FOUND)
// ---------------------------------------------------------------------------

test('set targeting an external node validates and broadcasts (no NODE_NOT_FOUND)', async (t) => {
  const world  = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()
  const server = createSessionServer({ port: BASE_PORT + 1, world })
  await new Promise(resolve => server.wss.on('listening', resolve))

  t.after(() => closeServer(server))

  const ws = new WebSocket(`ws://localhost:${BASE_PORT + 1}`)
  const q  = makeWsQueue(ws)
  await rawHandshake(ws)

  // Wait for the som-dump
  const dump = await q.waitForType('som-dump')
  assert.ok(dump, 'received som-dump')

  // Send a set targeting an external node
  ws.send(JSON.stringify({
    type:  'send',
    seq:   1,
    node:  'Crate/Crate',
    field: 'translation',
    value: [1, 0, 0],
  }))

  // Should receive a 'set' broadcast, NOT an error
  const response = await q.waitForType('set')
  assert.ok(response, 'received set broadcast')
  assert.equal(response.node,  'Crate/Crate',   'node name in broadcast')
  assert.equal(response.field, 'translation',   'field in broadcast')
  assert.deepEqual(response.value, [1, 0, 0],   'value in broadcast')
})

// ---------------------------------------------------------------------------
// Test 4: cross-client editing — client A set, client B receives broadcast
// ---------------------------------------------------------------------------

test('cross-client editing: set on external node broadcasts to other client', async (t) => {
  const world  = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()
  const server = createSessionServer({ port: BASE_PORT + 2, world })
  await new Promise(resolve => server.wss.on('listening', resolve))

  t.after(() => closeServer(server))

  const wsA = new WebSocket(`ws://localhost:${BASE_PORT + 2}`)
  const wsB = new WebSocket(`ws://localhost:${BASE_PORT + 2}`)
  const qA  = makeWsQueue(wsA)
  const qB  = makeWsQueue(wsB)

  await rawHandshake(wsA)
  await rawHandshake(wsB)
  await qA.waitForType('som-dump')
  await qB.waitForType('som-dump')

  // Client A sends set on external node
  wsA.send(JSON.stringify({
    type:  'send',
    seq:   1,
    node:  'Crate/Crate',
    field: 'translation',
    value: [2, 0, 0],
  }))

  // Client B should receive the set broadcast
  const received = await qB.waitForType('set')
  assert.ok(received, 'Client B received set broadcast')
  assert.equal(received.node,  'Crate/Crate', 'correct node name')
  assert.deepEqual(received.value, [2, 0, 0], 'correct value')
})

// ---------------------------------------------------------------------------
// Test 5: failed external reference is non-fatal, container node present
// ---------------------------------------------------------------------------

test('failed external reference: server starts, logs warning, container node exists without children', async () => {
  // Load base world and manually add a source ref to a nonexistent file
  const world = await createWorld(FIXTURE_BASE)

  // Inject a source ref onto an existing node (ground-plane) for the test
  const testNode = world.som.getNodeByName('ground-plane')
  assert.ok(testNode, 'ground-plane node exists')
  testNode.extras = { ...testNode.extras, atrium: { source: './does-not-exist.gltf' } }

  // Should not throw
  await world.resolveExternalReferences()

  // ground-plane still exists, no children from the failed load
  const node = world.som.getNodeByName('ground-plane')
  assert.ok(node, 'container node still present after failed ref')
  assert.equal(node.children.length, 0, 'no children added for failed ref')
})

// ---------------------------------------------------------------------------
// Test 6: container node mutations still work
// ---------------------------------------------------------------------------

test('set on container node (not external) validates and broadcasts', async (t) => {
  const world  = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()
  const server = createSessionServer({ port: BASE_PORT + 3, world })
  await new Promise(resolve => server.wss.on('listening', resolve))

  t.after(() => closeServer(server))

  const ws = new WebSocket(`ws://localhost:${BASE_PORT + 3}`)
  const q  = makeWsQueue(ws)
  await rawHandshake(ws)
  await q.waitForType('som-dump')

  ws.send(JSON.stringify({
    type:  'send',
    seq:   1,
    node:  'Crate',
    field: 'translation',
    value: [5, 0, 0],
  }))

  const response = await q.waitForType('set')
  assert.ok(response, 'received set broadcast for container node')
  assert.equal(response.node, 'Crate', 'container node name in broadcast')
  assert.deepEqual(response.value, [5, 0, 0], 'value correct')
})
