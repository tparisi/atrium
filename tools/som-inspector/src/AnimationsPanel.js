// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * AnimationsPanel — lists all SOM animations with play/pause/stop controls
 * and a live current-time display updated via timeupdate events.
 *
 * Usage:
 *   const panel = new AnimationsPanel(containerEl)
 *   panel.show(somDocument, animCtrl)   // call after world:loaded
 *   panel.clear()                       // call on disconnect / world clear
 */
export class AnimationsPanel {
  constructor(containerEl) {
    this._el       = containerEl
    this._rows     = new Map()   // animName → { anim, timeEl, timeupdateListener }
    this._animCtrl = null
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  show(somDocument, animCtrl) {
    this._animCtrl = animCtrl
    this._clearRows()

    const anims = somDocument.animations
    if (!anims || anims.length === 0) {
      this._el.innerHTML = '<div class="anim-empty">No animations</div>'
      return
    }

    this._el.innerHTML = ''

    for (const anim of anims) {
      this._addRow(anim)
    }
  }

  clear() {
    this._animCtrl = null
    this._clearRows()
    this._el.innerHTML = ''
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _clearRows() {
    for (const { anim, timeupdateListener } of this._rows.values()) {
      anim.removeEventListener('timeupdate', timeupdateListener)
    }
    this._rows.clear()
  }

  _addRow(anim) {
    const row = document.createElement('div')
    row.className = 'anim-row'

    // Name + duration
    const nameEl = document.createElement('span')
    nameEl.className = 'anim-name'
    nameEl.textContent = anim.name

    const durEl = document.createElement('span')
    durEl.className = 'anim-duration'
    durEl.textContent = `${anim.duration.toFixed(2)}s`

    // Current time display
    const timeEl = document.createElement('span')
    timeEl.className = 'anim-time'
    timeEl.textContent = '0.00'

    // Controls
    const playBtn  = document.createElement('button')
    const pauseBtn = document.createElement('button')
    const stopBtn  = document.createElement('button')

    playBtn.className  = 'anim-btn anim-play'
    pauseBtn.className = 'anim-btn anim-pause'
    stopBtn.className  = 'anim-btn anim-stop'

    playBtn.textContent  = '▶'
    pauseBtn.textContent = '⏸'
    stopBtn.textContent  = '■'

    playBtn.title  = 'Play'
    pauseBtn.title = 'Pause'
    stopBtn.title  = 'Stop'

    playBtn.addEventListener('click',  () => anim.play())
    pauseBtn.addEventListener('click', () => anim.pause())
    stopBtn.addEventListener('click',  () => anim.stop())

    // Live time updates
    const timeupdateListener = (event) => {
      timeEl.textContent = event.detail.currentTime.toFixed(2)
      _updateButtonStates()
    }
    anim.addEventListener('timeupdate', timeupdateListener)

    // Also update buttons on playback mutation
    const mutationListener = () => _updateButtonStates()
    anim.addEventListener('mutation', mutationListener)

    const _updateButtonStates = () => {
      const pb = anim.playback
      playBtn.disabled  = pb.playing && !pb.paused
      pauseBtn.disabled = !pb.playing || pb.paused
      stopBtn.disabled  = !pb.playing
    }
    _updateButtonStates()

    row.appendChild(nameEl)
    row.appendChild(durEl)
    row.appendChild(timeEl)
    row.appendChild(playBtn)
    row.appendChild(pauseBtn)
    row.appendChild(stopBtn)

    this._el.appendChild(row)
    this._rows.set(anim.name, { anim, timeEl, timeupdateListener, mutationListener })
  }
}
