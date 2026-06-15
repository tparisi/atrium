// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { AtriumClient } from '../src/AtriumClient.js'
import { SOMDocument }  from '../../som/src/SOMDocument.js'
import { SOMCamera }    from '../../som/src/SOMCamera.js'

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  constructor() {
    this.readyState = 1   // OPEN
    this.sent = []
    this._handlers = {}
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  on(event, fn)  { (this._handlers[event] ??= []).push(fn) }
  off() {}
  _fire(event, ...args) {
    for (const fn of this._handlers[event] ?? []) fn(...args)
  }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSOMDocumentWithCamera() {
  const doc  = new Document()
  const mainCam = doc.createCamera('MainCamera').setType('perspective')
    .setYFov(0.8).setZNear(0.1).setZFar(100).setAspectRatio(1.777)
  const orthoCam = doc.createCamera('OrthoCamera').setType('orthographic')
    .setXMag(5).setYMag(3).setZNear(0.1).setZFar(100)

  doc.createScene('Scene')
    .addChild(doc.createNode('MainCamera').setCamera(mainCam))
    .addChild(doc.createNode('OrthoCamera').setCamera(orthoCam))

  return new SOMDocument(doc)
}

function makeWiredCameraClient() {
  let mock
  const client = new AtriumClient({
    WebSocket: class { constructor() { mock = new MockWebSocket(); return mock } },
  })
  client.connect('ws://mock')
  client._sessionId   = 'session-aabbccdd-0000-0000-0000-000000000020'
  client._displayName = 'User-cam'
  client._connected   = true
  client._som         = makeSOMDocumentWithCamera()
  client._attachMutationListeners()
  mock.sent.length = 0   // clear connect-phase messages
  return { client, mock }
}

// ---------------------------------------------------------------------------
// Camera mutation dispatch
// ---------------------------------------------------------------------------

test('camera mutation — sends send message with qualified alias as node field', () => {
  const { client, mock } = makeWiredCameraClient()
  const cam = client.som.getObjectByName('MainCamera.camera')
  cam.yfov = 1.2

  const sendMsg = mock.sent.find(m => m.type === 'send')
  assert.ok(sendMsg,                                'send message was emitted')
  assert.equal(sendMsg.node,  'MainCamera.camera',  'node is the qualified alias')
  assert.equal(sendMsg.field, 'yfov',               'correct field')
  assert.equal(sendMsg.value, 1.2,                  'correct value')
})

test('camera mutation — does not fire outbound send while _applyingRemote', async () => {
  const { client, mock } = makeWiredCameraClient()

  // Simulate inbound remote set for the camera — _onSet sets _applyingRemote=true during apply
  mock.simulateMessage({
    type: 'set', seq: 1,
    node: 'MainCamera.camera', field: 'yfov', value: 0.5,
    serverTime: Date.now(),
    session: 'other-session-id',
  })
  await new Promise(r => setImmediate(r))

  // Camera should be updated
  const cam = client.som.getObjectByName('MainCamera.camera')
  assert.equal(cam.yfov, 0.5, 'camera yfov updated from inbound set')

  // No outbound send (no echo loop)
  const sends = mock.sent.filter(m => m.type === 'send')
  assert.equal(sends.length, 0, 'no outbound send emitted during remote apply')
})

test('camera mutation — _onSet with qualified alias resolves to SOMCamera', async () => {
  const { client, mock } = makeWiredCameraClient()
  const cam = client.som.getObjectByName('MainCamera.camera')

  mock.simulateMessage({
    type: 'set', seq: 2,
    node: 'MainCamera.camera', field: 'yfov', value: 1.5,
    serverTime: Date.now(),
    session: 'other-session-id',
  })
  await new Promise(r => setImmediate(r))

  assert.equal(cam.yfov, 1.5, 'SOMCamera.yfov updated via _onSet routing')
})

test('camera mutation — orthographic xmag mutation uses OrthoCamera.camera alias', () => {
  const { client, mock } = makeWiredCameraClient()
  const cam = client.som.getObjectByName('OrthoCamera.camera')
  cam.xmag = 8

  const sendMsg = mock.sent.find(m => m.type === 'send' && m.node === 'OrthoCamera.camera')
  assert.ok(sendMsg,                                 'send emitted for OrthoCamera.camera')
  assert.equal(sendMsg.field, 'xmag',                'correct field')
  assert.equal(sendMsg.value, 8,                     'correct value')
})

test('camera mutation — camera with null qualifiedName is skipped silently', () => {
  const { client, mock } = makeWiredCameraClient()

  // Build a bare SOMCamera with no qualifiedName (detached — not registered)
  const doc = new Document()
  const gltfCam = doc.createCamera('Orphan').setType('perspective').setYFov(1)
  const orphan = new SOMCamera(gltfCam)
  // _qualifiedName remains null (not set by _buildObjectGraph)

  client._attachCameraListeners(orphan)   // should return early — no listener added

  orphan.yfov = 99   // mutate — should produce no send
  const sends = mock.sent.filter(m => m.type === 'send')
  assert.equal(sends.length, 0, 'no send emitted for camera with null qualifiedName')
})
