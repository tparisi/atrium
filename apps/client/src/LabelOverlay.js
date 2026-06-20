// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

const LABEL_HEIGHT_OFFSET = 2.2   // meters above somNode.translation (capsule is ~2m tall)

export class LabelOverlay {
  constructor(container, camera) {
    this._container  = container
    // Accept a getter function so callers can pass () => stage.camera for a live read
    this._getCamera  = typeof camera === 'function' ? camera : () => camera
    this._labels     = new Map()   // displayName → { div, somNode }
  }

  addLabel(displayName, somNode) {
    const div = document.createElement('div')
    div.textContent = displayName
    Object.assign(div.style, {
      position:      'absolute',
      pointerEvents: 'none',
      transform:     'translate(-50%, -100%)',
      color:         '#fff',
      fontSize:      '12px',
      fontFamily:    '\'Cascadia Code\', \'Fira Code\', monospace',
      background:    'rgba(0,0,0,0.6)',
      borderRadius:  '8px',
      padding:       '2px 8px',
      whiteSpace:    'nowrap',
    })
    this._container.appendChild(div)
    this._labels.set(displayName, { div, somNode })
  }

  removeLabel(displayName) {
    const entry = this._labels.get(displayName)
    if (!entry) return
    entry.div.remove()
    this._labels.delete(displayName)
  }

  update() {
    const w = this._container.clientWidth
    const h = this._container.clientHeight
    for (const { div, somNode } of this._labels.values()) {
      const t   = somNode.translation ?? [0, 0, 0]
      const pos = new THREE.Vector3(t[0], t[1] + LABEL_HEIGHT_OFFSET, t[2])
      pos.project(this._getCamera())

      if (pos.z > 1) {
        div.style.display = 'none'
        continue
      }

      const x = ( pos.x * 0.5 + 0.5) * w
      const y = (-pos.y * 0.5 + 0.5) * h
      div.style.display = 'block'
      div.style.left    = x + 'px'
      div.style.top     = y + 'px'
    }
  }

  clear() {
    for (const { div } of this._labels.values()) div.remove()
    this._labels.clear()
  }
}
