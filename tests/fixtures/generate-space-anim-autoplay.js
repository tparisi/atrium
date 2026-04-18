// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Generates tests/fixtures/space-anim-autoplay.gltf — identical to
// space-anim.gltf but with both animations authored to autostart and loop.
//
// Run from repo root:
//   node tests/fixtures/generate-space-anim-autoplay.js

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { buildSpaceAnimDoc } from './generate-space-anim-base.js'

// Resolve gltf-transform relative to packages/server to avoid extra install.
const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)
const { Document, NodeIO } = await import(coreUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const OUT_PATH   = join(__dirname, 'space-anim-autoplay.gltf')

const AUTOPLAY_PLAYBACK = {
  playing:        false,
  paused:         false,
  loop:           true,
  autoStart:      true,
  timeScale:      1.0,
  startTime:      0,
  startWallClock: null,
  pauseTime:      null,
}

async function main() {
  const doc = buildSpaceAnimDoc({
    Document,
    worldName:        'Space (Autoplay)',
    worldDescription: 'A minimal gray-box test world with autostarting looped animations.',
    animExtras: {
      CrateRotate: { playback: { ...AUTOPLAY_PLAYBACK } },
      CrateBob:    { playback: { ...AUTOPLAY_PLAYBACK } },
    },
  })

  const io = new NodeIO()
  const { json, resources } = await io.writeJSON(doc)

  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:')) {
      const data = resources[buf.uri]
      if (data) {
        buf.uri = 'data:application/octet-stream;base64,' +
          Buffer.from(data).toString('base64')
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(json, null, 2))
  console.log(`Written: ${OUT_PATH}`)
  console.log(`Animations: ${json.animations?.map(a => `${a.name} (${a.channels?.length} ch)`).join(', ')}`)
}

main().catch(err => { console.error(err); process.exit(1) })
