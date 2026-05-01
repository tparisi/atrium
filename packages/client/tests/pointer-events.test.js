// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../../som/src/SOMDocument.js'
import { AtriumClient } from '../src/AtriumClient.js'

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

/**
 * Build an AtriumClient with a minimal SOMDocument containing two named
 * nodes (NodeA, NodeB). Returns the client and direct node refs.
 */
function makeEnv() {
  const doc   = new Document()
  const scene = doc.createScene('Scene')
  const gA    = doc.createNode('NodeA')
  const gB    = doc.createNode('NodeB')
  scene.addChild(gA)
  scene.addChild(gB)

  const som = new SOMDocument(doc)
  const client = new AtriumClient()
  client._som = som   // inject directly — skip async loadWorld

  const A = som.getNodeByName('NodeA')
  const B = som.getNodeByName('NodeB')

  return { client, som, A, B }
}

/** Minimal synthetic event detail for all tests. */
const DETAIL = Object.freeze({
  pointerId: 1,
  button:    0,
  buttons:   1,
  point:     [1, 0, 0],
  normal:    [0, 1, 0],
  ray:       { origin: [0, 5, 5], direction: [0, -1, -1] },
  shiftKey:  false,
  ctrlKey:   false,
  altKey:    false,
  metaKey:   false,
})

// ---------------------------------------------------------------------------
// 1. Listener fires on dispatch
// ---------------------------------------------------------------------------

test('pointer: listener fires on dispatch with correct target and detail', () => {
  const { client, A } = makeEnv()

  const calls = []
  A.addEventListener('pointerdown', (e) => calls.push(e))

  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)

  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].target, A)
  assert.strictEqual(calls[0].detail.button, 0)
  assert.deepEqual(calls[0].detail.point, [1, 0, 0])
  assert.strictEqual(typeof calls[0].detail.stopPropagation, 'function')
})

// ---------------------------------------------------------------------------
// 2. _hasListeners short-circuit — no SOMEvent allocated when no listeners
// ---------------------------------------------------------------------------

test('pointer: _dispatchEvent not called when node has no listeners', () => {
  const { client, A } = makeEnv()

  let dispatchCalled = false
  const original = A._dispatchEvent.bind(A)
  A._dispatchEvent = (event) => { dispatchCalled = true; original(event) }

  // No listener attached — should short-circuit
  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)

  assert.strictEqual(dispatchCalled, false)
})

// ---------------------------------------------------------------------------
// 3. pointerover / pointerout transitions: A → B
// ---------------------------------------------------------------------------

test('pointer: pointermove A→B fires pointerout on A and pointerover on B', () => {
  const { client, A, B } = makeEnv()

  const overs  = []
  const outs   = []
  A.addEventListener('pointerout',  (e) => outs.push(e.target.name))
  B.addEventListener('pointerover', (e) => overs.push(e.target.name))

  client.dispatchPointerEvent(A, 'pointermove', DETAIL)
  client.dispatchPointerEvent(B, 'pointermove', DETAIL)

  assert.deepEqual(outs,  ['NodeA'])
  assert.deepEqual(overs, ['NodeB'])
})

// ---------------------------------------------------------------------------
// 4. pointerover not refired on same node
// ---------------------------------------------------------------------------

test('pointer: pointermove same node twice fires pointerover only once', () => {
  const { client, A } = makeEnv()

  let overCount = 0
  A.addEventListener('pointerover', () => overCount++)

  client.dispatchPointerEvent(A, 'pointermove', DETAIL)
  client.dispatchPointerEvent(A, 'pointermove', DETAIL)

  assert.strictEqual(overCount, 1)
})

// ---------------------------------------------------------------------------
// 5. pointerout on transition to null
// ---------------------------------------------------------------------------

test('pointer: pointermove to null fires pointerout on previous node', () => {
  const { client, A, B } = makeEnv()

  let outFired   = false
  let overFired  = false
  A.addEventListener('pointerout',  () => { outFired  = true })
  B.addEventListener('pointerover', () => { overFired = true })

  client.dispatchPointerEvent(A, 'pointermove', DETAIL)
  client.dispatchPointerEvent(null, 'pointermove', DETAIL)

  assert.strictEqual(outFired,  true,  'pointerout on A should fire')
  assert.strictEqual(overFired, false, 'no pointerover when transitioning to null')
})

// ---------------------------------------------------------------------------
// 6. click fires on matching pointerdown / pointerup
// ---------------------------------------------------------------------------

test('pointer: click fires after pointerdown + pointerup on same node', () => {
  const { client, A } = makeEnv()

  const events = []
  A.addEventListener('pointerdown', () => events.push('down'))
  A.addEventListener('pointerup',   () => events.push('up'))
  A.addEventListener('click',       () => events.push('click'))

  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)
  client.dispatchPointerEvent(A, 'pointerup',   DETAIL)

  assert.deepEqual(events, ['down', 'up', 'click'])
})

// ---------------------------------------------------------------------------
// 7. click does NOT fire on mismatched pointerdown / pointerup
// ---------------------------------------------------------------------------

test('pointer: click does not fire when pointerdown and pointerup are on different nodes', () => {
  const { client, A, B } = makeEnv()

  let clickOnA = false
  let clickOnB = false
  A.addEventListener('click', () => { clickOnA = true })
  B.addEventListener('click', () => { clickOnB = true })
  B.addEventListener('pointerup', () => {})   // ensure B has a listener so dispatch runs

  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)
  client.dispatchPointerEvent(B, 'pointerup',   DETAIL)

  assert.strictEqual(clickOnA, false)
  assert.strictEqual(clickOnB, false)
})

// ---------------------------------------------------------------------------
// 8. Capture routes events to captured node
// ---------------------------------------------------------------------------

test('pointer: setPointerCapture routes pointermove to captured node (even off-geometry)', () => {
  const { client, A } = makeEnv()

  const moves = []
  A.addEventListener('pointermove', () => moves.push('A'))

  client.setPointerCapture(A)
  client.dispatchPointerEvent(null, 'pointermove', DETAIL)   // null = off-geometry

  assert.strictEqual(moves.length, 1)
  assert.strictEqual(client.hasPointerCapture, true)
})

// ---------------------------------------------------------------------------
// 9. Capture released automatically on pointerup
// ---------------------------------------------------------------------------

test('pointer: capture is released after pointerup; subsequent pointermove resolves normally', () => {
  const { client, A, B } = makeEnv()

  A.addEventListener('pointerup', () => {})   // ensure dispatch runs

  client.setPointerCapture(A)
  assert.strictEqual(client.hasPointerCapture, true)

  client.dispatchPointerEvent(A, 'pointerup', DETAIL)
  assert.strictEqual(client.hasPointerCapture, false)

  // After capture released, pointermove resolves to B normally
  let bOver = false
  B.addEventListener('pointerover', () => { bOver = true })
  client.dispatchPointerEvent(B, 'pointermove', DETAIL)
  assert.strictEqual(bOver, true)
})

// ---------------------------------------------------------------------------
// 10. Captured pointerup with null somNode → pointerup fires, click does NOT
// ---------------------------------------------------------------------------

test('pointer: captured pointerup with null somNode delivers pointerup but not click', () => {
  const { client, A } = makeEnv()

  const events = []
  A.addEventListener('pointerup', () => events.push('up'))
  A.addEventListener('click',     () => events.push('click'))

  client.setPointerCapture(A)
  client.dispatchPointerEvent(null, 'pointerup', DETAIL)   // off-geometry release

  assert.deepEqual(events, ['up'])   // click must NOT appear
  assert.strictEqual(client.hasPointerCapture, false)
})

// ---------------------------------------------------------------------------
// 11. releasePointerCapture clears capture
// ---------------------------------------------------------------------------

test('pointer: releasePointerCapture clears capture state', () => {
  const { client, A } = makeEnv()

  client.setPointerCapture(A)
  assert.strictEqual(client.hasPointerCapture, true)

  client.releasePointerCapture()
  assert.strictEqual(client.hasPointerCapture, false)
})

// ---------------------------------------------------------------------------
// 12. world:loaded clears capture and hover state
// ---------------------------------------------------------------------------

test('pointer: world:loaded clears capture and hover state', () => {
  const { client, A } = makeEnv()

  client.setPointerCapture(A)
  client._currentHoverNode  = A
  client._pointerDownTarget = A

  // Simulate world:loaded by calling _emitWorldLoaded directly
  client._emitWorldLoaded({})

  assert.strictEqual(client.hasPointerCapture,         false)
  assert.strictEqual(client._currentHoverNode,         null)
  assert.strictEqual(client._pointerDownTarget,        null)
})

// ---------------------------------------------------------------------------
// 13. disconnect clears capture and hover state
// ---------------------------------------------------------------------------

test('pointer: disconnect clears capture and hover state', () => {
  const { client, A } = makeEnv()

  client.setPointerCapture(A)
  client._currentHoverNode  = A
  client._pointerDownTarget = A

  client.disconnect()

  assert.strictEqual(client.hasPointerCapture,  false)
  assert.strictEqual(client._currentHoverNode,  null)
  assert.strictEqual(client._pointerDownTarget, null)
})

// ---------------------------------------------------------------------------
// 14. Multiple listeners on same event fire in attach order
// ---------------------------------------------------------------------------

test('pointer: multiple listeners on same event type fire in attach order', () => {
  const { client, A } = makeEnv()

  const order = []
  A.addEventListener('click', () => order.push(1))
  A.addEventListener('click', () => order.push(2))
  A.addEventListener('click', () => order.push(3))

  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)
  client.dispatchPointerEvent(A, 'pointerup',   DETAIL)

  assert.deepEqual(order, [1, 2, 3])
})

// ---------------------------------------------------------------------------
// 15. removeEventListener removes listener
// ---------------------------------------------------------------------------

test('pointer: removeEventListener prevents handler from firing', () => {
  const { client, A } = makeEnv()

  let fired = false
  const handler = () => { fired = true }
  A.addEventListener('pointerdown', handler)
  A.removeEventListener('pointerdown', handler)

  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)

  assert.strictEqual(fired, false)
})

// ---------------------------------------------------------------------------
// 16. All extended detail fields populated on a hit
// ---------------------------------------------------------------------------

test('pointer: all detail fields populated when dispatched with a hit detail', () => {
  const { client, A } = makeEnv()

  // Construct a detail representing a real hit, as buildDetail in apps/client would.
  const hitDetail = {
    pointerId:  1,
    button:     0,
    buttons:    1,
    point:      [2.0, 0.5, 0.0],
    localPoint: [0.0, 0.5, 0.0],
    normal:     [0, 1, 0],
    localNormal:[0, 1, 0],
    distance:   4.61,
    uv:         [0.5, 0.5],
    ray: {
      origin:    [0, 5, 5],
      direction: [0, -0.707, -0.707],
    },
    shiftKey: false,
    ctrlKey:  false,
    altKey:   false,
    metaKey:  false,
  }

  let received = null
  A.addEventListener('pointerdown', (e) => { received = e.detail })

  client.dispatchPointerEvent(A, 'pointerdown', hitDetail)

  assert.ok(received, 'handler should have fired')
  // target must NOT appear in detail — it belongs on event.target only
  assert.strictEqual('target' in received, false, 'detail must not contain target field')
  // World-space point — 3-element array
  assert.ok(Array.isArray(received.point) && received.point.length === 3, 'point is [x,y,z]')
  // Local-space point — 3-element array, different from world point
  assert.ok(Array.isArray(received.localPoint) && received.localPoint.length === 3, 'localPoint is [x,y,z]')
  assert.notDeepEqual(received.point, received.localPoint, 'localPoint differs from world point')
  // Normals
  assert.ok(Array.isArray(received.normal)      && received.normal.length      === 3, 'normal is [x,y,z]')
  assert.ok(Array.isArray(received.localNormal) && received.localNormal.length === 3, 'localNormal is [x,y,z]')
  // Distance
  assert.strictEqual(typeof received.distance, 'number', 'distance is a number')
  assert.ok(received.distance > 0, 'distance is positive')
  // UV — 2-element array
  assert.ok(Array.isArray(received.uv) && received.uv.length === 2, 'uv is [u,v]')
  // Ray
  assert.ok(Array.isArray(received.ray.origin)    && received.ray.origin.length    === 3)
  assert.ok(Array.isArray(received.ray.direction) && received.ray.direction.length === 3)
  // stopPropagation injected by AtriumClient
  assert.strictEqual(typeof received.stopPropagation, 'function')
})

// ---------------------------------------------------------------------------
// 17. Position/surface fields are null for off-geometry events
// ---------------------------------------------------------------------------

test('pointer: point, localPoint, normal, localNormal, distance, uv are null on off-geometry dispatch', () => {
  const { client, A } = makeEnv()

  // Off-geometry detail — null position fields but ray + keys populated
  const offDetail = {
    pointerId:  1,
    button:     0,
    buttons:    0,
    point:      null,
    localPoint: null,
    normal:     null,
    localNormal:null,
    distance:   null,
    uv:         null,
    ray: {
      origin:    [0, 5, 5],
      direction: [0.1, -0.7, -0.7],
    },
    shiftKey: false,
    ctrlKey:  false,
    altKey:   false,
    metaKey:  false,
  }

  // Establish A as the current hover node, then move off-geometry
  client._currentHoverNode = A
  let received = null
  A.addEventListener('pointerout', (e) => { received = e.detail })

  client.dispatchPointerEvent(null, 'pointermove', offDetail)

  assert.ok(received, 'pointerout should fire when leaving A')
  assert.strictEqual(received.point,       null)
  assert.strictEqual(received.localPoint,  null)
  assert.strictEqual(received.normal,      null)
  assert.strictEqual(received.localNormal, null)
  assert.strictEqual(received.distance,    null)
  assert.strictEqual(received.uv,          null)
  // Ray is still populated
  assert.ok(Array.isArray(received.ray.origin))
})

// ---------------------------------------------------------------------------
// 18. event.target is the SOM node; 'target' is absent from event.detail
// ---------------------------------------------------------------------------

test('pointer: event.target is the SOM node and target is not in event.detail', () => {
  const { client, A } = makeEnv()

  let capturedEvent = null
  A.addEventListener('pointerdown', (e) => { capturedEvent = e })

  client.dispatchPointerEvent(A, 'pointerdown', DETAIL)

  assert.ok(capturedEvent, 'handler should fire')
  // event.target must be the SOM node
  assert.strictEqual(capturedEvent.target, A, 'event.target is the SOM node')
  // target must not appear in detail — logging/serializing detail must be safe
  assert.strictEqual('target' in capturedEvent.detail, false, 'target absent from event.detail')
})
