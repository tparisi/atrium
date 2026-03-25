// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMEvent }  from './SOMEvent.js'
import { SOMNode }   from './SOMNode.js'

export class SOMScene extends SOMObject {
  constructor(scene) {
    super()
    this._scene = scene
  }

  get name()   { return this._scene.getName() }
  get extras() { return this._scene.getExtras() }

  get children()    { return this._scene.listChildren().map(n => new SOMNode(n)) }

  addChild(node) {
    this._scene.addChild(node._node)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:    this,
        childList: { addedNodes: [node.name] },
      }))
    }
  }

  removeChild(node) {
    this._scene.removeChild(node._node)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:    this,
        childList: { removedNodes: [node.name] },
      }))
    }
  }
}
