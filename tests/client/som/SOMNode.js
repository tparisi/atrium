// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMMesh }   from './SOMMesh.js'
import { SOMCamera } from './SOMCamera.js'
import { SOMSkin }   from './SOMSkin.js'

export class SOMNode {
  constructor(node) {
    this._node = node
  }

  // Identity
  get name()          { return this._node.getName() }
  set name(v)         { this._node.setName(v) }
  get extras()        { return this._node.getExtras() }
  set extras(v)       { this._node.setExtras(v) }

  // Transform
  get translation()   { return this._node.getTranslation() }
  set translation(v)  { this._node.setTranslation(v) }
  get rotation()      { return this._node.getRotation() }
  set rotation(v)     { this._node.setRotation(v) }
  get scale()         { return this._node.getScale() }
  set scale(v)        { this._node.setScale(v) }

  // Visibility — stored in extras under a reserved key
  get visible() {
    return this._node.getExtras().__atrium_visible ?? true
  }
  set visible(v) {
    this._node.setExtras({ ...this._node.getExtras(), __atrium_visible: v })
  }

  // Attachments
  get mesh() {
    const m = this._node.getMesh()
    return m ? new SOMMesh(m) : null
  }
  set mesh(v) { this._node.setMesh(v ? v._mesh : null) }

  get camera() {
    const c = this._node.getCamera()
    return c ? new SOMCamera(c) : null
  }
  set camera(v) { this._node.setCamera(v ? v._camera : null) }

  get skin() {
    const s = this._node.getSkin()
    return s ? new SOMSkin(s) : null
  }

  // Scene graph
  get children() { return this._node.listChildren().map(n => new SOMNode(n)) }
  get parent() {
    const p = this._node.getParentNode()
    return p ? new SOMNode(p) : null
  }

  addChild(node)    { this._node.addChild(node._node) }
  removeChild(node) { this._node.removeChild(node._node) }
  clone()           { return new SOMNode(this._node.clone()) }
  dispose()         { this._node.dispose() }

  // Extensions
  getExtension(name)        { return this._node.getExtension(name) }
  setExtension(name, value) { this._node.setExtension(name, value) }
}
