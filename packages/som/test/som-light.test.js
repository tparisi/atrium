// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test }   from 'node:test'
import assert     from 'node:assert/strict'
import { Document }          from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import { SOMDocument } from '../src/SOMDocument.js'
import { SOMLight }    from '../src/SOMLight.js'
import { SOMObject }   from '../src/SOMObject.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Document with one directional light on node "Sun" (same-name collision). */
function makeLightDoc() {
  const doc  = new Document()
  const ext  = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')

  const sunLight = ext.createLight('Sun')
    .setType('directional')
    .setColor([1.0, 0.98, 0.95])
    .setIntensity(3.0)

  const sunNode = doc.createNode('Sun')
    .setExtension('KHR_lights_punctual', sunLight)
  scene.addChild(sunNode)

  return new SOMDocument(doc)
}

/** Build a Document with two lights (directional + point) and one plain node. */
function makeTwoLightDoc() {
  const doc   = new Document()
  const ext   = doc.createExtension(KHRLightsPunctual)
  const scene = doc.createScene('Scene')

  const sunLight = ext.createLight('Sun')
    .setType('directional')
    .setColor([1.0, 0.98, 0.95])
    .setIntensity(3.0)

  const lampLight = ext.createLight('LampGlow')
    .setType('point')
    .setColor([1.0, 0.9, 0.7])
    .setIntensity(10.0)
    .setRange(5.0)

  const sunNode  = doc.createNode('Sun').setExtension('KHR_lights_punctual', sunLight)
  const lampNode = doc.createNode('LampGlow').setTranslation([0, 1.5, 0])
    .setExtension('KHR_lights_punctual', lampLight)
  const plainNode = doc.createNode('Crate')

  scene.addChild(sunNode)
  scene.addChild(lampNode)
  scene.addChild(plainNode)

  return new SOMDocument(doc)
}

/** Make a bare SOMLight wrapping a test-double Light object (for property/mutation tests). */
function makeBareLight({ name = 'TestLight', type = 'point', color = [1,1,1], intensity = 1, range = null } = {}) {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  const gltfLight = ext.createLight(name)
    .setType(type)
    .setColor(color)
    .setIntensity(intensity)
    .setRange(range)
  return new SOMLight(gltfLight)
}

// ---------------------------------------------------------------------------
// SOMLight construction
// ---------------------------------------------------------------------------

test('SOMLight: wraps a KHR_lights_punctual Light property', () => {
  const light = makeBareLight()
  assert.ok(light._light != null)
})

test('SOMLight: name getter returns the light glTF name', () => {
  const light = makeBareLight({ name: 'MySun' })
  assert.strictEqual(light.name, 'MySun')
})

test('SOMLight: extends SOMObject', () => {
  const light = makeBareLight()
  assert.ok(light instanceof SOMObject)
})

// ---------------------------------------------------------------------------
// SOMLight mutable properties — getters
// ---------------------------------------------------------------------------

test('SOMLight: color getter returns current value', () => {
  const light = makeBareLight({ color: [0.5, 0.6, 0.7] })
  const c = light.color
  assert.deepEqual(Array.from(c), [0.5, 0.6, 0.7])
})

test('SOMLight: intensity getter returns current value', () => {
  const light = makeBareLight({ intensity: 4.2 })
  assert.strictEqual(light.intensity, 4.2)
})

test('SOMLight: type getter returns current value', () => {
  const light = makeBareLight({ type: 'spot' })
  assert.strictEqual(light.type, 'spot')
})

test('SOMLight: range getter returns number for set range', () => {
  const light = makeBareLight({ range: 5.0 })
  assert.strictEqual(light.range, 5.0)
})

test('SOMLight: range getter returns null for unset range', () => {
  const light = makeBareLight({ range: null })
  assert.strictEqual(light.range, null)
})

// ---------------------------------------------------------------------------
// SOMLight mutable properties — setters fire mutation events
// ---------------------------------------------------------------------------

test('SOMLight: color setter updates underlying Light and fires mutation', () => {
  const light = makeBareLight()
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.color = [0.1, 0.2, 0.3]
  assert.deepEqual(Array.from(light.color), [0.1, 0.2, 0.3])
  assert.ok(fired, 'mutation event should fire')
  assert.strictEqual(fired.detail.property, 'color')
  assert.deepEqual(Array.from(fired.detail.value), [0.1, 0.2, 0.3])
})

test('SOMLight: intensity setter updates and fires mutation', () => {
  const light = makeBareLight()
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.intensity = 7.5
  assert.strictEqual(light.intensity, 7.5)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'intensity')
  assert.strictEqual(fired.detail.value, 7.5)
})

test('SOMLight: type setter updates and fires mutation', () => {
  const light = makeBareLight({ type: 'point' })
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.type = 'directional'
  assert.strictEqual(light.type, 'directional')
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'type')
})

test('SOMLight: range setter accepts a number and fires mutation', () => {
  const light = makeBareLight({ range: null })
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.range = 8.0
  assert.strictEqual(light.range, 8.0)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'range')
  assert.strictEqual(fired.detail.value, 8.0)
})

test('SOMLight: range setter accepts null (infinite range) and fires mutation', () => {
  const light = makeBareLight({ range: 5.0 })
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.range = null
  assert.strictEqual(light.range, null)
  assert.ok(fired)
  assert.strictEqual(fired.detail.value, null)
})

test('SOMLight: innerConeAngle getter and setter fire mutation', () => {
  const light = makeBareLight()
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.innerConeAngle = 0.3
  assert.strictEqual(light.innerConeAngle, 0.3)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'innerConeAngle')
})

test('SOMLight: outerConeAngle getter and setter fire mutation', () => {
  const light = makeBareLight()
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.outerConeAngle = 0.7
  assert.strictEqual(light.outerConeAngle, 0.7)
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'outerConeAngle')
})

test('SOMLight: extras getter and setter fire mutation', () => {
  const light = makeBareLight()
  let fired = null
  light.addEventListener('mutation', e => { fired = e })
  light.extras = { hint: 'ambient-only' }
  assert.deepEqual(light.extras, { hint: 'ambient-only' })
  assert.ok(fired)
  assert.strictEqual(fired.detail.property, 'extras')
})

// ---------------------------------------------------------------------------
// SOMLight mutation events — detail shape + zero-cost guard
// ---------------------------------------------------------------------------

test('SOMLight: mutation event detail includes property name, value, and target', () => {
  const light = makeBareLight()
  let detail = null
  light.addEventListener('mutation', e => { detail = e.detail })
  light.intensity = 2.0
  assert.ok(detail)
  assert.strictEqual(detail.property, 'intensity')
  assert.strictEqual(detail.value, 2.0)
  assert.strictEqual(detail.target, light)
})

test('SOMLight: no event allocated when no listeners present', () => {
  const light = makeBareLight()
  // Should not throw and no listener is called — just verify no error
  assert.doesNotThrow(() => { light.intensity = 99 })
  assert.strictEqual(light.intensity, 99)
})

// ---------------------------------------------------------------------------
// SOMDocument light registration
// ---------------------------------------------------------------------------

test('SOMDocument: som.lights returns all SOMLight wrappers', () => {
  const som = makeTwoLightDoc()
  assert.strictEqual(som.lights.length, 2)
  assert.ok(som.lights.every(l => l instanceof SOMLight))
})

test('SOMDocument: lights registered under bare name in _objectsByName', () => {
  const som = makeTwoLightDoc()
  // LampGlow node is unique (no node named "LampGlow" collision — there IS a node named LampGlow)
  // Actually both have same-name collisions; bare name goes to node. Qualified alias goes to light.
  // For bare names: _registerObject warns + skips when node already has that name.
  // "LampGlow" node registered first → "LampGlow" in _objectsByName is the SOMNode.
  const lampObj = som.getObjectByName('LampGlow')
  assert.ok(lampObj !== null)
  // The bare name resolves to the node (node registered first)
  assert.strictEqual(lampObj.constructor.name, 'SOMNode')
})

test('SOMDocument: lights registered under qualified alias <nodeName>.light', () => {
  const som = makeTwoLightDoc()
  const sunLight  = som.getObjectByName('Sun.light')
  const lampLight = som.getObjectByName('LampGlow.light')
  assert.ok(sunLight  instanceof SOMLight, 'Sun.light should resolve to SOMLight')
  assert.ok(lampLight instanceof SOMLight, 'LampGlow.light should resolve to SOMLight')
})

test('SOMDocument: both keys return the same cached wrapper instance', () => {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  // Use a unique light name that won't collide with node
  const gltfLight = ext.createLight('UniqueLightName')
    .setType('point').setColor([1,1,1]).setIntensity(1)
  const lampNode = doc.createNode('LampPost').setExtension('KHR_lights_punctual', gltfLight)
  doc.createScene('S').addChild(lampNode)

  const som2 = new SOMDocument(doc)
  const byAlias = som2.getObjectByName('LampPost.light')
  const byBare  = som2.getObjectByName('UniqueLightName')
  assert.ok(byAlias instanceof SOMLight)
  assert.ok(byBare  instanceof SOMLight)
  assert.strictEqual(byAlias, byBare, 'both keys must return the same wrapper instance')
})

test('SOMDocument: SOMNode.light returns the SOMLight for its host node', () => {
  const som = makeTwoLightDoc()
  const sunNode  = som.getObjectByName('Sun')
  // sunNode is the SOMNode (node wins bare-name collision)
  const sunLight = som.getObjectByName('Sun.light')
  assert.ok(sunNode._light === sunLight, 'somNode._light must be the same SOMLight instance')
  assert.ok(sunNode.light === sunLight,  'somNode.light getter must return the SOMLight')
})

test('SOMDocument: SOMNode.light returns null for nodes with no light', () => {
  const som = makeTwoLightDoc()
  const crate = som.getObjectByName('Crate')
  assert.ok(crate != null)
  assert.strictEqual(crate.light, null)
})

// ---------------------------------------------------------------------------
// SOMDocument collision handling
// ---------------------------------------------------------------------------

test('SOMDocument: when host node and light share a name, node wins bare-name slot', () => {
  const som = makeLightDoc()  // "Sun" node + "Sun" light
  const obj = som.getObjectByName('Sun')
  assert.ok(obj !== null)
  assert.strictEqual(obj.constructor.name, 'SOMNode')
})

test('SOMDocument: qualified alias still resolves to light despite name collision', () => {
  const som = makeLightDoc()
  const light = som.getObjectByName('Sun.light')
  assert.ok(light instanceof SOMLight, 'Sun.light must resolve to SOMLight even with collision')
  assert.strictEqual(light.name, 'Sun')
})

test('SOMDocument: collision warning is logged when bare name is taken', () => {
  const messages = []
  const origWarn = console.warn
  console.warn = (...args) => { messages.push(args.join(' ')); origWarn(...args) }
  try {
    makeLightDoc()   // "Sun" node + "Sun" light → collision
    const hasCollisionWarn = messages.some(m =>
      m.includes('duplicate') && m.includes('"Sun"') && m.includes('"Sun.light"')
    )
    assert.ok(hasCollisionWarn, 'should log collision warning telling callers to use "Sun.light"')
  } finally {
    console.warn = origWarn
  }
})

// ---------------------------------------------------------------------------
// SOMDocument enumeration
// ---------------------------------------------------------------------------

test('SOMDocument: node-walk finds lights on all nodes', () => {
  const som = makeTwoLightDoc()
  assert.strictEqual(som.lights.length, 2)
  const names = som.lights.map(l => l.name).sort()
  assert.deepEqual(names, ['LampGlow', 'Sun'])
})

test('SOMDocument: detached lights (not on any node) are not registered', () => {
  const doc = new Document()
  const ext = doc.createExtension(KHRLightsPunctual)
  // Create a light but do NOT attach it to any node
  ext.createLight('Orphan').setType('point').setIntensity(1)
  doc.createScene('S')
  const som = new SOMDocument(doc)
  assert.strictEqual(som.lights.length, 0)
  assert.strictEqual(som.getObjectByName('Orphan'), null)
  assert.strictEqual(som.getObjectByName('Orphan.light'), null)
})

// ---------------------------------------------------------------------------
// Wire-address path (integration)
// ---------------------------------------------------------------------------

test('wire: getObjectByName("Sun.light") returns the SOMLight', () => {
  const som = makeLightDoc()
  const light = som.getObjectByName('Sun.light')
  assert.ok(light instanceof SOMLight)
  assert.strictEqual(light.name, 'Sun')
})

test('wire: setPath(somLight, "intensity", 0.5) updates the light', () => {
  const som   = makeLightDoc()
  const light = som.getObjectByName('Sun.light')
  som.setPath(light, 'intensity', 0.5)
  assert.strictEqual(light.intensity, 0.5)
})

test('wire: setPath(somLight, "color", [1,0,0]) updates the light', () => {
  const som   = makeLightDoc()
  const light = som.getObjectByName('Sun.light')
  som.setPath(light, 'color', [1, 0, 0])
  assert.deepEqual(Array.from(light.color), [1, 0, 0])
})

test('wire: setPath(somLight, "range", null) sets range to null', () => {
  const som   = makeTwoLightDoc()
  const light = som.getObjectByName('LampGlow.light')
  assert.strictEqual(light.range, 5.0)      // starts as 5.0
  som.setPath(light, 'range', null)
  assert.strictEqual(light.range, null)
})

test('wire: setPath(somLight, "type", "spot") updates type', () => {
  const som   = makeLightDoc()
  const light = som.getObjectByName('Sun.light')
  som.setPath(light, 'type', 'spot')
  assert.strictEqual(light.type, 'spot')
})

test('wire: som.lights returns deduplicated array (no double-counting from dual-key)', () => {
  const som = makeTwoLightDoc()
  // Two lights, each with two keys (bare + alias) → still only 2 wrappers in som.lights
  assert.strictEqual(som.lights.length, 2)
})
