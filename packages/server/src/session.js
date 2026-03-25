// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validate } from '@atrium/protocol'
import { createTickLoop } from './tick.js'
import { createPresence } from './presence.js'

const MIN_TICK_INTERVAL = 50
const DEFAULT_TICK_INTERVAL = 1000
const KEEPALIVE_INTERVAL = 30_000

let serverSeq = 0

function nextSeq() {
  return ++serverSeq
}

function sendError(ws, seq, code, message) {
  ws.send(JSON.stringify({ type: 'error', code, message, ...(seq != null ? { seq } : {}) }))
}

// Compute a quaternion that rotates the glTF default forward [0,0,-1] to `look`.
function lookToQuaternion(look) {
  const [lx, ly, lz] = look
  const dot = -lz  // dot([0,0,-1], look) = -lz
  if (dot < -0.9999) return [0, 1, 0, 0]   // 180° around Y
  // cross([0,0,-1], look)
  const cx =  ly
  const cy = -lx
  const cz =  0
  const qw = 1 + dot
  const len = Math.sqrt(cx*cx + cy*cy + cz*cz + qw*qw)
  return [cx/len, cy/len, cz/len, qw/len]
}

export function createSessionServer({ port = 3000, maxUsers = 100, world = null } = {}) {
  const sessions = new Map()
  const presence = createPresence()
  const wss = new WebSocketServer({ port })

  function broadcast(message) {
    const raw = JSON.stringify(message)
    for (const s of sessions.values()) {
      if (s.ws.readyState === 1 /* OPEN */) {
        s.ws.send(raw)
      }
    }
  }

  function broadcastExcept(excludeSession, message) {
    const raw = JSON.stringify(message)
    for (const [, s] of sessions) {
      if (s !== excludeSession && s.ws.readyState === 1 /* OPEN */) {
        s.ws.send(raw)
      }
    }
  }

  wss.on('connection', (ws) => {
    let session = null

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        sendError(ws, null, 'UNKNOWN_MESSAGE', 'Invalid JSON')
        return
      }

      const { valid, errors } = validate('client', msg)
      if (!valid) {
        const detail = errors[0]?.message ?? 'Validation failed'
        sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', detail)
        return
      }

      if (!session && msg.type !== 'hello') {
        sendError(ws, msg.seq ?? null, 'AUTH_FAILED', 'Handshake required')
        return
      }

      switch (msg.type) {
        case 'hello': {
          if (sessions.size >= maxUsers) {
            sendError(ws, null, 'WORLD_FULL', 'Server is full')
            ws.close()
            return
          }

          const clientInterval = msg.capabilities?.tick?.interval ?? DEFAULT_TICK_INTERVAL
          const negotiated = Math.max(clientInterval, MIN_TICK_INTERVAL)

          // Use the client-provided UUID as session ID so avatar node name = session ID
          session = {
            ws,
            id: msg.id ?? randomUUID(),
            capabilities: msg.capabilities ?? {},
            seq: nextSeq(),
            alive: true,
            tickStop: null,
            avatarNodeName: null,
          }
          sessions.set(session.id, session)

          ws.send(JSON.stringify({
            type: 'hello',
            id: session.id,
            seq: session.seq,
            serverTime: Date.now(),
            capabilities: {
              tick: { interval: negotiated, minInterval: MIN_TICK_INTERVAL },
            },
          }))

          session.tickStop = createTickLoop(session, negotiated).stop

          // Send full SOM dump to the joining client
          if (world) {
            try {
              const gltf = await world.serialize()
              if (session && session.ws.readyState === 1 /* OPEN */) {
                session.ws.send(JSON.stringify({ type: 'som-dump', seq: nextSeq(), gltf }))
              }
            } catch (err) {
              console.error('som-dump serialize failed:', err)
            }
          }

          // Step 1: notify existing clients of the newcomer (default position)
          const joinNewcomer = { type: 'join', seq: nextSeq(), id: session.id, position: [0, 0, 0] }
          const { valid: jv1 } = validate('server', joinNewcomer)
          if (jv1) {
            const rawJoin = JSON.stringify(joinNewcomer)
            for (const [sid, s] of sessions) {
              if (sid !== session.id && s.ws.readyState === 1 /* OPEN */) {
                s.ws.send(rawJoin)
              }
            }
          } else {
            console.error('join validation failed for newcomer broadcast')
          }

          // Step 2: bootstrap the newcomer with each existing client's current position
          for (const entry of presence.list()) {
            const joinExisting = { type: 'join', seq: nextSeq(), id: entry.id, position: entry.position }
            const { valid: jv2 } = validate('server', joinExisting)
            if (jv2) {
              session.ws.send(JSON.stringify(joinExisting))
            } else {
              console.error('join validation failed for bootstrap')
            }
          }

          // Step 3: add newcomer to presence
          presence.add(session.id)
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          }))
          break
        }

        case 'send': {
          if (!world) {
            sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
            break
          }
          const result = world.setField(msg.node, msg.field, msg.value)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.node}`)
            break
          }
          broadcast({
            type: 'set',
            seq: nextSeq(),
            node: msg.node,
            field: msg.field,
            value: msg.value,
            serverTime: Date.now(),
            session: session.id,
          })
          break
        }

        case 'add': {
          if (!world) {
            sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
            break
          }
          const result = world.addNode(msg.node, msg.parent)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.parent}`)
            break
          }
          // Track avatar node name for this session
          if (msg.id) session.avatarNodeName = msg.node.name
          broadcastExcept(session, {
            type: 'add',
            seq: nextSeq(),
            format: msg.format ?? 'gltf',
            ...(msg.parent != null ? { parent: msg.parent } : {}),
            node: msg.node,
          })
          break
        }

        case 'view': {
          presence.setPosition(session.id, msg.position)

          // Update avatar SOM node with latest position and orientation
          if (world && session.avatarNodeName) {
            const avatarNode = world.getNode(session.avatarNodeName)
            if (avatarNode) {
              avatarNode.translation = msg.position
              if (msg.look) avatarNode.rotation = lookToQuaternion(msg.look)
            }
          }

          const outbound = {
            type: 'view',
            id: session.id,
            position: msg.position,
            ...(msg.look               && { look: msg.look }),
            ...(msg.move               && { move: msg.move }),
            ...(msg.velocity !== undefined && { velocity: msg.velocity }),
            ...(msg.up                 && { up: msg.up }),
          }
          const { valid: vv } = validate('server', outbound)
          if (vv) {
            broadcastExcept(session, outbound)
          } else {
            console.error('view validation failed')
          }
          break
        }

        case 'remove': {
          if (!world) {
            sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
            break
          }
          const result = world.removeNode(msg.node)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.node}`)
            break
          }
          broadcastExcept(session, {
            type: 'remove',
            seq: nextSeq(),
            node: msg.node,
          })
          break
        }

        default:
          sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', `Unhandled message type: ${msg.type}`)
      }
    })

    ws.on('close', () => {
      if (session) {
        const departedId = session.id
        const avatarNodeName = session.avatarNodeName
        session.tickStop?.()
        sessions.delete(departedId)
        const removed = presence.remove(departedId)
        session = null

        if (removed) {
          const leaveMsg = { type: 'leave', seq: nextSeq(), id: departedId }
          const { valid } = validate('server', leaveMsg)
          if (valid) {
            broadcast(leaveMsg)
          } else {
            console.error('leave validation failed')
          }

          // Remove avatar node from SOM and notify all clients
          if (world && avatarNodeName) {
            world.removeNode(avatarNodeName)
            broadcast({ type: 'remove', seq: nextSeq(), id: departedId })
          }
        }
      }
    })

    ws.on('pong', () => {
      if (session) session.alive = true
    })
  })

  const keepaliveTimer = setInterval(() => {
    for (const [id, s] of sessions) {
      if (!s.alive) {
        s.ws.terminate()
        sessions.delete(id)
      } else {
        s.alive = false
        s.ws.ping()
      }
    }
  }, KEEPALIVE_INTERVAL)

  wss.on('close', () => {
    clearInterval(keepaliveTimer)
  })

  return { wss, sessions, presence }
}
