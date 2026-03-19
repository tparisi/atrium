// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { DocumentView } from '@gltf-transform/view'
import { AtriumClient } from '@atrium/client'

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

let docView = null
let sceneGroup = null

function initDocumentView(somDocument) {
  if (docView) { docView.dispose(); threeScene.remove(sceneGroup) }
  docView    = new DocumentView(renderer)
  
  const sceneDef = somDocument.document.getRoot().listScenes()[0]
  sceneGroup = docView.view(sceneDef)
  threeScene.add(sceneGroup)
}

// ---------------------------------------------------------------------------
// Peer avatar meshes (managed directly, bypassing DocumentView for v0.1)
// ---------------------------------------------------------------------------

const peerMeshes = new Map()  // displayName → THREE.Mesh

function buildCapsuleMesh() {
  const geo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const mat = new THREE.MeshStandardMaterial({ color: 0x7fbfff })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

function addPeerMesh(displayName) {
  if (peerMeshes.has(displayName)) return
  const mesh = buildCapsuleMesh()
  mesh.position.set(0, 0.7, 0)
  threeScene.add(mesh)
  peerMeshes.set(displayName, mesh)
}

function removePeerMesh(displayName) {
  const mesh = peerMeshes.get(displayName)
  if (mesh) {
    threeScene.remove(mesh)
    mesh.geometry.dispose()
    mesh.material.dispose()
    peerMeshes.delete(displayName)
  }
}

function updatePeerMesh(displayName, position, look) {
  const mesh = peerMeshes.get(displayName)
  if (!mesh) return
  if (position) mesh.position.set(...position)
  if (look) {
    // Rotate Y-up capsule to face look direction
    const target = new THREE.Vector3(...look)
    const dummy  = new THREE.Object3D()
    dummy.position.copy(mesh.position)
    dummy.lookAt(dummy.position.clone().add(target))
    mesh.quaternion.copy(dummy.quaternion)
  }
}

// ---------------------------------------------------------------------------
// Avatar capsule descriptor (sent to server via AtriumClient)
// ---------------------------------------------------------------------------

function buildAvatarDescriptor(name) {
  const geo     = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const positions = Array.from(geo.attributes.position.array)
  const normals   = Array.from(geo.attributes.normal.array)
  const indices   = Array.from(geo.index.array)
  geo.dispose()

  return {
    name,
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: {
      primitives: [{
        attributes: { POSITION: positions, NORMAL: normals },
        indices,
        material: {
          pbrMetallicRoughness: {
            baseColorFactor: [0.5, 0.7, 1.0, 1.0],
            metallicFactor:  0.0,
            roughnessFactor: 0.7,
          },
        },
      }],
    },
  }
}

// ---------------------------------------------------------------------------
// AtriumClient
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })

client.on('world:loaded', () => {
  if (client.som) initDocumentView(client.som)
})

client.on('peer:join', ({ displayName }) => {
  addPeerMesh(displayName)
})

client.on('peer:leave', ({ displayName }) => {
  removePeerMesh(displayName)
})

client.on('peer:view', ({ displayName, position, look }) => {
  updatePeerMesh(displayName, position, look)
})

client.on('connected',    () => setStatus('connected'))
client.on('disconnected', () => setStatus('disconnected'))
client.on('error', (err) => console.error('[app] client error:', err))

// ---------------------------------------------------------------------------
// UI actions
// ---------------------------------------------------------------------------

function setStatus(state) {
  statusDot.className = 'status-dot ' + state
  connectBtn.textContent = state === 'connected' ? 'Disconnect' : 'Connect'
}

loadBtn.addEventListener('click', async () => {
  const url = worldUrlInput.value.trim()
  if (!url) return
  loadBtn.disabled = true
  overlayEl.textContent = 'Loading…'
  try {
    await client.loadWorld(url)
    overlayEl.textContent = 'Click to capture mouse · WASD to move · Mouse to look · Esc to release'
  } catch (err) {
    overlayEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  } finally {
    loadBtn.disabled = false
  }
})

connectBtn.addEventListener('click', () => {
  if (connectBtn.textContent === 'Disconnect') {
    client.disconnect()
    return
  }
  const wsUrl = wsUrlInput.value.trim()
  if (!wsUrl) return
  setStatus('connecting')
  const { displayName } = deriveIdentity()
  const avatar = buildAvatarDescriptor(displayName)
  client.connect(wsUrl, { avatar })
})

function deriveIdentity() {
  // Called just before connect — identity is freshly generated each connect()
  // We need displayName to build the avatar descriptor before connect() sets it.
  // We use a temp UUID to derive; AtriumClient will generate its own.
  // For v0.1, pre-build with a placeholder and accept the mismatch is OK —
  // the descriptor name is what matters, not the interim UUID.
  const tmpId   = crypto.randomUUID()
  const shortId = tmpId.slice(0, 4)
  return { displayName: `User-${shortId}` }
}

// ---------------------------------------------------------------------------
// First-person navigation
// ---------------------------------------------------------------------------

const keys      = new Set()
let yaw         = 0    // radians
let pitch       = 0    // radians, clamped
let pointerLock = false

const SPEED     = 1.4  // m/s default
const TICK_MS   = 1000 / 60

viewportEl.addEventListener('click', () => {
  viewportEl.requestPointerLock()
})

document.addEventListener('pointerlockchange', () => {
  pointerLock = document.pointerLockElement === viewportEl
})

document.addEventListener('mousemove', (e) => {
  if (!pointerLock) return
  yaw   -= e.movementX * 0.002
  pitch -= e.movementY * 0.002
  pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch))
})

document.addEventListener('keydown', (e) => { keys.add(e.code) })
document.addEventListener('keyup',   (e) => { keys.delete(e.code) })

// Euler → look vector (glTF forward is -Z)
function getLookVector() {
  const x = Math.sin(yaw) * Math.cos(pitch)
  const y = Math.sin(pitch)
  const z = -Math.cos(yaw) * Math.cos(pitch)
  return [x, y, z]
}

function getMoveVector() {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp')
  const bwd = keys.has('KeyS') || keys.has('ArrowDown')
  const lft = keys.has('KeyA') || keys.has('ArrowLeft')
  const rgt = keys.has('KeyD') || keys.has('ArrowRight')

  let dx = 0, dz = 0
  if (fwd) dz -= 1
  if (bwd) dz += 1
  if (lft) dx -= 1
  if (rgt) dx += 1

  const len = Math.sqrt(dx * dx + dz * dz)
  if (len === 0) return null
  return [dx / len, 0, dz / len]
}

let lastTick = performance.now()

function tick(now) {
  requestAnimationFrame(tick)

  const dt   = (now - lastTick) / 1000
  lastTick   = now

  // Update camera orientation
  const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
  camera.quaternion.copy(qYaw).multiply(qPitch)

  // Move camera
  const move = getMoveVector()
  if (move) {
    const speed   = SPEED * dt
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(qYaw)
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(qYaw)
    camera.position.addScaledVector(forward, -move[2] * speed)
    camera.position.addScaledVector(right,    move[0] * speed)
    // Keep vertical navigation minimal in WALK mode
    camera.position.y = Math.max(0.2, camera.position.y)
  }

  // Report view state to AtriumClient
  const look     = getLookVector()
  const position = [camera.position.x, camera.position.y, camera.position.z]
  client.setView({
    position,
    look,
    move:     move ?? [0, 0, 0],
    velocity: move ? SPEED : 0,
  })

  // Render
  // if (docView) docView.render()
  renderer.render(threeScene, camera)
}

requestAnimationFrame(tick)
