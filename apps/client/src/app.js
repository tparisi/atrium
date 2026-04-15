// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { DocumentView } from '@gltf-transform/view'
import { AtriumClient }          from '@atrium/client'
import { AvatarController }      from '@atrium/client/AvatarController'
import { NavigationController }  from '@atrium/client/NavigationController'
import { AnimationController }   from '@atrium/client/AnimationController'
import { LabelOverlay }          from './LabelOverlay.js'

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
// Three.js renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
viewportEl.appendChild(renderer.domElement)

// Make the canvas focusable so keyboard events are scoped to the viewport
const canvas = renderer.domElement
canvas.setAttribute('tabindex', '0')
canvas.style.outline = 'none'
canvas.addEventListener('pointerdown', () => canvas.focus())

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
// Navigation / camera mode state
// ---------------------------------------------------------------------------

let usePointerLock = false   // default: drag-to-look; M key toggles
let firstPerson    = false   // default: third-person when connected; V key toggles

// ---------------------------------------------------------------------------
// Peer label overlay
// ---------------------------------------------------------------------------

const labels = new LabelOverlay(viewportEl, camera)

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
let mixer      = null   // THREE.AnimationMixer — recreated on world:loaded
const clipMap  = new Map()  // animName → THREE.AnimationClip

function initDocumentView(somDocument) {
  if (docView) { docView.dispose(); threeScene.remove(sceneGroup) }
  docView    = new DocumentView(renderer)

  const sceneDef = somDocument.document.getRoot().listScenes()[0]
  sceneGroup = docView.view(sceneDef)
  threeScene.add(sceneGroup)
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

/**
 * Build THREE.AnimationClip objects from a SOMDocument's glTF-Transform data.
 *
 * Finding (§2.1): @gltf-transform/view@4.3.0 does NOT create AnimationClip
 * objects — AnimationClip is not imported in its bundle and sceneGroup.animations
 * is always undefined. Clips are built here directly from the glTF-Transform
 * document. Track paths use the glTF node name, which matches the Three.js
 * Object3D name set by DocumentView (value.name = def.getName()).
 */
function buildClipsFromSOM(somDocument) {
  const clips = []
  for (const gltfAnim of somDocument.document.getRoot().listAnimations()) {
    const tracks = []
    for (const channel of gltfAnim.listChannels()) {
      const sampler    = channel.getSampler()
      const targetNode = channel.getTargetNode()
      const targetPath = channel.getTargetPath()
      if (!sampler || !targetNode) continue
      const times  = sampler.getInput()?.getArray()
      const values = sampler.getOutput()?.getArray()
      if (!times || !values) continue
      const nodeName = targetNode.getName()
      let track
      if (targetPath === 'rotation') {
        track = new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, values)
      } else if (targetPath === 'translation') {
        track = new THREE.VectorKeyframeTrack(`${nodeName}.position`, times, values)
      } else if (targetPath === 'scale') {
        track = new THREE.VectorKeyframeTrack(`${nodeName}.scale`, times, values)
      }
      if (track) tracks.push(track)
    }
    if (tracks.length > 0) {
      clips.push(new THREE.AnimationClip(gltfAnim.getName(), -1, tracks))
    }
  }
  return clips
}

function initAnimations() {
  if (mixer) mixer.stopAllAction()
  mixer = null
  clipMap.clear()

  if (!client.som) return

  const clips = buildClipsFromSOM(client.som)
  for (const clip of clips) clipMap.set(clip.name, clip)

  if (clips.length > 0) {
    mixer = new THREE.AnimationMixer(sceneGroup)
    console.log(`[app] AnimationMixer ready — ${clips.length} clip(s): ${clips.map(c => c.name).join(', ')}`)
  }
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

function updateHintText() {
  if (nav.mode === 'ORBIT') {
    hudHintEl.textContent = 'Drag to orbit · Scroll to zoom'
    return
  }

  const hasAvatar   = !!avatar.localNode
  const mouseMode   = usePointerLock ? 'Click to look' : 'Drag to look'
  const mouseToggle = usePointerLock ? '[M] drag mode'  : '[M] mouse lock'

  if (hasAvatar) {
    const cameraToggle = firstPerson ? '[V] third person' : '[V] first person'
    hudHintEl.textContent = `${mouseMode} · WASD to move · ${mouseToggle} · ${cameraToggle}`
  } else {
    hudHintEl.textContent = `${mouseMode} · WASD to move · ${mouseToggle}`
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

const animCtrl = new AnimationController(client)

animCtrl.on('animation:play', ({ animation }) => {
  if (!mixer) return
  const clip = clipMap.get(animation.name)
  if (!clip) { console.warn(`[app] animation:play — no clip for "${animation.name}"`); return }
  const action = mixer.clipAction(clip)
  action.loop             = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce
  action.clampWhenFinished = !animation.loop
  action.timeScale        = animation.timeScale
  action.reset().play()
  action.time             = animation.currentTime   // seek to computed position (late-joiner sync)
})

animCtrl.on('animation:pause', ({ animation }) => {
  if (!mixer) return
  const clip = clipMap.get(animation.name)
  if (!clip) return
  const action = mixer.existingAction(clip)
  if (action) action.paused = true
})

animCtrl.on('animation:stop', ({ animation }) => {
  if (!mixer) return
  const clip = clipMap.get(animation.name)
  if (!clip) return
  const action = mixer.existingAction(clip)
  if (action) action.stop()
})

// ---------------------------------------------------------------------------
// Dynamic background reload - should move to another module
// ---------------------------------------------------------------------------

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

  initDocumentView(client.som)
  initAnimations()

  // Load equirectangular background from extras.atrium.background
  const extras = client.som.document.getRoot().getExtras()
  const bg = extras?.atrium?.background
  if (bg?.texture) {
    if (bg.type && bg.type !== 'equirectangular') {
      console.warn('Unsupported background type:', bg.type)
    } else {
      const worldUrl = worldUrlInput.value.trim()
      const absWorldUrl = new URL(worldUrl, window.location.href).href
      const baseUrl = absWorldUrl.substring(0, absWorldUrl.lastIndexOf('/') + 1)
      const textureUrl = new URL(bg.texture, baseUrl).href
      const loader = new THREE.TextureLoader()
      loader.load(
        textureUrl,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping
          texture.colorSpace = THREE.SRGBColorSpace
          threeScene.background = texture
          threeScene.environment = texture
        },
        undefined,
        (err) => console.warn('Failed to load background texture:', textureUrl, err),
      )
    }
  }

  // HUD world line
  hudWorldEl.textContent = name ? `World: ${name}` : ''

  // Console metadata
  console.log(`[app] World: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
  if (description) console.log(`[app]   ${description}`)
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
    loadBackground(client.som.extras?.atrium?.background, worldBaseUrl)
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

  // NavigationController updates SOM nodes and calls avatar.setView
  nav.tick(dt)

  // AnimationController drives timeupdate events; mixer advances playhead
  animCtrl.tick(dt)
  if (mixer) mixer.update(dt)

  // Sync Three.js camera from SOM state (stays in app.js)
  const localNode  = avatar.localNode
  const cameraNode = avatar.cameraNode
  if (localNode && cameraNode) {
    if (nav.mode === 'ORBIT') {
      // ORBIT: position from node (set by NavigationController), look at target
      const pos = localNode.translation ?? [0, 0, 0]
      camera.position.set(pos[0], pos[1], pos[2])
      const t = nav.orbitTarget
      camera.lookAt(t[0], t[1], t[2])
    } else {
      const yaw   = nav.yaw
      const pitch = nav.pitch
      const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      const avatarPos = localNode.translation ?? [0, 0, 0]
      const camOffset = cameraNode.translation ?? [0, 0, 0]
      // Only Z offset means "behind the avatar" (third-person).
      // First-person at eye height has Y but no Z — check Z only.
      const hasOffset = Math.abs(camOffset[2]) > 0.001

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
        // First-person: camera at avatar position (with Y eye height), direct yaw+pitch
        camera.position.set(avatarPos[0], avatarPos[1], avatarPos[2])
        camera.quaternion.copy(qYaw).multiply(qPitch)
      }
    }
  }

  // Update peer labels after camera sync so projections use current frame position
  labels.update()

  // if (docView) docView.render()
  renderer.render(threeScene, camera)
}

requestAnimationFrame(tick)

// Initial hint text
updateHintText()
