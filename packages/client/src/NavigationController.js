// SPDX-License-Identifier: MIT
// NavigationController.js — keyboard/mouse driven navigation; no Three.js dependency

import { SOMEvent } from '@atrium/som'

function yawQuat(yaw)    { return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] }
function pitchQuat(p)    { return [Math.sin(p / 2), 0, 0, Math.cos(p / 2)] }
function forwardVec(yaw) { return [-Math.sin(yaw), 0, -Math.cos(yaw)] }
function rightVec(yaw)   { return [ Math.cos(yaw), 0, -Math.sin(yaw)] }

export class NavigationController {
  constructor(avatar, { mode = 'WALK', mouseSensitivity = 0.002 } = {}) {
    this._avatar           = avatar
    this._mode             = mode
    this._mouseSensitivity = mouseSensitivity
    this._yaw              = 0
    this._pitch            = 0
    this._keys             = new Set()
    this._speed            = 1.4
    this._allowedModes     = ['WALK', 'FLY', 'ORBIT']

    // ORBIT state
    this._orbitTarget    = [0, 0, 0]
    this._orbitRadius    = 10.0
    this._orbitAzimuth   = 0
    this._orbitElevation = 0.3

    this._activeCamera = null
    this._listeners    = {}

    avatar.on('avatar:local-ready', () => this._readNavInfo())
  }

  // ---------------------------------------------------------------------------
  // Getters / setters
  // ---------------------------------------------------------------------------

  get mode()  { return this._mode }
  get yaw()   { return this._yaw }
  set yaw(v)  { this._yaw = v }
  get pitch() { return this._pitch }
  set pitch(v){ this._pitch = v }

  get orbitTarget()    { return this._orbitTarget }
  set orbitTarget(v)   { this._orbitTarget = v }
  get orbitRadius()    { return this._orbitRadius }
  set orbitRadius(v)   { this._orbitRadius = v }

  get activeCamera()  { return this._activeCamera }
  set activeCamera(somCamera) {
    this._activeCamera = somCamera ?? null
    this._dispatchEvent(new SOMEvent('camerachange', { camera: this._activeCamera }))
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  onMouseMove(dx, dy) {
    if (this._mode === 'ORBIT') {
      this._orbitAzimuth  -= dx * this._mouseSensitivity
      this._orbitElevation += dy * this._mouseSensitivity
      this._orbitElevation = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this._orbitElevation))
      return
    }
    this._yaw   -= dx * this._mouseSensitivity
    this._pitch -= dy * this._mouseSensitivity
    this._pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this._pitch))
  }

  onWheel(deltaY) {
    if (this._mode !== 'ORBIT') return
    this._orbitRadius *= deltaY > 0 ? 1.1 : 0.9
    this._orbitRadius  = Math.max(0.5, Math.min(100, this._orbitRadius))
  }

  onKeyDown(key) { this._keys.add(key) }
  onKeyUp(key)   { this._keys.delete(key) }

  setMode(mode) {
    if (!this._allowedModes.includes(mode)) return
    if (mode === this._mode) return
    if (mode === 'ORBIT') this._initOrbitFromCurrentPosition()
    this._mode = mode
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  tick(dt) {
    const localNode  = this._avatar.localNode
    const cameraNode = this._avatar.cameraNode
    if (!localNode) return

    // ── ORBIT mode ────────────────────────────────────────────────────────────
    if (this._mode === 'ORBIT') {
      const az = this._orbitAzimuth
      const el = this._orbitElevation
      const r  = this._orbitRadius
      const t  = this._orbitTarget

      // Spherical to Cartesian (Y-up)
      const x = t[0] + r * Math.cos(el) * Math.sin(az)
      const y = t[1] + r * Math.sin(el)
      const z = t[2] + r * Math.cos(el) * Math.cos(az)

      localNode.translation = [x, y, z]

      // look vector: from camera toward target
      const lx = t[0] - x
      const ly = t[1] - y
      const lz = t[2] - z
      const ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1
      this._avatar.setView({
        position: [x, y, z],
        look:     [lx / ll, ly / ll, lz / ll],
        move:     [0, 0, 0],
        velocity: 0,
      })
      return
    }

    // ── WALK / FLY mode ───────────────────────────────────────────────────────

    // Apply yaw quaternion to avatar node
    localNode.rotation = yawQuat(this._yaw)

    // Apply pitch quaternion to camera child
    if (cameraNode) cameraNode.rotation = pitchQuat(this._pitch)

    // Compute movement (WALK mode — XZ plane)
    const k   = this._keys
    const fwd = k.has('KeyW') || k.has('ArrowUp')
    const bwd = k.has('KeyS') || k.has('ArrowDown')
    const lft = k.has('KeyA') || k.has('ArrowLeft')
    const rgt = k.has('KeyD') || k.has('ArrowRight')

    let dx = 0, dz = 0
    if (fwd) dz -= 1
    if (bwd) dz += 1
    if (lft) dx -= 1
    if (rgt) dx += 1

    const len    = Math.sqrt(dx * dx + dz * dz)
    const moving = len > 0

    if (moving) {
      const ndx   = dx / len
      const ndz   = dz / len
      const speed = this._speed * dt
      const fwdV  = forwardVec(this._yaw)
      const rgtV  = rightVec(this._yaw)
      const pos   = localNode.translation ?? [0, 0.7, 0]
      const newX  = pos[0] + fwdV[0] * (-ndz * speed) + rgtV[0] * (ndx * speed)
      const newZ  = pos[2] + fwdV[2] * (-ndz * speed) + rgtV[2] * (ndx * speed)
      const newY  = Math.max(0.7, pos[1])
      localNode.translation = [newX, newY, newZ]
    }

    // Gather state for setView
    const pos      = localNode.translation ?? [0, 0.7, 0]
    const look     = forwardVec(this._yaw)
    const move     = moving ? [dx / len, 0, dz / len] : [0, 0, 0]
    const velocity = moving ? this._speed : 0

    this._avatar.setView({ position: [...pos], look, move, velocity })
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _dispatchEvent(event) {
    for (const cb of this._listeners[event.type] ?? []) cb(event)
  }

  _initOrbitFromCurrentPosition() {
    const pos    = this._avatar.localNode?.translation ?? [0, 0, 0]
    const target = this._orbitTarget

    const dx = pos[0] - target[0]
    const dy = pos[1] - target[1]
    const dz = pos[2] - target[2]

    this._orbitRadius    = Math.sqrt(dx * dx + dy * dy + dz * dz) || 10
    this._orbitAzimuth   = Math.atan2(dx, dz)
    this._orbitElevation = Math.asin(Math.max(-1, Math.min(1, dy / this._orbitRadius)))
  }

  _readNavInfo() {
    const som = this._avatar._client?.som
    if (!som) return
    const extras  = som.document?.getRoot().getExtras()
    const navInfo = extras?.atrium?.navigation
    if (!navInfo) return
    if (navInfo.speed?.default) this._speed = navInfo.speed.default
    if (Array.isArray(navInfo.mode) && navInfo.mode.length > 0) {
      this._allowedModes = navInfo.mode
      this._mode         = navInfo.mode[0]
    }
  }
}
