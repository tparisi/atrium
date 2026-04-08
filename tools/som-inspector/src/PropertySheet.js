// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// PropertySheet.js — property editor for a selected SOMNode

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function toHex(r, g, b) {
  const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function fromHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

function fmt(v) {
  return typeof v === 'number' ? parseFloat(v.toFixed(4)) : (v ?? 0)
}

// ---------------------------------------------------------------------------
// PropertySheet
// ---------------------------------------------------------------------------

export class PropertySheet {
  constructor(containerEl, headerEl) {
    this._container = containerEl
    this._header    = headerEl
    this._node      = null
    this._updaters  = []   // () => void — re-read SOM values into existing inputs
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Build property DOM from scratch for the given node. */
  show(somNode) {
    this._node     = somNode
    this._updaters = []
    this._container.innerHTML = ''
    this._header.style.display = ''
    this._build(somNode)
  }

  /**
   * Re-read current SOM values into existing inputs without rebuilding DOM.
   * Called on som:set for the selected node (remote mutations).
   * Matching is by name so the reference survives tree rebuilds.
   */
  refresh(somNode) {
    if (!this._node || somNode.name !== this._node.name) return
    this._node = somNode   // accept fresh reference after tree rebuild
    for (const fn of this._updaters) fn()
  }

  clear() {
    this._container.innerHTML = ''
    this._header.style.display = 'none'
    this._node     = null
    this._updaters = []
  }

  // ---------------------------------------------------------------------------
  // Private — top-level builder
  // ---------------------------------------------------------------------------

  _build(node) {
    const nameEl = document.createElement('div')
    nameEl.className = 'prop-node-name'
    // Always show the full prefixed path (e.g. "Light/Lamp") for unambiguous identification
    nameEl.textContent = node.name || '(unnamed)'
    this._container.appendChild(nameEl)

    this._buildNodeSection(node)

    const mat = node.mesh?.primitives?.[0]?.material ?? null
    if (mat) this._buildMaterialSection(mat)

    const cam = node.camera
    if (cam) this._buildCameraSection(cam)
  }

  // ---------------------------------------------------------------------------
  // Node section
  // ---------------------------------------------------------------------------

  _buildNodeSection(node) {
    const sec = this._section('Node')

    // Translation
    {
      const inp = this._addRow(sec, 'Trans.')
      const inputs = this._vecInputs(node.translation ?? [0, 0, 0], 3, 0.1,
        (i, v) => { const a = [...(node.translation ?? [0, 0, 0])]; a[i] = v; node.translation = a },
        ()      => node.translation ?? [0, 0, 0]
      )
      inp.append(...inputs)
    }

    // Rotation
    {
      const inp = this._addRow(sec, 'Rotation')
      const inputs = this._vecInputs(node.rotation ?? [0, 0, 0, 1], 4, 0.001,
        (i, v) => { const a = [...(node.rotation ?? [0, 0, 0, 1])]; a[i] = v; node.rotation = a },
        ()      => node.rotation ?? [0, 0, 0, 1]
      )
      inp.append(...inputs)
    }

    // Scale
    {
      const inp = this._addRow(sec, 'Scale')
      const inputs = this._vecInputs(node.scale ?? [1, 1, 1], 3, 0.1,
        (i, v) => { const a = [...(node.scale ?? [1, 1, 1])]; a[i] = v; node.scale = a },
        ()      => node.scale ?? [1, 1, 1]
      )
      inp.append(...inputs)
    }

    // Visible
    {
      const inp = this._addRow(sec, 'Visible')
      const cb  = document.createElement('input')
      cb.type    = 'checkbox'
      cb.checked = node.visible ?? true
      cb.addEventListener('change', () => { node.visible = cb.checked })
      this._updaters.push(() => { cb.checked = node.visible ?? true })
      inp.appendChild(cb)
    }

    this._container.appendChild(sec)
  }

  // ---------------------------------------------------------------------------
  // Material section
  // ---------------------------------------------------------------------------

  _buildMaterialSection(mat) {
    const sec = this._section('Material')

    // Base color: color picker + alpha number
    {
      const inp    = this._addRow(sec, 'Base Color')
      const bcf    = mat.baseColorFactor ?? [1, 1, 1, 1]
      const picker = document.createElement('input')
      picker.type  = 'color'
      picker.value = toHex(bcf[0], bcf[1], bcf[2])

      const alphaIn       = document.createElement('input')
      alphaIn.type        = 'number'
      alphaIn.step        = '0.01'
      alphaIn.min         = '0'
      alphaIn.max         = '1'
      alphaIn.style.width = '46px'
      alphaIn.value       = fmt(bcf[3] ?? 1)

      const apply = () => {
        const [r, g, b] = fromHex(picker.value)
        const a = Math.max(0, Math.min(1, parseFloat(alphaIn.value) || 0))
        mat.baseColorFactor = [r, g, b, a]
      }
      picker.addEventListener('input', apply)
      alphaIn.addEventListener('change', apply)

      this._updaters.push(() => {
        const bcf = mat.baseColorFactor ?? [1, 1, 1, 1]
        picker.value  = toHex(bcf[0], bcf[1], bcf[2])
        alphaIn.value = fmt(bcf[3] ?? 1)
      })

      inp.append(picker, alphaIn)
    }

    // Metallic factor
    this._addFactorRow(sec, 'Metallic',
      mat.metallicFactor ?? 0,
      (v) => { mat.metallicFactor = v },
      ()  => mat.metallicFactor ?? 0
    )

    // Roughness factor
    this._addFactorRow(sec, 'Roughness',
      mat.roughnessFactor ?? 1,
      (v) => { mat.roughnessFactor = v },
      ()  => mat.roughnessFactor ?? 1
    )

    // Emissive factor
    {
      const inp    = this._addRow(sec, 'Emissive')
      const inputs = this._vecInputs(mat.emissiveFactor ?? [0, 0, 0], 3, 0.01,
        (i, v) => { const a = [...(mat.emissiveFactor ?? [0, 0, 0])]; a[i] = v; mat.emissiveFactor = a },
        ()      => mat.emissiveFactor ?? [0, 0, 0]
      )
      inp.append(...inputs)
    }

    // Alpha mode dropdown
    const amInp = this._addRow(sec, 'Alpha Mode')
    const amSel = document.createElement('select')
    for (const mode of ['OPAQUE', 'MASK', 'BLEND']) {
      const opt = document.createElement('option')
      opt.value = mode; opt.textContent = mode
      amSel.appendChild(opt)
    }
    amSel.value = mat.alphaMode ?? 'OPAQUE'
    amInp.appendChild(amSel)

    // Alpha cutoff (only shown when mode = MASK)
    const acInp = this._addRow(sec, 'Alpha Cut')
    const acNum = document.createElement('input')
    acNum.type        = 'number'
    acNum.step        = '0.01'
    acNum.min         = '0'
    acNum.max         = '1'
    acNum.style.width = '52px'
    acNum.value       = fmt(mat.alphaCutoff ?? 0.5)
    acInp.appendChild(acNum)
    const acRow = acInp.parentElement
    acRow.style.display = amSel.value === 'MASK' ? '' : 'none'

    amSel.addEventListener('change', () => {
      mat.alphaMode = amSel.value
      acRow.style.display = amSel.value === 'MASK' ? '' : 'none'
    })
    acNum.addEventListener('change', () => { mat.alphaCutoff = parseFloat(acNum.value) || 0 })

    this._updaters.push(() => {
      amSel.value = mat.alphaMode ?? 'OPAQUE'
      acRow.style.display = amSel.value === 'MASK' ? '' : 'none'
      acNum.value = fmt(mat.alphaCutoff ?? 0.5)
    })

    // Double sided
    {
      const inp  = this._addRow(sec, 'Dbl Sided')
      const cb   = document.createElement('input')
      cb.type    = 'checkbox'
      cb.checked = mat.doubleSided ?? false
      cb.addEventListener('change', () => { mat.doubleSided = cb.checked })
      this._updaters.push(() => { cb.checked = mat.doubleSided ?? false })
      inp.appendChild(cb)
    }

    this._container.appendChild(sec)
  }

  // ---------------------------------------------------------------------------
  // Camera section
  // ---------------------------------------------------------------------------

  _buildCameraSection(cam) {
    const sec = this._section('Camera')

    // Type dropdown
    {
      const inp     = this._addRow(sec, 'Type')
      const typeSel = document.createElement('select')
      for (const t of ['perspective', 'orthographic']) {
        const opt = document.createElement('option')
        opt.value = t; opt.textContent = t
        typeSel.appendChild(opt)
      }
      typeSel.value = cam.type ?? 'perspective'
      typeSel.addEventListener('change', () => { cam.type = typeSel.value })
      this._updaters.push(() => { typeSel.value = cam.type ?? 'perspective' })
      inp.appendChild(typeSel)
    }

    // Y-FOV
    this._addFactorRow(sec, 'Y-FOV',
      cam.yfov ?? 0.8,
      (v) => { cam.yfov = v },
      ()  => cam.yfov ?? 0.8,
      { min: 0.05, max: Math.PI * 0.95, step: 0.01 }
    )

    // Z-near
    {
      const inp  = this._addRow(sec, 'Z-Near')
      const num  = document.createElement('input')
      num.type   = 'number'; num.step = '0.001'; num.min = '0.0001'
      num.style.width = '70px'
      num.value  = fmt(cam.znear ?? 0.01)
      num.addEventListener('change', () => { cam.znear = parseFloat(num.value) || 0.01 })
      this._updaters.push(() => { num.value = fmt(cam.znear ?? 0.01) })
      inp.appendChild(num)
    }

    // Z-far
    {
      const inp  = this._addRow(sec, 'Z-Far')
      const num  = document.createElement('input')
      num.type   = 'number'; num.step = '1'; num.min = '0'
      num.style.width = '70px'
      num.value  = fmt(cam.zfar ?? 1000)
      num.addEventListener('change', () => { cam.zfar = parseFloat(num.value) || 1000 })
      this._updaters.push(() => { num.value = fmt(cam.zfar ?? 1000) })
      inp.appendChild(num)
    }

    this._container.appendChild(sec)
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  _section(title) {
    const sec = document.createElement('div')
    sec.className = 'prop-section'
    const h = document.createElement('div')
    h.className = 'prop-section-title'
    h.textContent = title
    sec.appendChild(h)
    return sec
  }

  /**
   * Appends a row (label + inputs container) to `parent`.
   * Returns the inputs container — callers append their widgets to it.
   */
  _addRow(parent, labelText) {
    const row = document.createElement('div')
    row.className = 'prop-row'

    const lbl = document.createElement('span')
    lbl.className = 'prop-label'
    lbl.textContent = labelText
    row.appendChild(lbl)

    const inputs = document.createElement('div')
    inputs.className = 'prop-inputs'
    row.appendChild(inputs)

    parent.appendChild(row)
    return inputs   // caller appends widgets here
  }

  /** Create N number inputs for a vec component. Returns the input elements. */
  _vecInputs(initial, n, step, onSet, getVec) {
    const inputs = []
    for (let i = 0; i < n; i++) {
      const num   = document.createElement('input')
      num.type    = 'number'
      num.step    = String(step)
      num.value   = fmt(initial[i])
      const idx   = i
      num.addEventListener('change', () => {
        onSet(idx, parseFloat(num.value) || 0)
      })
      this._updaters.push(() => { num.value = fmt(getVec()[idx]) })
      inputs.push(num)
    }
    return inputs
  }

  /** Append a paired number + range slider row to sec. */
  _addFactorRow(sec, label, initial, setter, getter, opts = {}) {
    const { min = 0, max = 1, step = 0.01 } = opts
    const inp = this._addRow(sec, label)

    const num       = document.createElement('input')
    num.type        = 'number'
    num.step        = String(step)
    num.min         = String(min)
    num.max         = String(max)
    num.style.width = '50px'
    num.value       = fmt(initial)

    const slider    = document.createElement('input')
    slider.type     = 'range'
    slider.min      = String(min)
    slider.max      = String(max)
    slider.step     = String(step)
    slider.value    = fmt(initial)

    num.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, parseFloat(num.value) || 0))
      num.value    = fmt(v)
      slider.value = fmt(v)
      setter(v)
    })
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value)
      num.value = fmt(v)
      setter(v)
    })

    this._updaters.push(() => {
      const v   = getter()
      num.value    = fmt(v)
      slider.value = fmt(v)
    })

    inp.append(num, slider)
  }
}
