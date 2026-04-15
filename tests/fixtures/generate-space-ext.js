// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Generates four files for external-reference testing:
//   tests/fixtures/crate.gltf              — standalone crate (box mesh, green)
//   tests/fixtures/lamp.gltf               — standalone lamp (stand + shade geometry)
//   tests/fixtures/space-ext.gltf          — world with floor + two container nodes
//   tests/fixtures/space-ext.atrium.json   — config pointing at space-ext.gltf
//
// Run from repo root:
//   node tests/fixtures/generate-space-ext.js

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)
const { Document, NodeIO } = await import(coreUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const SEGMENTS   = 16

// ---------------------------------------------------------------------------
// Geometry builders — same as generate-space.js
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
// glTF-Transform helpers
// ---------------------------------------------------------------------------

function createMaterial(doc, name, rgb, opts = {}) {
  const mat = doc.createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1.0])
    .setMetallicFactor(0)
    .setRoughnessFactor(1.0)
  if (opts.emissive) mat.setEmissiveFactor(opts.emissive)
  return mat
}

function createMesh(doc, buffer, name, geom, material) {
  const { positions, normals, indices } = geom

  const posAcc = doc.createAccessor()
    .setArray(new Float32Array(positions))
    .setType('VEC3')
    .setBuffer(buffer)

  const norAcc = doc.createAccessor()
    .setArray(new Float32Array(normals))
    .setType('VEC3')
    .setBuffer(buffer)

  const idxAcc = doc.createAccessor()
    .setArray(new Uint16Array(indices))
    .setType('SCALAR')
    .setBuffer(buffer)

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL',   norAcc)
    .setIndices(idxAcc)
    .setMaterial(material)

  return doc.createMesh(name).addPrimitive(prim)
}

// Embed buffers as base64 data URIs for a fully self-contained .gltf
async function writeEmbedded(doc, io, outPath) {
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
  writeFileSync(outPath, JSON.stringify(json, null, 2))
  console.log(`Written: ${outPath}`)
}

// ---------------------------------------------------------------------------
// crate.gltf — standalone box (green), single node "Crate"
// ---------------------------------------------------------------------------

async function buildCrate(io) {
  const doc    = new Document()
  const buf    = doc.createBuffer().setURI('buffer.bin')
  const scene  = doc.createScene('Scene')
  const mat    = createMaterial(doc, 'mat-crate', [0.2, 0.8, 0.2])
  const mesh   = createMesh(doc, buf, 'mesh-crate', buildBox(0.5, 0.5, 0.5), mat)
  const node   = doc.createNode('Crate').setTranslation([0, 0.25, 0]).setMesh(mesh)
  scene.addChild(node)
  await writeEmbedded(doc, io, join(__dirname, 'crate.gltf'))
}

// ---------------------------------------------------------------------------
// lamp.gltf — standalone lamp, single node "Lamp" with two child nodes
// ---------------------------------------------------------------------------

async function buildLamp(io) {
  const doc   = new Document()
  const buf   = doc.createBuffer().setURI('buffer.bin')
  const scene = doc.createScene('Scene')

  const lampNode = doc.createNode('Lamp').setTranslation([0, 0, 0])

  const standMat  = createMaterial(doc, 'mat-stand', [0.2, 0.2, 0.2])
  const standMesh = createMesh(doc, buf, 'mesh-stand', buildCylinder(0.05, 0.05, 1.5, SEGMENTS), standMat)
  const standNode = doc.createNode('lamp-stand').setTranslation([0, 0.75, 0]).setMesh(standMesh)
  lampNode.addChild(standNode)

  const shadeMat  = createMaterial(doc, 'mat-shade', [0.9, 0.85, 0.6], { emissive: [0.5, 0.45, 0.1] })
  const shadeMesh = createMesh(doc, buf, 'mesh-shade', buildCylinder(0, 0.3, 0.4, SEGMENTS), shadeMat)
  const shadeNode = doc.createNode('lamp-shade').setTranslation([0, 1.6, 0]).setMesh(shadeMesh)
  lampNode.addChild(shadeNode)

  scene.addChild(lampNode)
  await writeEmbedded(doc, io, join(__dirname, 'lamp.gltf'))
}

// ---------------------------------------------------------------------------
// space-ext.gltf — world with floor + two container nodes (no inline geometry)
// ---------------------------------------------------------------------------

async function buildSpaceExt(io) {
  const doc    = new Document()
  const buf    = doc.createBuffer().setURI('buffer.bin')
  const scene  = doc.createScene('Scene')

  doc.getRoot().setExtras({
    atrium: {
      name: 'Space (External Refs)',
      description: 'A gray-box test world with external glTF references.',
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

  // Inline floor geometry
  const groundMat  = createMaterial(doc, 'mat-ground', [0.5, 0.5, 0.5])
  const groundMesh = createMesh(doc, buf, 'mesh-ground', buildBox(10, 0.05, 10), groundMat)
  const floorNode  = doc.createNode('Floor').setTranslation([0, 0, 0]).setMesh(groundMesh)
  scene.addChild(floorNode)

  // Container node: Crate (references ./crate.gltf)
  const crateContainer = doc.createNode('Crate')
    .setTranslation([1, 0, 0])
    .setExtras({ atrium: { source: './crate.gltf' } })
  scene.addChild(crateContainer)

  // Container node: Light (references ./lamp.gltf)
  const lightContainer = doc.createNode('Light')
    .setTranslation([3, 0, 0])
    .setExtras({ atrium: { source: './lamp.gltf' } })
  scene.addChild(lightContainer)

  await writeEmbedded(doc, io, join(__dirname, 'space-ext.gltf'))
}

// ---------------------------------------------------------------------------
// space-ext.atrium.json
// ---------------------------------------------------------------------------

function buildAtriumJson() {
  const config = {
    version: '0.1.0',
    world: {
      gltf:   './space-ext.gltf',
      server: 'ws://localhost:3000',
    },
  }
  const outPath = join(__dirname, 'space-ext.atrium.json')
  writeFileSync(outPath, JSON.stringify(config, null, 2))
  console.log(`Written: ${outPath}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const io = new NodeIO()
  await buildCrate(io)
  await buildLamp(io)
  await buildSpaceExt(io)
  buildAtriumJson()
  console.log('All fixture files written.')
}

main().catch(err => { console.error(err); process.exit(1) })
