// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Document, NodeIO } from '@gltf-transform/core'
import { AtriumClient } from '../src/AtriumClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

function waitForEvent(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for event "${event}"`)),
      timeoutMs
    )
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data) })
    emitter.once('error', (err)  => { clearTimeout(timer); reject(err) })
  })
}

// ---------------------------------------------------------------------------
// loadWorldFromData — glTF JSON string
// ---------------------------------------------------------------------------

test('loadWorldFromData: glTF JSON string → SOM populated + world:loaded fires', async () => {
  const client = new AtriumClient()
  const loaded = waitForEvent(client, 'world:loaded')

  const gltfText = readFileSync(FIXTURE_PATH, 'utf8')
  await client.loadWorldFromData(gltfText, 'space.gltf')

  const data = await loaded
  assert.ok(client.som, 'client.som is set after load')
  assert.ok(Array.isArray(client.som.nodes), 'som.nodes is an array')
  assert.ok(client.som.nodes.length > 0, 'SOM has at least one node')
  assert.equal(data.name, 'Test World', 'world:loaded carries the world name from extras')
})

// ---------------------------------------------------------------------------
// loadWorldFromData — GLB ArrayBuffer
// ---------------------------------------------------------------------------

test('loadWorldFromData: GLB ArrayBuffer → SOM populated + world:loaded fires', async () => {
  // Build a minimal GLB from a fresh Document using NodeIO (works in Node.js)
  const doc = new Document()
  const scene = doc.createScene('MinimalScene')
  const node = doc.createNode('Cube')
  scene.addChild(node)

  const io = new NodeIO()
  const glbBuffer = await io.writeBinary(doc)

  const client = new AtriumClient()
  const loaded = waitForEvent(client, 'world:loaded')

  await client.loadWorldFromData(glbBuffer.buffer, 'minimal.glb')

  await loaded
  assert.ok(client.som, 'client.som is set after GLB load')
  assert.ok(client.som.nodes.length > 0, 'SOM has at least one node from the GLB')
})
