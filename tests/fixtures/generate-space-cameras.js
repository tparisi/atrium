// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Generates tests/fixtures/space-cameras.gltf — space.gltf geometry + four cameras:
//   - MainCamera           (perspective) on node "MainCamera"         (same-name collision case)
//   - OrthoCamera          (orthographic) on node "OrthoCamera"        (same-name collision case)
//   - NestedCamera         (perspective) child of NestedCameraMount    (static, non-identity parent)
//   - AnimatedCamera       (perspective) child of AnimatedCameraMount  (animated parent)
//
// Also adds CameraMountRotate animation targeting AnimatedCameraMount.
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

  // Camera C1 — NestedCameraMount → NestedCamera (static, non-identity parent)
  // Compound rotation: yaw=30° around Y combined with pitch=20° around X.
  // q_combined = q_yaw * q_pitch = [cy*sp, sy*cp, -sy*sp, cy*cp]
  const yaw1   = Math.PI / 6    // 30°
  const pitch1 = Math.PI / 9    // 20°
  const cy1 = Math.cos(yaw1 / 2), sy1 = Math.sin(yaw1 / 2)
  const cp1 = Math.cos(pitch1 / 2), sp1 = Math.sin(pitch1 / 2)

  const nestedMountNode = document.createNode('NestedCameraMount')
    .setTranslation([3, 1, 2])
    .setRotation([cy1 * sp1, sy1 * cp1, -sy1 * sp1, cy1 * cp1])

  const nestedCam = document.createCamera('NestedCamera')
    .setType('perspective')
    .setYFov(0.8)
    .setZNear(0.1)
    .setZFar(100)

  const nestedCamNode = document.createNode('NestedCamera')
    .setCamera(nestedCam)
    .setTranslation([0, 0.5, -1])
  nestedMountNode.addChild(nestedCamNode)
  scene.addChild(nestedMountNode)

  // Camera C2 — AnimatedCameraMount → AnimatedCamera (animated parent)
  // Compound rotation: yaw=45° around Y combined with pitch=15° around X (bind pose).
  const yaw2   = Math.PI / 4    // 45°
  const pitch2 = Math.PI / 12   // 15°
  const cy2 = Math.cos(yaw2 / 2), sy2 = Math.sin(yaw2 / 2)
  const cp2 = Math.cos(pitch2 / 2), sp2 = Math.sin(pitch2 / 2)

  const animMountNode = document.createNode('AnimatedCameraMount')
    .setTranslation([-3, 1, 2])
    .setRotation([cy2 * sp2, sy2 * cp2, -sy2 * sp2, cy2 * cp2])

  const animCam = document.createCamera('AnimatedCamera')
    .setType('perspective')
    .setYFov(0.8)
    .setZNear(0.1)
    .setZFar(100)

  const animCamNode = document.createNode('AnimatedCamera')
    .setCamera(animCam)
    .setTranslation([0, 0.5, -1])
  animMountNode.addChild(animCamNode)
  scene.addChild(animMountNode)

  // CameraMountRotate — Y-axis rotation of AnimatedCameraMount, same keyframe
  // pattern as CrateRotate in generate-space-anim-base.js: 0→90→180→270→360°
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer()
  const sin = Math.sin, cos = Math.cos

  const camRotTimes = document.createAccessor()
    .setArray(new Float32Array([0, 1, 2, 3, 4])).setType('SCALAR').setBuffer(buffer)
  const camRotValues = document.createAccessor()
    .setArray(new Float32Array([
      0, sin(0),                  0, cos(0),
      0, sin(Math.PI / 4),        0, cos(Math.PI / 4),
      0, sin(Math.PI / 2),        0, cos(Math.PI / 2),
      0, sin(3 * Math.PI / 4),    0, cos(3 * Math.PI / 4),
      0, sin(0),                  0, cos(0),
    ])).setType('VEC4').setBuffer(buffer)

  const camRotSampler = document.createAnimationSampler()
    .setInput(camRotTimes).setOutput(camRotValues).setInterpolation('LINEAR')
  const camRotChannel = document.createAnimationChannel()
    .setSampler(camRotSampler).setTargetNode(animMountNode).setTargetPath('rotation')

  document.createAnimation('CameraMountRotate')
    .addSampler(camRotSampler).addChannel(camRotChannel)

  await io.write(OUT_PATH, document)
  console.log(`Written: ${OUT_PATH}`)
  console.log(`Base geometry: ${IN_PATH}`)
  console.log(`Cameras: MainCamera (perspective), OrthoCamera (orthographic), NestedCamera (nested perspective), AnimatedCamera (animated-parent perspective)`)
  console.log(`Animations: CameraMountRotate (Y-axis rotation of AnimatedCameraMount)`)
}

main().catch(err => { console.error(err); process.exit(1) })
