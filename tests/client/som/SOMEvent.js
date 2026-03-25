// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export class SOMEvent {
  constructor(type, detail = {}) {
    this.type   = type
    this.target = detail.target ?? null
    this.detail = detail
  }
}
