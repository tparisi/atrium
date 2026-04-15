// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Generates tests/fixtures/space-anim.gltf — space.gltf plus two loopable
// animations targeting crate-01: CrateRotate (Y-axis rotation, 4s) and
// CrateBob (Y-axis translation oscillation, 2s).
//
// Run from repo root:
//   node tests/fixtures/generate-space-anim.js

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Resolve gltf-transform relative to packages/server to avoid extra install.
const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)
const { Document, NodeIO } = await import(coreUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const OUT_PATH   = join(__dirname, 'space-anim.gltf')
const SEGMENTS   = 16

// ---------------------------------------------------------------------------
// Geometry builders (identical to generate-space.js)
// ---------------------------------------------------------------------------

function buildBox(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2
  const positions = [], normals = [], indices = []
  const faces = [
    { n: [ 0, 0, 1], pts: [[-x,-y, z], [ x,-y, z], [ x, y, z], [-x, y, z]] },
    { n: [ 0, 0,-1], pts: [[ x,-y,-z], [-x,-y,-z], [-x, y,-z], [ x, y,-z]] },
    { n: [ 1, 0, 0], pts: [[ x,-y, z], [ x,-y,-z], [ x, y,-z], [ x, y, z]] },
    { n: [-1, 0, 0], pts: [[-x,-y,-z], [-x,-y, z], [-x, y, z], [-x, y,-z]] },
    { n: [ 0, 1, 0], pts: [[-x, y, z], [ x, y, z], [ x, y,-z], [-x, y,-z]] },
    { n: [ 0,-1, 0], pts: [[-x,-y,-z], [ x,-y,-z], [ x,-y, z], [-x,-y, z]] },
  ]
  faces.forEach(({ n, pts }, i) => {
    const base = i * 4
    for (const p of pts) { positions.push(...p); normals.push(...n) }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })
  return { positions, normals, indices }
}

function buildCylinder(rTop, rBottom, height, segments) {
  const positions = [], normals = [], indices = []
  const halfH = height / 2
  const slope = (rBottom - rTop) / height
  const nLen  = Math.sqrt(1 + slope * slope)

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    const base = positions.length / 3
    positions.push(
      rBottom * c0, -halfH, rBottom * s0,
      rTop    * c0, +halfH, rTop    * s0,
      rTop    * c1, +halfH, rTop    * s1,
      rBottom * c1, -halfH, rBottom * s1
    )
    normals.push(
      c0 / nLen, slope / nLen, s0 / nLen,
      c0 / nLen, slope / nLen, s0 / nLen,
      c1 / nLen, slope / nLen, s1 / nLen,
      c1 / nLen, slope / nLen, s1 / nLen
    )
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  if (rBottom > 0) {
    const ci = positions.length / 3
    positions.push(0, -halfH, 0); normals.push(0, -1, 0)
    const capStart = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(rBottom * Math.cos(a), -halfH, rBottom * Math.sin(a))
      normals.push(0, -1, 0)
    }
    for (let i = 0; i < segments; i++) indices.push(ci, capStart + i, capStart + i + 1)
  }

  if (rTop > 0) {
    const ci = positions.length / 3
    positions.push(0, halfH, 0); normals.push(0, 1, 0)
    const capStart = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(rTop * Math.cos(a), halfH, rTop * Math.sin(a))
      normals.push(0, 1, 0)
    }
    for (let i = 0; i < segments; i++) indices.push(ci, capStart + i + 1, capStart + i)
  }

  return { positions, normals, indices }
}

// ---------------------------------------------------------------------------
// glTF-Transform helpers (identical to generate-space.js)
// ---------------------------------------------------------------------------

function createMaterial(doc, name, rgb) {
  return doc.createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1.0])
    .setMetallicFactor(0)
    .setRoughnessFactor(1.0)
}

function createMesh(doc, buffer, name, geom, material) {
  const { positions, normals, indices } = geom
  const posAcc = doc.createAccessor().setArray(new Float32Array(positions)).setType('VEC3').setBuffer(buffer)
  const norAcc = doc.createAccessor().setArray(new Float32Array(normals)).setType('VEC3').setBuffer(buffer)
  const idxAcc = doc.createAccessor().setArray(new Uint16Array(indices)).setType('SCALAR').setBuffer(buffer)
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL', norAcc)
    .setIndices(idxAcc)
    .setMaterial(material)
  return doc.createMesh(name).addPrimitive(prim)
}

// ---------------------------------------------------------------------------
// Build document
// ---------------------------------------------------------------------------

async function main() {
  const doc    = new Document()
  const buffer = doc.createBuffer().setURI('buffer.bin')
  const scene  = doc.createScene('Scene')

  doc.getRoot().setExtras({
    atrium: {
      name: 'Space (Animated)',
      description: 'A minimal gray-box test world with animations.',
      author: 'Project Atrium',
      navigation: {
        mode: ['WALK', 'FLY', 'ORBIT', 'TELEPORT'],
        terrainFollowing: true,
        speed: { default: 1.4, min: 0.5, max: 5.0 },
        collision: { enabled: false },
        updateRate: { positionInterval: 1000, maxViewRate: 20 },
      },
    },
  })

  // Ground plane
  const groundMat  = createMaterial(doc, 'mat-ground', [0.5, 0.5, 0.5])
  const groundMesh = createMesh(doc, buffer, 'mesh-ground', buildBox(10, 0.05, 10), groundMat)
  scene.addChild(doc.createNode('ground-plane').setTranslation([0, 0, 0]).setMesh(groundMesh))

  // crate-01 — keep reference for animation targeting
  const crateMat  = createMaterial(doc, 'mat-crate', [0.6, 0.35, 0.1])
  const crateMesh = createMesh(doc, buffer, 'mesh-crate', buildBox(0.5, 0.5, 0.5), crateMat)
  const crateNode = doc.createNode('crate-01').setTranslation([1, 0.25, 0]).setMesh(crateMesh)
  scene.addChild(crateNode)

  // lamp-01
  const lampNode  = doc.createNode('lamp-01').setTranslation([3, 0, 0])
  const standMat  = createMaterial(doc, 'mat-stand', [0.2, 0.2, 0.2])
  const standMesh = createMesh(doc, buffer, 'mesh-stand', buildCylinder(0.05, 0.05, 1.5, SEGMENTS), standMat)
  lampNode.addChild(doc.createNode('lamp-stand').setTranslation([0, 0.75, 0]).setMesh(standMesh))
  const shadeMat  = createMaterial(doc, 'mat-shade', [0.9, 0.85, 0.6])
  const shadeMesh = createMesh(doc, buffer, 'mesh-shade', buildCylinder(0, 0.3, 0.4, SEGMENTS), shadeMat)
  lampNode.addChild(doc.createNode('lamp-shade').setTranslation([0, 1.6, 0]).setMesh(shadeMesh))
  scene.addChild(lampNode)

  // ---------------------------------------------------------------------------
  // Animation: CrateRotate — Y-axis rotation, 4s, 5 keyframes
  //
  // Quaternion for angle θ around Y: [0, sin(θ/2), 0, cos(θ/2)]
  //   t=0  → θ=0       → [0, 0,      0, 1     ]
  //   t=1  → θ=π/2     → [0, 0.3827, 0, 0.9239]
  //   t=2  → θ=π       → [0, 0.7071, 0, 0.7071]
  //   t=3  → θ=3π/2    → [0, 0.9239, 0, 0.3827]
  //   t=4  → θ=2π      → [0, 0,      0, 1     ]  (matches t=0 → seamlessly loopable)
  // ---------------------------------------------------------------------------

  const rotTimes = doc.createAccessor()
    .setArray(new Float32Array([0, 1, 2, 3, 4]))
    .setType('SCALAR')
    .setBuffer(buffer)

  const sin = (a) => Math.sin(a)
  const cos = (a) => Math.cos(a)

  const rotValues = doc.createAccessor()
    .setArray(new Float32Array([
      0, sin(0),       0, cos(0),        // t=0, θ=0
      0, sin(Math.PI / 4), 0, cos(Math.PI / 4),  // t=1, θ=π/2
      0, sin(Math.PI / 2), 0, cos(Math.PI / 2),  // t=2, θ=π
      0, sin(3 * Math.PI / 4), 0, cos(3 * Math.PI / 4), // t=3, θ=3π/2
      0, sin(0),       0, cos(0),        // t=4, θ=2π ≡ 0 (loopable)
    ]))
    .setType('VEC4')
    .setBuffer(buffer)

  const rotSampler = doc.createAnimationSampler()
    .setInput(rotTimes)
    .setOutput(rotValues)
    .setInterpolation('LINEAR')

  const rotChannel = doc.createAnimationChannel()
    .setSampler(rotSampler)
    .setTargetNode(crateNode)
    .setTargetPath('rotation')

  doc.createAnimation('CrateRotate')
    .addSampler(rotSampler)
    .addChannel(rotChannel)

  // ---------------------------------------------------------------------------
  // Animation: CrateBob — Y-axis translation oscillation, 2s, 5 keyframes
  //
  // Resting position: [1, 0.25, 0].  Amplitude ±0.15 m.
  //   t=0.0 → Y=0.25  → [1, 0.25, 0]
  //   t=0.5 → Y=0.40  → [1, 0.40, 0]
  //   t=1.0 → Y=0.25  → [1, 0.25, 0]
  //   t=1.5 → Y=0.10  → [1, 0.10, 0]
  //   t=2.0 → Y=0.25  → [1, 0.25, 0]  (matches t=0 → seamlessly loopable)
  // ---------------------------------------------------------------------------

  const bobTimes = doc.createAccessor()
    .setArray(new Float32Array([0, 0.5, 1.0, 1.5, 2.0]))
    .setType('SCALAR')
    .setBuffer(buffer)

  const bobValues = doc.createAccessor()
    .setArray(new Float32Array([
      1, 0.25, 0,
      1, 0.40, 0,
      1, 0.25, 0,
      1, 0.10, 0,
      1, 0.25, 0,
    ]))
    .setType('VEC3')
    .setBuffer(buffer)

  const bobSampler = doc.createAnimationSampler()
    .setInput(bobTimes)
    .setOutput(bobValues)
    .setInterpolation('LINEAR')

  const bobChannel = doc.createAnimationChannel()
    .setSampler(bobSampler)
    .setTargetNode(crateNode)
    .setTargetPath('translation')

  doc.createAnimation('CrateBob')
    .addSampler(bobSampler)
    .addChannel(bobChannel)

  // ---------------------------------------------------------------------------
  // Write: embed buffer as base64 data URI for a fully self-contained .gltf
  // ---------------------------------------------------------------------------

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
