// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMNode } from './SOMNode.js'

export class SOMScene {
  constructor(scene) {
    this._scene = scene
  }

  get name()   { return this._scene.getName() }
  get extras() { return this._scene.getExtras() }

  get children()         { return this._scene.listChildren().map(n => new SOMNode(n)) }
  addChild(node)         { this._scene.addChild(node._node) }
  removeChild(node)      { this._scene.removeChild(node._node) }
}
