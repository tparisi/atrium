// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { NodeIO } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'

export async function createWorld(gltfPath) {
  const io = new NodeIO()
  const document = await io.read(gltfPath)
  const som = new SOMDocument(document)

  const rootExtras = document.getRoot().getExtras()
  const meta = rootExtras?.atrium?.world ?? {}

  function getNode(name) {
    return som.getNodeByName(name)
  }

  function setField(nodeName, field, value) {
    const node = som.getNodeByName(nodeName)
    if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }
    try {
      som.setPath(node, field, value)
    } catch {
      return { ok: false, code: 'INVALID_FIELD' }
    }
    return { ok: true }
  }

  function addNode(nodeDescriptor, parentName) {
    const node = som.createNode(nodeDescriptor)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      if (!parent) return { ok: false, code: 'NODE_NOT_FOUND' }
      parent.addChild(node)
    } else {
      som.scene.addChild(node)
    }
    return { ok: true, node }
  }

  function removeNode(nodeName) {
    const node = som.getNodeByName(nodeName)
    if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }
    node.dispose()
    return { ok: true }
  }

  function getNodeTranslation(name) {
    const node = som.getNodeByName(name)
    if (!node) return null
    return [...node.translation]
  }

  function listNodeNames() {
    return som.nodes.map(n => n.name)
  }

  return { meta, som, getNode, setField, addNode, removeNode, getNodeTranslation, listNodeNames }
}
