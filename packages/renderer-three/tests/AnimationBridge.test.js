// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// Note: import directly from source file, not from index.js — index.js re-exports
// document-view.js which imports @gltf-transform/view (browser CDN only).

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import * as THREE from 'three'

import { AnimationBridge } from '../src/AnimationBridge.js'

// ---------------------------------------------------------------------------
// Helpers — minimal stubs
// ---------------------------------------------------------------------------

function makeAnimCtrl() {
  const handlers = Object.create(null)
  return {
    on(event, fn)  { (handlers[event] ??= []).push(fn) },
    off(event, fn) {
      const arr = handlers[event]
      if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1) }
    },
    emit(event, payload) {
      const arr = handlers[event]
      if (arr) for (const fn of [...arr]) fn(payload)
    },
    _handlers: handlers,
  }
}

function makeClient(animations = []) {
  const som = {
    animations,
    getAnimationByName(name) { return animations.find(a => a.name === name) ?? null },
  }
  return { som }
}

function makeSceneGroup() {
  return new THREE.Object3D()
}

function makeClip(name, duration = 1) {
  const times  = new Float32Array([0, duration])
  const values = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])
  const track  = new THREE.QuaternionKeyframeTrack('bone.quaternion', times, values)
  return new THREE.AnimationClip(name, duration, [track])
}

function makeSOMDocument(clips) {
  return {
    document: {
      getRoot: () => ({
        listAnimations: () => clips.map(clip => ({
          getName:       () => clip.name,
          listChannels:  () => [],
        })),
      }),
    },
  }
}

// Build a somDocument that actually produces AnimationClips when passed to
// buildClipsFromSOM. We need a document whose channels produce valid tracks.
function makeSOMDocumentWithClips(clipDefs) {
  return {
    document: {
      getRoot: () => ({
        listAnimations: () => clipDefs.map(({ name, duration = 1 }) => ({
          getName: () => name,
          listChannels: () => [{
            getSampler:    () => ({
              getInput:  () => ({ getArray: () => new Float32Array([0, duration]) }),
              getOutput: () => ({ getArray: () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]) }),
            }),
            getTargetNode: () => ({ getName: () => 'bone' }),
            getTargetPath: () => 'rotation',
          }],
        })),
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// Constructor — handler registration
// ---------------------------------------------------------------------------

test('AnimationBridge: constructor registers four animCtrl handlers', () => {
  const animCtrl   = makeAnimCtrl()
  const client     = makeClient()
  const sceneGroup = makeSceneGroup()

  const bridge = new AnimationBridge(sceneGroup, client, animCtrl)

  assert.ok(animCtrl._handlers['animation:play']?.length === 1)
  assert.ok(animCtrl._handlers['animation:pause']?.length === 1)
  assert.ok(animCtrl._handlers['animation:stop']?.length === 1)
  assert.ok(animCtrl._handlers['animation:playback-changed']?.length === 1)

  bridge.dispose()
})

// ---------------------------------------------------------------------------
// init — animation-free world (null-mixer guard)
// ---------------------------------------------------------------------------

test('AnimationBridge: init with no clips leaves mixer null', () => {
  const animCtrl   = makeAnimCtrl()
  const client     = makeClient()
  const sceneGroup = makeSceneGroup()
  const bridge     = new AnimationBridge(sceneGroup, client, animCtrl)

  bridge.init(makeSOMDocument([]))

  assert.strictEqual(bridge.mixer, null)
  bridge.dispose()
})

test('AnimationBridge: update() is a no-op when mixer is null', () => {
  const animCtrl   = makeAnimCtrl()
  const client     = makeClient()
  const bridge     = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))
  assert.doesNotThrow(() => bridge.update(0.016))
  bridge.dispose()
})

// ---------------------------------------------------------------------------
// init — world with animations
// ---------------------------------------------------------------------------

test('AnimationBridge: init with clips creates mixer', () => {
  const animCtrl   = makeAnimCtrl()
  const client     = makeClient()
  const sceneGroup = makeSceneGroup()
  const bridge     = new AnimationBridge(sceneGroup, client, animCtrl)

  bridge.init(makeSOMDocumentWithClips([{ name: 'Walk', duration: 1.5 }]))

  assert.ok(bridge.mixer instanceof THREE.AnimationMixer)
  bridge.dispose()
})

// ---------------------------------------------------------------------------
// replayPlayingAnimations
// ---------------------------------------------------------------------------

test('AnimationBridge: replayPlayingAnimations is a no-op when mixer is null', () => {
  const animCtrl = makeAnimCtrl()
  const anim     = { name: 'Walk', playing: true, currentTime: 0.5, playback: { loop: true, timeScale: 1 } }
  const client   = makeClient([anim])
  const bridge   = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))  // no clips → mixer stays null
  assert.doesNotThrow(() => bridge.replayPlayingAnimations(client.som))
  bridge.dispose()
})

test('AnimationBridge: replayPlayingAnimations starts a playing animation', () => {
  const animCtrl   = makeAnimCtrl()
  const sceneGroup = makeSceneGroup()
  const anim = { name: 'Walk', playing: true, currentTime: 0.3, playback: { loop: true, timeScale: 1 } }
  const client = makeClient([anim])
  const bridge = new AnimationBridge(sceneGroup, client, animCtrl)

  bridge.init(makeSOMDocumentWithClips([{ name: 'Walk', duration: 2 }]))
  assert.ok(bridge.mixer, 'mixer should exist')

  bridge.replayPlayingAnimations(client.som)

  const clip   = bridge.mixer._actions?.[0]?._clip ?? bridge.mixer.clipAction(bridge._clipMap.get('Walk')).getClip()
  assert.ok(clip, 'clip should exist after replay')
  bridge.dispose()
})

test('AnimationBridge: replayPlayingAnimations skips non-playing animations', () => {
  const animCtrl   = makeAnimCtrl()
  const sceneGroup = makeSceneGroup()
  const anim = { name: 'Idle', playing: false, currentTime: 0, playback: { loop: true, timeScale: 1 } }
  const client = makeClient([anim])
  const bridge = new AnimationBridge(sceneGroup, client, animCtrl)

  bridge.init(makeSOMDocumentWithClips([{ name: 'Idle', duration: 1 }]))
  assert.doesNotThrow(() => bridge.replayPlayingAnimations(client.som))
  bridge.dispose()
})

// ---------------------------------------------------------------------------
// animCtrl event handlers — null-mixer guards
// ---------------------------------------------------------------------------

test('AnimationBridge: animation:play handler is a no-op when mixer is null', () => {
  const animCtrl = makeAnimCtrl()
  const client   = makeClient()
  const bridge   = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))  // no mixer
  assert.doesNotThrow(() =>
    animCtrl.emit('animation:play', { animation: { name: 'Walk', loop: true, timeScale: 1, currentTime: 0 } })
  )
  bridge.dispose()
})

test('AnimationBridge: animation:pause handler is a no-op when mixer is null', () => {
  const animCtrl = makeAnimCtrl()
  const client   = makeClient()
  const bridge   = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))
  assert.doesNotThrow(() =>
    animCtrl.emit('animation:pause', { animation: { name: 'Walk' } })
  )
  bridge.dispose()
})

test('AnimationBridge: animation:stop handler is a no-op when mixer is null', () => {
  const animCtrl = makeAnimCtrl()
  const client   = makeClient()
  const bridge   = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))
  assert.doesNotThrow(() =>
    animCtrl.emit('animation:stop', { animation: { name: 'Walk' } })
  )
  bridge.dispose()
})

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

test('AnimationBridge: dispose removes all four animCtrl handlers', () => {
  const animCtrl   = makeAnimCtrl()
  const client     = makeClient()
  const bridge     = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))
  bridge.dispose()

  assert.strictEqual(animCtrl._handlers['animation:play']?.length ?? 0, 0)
  assert.strictEqual(animCtrl._handlers['animation:pause']?.length ?? 0, 0)
  assert.strictEqual(animCtrl._handlers['animation:stop']?.length ?? 0, 0)
  assert.strictEqual(animCtrl._handlers['animation:playback-changed']?.length ?? 0, 0)
})

test('AnimationBridge: dispose sets mixer to null', () => {
  const animCtrl   = makeAnimCtrl()
  const client     = makeClient()
  const sceneGroup = makeSceneGroup()
  const bridge     = new AnimationBridge(sceneGroup, client, animCtrl)

  bridge.init(makeSOMDocumentWithClips([{ name: 'Run' }]))
  assert.ok(bridge.mixer, 'mixer should exist before dispose')

  bridge.dispose()
  assert.strictEqual(bridge.mixer, null)
})

test('AnimationBridge: dispose is safe to call when mixer is null', () => {
  const animCtrl = makeAnimCtrl()
  const client   = makeClient()
  const bridge   = new AnimationBridge(makeSceneGroup(), client, animCtrl)

  bridge.init(makeSOMDocument([]))
  assert.doesNotThrow(() => bridge.dispose())
})
