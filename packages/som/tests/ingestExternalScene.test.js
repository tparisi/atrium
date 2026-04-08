// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a world SOMDocument with one container node. */
function makeWorldSom(containerName, sourceExtras = {}) {
  const doc   = new Document()
  const scene = doc.createScene('Scene')
  const node  = doc.createNode(containerName).setExtras({ atrium: { source: './fake.gltf', ...sourceExtras } })
  scene.addChild(node)
  return new SOMDocument(doc)
}

/** Build a minimal external Document with one root node (no mesh). */
function makeExternalDoc(rootNodeName, childNames = []) {
  const doc   = new Document()
  const scene = doc.createScene('ExtScene')
  const root  = doc.createNode(rootNodeName)
  scene.addChild(root)
  for (const name of childNames) root.addChild(doc.createNode(name))
  // Add document-level extras that must NOT be copied to the world
  doc.getRoot().setExtras({ atrium: { world: { name: 'External World' } } })
  return doc
}

/** Build an external Document with a root node that has a mesh + material. */
function makeExternalDocWithMesh(rootNodeName) {
  const doc    = new Document()
  const scene  = doc.createScene('ExtScene')
  const buf    = doc.createBuffer()
  const mat    = doc.createMaterial('ExtMat')
    .setBaseColorFactor([0.2, 0.8, 0.2, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
  const posAcc = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0,0,0, 1,0,0, 0,1,0]))
    .setBuffer(buf)
  const idxAcc = doc.createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array([0,1,2]))
    .setBuffer(buf)
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setIndices(idxAcc)
    .setMaterial(mat)
  const mesh = doc.createMesh('ExtMesh').addPrimitive(prim)
  const node = doc.createNode(rootNodeName).setMesh(mesh)
  scene.addChild(node)
  return doc
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('ingestExternalScene: single node — prefixed name, parent-child, mesh present', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDocWithMesh('Crate')

  const added = som.ingestExternalScene('Crate', extDoc)

  assert.equal(added.length, 1, 'one top-level node returned')
  const ingested = added[0]
  assert.equal(ingested.name, 'Crate/Crate', 'name is containerName/originalName')
  assert.ok(ingested.mesh, 'mesh is present on ingested node')
  assert.ok(ingested.mesh.primitives.length > 0, 'mesh has at least one primitive')
})

test('ingestExternalScene: ingested node is a child of the container', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDocWithMesh('Crate')

  som.ingestExternalScene('Crate', extDoc)

  const container = som.getNodeByName('Crate')
  assert.ok(container, 'container node exists')
  const children = container.children
  assert.equal(children.length, 1, 'container has one child')
  assert.equal(children[0].name, 'Crate/Crate')
})

test('ingestExternalScene: getNodeByName returns ingested prefixed nodes', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDocWithMesh('Crate')

  som.ingestExternalScene('Crate', extDoc)

  assert.ok(som.getNodeByName('Crate/Crate'), 'getNodeByName finds Crate/Crate')
  assert.equal(som.getNodeByName('Crate'), som.getNodeByName('Crate'), 'container still found')
})

test('ingestExternalScene: multi-level hierarchy — all names recursively prefixed', () => {
  const som    = makeWorldSom('Container')
  const extDoc = makeExternalDoc('Parent', ['Child'])

  som.ingestExternalScene('Container', extDoc)

  assert.ok(som.getNodeByName('Container/Parent'),       'Container/Parent exists')
  assert.ok(som.getNodeByName('Container/Parent/Child'), 'Container/Parent/Child exists')

  const parent = som.getNodeByName('Container/Parent')
  assert.equal(parent.children.length, 1)
  assert.equal(parent.children[0].name, 'Container/Parent/Child')
})

test('ingestExternalScene: two containers — no name collisions', () => {
  const doc      = new Document()
  const scene    = doc.createScene('Scene')
  const nodeA    = doc.createNode('A').setExtras({ atrium: { source: './a.gltf' } })
  const nodeB    = doc.createNode('B').setExtras({ atrium: { source: './b.gltf' } })
  scene.addChild(nodeA)
  scene.addChild(nodeB)
  const som = new SOMDocument(doc)

  const extA = makeExternalDoc('Node')
  const extB = makeExternalDoc('Node')

  som.ingestExternalScene('A', extA)
  som.ingestExternalScene('B', extB)

  assert.ok(som.getNodeByName('A/Node'), 'A/Node exists')
  assert.ok(som.getNodeByName('B/Node'), 'B/Node exists')
  assert.notEqual(som.getNodeByName('A/Node'), som.getNodeByName('B/Node'), 'different SOM instances')
})

test('ingestExternalScene: container extras.atrium.source preserved, external root extras discarded', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDoc('Crate')
  // extDoc root extras include atrium.world — these must NOT appear on the world doc
  extDoc.getRoot().setExtras({ atrium: { world: { name: 'Should Not Appear' } } })

  som.ingestExternalScene('Crate', extDoc)

  // Container keeps its original extras
  const container = som.getNodeByName('Crate')
  assert.equal(container.extras?.atrium?.source, './fake.gltf', 'container source preserved')

  // World document root extras are unchanged
  const worldExtras = som.document.getRoot().getExtras()
  assert.ok(!worldExtras?.atrium?.world, 'external world metadata not injected into world doc')
})

test('ingestExternalScene: mutation event fires on container node', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDoc('Crate')

  const container = som.getNodeByName('Crate')
  let mutationFired = false
  container.addEventListener('mutation', (evt) => {
    if (evt.detail?.childList?.addedNodes) mutationFired = true
  })

  som.ingestExternalScene('Crate', extDoc)

  assert.ok(mutationFired, 'mutation event fired on container node')
})

test('ingestExternalScene: throws when container node does not exist', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDoc('Node')

  assert.throws(
    () => som.ingestExternalScene('DoesNotExist', extDoc),
    /Container node "DoesNotExist" not found/,
    'throws with descriptive message'
  )
})

test('ingestExternalScene: empty external scene returns empty array', () => {
  const som = makeWorldSom('Crate')

  // External doc with scene but no nodes
  const extDoc  = new Document()
  extDoc.createScene('EmptyScene')

  const result = som.ingestExternalScene('Crate', extDoc)
  assert.deepEqual(result, [], 'returns empty array for empty scene')
})

test('ingestExternalScene: material is copied with correct properties', () => {
  const som    = makeWorldSom('Crate')
  const extDoc = makeExternalDocWithMesh('Crate')

  som.ingestExternalScene('Crate', extDoc)

  const ingested = som.getNodeByName('Crate/Crate')
  const mat = ingested.mesh?.primitives?.[0]?.material
  assert.ok(mat, 'material present on ingested primitive')

  const bcf = mat.baseColorFactor
  assert.ok(bcf, 'baseColorFactor present')
  assert.ok(Math.abs(bcf[0] - 0.2) < 0.001, 'R channel ~0.2')
  assert.ok(Math.abs(bcf[1] - 0.8) < 0.001, 'G channel ~0.8')
})
