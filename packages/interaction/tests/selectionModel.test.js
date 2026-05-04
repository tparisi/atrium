// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  nearestNonMeshAncestor,
  leafOnly,
  resolveSelectionRoot,
} from '../src/selectionModel.js'

// ---------------------------------------------------------------------------
// Minimal SOMNode stub — only the fields the selection model reads:
//   node.mesh   → object (truthy) | null
//   node.parent → SOMNode | null
// ---------------------------------------------------------------------------

function makeNode(name, { mesh = null, parent = null } = {}) {
  return { name, mesh, parent }
}

// Build a small tree bottom-up.
//
// In the real SOM, SOMNode.parent returns null when the underlying glTF Node's
// parent is a Scene (not a Node). So top-level nodes always have parent===null.
// Stubs mirror this: top-level nodes are direct children of the scene boundary
// and carry parent: null.

// scene boundary → lamp-01 (no mesh) → lamp-shade (mesh)
function makeLampTree() {
  const lamp      = makeNode('lamp-01',    { mesh: null, parent: null })
  const lampShade = makeNode('lamp-shade', { mesh: {},   parent: lamp  })
  return { lamp, lampShade }
}

// scene boundary → crate-01 (orphan mesh, top-level)
function makeOrphanMeshTree() {
  const crate = makeNode('crate-01', { mesh: {}, parent: null })
  return { crate }
}

// scene boundary → chair (no mesh) → cushion-group (no mesh) → cushion-mesh (mesh)
function makeDeepTree() {
  const chair        = makeNode('chair',         { mesh: null, parent: null })
  const cushionGroup = makeNode('cushion-group', { mesh: null, parent: chair })
  const cushionMesh  = makeNode('cushion-mesh',  { mesh: {},   parent: cushionGroup })
  return { chair, cushionGroup, cushionMesh }
}

// scene boundary → empty-pivot (no mesh, top-level)
function makeEmptyPivotTree() {
  const emptyPivot = makeNode('empty-pivot', { mesh: null, parent: null })
  return { emptyPivot }
}

// scene boundary → building (mesh) → sign (mesh)
function makeMeshWithMeshChildrenTree() {
  const building = makeNode('building', { mesh: {},   parent: null })
  const sign     = makeNode('sign',     { mesh: {},   parent: building })
  return { building, sign }
}

// ---------------------------------------------------------------------------
// Tests: nearestNonMeshAncestor
// ---------------------------------------------------------------------------

describe('nearestNonMeshAncestor', () => {
  it('lamp case — resolves shade to lamp-01', () => {
    const { lamp, lampShade } = makeLampTree()
    assert.equal(nearestNonMeshAncestor(lampShade), lamp)
  })

  it('orphan mesh — resolves crate to itself', () => {
    const { crate } = makeOrphanMeshTree()
    assert.equal(nearestNonMeshAncestor(crate), crate)
  })

  it('deeply nested — resolves cushion-mesh to cushion-group, not chair', () => {
    const { cushionGroup, cushionMesh } = makeDeepTree()
    assert.equal(nearestNonMeshAncestor(cushionMesh), cushionGroup)
  })

  it('empty transform — resolves empty-pivot to itself (no mesh ancestor before scene)', () => {
    const { emptyPivot } = makeEmptyPivotTree()
    assert.equal(nearestNonMeshAncestor(emptyPivot), emptyPivot)
  })

  it('mesh with mesh children — sign resolves to itself (building has mesh, not a group root)', () => {
    const { sign } = makeMeshWithMeshChildrenTree()
    assert.equal(nearestNonMeshAncestor(sign), sign)
  })
})

// ---------------------------------------------------------------------------
// Tests: leafOnly
// ---------------------------------------------------------------------------

describe('leafOnly', () => {
  it('returns input node unchanged regardless of tree shape', () => {
    const { lampShade }    = makeLampTree()
    const { crate }        = makeOrphanMeshTree()
    const { cushionMesh }  = makeDeepTree()
    const { emptyPivot }   = makeEmptyPivotTree()
    const { sign }         = makeMeshWithMeshChildrenTree()

    assert.equal(leafOnly(lampShade),   lampShade)
    assert.equal(leafOnly(crate),       crate)
    assert.equal(leafOnly(cushionMesh), cushionMesh)
    assert.equal(leafOnly(emptyPivot),  emptyPivot)
    assert.equal(leafOnly(sign),        sign)
  })
})

// ---------------------------------------------------------------------------
// Tests: resolveSelectionRoot
// ---------------------------------------------------------------------------

describe('resolveSelectionRoot', () => {
  it('default (no opts) matches nearestNonMeshAncestor', () => {
    const { lamp, lampShade } = makeLampTree()
    assert.equal(resolveSelectionRoot(lampShade), lamp)
  })

  it('descend: true returns leaf (Alt-click escape)', () => {
    const { lampShade } = makeLampTree()
    assert.equal(resolveSelectionRoot(lampShade, { descend: true }), lampShade)
  })

  it('explicit policy: leafOnly matches leafOnly', () => {
    const { lampShade } = makeLampTree()
    assert.equal(resolveSelectionRoot(lampShade, { policy: leafOnly }), lampShade)
  })
})
