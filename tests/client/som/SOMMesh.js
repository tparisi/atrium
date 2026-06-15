// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject }    from './SOMObject.js'
import { SOMEvent }     from './SOMEvent.js'
import { SOMPrimitive } from './SOMPrimitive.js'

export class SOMMesh extends SOMObject {
  constructor(mesh, document = null) {
    super()
    this._mesh     = mesh
    this._document = document
    this._prims    = undefined   // wired by SOMDocument; undefined = not yet cached
  }

  get name()    { return this._mesh.getName() }
  set name(v)   {
    this._mesh.setName(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'name', value: v }))
    }
  }
  get weights() { return this._mesh.getWeights() }
  set weights(v){
    this._mesh.setWeights(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'weights', value: v }))
    }
  }
  get extras()  { return this._mesh.getExtras() }
  set extras(v) {
    this._mesh.setExtras(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value: v }))
    }
  }

  // Return cached primitives if wired by SOMDocument, else resolve through document
  get primitives() {
    if (this._prims !== undefined) return this._prims
    return this._mesh.listPrimitives().map(p =>
      (this._document ? this._document._resolvePrimitive(p) : null) ?? new SOMPrimitive(p)
    )
  }

  addPrimitive(primitive) {
    this._mesh.addPrimitive(primitive._primitive)
    if (this._prims !== undefined) this._prims.push(primitive)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:    this,
        childList: { addedNodes: [''] },
      }))
    }
  }

  removePrimitive(primitive) {
    this._mesh.removePrimitive(primitive._primitive)
    if (this._prims !== undefined) {
      this._prims = this._prims.filter(p => p !== primitive)
    }
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:    this,
        childList: { removedNodes: [''] },
      }))
    }
  }
}
