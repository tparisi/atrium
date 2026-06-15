// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Generates tests/fixtures/space-cameras.gltf — space.gltf geometry + two cameras:
//   - MainCamera  (perspective) on node "MainCamera"  (same-name collision case)
//   - OrthoCamera (orthographic) on node "OrthoCamera" (same-name collision case)
//
// Cameras are core glTF — no extension registration needed.
//
// Run from repo root:
//   node tests/fixtures/generate-space-cameras.js

import { fileURLToPath } from 'url'
import { dirname, join }  from 'path'

const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)

const { NodeIO } = await import(coreUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const IN_PATH    = join(__dirname, 'space.gltf')
const OUT_PATH   = join(__dirname, 'space-cameras.gltf')

async function main() {
  const io = new NodeIO()

  // Start from full space.gltf geometry (ground plane, crate, lamp stand, lamp shade)
  const document = await io.read(IN_PATH)

  const scene = document.getRoot().listScenes()[0]

  // Camera 1 — perspective, positioned to view the scene
  const mainCam = document.createCamera('MainCamera')
    .setType('perspective')
    .setYFov(0.8)
    .setZNear(0.1)
    .setZFar(100)
    .setAspectRatio(1.777)   // 16:9 hint

  const mainCamNode = document.createNode('MainCamera')
    .setCamera(mainCam)
    .setTranslation([0, 2, 8])
  scene.addChild(mainCamNode)

  // Camera 2 — orthographic, positioned to the side facing the scene
  // Rotation: -90° around Y axis so it faces –Z (toward scene)
  // quaternion for -90° around Y: [0, sin(-π/4), 0, cos(-π/4)] = [0, -√2/2, 0, √2/2]
  const s = Math.sin(-Math.PI / 4)
  const c = Math.cos(-Math.PI / 4)

  const orthoCam = document.createCamera('OrthoCamera')
    .setType('orthographic')
    .setXMag(5)
    .setYMag(3)
    .setZNear(0.1)
    .setZFar(100)

  const orthoCamNode = document.createNode('OrthoCamera')
    .setCamera(orthoCam)
    .setTranslation([10, 2, 0])
    .setRotation([0, s, 0, c])
  scene.addChild(orthoCamNode)

  await io.write(OUT_PATH, document)
  console.log(`Written: ${OUT_PATH}`)
  console.log(`Base geometry: ${IN_PATH}`)
  console.log(`Cameras: MainCamera (perspective, yfov=0.8), OrthoCamera (orthographic, xmag=5)`)
}

main().catch(err => { console.error(err); process.exit(1) })
