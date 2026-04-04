// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// WorldInfoPanel.js — collapsible editor for extras.atrium fields on the document root

function fmt(v) {
  return typeof v === 'number' ? parseFloat(v.toFixed(4)) : (v ?? 0)
}

export class WorldInfoPanel {
  constructor(containerEl, { onBackgroundChange } = {}) {
    this._container = containerEl
    this._onBackgroundChange = onBackgroundChange ?? null
    this._som      = null
    this._updaters = []
    this._expanded = false

    // Fixed structure — header always present, content toggled
    this._header = document.createElement('div')
    this._header.className = 'world-info-header'
    this._header.addEventListener('click', () => this._toggle())
    containerEl.appendChild(this._header)

    this._content = document.createElement('div')
    this._content.className = 'world-info-content'
    this._content.style.display = 'none'
    containerEl.appendChild(this._content)

    this._renderHeader()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Populate form from som.extras.atrium. Does not auto-expand. */
  show(som) {
    this._som      = som
    this._updaters = []
    this._content.innerHTML = ''
    this._buildForm()
  }

  /** Re-read SOM values into existing inputs without rebuilding DOM. */
  refresh() {
    if (!this._som) return
    for (const fn of this._updaters) fn()
  }

  clear() {
    this._som      = null
    this._updaters = []
    this._content.innerHTML = ''
    if (this._expanded) {
      this._expanded = false
      this._content.style.display = 'none'
      this._renderHeader()
    }
  }

  // ---------------------------------------------------------------------------
  // Private — collapse
  // ---------------------------------------------------------------------------

  _toggle() {
    this._expanded = !this._expanded
    this._content.style.display = this._expanded ? '' : 'none'
    this._renderHeader()
  }

  _renderHeader() {
    this._header.textContent = (this._expanded ? '▾' : '▸') + '  World Info'
  }

  // ---------------------------------------------------------------------------
  // Private — form builder
  // ---------------------------------------------------------------------------

  _buildForm() {
    const atrium = this._som?.extras?.atrium ?? {}

    // Identity
    this._addTextField('Name',   'name',        atrium.name        ?? '')
    this._addTextField('Desc',   'description', atrium.description ?? '')
    this._addTextField('Author', 'author',      atrium.author      ?? '')

    // Background
    this._addSectionTitle('Background')

    this._addDropdown('Type', 'background.type',
      ['equirectangular', 'cubemap'],
      atrium.background?.type ?? 'equirectangular',
      () => this._onBackgroundChange?.(this._som?.extras?.atrium?.background)
    )

    this._addTextField('Texture', 'background.texture', atrium.background?.texture ?? '',
      () => this._onBackgroundChange?.(this._som?.extras?.atrium?.background)
    )

    // Navigation
    this._addSectionTitle('Navigation')

    // Modes — read-only
    const modes = atrium.navigation?.mode
    const modesText = Array.isArray(modes) ? modes.join(', ') : (modes ?? '')
    this._addReadOnly('Modes', modesText, () => {
      const m = this._som?.extras?.atrium?.navigation?.mode
      return Array.isArray(m) ? m.join(', ') : (m ?? '')
    })

    this._addNumber('Def Speed', 'navigation.speed.default',       atrium.navigation?.speed?.default      ?? '')
    this._addNumber('Min Speed', 'navigation.speed.min',           atrium.navigation?.speed?.min          ?? '')
    this._addNumber('Max Speed', 'navigation.speed.max',           atrium.navigation?.speed?.max          ?? '')
    this._addCheckbox('Terrain',   'navigation.terrainFollowing',    atrium.navigation?.terrainFollowing    ?? false)
    this._addCheckbox('Collision', 'navigation.collision.enabled',   atrium.navigation?.collision?.enabled  ?? false)
    this._addNumber('Pos Intv',  'navigation.updateRate.positionInterval', atrium.navigation?.updateRate?.positionInterval ?? '')
    this._addNumber('View Rate', 'navigation.updateRate.maxViewRate',      atrium.navigation?.updateRate?.maxViewRate      ?? '')
  }

  // ---------------------------------------------------------------------------
  // Private — field helpers
  // ---------------------------------------------------------------------------

  _readAtrium(path) {
    const segments = path.split('.')
    let val = this._som?.extras?.atrium
    for (const seg of segments) {
      if (val == null) return undefined
      val = val[seg]
    }
    return val
  }

  _addSectionTitle(title) {
    const h = document.createElement('div')
    h.className = 'prop-section-title'
    h.textContent = title
    this._content.appendChild(h)
  }

  _addRow(labelText) {
    const row = document.createElement('div')
    row.className = 'prop-row'

    const lbl = document.createElement('span')
    lbl.className = 'prop-label'
    lbl.textContent = labelText
    row.appendChild(lbl)

    const inputs = document.createElement('div')
    inputs.className = 'prop-inputs'
    row.appendChild(inputs)

    this._content.appendChild(row)
    return inputs
  }

  _addTextField(labelText, path, initial, afterChange = null) {
    const inp = this._addRow(labelText)
    const input = document.createElement('input')
    input.type  = 'text'
    input.value = initial
    input.addEventListener('change', () => {
      this._som.setExtrasAtrium(path, input.value)
      afterChange?.()
    })
    this._updaters.push(() => { input.value = this._readAtrium(path) ?? '' })
    inp.appendChild(input)
  }

  _addDropdown(labelText, path, options, initial, afterChange = null) {
    const inp = this._addRow(labelText)
    const sel = document.createElement('select')
    for (const opt of options) {
      const o = document.createElement('option')
      o.value = opt; o.textContent = opt
      sel.appendChild(o)
    }
    sel.value = initial
    sel.addEventListener('change', () => {
      this._som.setExtrasAtrium(path, sel.value)
      afterChange?.()
    })
    this._updaters.push(() => { sel.value = this._readAtrium(path) ?? options[0] })
    inp.appendChild(sel)
  }

  _addNumber(labelText, path, initial) {
    const inp = this._addRow(labelText)
    const num = document.createElement('input')
    num.type  = 'number'
    num.step  = 'any'
    num.style.width = '70px'
    num.value = initial !== '' ? fmt(initial) : ''
    num.addEventListener('change', () => {
      const v = parseFloat(num.value)
      if (isNaN(v)) {
        // revert
        num.value = fmt(this._readAtrium(path) ?? '')
        return
      }
      this._som.setExtrasAtrium(path, v)
    })
    this._updaters.push(() => {
      const v = this._readAtrium(path)
      num.value = v !== undefined && v !== null ? fmt(v) : ''
    })
    inp.appendChild(num)
  }

  _addCheckbox(labelText, path, initial) {
    const inp = this._addRow(labelText)
    const cb  = document.createElement('input')
    cb.type    = 'checkbox'
    cb.checked = !!initial
    cb.addEventListener('change', () => {
      this._som.setExtrasAtrium(path, cb.checked)
    })
    this._updaters.push(() => { cb.checked = !!(this._readAtrium(path)) })
    inp.appendChild(cb)
  }

  _addReadOnly(labelText, initial, getter) {
    const inp = this._addRow(labelText)
    const span = document.createElement('span')
    span.className = 'prop-value-text'
    span.textContent = initial
    this._updaters.push(() => { span.textContent = getter() })
    inp.appendChild(span)
  }
}
