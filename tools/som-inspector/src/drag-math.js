// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * drag-math.js — pure helpers for viewport drag-to-translate.
 *
 * No Three.js import: functions take plain objects and return THREE objects
 * only when THREE is passed in. Kept pure so Session 34 extraction is clean.
 */

import * as THREE from 'three'

/**
 * Project a ray onto the world-space horizontal plane at the given Y.
 *
 * Returns the intersection as a THREE.Vector3, or null when:
 * - |direction.y| < 1e-6 (ray nearly parallel to plane — degenerate)
 * - t < 0 (intersection is behind the ray origin)
 *
 * @param {{ origin: number[], direction: number[] }} ray
 * @param {number} planeY
 * @returns {THREE.Vector3 | null}
 */
export function projectRayToPlane(ray, planeY) {
  const origin    = new THREE.Vector3(...ray.origin)
  const direction = new THREE.Vector3(...ray.direction)
  if (Math.abs(direction.y) < 1e-6) return null   // parallel to plane
  const t = (planeY - origin.y) / direction.y
  if (t < 0) return null                            // behind camera
  return origin.clone().addScaledVector(direction, t)
}

/**
 * Compute the inverse of the parent's world matrix for the given Three.js
 * Object3D. Used to convert a world-space position into parent-local space.
 *
 * Returns the identity matrix when the object has no parent (world = local).
 *
 * @param {THREE.Object3D} threeObj
 * @returns {THREE.Matrix4}
 */
export function computeParentInverse(threeObj) {
  if (!threeObj.parent) return new THREE.Matrix4()    // identity — world is local
  return threeObj.parent.matrixWorld.clone().invert()
}
