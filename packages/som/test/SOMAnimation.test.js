// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

function makeAnimDoc() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const node = doc.createNode('Cube').setTranslation([0,0,0])
  scene.addChild(node)

  const buf = doc.createBuffer()
  const timeAcc = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 0.5, 1.0])).setBuffer(buf)
  const valAcc = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 0,1,0, 0,0,0])).setBuffer(buf)
  const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(valAcc).setInterpolation('LINEAR')
  const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler)
  doc.createAnimation('Walk').addSampler(sampler).addChannel(channel)

  return new SOMDocument(doc)
}

// ---------------------------------------------------------------------------
// Global namespace
// ---------------------------------------------------------------------------

test('getObjectByName returns SOMDocument for __document__', () => {
  const som = makeAnimDoc()
  assert.strictEqual(som.getObjectByName('__document__'), som)
})

test('getObjectByName returns SOMNode by name', () => {
  const som = makeAnimDoc()
  assert.strictEqual(som.getObjectByName('Cube')?.name, 'Cube')
})

test('getObjectByName returns SOMAnimation by name', () => {
  const som = makeAnimDoc()
  assert.strictEqual(som.getObjectByName('Walk')?.name, 'Walk')
})

test('getObjectByName returns null for unknown name', () => {
  const som = makeAnimDoc()
  assert.strictEqual(som.getObjectByName('NoSuchThing'), null)
})

test('getAnimationByName returns SOMAnimation', () => {
  const som = makeAnimDoc()
  assert.strictEqual(som.getAnimationByName('Walk')?.name, 'Walk')
})

test('getAnimationByName returns null for unknown name', () => {
  const som = makeAnimDoc()
  assert.strictEqual(som.getAnimationByName('NoSuchAnim'), null)
})

test('node and animation with same name: node wins in _objectsByName', () => {
  const doc = new Document()
  doc.createNode('Shared')
  doc.createAnimation('Shared')
  const som = new SOMDocument(doc)
  // Node registered first (nodes before animations in _buildObjectGraph)
  const obj = som.getObjectByName('Shared')
  assert.ok(obj !== null)
  assert.strictEqual(obj.constructor.name, 'SOMNode')
  // Animation still accessible via typed lookup
  assert.strictEqual(som.getAnimationByName('Shared')?.name, 'Shared')
})

// ---------------------------------------------------------------------------
// SOMAnimation intrinsic properties
// ---------------------------------------------------------------------------

test('SOMAnimation: name and duration', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  assert.strictEqual(anim.name, 'Walk')
  assert.ok(anim.duration > 0)
  assert.strictEqual(anim.duration, 1.0)
})

test('SOMAnimation: channels descriptor', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  assert.strictEqual(anim.channels.length, 1)
  assert.strictEqual(anim.channels[0].targetNode, 'Cube')
  assert.strictEqual(anim.channels[0].targetProperty, 'translation')
  assert.strictEqual(anim.channels[0].samplerIndex, 0)
})

test('SOMAnimation: samplers descriptor', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  assert.strictEqual(anim.samplers.length, 1)
  assert.strictEqual(anim.samplers[0].interpolation, 'LINEAR')
  assert.strictEqual(anim.samplers[0].inputCount, 3)
  assert.strictEqual(anim.samplers[0].outputCount, 3)
})

// ---------------------------------------------------------------------------
// Playback state machine
// ---------------------------------------------------------------------------

test('SOMAnimation: default playback state', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  assert.strictEqual(anim.playing, false)
  assert.strictEqual(anim.paused, false)
  assert.strictEqual(anim.loop, false)
  assert.strictEqual(anim.autoStart, false)
  assert.strictEqual(anim.timeScale, 1.0)
  assert.strictEqual(anim.currentTime, 0)
})

test('SOMAnimation: play() sets playing state', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play({ loop: true, timeScale: 2.0 })
  assert.strictEqual(anim.playing, true)
  assert.strictEqual(anim.paused, false)
  assert.strictEqual(anim.loop, true)
  assert.strictEqual(anim.timeScale, 2.0)
  assert.ok(anim.startWallClock !== null)
})

test('SOMAnimation: play() fires one mutation event', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  const events = []
  anim.addEventListener('mutation', e => events.push(e.detail))
  anim.play()
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].property, 'playback')
  assert.strictEqual(events[0].value.playing, true)
})

test('SOMAnimation: pause() sets paused state and captures pauseTime', async () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play()
  await new Promise(r => setTimeout(r, 20))
  anim.pause()
  assert.strictEqual(anim.playing, false)
  assert.strictEqual(anim.paused, true)
  assert.ok(anim.pauseTime > 0)
})

test('SOMAnimation: pause() is no-op when not playing', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  const events = []
  anim.addEventListener('mutation', e => events.push(e))
  anim.pause()   // no-op
  assert.strictEqual(events.length, 0)
  assert.strictEqual(anim.paused, false)
})

test('SOMAnimation: stop() resets all state', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play({ loop: true, timeScale: 2.0 })
  anim.stop()
  assert.strictEqual(anim.playing, false)
  assert.strictEqual(anim.paused, false)
  assert.strictEqual(anim.loop, false)
  assert.strictEqual(anim.timeScale, 1.0)
  assert.strictEqual(anim.startWallClock, null)
  assert.strictEqual(anim.currentTime, 0)
})

test('SOMAnimation: currentTime advances while playing', async () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play()
  await new Promise(r => setTimeout(r, 50))
  assert.ok(anim.currentTime > 0)
})

test('SOMAnimation: currentTime returns pauseTime when paused', async () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play()
  await new Promise(r => setTimeout(r, 30))
  anim.pause()
  const frozen = anim.currentTime
  await new Promise(r => setTimeout(r, 30))
  assert.strictEqual(anim.currentTime, frozen)
})

test('SOMAnimation: loop wraps currentTime', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  // Manually set playback so startWallClock is far enough in the past to exceed duration
  anim.playback = {
    playing: true,
    paused: false,
    loop: true,
    timeScale: 1.0,
    startTime: 0,
    startWallClock: Date.now() - 5000,  // 5 seconds elapsed, duration=1.0
    pauseTime: null,
  }
  const t = anim.currentTime
  assert.ok(t >= 0 && t < anim.duration, `currentTime ${t} should be in [0, ${anim.duration})`)
})

test('SOMAnimation: non-loop clamps at duration', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.playback = {
    playing: true,
    paused: false,
    loop: false,
    timeScale: 1.0,
    startTime: 0,
    startWallClock: Date.now() - 5000,
    pauseTime: null,
  }
  assert.strictEqual(anim.currentTime, anim.duration)
})

// ---------------------------------------------------------------------------
// tick() and timeupdate
// ---------------------------------------------------------------------------

test('SOMAnimation: tick() fires timeupdate when playing and listeners present', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  const events = []
  anim.addEventListener('timeupdate', e => events.push(e.detail))
  anim.play()
  anim.tick()
  assert.strictEqual(events.length, 1)
  assert.ok(typeof events[0].currentTime === 'number')
})

test('SOMAnimation: tick() skips timeupdate when not playing', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  const events = []
  anim.addEventListener('timeupdate', e => events.push(e.detail))
  anim.tick()   // not playing
  assert.strictEqual(events.length, 0)
})

test('SOMAnimation: tick() skips timeupdate when no listeners', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play()
  assert.doesNotThrow(() => anim.tick())  // no listeners, should not throw
})

// ---------------------------------------------------------------------------
// setPath integration
// ---------------------------------------------------------------------------

test('setPath works on SOMAnimation for playback field', () => {
  const som = makeAnimDoc()
  const target = som.getObjectByName('Walk')
  som.setPath(target, 'playback', {
    playing: false, paused: true, loop: false, timeScale: 1,
    startTime: 0, startWallClock: null, pauseTime: 0.75,
  })
  assert.strictEqual(target.paused, true)
  assert.strictEqual(target.pauseTime, 0.75)
})

test('setPath works on SOMDocument for extras field', () => {
  const som = makeAnimDoc()
  const target = som.getObjectByName('__document__')
  som.setPath(target, 'extras', { atrium: { world: { name: 'Test' } } })
  assert.strictEqual(som.extras?.atrium?.world?.name, 'Test')
})

// ---------------------------------------------------------------------------
// Persistence: playback → extras.atrium.playback
// ---------------------------------------------------------------------------

test('playback state persists to extras.atrium.playback on animation', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.play({ loop: true })
  const raw = anim._animation.getExtras()
  assert.strictEqual(raw?.atrium?.playback?.playing, true)
  assert.strictEqual(raw?.atrium?.playback?.loop, true)
})

// ---------------------------------------------------------------------------
// autoStart
// ---------------------------------------------------------------------------

test('autoStart: default value is false', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  assert.strictEqual(anim.autoStart, false)
  assert.strictEqual(anim.playback.autoStart, false)
})

test('autoStart: can be set via playback setter and round-trips', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.playback = { ...anim.playback, autoStart: true }
  assert.strictEqual(anim.autoStart, true)
  // Persisted to extras
  const raw = anim._animation.getExtras()
  assert.strictEqual(raw?.atrium?.playback?.autoStart, true)
})

test('autoStart: play() preserves authored autoStart value', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.playback = { ...anim.playback, autoStart: true }
  anim.play({ loop: true })
  assert.strictEqual(anim.autoStart, true)
  assert.strictEqual(anim.playing, true)
})

test('autoStart: pause() preserves autoStart value', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.playback = { ...anim.playback, autoStart: true }
  anim.play()
  anim.pause()
  assert.strictEqual(anim.autoStart, true)
})

test('autoStart: stop() preserves autoStart value', () => {
  const som = makeAnimDoc()
  const anim = som.getAnimationByName('Walk')
  anim.playback = { ...anim.playback, autoStart: true }
  anim.play()
  anim.stop()
  assert.strictEqual(anim.playing, false)
  assert.strictEqual(anim.autoStart, true)
})

test('autoStart: persists to extras.atrium.playback and reloads via fresh SOMDocument', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const node = doc.createNode('Cube').setTranslation([0,0,0])
  scene.addChild(node)
  const buf = doc.createBuffer()
  const timeAcc = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf)
  const valAcc = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 0,1,0])).setBuffer(buf)
  const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(valAcc).setInterpolation('LINEAR')
  const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler)
  doc.createAnimation('Walk').addSampler(sampler).addChannel(channel)

  const som = new SOMDocument(doc)
  const anim = som.getAnimationByName('Walk')
  anim.playback = { ...anim.playback, autoStart: true, loop: true }
  // Verify raw extras written
  const raw = anim._animation.getExtras()
  assert.strictEqual(raw?.atrium?.playback?.autoStart, true)
  // Fresh SOMDocument over same gltf-transform Document reads it back
  const som2 = new SOMDocument(doc)
  const anim2 = som2.getAnimationByName('Walk')
  assert.strictEqual(anim2.autoStart, true)
  assert.strictEqual(anim2.loop, true)
})
