// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// TreeView.js — scene graph tree panel for SOM Inspector

export class TreeView {
  constructor(containerEl) {
    this._container    = containerEl
    this._selectedName = null   // name of currently selected SOMNode
    this._som          = null
    this.onSelect      = null   // callback(somNode) — called on click
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Full build from a SOMDocument. Clears and recreates all DOM. */
  build(som) {
    this._som = som
    this._container.innerHTML = ''
    const scene = som.scene
    if (!scene) return
    this._container.appendChild(this._buildSceneRoot(scene, som))
  }

  /**
   * Rebuild after structural change (som:add / som:remove).
   * Restores selection highlight if the selected node still exists.
   * Does NOT re-call onSelect — property sheet drives itself via som:set.
   */
  rebuild(som) {
    const prevName = this._selectedName
    this.build(som)
    if (prevName && som.getNodeByName(prevName)) {
      const row = this._container.querySelector(`[data-node-name="${CSS.escape(prevName)}"]`)
      if (row) row.classList.add('selected')
    } else {
      this._selectedName = null
    }
  }

  clear() {
    this._container.innerHTML = ''
    this._selectedName = null
    this._som          = null
  }

  get selectedNode() {
    if (!this._selectedName || !this._som) return null
    return this._som.getNodeByName(this._selectedName) ?? null
  }

  // ---------------------------------------------------------------------------
  // Private — DOM construction
  // ---------------------------------------------------------------------------

  _buildSceneRoot(scene, som) {
    const item = document.createElement('div')
    item.className = 'tree-item'

    const row = document.createElement('div')
    row.className = 'tree-row scene-root'

    const toggle = this._makeToggle()
    row.appendChild(toggle)

    const label = document.createElement('span')
    label.className = 'tree-label'
    label.textContent = scene.name || 'Scene'
    row.appendChild(label)

    item.appendChild(row)

    const children = scene.children
    if (children.length > 0) {
      const childrenEl = this._buildChildren(children, som)
      item.appendChild(childrenEl)
      this._wireToggle(toggle, childrenEl)
    }

    return item
  }

  _buildNodeItem(somNode, som) {
    const item = document.createElement('div')
    item.className = 'tree-item'

    const row = document.createElement('div')
    row.className = 'tree-row'
    row.dataset.nodeName = somNode.name

    if (this._selectedName === somNode.name) row.classList.add('selected')

    const toggle = this._makeToggle()
    row.appendChild(toggle)

    const label = document.createElement('span')
    label.className = 'tree-label'
    // For prefixed names (e.g. "Crate/Crate"), display only the last segment.
    // The hierarchy already provides the container context.
    const displayName = somNode.name.includes('/')
      ? somNode.name.slice(somNode.name.lastIndexOf('/') + 1)
      : somNode.name
    label.textContent = displayName || '(unnamed)'
    row.appendChild(label)

    // Ephemeral indicator — node stamped by AtriumClient on connect()
    if (somNode.extras?.atrium?.ephemeral === true) {
      const dot = document.createElement('span')
      dot.className = 'tree-ephemeral'
      dot.title = 'ephemeral node'
      row.appendChild(dot)
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation()
      this._selectRow(row, somNode)
    })

    item.appendChild(row)

    const children = somNode.children
    if (children.length > 0) {
      const childrenEl = this._buildChildren(children, som)
      item.appendChild(childrenEl)
      this._wireToggle(toggle, childrenEl)
    }

    return item
  }

  _buildChildren(children, som) {
    const el = document.createElement('div')
    el.className = 'tree-children'
    for (const child of children) {
      el.appendChild(this._buildNodeItem(child, som))
    }
    return el
  }

  _makeToggle() {
    const t = document.createElement('span')
    t.className = 'tree-toggle'
    return t
  }

  _wireToggle(toggle, childrenEl) {
    toggle.textContent = '▾'
    toggle.addEventListener('click', (e) => {
      e.stopPropagation()
      const open = childrenEl.style.display !== 'none'
      childrenEl.style.display = open ? 'none' : ''
      toggle.textContent = open ? '▸' : '▾'
    })
  }

  _selectRow(row, somNode) {
    const prev = this._container.querySelector('.tree-row.selected')
    if (prev) prev.classList.remove('selected')
    row.classList.add('selected')
    this._selectedName = somNode.name
    this.onSelect?.(somNode)
  }
}
