// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { walkUpToSOMNode } from './hit-test.js'

/**
 * PointerInputBridge — consolidates all renderer-side pointer wiring.
 *
 * Owns:
 * - Canvas DOM listener attachment / removal
 * - NDC conversion and raycasting
 * - Three.js Object3D → SOM node resolution
 * - Event detail construction (full Session 32 amendment shape)
 * - AtriumClient.dispatchPointerEvent calls
 * - Navigation-coexistence pragma (stopPropagation on mousedown when capture
 *   is set and suppressOnCapture is true)
 *
 * Does NOT own:
 * - Selection state, drag state, per-app SOM event handlers
 * - AnimationMixer, AvatarController, NavigationController
 *
 * Construction attaches listeners immediately. Call `dispose()` on teardown.
 *
 * @example
 * const bridge = new PointerInputBridge({
 *   client, canvas, camera, sceneRoot: () => sceneGroup,
 * })
 * // Later:
 * bridge.dispose()
 */
export class PointerInputBridge {
  /**
   * @param {object}              opts
   * @param {AtriumClient}        opts.client            AtriumClient instance
   * @param {HTMLCanvasElement}   opts.canvas            Target canvas for DOM listeners
   * @param {THREE.Camera}        opts.camera            Active camera for raycasting
   * @param {THREE.Object3D | () => THREE.Object3D} opts.sceneRoot
   *   Raycaster target. Pass a getter `() => sceneGroup` when the root
   *   is recreated on world reload and the bridge is constructed once.
   * @param {(obj: THREE.Object3D) => SOMNode | null} [opts.resolveSOMNode]
   *   Override the default name-walk-up resolution. Receives the leaf
   *   hit.object; should walk up or use any mapping strategy.
   * @param {boolean} [opts.suppressOnCapture=true]
   *   When true, calls e.stopPropagation() on mousedown if a node has
   *   pointer capture after dispatch (suppresses nav drag). Set false in
   *   apps with no nav controller.
   */
  constructor({ client, canvas, camera, sceneRoot, resolveSOMNode, suppressOnCapture = true }) {
    this._client  = client
    this._canvas  = canvas
    this._camera  = camera
    this._suppressOnCapture = suppressOnCapture

    this._raycaster = new THREE.Raycaster()
    this._ndc       = new THREE.Vector2()

    // sceneRoot: direct reference or getter
    this._getSceneRoot = typeof sceneRoot === 'function' ? sceneRoot : () => sceneRoot

    // resolveSOMNode: override or default walk-up
    this._resolveFn = resolveSOMNode ?? ((obj) => {
      const result = walkUpToSOMNode(obj, name => client.som?.getNodeByName(name) ?? null)
      return result?.somNode ?? null
    })

    // Stable bound references for removeEventListener
    this._onMouseMove = (e) => this._handleMouseMove(e)
    this._onMouseDown = (e) => this._handleMouseDown(e)
    this._onMouseUp   = (e) => this._handleMouseUp(e)

    canvas.addEventListener('mousemove', this._onMouseMove)
    canvas.addEventListener('mousedown', this._onMouseDown)
    canvas.addEventListener('mouseup',   this._onMouseUp)
  }

  /**
   * Remove all DOM listeners. Safe to call multiple times.
   */
  dispose() {
    this._canvas.removeEventListener('mousemove', this._onMouseMove)
    this._canvas.removeEventListener('mousedown', this._onMouseDown)
    this._canvas.removeEventListener('mouseup',   this._onMouseUp)
  }

  // ── Private — hit-testing ─────────────────────────────────────────────────

  /**
   * Run a ray from the camera through the DOM pointer position.
   * Always updates this._raycaster.ray so _buildDetail can read the ray
   * for off-geometry events.
   * Returns { node, hit } or null.
   */
  _hitTest(domEvent) {
    const rect = this._canvas.getBoundingClientRect()
    this._ndc.x =  ((domEvent.clientX - rect.left) / rect.width)  * 2 - 1
    this._ndc.y = -((domEvent.clientY - rect.top)  / rect.height) * 2 + 1
    this._raycaster.setFromCamera(this._ndc, this._camera)
    const root = this._getSceneRoot()
    if (!root || !this._client.som) return null
    const hits = this._raycaster.intersectObject(root, true)
    if (hits.length === 0) return null
    return this._resolveHit(hits[0])
  }

  _resolveHit(hit) {
    const node = this._resolveFn(hit.object)
    if (!node) return null
    return { node, hit }
  }

  // ── Private — detail construction ─────────────────────────────────────────

  /**
   * Build a pointer event detail from a DOM event and an optional hit result.
   *
   * Shape: { pointerId, button, buttons, ray, shiftKey, ctrlKey, altKey,
   *          metaKey, point, localPoint, normal, localNormal, distance, uv }
   *
   * All position/surface fields are null for off-geometry events.
   *
   * Coordinate-space notes:
   *   hit.point        — world-space (Three.js applies all transforms).
   *   hit.face.normal  — mesh-LOCAL space (Three.js historical quirk;
   *                      needs transformDirection(matrixWorld) for world).
   *   worldToLocal()   — mutates its argument; always clone first.
   */
  _buildDetail(domEvent, hitResult) {
    const detail = {
      pointerId: domEvent.pointerId ?? 1,
      button:    domEvent.button,
      buttons:   domEvent.buttons,
      ray: {
        origin:    this._raycaster.ray.origin.toArray(),
        direction: this._raycaster.ray.direction.toArray(),
      },
      shiftKey: domEvent.shiftKey,
      ctrlKey:  domEvent.ctrlKey,
      altKey:   domEvent.altKey,
      metaKey:  domEvent.metaKey,
    }

    if (hitResult) {
      const { hit } = hitResult
      detail.point      = hit.point.toArray()
      detail.localPoint = hit.object.worldToLocal(hit.point.clone()).toArray()
      detail.distance   = hit.distance
      if (hit.face) {
        detail.localNormal = hit.face.normal.toArray()
        detail.normal      = hit.face.normal.clone()
          .transformDirection(hit.object.matrixWorld)
          .toArray()
      } else {
        detail.localNormal = null
        detail.normal      = null
      }
      detail.uv = hit.uv ? hit.uv.toArray() : null
    } else {
      detail.point       = null
      detail.localPoint  = null
      detail.normal      = null
      detail.localNormal = null
      detail.distance    = null
      detail.uv          = null
    }

    return detail
  }

  // ── Private — DOM event handlers ──────────────────────────────────────────

  _handleMouseMove(e) {
    const result = this._hitTest(e)
    this._client.dispatchPointerEvent(
      result?.node ?? null, 'pointermove', this._buildDetail(e, result),
    )
  }

  _handleMouseDown(e) {
    const result = this._hitTest(e)
    if (result) {
      this._client.dispatchPointerEvent(result.node, 'pointerdown', this._buildDetail(e, result))
      // Suppress nav drag if a node captured the pointer and suppressOnCapture is set.
      // Order is critical: dispatch first, then peek capture state, then stopPropagation.
      if (this._suppressOnCapture && this._client.hasPointerCapture) {
        e.stopPropagation()
      }
    }
  }

  _handleMouseUp(e) {
    const result = this._hitTest(e)
    this._client.dispatchPointerEvent(
      result?.node ?? null, 'pointerup', this._buildDetail(e, result),
    )
  }
}
