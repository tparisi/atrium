// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { SOMDocument } from '@atrium/som'

// ---------------------------------------------------------------------------
// Minimal EventEmitter — works in Node.js and browsers without a build step
// ---------------------------------------------------------------------------

class EventEmitter {
  constructor() { this._listeners = Object.create(null) }

  on(event, fn) {
    ;(this._listeners[event] ??= []).push(fn)
    return this
  }

  off(event, fn) {
    const arr = this._listeners[event]
    if (arr) {
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    }
    return this
  }

  once(event, fn) {
    const wrapper = (...args) => { this.off(event, wrapper); fn(...args) }
    return this.on(event, wrapper)
  }

  emit(event, ...args) {
    const arr = this._listeners[event]
    if (arr) for (const fn of [...arr]) fn(...args)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Compute quaternion rotating glTF forward [0,0,-1] to `look` unit vector.
function lookToQuaternion(look) {
  const [lx, ly, lz] = look
  const dot = -lz                        // dot([0,0,-1], look)
  if (dot < -0.9999) return [0, 1, 0, 0] // 180° around Y
  const cx = ly, cy = -lx, cz = 0
  const qw = 1 + dot
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz + qw * qw)
  return [cx / len, cy / len, cz / len, qw / len]
}

function makeWebIO() {
  return new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
}

// ---------------------------------------------------------------------------
// AtriumClient
// ---------------------------------------------------------------------------

export class AtriumClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {boolean}  [opts.debug=false]  - Gate verbose console logging
   * @param {Function} [opts.WebSocket]    - WebSocket constructor (injectable for testing)
   */
  constructor({ debug = false, WebSocket: WSImpl = globalThis.WebSocket } = {}) {
    super()
    this._debug  = debug
    this._WSImpl = WSImpl

    // Connection state
    this._ws        = null
    this._connected = false

    // Session identity — assigned in connect()
    this._sessionId      = null
    this._displayName    = null
    this._avatarNodeName = null
    this._avatarDescriptor = null   // opaque; set by apps/client via connect()

    // World / SOM
    this._som     = null
    this._navInfo = null

    // Peer session tracking: sessionId → displayName
    this._peerSessions = new Map()

    // setView rate-limiting state
    this._pendingView    = null
    this._lastSentAt     = 0
    this._viewSeq        = 0
    this._viewFlushTimer = null

    // Outbound send sequence counter
    this._sendSeq = 0

    // Loopback prevention flag — true while applying a remote set
    this._applyingRemote = false
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** The live SOMDocument instance. Read-only for apps/client. */
  get som() { return this._som }

  /** Connection status. Read-only for apps/client. */
  get connected() { return this._connected }

  /** The display name assigned in connect(). Null before connect(). */
  get displayName() { return this._displayName }

  /**
   * Connect to a running Atrium server.
   * @param {string} wsUrl  - WebSocket URL, e.g. ws://localhost:3000
   * @param {object} opts
   * @param {object} [opts.avatar] - Opaque glTF node descriptor for the local avatar
   */
  connect(wsUrl, { avatar } = {}) {
    if (this._ws) this.disconnect()

    const sessionId      = globalThis.crypto.randomUUID()
    const shortId        = sessionId.slice(0, 4)
    this._sessionId      = sessionId
    this._displayName    = `User-${shortId}`
    this._avatarNodeName = this._displayName
    this._avatarDescriptor = avatar ?? null
    if (this._avatarDescriptor) {
      this._avatarDescriptor.name = this._displayName
      this._avatarDescriptor.extras = { ...this._avatarDescriptor.extras, displayName: this._displayName }
    }
    
    this._log(`Connecting to ${wsUrl}`)

    const ws = new this._WSImpl(wsUrl)
    this._ws = ws

    const onOpen = () => {
      this._log('Connection open')
      ws.send(JSON.stringify({
        type: 'hello',
        id:   sessionId,
        capabilities: { tick: { interval: 5000 } },
      }))
    }

    // Raw data → string → parsed message dispatch
    const dispatch = async (raw) => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }

      if (this._debug) this._log(`← ${msg.type}`)

      switch (msg.type) {
        case 'hello':    await this._onServerHello(msg); break
        case 'som-dump': await this._onSomDump(msg);     break
        case 'add':      this._onAdd(msg);               break
        case 'remove':   this._onRemove(msg);            break
        case 'set':      this._onSet(msg);               break
        case 'view':     this._onView(msg);              break
        case 'join':     this._onJoin(msg);              break
        case 'leave':    this._onLeave(msg);             break
        case 'tick':     /* ignored */                   break
        case 'pong':     /* ignored */                   break
        case 'error':
          this.emit('error', new Error(`${msg.code}: ${msg.message ?? ''}`))
          break
      }
    }

    const onClose = () => {
      this._log('Connection closed')
      this._connected = false
      this._ws = null
      this.emit('disconnected')
    }

    const onError = (evt) => {
      this.emit('error', evt instanceof Error ? evt : new Error(String(evt)))
    }

    // Prefer EventEmitter API (ws package in Node.js); fall back to EventTarget (browser)
    if (typeof ws.on === 'function') {
      ws.on('open',    onOpen)
      ws.on('message', (data) => dispatch(data))   // ws passes data directly
      ws.on('close',   onClose)
      ws.on('error',   onError)
    } else {
      ws.addEventListener('open',    onOpen)
      ws.addEventListener('message', (evt) => dispatch(evt.data))   // MessageEvent.data
      ws.addEventListener('close',   onClose)
      ws.addEventListener('error',   onError)
    }
  }

  disconnect() {
    if (this._ws) {
      this._ws.close()
      this._ws = null
    }
    this._connected = false
    if (this._viewFlushTimer) {
      clearTimeout(this._viewFlushTimer)
      this._viewFlushTimer = null
    }
  }

  /**
   * Load a world from a static URL (no server required).
   * @param {string} url - HTTP URL to a .gltf or .atrium.json file
   */
  async loadWorld(url) {
    const io  = makeWebIO()
    const doc = await io.read(url)
    this._initSom(doc)
    this._attachMutationListeners()
    const meta = doc.getRoot().getExtras()?.atrium?.world ?? {}
    this._emitWorldLoaded(meta)
  }

  /**
   * Report the local navigation state. AtriumClient owns the send policy.
   * Dropped silently if not connected — apps/client never guards this.
   */
  setView({ position, look, move, velocity, up } = {}) {
    if (!this._connected) {
      if (this._debug) this._log('setView dropped — not connected')
      return
    }
    this._pendingView = { position, look, move, velocity, up }
    this._flushView()
  }

  // ---------------------------------------------------------------------------
  // Incoming message handlers
  // ---------------------------------------------------------------------------

  async _onServerHello(_msg) {
    this._connected = true
    console.log(`[AtriumClient] Session ${this._sessionId} (${this._displayName})`)
    this.emit('session:ready', {
      sessionId:   this._sessionId,
      displayName: this._displayName,
    })
  }

  async _onSomDump(msg) {
    const io  = makeWebIO()
    const doc = await io.readJSON({ json: msg.gltf, resources: {} })
    this._initSom(doc)
    this._attachMutationListeners()

    // Add own avatar to local SOM so it appears in tree and can be referenced
    if (this._avatarDescriptor && this._som) {
      const node = this._som.ingestNode(this._avatarDescriptor)
      this._som.scene.addChild(node)
      if (this._debug) this._log(`Local avatar "${this._avatarNodeName}" added to SOM`)
    }

    // Announce avatar to server
    if (this._avatarDescriptor && this._ws) {
      this._wsSend({
        type: 'add',
        id:   this._sessionId,
        seq:  ++this._viewSeq,
        node: this._avatarDescriptor,
      })
    }

    const meta = doc.getRoot().getExtras()?.atrium?.world ?? {}
    this._emitWorldLoaded(meta)
  }

  _onAdd(msg) {
    if (!this._som) return

    const node = this._som.ingestNode(msg.node)
    this._som.scene.addChild(node)
    this._attachNodeListeners(node)

    const nodeName = msg.node.name
    if (this._debug) this._log(`som:add "${nodeName}"`)

    // Check if this add corresponds to a pending peer join
    let peerSessionId = null
    for (const [sid, dname] of this._peerSessions) {
      if (dname === nodeName) { peerSessionId = sid; break }
    }

    this.emit('som:add', { nodeName })

    if (peerSessionId !== null) {
      this.emit('peer:join', { sessionId: peerSessionId, displayName: nodeName })
    }
  }

  _onRemove(msg) {
    // Avatar disconnects: server sends { type: 'remove', id: departedSessionId }
    // World-object removes: server sends { type: 'remove', node: 'name' }
    const isPeerRemove = msg.id != null && msg.node == null
    const nodeName = isPeerRemove
      ? `User-${msg.id.slice(0, 4)}`
      : msg.node

    if (nodeName && this._som) {
      const node = this._som.getNodeByName(nodeName)
      if (node) node.dispose()
    }

    if (this._debug) this._log(`som:remove "${nodeName}"`)
    this.emit('som:remove', { nodeName })

    if (isPeerRemove) {
      const displayName = nodeName
      this.emit('peer:leave', { sessionId: msg.id, displayName })
    }
  }

  _onSet(msg) {
    if (!this._som) return
    // Case 1: own echo — server reflected our send back; skip SOM update entirely
    if (msg.session === this._sessionId) return

    // Case 2: remote set — apply to SOM but guard against re-broadcast via mutation listener
    this._applyingRemote = true
    try {
      const node = this._som.getNodeByName(msg.node)
      if (node) this._som.setPath(node, msg.field, msg.value)
    } finally {
      this._applyingRemote = false
    }

    if (this._debug) this._log(`som:set ${msg.node}.${msg.field}`)
    this.emit('som:set', { nodeName: msg.node, path: msg.field, value: msg.value })
  }

  _onView(msg) {
    if (!this._som) return

    // Update peer avatar position/orientation in SOM — guard against re-broadcast
    const displayName = `User-${msg.id.slice(0, 4)}`
    const peerNode    = this._som.getNodeByName(displayName)
    if (peerNode) {
      this._applyingRemote = true
      try {
        if (msg.position) peerNode.translation = msg.position
        if (msg.look)     peerNode.rotation    = lookToQuaternion(msg.look)
      } finally {
        this._applyingRemote = false
      }
    }

    if (this._debug) this._log(`peer:view from ${displayName}`)
    this.emit('peer:view', {
      displayName,
      position: msg.position,
      look:     msg.look,
      move:     msg.move,
      velocity: msg.velocity,
      up:       msg.up,
    })
  }

  _onJoin(msg) {
    // Track the peer session so _onAdd can match it up and emit peer:join
    const displayName = `User-${msg.id.slice(0, 4)}`
    this._peerSessions.set(msg.id, displayName)
    if (this._debug) this._log(`join: ${displayName} (${msg.id})`)
  }

  _onLeave(msg) {
    // peer:leave is emitted from _onRemove; just clean up tracking here
    this._peerSessions.delete(msg.id)
    if (this._debug) this._log(`leave: ${msg.id}`)
  }

  // ---------------------------------------------------------------------------
  // Mutation listener attachment
  // ---------------------------------------------------------------------------

  /** Attach mutation listeners to all nodes currently in the SOM. */
  _attachMutationListeners() {
    if (!this._som) return
    for (const node of this._som.nodes) {
      this._attachNodeListeners(node)
    }
  }

  /**
   * Attach mutation listeners to a single node and its mesh/primitive/material/camera
   * subtree. The node name is captured in a closure — no IDs stored on SOM objects.
   */
  _attachNodeListeners(node) {
    const nodeName = node.name

    // Skip local avatar — position communicated via view messages, not send
    if (nodeName === this._avatarNodeName) return

    node.addEventListener('mutation', (event) => {
      this._onLocalMutation(nodeName, event.detail.property, event.detail.value)
    })

    const mesh = node.mesh
    if (mesh) {
      mesh.addEventListener('mutation', (event) => {
        if (!event.detail.property) return   // skip childList events on mesh
        this._onLocalMutation(nodeName, `mesh.${event.detail.property}`, event.detail.value)
      })

      mesh.primitives.forEach((prim, i) => {
        prim.addEventListener('mutation', (event) => {
          if (!event.detail.property) return   // skip childList events
          this._onLocalMutation(
            nodeName,
            `mesh.primitives[${i}].${event.detail.property}`,
            event.detail.value
          )
        })

        const material = prim.material
        if (material) {
          material.addEventListener('mutation', (event) => {
            if (!event.detail.property) return
            this._onLocalMutation(
              nodeName,
              `mesh.primitives[${i}].material.${event.detail.property}`,
              event.detail.value
            )
          })
        }
      })
    }

    const camera = node.camera
    if (camera) {
      camera.addEventListener('mutation', (event) => {
        if (!event.detail.property) return
        this._onLocalMutation(nodeName, `camera.${event.detail.property}`, event.detail.value)
      })
    }
  }

  /** Called by mutation listeners — sends a `send` message to the server. */
  _onLocalMutation(nodeName, path, value) {
    if (this._applyingRemote) return
    if (!this._connected) return
    this._wsSend({ type: 'send', seq: ++this._sendSeq, node: nodeName, field: path, value })
  }

  // ---------------------------------------------------------------------------
  // setView send policy
  // ---------------------------------------------------------------------------

  _flushView() {
    if (!this._connected || !this._ws) return
    if (!this._pendingView) return

    const maxViewRate  = this._navInfo?.updateRate?.maxViewRate ?? 20
    const minInterval  = 1000 / maxViewRate
    const now          = Date.now()

    if (now - this._lastSentAt < minInterval) {
      // Schedule a deferred flush if not already pending
      if (!this._viewFlushTimer) {
        const delay = minInterval - (now - this._lastSentAt)
        this._viewFlushTimer = setTimeout(() => {
          this._viewFlushTimer = null
          this._flushView()
        }, delay)
        if (this._debug) this._log('view deferred (rate limit)')
      }
      return
    }

    const v = this._pendingView
    this._pendingView = null
    this._lastSentAt  = now

    const msg = {
      type:     'view',
      seq:      ++this._viewSeq,
      position: v.position ?? [0, 0, 0],
      ...(v.look               && { look:     v.look }),
      ...(v.move               && { move:     v.move }),
      ...(v.velocity !== undefined && { velocity: v.velocity }),
      ...(v.up                 && { up:       v.up }),
    }

    if (this._debug) this._log('→ view', msg)
    this._wsSend(msg)
  }

  // ---------------------------------------------------------------------------
  // Internal utilities
  // ---------------------------------------------------------------------------

  _initSom(doc) {
    this._som     = new SOMDocument(doc)
    this._navInfo = doc.getRoot().getExtras()?.atrium?.navigation ?? null
  }

  _emitWorldLoaded(meta) {
    const name   = meta.name        ?? undefined
    const desc   = meta.description ?? undefined
    const author = meta.author      ?? undefined
    console.log(`[AtriumClient] World loaded: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
    if (desc) console.log(`  ${desc}`)
    this.emit('world:loaded', { name, description: desc, author })
  }

  _wsSend(msg) {
    if (this._ws && (this._ws.readyState === 1 || this._ws.readyState === WebSocket?.OPEN)) {
      this._ws.send(JSON.stringify(msg))
    }
  }

  _log(msg, data) {
    if (data !== undefined) {
      console.log(`[AtriumClient] ${msg}`, data)
    } else {
      console.log(`[AtriumClient] ${msg}`)
    }
  }
}
