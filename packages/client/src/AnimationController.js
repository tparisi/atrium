// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Minimal EventEmitter (same pattern as AtriumClient)
// ---------------------------------------------------------------------------

class EventEmitter {
  constructor() { this._listeners = Object.create(null) }

  on(event, fn) {
    ;(this._listeners[event] ??= []).push(fn)
    return this
  }

  off(event, fn) {
    const arr = this._listeners[event]
    if (arr) {
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    }
    return this
  }

  emit(event, ...args) {
    const arr = this._listeners[event]
    if (arr) for (const fn of [...arr]) fn(...args)
  }
}

// ---------------------------------------------------------------------------
// AnimationController
// ---------------------------------------------------------------------------

/**
 * Manages the SOM-level animation lifecycle, translating playback state
 * changes into semantic events consumed by the app-layer renderer.
 *
 * Lives in packages/client — headless, no Three.js or DOM dependency.
 *
 * Usage:
 *   const anim = new AnimationController(client)
 *   anim.on('animation:play', ({ animation }) => { ... })
 *   // In frame loop:
 *   anim.tick(dt)
 */
export class AnimationController extends EventEmitter {
  /**
   * @param {AtriumClient} client
   */
  constructor(client) {
    super()
    this._client  = client
    this._tracked = new Map()   // animName → { anim, mutationListener }
    this._playing = new Set()   // SOMAnimation instances currently playing

    client.on('world:loaded', () => this._onWorldLoaded())
    client.on('som:add',      ({ nodeName }) => this._onSomAdd(nodeName))
    client.on('som:remove',   ({ nodeName }) => this._onSomRemove(nodeName))
  }

  // ---------------------------------------------------------------------------
  // Lifecycle handlers
  // ---------------------------------------------------------------------------

  _onWorldLoaded() {
    // Tear down previous world's tracking before re-scanning
    for (const { anim, mutationListener } of this._tracked.values()) {
      anim.removeEventListener('mutation', mutationListener)
    }
    this._tracked.clear()
    this._playing.clear()

    const som = this._client.som
    if (!som) return

    for (const anim of som.animations) {
      this._trackAnimation(anim)
      // Late-joiner / authored auto-play: emit play for animations already running
      if (anim.playing) {
        this._playing.add(anim)
        this.emit('animation:play', { animation: anim })
      }
    }
  }

  _onSomAdd(nodeName) {
    const som = this._client.som
    if (!som) return
    // Check if the added name is an animation (not a node)
    const anim = som.getAnimationByName(nodeName)
    if (!anim) return
    this._trackAnimation(anim)
    this.emit('animation:added', { animation: anim })
    if (anim.playing) {
      this._playing.add(anim)
      this.emit('animation:play', { animation: anim })
    }
  }

  _onSomRemove(nodeName) {
    const entry = this._tracked.get(nodeName)
    if (!entry) return
    const { anim, mutationListener } = entry
    anim.removeEventListener('mutation', mutationListener)
    this._playing.delete(anim)
    this._tracked.delete(nodeName)
    this.emit('animation:removed', { animation: anim })
  }

  // ---------------------------------------------------------------------------
  // Internal tracking
  // ---------------------------------------------------------------------------

  _trackAnimation(anim) {
    if (this._tracked.has(anim.name)) return   // already tracked

    const mutationListener = (event) => {
      if (event.detail.property !== 'playback') return
      const pb = event.detail.value
      if (pb.playing) {
        this._playing.add(anim)
        this.emit('animation:play', { animation: anim })
      } else if (pb.paused) {
        this._playing.delete(anim)
        this.emit('animation:pause', { animation: anim })
      } else {
        this._playing.delete(anim)
        this.emit('animation:stop', { animation: anim })
      }
    }

    anim.addEventListener('mutation', mutationListener)
    this._tracked.set(anim.name, { anim, mutationListener })
  }

  // ---------------------------------------------------------------------------
  // tick(dt) — called once per frame by the app layer
  // ---------------------------------------------------------------------------

  /**
   * Drive timeupdate events for all currently-playing animations.
   * @param {number} dt - Delta time in seconds (not used directly; currentTime
   *                      is computed from wall clock inside SOMAnimation)
   */
  tick(dt) {
    for (const anim of this._playing) {
      anim.tick()
    }
  }
}
