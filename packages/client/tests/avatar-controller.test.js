// SPDX-License-Identifier: MIT
// avatar-controller.test.js — unit tests for AvatarController

import { test }   from 'node:test'
import assert      from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { AvatarController } from '../src/AvatarController.js'
import { AtriumClient }     from '../src/AtriumClient.js'
import { SOMDocument }       from '../../som/src/SOMDocument.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class EventEmitter {
  constructor() { this._l = Object.create(null) }
  on(event, fn) { (this._l[event] ??= []).push(fn); return this }
  emit(event, ...args) { for (const fn of this._l[event] ?? []) fn(...args) }
}

function makeMockClient({ connected = false, displayName = 'User-test', som = null } = {}) {
  const ee = new EventEmitter()
  const client = {
    get connected()    { return connected },
    get displayName()  { return displayName },
    get som()          { return som },
    viewCalls: [],
    setView(v)         { this.viewCalls.push(v) },
    on(event, fn)      { ee.on(event, fn); return client },
    emit(event, ...args) { ee.emit(event, ...args) },
  }
  return client
}

function makeAvatarSOM(avatarName) {
  const doc  = new Document()
  const mat  = doc.createMaterial('mat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const prim = doc.createPrimitive().setMaterial(mat)
  const mesh = doc.createMesh(`${avatarName}-mesh`).addPrimitive(prim)
  const node = doc.createNode(avatarName).setMesh(mesh).setExtras({ displayName: avatarName })
  doc.createScene('Scene').addChild(node)
  return new SOMDocument(doc)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('AvatarController — localNode null before world:loaded', () => {
  const client = makeMockClient({ connected: false })
  const avatar = new AvatarController(client)
  assert.strictEqual(avatar.localNode, null)
})

test('AvatarController — localNode set after world:loaded when connected', () => {
  const som    = makeAvatarSOM('User-test')
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  assert.notStrictEqual(avatar.localNode, null)
  assert.strictEqual(avatar.localNode.name, 'User-test')
})

test('AvatarController — camera child node created after world:loaded', () => {
  const som    = makeAvatarSOM('User-test')
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client, { cameraOffsetY: 2.0, cameraOffsetZ: 4.0 })
  client.emit('world:loaded')
  assert.notStrictEqual(avatar.cameraNode, null)
  assert.strictEqual(avatar.cameraNode.name, 'User-test-camera')
  const t = avatar.cameraNode.translation
  assert.ok(Math.abs(t[0] - 0) < 0.0001)
  assert.ok(Math.abs(t[1] - 2) < 0.0001)
  assert.ok(Math.abs(t[2] - 4) < 0.0001)
})

test('AvatarController — avatar:local-ready event fires after world:loaded', () => {
  const som    = makeAvatarSOM('User-test')
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  let fired    = false
  let firedNode = null
  avatar.on('avatar:local-ready', ({ node }) => { fired = true; firedNode = node })
  client.emit('world:loaded')
  assert.ok(fired, 'avatar:local-ready should have fired')
  assert.strictEqual(firedNode.name, 'User-test')
})

test('AvatarController — peer tracked from peer:join', () => {
  // SOM with a local avatar and a peer avatar
  const doc   = new Document()
  // local avatar
  const lMat  = doc.createMaterial('lmat').setBaseColorFactor([1, 1, 1, 1])
  const lPrim = doc.createPrimitive().setMaterial(lMat)
  const lMesh = doc.createMesh('local-mesh').addPrimitive(lPrim)
  doc.createNode('User-test').setMesh(lMesh).setExtras({ displayName: 'User-test' })
  // peer avatar
  const pMat  = doc.createMaterial('pmat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const pPrim = doc.createPrimitive().setMaterial(pMat)
  const pMesh = doc.createMesh('peer-mesh').addPrimitive(pPrim)
  doc.createNode('User-peer').setMesh(pMesh).setExtras({ displayName: 'User-peer' })
  const scene = doc.createScene('Scene')
  for (const n of doc.getRoot().listNodes()) scene.addChild(n)
  const som    = new SOMDocument(doc)
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  client.emit('peer:join', { displayName: 'User-peer' })
  assert.strictEqual(avatar.peerCount, 1)
  assert.notStrictEqual(avatar.getPeerNode('User-peer'), null)
})

test('AvatarController — peer removed on peer:leave', () => {
  const doc   = new Document()
  const lMat  = doc.createMaterial('lmat').setBaseColorFactor([1, 1, 1, 1])
  const lPrim = doc.createPrimitive().setMaterial(lMat)
  const lMesh = doc.createMesh('local-mesh').addPrimitive(lPrim)
  doc.createNode('User-test').setMesh(lMesh).setExtras({ displayName: 'User-test' })
  const pMat  = doc.createMaterial('pmat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const pPrim = doc.createPrimitive().setMaterial(pMat)
  const pMesh = doc.createMesh('peer-mesh').addPrimitive(pPrim)
  doc.createNode('User-peer').setMesh(pMesh).setExtras({ displayName: 'User-peer' })
  const scene = doc.createScene('Scene')
  for (const n of doc.getRoot().listNodes()) scene.addChild(n)
  const som    = new SOMDocument(doc)
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  client.emit('peer:join', { displayName: 'User-peer' })
  assert.strictEqual(avatar.peerCount, 1)
  client.emit('peer:leave', { displayName: 'User-peer' })
  assert.strictEqual(avatar.peerCount, 0)
})

test('AvatarController — pre-existing peers scanned from som-dump', () => {
  const doc   = new Document()
  // local avatar
  const lMat  = doc.createMaterial('lmat').setBaseColorFactor([1, 1, 1, 1])
  const lPrim = doc.createPrimitive().setMaterial(lMat)
  const lMesh = doc.createMesh('local-mesh').addPrimitive(lPrim)
  doc.createNode('User-test').setMesh(lMesh).setExtras({ displayName: 'User-test' })
  // peer 1
  const p1Mat  = doc.createMaterial('p1mat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const p1Prim = doc.createPrimitive().setMaterial(p1Mat)
  const p1Mesh = doc.createMesh('peer1-mesh').addPrimitive(p1Prim)
  doc.createNode('User-peer1').setMesh(p1Mesh).setExtras({ displayName: 'User-peer1' })
  // peer 2
  const p2Mat  = doc.createMaterial('p2mat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const p2Prim = doc.createPrimitive().setMaterial(p2Mat)
  const p2Mesh = doc.createMesh('peer2-mesh').addPrimitive(p2Prim)
  doc.createNode('User-peer2').setMesh(p2Mesh).setExtras({ displayName: 'User-peer2' })
  const scene = doc.createScene('Scene')
  for (const n of doc.getRoot().listNodes()) scene.addChild(n)
  const som    = new SOMDocument(doc)
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  assert.strictEqual(avatar.peerCount, 2)
})

test('AvatarController — avatar:peer-added fires for live join', () => {
  const doc   = new Document()
  const lMat  = doc.createMaterial('lmat').setBaseColorFactor([1, 1, 1, 1])
  const lPrim = doc.createPrimitive().setMaterial(lMat)
  const lMesh = doc.createMesh('local-mesh').addPrimitive(lPrim)
  doc.createNode('User-test').setMesh(lMesh).setExtras({ displayName: 'User-test' })
  const pMat  = doc.createMaterial('pmat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const pPrim = doc.createPrimitive().setMaterial(pMat)
  const pMesh = doc.createMesh('peer-mesh').addPrimitive(pPrim)
  doc.createNode('User-peer').setMesh(pMesh).setExtras({ displayName: 'User-peer' })
  const scene = doc.createScene('Scene')
  for (const n of doc.getRoot().listNodes()) scene.addChild(n)
  const som    = new SOMDocument(doc)
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  let firedName = null
  avatar.on('avatar:peer-added', ({ displayName }) => { firedName = displayName })
  client.emit('peer:join', { displayName: 'User-peer' })
  assert.strictEqual(firedName, 'User-peer')
})

test('AvatarController — avatar:peer-removed fires on peer:leave', () => {
  const doc   = new Document()
  const lMat  = doc.createMaterial('lmat').setBaseColorFactor([1, 1, 1, 1])
  const lPrim = doc.createPrimitive().setMaterial(lMat)
  const lMesh = doc.createMesh('local-mesh').addPrimitive(lPrim)
  doc.createNode('User-test').setMesh(lMesh).setExtras({ displayName: 'User-test' })
  const pMat  = doc.createMaterial('pmat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const pPrim = doc.createPrimitive().setMaterial(pMat)
  const pMesh = doc.createMesh('peer-mesh').addPrimitive(pPrim)
  doc.createNode('User-peer').setMesh(pMesh).setExtras({ displayName: 'User-peer' })
  const scene = doc.createScene('Scene')
  for (const n of doc.getRoot().listNodes()) scene.addChild(n)
  const som    = new SOMDocument(doc)
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  client.emit('peer:join', { displayName: 'User-peer' })
  let removedName = null
  avatar.on('avatar:peer-removed', ({ displayName }) => { removedName = displayName })
  client.emit('peer:leave', { displayName: 'User-peer' })
  assert.strictEqual(removedName, 'User-peer')
})

test('AvatarController — setView skipped when nothing changes', () => {
  const client = makeMockClient({ connected: true })
  const avatar = new AvatarController(client)
  avatar.setView({ position: [1, 0, 0], look: [0, 0, -1], move: [0, 0, 0], velocity: 0 })
  assert.strictEqual(client.viewCalls.length, 1)
  avatar.setView({ position: [1, 0, 0], look: [0, 0, -1], move: [0, 0, 0], velocity: 0 })
  assert.strictEqual(client.viewCalls.length, 1)
})

test('AvatarController — setView sent when position changes', () => {
  const client = makeMockClient({ connected: true })
  const avatar = new AvatarController(client)
  avatar.setView({ position: [1, 0, 0], look: [0, 0, -1], move: [0, 0, 0], velocity: 0 })
  avatar.setView({ position: [2, 0, 0], look: [0, 0, -1], move: [0, 0, 0], velocity: 0 })
  assert.strictEqual(client.viewCalls.length, 2)
})

test('AvatarController — disconnected clears state', () => {
  const doc   = new Document()
  const lMat  = doc.createMaterial('lmat').setBaseColorFactor([1, 1, 1, 1])
  const lPrim = doc.createPrimitive().setMaterial(lMat)
  const lMesh = doc.createMesh('local-mesh').addPrimitive(lPrim)
  doc.createNode('User-test').setMesh(lMesh).setExtras({ displayName: 'User-test' })
  const pMat  = doc.createMaterial('pmat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const pPrim = doc.createPrimitive().setMaterial(pMat)
  const pMesh = doc.createMesh('peer-mesh').addPrimitive(pPrim)
  doc.createNode('User-peer').setMesh(pMesh).setExtras({ displayName: 'User-peer' })
  const scene = doc.createScene('Scene')
  for (const n of doc.getRoot().listNodes()) scene.addChild(n)
  const som    = new SOMDocument(doc)
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client)
  client.emit('world:loaded')
  client.emit('peer:join', { displayName: 'User-peer' })
  assert.notStrictEqual(avatar.localNode, null)
  assert.strictEqual(avatar.peerCount, 1)
  client.emit('disconnected')
  assert.strictEqual(avatar.localNode, null)
  assert.strictEqual(avatar.peerCount, 0)
})

test('AvatarController — ephemeral flag set on avatar descriptor', () => {
  class MockWebSocket {
    constructor() {
      this.readyState = 1
      this.sent       = []
      this._handlers  = {}
    }
    on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
    send(data)    { this.sent.push(JSON.parse(data)) }
    close()       {}
  }

  let mockWs
  const client = new AtriumClient({
    WebSocket: class {
      constructor() { mockWs = new MockWebSocket(); return mockWs }
    },
  })
  client.connect('ws://mock', { avatar: { translation: [0, 0, 0] } })
  assert.ok(client._avatarDescriptor, 'avatarDescriptor should be set')
  assert.strictEqual(client._avatarDescriptor.extras?.atrium?.ephemeral, true)
})
