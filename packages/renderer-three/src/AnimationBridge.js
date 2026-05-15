// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { buildClipsFromSOM } from './build-clips.js'

/**
 * Owns the Three.js animation mixer, clip map, and the four AnimationController
 * event handlers that drive the mixer from SOM playback events.
 *
 * Construction ordering enforcer: `sceneGroup` is produced by `initDocumentView`,
 * so the AnimationBridge cannot be constructed before that call — making the
 * required init order structurally unskippable.
 *
 * Lifecycle per world load:
 *   1. Call `initDocumentView(...)` → get `sceneGroup`
 *   2. If a previous bridge exists, call `prevBridge.dispose()`
 *   3. Construct `new AnimationBridge(sceneGroup, client, animCtrl)`
 *   4. Call `bridge.init(somDocument)` to build clips and mixer
 *   5. Call `bridge.replayPlayingAnimations(som)` to sync playing state
 *
 * In the frame loop, call `bridge.update(dt)`.
 */
export class AnimationBridge {
  /**
   * @param {THREE.Object3D} sceneGroup  — produced by initDocumentView
   * @param {AtriumClient}   client
   * @param {AnimationController} animCtrl
   */
  constructor(sceneGroup, client, animCtrl) {
    this._sceneGroup = sceneGroup
    this._client     = client
    this._animCtrl   = animCtrl
    this.mixer       = null
    this._clipMap    = new Map()

    this._onMixerFinished   = this._onMixerFinished.bind(this)
    this._onPlay            = this._onPlay.bind(this)
    this._onPause           = this._onPause.bind(this)
    this._onStop            = this._onStop.bind(this)
    this._onPlaybackChanged = this._onPlaybackChanged.bind(this)

    animCtrl.on('animation:play',             this._onPlay)
    animCtrl.on('animation:pause',            this._onPause)
    animCtrl.on('animation:stop',             this._onStop)
    animCtrl.on('animation:playback-changed', this._onPlaybackChanged)
  }

  /**
   * Build clips and mixer from the given SOM document.
   * Safe to call only once per bridge; dispose and reconstruct to reload.
   *
   * @param {SOMDocument} somDocument
   */
  init(somDocument) {
    const clips = buildClipsFromSOM(somDocument)
    for (const clip of clips) this._clipMap.set(clip.name, clip)

    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(this._sceneGroup)
      this.mixer.addEventListener('finished', this._onMixerFinished)
      console.log(`[renderer-three] AnimationMixer ready — ${clips.length} clip(s): ${clips.map(c => c.name).join(', ')}`)
    }
  }

  /**
   * Reconcile the mixer to the SOM's current playing state.
   * Call immediately after `init()` to handle late-joiner and autoStart cases.
   *
   * @param {SOM} som
   */
  replayPlayingAnimations(som) {
    if (!this.mixer) return
    for (const anim of som.animations) {
      if (!anim.playing) continue
      const clip = this._clipMap.get(anim.name)
      if (!clip) { console.warn(`[renderer-three] replayPlayingAnimations — no clip for "${anim.name}"`); continue }
      const pb     = anim.playback
      const action = this.mixer.clipAction(clip)
      action.loop              = pb.loop ? THREE.LoopRepeat : THREE.LoopOnce
      action.clampWhenFinished = !pb.loop
      action.timeScale         = pb.timeScale
      action.reset().play()
      action.time              = anim.currentTime
      console.log(`[renderer-three] replayPlayingAnimations — started "${anim.name}" at t=${anim.currentTime.toFixed(2)}`)
    }
  }

  /**
   * Advance the mixer. Call from the frame loop.
   *
   * @param {number} dt  Delta time in seconds.
   */
  update(dt) {
    if (this.mixer) this.mixer.update(dt)
  }

  /**
   * Stop all actions, remove the finished listener, and deregister all
   * AnimationController handlers. Call before discarding the bridge.
   */
  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer.removeEventListener('finished', this._onMixerFinished)
      this.mixer = null
    }
    this._clipMap.clear()
    this._animCtrl.off('animation:play',             this._onPlay)
    this._animCtrl.off('animation:pause',            this._onPause)
    this._animCtrl.off('animation:stop',             this._onStop)
    this._animCtrl.off('animation:playback-changed', this._onPlaybackChanged)
  }

  // ---------------------------------------------------------------------------
  // Private handlers
  // ---------------------------------------------------------------------------

  _onMixerFinished({ action }) {
    const clip = action.getClip()
    const anim = this._client.som?.getAnimationByName(clip.name)
    if (anim && anim.playing) anim.stop()
  }

  _onPlay({ animation }) {
    if (!this.mixer) return
    const clip = this._clipMap.get(animation.name)
    if (!clip) { console.warn(`[renderer-three] animation:play — no clip for "${animation.name}"`); return }
    const action = this.mixer.clipAction(clip)
    action.loop              = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce
    action.clampWhenFinished = !animation.loop
    action.timeScale         = animation.timeScale
    action.reset().play()
    action.time              = animation.currentTime
  }

  _onPause({ animation }) {
    if (!this.mixer) return
    const clip = this._clipMap.get(animation.name)
    if (!clip) return
    const action = this.mixer.existingAction(clip)
    if (action) action.paused = true
  }

  _onStop({ animation }) {
    if (!this.mixer) return
    const clip = this._clipMap.get(animation.name)
    if (!clip) return
    const action = this.mixer.existingAction(clip)
    if (action) action.stop()
  }

  _onPlaybackChanged({ animation, playback }) {
    if (!this.mixer) return
    const clip = this._clipMap.get(animation.name)
    if (!clip) return
    const action = this.mixer.existingAction(clip)
    if (!action) return
    action.setLoop(playback.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.setEffectiveTimeScale(playback.timeScale)
  }
}
