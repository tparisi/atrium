// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMNode }   from './SOMNode.js'

export class SOMSkin extends SOMObject {
  constructor(skin, document = null) {
    super()
    this._skin     = skin
    this._document = document
  }

  get name()     { return this._skin.getName() }
  get extras()   { return this._skin.getExtras() }

  // Read-only in v0.1
  get joints() {
    return this._skin.listJoints().map(n =>
      (this._document ? this._document._resolveNode(n) : null) ?? new SOMNode(n)
    )
  }
  get skeleton() {
    const s = this._skin.getSkeleton()
    if (!s) return null
    return (this._document ? this._document._resolveNode(s) : null) ?? new SOMNode(s)
  }
}
