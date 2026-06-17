// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { AtriumClient }          from '@atrium/client'
import { TreeView }              from './TreeView.js'
import { PropertySheet }         from './PropertySheet.js'
import { WorldInfoPanel }        from './WorldInfoPanel.js'
import { AnimationsPanel }       from './AnimationsPanel.js'
import { Stage, PointerInputBridge, projectRayToPlane, computeParentInverse, initDocumentView, loadBackground } from '@atrium/renderer-three'
import { resolveSelectionRoot } from '@atrium/interaction'

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const worldUrlInput    = document.getElementById('worldUrl')
const wsUrlInput       = document.getElementById('wsUrl')
const loadBtn          = document.getElementById('loadBtn')
const connectBtn       = document.getElementById('connectBtn')
const statusDot        = document.getElementById('statusDot')
const modeSwitcher     = document.getElementById('mode-switcher')
const viewportEl       = document.getElementById('viewport')
const statusBar        = document.getElementById('status-bar')
const treePanelEl      = document.getElementById('tree-panel')
const propsPanelEl     = document.getElementById('props-panel')
const propsHeaderEl    = document.getElementById('props-header')
const worldInfoEl      = document.getElementById('world-info')
const animationsPanelEl = document.getElementById('animations-panel')

// ---------------------------------------------------------------------------
// Client + Stage
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for console debugging

const stage = new Stage(viewportEl, {
  client,
  navMode:          'ORBIT',
  navMouseSensitivity: 0.005,
})
const { renderer, nav, animCtrl } = stage
const { scene: threeScene, camera } = stage
const avatar = stage.avatar
const canvas  = renderer.domElement

// ---------------------------------------------------------------------------
// DocumentView / animation state
// ---------------------------------------------------------------------------

let docView    = null
let sceneGroup = null

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function onResize() {
  stage.resize(viewportEl.clientWidth, viewportEl.clientHeight)
}
window.addEventListener('resize', onResize)
onResize()

// ---------------------------------------------------------------------------
// Background state
// ---------------------------------------------------------------------------

let worldBaseUrl = ''

// ---------------------------------------------------------------------------
// TreeView + PropertySheet + WorldInfoPanel
// ---------------------------------------------------------------------------

const treeView = new TreeView(treePanelEl)
const propSheet = new PropertySheet(propsPanelEl, propsHeaderEl)
const worldInfo = new WorldInfoPanel(worldInfoEl, {
  onBackgroundChange: (bg) => loadBackground(threeScene, bg, worldBaseUrl),
})
const animationsPanel = new AnimationsPanel(animationsPanelEl)

treeView.onSelect = (somNode) => {
  propSheet.show(somNode)
}

// ---------------------------------------------------------------------------
// Pointer input — PointerInputBridge + selection/drag
// ---------------------------------------------------------------------------

let selected  = null   // currently selected SOMNode
let dragState = null   // null when no drag; populated for drag-to-translate

// Bridge constructed once; sceneRoot is a getter so it follows world reloads.
const pointerBridge = new PointerInputBridge({
  client,
  canvas,
  camera,
  sceneRoot:         () => sceneGroup,
  suppressOnCapture: true,   // stop nav drag when a node has pointer capture
})

/**
 * Set the active selection. Updates treeView (visual + onSelect → propSheet)
 * and keeps the local `selected` reference in sync.
 */
function setSelected(somNode) {
  selected = somNode
  treeView.selectNode(somNode)   // handles visual + propSheet via onSelect
}

// ── Node SOM event handlers ────────────────────────────────────────────────

function onNodeClick(node, e) {
  const resolved = resolveSelectionRoot(node, { descend: e.detail?.altKey ?? false })
  setSelected(resolved)
}

/**
 * Initiate a drag-to-translate when the pointerdown target is the currently-
 * selected node. First click selects; second click + drag translates.
 */
function onNodeMouseDown(node, e) {
  const resolved = resolveSelectionRoot(node, { descend: e.detail?.altKey ?? false })
  if (selected !== resolved) return   // unselected node: click will select on pointerup

  // Look up the Three.js Object3D for the resolved node (may be a mesh-less
  // group like lamp-01) so we can read its world-space transform.
  const threeObj = sceneGroup?.getObjectByName(resolved.name)
  if (!threeObj) return

  const worldPos   = threeObj.getWorldPosition(new THREE.Vector3())
  const planeY     = worldPos.y
  const initCursor = projectRayToPlane(e.detail.ray, planeY)

  if (!initCursor) return   // ray parallel to drag plane — skip

  // Capture on the resolved node so subsequent pointermove/pointerup route to it.
  client.setPointerCapture(resolved)

  dragState = {
    node:                resolved,
    dragPlaneY:          planeY,
    initialCursorWorld:  initCursor,
    initialNodeWorldPos: worldPos.clone(),
    parentWorldInverse:  computeParentInverse(threeObj),
  }
}

/** Per-move drag update: project cursor onto drag plane and write translation. */
function onNodeMouseMove(node, e) {
  if (!dragState || dragState.node !== node) return
  const cursorWorld = projectRayToPlane(e.detail.ray, dragState.dragPlaneY)
  if (!cursorWorld) return   // ray parallel to plane — skip this move
  const delta       = cursorWorld.clone().sub(dragState.initialCursorWorld)
  const newWorldPos = dragState.initialNodeWorldPos.clone().add(delta)
  const newLocalPos = newWorldPos.applyMatrix4(dragState.parentWorldInverse)
  node.translation  = [newLocalPos.x, newLocalPos.y, newLocalPos.z]
}

/** End drag on pointerup (capture released automatically by AtriumClient). */
function onNodeMouseUp(node) {
  if (!dragState || dragState.node !== node) return
  dragState = null
}

// ---------------------------------------------------------------------------
// Connection state UI
// ---------------------------------------------------------------------------

function setConnectionState(state) {
  statusDot.className = 'status-dot ' + state
  if (state === 'connecting') {
    connectBtn.textContent = 'Connecting…'
    connectBtn.disabled    = true
  } else if (state === 'connected') {
    connectBtn.textContent = 'Disconnect'
    connectBtn.disabled    = false
  } else {
    connectBtn.textContent = 'Connect'
    connectBtn.disabled    = false
  }
}

function updateStatusBar(text) {
  statusBar.textContent = text
}

// ---------------------------------------------------------------------------
// Client event listeners
// ---------------------------------------------------------------------------

client.on('world:loaded', ({ name }) => {
  if (!client.som) return

  // Derive base URL for resolving relative texture paths
  const rawUrl = worldUrlInput.value.trim()
  const absUrl  = new URL(rawUrl, window.location.href).href
  worldBaseUrl  = absUrl.substring(0, absUrl.lastIndexOf('/') + 1)

  // Clear previous background/environment before loading new world
  threeScene.background  = null
  threeScene.environment = null

  // Reset selection and drag state for fresh world
  selected  = null
  dragState = null

  ;({ docView, sceneGroup } = initDocumentView(renderer, threeScene, client.som, { prevDocView: docView, prevSceneGroup: sceneGroup }))
  stage.setSceneGroup(sceneGroup)
  treeView.build(client.som)
  propSheet.clear()
  worldInfo.show(client.som)
  animationsPanel.show(client.som, animCtrl)
  updateStatusBar(name ? `World: ${name}` : '')

  loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)

  // Attach selection and drag listeners to all non-ephemeral SOM nodes
  for (const node of client.som.nodes) {
    if (node.extras?.atrium?.ephemeral) continue
    node.addEventListener('click',       (e) => onNodeClick(node, e))
    node.addEventListener('pointerdown', (e) => onNodeMouseDown(node, e))
    node.addEventListener('pointermove', (e) => onNodeMouseMove(node, e))
    node.addEventListener('pointerup',   () => onNodeMouseUp(node))
  }
})

client.on('session:ready', () => {
  setConnectionState('connected')
  updateStatusBar(`Connected · ${client.displayName}`)
})

client.on('disconnected', () => {
  setConnectionState('disconnected')
  propSheet.clear()
  worldInfo.clear()
  animationsPanel.clear()
  updateStatusBar('')

  // Reload world in static mode — restores nav node and clears avatar geometry
  const url = worldUrlInput.value.trim()
  if (url) client.loadWorld(new URL(url, window.location.href).href)
})

client.on('error', (err) => {
  console.error('[inspector] client error:', err)
  setConnectionState('error')
})

// SOM structural changes — rebuild the tree
client.on('som:add', () => {
  if (client.som) treeView.rebuild(client.som)
})

client.on('som:remove', ({ nodeName }) => {
  if (client.som) treeView.rebuild(client.som)
  // Clear property sheet if the removed node was selected
  const sel = treeView.selectedNode
  if (!sel || sel.name === nodeName) propSheet.clear()
})

// Live property updates on the selected node, and world-info panel for document extras
client.on('som:set', ({ nodeName }) => {
  if (!client.som) return
  if (nodeName === '__document__') {
    worldInfo.refresh()
    loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)
    return
  }
  const selected = treeView.selectedNode
  if (selected && selected.name === nodeName) {
    const fresh = client.som.getNodeByName(nodeName)
    if (fresh) propSheet.refresh(fresh)
  }
})

// ---------------------------------------------------------------------------
// .atrium.json config loading
// ---------------------------------------------------------------------------

async function loadAtriumConfig(config, baseUrl) {
  if (!config?.world) {
    console.warn('.atrium.json: missing "world" key')
    return null
  }

  const gltfUrl = config.world.gltf
    ? (baseUrl ? new URL(config.world.gltf, baseUrl).href : null)
    : null

  let userMessage = null

  if (gltfUrl) {
    await client.loadWorld(gltfUrl)
    worldUrlInput.value = gltfUrl
  } else if (config.world.gltf) {
    console.warn('.atrium.json dropped locally — cannot resolve relative glTF path')
    userMessage = 'Loaded server URL from config. Drop the .gltf file directly to load the world.'
  }

  if (config.world.server) {
    wsUrlInput.value = config.world.server
  }

  return userMessage
}

// ---------------------------------------------------------------------------
// Drag-and-drop file loading
// ---------------------------------------------------------------------------

async function loadDroppedFile(file) {
  const name = file.name.toLowerCase()

  if (name.endsWith('.atrium.json') || name.endsWith('.json')) {
    const text = await file.text()
    let config
    try { config = JSON.parse(text) } catch {
      console.warn(`Invalid JSON in dropped file: ${file.name}`)
      return
    }
    return await loadAtriumConfig(config, null)
  }

  if (name.endsWith('.glb')) {
    const buffer = await file.arrayBuffer()
    await client.loadWorldFromData(buffer, file.name)
    return
  }

  if (name.endsWith('.gltf')) {
    const text = await file.text()
    await client.loadWorldFromData(text, file.name)
    return
  }

  console.warn(`Unsupported file type: ${file.name}`)
}

viewportEl.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  viewportEl.classList.add('drag-over')
})

viewportEl.addEventListener('dragleave', () => {
  viewportEl.classList.remove('drag-over')
})

viewportEl.addEventListener('drop', async (e) => {
  e.preventDefault()
  viewportEl.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (!file) return
  updateStatusBar('Loading…')
  try {
    const msg = await loadDroppedFile(file)
    if (msg) updateStatusBar(msg)
  } catch (err) {
    updateStatusBar('Load failed: ' + err.message)
    console.error(err)
  }
})

// ---------------------------------------------------------------------------
// Toolbar — Load
// ---------------------------------------------------------------------------

loadBtn.addEventListener('click', async () => {
  const url = worldUrlInput.value.trim()
  if (!url) return
  loadBtn.disabled = true
  updateStatusBar('Loading…')
  try {
    if (url.endsWith('.json')) {
      const configUrl = new URL(url, window.location.href).href
      const resp = await fetch(configUrl)
      const config = await resp.json()
      const msg = await loadAtriumConfig(config, configUrl)
      if (msg) updateStatusBar(msg)
    } else {
      const absoluteUrl = new URL(url, window.location.href).href
      await client.loadWorld(absoluteUrl)
    }
  } catch (err) {
    updateStatusBar('Load failed: ' + err.message)
    console.error(err)
  } finally {
    loadBtn.disabled = false
  }
})

// ---------------------------------------------------------------------------
// Toolbar — Connect / Disconnect
// ---------------------------------------------------------------------------

connectBtn.addEventListener('click', () => {
  if (client.connected) {
    client.disconnect()
    return
  }
  const wsUrl = wsUrlInput.value.trim()
  if (!wsUrl) return
  setConnectionState('connecting')
  const worldUrl = worldUrlInput.value.trim()
  if (worldUrl) {
    client.worldBaseUrl = new URL(worldUrl, window.location.href).href
  }
  // Minimal avatar: no mesh — invisible, but present for networking + navigation
  client.connect(wsUrl, { avatar: { translation: [0, 1.6, 0] } })
})

// ---------------------------------------------------------------------------
// Toolbar — Mode switcher
// ---------------------------------------------------------------------------

modeSwitcher.addEventListener('change', (e) => {
  nav.setMode(e.target.value)
})

// ---------------------------------------------------------------------------
// Navigation input — drag-to-look (no pointer lock in inspector)
// ---------------------------------------------------------------------------

let dragging = false

viewportEl.addEventListener('mousedown', (e) => {
  if (e.button === 0) dragging = true
})
document.addEventListener('mouseup', () => { dragging = false })
document.addEventListener('mousemove', (e) => {
  if (!dragging) return
  nav.onMouseMove(e.movementX, e.movementY)
})

viewportEl.addEventListener('wheel', (e) => {
  e.preventDefault()
  nav.onWheel(e.deltaY)
}, { passive: false })

document.addEventListener('keydown', (e) => { if (e.target === canvas) nav.onKeyDown(e.code) })
document.addEventListener('keyup',   (e) => { if (e.target === canvas) nav.onKeyUp(e.code) })

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

let lastTick = performance.now()

function tick(now) {
  requestAnimationFrame(tick)

  const dt = (now - lastTick) / 1000
  lastTick = now

  stage.tick(dt)
}

requestAnimationFrame(tick)
