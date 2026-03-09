// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export class SOMAnimation {
  constructor(animation) {
    this._animation = animation
    this._loop      = false
    this._timeScale = 1.0
    this._state     = 'stopped'
  }

  get name()       { return this._animation.getName() }
  get extras()     { return this._animation.getExtras() }

  get loop()       { return this._loop }
  set loop(v)      { this._loop = v }
  get timeScale()  { return this._timeScale }
  set timeScale(v) { this._timeScale = v }

  // Read-only data from glTF-Transform
  get channels()   { return this._animation.listChannels() }
  get samplers()   { return this._animation.listSamplers() }

  // Playback — requires AnimationMixer on client; stubs on server
  play()           { this._state = 'playing' }
  stop()           { this._state = 'stopped'; }
  getState()       { return this._state }
  setWeight(_v)    { /* stub — requires AnimationMixer */ }
}
