// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { NodeIO, Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'
import { SOMObject }   from '../src/SOMObject.js'
import { SOMEvent }    from '../src/SOMEvent.js'

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

// ---------------------------------------------------------------------------
// SOMObject / SOMEvent — event listener API
// ---------------------------------------------------------------------------

test('som-object — addEventListener / _dispatchEvent calls callback', () => {
  const obj  = new SOMObject()
  let called = false
  obj.addEventListener('test', () => { called = true })
  obj._dispatchEvent(new SOMEvent('test', {}))
  assert.strictEqual(called, true)
})

test('som-object — multiple listeners on same type all fire', () => {
  const obj  = new SOMObject()
  let count  = 0
  obj.addEventListener('test', () => count++)
  obj.addEventListener('test', () => count++)
  obj._dispatchEvent(new SOMEvent('test', {}))
  assert.strictEqual(count, 2)
})

test('som-object — removeEventListener removes specific callback; others still fire', () => {
  const obj  = new SOMObject()
  let count  = 0
  const fn1  = () => count++
  const fn2  = () => count++
  obj.addEventListener('test', fn1)
  obj.addEventListener('test', fn2)
  obj.removeEventListener('test', fn1)
  obj._dispatchEvent(new SOMEvent('test', {}))
  assert.strictEqual(count, 1)
})

test('som-object — removeEventListener on never-added listener is a no-op', () => {
  const obj = new SOMObject()
  assert.doesNotThrow(() => obj.removeEventListener('test', () => {}))
})

test('som-object — _hasListeners returns false, true, false across add/remove', () => {
  const obj = new SOMObject()
  const fn  = () => {}
  assert.strictEqual(obj._hasListeners('test'), false)
  obj.addEventListener('test', fn)
  assert.strictEqual(obj._hasListeners('test'), true)
  obj.removeEventListener('test', fn)
  assert.strictEqual(obj._hasListeners('test'), false)
})

test('som-object — SOMEvent carries correct type, target, detail', () => {
  const target = new SOMObject()
  const evt    = new SOMEvent('mutation', { target, property: 'foo', value: 42 })
  assert.strictEqual(evt.type, 'mutation')
  assert.strictEqual(evt.target, target)
  assert.strictEqual(evt.detail.property, 'foo')
  assert.strictEqual(evt.detail.value, 42)
})

// ---------------------------------------------------------------------------
// Wrapper caching — identity
// ---------------------------------------------------------------------------

test('wrapper-identity — getNodeByName returns same instance on repeated calls', async () => {
  const som = await loadSOM()
  assert.strictEqual(som.getNodeByName('crate-01'), som.getNodeByName('crate-01'))
})

test('wrapper-identity — node.mesh returns same instance on repeated calls', async () => {
  const som  = await loadSOM()
  const node = som.getNodeByName('crate-01')
  assert.strictEqual(node.mesh, node.mesh)
})

test('wrapper-identity — mesh.primitives[0] returns same instance on repeated calls', async () => {
  const som  = await loadSOM()
  const node = som.getNodeByName('crate-01')
  assert.strictEqual(node.mesh.primitives[0], node.mesh.primitives[0])
})

test('wrapper-identity — primitive.material returns same instance on repeated calls', async () => {
  const som  = await loadSOM()
  const node = som.getNodeByName('crate-01')
  assert.strictEqual(node.mesh.primitives[0].material, node.mesh.primitives[0].material)
})

test('wrapper-identity — som.nodes returns same instances on repeated calls', async () => {
  const som    = await loadSOM()
  const first  = som.nodes
  const second = som.nodes
  assert.strictEqual(first.length, second.length)
  for (let i = 0; i < first.length; i++) {
    assert.strictEqual(first[i], second[i], `nodes[${i}] should be same instance`)
  }
})

test('wrapper-identity — node.mesh = newMesh then node.mesh === newMesh', async () => {
  const som     = await loadSOM()
  const node    = som.getNodeByName('crate-01')
  const newMesh = som.createMesh({ name: 'new-mesh' })
  node.mesh     = newMesh
  assert.strictEqual(node.mesh, newMesh)
})

test('wrapper-identity — node.mesh = null then node.mesh === null', async () => {
  const som  = await loadSOM()
  const node = som.getNodeByName('crate-01')
  node.mesh  = null
  assert.strictEqual(node.mesh, null)
})

// ---------------------------------------------------------------------------
// Mutation events — property changes
// ---------------------------------------------------------------------------

// Helper to build a minimal in-memory SOMDocument (no file I/O)
function makeSOM() {
  const doc  = new Document()
  const root = doc.getRoot()
  const mat  = doc.createMaterial('mat')
  mat.setBaseColorFactor([1, 1, 1, 1])
  const prim = doc.createPrimitive().setMaterial(mat)
  const mesh = doc.createMesh('Crate').addPrimitive(prim)
  const cam  = doc.createCamera('Cam').setType('perspective')
  const node = doc.createNode('Crate').setMesh(mesh).setCamera(cam)
  doc.createScene('Scene').addChild(node)
  return new SOMDocument(doc)
}

function expectMutationEvent(obj, expectedProperty, action) {
  let event = null
  const fn  = (e) => { event = e }
  obj.addEventListener('mutation', fn)
  action()
  obj.removeEventListener('mutation', fn)
  assert.ok(event !== null, `mutation event fired for "${expectedProperty}"`)
  assert.strictEqual(event.type, 'mutation', 'event.type === "mutation"')
  assert.strictEqual(event.target, obj, 'event.target is the SOM object')
  assert.strictEqual(event.detail.property, expectedProperty, `event.detail.property === "${expectedProperty}"`)
  return event
}

// SOMNode setters
test('mutation — SOMNode.translation fires mutation event', () => {
  const som  = makeSOM()
  const node = som.getNodeByName('Crate')
  const evt  = expectMutationEvent(node, 'translation', () => { node.translation = [1, 2, 3] })
  assert.deepEqual(evt.detail.value, [1, 2, 3])
  assert.deepEqual([...node.translation], [1, 2, 3], 'underlying glTF-Transform updated')
})

test('mutation — SOMNode.rotation fires mutation event', () => {
  const som  = makeSOM()
  const node = som.getNodeByName('Crate')
  expectMutationEvent(node, 'rotation', () => { node.rotation = [0, 0, 0, 1] })
  assert.deepEqual([...node.rotation], [0, 0, 0, 1])
})

test('mutation — SOMNode.scale fires mutation event', () => {
  const som  = makeSOM()
  const node = som.getNodeByName('Crate')
  expectMutationEvent(node, 'scale', () => { node.scale = [2, 2, 2] })
  assert.deepEqual([...node.scale], [2, 2, 2])
})

test('mutation — SOMNode.name fires mutation event', () => {
  const som  = makeSOM()
  const node = som.getNodeByName('Crate')
  expectMutationEvent(node, 'name', () => { node.name = 'NewName' })
  assert.strictEqual(node.name, 'NewName')
})

test('mutation — SOMNode.visible fires mutation event', () => {
  const som  = makeSOM()
  const node = som.getNodeByName('Crate')
  expectMutationEvent(node, 'visible', () => { node.visible = false })
  assert.strictEqual(node.visible, false)
})

// SOMMaterial setters
test('mutation — SOMMaterial.baseColorFactor fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  const evt = expectMutationEvent(mat, 'baseColorFactor', () => { mat.baseColorFactor = [1, 0, 0, 1] })
  assert.deepEqual(evt.detail.value, [1, 0, 0, 1])
  assert.deepEqual([...mat.baseColorFactor], [1, 0, 0, 1])
})

test('mutation — SOMMaterial.metallicFactor fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  expectMutationEvent(mat, 'metallicFactor', () => { mat.metallicFactor = 0.5 })
  assert.strictEqual(mat.metallicFactor, 0.5)
})

test('mutation — SOMMaterial.roughnessFactor fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  expectMutationEvent(mat, 'roughnessFactor', () => { mat.roughnessFactor = 0.3 })
  assert.strictEqual(mat.roughnessFactor, 0.3)
})

test('mutation — SOMMaterial.emissiveFactor fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  expectMutationEvent(mat, 'emissiveFactor', () => { mat.emissiveFactor = [0.1, 0.1, 0.1] })
})

test('mutation — SOMMaterial.alphaMode fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  expectMutationEvent(mat, 'alphaMode', () => { mat.alphaMode = 'MASK' })
  assert.strictEqual(mat.alphaMode, 'MASK')
})

test('mutation — SOMMaterial.alphaCutoff fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  expectMutationEvent(mat, 'alphaCutoff', () => { mat.alphaCutoff = 0.5 })
})

test('mutation — SOMMaterial.doubleSided fires mutation event', () => {
  const som = makeSOM()
  const mat = som.getNodeByName('Crate').mesh.primitives[0].material
  expectMutationEvent(mat, 'doubleSided', () => { mat.doubleSided = true })
  assert.strictEqual(mat.doubleSided, true)
})

// SOMCamera setters
test('mutation — SOMCamera.type fires mutation event', () => {
  const som = makeSOM()
  const cam = som.getNodeByName('Crate').camera
  expectMutationEvent(cam, 'type', () => { cam.type = 'orthographic' })
  assert.strictEqual(cam.type, 'orthographic')
})

test('mutation — SOMCamera.yfov fires mutation event', () => {
  const som = makeSOM()
  const cam = som.getNodeByName('Crate').camera
  expectMutationEvent(cam, 'yfov', () => { cam.yfov = 1.0 })
  assert.strictEqual(cam.yfov, 1.0)
})

test('mutation — SOMCamera.znear fires mutation event', () => {
  const som = makeSOM()
  const cam = som.getNodeByName('Crate').camera
  expectMutationEvent(cam, 'znear', () => { cam.znear = 0.1 })
})

test('mutation — SOMCamera.zfar fires mutation event', () => {
  const som = makeSOM()
  const cam = som.getNodeByName('Crate').camera
  expectMutationEvent(cam, 'zfar', () => { cam.zfar = 500 })
})

test('mutation — SOMCamera.xmag fires mutation event', () => {
  const som = makeSOM()
  const cam = som.getNodeByName('Crate').camera
  expectMutationEvent(cam, 'xmag', () => { cam.xmag = 2 })
})

test('mutation — SOMCamera.ymag fires mutation event', () => {
  const som = makeSOM()
  const cam = som.getNodeByName('Crate').camera
  expectMutationEvent(cam, 'ymag', () => { cam.ymag = 2 })
})

// SOMMesh setters
test('mutation — SOMMesh.name fires mutation event', () => {
  const som  = makeSOM()
  const mesh = som.getNodeByName('Crate').mesh
  expectMutationEvent(mesh, 'name', () => { mesh.name = 'NewMesh' })
  assert.strictEqual(mesh.name, 'NewMesh')
})

test('mutation — SOMMesh.weights fires mutation event', () => {
  const som  = makeSOM()
  const mesh = som.getNodeByName('Crate').mesh
  expectMutationEvent(mesh, 'weights', () => { mesh.weights = [0.5] })
})

// SOMPrimitive setters
test('mutation — SOMPrimitive.mode fires mutation event', () => {
  const som  = makeSOM()
  const prim = som.getNodeByName('Crate').mesh.primitives[0]
  expectMutationEvent(prim, 'mode', () => { prim.mode = 4 })
  assert.strictEqual(prim.mode, 4)
})

test('mutation — SOMPrimitive.material fires mutation event', () => {
  const som  = makeSOM()
  const prim = som.getNodeByName('Crate').mesh.primitives[0]
  const newMat = som.createMaterial({ name: 'newMat' })
  expectMutationEvent(prim, 'material', () => { prim.material = newMat })
  assert.strictEqual(prim.material, newMat)
})

// SOMAnimation setters
test('mutation — SOMAnimation.loop fires mutation event', async () => {
  const som  = await loadSOM()
  const anims = som.animations
  if (anims.length === 0) return   // fixture may have no animations; skip gracefully
  const anim = anims[0]
  expectMutationEvent(anim, 'loop', () => { anim.loop = true })
  assert.strictEqual(anim.loop, true)
})

test('mutation — SOMAnimation.timeScale fires mutation event', async () => {
  const som  = await loadSOM()
  const anims = som.animations
  if (anims.length === 0) return   // fixture may have no animations; skip gracefully
  const anim = anims[0]
  expectMutationEvent(anim, 'timeScale', () => { anim.timeScale = 2.0 })
  assert.strictEqual(anim.timeScale, 2.0)
})

// ---------------------------------------------------------------------------
// Mutation events — child list changes
// ---------------------------------------------------------------------------

test('mutation — SOMNode.addChild fires childList event with addedNodes', () => {
  const som    = makeSOM()
  const parent = som.getNodeByName('Crate')
  const child  = som.createNode({ name: 'Child' })
  let event    = null
  parent.addEventListener('mutation', (e) => { event = e })
  parent.addChild(child)
  assert.ok(event !== null, 'mutation event fired')
  assert.ok(Array.isArray(event.detail.childList?.addedNodes), 'childList.addedNodes is array')
  assert.strictEqual(event.detail.childList.addedNodes[0], 'Child')
})

test('mutation — SOMNode.removeChild fires childList event with removedNodes', () => {
  const som    = makeSOM()
  const parent = som.getNodeByName('Crate')
  const child  = som.createNode({ name: 'Child' })
  parent.addChild(child)
  let event = null
  parent.addEventListener('mutation', (e) => { event = e })
  parent.removeChild(child)
  assert.ok(event !== null)
  assert.ok(Array.isArray(event.detail.childList?.removedNodes))
})

test('mutation — SOMScene.addChild fires childList event', async () => {
  const som   = await loadSOM()
  const scene = som.scene
  const node  = som.createNode({ name: 'NewNode' })
  let event   = null
  scene.addEventListener('mutation', (e) => { event = e })
  scene.addChild(node)
  assert.ok(event !== null)
  assert.ok(Array.isArray(event.detail.childList?.addedNodes))
})

test('mutation — SOMScene.removeChild fires childList event', async () => {
  const som   = await loadSOM()
  const scene = som.scene
  const node  = som.createNode({ name: 'TempNode' })
  scene.addChild(node)
  let event = null
  scene.addEventListener('mutation', (e) => { event = e })
  scene.removeChild(node)
  assert.ok(event !== null)
  assert.ok(Array.isArray(event.detail.childList?.removedNodes))
})

test('mutation — SOMMesh.addPrimitive fires childList event', () => {
  const som  = makeSOM()
  const mesh = som.getNodeByName('Crate').mesh
  const prim = som.createPrimitive()
  let event  = null
  mesh.addEventListener('mutation', (e) => { event = e })
  mesh.addPrimitive(prim)
  assert.ok(event !== null)
  assert.ok(Array.isArray(event.detail.childList?.addedNodes))
})

test('mutation — SOMMesh.removePrimitive fires childList event', () => {
  const som    = makeSOM()
  const mesh   = som.getNodeByName('Crate').mesh
  const prim   = mesh.primitives[0]
  let event    = null
  mesh.addEventListener('mutation', (e) => { event = e })
  mesh.removePrimitive(prim)
  assert.ok(event !== null)
  assert.ok(Array.isArray(event.detail.childList?.removedNodes))
})

// ---------------------------------------------------------------------------
// No event when no listeners
// ---------------------------------------------------------------------------

test('mutation — no error when setter fires with no listeners', () => {
  const som  = makeSOM()
  const node = som.getNodeByName('Crate')
  assert.doesNotThrow(() => { node.translation = [1, 1, 1] })
})
