// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

function makeDoc(extrasValue = {}) {
  const doc = new Document()
  doc.getRoot().setExtras(extrasValue)
  return new SOMDocument(doc)
}

// ---------------------------------------------------------------------------
// extras getter / setter
// ---------------------------------------------------------------------------

test('extras getter returns root extras', () => {
  const initial = { atrium: { name: 'TestWorld' } }
  const som = makeDoc(initial)
  assert.deepEqual(som.extras, initial)
})

test('extras getter returns reference from getRoot().getExtras()', () => {
  const doc = new Document()
  doc.getRoot().setExtras({ x: 1 })
  const som = new SOMDocument(doc)
  assert.strictEqual(som.extras, doc.getRoot().getExtras())
})

test('extras setter updates root extras', () => {
  const som = makeDoc({})
  som.extras = { atrium: { name: 'Updated' } }
  assert.deepEqual(som.extras, { atrium: { name: 'Updated' } })
})

test('extras setter fires mutation event', () => {
  const som = makeDoc({})
  const events = []
  som.addEventListener('mutation', (e) => events.push(e))

  const newVal = { atrium: { name: 'Fired' } }
  som.extras = newVal

  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'mutation')
  assert.equal(events[0].detail.property, 'extras')
  assert.deepEqual(events[0].detail.value, newVal)
  assert.strictEqual(events[0].detail.target, som)
})

test('extras setter skips event when no listeners attached', () => {
  const som = makeDoc({})
  // No listeners — should not throw
  assert.doesNotThrow(() => { som.extras = { atrium: { name: 'Silent' } } })
  assert.deepEqual(som.extras, { atrium: { name: 'Silent' } })
})

// ---------------------------------------------------------------------------
// setExtrasAtrium
// ---------------------------------------------------------------------------

test('setExtrasAtrium sets top-level atrium field', () => {
  const som = makeDoc({})
  som.setExtrasAtrium('name', 'My World')
  assert.equal(som.extras.atrium.name, 'My World')
})

test('setExtrasAtrium sets nested field', () => {
  const som = makeDoc({})
  som.setExtrasAtrium('background.texture', 'sky.png')
  assert.equal(som.extras.atrium.background.texture, 'sky.png')
})

test('setExtrasAtrium creates intermediate objects when absent', () => {
  const som = makeDoc({})
  som.setExtrasAtrium('foo.bar.baz', 42)
  assert.equal(som.extras.atrium.foo.bar.baz, 42)
})

test('setExtrasAtrium fires mutation event', () => {
  const som = makeDoc({})
  const events = []
  som.addEventListener('mutation', (e) => events.push(e))

  som.setExtrasAtrium('name', 'EventWorld')

  assert.equal(events.length, 1)
  assert.equal(events[0].detail.property, 'extras')
  assert.equal(events[0].detail.value.atrium.name, 'EventWorld')
})

test('setExtrasAtrium preserves sibling fields', () => {
  const som = makeDoc({ atrium: { background: { texture: 'a.png', type: 'equirectangular' } } })
  som.setExtrasAtrium('background.texture', 'b.png')
  assert.equal(som.extras.atrium.background.type, 'equirectangular', 'sibling type preserved')
  assert.equal(som.extras.atrium.background.texture, 'b.png', 'texture updated')
})
