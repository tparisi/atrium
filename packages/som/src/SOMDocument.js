// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Path resolver helpers (module-private)
// ---------------------------------------------------------------------------

function parsePath(path) {
  const segments = []
  const re = /([^.[]+)|\[(\d+)\]/g
  let match
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1])
    } else {
      segments.push(parseInt(match[2], 10))
    }
  }
  if (segments.length === 0) throw new Error(`Empty path: "${path}"`)
  return segments
}

function resolvePath(somNode, segments) {
  let current = somNode
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const next = current[seg]
    if (next == null) throw new Error(`Path segment "${seg}" resolved to null/undefined`)
    current = next
  }
  const key = segments[segments.length - 1]
  return { target: current, key }
}

import { SOMScene }     from './SOMScene.js'
import { SOMNode }      from './SOMNode.js'
import { SOMMesh }      from './SOMMesh.js'
import { SOMPrimitive } from './SOMPrimitive.js'
import { SOMMaterial }  from './SOMMaterial.js'
import { SOMCamera }    from './SOMCamera.js'
import { SOMAnimation } from './SOMAnimation.js'
import { SOMTexture }   from './SOMTexture.js'
import { SOMSkin }      from './SOMSkin.js'

export class SOMDocument {
  constructor(document) {
    this._document = document
    this._root     = document.getRoot()
  }

  // Scene graph entry point
  get scene() { return new SOMScene(this._root.listScenes()[0]) }

  // Document accessor
  get document() { return this._document; }

  // Node lookup
  getNodeByName(name) {
    const node = this._root.listNodes().find(n => n.getName() === name)
    return node ? new SOMNode(node) : null
  }

  // Collections
  get nodes()      { return this._root.listNodes().map(n => new SOMNode(n)) }
  get meshes()     { return this._root.listMeshes().map(m => new SOMMesh(m)) }
  get materials()  { return this._root.listMaterials().map(m => new SOMMaterial(m)) }
  get cameras()    { return this._root.listCameras().map(c => new SOMCamera(c)) }
  get animations() { return this._root.listAnimations().map(a => new SOMAnimation(a)) }
  get textures()   { return this._root.listTextures().map(t => new SOMTexture(t)) }
  get skins()      { return this._root.listSkins().map(s => new SOMSkin(s)) }

  // Factories
  createNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)
    return new SOMNode(node)
  }

  createMesh(descriptor = {}) {
    const mesh = this._document.createMesh(descriptor.name ?? '')
    return new SOMMesh(mesh)
  }

  createMaterial(descriptor = {}) {
    const mat = this._document.createMaterial(descriptor.name ?? '')
    if (descriptor.baseColorFactor !== undefined)  mat.setBaseColorFactor(descriptor.baseColorFactor)
    if (descriptor.metallicFactor  !== undefined)  mat.setMetallicFactor(descriptor.metallicFactor)
    if (descriptor.roughnessFactor !== undefined)  mat.setRoughnessFactor(descriptor.roughnessFactor)
    return new SOMMaterial(mat)
  }

  createCamera(descriptor = {}) {
    const cam = this._document.createCamera(descriptor.name ?? '')
    if (descriptor.type) cam.setType(descriptor.type)
    return new SOMCamera(cam)
  }

  createPrimitive(descriptor = {}) {
    const prim = this._document.createPrimitive()
    return new SOMPrimitive(prim)
  }

  // Stubs for v0.1
  createAnimation(descriptor = {}) {
    const anim = this._document.createAnimation(descriptor.name ?? '')
    return new SOMAnimation(anim)
  }

  // Ingest a glTF node descriptor that may include mesh geometry data.
  // Handles primitives with POSITION/NORMAL arrays and indices.
  ingestNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)

    if (descriptor.mesh) {
      const mesh = this._document.createMesh(descriptor.mesh.name ?? '')
      for (const primDesc of descriptor.mesh.primitives ?? []) {
        const prim  = this._document.createPrimitive()
        const buf   = this._document.createBuffer()

        if (Array.isArray(primDesc.attributes?.POSITION)) {
          const acc = this._document.createAccessor()
            .setType('VEC3')
            .setArray(new Float32Array(primDesc.attributes.POSITION))
            .setBuffer(buf)
          prim.setAttribute('POSITION', acc)
        }

        if (Array.isArray(primDesc.attributes?.NORMAL)) {
          const acc = this._document.createAccessor()
            .setType('VEC3')
            .setArray(new Float32Array(primDesc.attributes.NORMAL))
            .setBuffer(buf)
          prim.setAttribute('NORMAL', acc)
        }

        if (Array.isArray(primDesc.indices)) {
          const acc = this._document.createAccessor()
            .setType('SCALAR')
            .setArray(new Uint16Array(primDesc.indices))
            .setBuffer(buf)
          prim.setIndices(acc)
        }

        if (primDesc.material) {
          const mat = this._document.createMaterial()
          const pbr = primDesc.material.pbrMetallicRoughness
          if (pbr?.baseColorFactor)             mat.setBaseColorFactor(pbr.baseColorFactor)
          if (pbr?.metallicFactor  !== undefined) mat.setMetallicFactor(pbr.metallicFactor)
          if (pbr?.roughnessFactor !== undefined) mat.setRoughnessFactor(pbr.roughnessFactor)
          prim.setMaterial(mat)
        }

        mesh.addPrimitive(prim)
      }
      node.setMesh(mesh)
    }

    return new SOMNode(node)
  }

  // Path resolution
  getPath(somNode, path) {
    const segments = parsePath(path)
    const { target, key } = resolvePath(somNode, segments)
    return target[key]
  }

  setPath(somNode, path, value) {
    const segments = parsePath(path)
    const { target, key } = resolvePath(somNode, segments)
    if (typeof key === 'string' && !(key in target)) {
      throw new Error(`Unknown property "${key}" on ${target?.constructor?.name ?? 'object'}`)
    }
    target[key] = value
  }
}
