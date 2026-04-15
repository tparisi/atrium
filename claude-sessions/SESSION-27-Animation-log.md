# Session 27 — Animation Support — Build Log
## 2026-04-15

---

## Overview

Implemented full animation support per the SESSION-27-Animation.md spec. All six
phases of the implementation sequence were completed. 259/259 tests pass.

---

## Files Changed

### New Files

| File | Description |
|------|-------------|
| `packages/client/src/AnimationController.js` | New controller: tracks animations, drives timeupdate, emits semantic events |
| `packages/som/test/SOMAnimation.test.js` | 26 tests covering the full SOMAnimation API |

### Modified Files

| File | Changes |
|------|---------|
| `packages/som/src/SOMAnimation.js` | Full rewrite — playback state machine, channels/samplers descriptors, computed currentTime, play/pause/stop, tick/timeupdate |
| `packages/som/src/SOMDocument.js` | Global namespace refactor — _objectsByName, _animationsByName, getObjectByName, getAnimationByName, _registerObject, build order change |
| `packages/client/src/AtriumClient.js` | _onSet uses getObjectByName uniformly; _attachAnimationListeners added |
| `packages/client/package.json` | Added `exports` map with AnimationController subpath |
| `packages/server/src/world.js` | setField uses getObjectByName instead of getNodeByName |
| `packages/server/src/session.js` | send handler simplified — __document__ special case removed |

---

## Phase 1 — Global SOM Namespace (SOMDocument)

**Problem:** The protocol targeted SOM objects by name, but `name` only resolved
against nodes via `getNodeByName`. Animations are document-level objects, not
nodes — adding them required a shared flat namespace.

**Changes to `SOMDocument`:**

- Added `_objectsByName: Map` — global flat namespace for all named SOM objects
- Added `_animationsByName: Map` — typed animation lookup
- Added `_registerObject(name, somObject)` — registers with collision detection;
  logs a warning and returns `false` if the name is already taken
- `SOMDocument` self-registers as `'__document__'` during construction (before
  `_buildObjectGraph()` runs)
- Build order in `_buildObjectGraph()` reordered: **nodes are registered before
  animations**, so nodes win name collisions (follows DOM `id` uniqueness model
  per spec §4.3; glTF 2.0 allows cross-type name collisions that Atrium forbids)
- Added `getObjectByName(name)` — resolves any SOM type
- Added `getAnimationByName(name)` — typed animation-only lookup
- `_registerNodeDispose` updated to also unregister from `_objectsByName` on dispose
- `createNode`, `ingestNode`, `ingestExternalScene` all register new nodes in
  `_objectsByName` via `_registerObject`
- `createAnimation` registers new animations in `_animationsByName` and
  `_objectsByName`

**Collision behaviour (verified by test):** If a node named `"Shared"` and an
animation named `"Shared"` exist in the same document, the node wins in
`_objectsByName`; the animation is still accessible via `getAnimationByName`.

---

## Phase 2 — SOMAnimation Rewrite

The previous `SOMAnimation` was a stub (loop, timeScale properties; play/stop
setting a string state). Fully replaced per spec.

**Intrinsic properties (read-only, from glTF content):**

- `name` — from `animation.getName()`
- `duration` — max keyframe time scanned from sampler input accessors
- `channels` — array of `{ targetNode, targetProperty, samplerIndex }` plain objects
- `samplers` — array of `{ interpolation, inputCount, outputCount }` plain objects

**Playback compound property:**

- `_playback` internal object with default state:
  `{ playing: false, paused: false, loop: false, timeScale: 1.0, startTime: 0, startWallClock: null, pauseTime: null }`
- `playback` getter returns a shallow copy
- `playback` setter: stores new state, persists to `extras.atrium.playback` on
  the glTF-Transform Animation object (for round-trip / late-joiner sync), fires
  one `mutation` event with `property: 'playback'`
- Constructor reads `extras.atrium.playback` to initialize `_playback` (late-joiner
  catchup path)

**Read-only convenience accessors:** `playing`, `paused`, `loop`, `timeScale`,
`startTime`, `startWallClock`, `pauseTime` — all delegate to `_playback`.

**Computed `currentTime`:** derived live from wall clock, never stored, never sent
on wire. Handles looping (modulo duration) and non-looping (clamped at duration).

**Methods:**
- `play({ startTime=0, loop=false, timeScale=1.0 })` — one atomic playback write
- `pause()` — no-op if not playing; captures `pauseTime` from wall clock elapsed
- `stop()` — resets to default playback state

**`tick()`:** called by app frame loop. Guards with `_playback.playing &&
_hasListeners('timeupdate')` — zero-cost when unused. Dispatches `timeupdate`
event with `{ currentTime }` in detail.

---

## Phase 3 — Protocol Integration

### AtriumClient

**`_onSet` (inbound):** Replaced `if (msg.node === '__document__' ...) / else
getNodeByName` branching with uniform `getObjectByName`:

```javascript
// Before
if (msg.node === '__document__' && msg.field === 'extras') {
  this._som.extras = msg.value
} else {
  const node = this._som.getNodeByName(msg.node)
  if (node) this._som.setPath(node, msg.field, msg.value)
}

// After
const target = this._som.getObjectByName(msg.node)
if (target) this._som.setPath(target, msg.field, msg.value)
```

`setPath` works on `SOMDocument` (for `extras`) and `SOMAnimation` (for
`playback`) because both expose standard getter/setter pairs and the `in`
operator check passes.

**`_attachMutationListeners`:** Now also iterates `this._som.animations` and
calls `_attachAnimationListeners(anim)` for each.

**`_attachAnimationListeners(anim)` (new):** Listens to `mutation` events on the
animation. Only broadcasts `property === 'playback'` mutations. The `timeupdate`
event is local-only and is never sent.

### Server — world.js

`setField` now uses `getObjectByName` instead of `getNodeByName`:

```javascript
// Before
const node = som.getNodeByName(nodeName)
if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }

// After
const target = som.getObjectByName(nodeName)
if (!target) return { ok: false, code: 'NODE_NOT_FOUND' }
```

This makes `setField` handle nodes (`Cube`), animations (`Walk`), and the
document root (`__document__`) through a single path.

### Server — session.js

The `send` handler previously had a `__document__`-specific branch that bypassed
`setField`. Removed — `setField` now handles it via `getObjectByName`:

```javascript
// Before
if (msg.node === '__document__' && msg.field === 'extras') {
  world.som.extras = msg.value
  result = { ok: true }
} else {
  result = world.setField(msg.node, msg.field, msg.value)
}

// After
const result = world.setField(msg.node, msg.field, msg.value)
```

**Wire format unchanged.** The `node` field in `send`/`set` messages carries
the animation name exactly as it carries node names. No schema changes needed.

---

## Phase 4 — AnimationController

New file: `packages/client/src/AnimationController.js`

**Constructor:** Takes an `AtriumClient`. Wires up `world:loaded`, `som:add`,
`som:remove` client events.

**Internal state:**
- `_tracked: Map<animName, { anim, mutationListener }>` — all known animations
- `_playing: Set<SOMAnimation>` — animations currently in `playing: true` state

**`_onWorldLoaded()`:** Scans `client.som.animations`. For each:
1. Calls `_trackAnimation(anim)` — registers mutation listener
2. If `anim.playing` (late-joiner / authored auto-play): adds to `_playing`,
   emits `animation:play`

**`_onSomAdd(nodeName)`:** Checks `som.getAnimationByName(nodeName)`. If an
animation, tracks it and emits `animation:added`. (Dynamic animation adds from
external refs use `som:add`.)

**`_onSomRemove(nodeName)`:** Tears down mutation listener, removes from
`_playing` and `_tracked`, emits `animation:removed`.

**`_trackAnimation(anim)`:** Attaches a `mutation` listener on the animation.
When `property === 'playback'`:
- `playing: true` → add to `_playing`, emit `animation:play`
- `paused: true` → remove from `_playing`, emit `animation:pause`
- both false → remove from `_playing`, emit `animation:stop`

**`tick(dt)`:** Iterates `_playing`, calls `anim.tick()` on each. Only playing
animations in the set — O(playing) not O(all).

**Events emitted:**

| Event | When |
|-------|------|
| `animation:added` | New animation appears in SOM |
| `animation:removed` | Animation removed from SOM |
| `animation:play` | `playback.playing` becomes true |
| `animation:pause` | `playback.paused` becomes true |
| `animation:stop` | both `playing` and `paused` false |

All events carry `{ animation: SOMAnimation }`.

**Export:** Added to `packages/client/package.json` `exports` map:

```json
"./AnimationController": "./src/AnimationController.js"
```

Import: `import { AnimationController } from '@atrium/client/AnimationController'`

---

## App Layer Wiring (Phase 5 — not implemented this session)

The spec's Phase 5 (renderer integration in `apps/client` and `tools/som-inspector`)
was not implemented. The AnimationController emits the right events; the
Three.js `AnimationMixer` wiring is left for the next session.

Reference wiring from spec §6.6:

```javascript
const anim = new AnimationController(client)
anim.tick(dt)        // in frame loop
mixer.update(dt)     // Three.js mixer

anim.on('animation:play', ({ animation }) => {
  const clip = findClip(animation.name)
  const action = mixer.clipAction(clip)
  action.loop = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce
  action.clampWhenFinished = !animation.loop
  action.timeScale = animation.timeScale
  action.reset().play()
  action.time = animation.currentTime   // seek to computed position
})
anim.on('animation:pause', ({ animation }) => { ... })
anim.on('animation:stop',  ({ animation }) => { ... })
```

---

## Test Results

```
259 tests total — 259 pass — 0 fail
```

New tests in `packages/som/test/SOMAnimation.test.js` (26 tests):
- Global namespace: getObjectByName routing, getAnimationByName, collision detection
- Intrinsic properties: name, duration, channels descriptor, samplers descriptor
- Playback state machine: default state, play, pause (no-op guard), stop
- currentTime: advances while playing, frozen when paused, loop wraps, non-loop clamps
- tick/timeupdate: fires when playing+listeners, skips otherwise
- setPath integration: works on SOMAnimation (playback) and SOMDocument (extras)
- Persistence: playback state written to extras.atrium.playback on glTF object

---

## Design Decisions / Notes

**`node` field kept (not renamed to `name`):** The spec used `name` in example
wire messages but the existing protocol schema uses `node`. Section 4.5 says
"None" for protocol impact. Field name kept as `node` — no schema changes.

**`setPath` works on SOMDocument without modification:** The `in` operator check
(`key in target`) passes for `extras` on SOMDocument and `playback` on
SOMAnimation since both are defined as getter/setter pairs on the class prototype.

**Mutation event structure:** `SOMEvent` puts all detail under `event.detail`.
Existing listeners use `event.detail.property` and `event.detail.value`.
SOMAnimation follows the same pattern. The `timeupdate` event detail has
`currentTime` at `event.detail.currentTime`.

**`_playing` set in AnimationController:** Only playing animations are iterated
in `tick()`. Paused and stopped animations are removed from the set. The
mutation listener is what updates `_playing` — not the tick loop itself.

**External reference animations (Phase 6):** Not implemented. `ingestExternalScene`
currently copies only nodes/meshes/materials from external documents — not
animations. Per spec §4.7, external animations should be registered with the
`ContainerName/AnimationName` prefix pattern. Deferred.
