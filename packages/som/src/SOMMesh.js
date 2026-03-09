// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMPrimitive } from './SOMPrimitive.js'

export class SOMMesh {
  constructor(mesh) {
    this._mesh = mesh
  }

  get name()    { return this._mesh.getName() }
  set name(v)   { this._mesh.setName(v) }
  get weights() { return this._mesh.getWeights() }
  set weights(v){ this._mesh.setWeights(v) }
  get extras()  { return this._mesh.getExtras() }
  set extras(v) { this._mesh.setExtras(v) }

  get primitives()         { return this._mesh.listPrimitives().map(p => new SOMPrimitive(p)) }
  addPrimitive(primitive)  { this._mesh.addPrimitive(primitive._primitive) }
  removePrimitive(primitive){ this._mesh.removePrimitive(primitive._primitive) }
}
