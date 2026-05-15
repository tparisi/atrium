// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { DocumentView } from '@gltf-transform/view'

/**
 * Wire a SOMDocument into a Three.js scene via DocumentView.
 *
 * Disposes the previous docView/sceneGroup pair if provided, then creates
 * a fresh DocumentView and adds the new sceneGroup to threeScene. Returns
 * the new pair so the caller can store them and pass them back on next call.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} threeScene
 * @param {SOMDocument} somDocument
 * @param {{ prevDocView?: object, prevSceneGroup?: THREE.Object3D }} [opts]
 * @returns {{ docView: DocumentView, sceneGroup: THREE.Object3D }}
 */
export function initDocumentView(renderer, threeScene, somDocument, { prevDocView = null, prevSceneGroup = null } = {}) {
  if (prevDocView) { prevDocView.dispose(); threeScene.remove(prevSceneGroup) }
  const docView    = new DocumentView(renderer)
  const sceneDef   = somDocument.document.getRoot().listScenes()[0]
  const sceneGroup = docView.view(sceneDef)
  threeScene.add(sceneGroup)
  return { docView, sceneGroup }
}
