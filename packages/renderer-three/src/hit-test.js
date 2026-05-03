// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * hit-test.js — pure hit-testing helpers.
 *
 * Functions here take plain-object inputs (requiring only `.name` and
 * `.parent` duck-typing) so they can be unit-tested without a Three.js
 * scene. The PointerInputBridge consumes these internally.
 *
 * Not exported from the package's public index — consumers should not
 * need to reach inside the hit-test layer directly.
 */

/**
 * Walk up a Three.js Object3D hierarchy from `obj`, calling `lookupByName`
 * on each node's `.name` until a SOM node is found.
 *
 * Returns `{ threeObj, somNode }` where `threeObj` is the first ancestor
 * whose name resolved to a SOM node, or `null` if nothing matched.
 *
 * @param {{ name: string, parent: object | null }} obj  Starting leaf Object3D
 * @param {(name: string) => any} lookupByName            SOM node lookup
 * @returns {{ threeObj: object, somNode: any } | null}
 */
export function walkUpToSOMNode(obj, lookupByName) {
  let current = obj
  while (current) {
    if (current.name) {
      const node = lookupByName(current.name)
      if (node) return { threeObj: current, somNode: node }
    }
    current = current.parent
  }
  return null
}
