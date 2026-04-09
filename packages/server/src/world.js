// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'

/**
 * Fetch a file by URL. Uses fs.readFile for file:// URLs, globalThis.fetch for
 * http(s)://. Returns the raw text content.
 */
async function fetchText(url) {
  if (url.startsWith('file://')) {
    const path = new URL(url).pathname
    return readFile(path, 'utf8')
  }
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching "${url}"`)
  return resp.text()
}

async function fetchBinary(url) {
  if (url.startsWith('file://')) {
    const path = new URL(url).pathname
    const buf = await readFile(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching "${url}"`)
  return resp.arrayBuffer()
}

export async function createWorld(gltfPath) {
  const io = new NodeIO()
  const document = await io.read(gltfPath)
  const som = new SOMDocument(document)

  // Derive base URL for resolving relative extras.atrium.source paths
  const absPath    = resolvePath(gltfPath)
  const worldBaseUrl = pathToFileURL(absPath).href

  const rootExtras = document.getRoot().getExtras()
  const meta = rootExtras?.atrium?.world ?? {}

  // Names of nodes created by ingestExternalScene — filtered from som-dump
  const externalNodeNames = new Set()

  // Resolve external references synchronously before the server opens connections.
  // Called by index.js via world.resolveExternalReferences() after createWorld().
  async function resolveExternalReferences() {
    const tasks = som.nodes
      .filter(n => n.extras?.atrium?.source)
      .map(n => _loadExternalRef(n.name, n.extras.atrium.source))
    await Promise.all(tasks)
  }

  async function _loadExternalRef(containerName, source) {
    const resolvedUrl = new URL(source, worldBaseUrl).href
    try {
      let doc
      if (resolvedUrl.endsWith('.glb')) {
        const buffer = await fetchBinary(resolvedUrl)
        doc = await io.readBinary(new Uint8Array(buffer))
      } else {
        const text = await fetchText(resolvedUrl)
        doc = await io.readJSON({ json: JSON.parse(text), resources: {} })
      }
      const newNodes = som.ingestExternalScene(containerName, doc)
      // Recursively register all ingested node names so serialize() can filter them
      _registerExternal(newNodes)
      console.log(`[world] External ref loaded: "${containerName}" ← ${resolvedUrl} (${newNodes.length} top-level node(s))`)
    } catch (err) {
      console.warn(`[world] Failed to load external ref "${resolvedUrl}" for container "${containerName}":`, err.message)
    }
  }

  function _registerExternal(somNodes) {
    for (const node of somNodes) {
      externalNodeNames.add(node.name)
      _registerExternal(node.children)
    }
  }

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
    const node = som.ingestNode(nodeDescriptor)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      if (!parent) return { ok: false, code: 'NODE_NOT_FOUND' }
      parent.addChild(node)
    } else {
      som.scene.addChild(node)
    }
    return { ok: true, node }
  }

  async function serialize() {
    const { json, resources } = await io.writeJSON(som._document)
    for (const buf of json.buffers ?? []) {
      if (buf.uri && !buf.uri.startsWith('data:')) {
        const data = resources[buf.uri]
        if (data) {
          buf.uri = 'data:application/octet-stream;base64,' + Buffer.from(data).toString('base64')
        }
      }
    }

    // Filter externally-ingested nodes from the dump so every client always
    // resolves external references locally from scratch.
    if (externalNodeNames.size > 0 && json.nodes) {
      // Build index: glTF node index → node name
      const nameByIndex = new Map(json.nodes.map((n, i) => [i, n.name]))

      // Collect set of indices to remove
      const removeIndices = new Set(
        json.nodes
          .map((n, i) => (externalNodeNames.has(n.name) ? i : -1))
          .filter(i => i >= 0)
      )

      if (removeIndices.size > 0) {
        // Build a remapped index array (old index → new index, or -1 if removed)
        const remap = []
        let next = 0
        for (let i = 0; i < json.nodes.length; i++) {
          remap[i] = removeIndices.has(i) ? -1 : next++
        }

        // Remove the nodes
        json.nodes = json.nodes.filter((_, i) => !removeIndices.has(i))

        // Update children arrays to remove references to deleted nodes and remap
        for (const node of json.nodes) {
          if (node.children) {
            node.children = node.children
              .map(c => remap[c])
              .filter(c => c >= 0)
            if (node.children.length === 0) delete node.children
          }
        }

        // Update scene node lists
        for (const scene of json.scenes ?? []) {
          if (scene.nodes) {
            scene.nodes = scene.nodes
              .map(c => remap[c])
              .filter(c => c >= 0)
          }
        }
      }
    }

    return json
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

  return { meta, som, externalNodeNames, getNode, setField, addNode, removeNode, getNodeTranslation, listNodeNames, serialize, resolveExternalReferences }
}
