// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { Document } from '@gltf-transform/core'
import { createSessionServer } from '../../server/src/session.js'
import { createWorld } from '../../server/src/world.js'
import { AtriumClient } from '../src/AtriumClient.js'
import { SOMDocument } from '../../som/src/SOMDocument.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const BASE_PORT = 4100   // each per-test server uses BASE_PORT + N

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForEvent(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for event "${event}"`)),
      timeoutMs
    )
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data) })
    emitter.once('error', (err)  => { clearTimeout(timer); reject(err) })
  })
}

// Terminate all open WebSocket connections then close the server.
// This ensures wss.close() resolves immediately rather than hanging.
function closeServer(server) {
  for (const ws of server.wss.clients) ws.terminate()
  return new Promise(resolve => server.wss.close(resolve))
}

function waitForWsMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => { try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
    ws.once('error', reject)
  })
}

function waitForWsOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForWsClose(ws) {
  return new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) return resolve()
    ws.once('close', resolve)
  })
}

function makeWsQueue(ws) {
  const queue = []
  ws.on('message', (raw) => { try { queue.push(JSON.parse(raw)) } catch {} })
  async function waitForType(type, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = queue.findIndex(m => m.type === type)
      if (idx >= 0) return queue.splice(idx, 1)[0]
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 10))
    }
  }
  return { waitForType }
}

async function rawHandshake(ws, clientId = 'test-peer') {
  await waitForWsOpen(ws)
  ws.send(JSON.stringify({ type: 'hello', id: clientId, capabilities: { tick: { interval: 5000 } } }))
  return waitForWsMessage(ws)
}

// Create AtriumClient, connect, and wait for session:ready
async function connectClient(port, opts = {}) {
  const client = new AtriumClient({ WebSocket, debug: false })
  const ready  = waitForEvent(client, 'session:ready')
  client.connect(`ws://localhost:${port}`, opts)
  await ready
  return client
}

// ---------------------------------------------------------------------------
// Shared server (no world) — simple lifecycle tests
// ---------------------------------------------------------------------------

let sharedServer

before(() => new Promise((resolve, reject) => {
  sharedServer = createSessionServer({ port: BASE_PORT, maxUsers: 20 })
  sharedServer.wss.on('listening', resolve)
  sharedServer.wss.on('error',    reject)
}))

after(() => closeServer(sharedServer))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('connect() → hello handshake → session:ready fires with sessionId and displayName', async () => {
  const client = new AtriumClient({ WebSocket })
  const ready  = waitForEvent(client, 'session:ready')
  client.connect(`ws://localhost:${BASE_PORT}`)
  const data = await ready

  assert.ok(typeof data.sessionId   === 'string' && data.sessionId.length > 0,   'sessionId non-empty string')
  assert.ok(typeof data.displayName === 'string' && data.displayName.length > 0, 'displayName non-empty string')
  assert.ok(data.displayName.startsWith('User-'),                                 'displayName starts with User-')

  client.disconnect()
  await waitForEvent(client, 'disconnected')
})

test('session:ready sessionId is a valid UUID, displayName derived from shortId', async () => {
  const client = new AtriumClient({ WebSocket })
  const ready  = waitForEvent(client, 'session:ready')
  client.connect(`ws://localhost:${BASE_PORT}`)
  const data = await ready

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  assert.ok(uuidRe.test(data.sessionId),                                  'sessionId is a valid UUID')
  assert.equal(data.displayName, `User-${data.sessionId.slice(0, 4)}`,    'displayName = User-<shortId>')

  client.disconnect()
  await waitForEvent(client, 'disconnected')
})

test('disconnect() → disconnected event fires', async () => {
  const client = new AtriumClient({ WebSocket })
  const ready  = waitForEvent(client, 'session:ready')
  client.connect(`ws://localhost:${BASE_PORT}`)
  await ready

  const gone = waitForEvent(client, 'disconnected')
  client.disconnect()
  await gone
})

test('setView() while disconnected → dropped silently, no error fired', async () => {
  const client = new AtriumClient({ WebSocket })
  let errorFired = false
  client.on('error', () => { errorFired = true })

  client.setView({ position: [1, 0, 0], look: [0, 0, -1] })

  await new Promise(r => setTimeout(r, 50))
  assert.equal(errorFired, false, 'no error event emitted')
})

// ---------------------------------------------------------------------------
// Tests requiring a world (som-dump)
// ---------------------------------------------------------------------------

test('som-dump received → SOM initialized → world:loaded fires', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 1, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 1}`)
    await ready
    await loaded
    assert.ok(client.som !== null, 'som is initialized after world:loaded')
  } finally {
    client.disconnect()
    await closeServer(server)
  }
})

test('world:loaded payload includes world metadata (name, description, author)', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 2, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 2}`)
    await ready
    const meta = await loaded
    assert.ok(typeof meta === 'object', 'world:loaded payload is an object')
    assert.ok('name'        in meta, 'name field present')
    assert.ok('description' in meta, 'description field present')
    assert.ok('author'      in meta, 'author field present')
  } finally {
    client.disconnect()
    await closeServer(server)
  }
})

test('add (peer avatar, join tracked) → SOM updated → som:add fires', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 3, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  const peer   = new WebSocket(`ws://localhost:${BASE_PORT + 3}`)
  const q      = makeWsQueue(peer)
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 3}`)
    await ready
    await loaded

    await rawHandshake(peer, 'peer-avatar-test-001')
    await q.waitForType('som-dump', 3000)

    // Give server time to broadcast join to observer client
    await new Promise(r => setTimeout(r, 100))

    const somAdd = waitForEvent(client, 'som:add', 3000)
    peer.send(JSON.stringify({
      type: 'add',
      id:   'peer-avatar-test-001',
      seq:  1,
      node: { name: 'User-peer', translation: [0, 0, 0] },
    }))

    const addData = await somAdd
    assert.equal(addData.nodeName, 'User-peer', 'som:add has correct nodeName')
  } finally {
    peer.terminate()
    client.disconnect()
    await closeServer(server)
  }
})

test('add (non-avatar, no id) → som:add fires, peer:join does not', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 4, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  const peer   = new WebSocket(`ws://localhost:${BASE_PORT + 4}`)
  const q      = makeWsQueue(peer)
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 4}`)
    await ready
    await loaded

    let peerJoinFired = false
    client.on('peer:join', () => { peerJoinFired = true })

    await rawHandshake(peer, 'peer-no-id-001')
    await q.waitForType('som-dump', 3000)

    const somAdd = waitForEvent(client, 'som:add', 3000)
    peer.send(JSON.stringify({
      type: 'add',
      seq:  1,
      node: { name: 'world-object-01', translation: [2, 0, 0] },
    }))

    const addData = await somAdd
    assert.equal(addData.nodeName, 'world-object-01', 'som:add nodeName correct')

    await new Promise(r => setTimeout(r, 100))
    assert.equal(peerJoinFired, false, 'peer:join should not fire for non-avatar adds')
  } finally {
    peer.terminate()
    client.disconnect()
    await closeServer(server)
  }
})

test('remove (avatar disconnect) → SOM updated → peer:leave + som:remove fire', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 5, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  const peer   = new WebSocket(`ws://localhost:${BASE_PORT + 5}`)
  const q      = makeWsQueue(peer)
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 5}`)
    await ready
    await loaded

    await rawHandshake(peer, 'peer-leave-test-001')
    await q.waitForType('som-dump', 3000)

    peer.send(JSON.stringify({
      type: 'add',
      id:   'peer-leave-test-001',
      seq:  1,
      node: { name: 'User-peer', translation: [0, 0, 0] },
    }))
    await waitForEvent(client, 'som:add', 3000)

    const somRemove = waitForEvent(client, 'som:remove', 3000)
    const peerLeave = waitForEvent(client, 'peer:leave', 3000)

    peer.terminate()
    await waitForWsClose(peer)

    const removeData = await somRemove
    const leaveData  = await peerLeave

    assert.ok(removeData.nodeName != null,                       'som:remove has nodeName')
    assert.equal(leaveData.sessionId, 'peer-leave-test-001',     'peer:leave has correct sessionId')
  } finally {
    client.disconnect()
    await closeServer(server)
  }
})

test('set → SOM updated → som:set fires with nodeName, path, value', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 6, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  const peer   = new WebSocket(`ws://localhost:${BASE_PORT + 6}`)
  const q      = makeWsQueue(peer)
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 6}`)
    await ready
    await loaded

    await rawHandshake(peer, 'peer-set-test')
    await q.waitForType('som-dump', 3000)

    const setEvt = waitForEvent(client, 'som:set', 3000)
    peer.send(JSON.stringify({
      type: 'send', seq: 1,
      node: 'crate-01', field: 'translation', value: [5, 0, 0],
    }))

    const setData = await setEvt
    assert.equal(setData.nodeName, 'crate-01',       'nodeName correct')
    assert.equal(setData.path,     'translation',    'path correct')
    assert.deepEqual(setData.value, [5, 0, 0],       'value correct')
  } finally {
    peer.terminate()
    client.disconnect()
    await closeServer(server)
  }
})

test('view → peer avatar SOM translation updated → peer:view fires with correct shape', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 7, maxUsers: 10, world })
  const client = new AtriumClient({ WebSocket })
  const peer   = new WebSocket(`ws://localhost:${BASE_PORT + 7}`)
  const q      = makeWsQueue(peer)
  try {
    const ready  = waitForEvent(client, 'session:ready')
    const loaded = waitForEvent(client, 'world:loaded')
    client.connect(`ws://localhost:${BASE_PORT + 7}`)
    await ready
    await loaded

    // Must be a valid UUID so view messages pass server schema validation
    const peerId = 'aaaa0000-0000-4000-8000-000000000001'
    const peerShortId = peerId.slice(0, 4)       // 'aaaa'
    const peerDisplayName = `User-${peerShortId}` // 'User-aaaa'

    await rawHandshake(peer, peerId)
    await q.waitForType('som-dump', 3000)

    peer.send(JSON.stringify({
      type: 'add', id: peerId, seq: 1,
      node: { name: peerDisplayName, translation: [0, 0, 0] },
    }))
    await waitForEvent(client, 'som:add', 3000)

    const viewEvt = waitForEvent(client, 'peer:view', 3000)
    peer.send(JSON.stringify({
      type: 'view', seq: 1,
      position: [1, 0, 2], look: [0, 0, -1], move: [0, 0, -1], velocity: 1.4,
    }))

    const viewData = await viewEvt
    assert.ok(typeof viewData.displayName === 'string', 'displayName present')
    assert.deepEqual(viewData.position, [1, 0, 2],   'position relayed')
    assert.deepEqual(viewData.look,     [0, 0, -1],  'look relayed')
    assert.deepEqual(viewData.move,     [0, 0, -1],  'move relayed')
    assert.equal(viewData.velocity,     1.4,         'velocity relayed')

    // SOM node translation was updated by _onView
    const peerNode = client.som.getNodeByName(peerDisplayName)
    assert.ok(peerNode !== null, 'peer avatar node exists in SOM')
    assert.deepEqual([...peerNode.translation], [1, 0, 2], 'SOM translation updated')
  } finally {
    peer.terminate()
    client.disconnect()
    await closeServer(server)
  }
})

test('two clients connect → one disconnects → other receives peer:leave and som:remove', async () => {
  const world  = await createWorld(FIXTURE_PATH)
  const server = createSessionServer({ port: BASE_PORT + 8, maxUsers: 10, world })
  const client1 = new AtriumClient({ WebSocket })
  const client2 = new AtriumClient({ WebSocket })
  try {
    const c1Ready  = waitForEvent(client1, 'session:ready')
    const c1Loaded = waitForEvent(client1, 'world:loaded')
    client1.connect(`ws://localhost:${BASE_PORT + 8}`, {
      avatar: { name: 'User-c1ab', translation: [0, 0, 0] }
    })
    await c1Ready
    await c1Loaded

    const c2Ready  = waitForEvent(client2, 'session:ready')
    const c2Loaded = waitForEvent(client2, 'world:loaded')
    client2.connect(`ws://localhost:${BASE_PORT + 8}`, {
      avatar: { name: 'User-c2xy', translation: [1, 0, 0] }
    })
    await c2Ready
    await c2Loaded

    // Allow time for client2's avatar add to propagate to client1
    await new Promise(r => setTimeout(r, 300))

    const leaveProm  = waitForEvent(client1, 'peer:leave',  3000)
    const removeProm = waitForEvent(client1, 'som:remove',  3000)
    client2.disconnect()

    const leaveData = await leaveProm
    await removeProm

    assert.ok(typeof leaveData.sessionId === 'string', 'peer:leave has sessionId')
    assert.ok(typeof leaveData.displayName === 'string', 'peer:leave has displayName')
  } finally {
    client1.disconnect()
    client2.disconnect()
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// AtriumClient mutation sync — unit tests with mock WebSocket
// ---------------------------------------------------------------------------

// Minimal mock WebSocket that records sent messages and allows injecting inbound ones.
// Must be constructed via connect() so that AtriumClient registers its message handlers.
class MockWebSocket {
  constructor() {
    this.readyState = 1   // OPEN
    this.sent       = []
    this._handlers  = {}
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data)    { this.sent.push(JSON.parse(data)) }
  close()       {}
  _fire(event, ...args) {
    for (const fn of this._handlers[event] ?? []) fn(...args)
  }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
}

// Build a minimal in-memory SOMDocument with one node that has a mesh + material.
function makeSOMDocument() {
  const doc  = new Document()
  const mat  = doc.createMaterial('mat').setBaseColorFactor([1, 1, 1, 1])
  const prim = doc.createPrimitive().setMaterial(mat)
  const mesh = doc.createMesh('Mesh').addPrimitive(prim)
  const node = doc.createNode('Crate').setMesh(mesh)
  doc.createScene('Scene').addChild(node)
  return new SOMDocument(doc)
}

// Wire a client with a mock WebSocket and a pre-built SOM (bypasses server handshake).
// We call connect() so that AtriumClient registers its dispatch handler on the mock,
// then manually set the connected state and SOM without going through the full handshake.
function makeWiredClient() {
  let mock
  const client = new AtriumClient({
    WebSocket: class {
      constructor() { mock = new MockWebSocket(); return mock }
    },
  })
  client.connect('ws://mock')
  // connect() registered handlers on mock; now set state directly (skip server hello)
  client._sessionId      = 'session-aabbccdd-0000-0000-0000-000000000001'
  client._displayName    = 'User-sess'
  client._connected      = true
  client._som            = makeSOMDocument()
  client._attachMutationListeners()
  return { client, mock }
}

test('mutation-sync — local SOM property change → outbound send message', () => {
  const { client, mock } = makeWiredClient()
  const node = client.som.getNodeByName('Crate')
  node.translation = [1, 2, 3]

  const sendMsg = mock.sent.find(m => m.type === 'send')
  assert.ok(sendMsg,                          'send message was emitted')
  assert.strictEqual(sendMsg.node,  'Crate',  'correct node name')
  assert.strictEqual(sendMsg.field, 'translation', 'correct field')
  assert.deepEqual(sendMsg.value,   [1, 2, 3], 'correct value')
  assert.ok(typeof sendMsg.seq === 'number',  'seq is present')
})

test('mutation-sync — inbound remote set → SOM updated, no outbound send', async () => {
  const { client, mock } = makeWiredClient()
  const sentBefore = mock.sent.length

  // Simulate inbound set from a different session
  mock.simulateMessage({
    type: 'set', seq: 1,
    node: 'Crate', field: 'translation', value: [5, 0, 0],
    serverTime: Date.now(),
    session: 'other-session-id',
  })

  // Give async dispatch a tick to complete
  await new Promise(r => setImmediate(r))

  // SOM should be updated
  const node = client.som.getNodeByName('Crate')
  assert.deepEqual([...node.translation], [5, 0, 0], 'SOM translation updated')

  // No outbound send should have been emitted
  const newSends = mock.sent.slice(sentBefore).filter(m => m.type === 'send')
  assert.strictEqual(newSends.length, 0, 'no outbound send emitted (no loopback)')
})

test('mutation-sync — inbound own echo (same session) → SOM not touched', async () => {
  const { client, mock } = makeWiredClient()
  const node             = client.som.getNodeByName('Crate')
  node.translation = [0, 0, 0]   // set a known baseline (also sends, but that's fine)
  mock.sent.length = 0            // reset sent queue

  // Simulate server echoing our own set back (session matches client)
  mock.simulateMessage({
    type: 'set', seq: 2,
    node: 'Crate', field: 'translation', value: [99, 99, 99],
    serverTime: Date.now(),
    session: client._sessionId,
  })

  await new Promise(r => setImmediate(r))

  // SOM should NOT have been updated (own echo ignored)
  assert.deepEqual([...node.translation], [0, 0, 0], 'SOM unchanged after own echo')
  // No outbound send from the ignored echo
  assert.strictEqual(mock.sent.filter(m => m.type === 'send').length, 0)
})

test('mutation-sync — not connected → SOM change produces no outbound message', () => {
  const mock   = new MockWebSocket()
  const client = new AtriumClient({ WebSocket: class { constructor() { return mock } } })
  client._som = makeSOMDocument()
  client._attachMutationListeners()
  // client._connected remains false

  const node = client.som.getNodeByName('Crate')
  node.translation = [7, 7, 7]

  assert.strictEqual(mock.sent.filter(m => m.type === 'send').length, 0, 'no send when disconnected')
})

test('mutation-sync — avatar node excluded from mutation listeners → no send emitted', () => {
  let mock
  const client = new AtriumClient({
    WebSocket: class { constructor() { mock = new MockWebSocket(); return mock } },
  })
  client.connect('ws://mock')
  client._sessionId      = 'session-aabbccdd-0000-0000-0000-000000000002'
  client._displayName    = 'User-avtr'
  client._avatarNodeName = 'User-avtr'
  client._connected      = true

  // SOM with an avatar node and a regular node
  const doc      = new Document()
  const avatarGl = doc.createNode('User-avtr')
  const crateGl  = doc.createNode('Crate')
  doc.createScene('Scene').addChild(avatarGl).addChild(crateGl)
  client._som = new SOMDocument(doc)
  client._attachMutationListeners()
  mock.sent.length = 0   // clear any sends from connect/construction

  const avatarNode = client.som.getNodeByName('User-avtr')
  avatarNode.translation = [1, 0.7, 2]

  const sendMsgs = mock.sent.filter(m => m.type === 'send')
  assert.strictEqual(sendMsgs.length, 0, 'no send emitted for avatar node mutation')
})

test('mutation-sync — non-avatar node mutation still produces send when avatar present', () => {
  let mock
  const client = new AtriumClient({
    WebSocket: class { constructor() { mock = new MockWebSocket(); return mock } },
  })
  client.connect('ws://mock')
  client._sessionId      = 'session-aabbccdd-0000-0000-0000-000000000003'
  client._displayName    = 'User-avtr'
  client._avatarNodeName = 'User-avtr'
  client._connected      = true

  const doc      = new Document()
  const avatarGl = doc.createNode('User-avtr')
  const crateGl  = doc.createNode('Crate')
  doc.createScene('Scene').addChild(avatarGl).addChild(crateGl)
  client._som = new SOMDocument(doc)
  client._attachMutationListeners()
  mock.sent.length = 0

  const crateNode = client.som.getNodeByName('Crate')
  crateNode.translation = [5, 0, 0]

  const sendMsg = mock.sent.find(m => m.type === 'send' && m.node === 'Crate')
  assert.ok(sendMsg,                                   'send emitted for non-avatar node')
  assert.equal(sendMsg.field, 'translation',           'correct field')
  assert.deepEqual(sendMsg.value, [5, 0, 0],           'correct value')
})
