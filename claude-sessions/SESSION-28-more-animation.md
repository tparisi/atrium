# Atrium — Phase 5 Renderer Integration & Test Fixture Design Spec
## Session 28 · 2026-04-15

---

## Overview

This spec covers two deliverables for Session 28:

1. **Test fixture** — `tests/fixtures/space-anim.gltf` with two loopable
   animations on `crate-01`, and its generator script and manifest.
   Build this first so Phase 5 has something to test against.

2. **Phase 5: Renderer Integration** — wire `AnimationController` into
   `apps/client/src/app.js` and `tools/som-inspector/src/app.js`.
   Map `AnimationController` events to Three.js `AnimationMixer` /
   `AnimationAction` calls.

Also covered: two bugs to fix in `AnimationController.js` before Phase 5
renderer work begins.

---

## Part 0: AnimationController Pre-flight Fixes

Before writing any Phase 5 renderer code, fix these two issues in
`packages/client/src/AnimationController.js`.

### Fix 1 — Mutation event shape

**Problem:** `_trackAnimation` reads `event.detail.property` and
`event.detail.value`. SOM mutation events put these fields directly on the
event object, not nested under `.detail`. Every other mutation listener in
`AtriumClient.js` reads `event.property` and `event.value` directly.

**Verification step:** Open `packages/som/src/SOMAnimation.js`, find the
`_dispatchEvent` call in the `playback` setter, and confirm the exact shape.
Also check `packages/client/src/AtriumClient.js` — find any existing
`addEventListener('mutation', ...)` call and confirm how it reads the fields.

**Expected fix** (adjust if verification shows otherwise):

```javascript
// Before
const mutationListener = (event) => {
  if (event.detail.property !== 'playback') return
  const pb = event.detail.value
  ...
}

// After
const mutationListener = (event) => {
  if (event.property !== 'playback') return
  const pb = event.value
  ...
}
```

### Fix 2 — World reload teardown

**Problem:** `_onWorldLoaded` does not clear `_tracked` or `_playing` before
re-scanning. On disconnect, `app.js` calls `client.loadWorld()` which fires
`world:loaded` again. Old entries accumulate; mutation listeners are registered
twice on the same animations.

**Fix:** Add teardown at the top of `_onWorldLoaded`:

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

### Regression check

After both fixes:

```bash
pnpm --filter @atrium/client test
```

All existing tests must pass before proceeding.

---

## Part 1: Test Fixture — `space-anim.gltf`

### 1.1 Files to create

| File | Description |
|------|-------------|
| `tests/fixtures/generate-space-anim.js` | Generator script |
| `tests/fixtures/space-anim.gltf` | Generated output (committed) |
| `tests/fixtures/space-anim.atrium.json` | World manifest |

### 1.2 What the fixture contains

`space-anim.gltf` is `space.gltf` plus two animations. All geometry,
materials, and world metadata are identical to `space.gltf`. The only
additions are two glTF `animations` targeting `crate-01`.

**Do not read `space.gltf` at generation time.** The generator is
standalone — it rebuilds the full scene from scratch (same pattern as
`generate-space.js`) and adds animations in the same pass. Copy the
geometry and material building code from `generate-space.js` verbatim.

### 1.3 Animation: `CrateRotate`

Rotates `crate-01` around the Y axis, one full revolution.

| Property | Value |
|----------|-------|
| Target node | `crate-01` |
| Target property | `rotation` (quaternion) |
| Duration | 4.0 seconds |
| Interpolation | `LINEAR` |
| Loop intent | loopable (keyframes form a complete cycle) |
| Keyframes | 5 (at t = 0, 1, 2, 3, 4) |

**Keyframe values** (axis-angle Y → quaternion `[x, y, z, w]`):

| t (s) | Angle (rad) | Quaternion [x, y, z, w] |
|-------|-------------|--------------------------|
| 0.0 | 0 | [0, 0, 0, 1] |
| 1.0 | π/2 | [0, 0.3827, 0, 0.9239] |
| 2.0 | π | [0, 0.7071, 0, 0.7071] |
| 3.0 | 3π/2 | [0, 0.9239, 0, 0.3827] |
| 4.0 | 2π | [0, 0, 0, 1] |

The first and last keyframes are identical, making the animation seamlessly
loopable when `loop: true`.

**Quaternion formula** for angle θ around Y:
`[0, sin(θ/2), 0, cos(θ/2)]`

### 1.4 Animation: `CrateBob`

Translates `crate-01` up and down (Y axis only), oscillating above and below
its resting position.

| Property | Value |
|----------|-------|
| Target node | `crate-01` |
| Target property | `translation` |
| Duration | 2.0 seconds |
| Interpolation | `LINEAR` |
| Loop intent | loopable (keyframes form a complete cycle) |
| Resting Y | 0.25 (center of crate sitting on ground) |
| Bob amplitude | ±0.15 meters |
| Keyframes | 5 (at t = 0, 0.5, 1.0, 1.5, 2.0) |

**Keyframe values** (full `[x, y, z]` translation; X and Z stay at resting
values `[1, y, 0]`):

| t (s) | Y | Translation [x, y, z] |
|-------|---|------------------------|
| 0.0 | 0.25 | [1, 0.25, 0] |
| 0.5 | 0.40 | [1, 0.40, 0] |
| 1.0 | 0.25 | [1, 0.25, 0] |
| 1.5 | 0.10 | [1, 0.10, 0] |
| 2.0 | 0.25 | [1, 0.25, 0] |

The first and last keyframes are identical — seamlessly loopable.

### 1.5 glTF-Transform animation API

Use the following glTF-Transform objects (all from `@gltf-transform/core`):
`Animation`, `AnimationChannel`, `AnimationSampler`.

**Pattern for each animation:**

```javascript
// 1. Create time accessor (input) — shared if same keyframe times
const timeAcc = doc.createAccessor()
  .setArray(new Float32Array([0, 1, 2, 3, 4]))   // keyframe times
  .setType('SCALAR')
  .setBuffer(buffer)

// 2. Create value accessor (output)
// For rotation: VEC4, one [x,y,z,w] per keyframe
// For translation: VEC3, one [x,y,z] per keyframe
const valueAcc = doc.createAccessor()
  .setArray(new Float32Array([...flattenedKeyframeValues]))
  .setType('VEC4')   // or 'VEC3' for translation
  .setBuffer(buffer)

// 3. Create sampler
const sampler = doc.createAnimationSampler()
  .setInput(timeAcc)
  .setOutput(valueAcc)
  .setInterpolation('LINEAR')

// 4. Create channel
const channel = doc.createAnimationChannel()
  .setSampler(sampler)
  .setTargetNode(crateNode)
  .setTargetPath('rotation')   // or 'translation'

// 5. Create animation
const anim = doc.createAnimation('CrateRotate')
  .addSampler(sampler)
  .addChannel(channel)
```

**Important:** `setTargetPath` takes the glTF path string: `'rotation'`,
`'translation'`, `'scale'`, or `'weights'`.

### 1.6 Generator script structure

```javascript
// tests/fixtures/generate-space-anim.js
// SPDX-License-Identifier: MIT
// ...
//
// Generates tests/fixtures/space-anim.gltf — space.gltf plus two animations.
// Run from repo root:
//   node tests/fixtures/generate-space-anim.js

// [imports — identical to generate-space.js]

const OUT_PATH = join(__dirname, 'space-anim.gltf')

async function main() {
  // [Step 1] Build doc, buffer, scene, geometry — identical to generate-space.js
  //          Copy verbatim. Keep crateNode reference for animation targeting.

  // [Step 2] Build CrateRotate animation
  //          Time accessor: [0, 1, 2, 3, 4]
  //          Value accessor: 5 quaternions (VEC4)

  // [Step 3] Build CrateBob animation
  //          Time accessor: [0, 0.5, 1.0, 1.5, 2.0]
  //          Value accessor: 5 translations (VEC3)

  // [Step 4] Write with embedded base64 buffer — identical to generate-space.js
  //          OUT_PATH = 'space-anim.gltf'
}
```

**Note:** `crateNode` is already returned by `doc.createNode('crate-01')` in
the existing code. Keep the reference; pass it to `setTargetNode()` in each
channel.

### 1.7 World manifest — `space-anim.atrium.json`

```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./space-anim.gltf",
    "server": "ws://localhost:3000"
  }
}
```

No `baseUrl` needed — no external references in this fixture.

### 1.8 Verification

After generating:

1. The file is valid JSON and parses without error.
2. `json.animations` has exactly 2 entries named `CrateRotate` and `CrateBob`.
3. Each animation has 1 channel and 1 sampler.
4. Load `space-anim.gltf` in the browser client — crate is visible at `[1, 0.25, 0]`.
5. After Phase 5 is wired: `anim.play({ loop: true })` from the console starts
   the animation visibly.

---

## Part 2: Phase 5 — Renderer Integration

### 2.1 Prerequisite: DocumentView clip access

**This is the most important unknown. Verify before writing any mixer code.**

`apps/client` does not use `GLTFLoader`. The Three.js scene is built entirely
by `DocumentView` from `@gltf-transform/view`. `AnimationClip` objects are
not produced by a separate loader pass.

Check the `@gltf-transform/view` package for clip access. Two likely patterns:

**Pattern A** — `DocumentView` exposes clips directly:
```javascript
const clips = docView.clips   // or docView.getClips(), docView.animations, etc.
```

**Pattern B** — Clips are attached to the scene group (Three.js standard):
```javascript
const clips = sceneGroup.animations   // THREE.Object3D carries .animations[]
```

**Pattern C** — Clips must be extracted by traversal:
```javascript
const clips = []
sceneGroup.traverse(obj => {
  if (obj.animations?.length) clips.push(...obj.animations)
})
```

**Claude Code: inspect `@gltf-transform/view`'s source or TypeScript types
to determine which pattern applies.** The rest of Part 2 assumes Pattern B
or C produces a `clips` array of `THREE.AnimationClip` instances. Adjust
as needed based on what you find.

Build a name→clip map immediately after `initDocumentView`:
```javascript
const clipMap = new Map()   // animName → THREE.AnimationClip
for (const clip of clips) {
  clipMap.set(clip.name, clip)
}
```

### 2.2 `apps/client/src/app.js` changes

#### 2.2.1 New imports (top of file)

```javascript
import { AnimationController } from '@atrium/client/AnimationController'
```

#### 2.2.2 New module-scope variables (near `docView` / `sceneGroup`)

```javascript
let mixer     = null   // THREE.AnimationMixer — recreated on world:loaded
let animCtrl  = null   // AnimationController — recreated on world:loaded
const clipMap = new Map()   // animName → THREE.AnimationClip
```

#### 2.2.3 New helper: `initAnimations()`

Called from the `world:loaded` handler, after `initDocumentView()`.

```javascript
function initAnimations() {
  // Dispose previous mixer
  if (mixer) mixer.stopAllAction()
  mixer = null
  clipMap.clear()

  // Dispose previous controller
  // (AnimationController has no dispose(), but re-creating it is safe —
  //  old client listeners from the previous world are orphaned but harmless
  //  since world:loaded teardown clears _tracked and _playing)
  animCtrl = new AnimationController(client)
  wireAnimationEvents()

  // Build clip map from DocumentView output
  // ** Adjust clip source based on verified DocumentView API (see §2.1) **
  const clips = sceneGroup.animations ?? []
  for (const clip of clips) clipMap.set(clip.name, clip)

  if (clips.length > 0) {
    mixer = new THREE.AnimationMixer(sceneGroup)
    console.log(`[app] AnimationMixer ready — ${clips.length} clip(s)`)
  }
}
```

**Note on AnimationController construction:** `AnimationController`
registers `world:loaded`, `som:add`, and `som:remove` listeners on the
client in its constructor. Constructing it inside `initAnimations()` (which
is called from `world:loaded`) means the new controller registers for the
*next* `world:loaded`. The `_onWorldLoaded` call that happens at construction
time via the event listener is for a future world load — the current
`world:loaded` scan is triggered explicitly by calling
`animCtrl._onWorldLoaded()` once after construction, or by restructuring
so the controller is constructed once at startup (see §2.2.7).

**Preferred approach — construct once at startup** (see §2.2.7).

#### 2.2.4 New helper: `wireAnimationEvents()`

```javascript
function wireAnimationEvents() {
  animCtrl.on('animation:play', ({ animation }) => {
    if (!mixer) return
    const clip = clipMap.get(animation.name)
    if (!clip) {
      console.warn(`[app] animation:play — no clip for "${animation.name}"`)
      return
    }
    const action = mixer.clipAction(clip)
    action.loop          = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce
    action.clampWhenFinished = !animation.loop
    action.timeScale     = animation.timeScale
    action.reset().play()
    // Seek to computed position (handles late-joiner sync)
    action.time          = animation.currentTime
  })

  animCtrl.on('animation:pause', ({ animation }) => {
    if (!mixer) return
    const clip = clipMap.get(animation.name)
    if (!clip) return
    const action = mixer.existingAction(clip)
    if (action) action.paused = true
  })

  animCtrl.on('animation:stop', ({ animation }) => {
    if (!mixer) return
    const clip = clipMap.get(animation.name)
    if (!clip) return
    const action = mixer.existingAction(clip)
    if (action) action.stop()
  })
}
```

#### 2.2.5 Updated `world:loaded` handler

Add `initAnimations()` call after `initDocumentView()`:

```javascript
client.on('world:loaded', ({ name, description, author }) => {
  if (!client.som) return

  // ... existing worldBaseUrl derivation ...

  threeScene.background = null
  threeScene.environment = null

  initDocumentView(client.som)
  initAnimations()           // ← ADD THIS LINE

  // ... existing background loading, HUD update, console.log ...
})
```

#### 2.2.6 Updated tick loop

Add `animCtrl?.tick(dt)` and `mixer?.update(dt)`:

```javascript
function tick(now) {
  requestAnimationFrame(tick)

  const dt = (now - lastTick) / 1000
  lastTick = now

  nav.tick(dt)
  animCtrl?.tick(dt)         // ← drives timeupdate events on playing animations
  mixer?.update(dt)          // ← advances Three.js AnimationMixer

  // ... existing camera sync, labels.update(), renderer.render() ...
}
```

`mixer.update(dt)` must come **before** `renderer.render()` so the mesh
positions are correct for the frame being rendered. `animCtrl.tick(dt)`
must come before `mixer.update(dt)` so any `timeupdate` listeners fire
before the render.

#### 2.2.7 Preferred: construct AnimationController once at startup

Rather than recreating `AnimationController` in `initAnimations()`, construct
it once alongside `avatar` and `nav`:

```javascript
const client  = new AtriumClient({ debug: false })
const avatar  = new AvatarController(client, { ... })
const nav     = new NavigationController(avatar, { ... })
const animCtrl = new AnimationController(client)   // ← ADD

wireAnimationEvents()   // wire once at startup, not per world:loaded
```

Then `initAnimations()` becomes:

```javascript
function initAnimations() {
  if (mixer) mixer.stopAllAction()
  mixer = null
  clipMap.clear()

  const clips = sceneGroup.animations ?? []
  for (const clip of clips) clipMap.set(clip.name, clip)

  if (clips.length > 0) {
    mixer = new THREE.AnimationMixer(sceneGroup)
    console.log(`[app] AnimationMixer ready — ${clips.length} clip(s)`)
  }
}
```

`AnimationController._onWorldLoaded()` fires automatically via the
`client.on('world:loaded')` listener registered in the constructor —
no manual call needed. `wireAnimationEvents()` is called once at startup,
not per world load, since `animCtrl` is a stable instance.

**This is the cleaner design.** Matches the `avatar` / `nav` pattern exactly.

#### 2.2.8 Import map entry

In `apps/client/index.html`, add to the import map:

```json
"@atrium/client/AnimationController": "../../packages/client/src/AnimationController.js"
```

### 2.3 `tools/som-inspector/src/app.js` changes

The SOM Inspector uses the same `AtriumClient` + `AvatarController` +
`NavigationController` stack. Apply the same AnimationController wiring —
same imports, same module-scope variables, same `initAnimations()` and
`wireAnimationEvents()` helpers, same tick loop additions.

**Key difference from `apps/client`:** The SOM Inspector uses ORBIT mode
and a meshless avatar. This has no effect on animation wiring — the
`AnimationMixer` and `AnimationController` are identical.

The SOM Inspector's `index.html` also needs the import map entry.

#### 2.3.1 Animation section in TreeView

**Do not** put this in `PropertySheet.js` — it belongs as a new section
in the left panel, below the scene graph tree, similar to how WorldInfoPanel
sits above the tree.

The inspector's left panel currently has:
1. WorldInfoPanel (collapsible, above tree)
2. Scene graph tree (TreeView)
3. PropertySheet (below tree, shows selected node)

Add:
4. **AnimationsPanel** — below PropertySheet, shows all animations

**`tools/som-inspector/src/AnimationsPanel.js`** — new file.

```javascript
// Minimal API
class AnimationsPanel {
  constructor(containerEl, { onPlay, onPause, onStop })
  show(som, animCtrl)   // populate from som.animations; wire timeupdate
  clear()               // empty content
  refresh()             // re-read playback state into existing DOM
}
```

**Panel contents:**

When no world is loaded: empty / hidden.

When a world is loaded with animations: one row per animation:

```
┌─ Animations ──────────────────────────────────────┐
│  CrateRotate   4.0s   [▶ Play] [⏸ Pause] [⏹ Stop] │
│  CrateBob      2.0s   [▶ Play] [⏸ Pause] [⏹ Stop] │
│  (playing) ──── 1.23s ────────────────────────     │
└────────────────────────────────────────────────────┘
```

Each row:
- Animation name (text)
- Duration (formatted as `X.Xs`)
- Play / Pause / Stop buttons
- Current time display — shown only when playing/paused, updated via
  `timeupdate` event when playing, static when paused

**Button behavior:**
- **Play** calls `anim.play({ loop: true })`. Always loops from the
  inspector (simplest useful default; can be made configurable later).
- **Pause** calls `anim.pause()`.
- **Stop** calls `anim.stop()`.

These mutate the SOM → fire mutation event → AtriumClient broadcasts →
all connected clients react. The inspector is a full session participant.

**Live current time:**

`AnimationsPanel.show()` registers a `timeupdate` listener on each
playing animation. The listener updates the current time display element
directly (no full refresh). `AnimationsPanel.clear()` removes all listeners.

```javascript
const onTimeUpdate = (event) => {
  timeEl.textContent = event.currentTime.toFixed(2) + 's'
}
anim.addEventListener('timeupdate', onTimeUpdate)
// store for cleanup: this._timeupdateListeners.push({ anim, onTimeUpdate })
```

**Playback state sync:**

When `animCtrl` emits `animation:play`, `animation:pause`, or
`animation:stop`, call `this.refresh()` to update button states and
show/hide the current time display. Wire these in `show()`:

```javascript
animCtrl.on('animation:play',  () => this.refresh())
animCtrl.on('animation:pause', () => this.refresh())
animCtrl.on('animation:stop',  () => this.refresh())
```

#### 2.3.2 Integration in `tools/som-inspector/src/app.js`

```javascript
import { AnimationsPanel } from './AnimationsPanel.js'

// Module scope
const animationsPanel = new AnimationsPanel(
  document.getElementById('animations-panel'),
  {
    onPlay:  (anim) => anim.play({ loop: true }),
    onPause: (anim) => anim.pause(),
    onStop:  (anim) => anim.stop(),
  }
)

// In world:loaded handler, after initAnimations():
animationsPanel.show(client.som, animCtrl)

// In any clear/reset path (disconnect reload):
// world:loaded will call show() again, overwriting previous state.
// No explicit clear() needed — show() should call clear() internally first.
```

Add a `<div id="animations-panel"></div>` to the inspector HTML layout,
below the property sheet container.

---

## Part 3: Implementation Sequence for Claude Code

```
1. AnimationController fixes (Part 0)
   - Fix mutation event shape (verify first, then fix)
   - Add _onWorldLoaded teardown
   - pnpm --filter @atrium/client test → all pass

2. Test fixture (Part 1)
   - Write generate-space-anim.js
   - node tests/fixtures/generate-space-anim.js
   - Verify space-anim.gltf has 2 animations
   - Write space-anim.atrium.json

3. apps/client renderer integration (Part 2.2)
   - Investigate DocumentView clip access (§2.1) — log what you find
   - Add AnimationController import and startup construction
   - Add initAnimations() and wireAnimationEvents()
   - Update world:loaded handler
   - Update tick loop
   - Update import map in index.html
   - Manual test: load space-anim.gltf, open console,
     run: atriumClient.som.getAnimationByName('CrateRotate').play({ loop: true })
     Verify crate rotates in viewport.

4. som-inspector integration (Part 2.3)
   - Same AnimationController wiring as apps/client
   - Write AnimationsPanel.js
   - Add to inspector HTML layout
   - Manual test: load space-anim.gltf in inspector,
     click Play on CrateRotate, verify rotation in viewport,
     verify current time updates live,
     connect two clients and verify cross-client sync.

5. Regression suite
   pnpm --filter @atrium/protocol test
   pnpm --filter @atrium/som test
   pnpm --filter @atrium/server test
   pnpm --filter @atrium/client test
   Expected: all pass (259 + any new tests)
```

---

## Part 4: Open Questions for Claude Code

These are flagged explicitly because they cannot be resolved from the
design documents alone.

1. **DocumentView clip access (§2.1)** — The most important unknown.
   Before writing any mixer code, determine how `AnimationClip` objects
   are accessed from a `DocumentView`-built scene. Log your finding as
   a comment in `app.js` before the clip extraction line.

2. **Mutation event shape (Part 0, Fix 1)** — Verify against the actual
   `SOMAnimation` source before changing. The fix direction given here
   (remove `.detail`) is correct if SOM follows the pattern in the
   Session 26 handoff, but the Session 27 implementation note suggested
   `.detail` was used. Check the implementation, not the spec.

3. **AnimationsPanel HTML structure** — The inspector's left panel
   HTML structure is not fully documented here. Find the existing
   `<div>` for the property sheet in `tools/som-inspector/index.html`
   and add the animations panel container below it, following the
   same CSS conventions already in use.

---

## Key Design Decisions

- **`AnimationController` constructed once at startup**, not per world
  load. Matches `AvatarController` and `NavigationController` pattern.
  Its internal `_onWorldLoaded` teardown (Part 0 Fix 2) handles
  world transitions correctly.

- **`AnimationMixer` recreated per world load**, in `initAnimations()`.
  The mixer is bound to a specific `sceneGroup` object, which is
  replaced by `initDocumentView()` on each world load. The mixer
  must be rebuilt against the new sceneGroup.

- **`clipMap` rebuilt per world load** for the same reason — clips
  come from the sceneGroup built by DocumentView.

- **Late-joiner seek** via `action.time = animation.currentTime`.
  `SOMAnimation.currentTime` computes the correct playhead from
  `startWallClock` at the moment it is read — so reading it
  immediately after `action.reset().play()` gives the correct
  in-progress position.

- **No `timeupdate` listener in `apps/client`** — the renderer reads
  `animation.currentTime` once at play-start for the seek, then
  delegates all per-frame advancement to `mixer.update(dt)`. The
  Three.js mixer owns the playhead after that. `timeupdate` is only
  used by `AnimationsPanel` in the inspector for the live display.

- **Inspector Play always loops** — simplest useful default for a
  developer tool. Production UI (if ever built) would add a loop
  toggle. Not worth the complexity now.
