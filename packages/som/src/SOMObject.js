// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export class SOMObject {
  constructor() {
    this._listeners = {}
  }

  addEventListener(type, callback) {
    if (!this._listeners[type]) this._listeners[type] = []
    this._listeners[type].push(callback)
  }

  removeEventListener(type, callback) {
    if (!this._listeners[type]) return
    this._listeners[type] = this._listeners[type].filter(cb => cb !== callback)
  }

  _hasListeners(type) {
    return (this._listeners[type]?.length ?? 0) > 0
  }

  _dispatchEvent(event) {
    for (const cb of this._listeners[event.type] ?? []) {
      cb(event)
    }
  }
}
