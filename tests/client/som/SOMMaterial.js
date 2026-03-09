// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMTexture } from './SOMTexture.js'

export class SOMMaterial {
  constructor(material) {
    this._material = material
  }

  get name()   { return this._material.getName() }
  set name(v)  { this._material.setName(v) }
  get extras() { return this._material.getExtras() }
  set extras(v){ this._material.setExtras(v) }

  // PBR — Metallic Roughness
  get baseColorFactor()  { return this._material.getBaseColorFactor() }
  set baseColorFactor(v) { this._material.setBaseColorFactor(v) }

  get metallicFactor()   { return this._material.getMetallicFactor() }
  set metallicFactor(v)  { this._material.setMetallicFactor(v) }

  get roughnessFactor()  { return this._material.getRoughnessFactor() }
  set roughnessFactor(v) { this._material.setRoughnessFactor(v) }

  get baseColorTexture() {
    const t = this._material.getBaseColorTexture()
    return t ? new SOMTexture(t) : null
  }
  get metallicRoughnessTexture() {
    const t = this._material.getMetallicRoughnessTexture()
    return t ? new SOMTexture(t) : null
  }

  // Surface
  get normalTexture() {
    const t = this._material.getNormalTexture()
    return t ? new SOMTexture(t) : null
  }
  get occlusionTexture() {
    const t = this._material.getOcclusionTexture()
    return t ? new SOMTexture(t) : null
  }
  get emissiveFactor()  { return this._material.getEmissiveFactor() }
  set emissiveFactor(v) { this._material.setEmissiveFactor(v) }
  get emissiveTexture() {
    const t = this._material.getEmissiveTexture()
    return t ? new SOMTexture(t) : null
  }

  // Rendering
  get alphaMode()   { return this._material.getAlphaMode() }
  set alphaMode(v)  { this._material.setAlphaMode(v) }
  get alphaCutoff() { return this._material.getAlphaCutoff() }
  set alphaCutoff(v){ this._material.setAlphaCutoff(v) }
  get doubleSided() { return this._material.getDoubleSided() }
  set doubleSided(v){ this._material.setDoubleSided(v) }
}
