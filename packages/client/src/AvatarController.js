// SPDX-License-Identifier: MIT
// AvatarController.js — manages local avatar node, camera child, and peer tracking

class EventEmitter {
  constructor() { this._listeners = Object.create(null) }
  on(event, fn)  { (this._listeners[event] ??= []).push(fn); return this }
  off(event, fn) {
    const list = this._listeners[event]
    if (list) this._listeners[event] = list.filter(f => f !== fn)
    return this
  }
  emit(event, ...args) { for (const fn of this._listeners[event] ?? []) fn(...args) }
}

function vec3Equal(a, b, epsilon = 0.0001) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(a[0] - b[0]) < epsilon
      && Math.abs(a[1] - b[1]) < epsilon
      && Math.abs(a[2] - b[2]) < epsilon
}

export class AvatarController extends EventEmitter {
  constructor(client, { cameraOffsetY = 2.0, cameraOffsetZ = 4.0 } = {}) {
    super()
    this._client        = client
    this._cameraOffsetY = cameraOffsetY
    this._cameraOffsetZ = cameraOffsetZ
    this._localNode     = null
    this._cameraNode    = null
    this._peers         = new Map()
    this._lastSentView  = null
    this._bindClientEvents()
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get localNode()  { return this._localNode }
  get cameraNode() { return this._cameraNode }
  get peerCount()  { return this._peers.size }

  getPeerNode(name) { return this._peers.get(name) ?? null }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setView({ position, look, move, velocity, up } = {}) {
    if (!this._isDirty({ position, look, move, velocity, up })) return
    this._lastSentView = {
      position: position ? [...position] : null,
      look:     look     ? [...look]     : null,
      move:     move     ? [...move]     : null,
      velocity,
      up:       up       ? [...up]       : null,
    }
    this._client.setView({ position, look, move, velocity, up })
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _isDirty({ position, look, move, velocity, up }) {
    if (!this._lastSentView) return true
    if (!vec3Equal(position, this._lastSentView.position)) return true
    if (!vec3Equal(look,     this._lastSentView.look))     return true
    if (!vec3Equal(move,     this._lastSentView.move))     return true
    if (!vec3Equal(up,       this._lastSentView.up))       return true
    if (Math.abs((velocity ?? 0) - (this._lastSentView.velocity ?? 0)) > 0.0001) return true
    return false
  }

  _bindClientEvents() {
    this._client.on('world:loaded',  ()                  => this._onWorldLoaded())
    this._client.on('disconnected',  ()                  => this._onDisconnected())
    this._client.on('peer:join',     ({ displayName })   => this._onPeerJoin(displayName))
    this._client.on('peer:leave',    ({ displayName })   => this._onPeerLeave(displayName))
  }

  _onWorldLoaded() {
    const som = this._client.som
    if (!som) return

    if (this._client.connected) {
      const displayName = this._client.displayName
      const localNode   = som.getNodeByName(displayName)
      if (localNode) {
        const camNode = som.createNode({
          name:        `${displayName}-camera`,
          translation: [0, this._cameraOffsetY, this._cameraOffsetZ],
        })
        localNode.addChild(camNode)
        this._localNode  = localNode
        this._cameraNode = camNode
        this.emit('avatar:local-ready', { node: localNode })
      }
    } else {
      // Static mode — bare navigation node with no geometry, first-person offset
      const localNode = som.createNode({
        name:        '__local_camera',
        translation: [0, 1.6, 0],
      })
      som.scene.addChild(localNode)
      const camNode = som.createNode({
        name:        '__local_camera-child',
        translation: [0, 0, 0],
      })
      localNode.addChild(camNode)
      this._localNode  = localNode
      this._cameraNode = camNode
      this.emit('avatar:local-ready', { node: localNode })
    }

    // Scan for pre-existing peers (late-joiner / som-dump scenario)
    const localDisplayName = this._client.displayName
    for (const node of som.nodes) {
      const extras = node.extras
      if (!extras?.displayName)                        continue
      if (extras.displayName === localDisplayName)     continue
      if (this._peers.has(extras.displayName))         continue
      this._addPeer(extras.displayName, node)
    }
  }

  _onDisconnected() {
    this._localNode    = null
    this._cameraNode   = null
    this._peers.clear()
    this._lastSentView = null
  }

  _onPeerJoin(displayName) {
    const node = this._client.som?.getNodeByName(displayName)
    if (!node) return
    this._addPeer(displayName, node)
  }

  _onPeerLeave(displayName) {
    this._peers.delete(displayName)
    this.emit('avatar:peer-removed', { displayName })
  }

  _addPeer(displayName, node) {
    try {
      const mesh = node.mesh
      if (mesh) {
        const prim = mesh.primitives[0]
        if (prim?.material) {
          const r = Math.random() * 0.5 + 0.5
          const g = Math.random() * 0.5 + 0.5
          const b = Math.random() * 0.5 + 0.5
          prim.material.baseColorFactor = [r, g, b, 1]
        }
      }
    } catch {}
    this._peers.set(displayName, node)
    this.emit('avatar:peer-added', { displayName, node })
  }
}
