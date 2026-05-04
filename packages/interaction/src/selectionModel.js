// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * nearestNonMeshAncestor — walk up from leaf to the nearest ancestor that
 * carries no mesh. Returns that ancestor, or leaf if none is found before
 * the scene boundary (parent === null).
 *
 * A node that has its own mesh is not treated as a selection group even if it
 * has mesh children. The modeler's convention (Blender-style "Empty parent")
 * is that group roots are transform-only nodes with no geometry of their own.
 */
export function nearestNonMeshAncestor(leaf) {
  let current = leaf
  while (current.parent !== null) {
    if (current.parent.mesh === null) return current.parent
    current = current.parent
  }
  return leaf
}

/**
 * leafOnly — return the hit leaf unchanged. Use as `policy` when you want
 * direct, unmodified selection (e.g. tree-view clicks).
 */
export function leafOnly(leaf) {
  return leaf
}

/**
 * resolveSelectionRoot — apply a selection policy with an optional
 * modifier-key descent escape.
 *
 * @param {SOMNode} leaf - The directly hit node.
 * @param {object}  [opts]
 * @param {Function} [opts.policy=nearestNonMeshAncestor] - Policy function.
 * @param {boolean}  [opts.descend=false] - If true, return leaf directly
 *   (Alt-click escape to select individual parts of a compound object).
 * @returns {SOMNode}
 */
export function resolveSelectionRoot(leaf, {
  policy = nearestNonMeshAncestor,
  descend = false,
} = {}) {
  if (descend) return leaf
  return policy(leaf)
}
