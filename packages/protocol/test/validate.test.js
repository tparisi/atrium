// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.js'

// ─── hello ───────────────────────────────────────────────────────

describe('hello (client)', () => {
  it('validates a minimal hello', () => {
    const { valid } = validate('client', { type: 'hello', id: 'client-01' })
    assert.equal(valid, true)
  })

  it('validates a full hello with capabilities', () => {
    const { valid } = validate('client', {
      type: 'hello',
      id: 'client-01',
      ticket: 'token-abc',
      capabilities: { tick: { interval: 1000 }, physics: true, chat: false }
    })
    assert.equal(valid, true)
  })

  it('rejects hello missing id', () => {
    const { valid } = validate('client', { type: 'hello' })
    assert.equal(valid, false)
  })

  it('rejects hello with invalid tick interval', () => {
    const { valid } = validate('client', {
      type: 'hello', id: 'client-01',
      capabilities: { tick: { interval: -1 } }
    })
    assert.equal(valid, false)
  })
})

describe('hello (server)', () => {
  it('validates a server hello', () => {
    const { valid } = validate('server', {
      type: 'hello',
      id: 'server-01',
      seq: 0,
      serverTime: Date.now(),
      capabilities: { tick: { interval: 1000, minInterval: 50 } }
    })
    assert.equal(valid, true)
  })

  it('rejects server hello missing seq', () => {
    const { valid } = validate('server', {
      type: 'hello', id: 'server-01', serverTime: Date.now()
    })
    assert.equal(valid, false)
  })
})

// ─── ping / pong ─────────────────────────────────────────────────

describe('ping', () => {
  it('validates a ping', () => {
    const { valid } = validate('client', { type: 'ping', clientTime: Date.now() })
    assert.equal(valid, true)
  })

  it('rejects ping missing clientTime', () => {
    const { valid } = validate('client', { type: 'ping' })
    assert.equal(valid, false)
  })
})

describe('pong', () => {
  it('validates a pong', () => {
    const { valid } = validate('server', {
      type: 'pong', clientTime: Date.now(), serverTime: Date.now()
    })
    assert.equal(valid, true)
  })

  it('rejects pong missing serverTime', () => {
    const { valid } = validate('server', { type: 'pong', clientTime: Date.now() })
    assert.equal(valid, false)
  })
})

// ─── tick ─────────────────────────────────────────────────────────

describe('tick', () => {
  it('validates a tick', () => {
    const { valid } = validate('server', {
      type: 'tick', seq: 1, serverTime: Date.now()
    })
    assert.equal(valid, true)
  })

  it('rejects tick missing seq', () => {
    const { valid } = validate('server', { type: 'tick', serverTime: Date.now() })
    assert.equal(valid, false)
  })
})

// ─── error ────────────────────────────────────────────────────────

describe('error', () => {
  it('validates an error with seq', () => {
    const { valid } = validate('server', {
      type: 'error', code: 'PERMISSION_DENIED',
      seq: 42, message: 'Not allowed'
    })
    assert.equal(valid, true)
  })

  it('validates an error without seq', () => {
    const { valid } = validate('server', {
      type: 'error', code: 'WORLD_FULL', message: 'World is full'
    })
    assert.equal(valid, true)
  })

  it('rejects error with unknown code', () => {
    const { valid } = validate('server', {
      type: 'error', code: 'MADE_UP_CODE', message: 'oops'
    })
    assert.equal(valid, false)
  })
})

// ─── send ─────────────────────────────────────────────────────────

describe('send', () => {
  it('validates a send message', () => {
    const { valid } = validate('client', {
      type: 'send', seq: 1,
      node: 'crate-01', field: 'translation', value: [1, 0, 0]
    })
    assert.equal(valid, true)
  })

  it('rejects send missing seq', () => {
    const { valid } = validate('client', {
      type: 'send', node: 'crate-01', field: 'translation', value: [1, 0, 0]
    })
    assert.equal(valid, false)
  })

  it('rejects send missing field', () => {
    const { valid } = validate('client', {
      type: 'send', seq: 1, node: 'crate-01', value: [1, 0, 0]
    })
    assert.equal(valid, false)
  })
})

// ─── set ──────────────────────────────────────────────────────────

describe('set', () => {
  it('validates a set message', () => {
    const { valid } = validate('server', {
      type: 'set', seq: 10,
      node: 'crate-01', field: 'translation',
      value: [1, 0, 0], serverTime: Date.now()
    })
    assert.equal(valid, true)
  })

  it('rejects set missing serverTime', () => {
    const { valid } = validate('server', {
      type: 'set', seq: 10,
      node: 'crate-01', field: 'translation', value: [1, 0, 0]
    })
    assert.equal(valid, false)
  })
})

// ─── add ──────────────────────────────────────────────────────────

describe('add', () => {
  it('validates a minimal add', () => {
    const { valid } = validate('client', {
      type: 'add', seq: 1,
      node: { name: 'crate-01' }
    })
    assert.equal(valid, true)
  })

  it('validates a full add with translation and extensions', () => {
    const { valid } = validate('client', {
      type: 'add', seq: 1,
      format: 'gltf',
      parent: 'scene-root',
      node: {
        name: 'record-player-01',
        translation: [2.0, 0.0, -1.5],
        rotation: [0, 0, 0, 1],
        extensions: { ATRIUM_world: { type: 'RecordPlayer' } }
      }
    })
    assert.equal(valid, true)
  })

  it('validates add with parent set to null', () => {
    const { valid } = validate('client', {
      type: 'add', seq: 1,
      parent: null,
      node: { name: 'box-01' }
    })
    assert.equal(valid, true)
  })

  it('rejects add missing node', () => {
    const { valid } = validate('client', { type: 'add', seq: 1 })
    assert.equal(valid, false)
  })

  it('rejects add with invalid translation', () => {
    const { valid } = validate('client', {
      type: 'add', seq: 1,
      node: { name: 'crate-01', translation: [1, 2] }
    })
    assert.equal(valid, false)
  })
})

// ─── remove ───────────────────────────────────────────────────────

describe('remove', () => {
  it('validates a remove', () => {
    const { valid } = validate('client', {
      type: 'remove', seq: 1, node: 'crate-01'
    })
    assert.equal(valid, true)
  })

  it('rejects remove missing node', () => {
    const { valid } = validate('client', { type: 'remove', seq: 1 })
    assert.equal(valid, false)
  })
})

// ─── join ─────────────────────────────────────────────────────────

describe('join', () => {
  it('validates a minimal join', () => {
    const { valid } = validate('server', {
      type: 'join', seq: 1, id: 'client-01'
    })
    assert.equal(valid, true)
  })

  it('validates a full join with avatar', () => {
    const { valid } = validate('server', {
      type: 'join', seq: 1, id: 'client-01',
      avatar: {
        displayName: 'Tony',
        avatarURL: 'https://example.com/avatar.glb',
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1]
      }
    })
    assert.equal(valid, true)
  })

  it('rejects join missing id', () => {
    const { valid } = validate('server', { type: 'join', seq: 1 })
    assert.equal(valid, false)
  })
})

// ─── leave ────────────────────────────────────────────────────────

describe('leave', () => {
  it('validates a leave', () => {
    const { valid } = validate('server', {
      type: 'leave', seq: 1, id: 'client-01'
    })
    assert.equal(valid, true)
  })

  it('rejects leave missing id', () => {
    const { valid } = validate('server', { type: 'leave', seq: 1 })
    assert.equal(valid, false)
  })
})

// ─── view ─────────────────────────────────────────────────────────

describe('view (client)', () => {
  it('validates a minimal client view — seq and position', () => {
    const { valid } = validate('client', { type: 'view', seq: 1, position: [1, 0, 0] })
    assert.equal(valid, true)
  })

  it('validates a client view with all optional fields', () => {
    const { valid } = validate('client', {
      type: 'view',
      seq: 2,
      position: [1, 0, 0],
      look: [0, 0, -1],
      move: [1, 0, 0],
      velocity: 4.0
    })
    assert.equal(valid, true)
  })

  it('rejects client view missing position', () => {
    const { valid } = validate('client', { type: 'view', seq: 1 })
    assert.equal(valid, false)
  })

  it('rejects client view with position wrong length', () => {
    const { valid } = validate('client', { type: 'view', seq: 1, position: [1, 0] })
    assert.equal(valid, false)
  })

  it('validates client view with seq passes validation', () => {
    const { valid } = validate('client', { type: 'view', seq: 42, position: [0, 1.6, 4] })
    assert.equal(valid, true)
  })

  it('rejects client view without seq', () => {
    const { valid } = validate('client', { type: 'view', position: [1, 0, 0] })
    assert.equal(valid, false)
  })
})

describe('view (server)', () => {
  it('validates a server view', () => {
    const { valid } = validate('server', { type: 'view', id: 'abc', position: [1, 0, 0] })
    assert.equal(valid, true)
  })

  it('rejects server view missing id', () => {
    const { valid } = validate('server', { type: 'view', position: [1, 0, 0] })
    assert.equal(valid, false)
  })

  it('rejects server view missing position', () => {
    const { valid } = validate('server', { type: 'view', id: 'abc' })
    assert.equal(valid, false)
  })
})

// ─── unknown message ──────────────────────────────────────────────

describe('unknown message type', () => {
  it('rejects an unknown message type', () => {
    const { valid } = validate('client', { type: 'explode', seq: 1 })
    assert.equal(valid, false)
  })

  it('rejects a message with no type', () => {
    const { valid } = validate('client', { seq: 1 })
    assert.equal(valid, false)
  })
})