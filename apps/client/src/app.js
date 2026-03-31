// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { DocumentView } from '@gltf-transform/view'
import { AtriumClient }        from '@atrium/client'
import { AvatarController }    from '@atrium/client/AvatarController'
import { NavigationController } from '@atrium/client/NavigationController'

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

// ---------------------------------------------------------------------------
// Three.js renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
viewportEl.appendChild(renderer.domElement)

const threeScene = new THREE.Scene()
threeScene.background = new THREE.Color(0x1a1a2e)

// Ambient + directional light
threeScene.add(new THREE.AmbientLight(0xffffff, 0.6))
const sun = new THREE.DirectionalLight(0xffffff, 1.2)
sun.position.set(5, 10, 5)
sun.castShadow = true
threeScene.add(sun)

// Grid helper
threeScene.add(new THREE.GridHelper(40, 40, 0x333333, 0x222222))

// Camera
const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000)
camera.position.set(0, 1.6, 4)

// ---------------------------------------------------------------------------
// Third-person camera constants
// ---------------------------------------------------------------------------

const CAMERA_OFFSET_Y = 2.0   // meters above avatar
const CAMERA_OFFSET_Z = 4.0   // meters behind avatar (+Z = behind in glTF right-handed)

// ---------------------------------------------------------------------------
// Navigation mode
// ---------------------------------------------------------------------------

const USE_POINTER_LOCK = false  // true = FPS pointer-lock, false = drag-to-look

// Resize handler
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
// DocumentView — bridges SOM → Three.js
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
// Avatar capsule descriptor (sent to server via AtriumClient)
// ---------------------------------------------------------------------------

function buildAvatarDescriptor(name) {
  const geo       = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const positions = Array.from(geo.attributes.position.array)
  const normals   = Array.from(geo.attributes.normal.array)
  const indices   = Array.from(geo.index.array)
  geo.dispose()

  const color = [Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, 1]

  return {
//    name,
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: {
      primitives: [{
        attributes: { POSITION: positions, NORMAL: normals },
        indices,
        material: {
          pbrMetallicRoughness: {
            baseColorFactor: color,
            metallicFactor:  0.0,
            roughnessFactor: 0.7,
          },
        },
      }],
    },
  }
}

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
// AtriumClient + AvatarController + NavigationController
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for manual console testing

const avatar = new AvatarController(client, {
  cameraOffsetY: CAMERA_OFFSET_Y,
  cameraOffsetZ: CAMERA_OFFSET_Z,
})

const nav = new NavigationController(avatar, {
  mode:             'WALK',
  mouseSensitivity: 0.002,
})

// ---------------------------------------------------------------------------
// Client event listeners
// ---------------------------------------------------------------------------

client.on('world:loaded', ({ name, description, author }) => {
  if (!client.som) return
  initDocumentView(client.som)

  // HUD world line
  hudWorldEl.textContent = name ? `World: ${name}` : ''

  // Console metadata
  console.log(`[app] World: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
  if (description) console.log(`[app]   ${description}`)
})

client.on('session:ready', () => {
  setConnectionState('connected')
  updateHud()
})

client.on('disconnected', () => {
  setConnectionState('disconnected')
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
})

avatar.on('avatar:peer-added', ({ displayName }) => {
  console.log(`[app] Peer joined: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  updateHud()
})

avatar.on('avatar:peer-removed', ({ displayName }) => {
  console.log(`[app] Peer left: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  updateHud()
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
    await client.loadWorld(url)
    overlayEl.textContent = USE_POINTER_LOCK
      ? 'Click to capture mouse · WASD to move · Mouse to look · Esc to release'
      : 'Drag to look · WASD to move'
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
  const avatarDesc = buildAvatarDescriptor()
  client.connect(wsUrl, { avatar: avatarDesc })
})

// ---------------------------------------------------------------------------
// Navigation — delegate input to NavigationController
// ---------------------------------------------------------------------------

let pointerLock = false
let dragging    = false

if (USE_POINTER_LOCK) {
  viewportEl.addEventListener('click', () => { viewportEl.requestPointerLock() })
  document.addEventListener('pointerlockchange', () => {
    pointerLock = document.pointerLockElement === viewportEl
  })
  document.addEventListener('mousemove', (e) => {
    if (!pointerLock) return
    nav.onMouseMove(e.movementX, e.movementY)
  })
} else {
  viewportEl.addEventListener('mousedown', () => { dragging = true })
  document.addEventListener('mouseup',     () => { dragging = false })
  document.addEventListener('mousemove',   (e) => {
    if (!dragging) return
    nav.onMouseMove(e.movementX, e.movementY)
  })
}

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

  // NavigationController updates SOM nodes and calls avatar.setView
  nav.tick(dt)

  // Sync Three.js camera from SOM state (stays in app.js)
  const localNode  = avatar.localNode
  const cameraNode = avatar.cameraNode
  if (localNode && cameraNode) {
    const yaw   = nav.yaw
    const pitch = nav.pitch
    const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
    const avatarPos = localNode.translation ?? [0, 0, 0]
    const camOffset = cameraNode.translation ?? [0, 0, 0]
    const hasOffset = Math.abs(camOffset[1]) > 0.001 || Math.abs(camOffset[2]) > 0.001

    if (hasOffset) {
      // Third-person: offset camera behind and above avatar, look at avatar head
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
      // First-person (static mode): camera at avatar position, direct yaw+pitch
      camera.position.set(avatarPos[0], avatarPos[1], avatarPos[2])
      camera.quaternion.copy(qYaw).multiply(qPitch)
    }
  }

  // if (docView) docView.render()
  renderer.render(threeScene, camera)
}

requestAnimationFrame(tick)
