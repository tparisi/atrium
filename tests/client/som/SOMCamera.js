// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMEvent }  from './SOMEvent.js'

export class SOMCamera extends SOMObject {
  constructor(camera) {
    super()
    this._camera = camera
  }

  get name()        { return this._camera.getName() }
  set name(v)       {
    this._camera.setName(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'name', value: v }))
    }
  }
  get extras()      { return this._camera.getExtras() }
  set extras(v)     {
    this._camera.setExtras(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value: v }))
    }
  }

  get type()        { return this._camera.getType() }
  set type(v)       {
    this._camera.setType(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'type', value: v }))
    }
  }

  // Perspective
  get yfov()        { return this._camera.getYFov() }
  set yfov(v)       {
    this._camera.setYFov(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'yfov', value: v }))
    }
  }
  get aspectRatio() { return this._camera.getAspectRatio() }
  set aspectRatio(v){
    this._camera.setAspectRatio(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'aspectRatio', value: v }))
    }
  }
  get znear()       { return this._camera.getZNear() }
  set znear(v)      {
    this._camera.setZNear(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'znear', value: v }))
    }
  }
  get zfar()        { return this._camera.getZFar() }
  set zfar(v)       {
    this._camera.setZFar(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'zfar', value: v }))
    }
  }

  // Orthographic
  get xmag()        { return this._camera.getXMag() }
  set xmag(v)       {
    this._camera.setXMag(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'xmag', value: v }))
    }
  }
  get ymag()        { return this._camera.getYMag() }
  set ymag(v)       {
    this._camera.setYMag(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'ymag', value: v }))
    }
  }
}
