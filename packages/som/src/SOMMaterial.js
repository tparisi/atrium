// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMEvent }  from './SOMEvent.js'
import { SOMTexture } from './SOMTexture.js'

export class SOMMaterial extends SOMObject {
  constructor(material) {
    super()
    this._material = material
  }

  get name()   { return this._material.getName() }
  set name(v)  {
    this._material.setName(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'name', value: v }))
    }
  }
  get extras() { return this._material.getExtras() }
  set extras(v){
    this._material.setExtras(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value: v }))
    }
  }

  // PBR — Metallic Roughness
  get baseColorFactor()  { return this._material.getBaseColorFactor() }
  set baseColorFactor(v) {
    this._material.setBaseColorFactor(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'baseColorFactor', value: v }))
    }
  }

  get metallicFactor()   { return this._material.getMetallicFactor() }
  set metallicFactor(v)  {
    this._material.setMetallicFactor(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'metallicFactor', value: v }))
    }
  }

  get roughnessFactor()  { return this._material.getRoughnessFactor() }
  set roughnessFactor(v) {
    this._material.setRoughnessFactor(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'roughnessFactor', value: v }))
    }
  }

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
  set emissiveFactor(v) {
    this._material.setEmissiveFactor(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'emissiveFactor', value: v }))
    }
  }
  get emissiveTexture() {
    const t = this._material.getEmissiveTexture()
    return t ? new SOMTexture(t) : null
  }

  // Rendering
  get alphaMode()   { return this._material.getAlphaMode() }
  set alphaMode(v)  {
    this._material.setAlphaMode(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'alphaMode', value: v }))
    }
  }
  get alphaCutoff() { return this._material.getAlphaCutoff() }
  set alphaCutoff(v){
    this._material.setAlphaCutoff(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'alphaCutoff', value: v }))
    }
  }
  get doubleSided() { return this._material.getDoubleSided() }
  set doubleSided(v){
    this._material.setDoubleSided(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'doubleSided', value: v }))
    }
  }
}
