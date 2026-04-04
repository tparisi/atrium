// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { DocumentView } from '@gltf-transform/view'
import { AtriumClient }         from '@atrium/client'
import { AvatarController }     from '@atrium/client/AvatarController'
import { NavigationController } from '@atrium/client/NavigationController'
import { TreeView }             from './TreeView.js'
import { PropertySheet }        from './PropertySheet.js'
import { WorldInfoPanel }       from './WorldInfoPanel.js'

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const worldUrlInput  = document.getElementById('worldUrl')
const wsUrlInput     = document.getElementById('wsUrl')
const loadBtn        = document.getElementById('loadBtn')
const connectBtn     = document.getElementById('connectBtn')
const statusDot      = document.getElementById('statusDot')
const modeSwitcher   = document.getElementById('mode-switcher')
const viewportEl     = document.getElementById('viewport')
const statusBar      = document.getElementById('status-bar')
const treePanelEl    = document.getElementById('tree-panel')
const propsPanelEl   = document.getElementById('props-panel')
const propsHeaderEl  = document.getElementById('props-header')
const worldInfoEl    = document.getElementById('world-info')

// ---------------------------------------------------------------------------
// Three.js renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
viewportEl.appendChild(renderer.domElement)

const threeScene = new THREE.Scene()
threeScene.background = new THREE.Color(0x111111)

threeScene.add(new THREE.AmbientLight(0xffffff, 0.6))
const sun = new THREE.DirectionalLight(0xffffff, 1.2)
sun.position.set(5, 10, 5)
sun.castShadow = true
threeScene.add(sun)
threeScene.add(new THREE.GridHelper(40, 40, 0x1e293b, 0x0f172a))

const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000)
camera.position.set(0, 5, 10)

// ---------------------------------------------------------------------------
// Third-person camera constants (used when switching to WALK mode)
// ---------------------------------------------------------------------------

const CAMERA_OFFSET_Y = 2.0
const CAMERA_OFFSET_Z = 4.0

// ---------------------------------------------------------------------------
// DocumentView
// ---------------------------------------------------------------------------

let docView    = null
let sceneGroup = null

function initDocumentView(somDocument) {
  if (docView) { docView.dispose(); threeScene.remove(sceneGroup) }
  docView    = new DocumentView(renderer)
  const sceneDef = somDocument.document.getRoot().listScenes()[0]
  sceneGroup = docView.view(sceneDef)
  threeScene.add(sceneGroup)
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function onResize() {
  const w = viewportEl.clientWidth
  const h = viewportEl.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', onResize)
onResize()

// ---------------------------------------------------------------------------
// AtriumClient / AvatarController / NavigationController
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for console debugging

const avatar = new AvatarController(client, {
  cameraOffsetY: CAMERA_OFFSET_Y,
  cameraOffsetZ: CAMERA_OFFSET_Z,
})

const nav = new NavigationController(avatar, {
  mode:             'ORBIT',
  mouseSensitivity: 0.005,
})

// ---------------------------------------------------------------------------
// Background loading
// ---------------------------------------------------------------------------

let worldBaseUrl = ''

function loadBackground(bg, baseUrl) {
  if (!bg?.texture) {
    threeScene.background = null
    threeScene.environment = null
    return
  }
  if (bg.type && bg.type !== 'equirectangular') {
    console.warn('Unsupported background type:', bg.type)
    return
  }
  const textureUrl = new URL(bg.texture, baseUrl).href
  const loader = new THREE.TextureLoader()
  loader.load(
    textureUrl,
    (texture) => {
      texture.mapping   = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace
      threeScene.background  = texture
      threeScene.environment = texture
    },
    undefined,
    (err) => console.warn('Failed to load background texture:', textureUrl, err),
  )
}

// ---------------------------------------------------------------------------
// TreeView + PropertySheet + WorldInfoPanel
// ---------------------------------------------------------------------------

const treeView = new TreeView(treePanelEl)
const propSheet = new PropertySheet(propsPanelEl, propsHeaderEl)
const worldInfo = new WorldInfoPanel(worldInfoEl, {
  onBackgroundChange: (bg) => loadBackground(bg, worldBaseUrl),
})

treeView.onSelect = (somNode) => {
  propSheet.show(somNode)
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

  initDocumentView(client.som)
  treeView.build(client.som)
  propSheet.clear()
  worldInfo.show(client.som)
  updateStatusBar(name ? `World: ${name}` : '')

  // Load background via shared helper
  loadBackground(client.som.extras?.atrium?.background, worldBaseUrl)
})

client.on('session:ready', () => {
  setConnectionState('connected')
  updateStatusBar(`Connected · ${client.displayName}`)
})

client.on('disconnected', () => {
  setConnectionState('disconnected')
  propSheet.clear()
  worldInfo.clear()
  updateStatusBar('')

  // Reload world in static mode — restores nav node and clears avatar geometry
  const url = worldUrlInput.value.trim()
  if (url) client.loadWorld(url)
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
    return
  }
  const selected = treeView.selectedNode
  if (selected && selected.name === nodeName) {
    const fresh = client.som.getNodeByName(nodeName)
    if (fresh) propSheet.refresh(fresh)
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
    await client.loadWorld(url)
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

document.addEventListener('keydown', (e) => nav.onKeyDown(e.code))
document.addEventListener('keyup',   (e) => nav.onKeyUp(e.code))

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

let lastTick = performance.now()

function tick(now) {
  requestAnimationFrame(tick)

  const dt = (now - lastTick) / 1000
  lastTick = now

  nav.tick(dt)

  // Camera sync
  const localNode  = avatar.localNode
  const cameraNode = avatar.cameraNode
  if (localNode && cameraNode) {
    if (nav.mode === 'ORBIT') {
      const pos = localNode.translation ?? [0, 0, 0]
      camera.position.set(pos[0], pos[1], pos[2])
      const t = nav.orbitTarget
      camera.lookAt(t[0], t[1], t[2])
    } else {
      // WALK / FLY — reuse standard third/first-person sync
      const yaw    = nav.yaw
      const pitch  = nav.pitch
      const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      const avatarPos = localNode.translation ?? [0, 0, 0]
      const camOffset = cameraNode.translation ?? [0, 0, 0]
      const hasOffset = Math.abs(camOffset[2]) > 0.001

      if (hasOffset) {
        const offset = new THREE.Vector3(0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z)
        offset.applyQuaternion(qYaw)
        camera.position.set(
          avatarPos[0] + offset.x,
          avatarPos[1] + offset.y,
          avatarPos[2] + offset.z,
        )
        const lookTarget = new THREE.Vector3(avatarPos[0], avatarPos[1] + 1.0, avatarPos[2])
        camera.lookAt(lookTarget)
        camera.rotateX(pitch)
      } else {
        camera.position.set(avatarPos[0], avatarPos[1], avatarPos[2])
        camera.quaternion.copy(qYaw).multiply(qPitch)
      }
    }
  }

  renderer.render(threeScene, camera)
}

requestAnimationFrame(tick)
