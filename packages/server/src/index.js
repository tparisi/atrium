// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { createWorld } from './world.js'
import { createSessionServer } from './session.js'

const worldPath = process.env.WORLD_PATH ?? './space.gltf'
const port = parseInt(process.env.PORT ?? '3000', 10)

const world = await createWorld(worldPath)

await world.resolveExternalReferences()

const nodeCount = world.listNodeNames().length
console.log(`Atrium world loaded: ${world.meta.name ?? 'unnamed'} (${nodeCount} nodes)`)

createSessionServer({ port, world })
console.log(`Atrium server listening on ws://localhost:${port}`)
