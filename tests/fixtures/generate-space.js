// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// One-off script to generate tests/fixtures/space.gltf with real geometry.
// Run from repo root:
//   node tests/fixtures/generate-space.js

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Dynamic import: resolve gltf-transform relative to this file so no extra
// install is needed — it's already a dependency of packages/server.
const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)
const { Document, NodeIO } = await import(coreUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const OUT_PATH = join(__dirname, 'space.gltf')
const SEGMENTS = 16

// ---------------------------------------------------------------------------
// Geometry builders — return { positions: number[], normals: number[], indices: number[] }
// All meshes are centered at the origin; position via node translation.
// Winding: CCW when viewed from outside (right-hand, glTF default).
// ---------------------------------------------------------------------------

function buildBox(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2
  const positions = [], normals = [], indices = []

  // Each face: 4 verts (separate for flat normals), 2 tris.
  // Winding verified: cross(e1,e2) points outward for each face.
  const faces = [
    { n: [ 0, 0, 1], pts: [[-x,-y, z], [ x,-y, z], [ x, y, z], [-x, y, z]] }, // +Z
    { n: [ 0, 0,-1], pts: [[ x,-y,-z], [-x,-y,-z], [-x, y,-z], [ x, y,-z]] }, // -Z
    { n: [ 1, 0, 0], pts: [[ x,-y, z], [ x,-y,-z], [ x, y,-z], [ x, y, z]] }, // +X
    { n: [-1, 0, 0], pts: [[-x,-y,-z], [-x,-y, z], [-x, y, z], [-x, y,-z]] }, // -X
    { n: [ 0, 1, 0], pts: [[-x, y, z], [ x, y, z], [ x, y,-z], [-x, y,-z]] }, // +Y
    { n: [ 0,-1, 0], pts: [[-x,-y,-z], [ x,-y,-z], [ x,-y, z], [-x,-y, z]] }, // -Y
  ]

  faces.forEach(({ n, pts }, i) => {
    const base = i * 4
    for (const p of pts) { positions.push(...p); normals.push(...n) }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })

  return { positions, normals, indices }
}

// rTop / rBottom: top and bottom radii (0 = cone tip / flat bottom with no cap)
// Cylinder is centered at origin: bottom at y=-height/2, top at y=+height/2.
function buildCylinder(rTop, rBottom, height, segments) {
  const positions = [], normals = [], indices = []
  const halfH = height / 2

  // Outward normal slope for tapered cylinder
  const slope = (rBottom - rTop) / height
  const nLen = Math.sqrt(1 + slope * slope)

  // ---- Sides ----
  // Quad layout per segment: b0, t0, t1, b1 (CCW from outside verified)
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)

    const base = positions.length / 3
    // b0, t0, t1, b1
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
    // Two tris: (b0,t0,t1) and (b0,t1,b1)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  // ---- Bottom cap (normal -Y) ----
  // Fan: (center, v_i, v_{i+1}) → cross gives -Y for increasing angle. ✓
  if (rBottom > 0) {
    const ci = positions.length / 3
    positions.push(0, -halfH, 0)
    normals.push(0, -1, 0)
    const capStart = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(rBottom * Math.cos(a), -halfH, rBottom * Math.sin(a))
      normals.push(0, -1, 0)
    }
    for (let i = 0; i < segments; i++) {
      indices.push(ci, capStart + i, capStart + i + 1)
    }
  }

  // ---- Top cap (normal +Y) ----
  // Fan reversed: (center, v_{i+1}, v_i) → cross gives +Y. ✓
  if (rTop > 0) {
    const ci = positions.length / 3
    positions.push(0, halfH, 0)
    normals.push(0, 1, 0)
    const capStart = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(rTop * Math.cos(a), halfH, rTop * Math.sin(a))
      normals.push(0, 1, 0)
    }
    for (let i = 0; i < segments; i++) {
      indices.push(ci, capStart + i + 1, capStart + i)
    }
  }

  return { positions, normals, indices }
}

// ---------------------------------------------------------------------------
// glTF-Transform helpers
// ---------------------------------------------------------------------------

function createMaterial(doc, name, rgb) {
  return doc.createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1.0])
    .setMetallicFactor(0)
    .setRoughnessFactor(1.0)
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
    .setAttribute('NORMAL', norAcc)
    .setIndices(idxAcc)
    .setMaterial(material)

  return doc.createMesh(name).addPrimitive(prim)
}

// ---------------------------------------------------------------------------
// Build document
// ---------------------------------------------------------------------------

async function main() {
  const doc = new Document()
  const buffer = doc.createBuffer().setURI('buffer.bin')
  const scene = doc.createScene('Scene')

  doc.getRoot().setExtras({
    atrium: {
      name: 'Space',
      description: 'A minimal gray-box test world.',
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

  // Ground plane — 10 × 0.05 × 10, centered at origin, y=0
  const groundMat = createMaterial(doc, 'mat-ground', [0.5, 0.5, 0.5])
  const groundMesh = createMesh(doc, buffer, 'mesh-ground', buildBox(10, 0.05, 10), groundMat)
  const groundNode = doc.createNode('ground-plane')
    .setTranslation([0, 0, 0])
    .setMesh(groundMesh)
  scene.addChild(groundNode)

  // crate-01 — 0.5 × 0.5 × 0.5, sitting on ground
  const crateMat = createMaterial(doc, 'mat-crate', [0.6, 0.35, 0.1])
  const crateMesh = createMesh(doc, buffer, 'mesh-crate', buildBox(0.5, 0.5, 0.5), crateMat)
  const crateNode = doc.createNode('crate-01')
    .setTranslation([1, 0.25, 0])
    .setMesh(crateMesh)
  scene.addChild(crateNode)

  // lamp-01 — parent node
  const lampNode = doc.createNode('lamp-01').setTranslation([3, 0, 0])

  // lamp-stand — cylinder r=0.05, h=1.5, centered at [0,0.75,0] relative to parent
  const standMat = createMaterial(doc, 'mat-stand', [0.2, 0.2, 0.2])
  const standMesh = createMesh(doc, buffer, 'mesh-stand',
    buildCylinder(0.05, 0.05, 1.5, SEGMENTS), standMat)
  const standNode = doc.createNode('lamp-stand')
    .setTranslation([0, 0.75, 0])
    .setMesh(standMesh)
  lampNode.addChild(standNode)

  // lamp-shade — cone (top r=0, bottom r=0.3, h=0.4) at [0,1.6,0] relative to parent
  const shadeMat = createMaterial(doc, 'mat-shade', [0.9, 0.85, 0.6])
  const shadeMesh = createMesh(doc, buffer, 'mesh-shade',
    buildCylinder(0, 0.3, 0.4, SEGMENTS), shadeMat)
  const shadeNode = doc.createNode('lamp-shade')
    .setTranslation([0, 1.6, 0])
    .setMesh(shadeMesh)
  lampNode.addChild(shadeNode)

  scene.addChild(lampNode)

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
}

main().catch(err => { console.error(err); process.exit(1) })
