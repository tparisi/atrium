// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import Ajv from 'ajv'

import helloClient from './schemas/hello.client.json' with { type: 'json' }
import helloServer from './schemas/hello.server.json' with { type: 'json' }
import ping from './schemas/ping.json' with { type: 'json' }
import pong from './schemas/pong.json' with { type: 'json' }
import tick from './schemas/tick.json' with { type: 'json' }
import errorMsg from './schemas/error.json' with { type: 'json' }
import send from './schemas/send.json' with { type: 'json' }
import set from './schemas/set.json' with { type: 'json' }
import add from './schemas/add.json' with { type: 'json' }
import remove from './schemas/remove.json' with { type: 'json' }
import join from './schemas/join.json' with { type: 'json' }
import leave from './schemas/leave.json' with { type: 'json' }

const ajv = new Ajv({ strict: false })

const validators = {
  'hello:client': ajv.compile(helloClient),
  'hello:server': ajv.compile(helloServer),
  'ping':         ajv.compile(ping),
  'pong':         ajv.compile(pong),
  'tick':         ajv.compile(tick),
  'error':        ajv.compile(errorMsg),
  'send':         ajv.compile(send),
  'set':          ajv.compile(set),
  'add':          ajv.compile(add),
  'remove':       ajv.compile(remove),
  'join':         ajv.compile(join),
  'leave':        ajv.compile(leave),
}

/**
 * Validate a SOP message.
 * @param {'client'|'server'} direction - who sent the message
 * @param {object} message - the parsed message object
 * @returns {{ valid: boolean, errors: array }}
 */
export function validate(direction, message) {
  if (!message || typeof message.type !== 'string') {
    return { valid: false, errors: [{ message: 'Message must have a type field' }] }
  }

  const key = message.type === 'hello'
    ? `hello:${direction}`
    : message.type

  const validator = validators[key]

  if (!validator) {
    return { valid: false, errors: [{ message: `Unknown message type: ${message.type}` }] }
  }

  const valid = validator(message)
  return { valid, errors: validator.errors ?? [] }
}

export const messageTypes = [
  'hello', 'ping', 'pong', 'tick', 'error',
  'send', 'set', 'add', 'remove', 'join', 'leave'
]

export { validators }