// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test }   from 'node:test'
import assert     from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'
import { SOMCamera }   from '../src/SOMCamera.js'
import { SOMObject }   from '../src/SOMObject.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Document with one perspective camera on node "MainCamera" (same-name collision). */
function makeOneCameraDoc() {
  const doc   = new Document()
  const scene = doc.createScene('Scene')

  const cam  = doc.createCamera('MainCamera').setType('perspective')
    .setYFov(0.8).setZNear(0.1).setZFar(100).setAspectRatio(1.777)
  const node = doc.createNode('MainCamera').setCamera(cam)
  scene.addChild(node)

  return new SOMDocument(doc)
}

/** Build a Document with two cameras (perspective + orthographic) and one plain node. */
function makeTwoCameraDoc() {
  const doc   = new Document()
  const scene = doc.createScene('Scene')

  const mainCam = doc.createCamera('MainCamera').setType('perspective')
    .setYFov(0.8).setZNear(0.1).setZFar(100).setAspectRatio(1.777)
  const orthoCam = doc.createCamera('OrthoCamera').setType('orthographic')
    .setXMag(5).setYMag(3).setZNear(0.1).setZFar(100)

  scene.addChild(doc.createNode('MainCamera').setCamera(mainCam))
  scene.addChild(doc.createNode('OrthoCamera').setCamera(orthoCam))
  scene.addChild(doc.createNode('Crate'))

  return new SOMDocument(doc)
}

/** Make a bare SOMCamera wrapping a test-double Camera (for property/mutation tests). */
function makeBareCamera({ name = 'TestCam', type = 'perspective', yfov = 1.0, znear = 0.1, zfar = 100 } = {}) {
  const doc = new Document()
  const cam = doc.createCamera(name)
    .setType(type)
    .setYFov(yfov)
    .setZNear(znear)
    .setZFar(zfar)
  return new SOMCamera(cam)
}

// ---------------------------------------------------------------------------
// SOMCamera construction
// ---------------------------------------------------------------------------

test('SOMCamera: wraps a glTF-Transform Camera', () => {
  const cam = makeBareCamera()
  assert.ok(cam._camera != null)
})

test('SOMCamera: name getter returns the camera glTF name', () => {
  const cam = makeBareCamera({ name: 'MyCamera' })
  assert.strictEqual(cam.name, 'MyCamera')
})

test('SOMCamera: extends SOMObject', () => {
  const cam = makeBareCamera()
  assert.ok(cam instanceof SOMObject)
})

test('SOMCamera: _qualifiedName is null before SOMDocument wires it', () => {
  const cam = makeBareCamera()
  assert.strictEqual(cam._qualifiedName, null)
  assert.strictEqual(cam.qualifiedName, null)
})

// ---------------------------------------------------------------------------
// SOMCamera getters
// ---------------------------------------------------------------------------

test('SOMCamera: type getter returns current value', () => {
  const cam = makeBareCamera({ type: 'perspective' })
  assert.strictEqual(cam.type, 'perspective')
})

test('SOMCamera: yfov getter returns current value', () => {
  const cam = makeBareCamera({ yfov: 0.8 })
  assert.strictEqual(cam.yfov, 0.8)
})

test('SOMCamera: znear getter returns current value', () => {
  const cam = makeBareCamera({ znear: 0.1 })
  assert.strictEqual(cam.znear, 0.1)
})

test('SOMCamera: zfar getter returns current value', () => {
  const cam = makeBareCamera({ zfar: 200 })
  assert.strictEqual(cam.zfar, 200)
})

// ---------------------------------------------------------------------------
// SOMCamera setters fire mutation events
// ---------------------------------------------------------------------------

test('SOMCamera: type setter updates underlying Camera and fires mutation', () => {
  const cam = makeBareCamera({ type: 'perspective' })
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.type = 'orthographic'
  assert.strictEqual(cam.type, 'orthographic')
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'type')
  assert.strictEqual(fired.detail.value, 'orthographic')
})

test('SOMCamera: yfov setter updates and fires mutation', () => {
  const cam = makeBareCamera()
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.yfov = 1.2
  assert.strictEqual(cam.yfov, 1.2)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'yfov')
  assert.strictEqual(fired.detail.value, 1.2)
})

test('SOMCamera: znear setter updates and fires mutation', () => {
  const cam = makeBareCamera()
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.znear = 0.5
  assert.strictEqual(cam.znear, 0.5)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'znear')
  assert.strictEqual(fired.detail.value, 0.5)
})

test('SOMCamera: zfar setter updates and fires mutation', () => {
  const cam = makeBareCamera()
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.zfar = 500
  assert.strictEqual(cam.zfar, 500)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'zfar')
  assert.strictEqual(fired.detail.value, 500)
})

test('SOMCamera: aspectRatio setter updates and fires mutation', () => {
  const cam = makeBareCamera()
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.aspectRatio = 1.777
  assert.strictEqual(cam.aspectRatio, 1.777)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'aspectRatio')
})

test('SOMCamera: xmag setter updates and fires mutation', () => {
  const cam = makeBareCamera()
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.xmag = 5
  assert.strictEqual(cam.xmag, 5)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'xmag')
})

test('SOMCamera: ymag setter updates and fires mutation', () => {
  const cam = makeBareCamera()
  let fired = null
  cam.addEventListener('mutation', e => { fired = e })
  cam.ymag = 3
  assert.strictEqual(cam.ymag, 3)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'ymag')
})

test('SOMCamera: mutation event detail includes property, value, and target', () => {
  const cam = makeBareCamera()
  let detail = null
  cam.addEventListener('mutation', e => { detail = e.detail })
  cam.yfov = 2.0
  assert.ok(detail)
  assert.strictEqual(detail.property, 'yfov')
  assert.strictEqual(detail.value, 2.0)
  assert.strictEqual(detail.target, cam)
})

test('SOMCamera: no event allocated when no listeners present', () => {
  const cam = makeBareCamera()
  assert.doesNotThrow(() => { cam.yfov = 99 })
  assert.strictEqual(cam.yfov, 99)
})

// ---------------------------------------------------------------------------
// SOMDocument camera registration
// ---------------------------------------------------------------------------

test('SOMDocument: som.cameras returns all SOMCamera wrappers for node-attached cameras', () => {
  const som = makeTwoCameraDoc()
  assert.strictEqual(som.cameras.length, 2)
  assert.ok(som.cameras.every(c => c instanceof SOMCamera))
})

test('SOMDocument: cameras registered under qualified alias <nodeName>.camera', () => {
  const som = makeTwoCameraDoc()
  const mainCam  = som.getObjectByName('MainCamera.camera')
  const orthoCam = som.getObjectByName('OrthoCamera.camera')
  assert.ok(mainCam  instanceof SOMCamera, 'MainCamera.camera should resolve to SOMCamera')
  assert.ok(orthoCam instanceof SOMCamera, 'OrthoCamera.camera should resolve to SOMCamera')
})

test('SOMDocument: qualifiedName is set on camera by _buildObjectGraph', () => {
  const som = makeTwoCameraDoc()
  const cam = som.getObjectByName('MainCamera.camera')
  assert.strictEqual(cam.qualifiedName, 'MainCamera.camera')
})

// ---------------------------------------------------------------------------
// SOMDocument collision handling
// ---------------------------------------------------------------------------

test('SOMDocument: when host node and camera share a name, node wins bare-name slot', () => {
  const som = makeOneCameraDoc()  // "MainCamera" node + "MainCamera" camera
  const obj = som.getObjectByName('MainCamera')
  assert.ok(obj !== null)
  assert.strictEqual(obj.constructor.name, 'SOMNode')
})

test('SOMDocument: qualified alias still resolves to camera despite name collision', () => {
  const som = makeOneCameraDoc()
  const cam = som.getObjectByName('MainCamera.camera')
  assert.ok(cam instanceof SOMCamera, 'MainCamera.camera must resolve to SOMCamera even with collision')
  assert.strictEqual(cam.type, 'perspective')
})

test('SOMDocument: collision warning is logged when bare name is taken', () => {
  const messages = []
  const origWarn = console.warn
  console.warn = (...args) => { messages.push(args.join(' ')); origWarn(...args) }
  try {
    makeOneCameraDoc()   // "MainCamera" node + "MainCamera" camera → collision
    const hasCollisionWarn = messages.some(m =>
      m.includes('duplicate') && m.includes('"MainCamera"') && m.includes('"MainCamera.camera"')
    )
    assert.ok(hasCollisionWarn, 'should log collision warning telling callers to use "MainCamera.camera"')
  } finally {
    console.warn = origWarn
  }
})

// ---------------------------------------------------------------------------
// SOMDocument enumeration
// ---------------------------------------------------------------------------

test('SOMDocument: node-walk finds cameras on all nodes', () => {
  const som = makeTwoCameraDoc()
  assert.strictEqual(som.cameras.length, 2)
  const types = som.cameras.map(c => c.type).sort()
  assert.deepEqual(types, ['orthographic', 'perspective'])
})

test('SOMDocument: detached cameras (not on any node) are not in som.cameras', () => {
  const doc = new Document()
  // Create a camera but do NOT attach it to any node
  doc.createCamera('Orphan').setType('perspective')
  doc.createScene('S')
  const som = new SOMDocument(doc)
  assert.strictEqual(som.cameras.length, 0)
  assert.strictEqual(som.getObjectByName('Orphan'), null)
  assert.strictEqual(som.getObjectByName('Orphan.camera'), null)
})

test('SOMDocument: SOMNode.camera returns the SOMCamera for its host node', () => {
  const som     = makeTwoCameraDoc()
  const camNode = som.getObjectByName('MainCamera')   // SOMNode wins bare-name
  const camObj  = som.getObjectByName('MainCamera.camera')
  assert.ok(camNode._camera === camObj, 'somNode._camera must be the SOMCamera instance')
  assert.ok(camNode.camera  === camObj, 'somNode.camera getter must return the SOMCamera')
})

test('SOMDocument: SOMNode.camera returns null for nodes with no camera', () => {
  const som = makeTwoCameraDoc()
  const crate = som.getObjectByName('Crate')
  assert.ok(crate != null)
  assert.strictEqual(crate.camera, null)
})

// ---------------------------------------------------------------------------
// Wire-address path (integration)
// ---------------------------------------------------------------------------

test('wire: getObjectByName("MainCamera.camera") returns the SOMCamera', () => {
  const som = makeOneCameraDoc()
  const cam = som.getObjectByName('MainCamera.camera')
  assert.ok(cam instanceof SOMCamera)
  assert.strictEqual(cam.name, 'MainCamera')
})

test('wire: setPath(somCamera, "yfov", 1.2) updates the camera', () => {
  const som = makeOneCameraDoc()
  const cam = som.getObjectByName('MainCamera.camera')
  som.setPath(cam, 'yfov', 1.2)
  assert.strictEqual(cam.yfov, 1.2)
})

test('wire: setPath(somCamera, "type", "orthographic") updates type', () => {
  const som = makeOneCameraDoc()
  const cam = som.getObjectByName('MainCamera.camera')
  som.setPath(cam, 'type', 'orthographic')
  assert.strictEqual(cam.type, 'orthographic')
})

test('wire: setPath(somCamera, "xmag", 5) on ortho camera updates xmag', () => {
  const som = makeTwoCameraDoc()
  const cam = som.getObjectByName('OrthoCamera.camera')
  som.setPath(cam, 'xmag', 8)
  assert.strictEqual(cam.xmag, 8)
})

test('wire: som.cameras returns deduplicated array (no double-counting from dual-key)', () => {
  const som = makeTwoCameraDoc()
  // Two cameras, each with two keys (bare + alias) → still only 2 wrappers
  assert.strictEqual(som.cameras.length, 2)
})
