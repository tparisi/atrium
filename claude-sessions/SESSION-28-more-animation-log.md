# Session 28 Build Log — Phase 5 Renderer Integration & Test Fixture
## Date: 2026-04-15

---

## Overview

Session 28 completed the animation pipeline end-to-end:

- **Part 0**: Two pre-flight fixes to `AnimationController.js`
- **Part 1**: `space-anim.gltf` test fixture with two loopable animations
- **Part 2**: Three.js renderer integration in `apps/client/src/app.js`
- **Part 3**: SOM Inspector wiring — `AnimationController` + new `AnimationsPanel`

---

## Part 0: AnimationController Pre-flight Fixes

### Fix 1 — Mutation event shape (non-fix)

The spec suggested removing `.detail` from mutation event reads in
`AnimationController._trackAnimation`, asserting the shape was `event.property`
not `event.detail.property`. Before changing anything, verified the actual
SOM implementation:

**`packages/som/src/SOMAnimation.js`** — `playback` setter dispatches:
```javascript
this._dispatchEvent(new SOMEvent('mutation', {
  target: this, property: 'playback', value: this._playback
}))
```

**`packages/som/src/SOMEvent.js`** — `SOMEvent` stores all payload fields
under `this.detail`. So `event.detail.property` and `event.detail.value`
are correct.

**`packages/client/src/AtriumClient.js`** — existing mutation listeners
also read `event.detail.property` / `event.detail.value`.

**Conclusion:** `AnimationController._trackAnimation` was already using
the correct shape. No change made.

### Fix 2 — World reload teardown

`_onWorldLoaded` did not clear `_tracked` or `_playing` before
re-scanning. On disconnect, `app.js` calls `client.loadWorld()`, which
fires `world:loaded` again. Without teardown, mutation listeners
accumulate and fire twice per animation event.

**Fix applied in `packages/client/src/AnimationController.js`:**

```javascript
_onWorldLoaded() {
  // Tear down previous world's tracking before re-scanning
  for (const { anim, mutationListener } of this._tracked.values()) {
    anim.removeEventListener('mutation', mutationListener)
  }
  this._tracked.clear()
  this._playing.clear()

  const som = this._client.som
  if (!som) return
  // ... rest unchanged
}
```

All 65 client tests pass after this fix.

---

## Part 1: Test Fixture — `space-anim.gltf`

### Files created

| File | Description |
|------|-------------|
| `tests/fixtures/generate-space-anim.js` | Standalone generator script |
| `tests/fixtures/space-anim.gltf` | Generated fixture (committed) |
| `tests/fixtures/space-anim.atrium.json` | World manifest |

### Generator approach

The spec required a **standalone** generator — not reading `space.gltf`,
but rebuilding the scene from scratch. Copied geometry builders
(`buildBox`, `buildCylinder`) and material/mesh helpers verbatim from
`generate-space.js`. The two animation passes were added after the scene
geometry was built.

The generator resolves `@gltf-transform/core` relative to
`packages/server/node_modules` to avoid a separate install at the
fixture level.

### CrateRotate animation

Y-axis full rotation over 4 seconds, 5 quaternion keyframes:

| t (s) | θ (rad) | Quaternion [x, y, z, w] |
|-------|---------|--------------------------|
| 0 | 0 | [0, 0, 0, 1] |
| 1 | π/2 | [0, sin(π/4), 0, cos(π/4)] |
| 2 | π | [0, sin(π/2), 0, cos(π/2)] |
| 3 | 3π/2 | [0, sin(3π/4), 0, cos(3π/4)] |
| 4 | 2π | [0, 0, 0, 1] |

Formula used: for angle θ around Y → `[0, sin(θ/2), 0, cos(θ/2)]`.
First and last keyframes identical → seamlessly loopable.

### CrateBob animation

Y-axis translation oscillation over 2 seconds, 5 VEC3 keyframes:

| t (s) | Translation [x, y, z] |
|-------|------------------------|
| 0.0 | [1, 0.25, 0] |
| 0.5 | [1, 0.40, 0] |
| 1.0 | [1, 0.25, 0] |
| 1.5 | [1, 0.10, 0] |
| 2.0 | [1, 0.25, 0] |

### Verification

Generated file verified:
- Valid JSON, parses without error
- `json.animations` has exactly 2 entries: `CrateRotate` (1 channel, 1 sampler)
  and `CrateBob` (1 channel, 1 sampler)
- Buffer embedded as base64 data URI — fully self-contained `.gltf`
- `extras.atrium.playback` not set in generator (animations start stopped;
  `SOMAnimation` reads this on load for late-joiner sync)

---

## Part 2: Renderer Integration — `apps/client/src/app.js`

### Key finding — DocumentView clip access (§2.1)

The spec flagged this as the most important unknown: how to get
`THREE.AnimationClip` objects from a `DocumentView`-built scene.

**Investigation:** Fetched the `@gltf-transform/view@4.3.0` bundle from
unpkg and searched for `AnimationClip`. **Not found.** The `@gltf-transform/view`
package does **not** import `THREE.AnimationClip` anywhere in its bundle.
`sceneGroup.animations` is always `undefined`.

**Solution:** Build clips manually from the glTF-Transform document data.
The raw accessor arrays are directly accessible via the glTF-Transform API.

```javascript
function buildClipsFromSOM(somDocument) {
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
```

**Track name resolution:** Three.js `AnimationMixer` resolves track names
by walking the `Object3D` hierarchy by `.name`. `DocumentView` sets
`value.name = def.getName()` — so Three.js object names match glTF node
names exactly. Bare node name is correct: `"crate-01.quaternion"`.

### Changes made

**New variables (module scope):**
```javascript
let mixer     = null   // THREE.AnimationMixer — recreated on world:loaded
const clipMap = new Map()   // animName → THREE.AnimationClip
```

**`AnimationController` construction:** Constructed once at startup
alongside `avatar` and `nav`, not per world load:
```javascript
const animCtrl = new AnimationController(client)
```
Its `_onWorldLoaded` teardown (Fix 2 above) handles world transitions.

**Animation events wired once at startup:**
- `animation:play` → `mixer.clipAction(clip).reset().play()` with late-joiner seek via `action.time = animation.currentTime`
- `animation:pause` → `existingAction.paused = true`
- `animation:stop` → `existingAction.stop()`

**`initAnimations()`** called from `world:loaded` after `initDocumentView()`:
- Stops previous mixer
- Clears `clipMap`
- Calls `buildClipsFromSOM(client.som)` → populates `clipMap`
- Creates new `THREE.AnimationMixer(sceneGroup)`

**Tick loop additions:**
```javascript
animCtrl.tick(dt)       // drives timeupdate events on playing animations
if (mixer) mixer.update(dt)   // advances Three.js playhead
```
Both before `renderer.render()`.

**Import map** (`apps/client/index.html`):
```json
"@atrium/client/AnimationController": "../../packages/client/src/AnimationController.js"
```

---

## Part 3: SOM Inspector Integration

### `tools/som-inspector/src/app.js`

Applied identical AnimationController wiring as `apps/client`:
- Added `mixer`, `clipMap` module-scope variables
- Added `buildClipsFromSOM()` function (identical implementation)
- Added `initAnimations()` function
- Constructed `animCtrl = new AnimationController(client)` at startup alongside `nav`
- Wired `animation:play/pause/stop` events at startup
- Constructed `animationsPanel = new AnimationsPanel(animationsPanelEl)`
- `world:loaded` handler: calls `initAnimations()` then `animationsPanel.show(client.som, animCtrl)`
- `disconnected` handler: calls `animationsPanel.clear()`
- Tick loop: `animCtrl.tick(dt)` and `if (mixer) mixer.update(dt)` before render

### `tools/som-inspector/src/AnimationsPanel.js` (new file)

Displays all world animations as a panel in the left sidebar. One row per animation:
- Animation name
- Duration (formatted `X.XXs`)
- Current time display (live, updated via `timeupdate` event)
- Play / Pause / Stop buttons

**Button state logic:**
- Play disabled when playing (not paused)
- Pause disabled when stopped or already paused
- Stop disabled when stopped
- Button states update on `mutation` events from the SOM animation

**Listener lifecycle:**
- `show()` attaches `timeupdate` and `mutation` listeners per animation, stores references
- `clear()` removes all stored listeners before clearing DOM

**Implementation note:** The spec called for wiring `animCtrl` events to call
`refresh()`. Instead, each animation row wires directly to its own SOM
animation's `mutation` event to update button state — simpler and avoids
needing a full-panel refresh. `timeupdate` drives the live time display
directly.

### `tools/som-inspector/index.html`

**Import map** addition:
```json
"@atrium/client/AnimationController": "../../packages/client/src/AnimationController.js"
```

**DOM addition** (below property sheet in left panel):
```html
<div class="panel-header">Animations</div>
<div id="animations-panel"></div>
```

**CSS** added for animations panel:
- `.anim-row` — flex row per animation
- `.anim-name` — truncated name
- `.anim-duration` — right-aligned, muted
- `.anim-time` — right-aligned, accent color (live display)
- `.anim-btn` — compact play/pause/stop buttons
- `.anim-empty` — placeholder when no animations present

---

## Regression Results

All packages pass:

| Package | Tests | Pass | Fail |
|---------|-------|------|------|
| `@atrium/som` | 103 | 103 | 0 |
| `@atrium/protocol` | 43 | 43 | 0 |
| `@atrium/client` | 65 | 65 | 0 |
| `@atrium/server` | 32 | 32 | 0 |
| **Total** | **243** | **243** | **0** |

The `@atrium/gltf-extension` package has no test files (expected).

---

## Design Decisions and Findings

### DocumentView does not produce AnimationClips

This was the central unknown. `@gltf-transform/view@4.3.0` is a view-only
bridge for geometry and materials. It does not touch the Three.js animation
system. Anyone using `DocumentView` must build clips manually from the
glTF-Transform document's raw accessor data — there is no shortcut via
`sceneGroup.animations` or `docView.clips`.

### `AnimationController` constructed once, `AnimationMixer` rebuilt per world

- `AnimationController` is constructed at startup alongside `avatar` / `nav`.
  Its `world:loaded` listener handles teardown and re-scanning automatically.
- `AnimationMixer` must be rebuilt on each `world:loaded` because it is bound
  to a specific `sceneGroup` instance, which is replaced by `initDocumentView()`.

### Late-joiner seek

`action.time = animation.currentTime` immediately after `action.reset().play()`
seeks to the wall-clock-computed position. `SOMAnimation.currentTime` is a
computed getter that reads `Date.now() - startWallClock` at the moment it
is called — so it gives the correct in-progress position for a late-joining renderer.

### Inspector Play always loops

`AnimationsPanel` calls `anim.play()` (no options) — `SOMAnimation.play()`
defaults to `loop: true`. Simplest useful default for a developer tool.

---

## Files Changed

| File | Status |
|------|--------|
| `packages/client/src/AnimationController.js` | Modified — Fix 2 world reload teardown |
| `tests/fixtures/generate-space-anim.js` | Created |
| `tests/fixtures/space-anim.gltf` | Generated and committed |
| `tests/fixtures/space-anim.atrium.json` | Created |
| `apps/client/src/app.js` | Modified — AnimationController wiring, buildClipsFromSOM, initAnimations, tick loop |
| `apps/client/index.html` | Modified — AnimationController import map entry |
| `tools/som-inspector/src/app.js` | Modified — identical animation wiring, AnimationsPanel construction |
| `tools/som-inspector/src/AnimationsPanel.js` | Created |
| `tools/som-inspector/index.html` | Modified — AnimationController import map entry, animations-panel DOM + CSS |
