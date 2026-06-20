// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { AtriumClient }          from '@atrium/client'
import { LabelOverlay }          from './LabelOverlay.js'
import { Stage, PointerInputBridge, initDocumentView, loadBackground, buildAvatarDescriptor } from '@atrium/renderer-three'

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const worldUrlInput = document.getElementById('worldUrl')
const wsUrlInput    = document.getElementById('wsUrl')
const loadBtn       = document.getElementById('loadBtn')
const connectBtn    = document.getElementById('connectBtn')
const statusDot     = document.getElementById('statusDot')
const viewportEl    = document.getElementById('viewport')
const overlayEl     = document.getElementById('overlay')
const hudWorldEl    = document.getElementById('hud-world')
const hudYouEl      = document.getElementById('hud-you')
const hudPeersEl    = document.getElementById('hud-peers')
const hudHintEl     = document.getElementById('hud-hint')
const modeSwitcher  = document.getElementById('mode-switcher')

// ---------------------------------------------------------------------------
// Third-person camera constants (passed to Stage and used for V-key toggle)
// ---------------------------------------------------------------------------

const CAMERA_OFFSET_Y = 2.0
const CAMERA_OFFSET_Z = 4.0

// ---------------------------------------------------------------------------
// Client + Stage
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for manual console testing

const stage = new Stage(viewportEl, {
  client,
  cameraOffsetY:   CAMERA_OFFSET_Y,
  cameraOffsetZ:   CAMERA_OFFSET_Z,
  backgroundColor: 0x1a1a2e,
  cameraPosition:  [0, 1.6, 4],
})
const { renderer, nav, animCtrl, scene: threeScene } = stage
const avatar = stage.avatar
const canvas  = renderer.domElement
window.stage = stage

// ---------------------------------------------------------------------------
// Navigation / camera mode state
// ---------------------------------------------------------------------------

let usePointerLock = false   // default: drag-to-look; M key toggles
let firstPerson    = false   // default: third-person when connected; V key toggles

// ---------------------------------------------------------------------------
// Peer label overlay
// ---------------------------------------------------------------------------

const labels = new LabelOverlay(viewportEl, () => stage.camera)

function onResize() {
  stage.resize(viewportEl.clientWidth, viewportEl.clientHeight)
}
window.addEventListener('resize', onResize)
onResize()

// ---------------------------------------------------------------------------
// DocumentView / animation state
// ---------------------------------------------------------------------------

let docView    = null
let sceneGroup = null

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud() {
  hudPeersEl.textContent = client.connected
    ? `Peers: ${avatar.peerCount}`
    : ''
  hudYouEl.textContent = client.connected && client.displayName
    ? `You: ${client.displayName}`
    : ''
}

function updateHintText() {
  const activeCam = nav.activeCamera
  const camSuffix = activeCam ? ` · 🎥 ${activeCam.name}` : ''

  if (nav.mode === 'ORBIT') {
    hudHintEl.textContent = `Drag to orbit · Scroll to zoom${camSuffix}`
    return
  }

  const hasAvatar   = !!avatar.localNode
  const mouseMode   = usePointerLock ? 'Click to look' : 'Drag to look'
  const mouseToggle = usePointerLock ? '[M] drag mode'  : '[M] mouse lock'

  if (hasAvatar) {
    const cameraToggle = firstPerson ? '[V] third person' : '[V] first person'
    hudHintEl.textContent = `${mouseMode} · WASD to move · ${mouseToggle} · ${cameraToggle}${camSuffix}`
  } else {
    hudHintEl.textContent = `${mouseMode} · WASD to move · ${mouseToggle}${camSuffix}`
  }
}

// ---------------------------------------------------------------------------
// Connection state UI
// ---------------------------------------------------------------------------

function setConnectionState(state) {
  statusDot.className = 'status-dot ' + state

  if (state === 'connecting') {
    connectBtn.textContent = 'Connecting...'
    connectBtn.disabled    = true
  } else if (state === 'connected') {
    connectBtn.textContent = 'Disconnect'
    connectBtn.disabled    = false
  } else {
    // disconnected or error
    connectBtn.textContent = 'Connect'
    connectBtn.disabled    = false
  }

  updateHud()
}

// ---------------------------------------------------------------------------
// Pointer input — PointerInputBridge
// ---------------------------------------------------------------------------

// Bridge constructed once; sceneRoot is a getter so it follows world reloads.
const pointerBridge = new PointerInputBridge({
  client,
  canvas,
  camera:            () => stage.camera,
  sceneRoot:         () => sceneGroup,
  suppressOnCapture: true,   // stop camera drag when a node has pointer capture
})

// ---------------------------------------------------------------------------
// Client event listeners
// ---------------------------------------------------------------------------

client.on('world:loaded', ({ name, description, author }) => {
  if (!client.som) return

  // Derive base URL for resolving relative texture paths
  const rawUrl = worldUrlInput.value.trim()
  const absUrl  = new URL(rawUrl, window.location.href).href
  worldBaseUrl  = absUrl.substring(0, absUrl.lastIndexOf('/') + 1)

  // Clear previous background/environment before loading new world
  threeScene.background = null
  threeScene.environment = null

  ;({ docView, sceneGroup } = initDocumentView(renderer, threeScene, client.som, { prevDocView: docView, prevSceneGroup: sceneGroup }))
  stage.setSceneGroup(sceneGroup)

  loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)

  // HUD world line
  hudWorldEl.textContent = name ? `World: ${name}` : ''

  // Console metadata
  console.log(`[app] World: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
  if (description) console.log(`[app]   ${description}`)

  // ── Diagnostic pointer-event handlers (all non-ephemeral nodes) ──────────
  for (const node of client.som.nodes) {
    if (node.extras?.atrium?.ephemeral) continue   // skip avatars
    node.addEventListener('pointerover', () => console.log('[pointer] over',  node.name))
    node.addEventListener('pointerout',  () => console.log('[pointer] out',   node.name))
    node.addEventListener('pointerdown', (e) => console.log('[pointer] down', node.name, 'button', e.detail.button))
    node.addEventListener('pointerup',   () => console.log('[pointer] up',    node.name))
    node.addEventListener('click',       (e) => console.log('[pointer] click', node.name, 'at', e.detail.point))
  }
})

client.on('session:ready', () => {
  setConnectionState('connected')
  updateHintText()
})

client.on('disconnected', () => {
  labels.clear()
  setConnectionState('disconnected')
  firstPerson = false   // reset to third-person for next session
  updateHintText()

  // Reload the world in static mode — clears avatar/peer nodes from the scene
  // and restores NavigationController's localNode for input to work again.
  const url = worldUrlInput.value.trim()
  if (url) client.loadWorld(url)
})

client.on('error', (err) => {
  console.error('[app] client error:', err)
  setConnectionState('error')
})

// ---------------------------------------------------------------------------
// Avatar controller event listeners
// ---------------------------------------------------------------------------

avatar.on('avatar:local-ready', () => {
  updateHud()
  updateHintText()
})

avatar.on('avatar:peer-added', ({ displayName, node }) => {
  console.log(`[app] Peer joined: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  labels.addLabel(displayName, node)
  updateHud()
})

avatar.on('avatar:peer-removed', ({ displayName }) => {
  console.log(`[app] Peer left: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  labels.removeLabel(displayName)
  updateHud()
})

// Live property updates on the selected node, and world-info panel for document extras
let worldBaseUrl = ''
client.on('som:set', ({ nodeName }) => {
  if (!client.som) return
  if (nodeName === '__document__') {
    loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)
    return
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
  overlayEl.textContent = 'Loading…'
  try {
    const msg = await loadDroppedFile(file)
    overlayEl.textContent = msg ?? ''
  } catch (err) {
    overlayEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  }
})

// ---------------------------------------------------------------------------
// UI actions
// ---------------------------------------------------------------------------

loadBtn.addEventListener('click', async () => {
  const url = worldUrlInput.value.trim()
  if (!url) return
  loadBtn.disabled = true
  overlayEl.textContent = 'Loading…'
  try {
    if (url.endsWith('.json')) {
      const configUrl = new URL(url, window.location.href).href
      const resp = await fetch(configUrl)
      const config = await resp.json()
      const msg = await loadAtriumConfig(config, configUrl)
      overlayEl.textContent = msg ?? ''
    } else {
      const absoluteUrl = new URL(url, window.location.href).href
      await client.loadWorld(absoluteUrl)
      overlayEl.textContent = ''
    }
  } catch (err) {
    overlayEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  } finally {
    loadBtn.disabled = false
  }
})

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
  const avatarDesc = buildAvatarDescriptor()
  client.connect(wsUrl, { avatar: avatarDesc })
})

// ---------------------------------------------------------------------------
// Navigation — delegate input to NavigationController
// Both paths are wired at startup; the active path is gated by usePointerLock.
// ---------------------------------------------------------------------------

let pointerLocked = false
let dragging      = false

document.addEventListener('pointerlockchange', () => {
  pointerLocked = !!document.pointerLockElement
})

viewportEl.addEventListener('click', () => {
  if (usePointerLock) viewportEl.requestPointerLock()
})

viewportEl.addEventListener('mousedown', () => {
  if (!usePointerLock) dragging = true
})

document.addEventListener('mouseup', () => { dragging = false })

document.addEventListener('mousemove', (e) => {
  if (usePointerLock && pointerLocked) {
    nav.onMouseMove(e.movementX, e.movementY)
  } else if (!usePointerLock && dragging) {
    nav.onMouseMove(e.movementX, e.movementY)
  }
})

document.addEventListener('keydown', (e) => {
  if (e.target !== canvas) return

  // M / V — mode-specific hot keys, ignored in ORBIT
  if (e.code === 'KeyM' && nav.mode !== 'ORBIT') {
    usePointerLock = !usePointerLock
    if (!usePointerLock && document.pointerLockElement) {
      document.exitPointerLock()
    }
    updateHintText()
    return
  }

  // V — toggle camera perspective (third-person ↔ first-person); ignored in ORBIT
  if (e.code === 'KeyV' && avatar.localNode && nav.mode !== 'ORBIT') {
    firstPerson = !firstPerson
    if (firstPerson) {
      avatar.cameraNode.translation = [0, 1.6, 0]
      avatar.localNode.visible = false
    } else {
      avatar.cameraNode.translation = [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]
      avatar.localNode.visible = true
    }
    updateHintText()
    return
  }

  // Space — cycle through world cameras (null = default nav camera)
  if (e.code === 'Space') {
    const cameras = client.som?.cameras ?? []
    if (cameras.length === 0) return
    const current = nav.activeCamera
    const idx = cameras.indexOf(current)
    const next = cameras[(idx + 1) % (cameras.length + 1)]
    stage.setActiveCamera(next ?? null)
    updateHintText()
    return
  }

  nav.onKeyDown(e.code)
})

document.addEventListener('keyup', (e) => { if (e.target === canvas) nav.onKeyUp(e.code) })

modeSwitcher.addEventListener('change', (e) => {
  nav.setMode(e.target.value)
  updateHintText()
})

viewportEl.addEventListener('wheel', (e) => {
  e.preventDefault()
  nav.onWheel(e.deltaY)
}, { passive: false })

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

let lastTick = performance.now()

function tick(now) {
  requestAnimationFrame(tick)

  const dt = (now - lastTick) / 1000
  lastTick = now

  stage.tick(dt)
  labels.update()
}

requestAnimationFrame(tick)

// Initial hint text
updateHintText()
