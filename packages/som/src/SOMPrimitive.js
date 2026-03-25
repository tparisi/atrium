// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject }  from './SOMObject.js'
import { SOMEvent }   from './SOMEvent.js'
import { SOMMaterial } from './SOMMaterial.js'

export class SOMPrimitive extends SOMObject {
  constructor(primitive) {
    super()
    this._primitive = primitive
    this._material  = undefined   // wired by SOMDocument; undefined = not yet cached
  }

  // Return cached material if wired by SOMDocument, else create on demand
  get material() {
    if (this._material !== undefined) return this._material
    const m = this._primitive.getMaterial()
    return m ? new SOMMaterial(m) : null
  }
  set material(v) {
    this._material = v ?? null
    this._primitive.setMaterial(v ? v._material : null)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'material', value: v }))
    }
  }

  get mode()   { return this._primitive.getMode() }
  set mode(v)  {
    this._primitive.setMode(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'mode', value: v }))
    }
  }

  get extras() { return this._primitive.getExtras() }
  set extras(v){
    this._primitive.setExtras(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value: v }))
    }
  }
}
