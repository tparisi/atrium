// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'

const PORT = 3008

let server

before(() => {
  server = createSessionServer({ port: PORT, maxUsers: 20 })
})

after(() => {
  return new Promise((resolve) => server.wss.close(resolve))
})

function connect() {
  return new WebSocket(`ws://localhost:${PORT}`)
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve()
    ws.once('close', resolve)
  })
}

function makeMessageQueue(ws) {
  const queue = []
  ws.on('message', (raw) => {
    try { queue.push(JSON.parse(raw)) } catch {}
  })

  async function waitForType(type, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = queue.findIndex(m => m.type === type)
      if (idx >= 0) return queue.splice(idx, 1)[0]
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 10))
    }
  }

  return { waitForType, queue }
}

async function handshake(ws, q) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: `test-${Date.now()}-${Math.random()}`,
    capabilities: { tick: { interval: 5000 } },
  }))
  return q.waitForType('hello', 2000)
}

function drainServer() {
  return new Promise(r => setTimeout(r, 100))
}

test('view is broadcast to other clients with sender id', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  await handshake(wsB, qB)
  // consume join for A that B receives on connect
  await qB.waitForType('join', 300)

  wsA.send(JSON.stringify({ type: 'view', seq: 1, position: [3, 0, 0] }))

  const viewMsg = await qB.waitForType('view', 500)

  assert.ok(viewMsg !== null, 'B should receive a view message')
  assert.equal(viewMsg.type, 'view')
  assert.equal(viewMsg.id, idA)
  assert.deepEqual(viewMsg.position, [3, 0, 0])

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
  await drainServer()
})

test('view is NOT echoed back to sender', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  await handshake(wsA, qA)

  wsA.send(JSON.stringify({ type: 'view', seq: 1, position: [1, 0, 0] }))

  const viewMsg = await qA.waitForType('view', 300)
  assert.equal(viewMsg, null, 'sender should not receive its own view message')

  wsA.close()
  await waitForClose(wsA)
  await drainServer()
})

test('view updates presence position for sender', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  wsA.send(JSON.stringify({ type: 'view', seq: 1, position: [5, 1, -2] }))

  // Give server time to process
  await drainServer()

  const entry = server.presence.get(idA)
  assert.ok(entry !== null, 'presence entry should exist')
  assert.deepEqual(entry.position, [5, 1, -2])

  wsA.close()
  await waitForClose(wsA)
  await drainServer()
})

test('join bootstrap includes current position of existing clients', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  // A moves to a known position
  wsA.send(JSON.stringify({ type: 'view', seq: 1, position: [7, 0, 3] }))
  await drainServer()

  // B connects — should receive a join for A with A's current position
  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  await handshake(wsB, qB)

  const joinA = await qB.waitForType('join', 500)

  assert.ok(joinA !== null, 'newcomer should receive join for existing client')
  assert.equal(joinA.id, idA)
  assert.deepEqual(joinA.position, [7, 0, 3])

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
  await drainServer()
})

test('newcomer join sent to existing clients has default position [0,0,0]', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  await handshake(wsA, qA)

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  const helloB = await handshake(wsB, qB)
  const idB = helloB.id

  const joinMsg = await qA.waitForType('join', 500)

  assert.ok(joinMsg !== null, 'existing client should receive join for newcomer')
  assert.equal(joinMsg.id, idB)
  assert.deepEqual(joinMsg.position, [0, 0, 0])

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
  await drainServer()
})

test('view with optional fields (look, move, velocity) are relayed to other clients', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  await handshake(wsB, qB)
  await qB.waitForType('join', 300)

  wsA.send(JSON.stringify({
    type: 'view', seq: 1,
    position: [1, 0, 0],
    look: [0, 0, -1],
    move: [1, 0, 0],
    velocity: 3.5,
  }))

  const viewMsg = await qB.waitForType('view', 500)

  assert.ok(viewMsg !== null, 'B should receive view with optional fields')
  assert.equal(viewMsg.id, idA)
  assert.deepEqual(viewMsg.position, [1, 0, 0])
  assert.deepEqual(viewMsg.look, [0, 0, -1])
  assert.deepEqual(viewMsg.move, [1, 0, 0])
  assert.equal(viewMsg.velocity, 3.5)

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
  await drainServer()
})
