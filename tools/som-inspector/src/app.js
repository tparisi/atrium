// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { DocumentView } from '@gltf-transform/view'
import { AtriumClient }          from '@atrium/client'
import { AvatarController }      from '@atrium/client/AvatarController'
import { NavigationController }  from '@atrium/client/NavigationController'
import { AnimationController }   from '@atrium/client/AnimationController'
import { TreeView }              from './TreeView.js'
import { PropertySheet }         from './PropertySheet.js'
import { WorldInfoPanel }        from './WorldInfoPanel.js'
import { AnimationsPanel }       from './AnimationsPanel.js'

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
    mixer.addEventListener('finished', ({ action }) => {
      const clip = action.getClip()
      const anim = client.som?.getAnimationByName(clip.name)
      if (anim && anim.playing) anim.stop()
    })
    console.log(`[inspector] AnimationMixer ready — ${clips.length} clip(s): ${clips.map(c => c.name).join(', ')}`)
  }
}

/**
 * Reconcile the Three.js mixer to the current SOM playing state.
 *
 * Called immediately after initAnimations() so that animations already
 * playing in the SOM (late-joiner som-dump, autoStart synchronous call,
 * or static load autoStart) are started in the mixer even if the
 * animation:play events fired before the mixer existed.
 */
function replayPlayingAnimations(som) {
  if (!mixer) return
  for (const anim of som.animations) {
    if (!anim.playing) continue
    const clip = clipMap.get(anim.name)
    if (!clip) { console.warn(`[inspector] replayPlayingAnimations — no clip for "${anim.name}"`); continue }
    const pb     = anim.playback
    const action = mixer.clipAction(clip)
    action.loop              = pb.loop ? THREE.LoopRepeat : THREE.LoopOnce
    action.clampWhenFinished = !pb.loop
    action.timeScale         = pb.timeScale
    action.reset().play()
    action.time              = anim.currentTime   // seek to computed position
    console.log(`[inspector] replayPlayingAnimations — started "${anim.name}" at t=${anim.currentTime.toFixed(2)}`)
  }
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

const animCtrl = new AnimationController(client)

animCtrl.on('animation:play', ({ animation }) => {
  if (!mixer) return
  const clip = clipMap.get(animation.name)
  if (!clip) { console.warn(`[inspector] animation:play — no clip for "${animation.name}"`); return }
  const action = mixer.clipAction(clip)
  action.loop              = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce
  action.clampWhenFinished = !animation.loop
  action.timeScale         = animation.timeScale
  action.reset().play()
  action.time              = animation.currentTime
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

animCtrl.on('animation:playback-changed', ({ animation, playback }) => {
  if (!mixer) return
  const clip = clipMap.get(animation.name)
  if (!clip) return
  const action = mixer.existingAction(clip)
  if (!action) return
  action.setLoop(playback.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
  action.setEffectiveTimeScale(playback.timeScale)
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
const animationsPanel = new AnimationsPanel(animationsPanelEl)

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
  initAnimations()
  replayPlayingAnimations(client.som)
  treeView.build(client.som)
  propSheet.clear()
  worldInfo.show(client.som)
  animationsPanel.show(client.som, animCtrl)
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
    loadBackground(client.som.extras?.atrium?.background, worldBaseUrl)
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

  nav.tick(dt)
  animCtrl.tick(dt)
  if (mixer) mixer.update(dt)

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
