// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { resolve as resolvePath, dirname } from 'node:path'
import { createWorld } from './world.js'
import { createSessionServer } from './session.js'

// ---------------------------------------------------------------------------
// Port extraction from a WebSocket URL
// ---------------------------------------------------------------------------

function extractPort(wsUrl) {
  try {
    const parsed = new URL(wsUrl)
    return parseInt(parsed.port, 10) || 3000
  } catch {
    return 3000
  }
}

// ---------------------------------------------------------------------------
// Startup: parse WORLD_PATH (may be a .atrium.json config or a direct glTF)
// ---------------------------------------------------------------------------

let worldPath  = process.env.WORLD_PATH ?? './space.gltf'
let port       = process.env.PORT ? parseInt(process.env.PORT, 10) : null
let worldBaseUrl = undefined  // only set when .atrium.json provides world.baseUrl

if (worldPath.endsWith('.json')) {
  const absConfigPath = resolvePath(worldPath)
  const configText    = await readFile(absConfigPath, 'utf8')
  const config        = JSON.parse(configText)

  if (config.world?.gltf) {
    worldPath = resolvePath(dirname(absConfigPath), config.world.gltf)
  }

  // PORT env var wins; only fall back to world.server when PORT is not set
  if (port === null && config.world?.server) {
    port = extractPort(config.world.server)
  }

  if (config.world?.baseUrl) {
    worldBaseUrl = config.world.baseUrl
  }
}

// Final port fallback to default
port ??= 3000

// ---------------------------------------------------------------------------
// World + server
// ---------------------------------------------------------------------------

const world = await createWorld(worldPath, { baseUrl: worldBaseUrl })

await world.resolveExternalReferences()

const nodeCount = world.listNodeNames().length
console.log(`Atrium world loaded: ${world.meta.name ?? 'unnamed'} (${nodeCount} nodes)`)

createSessionServer({ port, world })
console.log(`Atrium server listening on ws://localhost:${port}`)
