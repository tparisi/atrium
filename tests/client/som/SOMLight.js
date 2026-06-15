// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { SOMObject } from './SOMObject.js'
import { SOMEvent }  from './SOMEvent.js'

export class SOMLight extends SOMObject {
  constructor(light) {
    super()
    this._light = light
    this._qualifiedName = null   // set by SOMDocument._buildObjectGraph
  }

  // --- Intrinsic (read-only) ---

  get name()          { return this._light.getName() ?? null }
  get qualifiedName() { return this._qualifiedName }

  // --- Mutable properties — each setter fires mutation event ---

  // color: plain [r,g,b] array (Linear-sRGB). getColor() returns a plain JS array.
  get color()          { return this._light.getColor() }
  set color(v)         {
    this._light.setColor(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'color', value: v }))
    }
  }

  get intensity()      { return this._light.getIntensity() }
  set intensity(v)     {
    this._light.setIntensity(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'intensity', value: v }))
    }
  }

  get type()           { return this._light.getType() }
  set type(v)          {
    this._light.setType(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'type', value: v }))
    }
  }

  // range: number | null. null means infinite range (glTF-Transform default is null).
  get range()          { return this._light.getRange() }
  set range(v)         {
    this._light.setRange(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'range', value: v }))
    }
  }

  get innerConeAngle() { return this._light.getInnerConeAngle() }
  set innerConeAngle(v){
    this._light.setInnerConeAngle(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'innerConeAngle', value: v }))
    }
  }

  get outerConeAngle() { return this._light.getOuterConeAngle() }
  set outerConeAngle(v){
    this._light.setOuterConeAngle(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'outerConeAngle', value: v }))
    }
  }

  get extras()         { return this._light.getExtras() }
  set extras(v)        {
    this._light.setExtras(v)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value: v }))
    }
  }
}
