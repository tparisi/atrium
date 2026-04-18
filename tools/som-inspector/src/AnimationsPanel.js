// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * AnimationsPanel — lists all SOM animations with play/pause/stop controls,
 * a live current-time display, and an expandable disclosure panel showing
 * the full playback object with editable loop / timeScale / autoStart fields.
 *
 * Usage:
 *   const panel = new AnimationsPanel(containerEl)
 *   panel.show(somDocument, animCtrl)   // call after world:loaded
 *   panel.clear()                       // call on disconnect / world clear
 */
export class AnimationsPanel {
  constructor(containerEl) {
    this._el   = containerEl
    this._rows = new Map()   // animName → { anim, listeners: [{target, type, fn}], expanded }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  show(somDocument, animCtrl) {
    this._clearRows()

    const anims = somDocument.animations
    if (!anims || anims.length === 0) {
      this._el.innerHTML = '<div class="anim-empty">No animations</div>'
      return
    }

    this._el.innerHTML = ''
    for (const anim of anims) this._addRow(anim)
  }

  clear() {
    this._clearRows()
    this._el.innerHTML = ''
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _clearRows() {
    for (const { listeners } of this._rows.values()) {
      for (const { target, type, fn } of listeners) {
        target.removeEventListener(type, fn)
      }
    }
    this._rows.clear()
  }

  _addRow(anim) {
    const entry = { anim, listeners: [], expanded: false }
    this._rows.set(anim.name, entry)

    // ── Outer wrapper ──────────────────────────────────────────────────────
    const wrapper = document.createElement('div')
    wrapper.className = 'anim-wrapper'

    // ── Summary row ────────────────────────────────────────────────────────
    const row = document.createElement('div')
    row.className = 'anim-row'

    const triangleEl = document.createElement('span')
    triangleEl.className = 'anim-triangle'
    triangleEl.textContent = '▸'
    triangleEl.title = 'Expand'

    const nameEl = document.createElement('span')
    nameEl.className = 'anim-name'
    nameEl.textContent = anim.name

    const durEl = document.createElement('span')
    durEl.className = 'anim-duration'
    durEl.textContent = `${anim.duration.toFixed(2)}s`

    const timeEl = document.createElement('span')
    timeEl.className = 'anim-time'
    timeEl.textContent = '—'

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

    row.appendChild(triangleEl)
    row.appendChild(nameEl)
    row.appendChild(durEl)
    row.appendChild(timeEl)
    row.appendChild(playBtn)
    row.appendChild(pauseBtn)
    row.appendChild(stopBtn)

    // ── Detail panel (hidden until expanded) ──────────────────────────────
    const detail = document.createElement('div')
    detail.className = 'anim-detail'
    detail.style.display = 'none'

    const fields = this._buildDetailFields(anim)
    detail.appendChild(fields.el)

    // ── Toggle disclosure ──────────────────────────────────────────────────
    triangleEl.addEventListener('click', (e) => {
      e.stopPropagation()
      entry.expanded = !entry.expanded
      triangleEl.textContent = entry.expanded ? '▾' : '▸'
      detail.style.display   = entry.expanded ? 'block' : 'none'
    })

    wrapper.appendChild(row)
    wrapper.appendChild(detail)
    this._el.appendChild(wrapper)

    // ── Shared mutation + timeupdate listeners ─────────────────────────────
    const updateSummary = () => {
      const pb = anim.playback
      playBtn.disabled  = pb.playing && !pb.paused
      pauseBtn.disabled = !pb.playing || pb.paused
      stopBtn.disabled  = !pb.playing
      if (!pb.playing && !pb.paused) timeEl.textContent = '—'
      else if (pb.paused) timeEl.textContent = anim.currentTime.toFixed(2)
    }
    updateSummary()

    const mutationFn = () => {
      updateSummary()
      fields.refresh()
    }
    const timeupdateFn = (event) => {
      timeEl.textContent = event.detail.currentTime.toFixed(2)
    }

    anim.addEventListener('mutation',   mutationFn)
    anim.addEventListener('timeupdate', timeupdateFn)
    entry.listeners.push(
      { target: anim, type: 'mutation',   fn: mutationFn },
      { target: anim, type: 'timeupdate', fn: timeupdateFn },
    )
  }

  // ---------------------------------------------------------------------------
  // Detail fields builder
  // ---------------------------------------------------------------------------

  _buildDetailFields(anim) {
    const el = document.createElement('div')
    el.className = 'anim-fields'

    const fmt = (v) => v === null || v === undefined ? '—' : String(v)

    // ── Read-only rows ─────────────────────────────────────────────────────
    const playingRow   = makeReadRow('playing',        () => fmt(anim.playback.playing))
    const pausedRow    = makeReadRow('paused',         () => fmt(anim.playback.paused))
    const startTimeRow = makeReadRow('startTime',      () => anim.playback.startTime?.toFixed(2) ?? '—')
    const wallRow      = makeReadRow('startWallClock', () => fmt(anim.playback.startWallClock))
    const pauseRow     = makeReadRow('pauseTime',      () => fmt(anim.playback.pauseTime))

    // ── Editable: loop ─────────────────────────────────────────────────────
    const loopRow = document.createElement('div')
    loopRow.className = 'anim-field-row'
    const loopLabel = document.createElement('span')
    loopLabel.className = 'anim-field-label'
    loopLabel.textContent = 'loop'
    const loopCheck = document.createElement('input')
    loopCheck.type = 'checkbox'
    loopCheck.checked = anim.playback.loop
    loopCheck.addEventListener('change', () => {
      anim.playback = { ...anim.playback, loop: loopCheck.checked }
    })
    loopRow.appendChild(loopLabel)
    loopRow.appendChild(loopCheck)

    // ── Editable: autoStart ────────────────────────────────────────────────
    const autoRow = document.createElement('div')
    autoRow.className = 'anim-field-row'
    const autoLabel = document.createElement('span')
    autoLabel.className = 'anim-field-label'
    autoLabel.textContent = 'autoStart'
    const autoHint = document.createElement('span')
    autoHint.className = 'anim-field-hint'
    autoHint.textContent = '(authoring)'
    const autoCheck = document.createElement('input')
    autoCheck.type = 'checkbox'
    autoCheck.checked = anim.playback.autoStart
    autoCheck.addEventListener('change', () => {
      anim.playback = { ...anim.playback, autoStart: autoCheck.checked }
    })
    autoRow.appendChild(autoLabel)
    autoRow.appendChild(autoCheck)
    autoRow.appendChild(autoHint)

    // ── Editable: timeScale ────────────────────────────────────────────────
    const tsRow = document.createElement('div')
    tsRow.className = 'anim-field-row'
    const tsLabel = document.createElement('span')
    tsLabel.className = 'anim-field-label'
    tsLabel.textContent = 'timeScale'
    const tsInput = document.createElement('input')
    tsInput.type = 'number'
    tsInput.step = '0.1'
    tsInput.min  = '0.01'
    tsInput.value = anim.playback.timeScale.toFixed(2)
    tsInput.className = 'anim-field-number'
    tsInput.addEventListener('change', () => {
      const v = parseFloat(tsInput.value)
      if (!isFinite(v) || v <= 0) {
        tsInput.value = anim.playback.timeScale.toFixed(2)  // revert
        return
      }
      anim.playback = { ...anim.playback, timeScale: v }
    })
    tsRow.appendChild(tsLabel)
    tsRow.appendChild(tsInput)

    el.appendChild(playingRow.el)
    el.appendChild(pausedRow.el)
    el.appendChild(loopRow)
    el.appendChild(autoRow)
    el.appendChild(tsRow)
    el.appendChild(startTimeRow.el)
    el.appendChild(wallRow.el)
    el.appendChild(pauseRow.el)

    function refresh() {
      const pb = anim.playback
      playingRow.update()
      pausedRow.update()
      startTimeRow.update()
      wallRow.update()
      pauseRow.update()
      loopCheck.checked  = pb.loop
      autoCheck.checked  = pb.autoStart
      // Only update number if not actively focused (avoid overwriting mid-type)
      if (document.activeElement !== tsInput) {
        tsInput.value = pb.timeScale.toFixed(2)
      }
    }

    return { el, refresh }
  }
}

// ---------------------------------------------------------------------------
// Helper — read-only field row
// ---------------------------------------------------------------------------

function makeReadRow(label, getValue) {
  const row = document.createElement('div')
  row.className = 'anim-field-row'

  const labelEl = document.createElement('span')
  labelEl.className = 'anim-field-label'
  labelEl.textContent = label

  const valueEl = document.createElement('span')
  valueEl.className = 'anim-field-value'
  valueEl.textContent = getValue()

  row.appendChild(labelEl)
  row.appendChild(valueEl)

  return {
    el:     row,
    update: () => { valueEl.textContent = getValue() },
  }
}
