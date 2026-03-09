// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export class SOMCamera {
  constructor(camera) {
    this._camera = camera
  }

  get name()        { return this._camera.getName() }
  set name(v)       { this._camera.setName(v) }
  get extras()      { return this._camera.getExtras() }
  set extras(v)     { this._camera.setExtras(v) }

  get type()        { return this._camera.getType() }
  set type(v)       { this._camera.setType(v) }

  // Perspective
  get yfov()        { return this._camera.getYFov() }
  set yfov(v)       { this._camera.setYFov(v) }
  get aspectRatio() { return this._camera.getAspectRatio() }
  set aspectRatio(v){ this._camera.setAspectRatio(v) }
  get znear()       { return this._camera.getZNear() }
  set znear(v)      { this._camera.setZNear(v) }
  get zfar()        { return this._camera.getZFar() }
  set zfar(v)       { this._camera.setZFar(v) }

  // Orthographic
  get xmag()        { return this._camera.getXMag() }
  set xmag(v)       { this._camera.setXMag(v) }
  get ymag()        { return this._camera.getYMag() }
  set ymag(v)       { this._camera.setYMag(v) }
}
