// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMEvent }  from './SOMEvent.js'

const DEFAULT_PLAYBACK = Object.freeze({
  playing:        false,
  paused:         false,
  loop:           false,
  autoStart:      false,
  timeScale:      1.0,
  startTime:      0,
  startWallClock: null,
  pauseTime:      null,
})

export class SOMAnimation extends SOMObject {
  constructor(animation) {
    super()
    this._animation = animation

    // Initialize playback from extras.atrium.playback if present (late-joiner / authored state)
    const extras = animation.getExtras()
    this._playback = extras?.atrium?.playback
      ? { ...DEFAULT_PLAYBACK, ...extras.atrium.playback }
      : { ...DEFAULT_PLAYBACK }
  }

  // ---------------------------------------------------------------------------
  // Intrinsic properties (read-only, from glTF content)
  // ---------------------------------------------------------------------------

  get name() { return this._animation.getName() }

  /** Max keyframe time across all samplers (seconds). */
  get duration() {
    let max = 0
    for (const sampler of this._animation.listSamplers()) {
      const input = sampler.getInput()
      if (input) {
        const arr = input.getArray()
        if (arr && arr.length > 0) {
          max = Math.max(max, arr[arr.length - 1])
        }
      }
    }
    return max
  }

  /**
   * Read-only channel descriptors.
   * Each entry: { targetNode, targetProperty, samplerIndex }
   */
  get channels() {
    const samplers = this._animation.listSamplers()
    return this._animation.listChannels().map(ch => {
      const targetNode = ch.getTargetNode()
      return {
        targetNode:     targetNode ? targetNode.getName() : null,
        targetProperty: ch.getTargetPath(),
        samplerIndex:   samplers.indexOf(ch.getSampler()),
      }
    })
  }

  /**
   * Read-only sampler descriptors.
   * Each entry: { interpolation, inputCount, outputCount }
   */
  get samplers() {
    return this._animation.listSamplers().map(s => {
      const input  = s.getInput()
      const output = s.getOutput()
      return {
        interpolation: s.getInterpolation(),
        inputCount:    input  ? input.getCount()  : 0,
        outputCount:   output ? output.getCount() : 0,
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Playback compound property (the only mutable property)
  // ---------------------------------------------------------------------------

  get playback() {
    return { ...this._playback }
  }

  set playback(value) {
    this._playback = { ...value }

    // Persist to extras.atrium.playback so glTF round-trips carry playback state
    const extras = this._animation.getExtras() ?? {}
    this._animation.setExtras({
      ...extras,
      atrium: { ...(extras.atrium ?? {}), playback: { ...this._playback } },
    })

    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', {
        target:   this,
        property: 'playback',
        value:    { ...this._playback },
      }))
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only convenience accessors (delegating to _playback)
  // ---------------------------------------------------------------------------

  get playing()        { return this._playback.playing }
  get paused()         { return this._playback.paused }
  get loop()           { return this._playback.loop }
  get autoStart()      { return this._playback.autoStart }
  get timeScale()      { return this._playback.timeScale }
  get startTime()      { return this._playback.startTime }
  get startWallClock() { return this._playback.startWallClock }
  get pauseTime()      { return this._playback.pauseTime }

  // ---------------------------------------------------------------------------
  // Computed property — derived live, never stored or sent over wire
  // ---------------------------------------------------------------------------

  get currentTime() {
    if (!this._playback.playing) {
      return this._playback.paused ? this._playback.pauseTime : 0
    }
    const elapsed = (Date.now() - this._playback.startWallClock) / 1000
                    * this._playback.timeScale
    const t = this._playback.startTime + elapsed
    return this._playback.loop
      ? t % this.duration
      : Math.min(t, this.duration)
  }

  // ---------------------------------------------------------------------------
  // Playback methods — each writes playback atomically (one mutation event)
  // ---------------------------------------------------------------------------

  play({ startTime = 0, loop = false, timeScale = 1.0 } = {}) {
    this.playback = {
      playing:        true,
      paused:         false,
      loop,
      autoStart:      this._playback.autoStart,  // preserve authored hint
      timeScale,
      startTime,
      startWallClock: Date.now(),
      pauseTime:      null,
    }
  }

  pause() {
    if (!this._playback.playing) return   // no-op if not playing
    const elapsed = (Date.now() - this._playback.startWallClock) / 1000
                    * this._playback.timeScale
    this.playback = {
      ...this._playback,
      playing:   false,
      paused:    true,
      pauseTime: this._playback.startTime + elapsed,
    }
  }

  stop() {
    this.playback = { ...DEFAULT_PLAYBACK, autoStart: this._playback.autoStart }
  }

  // ---------------------------------------------------------------------------
  // tick() — drives timeupdate events; called by app frame loop
  // ---------------------------------------------------------------------------

  tick() {
    if (!this._playback.playing || !this._hasListeners('timeupdate')) return
    this._dispatchEvent(new SOMEvent('timeupdate', {
      target:      this,
      currentTime: this.currentTime,
    }))
  }
}
