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
    this._defaultCamera = new THREE.PerspectiveCamera(cameraFov, 1, cameraNear, cameraFar)
    this._defaultCamera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2])
    this._camera = this._defaultCamera

    // ── Controllers ──────────────────────────────────────────────────────────
    this._client                 = client
    this._avatar                 = null
    this._nav                    = null
    this._animCtrl               = null
    this._animBridge             = null
    this._wantAnimBridge         = animBridge
    this._AnimBridgeCtor         = _AnimBridgeCtor
    this._sceneGroup             = null
    this._cameraListenerCleanups = []
    this._viewportAspect         = 1   // updated by resize(); used to init per-camera aspect

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
   * Wire the AnimationBridge for the current world's sceneGroup, and build
   * persistent Three.js camera objects for each SOMCamera in the world.
   * Call from the app's world:loaded handler, after initDocumentView().
   * Disposes any previous bridge and camera listeners, then reconstructs.
   *
   * @param {THREE.Object3D} sceneGroup  - returned by initDocumentView
   */
  setSceneGroup(sceneGroup) {
    this._sceneGroup = sceneGroup

    // Tear down mutation listeners from the previous scene's cameras
    for (const cleanup of this._cameraListenerCleanups) cleanup()
    this._cameraListenerCleanups = []

    // AnimationBridge
    if (this._wantAnimBridge && this._animCtrl) {
      if (this._animBridge) this._animBridge.dispose()
      this._animBridge = new this._AnimBridgeCtor(sceneGroup, this._client, this._animCtrl)

      if (this._client?.som) {
        this._animBridge.init(this._client.som)
        this._animBridge.replayPlayingAnimations(this._client.som)
      }
    }

    // Build per-SOMCamera Three.js objects
    const cameras = this._client?.som?.cameras
    if (!cameras) return

    for (const somCamera of cameras) {
      const hostNode = somCamera.node
      if (!hostNode) {
        console.warn(`[Stage] SOMCamera "${somCamera.name}" has no host node — skipping`)
        continue
      }
      const hostObj = sceneGroup.getObjectByName(hostNode.name)
      if (!hostObj) {
        console.warn(`[Stage] No Object3D for SOMCamera "${somCamera.name}" (node "${hostNode.name}") — skipping`)
        continue
      }

      let threeCamera
      if (somCamera.type === 'perspective') {
        const fov = somCamera.yfov != null ? (somCamera.yfov * 180) / Math.PI : 70
        threeCamera = new THREE.PerspectiveCamera(
          fov, this._viewportAspect, somCamera.znear ?? 0.01, somCamera.zfar ?? 1000
        )
      } else {
        const hx = (somCamera.xmag ?? 1) / 2
        const hy = (somCamera.ymag ?? 1) / 2
        threeCamera = new THREE.OrthographicCamera(
          -hx, hx, hy, -hy, somCamera.znear ?? 0.01, somCamera.zfar ?? 1000
        )
      }

      // Parent at identity local transform — Stage uses this slot for nav offset
      hostObj.add(threeCamera)
      somCamera._rawCamera = threeCamera

      // Keep Three.js lens in sync with SOMCamera mutations
      const onMutation = (event) => {
        const { property, value } = event.detail
        if (threeCamera instanceof THREE.PerspectiveCamera) {
          if (property === 'yfov') {
            threeCamera.fov = (value * 180) / Math.PI
            threeCamera.updateProjectionMatrix()
          } else if (property === 'znear') {
            threeCamera.near = value
            threeCamera.updateProjectionMatrix()
          } else if (property === 'zfar') {
            threeCamera.far = value
            threeCamera.updateProjectionMatrix()
          } else if (property === 'aspectRatio') {
            threeCamera.aspect = value
            threeCamera.updateProjectionMatrix()
          }
        } else if (threeCamera instanceof THREE.OrthographicCamera) {
          if (property === 'xmag') {
            const hx = value / 2
            threeCamera.left  = -hx
            threeCamera.right =  hx
            threeCamera.updateProjectionMatrix()
          } else if (property === 'ymag') {
            const hy = value / 2
            threeCamera.top    =  hy
            threeCamera.bottom = -hy
            threeCamera.updateProjectionMatrix()
          } else if (property === 'znear') {
            threeCamera.near = value
            threeCamera.updateProjectionMatrix()
          } else if (property === 'zfar') {
            threeCamera.far = value
            threeCamera.updateProjectionMatrix()
          }
        }
      }

      somCamera.addEventListener('mutation', onMutation)
      this._cameraListenerCleanups.push(() => {
        somCamera.removeEventListener('mutation', onMutation)
        somCamera._rawCamera = null
      })
    }
  }

  /**
   * Activate a SOMCamera, swapping this._camera to the pre-built Three.js
   * camera object parented under the host node. Pass null to revert to the
   * persistent default perspective camera.
   *
   * @param {SOMCamera|null} somCamera
   */
  setActiveCamera(somCamera) {
    if (!this._nav) return

    if (!somCamera) {
      this._camera = this._defaultCamera
      this._nav.activeCamera = null
      return
    }

    if (!somCamera.rawCamera) {
      console.warn(`[Stage] setActiveCamera: "${somCamera.name}" has no rawCamera — skipping`)
      return
    }

    this._camera = somCamera.rawCamera

    // Ensure the newly-active camera has the correct viewport aspect.
    // A per-SOMCamera object may have been constructed (or last touched) before
    // a resize that fired while a different camera was active.
    if (this._camera instanceof THREE.PerspectiveCamera) {
      this._camera.aspect = this._viewportAspect
      this._camera.updateProjectionMatrix()
    }

    // Seed nav from the camera's current world transform so navigation resumes
    // from the authored camera position/orientation
    const worldPos  = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    somCamera.rawCamera.getWorldPosition(worldPos)
    somCamera.rawCamera.getWorldQuaternion(worldQuat)

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
    } else if (this._avatar?.localNode) {
      // WALK/FLY: seed the avatar position from the camera's authored world position
      // so the eye lands at the authored spot, not wherever the avatar was standing.
      this._avatar.localNode.translation = [worldPos.x, worldPos.y, worldPos.z]
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
    this._viewportAspect = width / height
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

    // Compute world-space eye position and quaternion from nav state
    const worldPos  = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()

    if (this._nav.mode === 'ORBIT') {
      const pos = localNode.translation ?? [0, 0, 0]
      worldPos.set(pos[0], pos[1], pos[2])
      const t = this._nav.orbitTarget
      const m = new THREE.Matrix4().lookAt(
        worldPos,
        new THREE.Vector3(t[0], t[1], t[2]),
        new THREE.Vector3(0, 1, 0),
      )
      worldQuat.setFromRotationMatrix(m)
    } else {
      const yaw    = this._nav.yaw
      const pitch  = this._nav.pitch
      const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      const avatarPos = localNode.translation  ?? [0, 0, 0]
      const camOffset = cameraNode.translation ?? [0, 0, 0]
      // Bypass the third-person rig while bound to a SOMCamera — the offset
      // look-at-avatar computation has no meaning when the view is authored.
      const hasOffset = !this._nav.activeCamera && Math.abs(camOffset[2]) > 0.001

      if (hasOffset) {
        const offset = new THREE.Vector3(
          0,
          this._avatar._cameraOffsetY,
          this._avatar._cameraOffsetZ,
        )
        offset.applyQuaternion(qYaw)
        worldPos.set(
          avatarPos[0] + offset.x,
          avatarPos[1] + offset.y,
          avatarPos[2] + offset.z,
        )
        const lookTarget = new THREE.Vector3(avatarPos[0], avatarPos[1] + 1.0, avatarPos[2])
        const m = new THREE.Matrix4().lookAt(worldPos, lookTarget, new THREE.Vector3(0, 1, 0))
        worldQuat.setFromRotationMatrix(m).multiply(qPitch)
      } else {
        worldPos.set(avatarPos[0], avatarPos[1], avatarPos[2])
        worldQuat.copy(qYaw).multiply(qPitch)
      }
    }

    if (!this._nav.activeCamera) {
      // Default (free-standing) camera: write world-space directly
      this._camera.position.copy(worldPos)
      this._camera.quaternion.copy(worldQuat)
    } else {
      // Bound camera: parented under a scene node — convert to local space
      const parent = this._camera.parent
      if (!parent) return

      // Ensure parent's matrixWorld is current (handles static nested transforms)
      parent.updateWorldMatrix(true, false)

      const parentInv = new THREE.Matrix4().copy(parent.matrixWorld).invert()
      this._camera.position.copy(worldPos).applyMatrix4(parentInv)

      const parentQuat = new THREE.Quaternion()
      parent.getWorldQuaternion(parentQuat)
      this._camera.quaternion.copy(parentQuat.invert()).multiply(worldQuat)
    }
  }
}
