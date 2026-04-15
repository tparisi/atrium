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

import { SOMObject }    from './SOMObject.js'
import { SOMEvent }     from './SOMEvent.js'
import { SOMScene }     from './SOMScene.js'
import { SOMNode }      from './SOMNode.js'
import { SOMMesh }      from './SOMMesh.js'
import { SOMPrimitive } from './SOMPrimitive.js'
import { SOMMaterial }  from './SOMMaterial.js'
import { SOMCamera }    from './SOMCamera.js'
import { SOMAnimation } from './SOMAnimation.js'
import { SOMTexture }   from './SOMTexture.js'
import { SOMSkin }      from './SOMSkin.js'

export class SOMDocument extends SOMObject {
  constructor(document) {
    super()
    this._document = document
    this._root     = document.getRoot()

    // Maps keyed by glTF-Transform object — for wiring during construction and ingest
    this._materialMap  = new Map()
    this._meshMap      = new Map()
    this._cameraMap    = new Map()
    this._nodeMap      = new Map()
    this._primitiveMap = new Map()
    this._animationMap = new Map()
    this._textureMap   = new Map()
    this._skinMap      = new Map()
    this._sceneMap     = new Map()

    // Map keyed by name — for fast O(1) node lookup
    this._nodesByName      = new Map()
    // Map keyed by name — for fast O(1) animation lookup
    this._animationsByName = new Map()
    // Global flat namespace: all named SOM objects (nodes, animations, document)
    this._objectsByName    = new Map()

    // Register self as '__document__' in global namespace
    this._objectsByName.set('__document__', this)

    this._buildObjectGraph()
  }

  // ---------------------------------------------------------------------------
  // Build full object graph bottom-up
  // ---------------------------------------------------------------------------

  _buildObjectGraph() {
    // Textures (no dependencies)
    for (const t of this._root.listTextures()) {
      this._textureMap.set(t, new SOMTexture(t))
    }

    // Materials
    for (const m of this._root.listMaterials()) {
      this._materialMap.set(m, new SOMMaterial(m))
    }

    // Meshes + primitives
    for (const mesh of this._root.listMeshes()) {
      const somMesh = new SOMMesh(mesh, this)
      this._meshMap.set(mesh, somMesh)
      somMesh._prims = []
      for (const prim of mesh.listPrimitives()) {
        const somPrim = new SOMPrimitive(prim, this)
        this._primitiveMap.set(prim, somPrim)
        somMesh._prims.push(somPrim)
        const mat = prim.getMaterial()
        if (mat) somPrim._material = this._materialMap.get(mat) ?? null
      }
    }

    // Cameras
    for (const c of this._root.listCameras()) {
      this._cameraMap.set(c, new SOMCamera(c))
    }

    // Skins
    for (const s of this._root.listSkins()) {
      this._skinMap.set(s, new SOMSkin(s, this))
    }

    // Nodes — wire mesh, camera, skin; register in _nodesByName + _objectsByName
    for (const n of this._root.listNodes()) {
      const somNode = new SOMNode(n, this)
      this._nodeMap.set(n, somNode)
      const name = n.getName()
      this._nodesByName.set(name, somNode)
      this._registerObject(name, somNode)
      this._registerNodeDispose(n, somNode)
      const m = n.getMesh()
      if (m) somNode._mesh = this._meshMap.get(m) ?? null
      const c = n.getCamera()
      if (c) somNode._camera = this._cameraMap.get(c) ?? null
      const sk = n.getSkin()
      if (sk) somNode._skin = this._skinMap.get(sk) ?? null
    }

    // Animations — register in _animationsByName + _objectsByName (with collision check)
    for (const a of this._root.listAnimations()) {
      const somAnim = new SOMAnimation(a)
      this._animationMap.set(a, somAnim)
      const name = a.getName()
      this._animationsByName.set(name, somAnim)
      this._registerObject(name, somAnim)
    }

    // Scenes
    for (const sc of this._root.listScenes()) {
      this._sceneMap.set(sc, new SOMScene(sc, this))
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Register a named SOM object in the global namespace.
   * Logs a warning and returns false if the name is already taken.
   */
  _registerObject(name, somObject) {
    if (this._objectsByName.has(name)) {
      const existing = this._objectsByName.get(name)
      console.warn(
        `SOM: duplicate name "${name}" — ` +
        `${existing.constructor.name} already registered, ` +
        `${somObject.constructor.name} will not be addressable by name`
      )
      return false
    }
    this._objectsByName.set(name, somObject)
    return true
  }

  /** Register a dispose callback so the node removes itself from caches when disposed. */
  _registerNodeDispose(gltfNode, somNode) {
    const name = gltfNode.getName()
    somNode._onDispose = () => {
      this._nodeMap.delete(gltfNode)
      this._nodesByName.delete(name)
      this._objectsByName.delete(name)
    }
  }

  // ---------------------------------------------------------------------------
  // Document accessor
  // ---------------------------------------------------------------------------

  get document() { return this._document }

  // ---------------------------------------------------------------------------
  // Document root extras
  // ---------------------------------------------------------------------------

  get extras() {
    return this._root.getExtras()
  }

  set extras(value) {
    this._root.setExtras(value)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value }))
    }
  }

  /**
   * Mutate a single field inside extras.atrium by dot-delimited path.
   * e.g. setExtrasAtrium('background.texture', 'sky.png')
   * Fires a mutation event via the extras setter.
   */
  setExtrasAtrium(path, value) {
    const extras = structuredClone(this.extras || {})
    const atrium = extras.atrium || (extras.atrium = {})

    const segments = path.split('.')
    let target = atrium
    for (let i = 0; i < segments.length - 1; i++) {
      if (target[segments[i]] === undefined || target[segments[i]] === null) {
        target[segments[i]] = {}
      }
      target = target[segments[i]]
    }
    target[segments[segments.length - 1]] = value

    this.extras = { ...extras, atrium }
  }

  // ---------------------------------------------------------------------------
  // Scene graph entry point
  // ---------------------------------------------------------------------------

  get scene() {
    const sc = this._root.listScenes()[0]
    return sc ? (this._sceneMap.get(sc) ?? new SOMScene(sc, this)) : null
  }

  // ---------------------------------------------------------------------------
  // Node lookup (O(1) via name map)
  // ---------------------------------------------------------------------------

  getNodeByName(name) {
    return this._nodesByName.get(name) ?? null
  }

  // ---------------------------------------------------------------------------
  // Animation lookup (O(1) via name map)
  // ---------------------------------------------------------------------------

  getAnimationByName(name) {
    return this._animationsByName.get(name) ?? null
  }

  // ---------------------------------------------------------------------------
  // Global namespace lookup — returns any SOM object by name
  // ---------------------------------------------------------------------------

  getObjectByName(name) {
    return this._objectsByName.get(name) ?? null
  }

  // ---------------------------------------------------------------------------
  // Collections — return cached wrapper instances
  // ---------------------------------------------------------------------------

  get nodes()      { return Array.from(this._nodesByName.values()) }
  get meshes()     { return Array.from(this._meshMap.values()) }
  get materials()  { return Array.from(this._materialMap.values()) }
  get cameras()    { return Array.from(this._cameraMap.values()) }
  get animations() { return Array.from(this._animationMap.values()) }
  get textures()   { return Array.from(this._textureMap.values()) }
  get skins()      { return Array.from(this._skinMap.values()) }

  // ---------------------------------------------------------------------------
  // Private cache resolution helpers — resolve glTF-Transform objects to the
  // single cached SOM wrapper instance registered at build/ingest time.
  // Used by child accessors in SOMScene, SOMNode, SOMSkin, SOMMesh, SOMPrimitive
  // to guarantee wrapper identity and preserve mutation listener wiring.
  // ---------------------------------------------------------------------------

  _resolveNode(n)     { return this._nodeMap.get(n)      ?? null }
  _resolveMesh(m)     { return this._meshMap.get(m)      ?? null }
  _resolveCamera(c)   { return this._cameraMap.get(c)    ?? null }
  _resolvePrimitive(p){ return this._primitiveMap.get(p) ?? null }
  _resolveMaterial(m) { return this._materialMap.get(m)  ?? null }
  _resolveSkin(s)     { return this._skinMap.get(s)      ?? null }

  // ---------------------------------------------------------------------------
  // Factories — create + register in maps
  // ---------------------------------------------------------------------------

  createNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)
    const somNode = new SOMNode(node, this)
    this._nodeMap.set(node, somNode)
    const name = node.getName()
    this._nodesByName.set(name, somNode)
    this._registerObject(name, somNode)
    this._registerNodeDispose(node, somNode)
    return somNode
  }

  createMesh(descriptor = {}) {
    const mesh    = this._document.createMesh(descriptor.name ?? '')
    const somMesh = new SOMMesh(mesh, this)
    somMesh._prims = []
    this._meshMap.set(mesh, somMesh)
    return somMesh
  }

  createMaterial(descriptor = {}) {
    const mat = this._document.createMaterial(descriptor.name ?? '')
    if (descriptor.baseColorFactor !== undefined)  mat.setBaseColorFactor(descriptor.baseColorFactor)
    if (descriptor.metallicFactor  !== undefined)  mat.setMetallicFactor(descriptor.metallicFactor)
    if (descriptor.roughnessFactor !== undefined)  mat.setRoughnessFactor(descriptor.roughnessFactor)
    const somMat = new SOMMaterial(mat)
    this._materialMap.set(mat, somMat)
    return somMat
  }

  createCamera(descriptor = {}) {
    const cam    = this._document.createCamera(descriptor.name ?? '')
    if (descriptor.type) cam.setType(descriptor.type)
    const somCam = new SOMCamera(cam)
    this._cameraMap.set(cam, somCam)
    return somCam
  }

  createPrimitive(descriptor = {}) {
    const prim    = this._document.createPrimitive()
    const somPrim = new SOMPrimitive(prim, this)
    this._primitiveMap.set(prim, somPrim)
    return somPrim
  }

  createAnimation(descriptor = {}) {
    const anim    = this._document.createAnimation(descriptor.name ?? '')
    const somAnim = new SOMAnimation(anim)
    this._animationMap.set(anim, somAnim)
    const name = anim.getName()
    this._animationsByName.set(name, somAnim)
    this._registerObject(name, somAnim)
    return somAnim
  }

  // ---------------------------------------------------------------------------
  // ingestNode — create node + full mesh geometry, register everything in maps
  // ---------------------------------------------------------------------------

  ingestNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)

    const somNode = new SOMNode(node, this)
    this._nodeMap.set(node, somNode)
    const name = node.getName()
    this._nodesByName.set(name, somNode)
    this._registerObject(name, somNode)
    this._registerNodeDispose(node, somNode)

    if (descriptor.mesh) {
      const mesh    = this._document.createMesh(descriptor.mesh.name ?? '')
      const somMesh = new SOMMesh(mesh, this)
      somMesh._prims = []
      this._meshMap.set(mesh, somMesh)
      somNode._mesh = somMesh

      for (const primDesc of descriptor.mesh.primitives ?? []) {
        const prim = this._document.createPrimitive()
        const buf  = this._document.createBuffer()

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

        const somPrim = new SOMPrimitive(prim, this)
        this._primitiveMap.set(prim, somPrim)
        somMesh._prims.push(somPrim)

        if (primDesc.material) {
          const mat = this._document.createMaterial()
          const pbr = primDesc.material.pbrMetallicRoughness
          if (pbr?.baseColorFactor)              mat.setBaseColorFactor(pbr.baseColorFactor)
          if (pbr?.metallicFactor  !== undefined) mat.setMetallicFactor(pbr.metallicFactor)
          if (pbr?.roughnessFactor !== undefined) mat.setRoughnessFactor(pbr.roughnessFactor)
          const somMat = new SOMMaterial(mat)
          this._materialMap.set(mat, somMat)
          somPrim._material = somMat
          prim.setMaterial(mat)
        }

        mesh.addPrimitive(prim)
      }
      node.setMesh(mesh)
    }

    return somNode
  }

  // ---------------------------------------------------------------------------
  // ingestExternalScene — copy a parsed external Document under a container node
  // ---------------------------------------------------------------------------

  /**
   * Walk the default scene of `externalDocument`, copy all its nodes (with
   * prefixed names), meshes, materials, and geometry into this document, and
   * attach them as children of the container node named `containerName`.
   *
   * Naming: every ingested node's SOM name becomes `containerName/originalName`.
   * Nested children follow naturally: `containerName/Parent/Child`.
   *
   * The external document's root `extras` (including `extras.atrium`) are NOT
   * copied — only the scene graph and geometry are consumed.
   *
   * @param {string}   containerName    - Name of the existing SOM container node
   * @param {Document} externalDocument - Parsed glTF-Transform Document
   * @returns {SOMNode[]} Newly created top-level SOMNode instances
   */
  ingestExternalScene(containerName, externalDocument) {
    const containerSomNode = this.getNodeByName(containerName)
    if (!containerSomNode) throw new Error(`Container node "${containerName}" not found in SOM`)

    const extRoot  = externalDocument.getRoot()
    const extScene = extRoot.listScenes()[0]
    if (!extScene) return []

    // Shared buffer for all copied geometry
    const buf = this._document.createBuffer()

    // Copy-through caches: ext glTF-Transform object → world glTF-Transform object
    const matCopyMap  = new Map()
    const meshCopyMap = new Map()

    const copyAccessor = (extAcc) => {
      const arr = extAcc.getArray()
      return this._document.createAccessor()
        .setType(extAcc.getType())
        .setArray(arr.slice())
        .setBuffer(buf)
    }

    const copyMaterial = (extMat) => {
      if (matCopyMap.has(extMat)) return matCopyMap.get(extMat)
      const mat = this._document.createMaterial(extMat.getName())
        .setBaseColorFactor(extMat.getBaseColorFactor())
        .setMetallicFactor(extMat.getMetallicFactor())
        .setRoughnessFactor(extMat.getRoughnessFactor())
        .setEmissiveFactor(extMat.getEmissiveFactor())
        .setAlphaMode(extMat.getAlphaMode())
      const somMat = new SOMMaterial(mat)
      this._materialMap.set(mat, somMat)
      matCopyMap.set(extMat, mat)
      return mat
    }

    const copyMesh = (extMesh) => {
      if (meshCopyMap.has(extMesh)) return meshCopyMap.get(extMesh)
      const mesh    = this._document.createMesh(extMesh.getName())
      const somMesh = new SOMMesh(mesh, this)
      somMesh._prims = []
      this._meshMap.set(mesh, somMesh)
      meshCopyMap.set(extMesh, mesh)

      for (const extPrim of extMesh.listPrimitives()) {
        const prim = this._document.createPrimitive()

        for (const semantic of extPrim.listSemantics()) {
          prim.setAttribute(semantic, copyAccessor(extPrim.getAttribute(semantic)))
        }

        const extIdx = extPrim.getIndices()
        if (extIdx) prim.setIndices(copyAccessor(extIdx))

        const extMat = extPrim.getMaterial()
        if (extMat) prim.setMaterial(copyMaterial(extMat))

        const somPrim = new SOMPrimitive(prim, this)
        const copiedMat = prim.getMaterial()
        if (copiedMat) somPrim._material = this._materialMap.get(copiedMat) ?? null
        this._primitiveMap.set(prim, somPrim)
        somMesh._prims.push(somPrim)
        mesh.addPrimitive(prim)
      }

      return mesh
    }

    // Recursively copy a node from the external document.
    // namePrefix is e.g. "Crate/" for root nodes, "Crate/Parent/" for children.
    const copyNode = (extNode, namePrefix) => {
      const prefixedName = namePrefix + extNode.getName()
      const node = this._document.createNode(prefixedName)
      node.setTranslation(extNode.getTranslation())
      node.setRotation(extNode.getRotation())
      node.setScale(extNode.getScale())
      const extras = extNode.getExtras()
      if (extras && Object.keys(extras).length > 0) node.setExtras(extras)

      const somNode = new SOMNode(node, this)
      this._nodeMap.set(node, somNode)
      this._nodesByName.set(prefixedName, somNode)
      this._registerObject(prefixedName, somNode)
      this._registerNodeDispose(node, somNode)

      const extMesh = extNode.getMesh()
      if (extMesh) {
        const mesh = copyMesh(extMesh)
        node.setMesh(mesh)
        somNode._mesh = this._meshMap.get(mesh) ?? null
      }

      for (const extChild of extNode.listChildren()) {
        const childSomNode = copyNode(extChild, prefixedName + '/')
        node.addChild(childSomNode._node)
      }

      return somNode
    }

    const newTopLevelNodes = []
    for (const extNode of extScene.listChildren()) {
      const somNode = copyNode(extNode, containerName + '/')
      containerSomNode._node.addChild(somNode._node)
      newTopLevelNodes.push(somNode)
    }

    // Fire childList mutation event on the container node
    if (containerSomNode._hasListeners('mutation')) {
      containerSomNode._dispatchEvent(new SOMEvent('mutation', {
        target:    containerSomNode,
        childList: { addedNodes: newTopLevelNodes.map(n => n.name) },
      }))
    }

    return newTopLevelNodes
  }

  // ---------------------------------------------------------------------------
  // Path resolution
  // ---------------------------------------------------------------------------

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
