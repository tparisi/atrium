// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMEvent }  from './SOMEvent.js'
import { SOMMesh }   from './SOMMesh.js'
import { SOMCamera } from './SOMCamera.js'
import { SOMSkin }   from './SOMSkin.js'

export class SOMNode extends SOMObject {
  constructor(node) {
    super()
    this._node   = node
    this._mesh   = undefined   // wired by SOMDocument; undefined = not yet cached
    this._camera = undefined
    this._skin   = undefined
  }

  // Identity
  get name()    { return this._node.getName() }
  set name(v)   {
    this._node.setName(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'name', value: v }))
    }
  }
  get extras()  { return this._node.getExtras() }
  set extras(v) {
    this._node.setExtras(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value: v }))
    }
  }

  // Transform
  get translation()  { return this._node.getTranslation() }
  set translation(v) {
    this._node.setTranslation(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'translation', value: v }))
    }
  }
  get rotation()  { return this._node.getRotation() }
  set rotation(v) {
    this._node.setRotation(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'rotation', value: v }))
    }
  }
  get scale()  { return this._node.getScale() }
  set scale(v) {
    this._node.setScale(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'scale', value: v }))
    }
  }

  // Visibility — stored in extras under a reserved key
  get visible() {
    return this._node.getExtras().__atrium_visible ?? true
  }
  set visible(v) {
    this._node.setExtras({ ...this._node.getExtras(), __atrium_visible: v })
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'visible', value: v }))
    }
  }

  // Attachments — return cached wrappers if wired by SOMDocument, else create on demand
  get mesh() {
    if (this._mesh !== undefined) return this._mesh
    const m = this._node.getMesh()
    return m ? new SOMMesh(m) : null
  }
  set mesh(v) {
    this._mesh = v ?? null
    this._node.setMesh(v ? v._mesh : null)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'mesh', value: v }))
    }
  }

  get camera() {
    if (this._camera !== undefined) return this._camera
    const c = this._node.getCamera()
    return c ? new SOMCamera(c) : null
  }
  set camera(v) {
    this._camera = v ?? null
    this._node.setCamera(v ? v._camera : null)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'camera', value: v }))
    }
  }

  get skin() {
    if (this._skin !== undefined) return this._skin
    const s = this._node.getSkin()
    return s ? new SOMSkin(s) : null
  }

  // Scene graph
  get children() { return this._node.listChildren().map(n => new SOMNode(n)) }
  get parent() {
    const p = this._node.getParentNode()
    return p ? new SOMNode(p) : null
  }

  addChild(node) {
    this._node.addChild(node._node)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:    this,
        childList: { addedNodes: [node.name] },
      }))
    }
  }

  removeChild(node) {
    this._node.removeChild(node._node)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:    this,
        childList: { removedNodes: [node.name] },
      }))
    }
  }

  clone()   { return new SOMNode(this._node.clone()) }
  dispose() {
    this._node.dispose()
    this._onDispose?.()
  }

  // Extensions
  getExtension(name)        { return this._node.getExtension(name) }
  setExtension(name, value) { this._node.setExtension(name, value) }
}
