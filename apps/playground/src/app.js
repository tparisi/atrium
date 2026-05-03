// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * Pointer Playground — three demonstration scenes in one world:
 *
 *   crate-01   Rollover (pointerover/pointerout): emissive highlight on hover.
 *   lamp-01    Click-toggle: click hides the node; Reset button restores all.
 *   any node   Select-then-drag: click to select, then drag to translate along
 *              the world-space horizontal plane captured at mousedown.
 *
 * Uses PointerInputBridge with suppressOnCapture: false — the playground has
 * no nav controller, so there is no capture/nav coexistence concern, and
 * the option is exercised deliberately to validate it.
 */

import * as THREE from 'three'
import { DocumentView }       from '@gltf-transform/view'
import { AtriumClient }       from '@atrium/client'
import { PointerInputBridge, projectRayToPlane, computeParentInverse } from '@atrium/renderer-three'

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const viewportEl = document.getElementById('viewport')
const statusEl   = document.getElementById('status')
const resetBtn   = document.getElementById('resetBtn')

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
viewportEl.appendChild(renderer.domElement)

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

// Fixed camera — no nav controller (validates suppressOnCapture: false)
const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000)
camera.position.set(0, 6, 10)
camera.lookAt(0, 0, 0)

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
// AtriumClient
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for console debugging

// ---------------------------------------------------------------------------
// PointerInputBridge
//
// suppressOnCapture: false — no nav controller in the playground, so there
// is no stopPropagation needed. Exercising this option validates it works.
// ---------------------------------------------------------------------------

const pointerBridge = new PointerInputBridge({
  client,
  canvas,
  camera,
  sceneRoot:         () => sceneGroup,
  suppressOnCapture: false,
})

// ---------------------------------------------------------------------------
// Rollover — emissive highlight on crate-01
// ---------------------------------------------------------------------------

const ROLLOVER_NODE   = 'crate-01'
const HIGHLIGHT_COLOR = new THREE.Color(0x555500)   // warm yellow emissive
let _savedEmissives   = []   // [{ mesh, color }] for restore

function setRolloverHighlight(node, on) {
  const threeObj = sceneGroup?.getObjectByName(node.name)
  if (!threeObj) return
  if (on) {
    _savedEmissives = []
    threeObj.traverse((obj) => {
      if (obj.isMesh && obj.material?.emissive) {
        _savedEmissives.push({ mesh: obj, color: obj.material.emissive.clone() })
        obj.material.emissive.copy(HIGHLIGHT_COLOR)
      }
    })
  } else {
    for (const { mesh, color } of _savedEmissives) {
      if (mesh.material?.emissive) mesh.material.emissive.copy(color)
    }
    _savedEmissives = []
  }
}

// ---------------------------------------------------------------------------
// Toggle visibility — lamp-01
// ---------------------------------------------------------------------------

const TOGGLE_NODE = 'lamp-shade'
let _hiddenNodes  = new Set()   // names of nodes hidden by click

function toggleNodeVisibility(node) {
  const threeObj = sceneGroup?.getObjectByName(node.name)
  if (!threeObj) return
  threeObj.visible = !threeObj.visible
  if (threeObj.visible) {
    _hiddenNodes.delete(node.name)
  } else {
    _hiddenNodes.add(node.name)
    statusEl.textContent = `${node.name} hidden — click Reset to restore`
  }
}

function resetVisibility() {
  if (!sceneGroup) return
  _hiddenNodes.forEach(name => {
    const obj = sceneGroup.getObjectByName(name)
    if (obj) obj.visible = true
  })
  _hiddenNodes.clear()
  statusEl.textContent = 'Ready'
}

resetBtn.addEventListener('click', resetVisibility)

// ---------------------------------------------------------------------------
// Drag-to-translate (select-then-drag, same as Inspector)
// ---------------------------------------------------------------------------

let selected  = null
let dragState = null

function setSelected(node) {
  selected = node
  statusEl.textContent = node ? `Selected: ${node.name}` : 'Ready'
}

function onNodeMouseDown(node, e) {
  if (selected !== node) return   // first click selects; second drag translates
  const threeObj = sceneGroup?.getObjectByName(node.name)
  if (!threeObj) return
  const worldPos   = threeObj.getWorldPosition(new THREE.Vector3())
  const planeY     = worldPos.y
  const initCursor = projectRayToPlane(e.detail.ray, planeY)
  if (!initCursor) return
  client.setPointerCapture(node)
  dragState = {
    node,
    dragPlaneY:          planeY,
    initialCursorWorld:  initCursor,
    initialNodeWorldPos: worldPos.clone(),
    parentWorldInverse:  computeParentInverse(threeObj),
  }
}

function onNodeMouseMove(node, e) {
  if (!dragState || dragState.node !== node) return
  const cursorWorld = projectRayToPlane(e.detail.ray, dragState.dragPlaneY)
  if (!cursorWorld) return
  const delta       = cursorWorld.clone().sub(dragState.initialCursorWorld)
  const newWorldPos = dragState.initialNodeWorldPos.clone().add(delta)
  const newLocalPos = newWorldPos.applyMatrix4(dragState.parentWorldInverse)
  node.translation  = [newLocalPos.x, newLocalPos.y, newLocalPos.z]
}

function onNodeMouseUp(node) {
  if (!dragState || dragState.node !== node) return
  dragState = null
}

// ---------------------------------------------------------------------------
// world:loaded — attach all demo behaviors
// ---------------------------------------------------------------------------

client.on('world:loaded', ({ name }) => {
  if (!client.som) return

  selected  = null
  dragState = null
  _hiddenNodes.clear()

  initDocumentView(client.som)
  statusEl.textContent = name ? `World: ${name}` : 'Ready'

  for (const node of client.som.nodes) {
    if (node.extras?.atrium?.ephemeral) continue

    // Rollover highlight — crate-01 only
    if (node.name === ROLLOVER_NODE) {
      node.addEventListener('pointerover', () => setRolloverHighlight(node, true))
      node.addEventListener('pointerout',  () => setRolloverHighlight(node, false))
    }

    // Click-toggle visibility — lamp-01 only
    if (node.name === TOGGLE_NODE) {
      node.addEventListener('click', () => toggleNodeVisibility(node))
    }

    // Click-to-select + drag-to-translate — all non-ephemeral nodes
    node.addEventListener('click',       () => setSelected(node))
    node.addEventListener('pointerdown', (e) => onNodeMouseDown(node, e))
    node.addEventListener('pointermove', (e) => onNodeMouseMove(node, e))
    node.addEventListener('pointerup',   () => onNodeMouseUp(node))
  }
})

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

client.loadWorld(new URL('../../../tests/fixtures/space.gltf', import.meta.url).href)
  .catch(err => {
    statusEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  })

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function tick() {
  requestAnimationFrame(tick)
  renderer.render(threeScene, camera)
}

requestAnimationFrame(tick)
