// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { AvatarController }     from '@atrium/client/AvatarController'
import { NavigationController } from '@atrium/client/NavigationController'
import { AnimationController }  from '@atrium/client/AnimationController'
import { AnimationBridge }      from './AnimationBridge.js'

/**
 * Stage — Three.js renderer lifecycle manager.
 *
 * Absorbs the duplicated Three.js setup, resize, and tick logic from
 * apps/client, tools/som-inspector, and apps/playground. One Stage per
 * viewport; apps call stage.tick(dt) in their rAF loop and stage.resize()
 * from their ResizeObserver.
 *
 * AnimationBridge is deferred: call stage.setSceneGroup(sceneGroup) from the
 * app's world:loaded handler after initDocumentView to wire it up.
 */
export class Stage {
  /**
   * @param {HTMLElement} container  - Viewport element; renderer canvas is appended here
   * @param {object}      options
   */
  constructor(container, {
    // Client + controllers
    client               = null,
    cameraOffsetY        = 2.0,
    cameraOffsetZ        = 4.0,
    nav                  = true,
    navMode              = 'WALK',
    navMouseSensitivity  = 0.002,
    animCtrl             = true,
    animBridge           = true,

    // Scene
    backgroundColor      = 0x111111,
    ambientLightColor    = 0xffffff,
    ambientLightIntensity = 0.6,
    sunColor             = 0xffffff,
    sunIntensity         = 1.2,
    sunPosition          = [5, 10, 5],
    grid                 = true,

    // Camera
    cameraFov            = 70,
    cameraNear           = 0.01,
    cameraFar            = 1000,
    cameraPosition       = [0, 5, 10],

    // Renderer
    antialias            = true,
    shadows              = true,

    // Test injection hooks (underscore = internal / test-only)
    _renderer            = null,
    _AvatarCtor          = AvatarController,
    _NavCtor             = NavigationController,
    _AnimCtrlCtor        = AnimationController,
    _AnimBridgeCtor      = AnimationBridge,
  } = {}) {
    // ── Renderer ────────────────────────────────────────────────────────────
    this._renderer = _renderer ?? new THREE.WebGLRenderer({ antialias })
    this._renderer.setPixelRatio(globalThis.devicePixelRatio ?? 1)
    this._renderer.shadowMap.enabled = shadows
    container.appendChild(this._renderer.domElement)

    // Make canvas focusable for keyboard events
    const canvas = this._renderer.domElement
    canvas.setAttribute?.('tabindex', '0')
    if (canvas.style) canvas.style.outline = 'none'
    canvas.addEventListener?.('pointerdown', () => canvas.focus?.())

    // ── Scene ────────────────────────────────────────────────────────────────
    this._scene = new THREE.Scene()
    this._scene.background = new THREE.Color(backgroundColor)
    this._scene.add(new THREE.AmbientLight(ambientLightColor, ambientLightIntensity))
    const sun = new THREE.DirectionalLight(sunColor, sunIntensity)
    sun.position.set(sunPosition[0], sunPosition[1], sunPosition[2])
    sun.castShadow = true
    this._scene.add(sun)
    if (grid) {
      this._scene.add(new THREE.GridHelper(40, 40, 0x1e293b, 0x0f172a))
    }

    // ── Camera ───────────────────────────────────────────────────────────────
    this._camera = new THREE.PerspectiveCamera(cameraFov, 1, cameraNear, cameraFar)
    this._camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2])
    this._cameraFov  = cameraFov
    this._cameraNear = cameraNear
    this._cameraFar  = cameraFar

    // ── Controllers ──────────────────────────────────────────────────────────
    this._client          = client
    this._avatar          = null
    this._nav             = null
    this._animCtrl        = null
    this._animBridge      = null
    this._wantAnimBridge  = animBridge
    this._AnimBridgeCtor  = _AnimBridgeCtor
    this._sceneGroup      = null

    if (client) {
      this._avatar = new _AvatarCtor(client, { cameraOffsetY, cameraOffsetZ })

      if (nav) {
        this._nav = new _NavCtor(this._avatar, {
          mode:             navMode,
          mouseSensitivity: navMouseSensitivity,
        })
      }

      if (animCtrl) {
        this._animCtrl = new _AnimCtrlCtor(client)
      }
      // AnimationBridge is deferred until setSceneGroup()
    }
  }

  // ── Read-only accessors ──────────────────────────────────────────────────

  get renderer()   { return this._renderer }
  get scene()      { return this._scene }
  get camera()     { return this._camera }
  get avatar()     { return this._avatar }
  get nav()        { return this._nav }
  get animCtrl()   { return this._animCtrl }
  get animBridge() { return this._animBridge }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Wire the AnimationBridge for the current world's sceneGroup.
   * Call from the app's world:loaded handler, after initDocumentView().
   * Disposes any previous bridge, then constructs, inits, and replays.
   * No-op if animBridge was false at construction, or animCtrl is absent.
   *
   * @param {THREE.Object3D} sceneGroup  - returned by initDocumentView
   */
  setSceneGroup(sceneGroup) {
    this._sceneGroup = sceneGroup
    if (!this._wantAnimBridge || !this._animCtrl) return

    if (this._animBridge) this._animBridge.dispose()
    this._animBridge = new this._AnimBridgeCtor(sceneGroup, this._client, this._animCtrl)

    if (this._client?.som) {
      this._animBridge.init(this._client.som)
      this._animBridge.replayPlayingAnimations(this._client.som)
    }
  }

  /**
   * Activate a SOMCamera, seeding nav state from its authored world transform
   * and performing a one-time lens copy into this._camera. Pass null to revert
   * to the default perspective camera.
   *
   * @param {SOMCamera|null} somCamera
   */
  setActiveCamera(somCamera) {
    if (!this._nav) return

    if (!somCamera) {
      if (!(this._camera instanceof THREE.PerspectiveCamera)) {
        this._camera = new THREE.PerspectiveCamera(this._cameraFov, 1, this._cameraNear, this._cameraFar)
      }
      this._nav.activeCamera = null
      return
    }

    const hostNode = somCamera.node
    if (!hostNode || !this._sceneGroup) return
    const threeObj = this._sceneGroup.getObjectByName(hostNode.name)
    if (!threeObj) return

    // Extract world transform
    const worldPos  = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    threeObj.getWorldPosition(worldPos)
    threeObj.getWorldQuaternion(worldQuat)

    // Seed nav yaw/pitch from world orientation (YXZ Euler = yaw then pitch)
    const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ')
    this._nav.yaw   = euler.y
    this._nav.pitch = euler.x

    if (this._nav.mode === 'ORBIT') {
      const ORBIT_DIST = 5
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat)
      this._nav.orbitTarget = [
        worldPos.x + forward.x * ORBIT_DIST,
        worldPos.y + forward.y * ORBIT_DIST,
        worldPos.z + forward.z * ORBIT_DIST,
      ]
      this._nav._orbitRadius    = ORBIT_DIST
      this._nav._orbitAzimuth   = euler.y
      this._nav._orbitElevation = -euler.x
    }

    // One-time lens copy
    if (somCamera.type === 'perspective') {
      if (!(this._camera instanceof THREE.PerspectiveCamera)) {
        this._camera = new THREE.PerspectiveCamera(1, 1, 0.01, 1000)
      }
      this._camera.fov  = (somCamera.yfov * 180) / Math.PI
      this._camera.near = somCamera.znear
      this._camera.far  = somCamera.zfar
      this._camera.updateProjectionMatrix()
    } else {
      const hx = (somCamera.xmag ?? 1) / 2
      const hy = (somCamera.ymag ?? 1) / 2
      this._camera = new THREE.OrthographicCamera(
        -hx, hx, hy, -hy, somCamera.znear, somCamera.zfar
      )
    }

    this._nav.activeCamera = somCamera
  }

  /**
   * Advance all controllers and render one frame.
   * Call from the app's requestAnimationFrame loop.
   *
   * @param {number} dt  - delta-time in seconds
   */
  tick(dt) {
    if (this._nav)        this._nav.tick(dt)
    if (this._animCtrl)   this._animCtrl.tick(dt)
    if (this._animBridge) this._animBridge.update(dt)
    this._syncCamera()
    this._renderer.render(this._scene, this._camera)
  }

  /**
   * Update renderer and camera to match a new viewport size.
   * Call from the app's ResizeObserver or window.resize handler.
   *
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this._renderer.setSize(width, height)
    this._camera.aspect = width / height
    this._camera.updateProjectionMatrix()
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _syncCamera() {
    if (!this._avatar || !this._nav) return

    const localNode  = this._avatar.localNode
    const cameraNode = this._avatar.cameraNode
    if (!localNode || !cameraNode) return

    if (this._nav.mode === 'ORBIT') {
      const pos = localNode.translation ?? [0, 0, 0]
      this._camera.position.set(pos[0], pos[1], pos[2])
      const t = this._nav.orbitTarget
      this._camera.lookAt(t[0], t[1], t[2])
    } else {
      const yaw    = this._nav.yaw
      const pitch  = this._nav.pitch
      const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      const avatarPos  = localNode.translation  ?? [0, 0, 0]
      const camOffset  = cameraNode.translation ?? [0, 0, 0]
      const hasOffset  = Math.abs(camOffset[2]) > 0.001

      if (hasOffset) {
        const offset = new THREE.Vector3(
          0,
          this._avatar._cameraOffsetY,
          this._avatar._cameraOffsetZ
        )
        offset.applyQuaternion(qYaw)
        this._camera.position.set(
          avatarPos[0] + offset.x,
          avatarPos[1] + offset.y,
          avatarPos[2] + offset.z,
        )
        const lookTarget = new THREE.Vector3(avatarPos[0], avatarPos[1] + 1.0, avatarPos[2])
        this._camera.lookAt(lookTarget)
        this._camera.rotateX(pitch)
      } else {
        this._camera.position.set(avatarPos[0], avatarPos[1], avatarPos[2])
        this._camera.quaternion.copy(qYaw).multiply(qPitch)
      }
    }
  }
}
