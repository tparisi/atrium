// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../../som/src/SOMDocument.js'
import { AnimationController } from '../src/AnimationController.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal SOMDocument with one animation ('Walk') whose playback
 * extras can be customised via the `playbackExtras` option.
 */
function makeSom({ playbackExtras = null, ephemeralPeerCount = 0 } = {}) {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const node = doc.createNode('Cube').setTranslation([0, 0, 0])
  scene.addChild(node)

  const buf = doc.createBuffer()
  const timeAcc = doc.createAccessor().setType('SCALAR')
    .setArray(new Float32Array([0, 1.0])).setBuffer(buf)
  const valAcc = doc.createAccessor().setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 0, 1, 0])).setBuffer(buf)
  const sampler = doc.createAnimationSampler()
    .setInput(timeAcc).setOutput(valAcc).setInterpolation('LINEAR')
  const channel = doc.createAnimationChannel()
    .setTargetNode(node).setTargetPath('translation').setSampler(sampler)
  const gltfAnim = doc.createAnimation('Walk').addSampler(sampler).addChannel(channel)

  if (playbackExtras) {
    gltfAnim.setExtras({ atrium: { playback: playbackExtras } })
  }

  // Add ephemeral peer nodes to simulate peers already in the som-dump
  for (let i = 0; i < ephemeralPeerCount; i++) {
    const peerNode = doc.createNode(`peer-${i}`)
    peerNode.setExtras({ atrium: { ephemeral: true } })
    scene.addChild(peerNode)
  }

  return new SOMDocument(doc)
}

/**
 * Minimal AtriumClient stub that holds a SOM and fires 'world:loaded'.
 * `localName` simulates a post-handshake displayName (used by the real peerCount getter).
 */
function makeClient(som, { localName = null } = {}) {
  const listeners = Object.create(null)
  const client = {
    _som: som,
    _displayName: localName,
    get som() { return this._som },
    get peerCount() {
      if (!this._som) return 0
      const ln = this._displayName ?? null
      return this._som.nodes.filter(n =>
        n.extras?.atrium?.ephemeral === true &&
        n.name !== ln
      ).length
    },
    on(event, fn) {
      ;(listeners[event] ??= []).push(fn)
      return this
    },
    emit(event, ...args) {
      const arr = listeners[event]
      if (arr) for (const fn of [...arr]) fn(...args)
    },
  }
  return client
}

// ---------------------------------------------------------------------------
// autoStart: empty room, autoStart true → plays
// ---------------------------------------------------------------------------

test('AnimationController: autoStart=true, peerCount=0 → emits animation:play', () => {
  const som = makeSom({ playbackExtras: { playing: false, paused: false, loop: true,
    autoStart: true, timeScale: 1.0, startTime: 0, startWallClock: null, pauseTime: null } })
  const client = makeClient(som)

  const plays = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:play', ({ animation }) => plays.push(animation.name))

  // Trigger world:loaded
  client.emit('world:loaded')

  assert.strictEqual(plays.length, 1)
  assert.strictEqual(plays[0], 'Walk')
  assert.strictEqual(som.getAnimationByName('Walk').playing, true)
})

// ---------------------------------------------------------------------------
// autoStart: peer present → suppressed
// ---------------------------------------------------------------------------

test('AnimationController: autoStart=true, peerCount>0 → no animation:play', () => {
  const som = makeSom({
    playbackExtras: { playing: false, paused: false, loop: true, autoStart: true,
      timeScale: 1.0, startTime: 0, startWallClock: null, pauseTime: null },
    ephemeralPeerCount: 1,
  })
  const client = makeClient(som)

  const plays = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:play', ({ animation }) => plays.push(animation.name))

  client.emit('world:loaded')

  assert.strictEqual(plays.length, 0)
  assert.strictEqual(som.getAnimationByName('Walk').playing, false)
})

// ---------------------------------------------------------------------------
// autoStart: already playing → late-joiner path, no double-play
// ---------------------------------------------------------------------------

test('AnimationController: autoStart=true + playing=true → late-joiner path only', () => {
  const som = makeSom({ playbackExtras: { playing: true, paused: false, loop: true,
    autoStart: true, timeScale: 1.0, startTime: 0, startWallClock: Date.now(), pauseTime: null } })
  const client = makeClient(som)

  const plays = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:play', ({ animation }) => plays.push(animation.name))

  client.emit('world:loaded')

  // Exactly one play event from the late-joiner path — not doubled by autoStart
  assert.strictEqual(plays.length, 1)
})

// ---------------------------------------------------------------------------
// autoStart: false → nothing happens
// ---------------------------------------------------------------------------

test('AnimationController: autoStart=false, peerCount=0 → no animation:play', () => {
  const som = makeSom({ playbackExtras: { playing: false, paused: false, loop: false,
    autoStart: false, timeScale: 1.0, startTime: 0, startWallClock: null, pauseTime: null } })
  const client = makeClient(som)

  const plays = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:play', ({ animation }) => plays.push(animation.name))

  client.emit('world:loaded')

  assert.strictEqual(plays.length, 0)
})

// ---------------------------------------------------------------------------
// autoStart: authored loop is honored when autoStart fires
// ---------------------------------------------------------------------------

test('AnimationController: autoStart honors authored loop and timeScale', () => {
  const som = makeSom({ playbackExtras: { playing: false, paused: false, loop: true,
    autoStart: true, timeScale: 2.0, startTime: 0, startWallClock: null, pauseTime: null } })
  const client = makeClient(som)

  const ctrl = new AnimationController(client)
  client.emit('world:loaded')

  const anim = som.getAnimationByName('Walk')
  assert.strictEqual(anim.playing, true)
  assert.strictEqual(anim.loop, true)
  assert.strictEqual(anim.timeScale, 2.0)
})

// ---------------------------------------------------------------------------
// animation:playback-changed is emitted on every mutation
// ---------------------------------------------------------------------------

test('AnimationController: animation:playback-changed emitted on play', () => {
  const som = makeSom()
  const client = makeClient(som)

  const changes = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:playback-changed', ({ animation, playback }) => {
    changes.push({ name: animation.name, playing: playback.playing })
  })

  client.emit('world:loaded')
  som.getAnimationByName('Walk').play()

  assert.ok(changes.length >= 1)
  assert.ok(changes.some(c => c.playing === true))
})

test('AnimationController: animation:playback-changed emitted on stop', () => {
  const som = makeSom()
  const client = makeClient(som)

  const changes = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:playback-changed', ({ animation, playback }) => {
    changes.push({ playing: playback.playing })
  })

  client.emit('world:loaded')
  const anim = som.getAnimationByName('Walk')
  anim.play()
  anim.stop()

  assert.ok(changes.some(c => c.playing === false))
})

// ---------------------------------------------------------------------------
// autoStart integration: local avatar in SOM must not suppress autoStart
// ---------------------------------------------------------------------------

test('AnimationController: autoStart fires when SOM contains local avatar (peerCount excludes self)', () => {
  // Simulate the connect-time som-dump: local avatar node is ephemeral and
  // already in the SOM when world:loaded fires. autoStart should still fire
  // because the local avatar is excluded from peerCount by name.
  const som = makeSom({
    playbackExtras: { playing: false, paused: false, loop: true,
      autoStart: true, timeScale: 1.0, startTime: 0, startWallClock: null, pauseTime: null },
  })

  // Inject local avatar node into the SOM document directly
  const avatarName = 'User-abcd'
  const gltfNode = som.document.createNode(avatarName)
  gltfNode.setExtras({ atrium: { ephemeral: true } })
  som.document.getRoot().listScenes()[0].addChild(gltfNode)

  const client = makeClient(som, { localName: avatarName })

  const plays = []
  const ctrl = new AnimationController(client)
  ctrl.on('animation:play', ({ animation }) => plays.push(animation.name))

  client.emit('world:loaded')

  assert.strictEqual(plays.length, 1, 'autoStart should fire despite local avatar in SOM')
  assert.strictEqual(plays[0], 'Walk')
  assert.strictEqual(som.getAnimationByName('Walk').playing, true)
})
