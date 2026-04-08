// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AtriumClient } from '../src/AtriumClient.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect `count` occurrences of `event` from `emitter` with a timeout. */
function collectEvents(emitter, event, count, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const events = []
    const timer = setTimeout(
      () => reject(new Error(`Timeout: collected ${events.length}/${count} "${event}" events`)),
      timeoutMs
    )
    emitter.on(event, (data) => {
      events.push(data)
      if (events.length >= count) { clearTimeout(timer); resolve(events) }
    })
  })
}

function waitForEvent(emitter, event, timeoutMs = 3000) {
  return collectEvents(emitter, event, 1, timeoutMs).then(arr => arr[0])
}

/**
 * Build a minimal glTF JSON document with container nodes that have
 * `extras.atrium.source` fields.
 */
function buildWorldJson(containers = []) {
  const nodes = containers.map(c => ({
    name:   c.name,
    extras: { atrium: { source: c.source } },
  }))
  return {
    asset:  { version: '2.0' },
    nodes,
    scenes: [{ name: 'Scene', nodes: nodes.map((_, i) => i) }],
    scene:  0,
    extras: {
      atrium: {
        version: '0.1.0',
        world: { name: 'Test World Ext', maxUsers: 5 },
      },
    },
  }
}

/** Build a minimal external glTF JSON (no geometry) with a single node. */
function buildExternalJson(nodeName) {
  return {
    asset:  { version: '2.0' },
    nodes:  [{ name: nodeName }],
    scenes: [{ name: 'ExtScene', nodes: [0] }],
    scene:  0,
    extras: { atrium: { world: { name: 'External — should be discarded' } } },
  }
}

/** Mock fetch that serves canned JSON responses keyed by URL. */
function makeMockFetch(map) {
  return async (url) => {
    const json = map[url]
    if (!json) return { ok: false, status: 404, text: async () => 'Not Found' }
    const text = JSON.stringify(json)
    return { ok: true, status: 200, text: async () => text }
  }
}

/**
 * Load a world from JSON directly (no HTTP) and set a fake base URL so that
 * relative `source` paths can be resolved in tests.
 */
async function loadWorldDirect(client, worldJson, baseUrl) {
  await client.loadWorldFromData(JSON.stringify(worldJson))
  client._worldBaseUrl = baseUrl
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('resolveExternalReferences: single ref — world:loaded fires twice, base then reference', async () => {
  const worldJson = buildWorldJson([{ name: 'Crate', source: './crate.gltf' }])
  const crateJson = buildExternalJson('Crate')

  const mockFetch = makeMockFetch({ 'http://fake/crate.gltf': crateJson })
  const client    = new AtriumClient({ fetch: mockFetch })

  // Collect both events before starting
  const events = collectEvents(client, 'world:loaded', 2)
  await loadWorldDirect(client, worldJson, 'http://fake/space-ext.gltf')
  client.resolveExternalReferences()
  const fired = await events

  assert.equal(fired.length, 2, 'world:loaded fired twice')
  assert.ok(!fired[0].source,                               'first event is base world (no source)')
  assert.equal(fired[1].source,        'http://fake/crate.gltf', 'second event has source URL')
  assert.equal(fired[1].containerName, 'Crate',                  'second event has containerName')
})

test('resolveExternalReferences: base world:loaded fires before any reference world:loaded', async () => {
  const worldJson = buildWorldJson([{ name: 'Crate', source: './crate.gltf' }])
  const crateJson = buildExternalJson('Crate')

  const order     = []
  const mockFetch = makeMockFetch({ 'http://fake/crate.gltf': crateJson })
  const client    = new AtriumClient({ fetch: mockFetch })
  client.on('world:loaded', (data) => order.push(data.source ? 'ref' : 'base'))

  const allLoaded = collectEvents(client, 'world:loaded', 2)
  await loadWorldDirect(client, worldJson, 'http://fake/world.gltf')
  client.resolveExternalReferences()
  await allLoaded

  assert.equal(order[0], 'base', 'base fires first')
  assert.equal(order[1], 'ref',  'ref fires second')
})

test('resolveExternalReferences: 404 on ref — base world:loaded fires, no reference event, no crash', async () => {
  const worldJson = buildWorldJson([{ name: 'Crate', source: './crate.gltf' }])
  // crate.gltf intentionally missing → 404

  const mockFetch = makeMockFetch({})
  const client    = new AtriumClient({ fetch: mockFetch })
  const events    = []
  client.on('world:loaded', (data) => events.push(data))

  await loadWorldDirect(client, worldJson, 'http://fake/world.gltf')
  await client.resolveExternalReferences()   // await this time to let failure propagate

  assert.equal(events.length, 1, 'only base world:loaded fired')
  assert.ok(!events[0].source,   'base event has no source')
})

test('resolveExternalReferences: two refs — three world:loaded events total', async () => {
  const worldJson = buildWorldJson([
    { name: 'Crate', source: './crate.gltf' },
    { name: 'Light', source: './lamp.gltf'  },
  ])
  const crateJson = buildExternalJson('Crate')
  const lampJson  = buildExternalJson('Lamp')

  const mockFetch = makeMockFetch({
    'http://fake/crate.gltf': crateJson,
    'http://fake/lamp.gltf':  lampJson,
  })

  const client  = new AtriumClient({ fetch: mockFetch })
  const events  = collectEvents(client, 'world:loaded', 3)
  await loadWorldDirect(client, worldJson, 'http://fake/world.gltf')
  client.resolveExternalReferences()
  const fired = await events

  assert.equal(fired.length, 3, 'three world:loaded events total')
  assert.ok(!fired[0].source, 'first is base world')

  const sources    = new Set(fired.slice(1).map(e => e.source))
  const containers = new Set(fired.slice(1).map(e => e.containerName))
  assert.ok(sources.has('http://fake/crate.gltf'), 'crate ref event fired')
  assert.ok(sources.has('http://fake/lamp.gltf'),  'lamp ref event fired')
  assert.ok(containers.has('Crate'), 'Crate container')
  assert.ok(containers.has('Light'), 'Light container')
})

test('resolveExternalReferences: ingested nodes accessible via getNodeByName', async () => {
  const worldJson = buildWorldJson([{ name: 'Crate', source: './crate.gltf' }])
  const crateJson = buildExternalJson('Crate')

  const mockFetch = makeMockFetch({ 'http://fake/crate.gltf': crateJson })
  const client    = new AtriumClient({ fetch: mockFetch })

  await loadWorldDirect(client, worldJson, 'http://fake/world.gltf')
  await client.resolveExternalReferences()

  assert.ok(client.som.getNodeByName('Crate'),       'container node exists')
  assert.ok(client.som.getNodeByName('Crate/Crate'), 'prefixed node exists after ref resolved')
})

test('resolveExternalReferences: no-op when worldBaseUrl is null (loadWorldFromData)', async () => {
  const worldJson = buildWorldJson([{ name: 'Crate', source: './crate.gltf' }])

  let fetchCalled = false
  const mockFetch = async () => { fetchCalled = true; return { ok: false, status: 404 } }

  const client = new AtriumClient({ fetch: mockFetch })
  await client.loadWorldFromData(JSON.stringify(worldJson))
  // _worldBaseUrl is null after loadWorldFromData, so resolveExternalReferences is a no-op
  await client.resolveExternalReferences()

  assert.ok(!fetchCalled, 'fetch not called when worldBaseUrl is null')
})
