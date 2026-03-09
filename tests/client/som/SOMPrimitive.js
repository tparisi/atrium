// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMMaterial } from './SOMMaterial.js'

export class SOMPrimitive {
  constructor(primitive) {
    this._primitive = primitive
  }

  get material()  {
    const m = this._primitive.getMaterial()
    return m ? new SOMMaterial(m) : null
  }
  set material(v) { this._primitive.setMaterial(v ? v._material : null) }

  get mode()   { return this._primitive.getMode() }
  set mode(v)  { this._primitive.setMode(v) }

  get extras() { return this._primitive.getExtras() }
  set extras(v){ this._primitive.setExtras(v) }
}
