// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

/**
 * Convert a THREE.BufferGeometry into a glTF primitive descriptor
 * (plain JS object, wire-format shape — POSITION/NORMAL attributes +
 * indices + material). Disposes the input geometry after extracting
 * its attribute data, since only the extracted arrays are retained.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} material - glTF material descriptor
 * @returns {object} glTF primitive descriptor:
 *   { attributes: { POSITION, NORMAL }, indices, material }
 */
export function threeGeometryToGltfPrimitive(geometry, material) {
  const positions = Array.from(geometry.attributes.position.array)
  const normals   = Array.from(geometry.attributes.normal.array)
  const indices   = Array.from(geometry.index.array)
  geometry.dispose()

  return {
    attributes: { POSITION: positions, NORMAL: normals },
    indices,
    material,
  }
}

/**
 * Build a glTF node descriptor for a procedurally-generated capsule
 * avatar, suitable for passing to AtriumClient.connect(). Random pastel
 * color per call.
 *
 * @param {string} name - display name for the avatar
 * @returns {object} glTF node descriptor
 */
export function buildAvatarDescriptor(name) {
  const geo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)

  const color = [
    Math.random() * 0.5 + 0.5,
    Math.random() * 0.5 + 0.5,
    Math.random() * 0.5 + 0.5,
    1,
  ]

  const primitive = threeGeometryToGltfPrimitive(geo, {
    pbrMetallicRoughness: {
      baseColorFactor: color,
      metallicFactor:  0.0,
      roughnessFactor: 0.7,
    },
  })

  return {
    // name intentionally omitted — left disabled in the original app.js;
    // carried over as-is (see SESSION-43b backlog note)
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: { primitives: [primitive] },
  }
}
