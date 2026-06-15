// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Generates tests/fixtures/space-lights.gltf — space.gltf geometry + two
// KHR_lights_punctual lights:
//   - Sun  (directional) on node "Sun"      (same-name collision case)
//   - LampGlow (point, range 5m) on node "LampGlow" (same-name collision case)
//
// Run from repo root:
//   node tests/fixtures/generate-space-lights.js

import { fileURLToPath } from 'url'
import { dirname, join }  from 'path'

// Resolve gltf-transform relative to packages/server to avoid extra install.
const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)
const extUrl  = new URL(
  '../../packages/server/node_modules/@gltf-transform/extensions/dist/index.modern.js',
  import.meta.url
)

const { NodeIO }           = await import(coreUrl)
const { KHRLightsPunctual } = await import(extUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const IN_PATH    = join(__dirname, 'space.gltf')
const OUT_PATH   = join(__dirname, 'space-lights.gltf')

async function main() {
  const io = new NodeIO().registerExtensions([KHRLightsPunctual])

  // Start from full space.gltf geometry (ground plane, crate, lamp stand, lamp shade)
  const document = await io.read(IN_PATH)

  const lightsExt = document.createExtension(KHRLightsPunctual)

  // Light 1 — directional sun, warm white
  const sunLight = lightsExt.createLight('Sun')
    .setType('directional')
    .setColor([1.0, 0.98, 0.95])
    .setIntensity(3.0)

  // Rotate ~45° around X axis: quaternion [sin(π/8), 0, 0, cos(π/8)]
  // Points the light downward and to one side so it casts visible shadows.
  const sinA = Math.sin(Math.PI / 8)
  const cosA = Math.cos(Math.PI / 8)

  const sunNode = document.createNode('Sun')
    .setExtension('KHR_lights_punctual', sunLight)
    .setTranslation([5.0, 5.0, 5.0])
    .setRotation([sinA, 0, 0, cosA])
  document.getRoot().listScenes()[0].addChild(sunNode)

  // Light 2 — point lamp glow, warm amber
  const lampLight = lightsExt.createLight('LampGlow')
    .setType('point')
    .setColor([1.0, 0.9, 0.7])
    .setIntensity(10.0)
    .setRange(5.0)

  // lamp-shade node in space.gltf sits at translation [0, 1.6, 0] relative to lamp-01
  // lamp-01 is at [3, 0, 0], so absolute shade height ≈ [3, 1.6, 0].
  // Place LampGlow at lamp position to illuminate nearby geometry.
  const lampNode = document.createNode('LampGlow')
    .setExtension('KHR_lights_punctual', lampLight)
    .setTranslation([3.0, 1.6, 0.0])
  document.getRoot().listScenes()[0].addChild(lampNode)

  await io.write(OUT_PATH, document)
  console.log(`Written: ${OUT_PATH}`)
  console.log(`Base geometry: ${IN_PATH}`)
  console.log(`Lights: Sun (directional, 45° rotation), LampGlow (point, range 5m)`)
}

main().catch(err => { console.error(err); process.exit(1) })
