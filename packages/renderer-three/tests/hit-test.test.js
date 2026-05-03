// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import { walkUpToSOMNode } from '../src/hit-test.js'

// ---------------------------------------------------------------------------
// Test helpers — plain mock Object3Ds (no Three.js required)
// ---------------------------------------------------------------------------

/** Minimal mock Object3D: only .name and .parent needed. */
function mockObj(name, parent = null) { return { name, parent } }

const somA = { name: 'NodeA' }
const somB = { name: 'NodeB' }

function lookup(name) {
  if (name === 'NodeA') return somA
  if (name === 'NodeB') return somB
  return null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('walkUpToSOMNode: leaf is directly a named SOM node', () => {
  const obj    = mockObj('NodeA')
  const result = walkUpToSOMNode(obj, lookup)
  assert.strictEqual(result?.somNode, somA)
  assert.strictEqual(result?.threeObj, obj)
})

test('walkUpToSOMNode: unnamed leaf, named parent matches', () => {
  const parent = mockObj('NodeB')
  const leaf   = mockObj('', parent)
  const result = walkUpToSOMNode(leaf, lookup)
  assert.strictEqual(result?.somNode, somB)
  assert.strictEqual(result?.threeObj, parent)
})

test('walkUpToSOMNode: named leaf not in SOM, parent matches', () => {
  const parent = mockObj('NodeA')
  const leaf   = mockObj('UnknownMesh', parent)
  const result = walkUpToSOMNode(leaf, lookup)
  assert.strictEqual(result?.somNode, somA)
  assert.strictEqual(result?.threeObj, parent)
})

test('walkUpToSOMNode: multi-level hierarchy — finds match at grandparent', () => {
  const grandparent = mockObj('NodeB')
  const parent      = mockObj('UnknownParent', grandparent)
  const leaf        = mockObj('UnknownMesh', parent)
  const result      = walkUpToSOMNode(leaf, lookup)
  assert.strictEqual(result?.somNode, somB)
  assert.strictEqual(result?.threeObj, grandparent)
})

test('walkUpToSOMNode: no matching node anywhere in hierarchy — returns null', () => {
  const grandparent = mockObj('Root')
  const parent      = mockObj('Bone', grandparent)
  const leaf        = mockObj('Mesh', parent)
  assert.strictEqual(walkUpToSOMNode(leaf, lookup), null)
})

test('walkUpToSOMNode: entire chain has no names — returns null', () => {
  const parent = mockObj('', null)
  const leaf   = mockObj('', parent)
  assert.strictEqual(walkUpToSOMNode(leaf, lookup), null)
})

test('walkUpToSOMNode: single nameless node with null parent — returns null', () => {
  assert.strictEqual(walkUpToSOMNode(mockObj('', null), lookup), null)
})

test('walkUpToSOMNode: first match wins (leaf name takes priority over parent)', () => {
  const parent = mockObj('NodeB')
  const leaf   = mockObj('NodeA', parent)   // both match; leaf wins
  const result = walkUpToSOMNode(leaf, lookup)
  assert.strictEqual(result?.somNode, somA)   // NodeA, not NodeB
  assert.strictEqual(result?.threeObj, leaf)
})
