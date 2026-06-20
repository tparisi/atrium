// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Note: THREE.WebGLRenderer requires WebGL (unavailable in Node).
// All tests inject a mock renderer via the _renderer option.
// All other THREE classes (Scene, PerspectiveCamera, Quaternion, etc.) work
// fine in Node.js and are used directly.

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import * as THREE from 'three'
import { Stage } from '../src/Stage.js'

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeContainer() {
  return { appendChild: () => {} }
}

function makeRenderer() {
  return {
    setPixelRatio: () => {},
    shadowMap: {},
    domElement: {
      setAttribute: () => {},
      style: {},
      addEventListener: () => {},
      focus: () => {},
    },
    setSize: () => {},
    render:  () => {},
  }
}

function makeClient() {
  return { som: null }
}

// Spy-capable stub for AvatarController
function makeAvatarCtor({ localNode = null, cameraNode = null, offsetY = 2.0, offsetZ = 4.0 } = {}) {
  return class {
    constructor(_client, _opts) {
      this.localNode       = localNode
      this.cameraNode      = cameraNode
      this._cameraOffsetY  = offsetY
      this._cameraOffsetZ  = offsetZ
    }
  }
}

// Spy-capable stub for NavigationController
function makeNavCtor({ mode = 'WALK', yaw = 0, pitch = 0, orbitTarget = [0, 0, 0] } = {}) {
  return class {
    constructor(_avatar, _opts) {
      this.mode         = mode
      this.yaw          = yaw
      this.pitch        = pitch
      this.orbitTarget  = orbitTarget
      this.activeCamera = null   // null = no bound SOMCamera (default camera path)
      this.tickCalls    = []
    }
    tick(dt) { this.tickCalls.push(dt) }
  }
}

// Spy-capable stub for AnimationController
function makeAnimCtrlCtor() {
  return class {
    constructor(_client) {
      this.tickCalls = []
    }
    tick(dt) { this.tickCalls.push(dt) }
  }
}

// Spy-capable stub for AnimationBridge
function makeAnimBridgeCtor() {
  return class {
    constructor(_sceneGroup, _client, _animCtrl) {
      this.updateCalls = []
      this.disposed    = false
      this.initCalled  = false
      this.replayCalled = false
    }
    update(dt)                      { this.updateCalls.push(dt) }
    dispose()                       { this.disposed = true }
    init(_som)                      { this.initCalled = true }
    replayPlayingAnimations(_som)   { this.replayCalled = true }
  }
}

// Build a Stage with all stubs and a client (most tests)
function makeStage(opts = {}) {
  const container = makeContainer()
  const renderer  = makeRenderer()
  const client    = makeClient()
  const stage = new Stage(container, {
    client,
    _renderer:       renderer,
    _AvatarCtor:     makeAvatarCtor(),
    _NavCtor:        makeNavCtor(),
    _AnimCtrlCtor:   makeAnimCtrlCtor(),
    _AnimBridgeCtor: makeAnimBridgeCtor(),
    ...opts,
  })
  return { stage, client }
}

// ---------------------------------------------------------------------------
// 1. Construction — no client
// ---------------------------------------------------------------------------

test('Stage: no-client construction — renderer, scene, camera are non-null', () => {
  const stage = new Stage(makeContainer(), { _renderer: makeRenderer() })
  assert.ok(stage.renderer  != null, 'renderer should be set')
  assert.ok(stage.scene     != null, 'scene should be set')
  assert.ok(stage.camera    != null, 'camera should be set')
})

test('Stage: no-client construction — all controllers are null', () => {
  const stage = new Stage(makeContainer(), { _renderer: makeRenderer() })
  assert.strictEqual(stage.avatar,    null)
  assert.strictEqual(stage.nav,       null)
  assert.strictEqual(stage.animCtrl,  null)
  assert.strictEqual(stage.animBridge, null)
})

// ---------------------------------------------------------------------------
// 2. Construction — with client, all controllers enabled
// ---------------------------------------------------------------------------

test('Stage: with client — avatar, nav, animCtrl are non-null; animBridge is null (deferred)', () => {
  const { stage } = makeStage()
  assert.ok(stage.avatar   != null, 'avatar should be created')
  assert.ok(stage.nav      != null, 'nav should be created')
  assert.ok(stage.animCtrl != null, 'animCtrl should be created')
  assert.strictEqual(stage.animBridge, null, 'animBridge deferred until setSceneGroup')
})

// ---------------------------------------------------------------------------
// 3. Construction — nav: false
// ---------------------------------------------------------------------------

test('Stage: nav: false — nav is null; avatar and animCtrl still constructed', () => {
  const { stage } = makeStage({ nav: false })
  assert.strictEqual(stage.nav, null)
  assert.ok(stage.avatar   != null)
  assert.ok(stage.animCtrl != null)
})

// ---------------------------------------------------------------------------
// 4. Construction — animCtrl: false
// ---------------------------------------------------------------------------

test('Stage: animCtrl: false — animCtrl is null; animBridge remains null after setSceneGroup', () => {
  const { stage } = makeStage({ animCtrl: false })
  assert.strictEqual(stage.animCtrl, null)
  stage.setSceneGroup(new (class{})())   // should be a no-op
  assert.strictEqual(stage.animBridge, null)
})

// ---------------------------------------------------------------------------
// 5. setSceneGroup constructs AnimationBridge
// ---------------------------------------------------------------------------

test('Stage: setSceneGroup constructs AnimationBridge when animBridge: true and animCtrl exists', () => {
  const { stage } = makeStage({ animBridge: true })
  assert.strictEqual(stage.animBridge, null)
  stage.setSceneGroup({})   // mock sceneGroup
  assert.ok(stage.animBridge != null, 'animBridge should be created after setSceneGroup')
})

// ---------------------------------------------------------------------------
// 6. setSceneGroup is a no-op when animBridge: false
// ---------------------------------------------------------------------------

test('Stage: setSceneGroup is a no-op when animBridge: false', () => {
  const { stage } = makeStage({ animBridge: false })
  stage.setSceneGroup({})
  assert.strictEqual(stage.animBridge, null)
})

// ---------------------------------------------------------------------------
// 7. tick() is null-safe (no controllers)
// ---------------------------------------------------------------------------

test('Stage: tick() does not throw when no controllers are present', () => {
  const stage = new Stage(makeContainer(), { _renderer: makeRenderer() })
  assert.doesNotThrow(() => stage.tick(0.016))
})

// ---------------------------------------------------------------------------
// 8. tick() calls controller methods
// ---------------------------------------------------------------------------

test('Stage: tick() calls nav.tick, animCtrl.tick, and animBridge.update', () => {
  const { stage } = makeStage({ animBridge: true })
  stage.setSceneGroup({})

  stage.tick(0.016)

  // Nav ticked
  assert.strictEqual(stage.nav.tickCalls.length, 1)
  assert.ok(Math.abs(stage.nav.tickCalls[0] - 0.016) < 0.001)

  // AnimCtrl ticked
  assert.strictEqual(stage.animCtrl.tickCalls.length, 1)
  assert.ok(Math.abs(stage.animCtrl.tickCalls[0] - 0.016) < 0.001)

  // AnimBridge updated
  assert.strictEqual(stage.animBridge.updateCalls.length, 1)
  assert.ok(Math.abs(stage.animBridge.updateCalls[0] - 0.016) < 0.001)
})

// ---------------------------------------------------------------------------
// 9. resize() updates camera aspect and calls updateProjectionMatrix
// ---------------------------------------------------------------------------

test('Stage: resize() updates camera aspect and calls updateProjectionMatrix', () => {
  const stage = new Stage(makeContainer(), { _renderer: makeRenderer() })
  let updateCalled = false
  stage.camera.updateProjectionMatrix = () => { updateCalled = true }

  // Track setSize call
  let sizeArgs = null
  stage.renderer.setSize = (w, h) => { sizeArgs = [w, h] }

  stage.resize(1280, 720)

  assert.ok(Math.abs(stage.camera.aspect - 1280 / 720) < 0.001)
  assert.ok(updateCalled, 'updateProjectionMatrix should be called')
  assert.deepEqual(sizeArgs, [1280, 720], 'renderer.setSize called with correct dimensions')
})

// ---------------------------------------------------------------------------
// 10. Camera sync skipped when avatar is null
// ---------------------------------------------------------------------------

test('Stage: _syncCamera skipped when avatar is null (no controllers)', () => {
  const stage = new Stage(makeContainer(), { _renderer: makeRenderer() })
  // camera should not be mutated
  const origPos = [stage.camera.position.x, stage.camera.position.y, stage.camera.position.z]
  assert.doesNotThrow(() => stage.tick(0.016))
  // position unchanged (no camera sync ran)
  assert.strictEqual(stage.camera.position.x, origPos[0])
})

// ---------------------------------------------------------------------------
// 11. Camera sync skipped when localNode is null
// ---------------------------------------------------------------------------

test('Stage: _syncCamera skipped when localNode is null', () => {
  const AvatarCtor  = makeAvatarCtor({ localNode: null, cameraNode: {} })
  const NavCtor     = makeNavCtor({ mode: 'WALK' })
  const stage = new Stage(makeContainer(), {
    client: makeClient(),
    _renderer:       makeRenderer(),
    _AvatarCtor:     AvatarCtor,
    _NavCtor:        NavCtor,
    _AnimCtrlCtor:   makeAnimCtrlCtor(),
    _AnimBridgeCtor: makeAnimBridgeCtor(),
  })
  // localNode is null — _syncCamera should return early
  const origX = stage.camera.position.x
  assert.doesNotThrow(() => stage.tick(0.016))
  assert.strictEqual(stage.camera.position.x, origX)
})

// ---------------------------------------------------------------------------
// 12. ORBIT camera sync
// ---------------------------------------------------------------------------

test('Stage: ORBIT mode — camera.position set from localNode.translation and quaternion faces orbitTarget', () => {
  const AvatarCtor = makeAvatarCtor({
    localNode:  { translation: [1, 2, 3] },
    cameraNode: { translation: [0, 0, 0] },
  })
  const NavCtor = makeNavCtor({ mode: 'ORBIT', orbitTarget: [5, 0, 5] })

  const stage = new Stage(makeContainer(), {
    client: makeClient(),
    _renderer:       makeRenderer(),
    _AvatarCtor:     AvatarCtor,
    _NavCtor:        NavCtor,
    _AnimCtrlCtor:   makeAnimCtrlCtor(),
    _AnimBridgeCtor: makeAnimBridgeCtor(),
    animBridge:      false,
  })

  stage.tick(0.016)

  assert.ok(Math.abs(stage.camera.position.x - 1) < 0.001, 'camera.x = localNode.translation.x')
  assert.ok(Math.abs(stage.camera.position.y - 2) < 0.001, 'camera.y = localNode.translation.y')
  assert.ok(Math.abs(stage.camera.position.z - 3) < 0.001, 'camera.z = localNode.translation.z')

  // Verify camera quaternion: forward direction (-Z) should point from (1,2,3) toward (5,0,5)
  // Expected direction: (4,-2,2), magnitude = sqrt(24) ≈ 4.899, normalized ≈ (0.816,-0.408,0.408)
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(stage.camera.quaternion)
  assert.ok(Math.abs(fwd.x - 0.816) < 0.01, 'forward.x ≈ 0.816 (toward orbitTarget.x)')
  assert.ok(fwd.z > 0, 'forward.z > 0 (toward orbitTarget.z > camera.z)')
})

// ---------------------------------------------------------------------------
// 13. WALK third-person camera sync (hasOffset = true)
// ---------------------------------------------------------------------------

test('Stage: WALK third-person — camera offset applied and quaternion faces avatar', () => {
  const AvatarCtor = makeAvatarCtor({
    localNode:  { translation: [0, 0, 0] },
    cameraNode: { translation: [0, 2.0, 4.0] },  // Z > 0.001 → third-person
    offsetY: 2.0,
    offsetZ: 4.0,
  })
  const NavCtor = makeNavCtor({ mode: 'WALK', yaw: 0, pitch: 0 })

  const stage = new Stage(makeContainer(), {
    client: makeClient(),
    _renderer:       makeRenderer(),
    _AvatarCtor:     AvatarCtor,
    _NavCtor:        NavCtor,
    _AnimCtrlCtor:   makeAnimCtrlCtor(),
    _AnimBridgeCtor: makeAnimBridgeCtor(),
    animBridge:      false,
  })

  stage.tick(0.016)

  // With yaw=0 and offsetZ=4, camera should be behind avatar (+Z direction in glTF)
  // camera.position.z should be avatarZ + offsetZ = 0 + 4 = 4 (yaw=0 → no X rotation)
  assert.ok(Math.abs(stage.camera.position.z - 4.0) < 0.01, 'third-person: camera Z = offsetZ')

  // Camera at (0, 2, 4) looks toward avatar at (0, 1, 0): forward direction is approx (0, -0.243, -0.970)
  // Verify forward.z < 0 (pointing toward avatar which is at lower Z)
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(stage.camera.quaternion)
  assert.ok(fwd.z < 0, 'third-person: camera forward.z < 0 (faces toward avatar)')
})

// ---------------------------------------------------------------------------
// 14. WALK first-person camera sync (hasOffset = false, Z ≈ 0)
// ---------------------------------------------------------------------------

test('Stage: WALK first-person — quaternion path taken when camOffset[2] ≈ 0', () => {
  const AvatarCtor = makeAvatarCtor({
    localNode:  { translation: [1, 2, 3] },
    cameraNode: { translation: [0, 1.6, 0] },   // Z ≈ 0 → first-person
    offsetY: 2.0,
    offsetZ: 4.0,
  })
  const NavCtor = makeNavCtor({ mode: 'WALK', yaw: 0, pitch: 0 })

  const stage = new Stage(makeContainer(), {
    client: makeClient(),
    _renderer:       makeRenderer(),
    _AvatarCtor:     AvatarCtor,
    _NavCtor:        NavCtor,
    _AnimCtrlCtor:   makeAnimCtrlCtor(),
    _AnimBridgeCtor: makeAnimBridgeCtor(),
    animBridge:      false,
  })

  let lookAtCalled = false
  stage.camera.lookAt = () => { lookAtCalled = true }

  stage.tick(0.016)

  // First-person: camera position = avatar position (no offset)
  assert.ok(Math.abs(stage.camera.position.x - 1) < 0.001, 'first-person: camera.x = avatar.x')
  assert.ok(Math.abs(stage.camera.position.y - 2) < 0.001, 'first-person: camera.y = avatar.y')
  assert.ok(Math.abs(stage.camera.position.z - 3) < 0.001, 'first-person: camera.z = avatar.z')
  assert.ok(!lookAtCalled, 'first-person: lookAt NOT called (uses quaternion)')
})
