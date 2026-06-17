// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// THREE geometry classes (BufferGeometry, PlaneGeometry, CapsuleGeometry)
// work fine in Node.js and are used directly — no renderer required.

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import * as THREE from 'three'
import { threeGeometryToGltfPrimitive, buildAvatarDescriptor } from '../src/geometry-utils.js'

// ---------------------------------------------------------------------------
// 1. threeGeometryToGltfPrimitive — extracts position/normal/index arrays
// ---------------------------------------------------------------------------

test('threeGeometryToGltfPrimitive: extracts POSITION, NORMAL, indices from PlaneGeometry', () => {
  // PlaneGeometry(1,1): 4 vertices, 2 triangles → 12 positions, 12 normals, 6 indices
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }
  const prim = threeGeometryToGltfPrimitive(geo, mat)

  assert.ok(Array.isArray(prim.attributes.POSITION), 'POSITION is Array')
  assert.ok(Array.isArray(prim.attributes.NORMAL),   'NORMAL is Array')
  assert.ok(Array.isArray(prim.indices),             'indices is Array')

  assert.strictEqual(prim.attributes.POSITION.length, 12, '4 verts × 3 = 12 positions')
  assert.strictEqual(prim.attributes.NORMAL.length,   12, '4 verts × 3 = 12 normals')
  assert.strictEqual(prim.indices.length,              6, '2 tris × 3 = 6 indices')
})

// ---------------------------------------------------------------------------
// 2. threeGeometryToGltfPrimitive — disposes the input geometry
// ---------------------------------------------------------------------------

test('threeGeometryToGltfPrimitive: calls geometry.dispose() exactly once', () => {
  const geo = new THREE.PlaneGeometry(1, 1)
  let disposeCalls = 0
  const origDispose = geo.dispose.bind(geo)
  geo.dispose = () => { disposeCalls++; origDispose() }

  threeGeometryToGltfPrimitive(geo, {})

  assert.strictEqual(disposeCalls, 1, 'dispose called exactly once')
})

// ---------------------------------------------------------------------------
// 3. threeGeometryToGltfPrimitive — passes material through unchanged
// ---------------------------------------------------------------------------

test('threeGeometryToGltfPrimitive: material reference is passed through unchanged', () => {
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }
  const prim = threeGeometryToGltfPrimitive(geo, mat)

  assert.strictEqual(prim.material, mat, 'material === same reference')
})

// ---------------------------------------------------------------------------
// 4. buildAvatarDescriptor — returns expected shape
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: returns correct top-level shape', () => {
  const desc = buildAvatarDescriptor('Alice')

  assert.deepEqual(desc.translation, [0, 0.7, 0], 'translation = [0, 0.7, 0]')
  assert.strictEqual(desc.extras.displayName, 'Alice', 'extras.displayName = "Alice"')

  const prim = desc.mesh?.primitives?.[0]
  assert.ok(prim, 'mesh.primitives[0] exists')

  assert.ok(Array.isArray(prim.attributes.POSITION), 'POSITION is Array')
  assert.ok(Array.isArray(prim.attributes.NORMAL),   'NORMAL is Array')
  assert.ok(Array.isArray(prim.indices),             'indices is Array')

  const pbr = prim.material?.pbrMetallicRoughness
  assert.ok(pbr, 'pbrMetallicRoughness present')
  assert.ok(Array.isArray(pbr.baseColorFactor), 'baseColorFactor is Array')
  assert.strictEqual(typeof pbr.metallicFactor,  'number', 'metallicFactor is number')
  assert.strictEqual(typeof pbr.roughnessFactor, 'number', 'roughnessFactor is number')
})

// ---------------------------------------------------------------------------
// 5. buildAvatarDescriptor — produces a different color each call
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: baseColorFactor differs between two calls', () => {
  const a = buildAvatarDescriptor('A')
  const b = buildAvatarDescriptor('B')
  const colorA = a.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor
  const colorB = b.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor

  // Probability of exact match across 3 independent channels: negligible
  const same = colorA[0] === colorB[0] && colorA[1] === colorB[1] && colorA[2] === colorB[2]
  assert.ok(!same, 'baseColorFactor differs between two descriptor calls')
})

// ---------------------------------------------------------------------------
// 6. buildAvatarDescriptor — color channels in [0.5, 1.0]; alpha = 1
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: color channels in [0.5, 1.0] and alpha = 1', () => {
  const desc = buildAvatarDescriptor('Bob')
  const color = desc.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor

  for (let i = 0; i < 3; i++) {
    assert.ok(color[i] >= 0.5 && color[i] <= 1.0, `channel ${i} in [0.5, 1.0]`)
  }
  assert.strictEqual(color[3], 1, 'alpha = 1')
})

// ---------------------------------------------------------------------------
// 7. buildAvatarDescriptor — top-level `name` field is absent
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: top-level name field is undefined (intentional omission)', () => {
  const desc = buildAvatarDescriptor('Carol')
  assert.strictEqual(desc.name, undefined, 'name field absent from descriptor')
})
