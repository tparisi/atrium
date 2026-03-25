// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'

export class SOMTexture extends SOMObject {
  constructor(texture) {
    super()
    this._texture = texture
  }

  get name()     { return this._texture.getName() }
  get mimeType() { return this._texture.getMimeType() }
  get extras()   { return this._texture.getExtras() }

  getImage() { return this._texture.getImage() }
}
