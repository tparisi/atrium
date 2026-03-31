// SPDX-License-Identifier: MIT
// NavigationController.js — keyboard/mouse driven navigation; no Three.js dependency

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

    avatar.on('avatar:local-ready', () => this._readNavInfo())
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get mode()  { return this._mode }
  get yaw()   { return this._yaw }
  get pitch() { return this._pitch }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  onMouseMove(dx, dy) {
    this._yaw   -= dx * this._mouseSensitivity
    this._pitch -= dy * this._mouseSensitivity
    this._pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this._pitch))
  }

  onKeyDown(key) { this._keys.add(key) }
  onKeyUp(key)   { this._keys.delete(key) }

  setMode(mode) {
    if (this._allowedModes.includes(mode)) this._mode = mode
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  tick(dt) {
    const localNode  = this._avatar.localNode
    const cameraNode = this._avatar.cameraNode
    if (!localNode) return

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
