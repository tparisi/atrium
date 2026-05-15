// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

/**
 * Build THREE.AnimationClip objects from a SOMDocument's glTF-Transform data.
 *
 * @gltf-transform/view@4.3.0 does not create AnimationClip objects — clips
 * are built here directly from the glTF-Transform document. Track paths use
 * the glTF node name, which matches the Three.js Object3D name set by DocumentView.
 *
 * Note: 'weights' (morph-target) tracks are not handled — known gap, deferred.
 *
 * @param {SOMDocument} somDocument
 * @returns {THREE.AnimationClip[]}
 */
export function buildClipsFromSOM(somDocument) {
  const clips = []
  for (const gltfAnim of somDocument.document.getRoot().listAnimations()) {
    const tracks = []
    for (const channel of gltfAnim.listChannels()) {
      const sampler    = channel.getSampler()
      const targetNode = channel.getTargetNode()
      const targetPath = channel.getTargetPath()
      if (!sampler || !targetNode) continue
      const times  = sampler.getInput()?.getArray()
      const values = sampler.getOutput()?.getArray()
      if (!times || !values) continue
      const nodeName = targetNode.getName()
      let track
      if (targetPath === 'rotation') {
        track = new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, values)
      } else if (targetPath === 'translation') {
        track = new THREE.VectorKeyframeTrack(`${nodeName}.position`, times, values)
      } else if (targetPath === 'scale') {
        track = new THREE.VectorKeyframeTrack(`${nodeName}.scale`, times, values)
      }
      if (track) tracks.push(track)
    }
    if (tracks.length > 0) {
      clips.push(new THREE.AnimationClip(gltfAnim.getName(), -1, tracks))
    }
  }
  return clips
}
