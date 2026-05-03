// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import * as THREE from 'three'
import { projectRayToPlane, computeParentInverse } from '../src/drag-math.js'

// ---------------------------------------------------------------------------
// projectRayToPlane
// ---------------------------------------------------------------------------

test('drag-math: projectRayToPlane — straight-down ray hits plane at Y=0', () => {
  // origin (0,5,0), direction (0,-1,0), planeY=0
  // t = (0-5)/-1 = 5 → hit = (0, 5+5*(-1), 0) = (0,0,0)
  const result = projectRayToPlane({ origin: [0, 5, 0], direction: [0, -1, 0] }, 0)
  assert.ok(result !== null)
  assert.ok(Math.abs(result.x - 0) < 1e-10)
  assert.ok(Math.abs(result.y - 0) < 1e-10)
  assert.ok(Math.abs(result.z - 0) < 1e-10)
})

test('drag-math: projectRayToPlane — angled ray, correct X offset', () => {
  // origin (0,4,0), direction (1,-1,0), planeY=0
  // t = (0-4)/-1 = 4 → hit = (0+4*1, 4+4*(-1), 0) = (4,0,0)
  const result = projectRayToPlane({ origin: [0, 4, 0], direction: [1, -1, 0] }, 0)
  assert.ok(result !== null)
  assert.ok(Math.abs(result.x - 4) < 1e-10)
  assert.ok(Math.abs(result.y - 0) < 1e-10)
  assert.ok(Math.abs(result.z - 0) < 1e-10)
})

test('drag-math: projectRayToPlane — non-zero planeY', () => {
  // origin (0,5,0), direction (0,-1,0), planeY=2
  // t = (2-5)/-1 = 3 → hit.y = 5+3*(-1) = 2
  const result = projectRayToPlane({ origin: [0, 5, 0], direction: [0, -1, 0] }, 2)
  assert.ok(result !== null)
  assert.ok(Math.abs(result.y - 2) < 1e-10)
})

test('drag-math: projectRayToPlane — null when ray is horizontal (direction.y === 0)', () => {
  assert.strictEqual(
    projectRayToPlane({ origin: [0, 5, 0], direction: [1, 0, 0] }, 0),
    null,
  )
})

test('drag-math: projectRayToPlane — null when direction.y is within epsilon (< 1e-6)', () => {
  assert.strictEqual(
    projectRayToPlane({ origin: [0, 5, 0], direction: [1, 1e-7, 0] }, 0),
    null,
  )
})

test('drag-math: projectRayToPlane — null when t < 0 (plane behind ray)', () => {
  // origin at y=0, pointing up (+y), plane at y=-1 → t = (-1-0)/1 = -1 → null
  assert.strictEqual(
    projectRayToPlane({ origin: [0, 0, 0], direction: [0, 1, 0] }, -1),
    null,
  )
})

test('drag-math: projectRayToPlane — t === 0 is valid (origin exactly on plane)', () => {
  // origin at y=0, pointing down, planeY=0 → t=0, hit = origin
  const result = projectRayToPlane({ origin: [3, 0, 7], direction: [0, -1, 0] }, 0)
  assert.ok(result !== null)
  assert.ok(Math.abs(result.x - 3) < 1e-10)
  assert.ok(Math.abs(result.y - 0) < 1e-10)
  assert.ok(Math.abs(result.z - 7) < 1e-10)
})

// ---------------------------------------------------------------------------
// computeParentInverse
// ---------------------------------------------------------------------------

test('drag-math: computeParentInverse — null parent returns identity matrix', () => {
  const obj    = { parent: null }
  const result = computeParentInverse(obj)
  const identity = new THREE.Matrix4()
  // Compare element arrays
  result.elements.forEach((v, i) => {
    assert.ok(Math.abs(v - identity.elements[i]) < 1e-10,
      `element[${i}] should be ${identity.elements[i]}, got ${v}`)
  })
})

test('drag-math: computeParentInverse — translated parent: world pos maps to local correctly', () => {
  // Parent at world (3,0,0). World point (3,0,0) → local (0,0,0).
  const parent = { matrixWorld: new THREE.Matrix4().makeTranslation(3, 0, 0) }
  const inv    = computeParentInverse({ parent })
  const pt     = new THREE.Vector3(3, 0, 0).applyMatrix4(inv)
  assert.ok(Math.abs(pt.x) < 1e-10, 'x should be ~0')
  assert.ok(Math.abs(pt.y) < 1e-10, 'y should be ~0')
  assert.ok(Math.abs(pt.z) < 1e-10, 'z should be ~0')
})

test('drag-math: computeParentInverse — translated parent: world origin maps to negative offset', () => {
  // Parent at world (5,2,1). World (0,0,0) → local (-5,-2,-1).
  const parent = { matrixWorld: new THREE.Matrix4().makeTranslation(5, 2, 1) }
  const inv    = computeParentInverse({ parent })
  const pt     = new THREE.Vector3(0, 0, 0).applyMatrix4(inv)
  assert.ok(Math.abs(pt.x - (-5)) < 1e-10)
  assert.ok(Math.abs(pt.y - (-2)) < 1e-10)
  assert.ok(Math.abs(pt.z - (-1)) < 1e-10)
})

test('drag-math: computeParentInverse — rotated parent inverts correctly', () => {
  // Parent rotated 90° around Y-axis via makeRotationY(π/2).
  // The forward matrix transforms parent-local (1,0,0) → world (0,0,-1)
  // (the parent's local X-axis points toward world -Z).
  // The parent's local Z-axis (0,0,1) points toward world +X.
  // Therefore: world (1,0,0) is in the parent's local +Z direction → local (0,0,+1).
  const parent = { matrixWorld: new THREE.Matrix4().makeRotationY(Math.PI / 2) }
  const inv    = computeParentInverse({ parent })
  const pt     = new THREE.Vector3(1, 0, 0).applyMatrix4(inv)
  assert.ok(Math.abs(pt.x - 0) < 1e-6, `x expected ~0, got ${pt.x}`)
  assert.ok(Math.abs(pt.y - 0) < 1e-6, `y expected ~0, got ${pt.y}`)
  assert.ok(Math.abs(pt.z - 1) < 1e-6, `z expected ~+1, got ${pt.z}`)
})
