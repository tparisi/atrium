// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { NodeIO } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

async function loadSOM() {
  const io = new NodeIO()
  const document = await io.read(FIXTURE)
  return new SOMDocument(document)
}

// ---------------------------------------------------------------------------
// SOMDocument / SOMScene
// ---------------------------------------------------------------------------

test('som — scene exists and has children', async () => {
  const som = await loadSOM()
  assert.ok(som.scene)
  assert.ok(som.scene.children.length > 0)
})

test('som — document collections', async () => {
  const som = await loadSOM()
  assert.ok(som.nodes.length > 0)
  assert.ok(som.meshes.length > 0)
  assert.ok(som.materials.length > 0)
})

// ---------------------------------------------------------------------------
// SOMNode — lookup
// ---------------------------------------------------------------------------

test('som — getNodeByName finds crate-01', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  assert.ok(crate)
  assert.strictEqual(crate.name, 'crate-01')
})

test('som — getNodeByName returns null for unknown node', async () => {
  const som = await loadSOM()
  assert.strictEqual(som.getNodeByName('no-such-node'), null)
})

// ---------------------------------------------------------------------------
// SOMNode — properties
// ---------------------------------------------------------------------------

test('som — node translation read/write', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  crate.translation = [1, 2, 3]
  assert.deepEqual([...crate.translation], [1, 2, 3])
})

test('som — node rotation read/write', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  crate.rotation = [0, 0, 0, 1]
  assert.deepEqual([...crate.rotation], [0, 0, 0, 1])
})

test('som — node scale read/write', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  crate.scale = [2, 2, 2]
  assert.deepEqual([...crate.scale], [2, 2, 2])
})

test('som — node visible defaults to true', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  assert.strictEqual(crate.visible, true)
})

test('som — node visible read/write', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  crate.visible = false
  assert.strictEqual(crate.visible, false)
  crate.visible = true
  assert.strictEqual(crate.visible, true)
})

// ---------------------------------------------------------------------------
// SOMMesh / SOMPrimitive / SOMMaterial
// ---------------------------------------------------------------------------

test('som — crate-01 has a mesh', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  assert.ok(crate.mesh)
})

test('som — mesh has primitives', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  assert.ok(crate.mesh.primitives.length > 0)
})

test('som — primitive has a material', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  assert.ok(crate.mesh.primitives[0].material)
})

test('som — material baseColorFactor read/write', async () => {
  const som = await loadSOM()
  const mat = som.getNodeByName('crate-01').mesh.primitives[0].material
  mat.baseColorFactor = [0, 1, 0, 1]
  assert.deepEqual([...mat.baseColorFactor], [0, 1, 0, 1])
})

test('som — material roughnessFactor read/write', async () => {
  const som = await loadSOM()
  const mat = som.getNodeByName('crate-01').mesh.primitives[0].material
  mat.roughnessFactor = 0.5
  assert.strictEqual(mat.roughnessFactor, 0.5)
})

// ---------------------------------------------------------------------------
// SOMDocument — factories
// ---------------------------------------------------------------------------

test('som — createNode with descriptor', async () => {
  const som = await loadSOM()
  const node = som.createNode({ name: 'test-node', translation: [5, 0, 0] })
  assert.strictEqual(node.name, 'test-node')
  assert.deepEqual([...node.translation], [5, 0, 0])
})

test('som — scene.addChild / scene.children', async () => {
  const som = await loadSOM()
  const before = som.scene.children.length
  const node = som.createNode({ name: 'added-node' })
  som.scene.addChild(node)
  assert.strictEqual(som.scene.children.length, before + 1)
})

// ---------------------------------------------------------------------------
// path resolution (via SOMDocument instance methods)
// ---------------------------------------------------------------------------

test('path-resolver — setPath / getPath simple property', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  som.setPath(crate, 'translation', [9, 8, 7])
  assert.deepEqual([...som.getPath(crate, 'translation')], [9, 8, 7])
})

test('path-resolver — setPath / getPath deep path', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  som.setPath(crate, 'mesh.primitives[0].material.baseColorFactor', [1, 0, 0, 1])
  assert.deepEqual([...som.getPath(crate, 'mesh.primitives[0].material.baseColorFactor')], [1, 0, 0, 1])
})

test('path-resolver — setPath throws on unknown property', async () => {
  const som = await loadSOM()
  const crate = som.getNodeByName('crate-01')
  assert.throws(() => som.setPath(crate, 'color', 'red'), /Unknown property/)
})
