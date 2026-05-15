# Session 36 — Renderer-Coupling Audit

**Date:** 2026-05-05
**Type:** Audit / design-input — no production code changes
**Status:** Complete

---

## 0. Preliminary checks

### `apps/playground` — pointer-only confirmed

`apps/playground/src/app.js` contains no `AnimationController`, `AnimationMixer`,
`clipMap`, `buildClipsFromSOM`, or `replayPlayingAnimations`. Its Three.js imports are:
`WebGLRenderer`, `Scene`, `Color`, `AmbientLight`, `DirectionalLight`, `GridHelper`,
`PerspectiveCamera`, `Vector3` (used in drag callbacks). There are no animation-related
Three.js usages. The consumer count for animation extraction is **two** (`apps/client`
and `tools/som-inspector`), not three.

### Headless packages — Three.js-free confirmed

`grep` for `three` import patterns in all headless packages returned no results:
- `packages/client/` — clean
- `packages/som/` — clean
- `packages/server/` — clean
- `packages/protocol/` — clean
- `packages/interaction/` — clean

Principles 10, 12, 13 are upheld.

### Inspector sibling files — Three.js-free confirmed

`TreeView.js`, `PropertySheet.js`, `WorldInfoPanel.js`, `AnimationsPanel.js` — none
import Three.js. All operate on SOM types and DOM only.

`LabelOverlay.js` (`apps/client/src/`) does import Three.js; it is a pure
`apps/client` concern and is detailed in §1.G below.

---

## 1. Touchpoint inventory

### Already extracted — `packages/renderer-three/src/`

| File | What it contains |
|---|---|
| `PointerInputBridge.js` | Canvas DOM listener attachment/removal; NDC conversion; `Raycaster.intersectObject`; `walkUpToSOMNode` resolution; `_buildDetail` (ray, point, normal, UV construction); `dispatchPointerEvent` calls; `suppressOnCapture` stopPropagation pragma. Imports `THREE`. |
| `drag-math.js` | `projectRayToPlane(ray, planeY)` — ray/horizontal-plane intersection. `computeParentInverse(threeObj)` — parent world matrix inverse for local-space transform. Imports `THREE`. |
| `hit-test.js` | `walkUpToSOMNode(obj, lookupByName)` — pure duck-typed walk (no `THREE` import). Used internally by `PointerInputBridge`; not exported. |

The existing `packages/renderer-three/` boundary is: **pointer handling only**. Animation,
DocumentView, scene bootstrap, avatar geometry, and camera sync all remain inline.

---

### Not yet extracted

#### A. Renderer / scene / camera bootstrap

**`apps/client/src/app.js` — lines 34–91**

```
THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
canvas.setAttribute('tabindex', '0') + focus-on-pointerdown listener
THREE.Scene()
threeScene.background = new THREE.Color(0x1a1a2e)     ← client-specific
THREE.AmbientLight(0xffffff, 0.6)
THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(5, 10, 5); castShadow = true
THREE.GridHelper(40, 40, 0x333333, 0x222222)           ← client-specific colors
THREE.PerspectiveCamera(70, 1, 0.01, 1000)
camera.position.set(0, 1.6, 4)                         ← avatar eye height
onResize(): renderer.setSize + camera.aspect + updateProjectionMatrix
```

**`tools/som-inspector/src/app.js` — lines 39–178**

```
THREE.WebGLRenderer({ antialias: true })               ← identical
renderer.setPixelRatio(window.devicePixelRatio)        ← identical
renderer.shadowMap.enabled = true                      ← identical
canvas focus wiring                                    ← identical
THREE.Scene()                                          ← identical
threeScene.background = new THREE.Color(0x111111)      ← inspector-specific
THREE.AmbientLight(0xffffff, 0.6)                      ← identical
THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(5, 10, 5); castShadow = true ← identical
THREE.GridHelper(40, 40, 0x1e293b, 0x0f172a)           ← inspector-specific colors
THREE.PerspectiveCamera(70, 1, 0.01, 1000)             ← identical (same FOV)
camera.position.set(0, 5, 10)                          ← inspector overhead view
onResize()                                             ← identical
```

Depends on: nothing from `@atrium/*`.

---

#### B. DocumentView wiring

**Both consumers — module vars:**
```js
let docView    = null
let sceneGroup = null
```

**`initDocumentView(somDocument)`** — appears verbatim in both:
```js
function initDocumentView(somDocument) {
  if (docView) { docView.dispose(); threeScene.remove(sceneGroup) }
  docView    = new DocumentView(renderer)
  const sceneDef = somDocument.document.getRoot().listScenes()[0]
  sceneGroup = docView.view(sceneDef)
  threeScene.add(sceneGroup)
}
```

Depends on: `@gltf-transform/view` `DocumentView`; the `renderer` and `threeScene`
locals from §A; `client.som` (passed in as argument).

---

#### C. Animation machinery

**`buildClipsFromSOM(somDocument)`** — appears in both consumers:
```js
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

Depends on: `@gltf-transform/core` (via `SOMDocument.document`); Three.js
`QuaternionKeyframeTrack`, `VectorKeyframeTrack`, `AnimationClip`.

**`initAnimations()`** — appears in both consumers, module vars `mixer` / `clipMap`:
```js
let mixer   = null
const clipMap = new Map()

function initAnimations() {
  if (mixer) mixer.stopAllAction()
  mixer = null
  clipMap.clear()
  if (!client.som) return
  const clips = buildClipsFromSOM(client.som)
  for (const clip of clips) clipMap.set(clip.name, clip)
  if (clips.length > 0) {
    mixer = new THREE.AnimationMixer(sceneGroup)
    mixer.addEventListener('finished', ({ action }) => {
      const clip = action.getClip()
      const anim = client.som?.getAnimationByName(clip.name)
      if (anim && anim.playing) anim.stop()
    })
    console.log(`[…] AnimationMixer ready — …`)
  }
}
```

Depends on: `sceneGroup` from §B; `client.som` (`@atrium/client`); Three.js
`AnimationMixer`.

**`animCtrl` event handlers** — four handlers in both consumers, wired to `AnimationController`:

```js
animCtrl.on('animation:play', ({ animation }) => {
  if (!mixer) return
  const action = mixer.clipAction(clipMap.get(animation.name))
  action.loop              = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce
  action.clampWhenFinished = !animation.loop
  action.timeScale         = animation.timeScale
  action.reset().play()
  action.time              = animation.currentTime
})
animCtrl.on('animation:pause',   ({ animation }) => { /* mixer.existingAction(clip).paused = true */ })
animCtrl.on('animation:stop',    ({ animation }) => { /* action.stop() */ })
animCtrl.on('animation:playback-changed', ({ animation, playback }) => {
  /* action.setLoop, action.setEffectiveTimeScale */
})
```

Depends on: `mixer`, `clipMap` from §C; `@atrium/client` `AnimationController`
events; Three.js `LoopRepeat`, `LoopOnce`.

**`mixer.update(dt)` in tick** — both consumers call this in their animation frame loop.

---

#### D. Reconciliation

**`replayPlayingAnimations(som)`** — in both consumers:
```js
function replayPlayingAnimations(som) {
  if (!mixer) return
  for (const anim of som.animations) {
    if (!anim.playing) continue
    const clip = clipMap.get(anim.name)
    const pb   = anim.playback
    const action = mixer.clipAction(clip)
    action.loop = pb.loop ? THREE.LoopRepeat : THREE.LoopOnce
    action.clampWhenFinished = !pb.loop
    action.timeScale = pb.timeScale
    action.reset().play()
    action.time = anim.currentTime
  }
}
```

Depends on: `mixer`, `clipMap` from §C; `@atrium/som` `SOMAnimation` API.

**`animCtrl.tick(dt)`** — both consumers call this in the animation frame loop before
`mixer.update(dt)`. `AnimationController.tick` drives `timeupdate` events on
`SOMAnimation`. This is a `@atrium/client` call with no Three.js dependency, but it is
part of the animation reconciliation sequence.

---

#### E. Avatar geometry

**`apps/client/src/app.js` — lines 207–234 (client-only)**

```js
function buildAvatarDescriptor(name) {
  const geo       = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const positions = Array.from(geo.attributes.position.array)
  const normals   = Array.from(geo.attributes.normal.array)
  const indices   = Array.from(geo.index.array)
  geo.dispose()
  const color = [Math.random() * 0.5 + 0.5, …, 1]
  return { translation: [0, 0.7, 0], extras: { displayName: name }, mesh: { primitives: [{…}] } }
}
```

Returns a plain-object glTF node descriptor (no Three.js types escape). Called at
`client.connect(wsUrl, { avatar: buildAvatarDescriptor() })`.

Depends on: Three.js `CapsuleGeometry` only; returns a plain object.

Inspector: no equivalent. The inspector connects with a minimal invisible avatar:
`client.connect(wsUrl, { avatar: { translation: [0, 1.6, 0] } })`.

---

#### F. Background loading

**`tools/som-inspector/src/app.js` — lines 243–266 (reference implementation)**

A single `loadBackground(bg, baseUrl)` function, called from both:
- `world:loaded` handler (with `worldBaseUrl`)
- `som:set` handler (for hot-reload when `__document__` is set)

```js
function loadBackground(bg, baseUrl) {
  if (!bg?.texture) { threeScene.background = null; threeScene.environment = null; return }
  if (bg.type && bg.type !== 'equirectangular') { console.warn(…); return }
  const textureUrl = new URL(bg.texture, baseUrl).href
  const loader = new THREE.TextureLoader()
  loader.load(textureUrl, (texture) => {
    texture.mapping   = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    threeScene.background  = texture
    threeScene.environment = texture
  }, undefined, (err) => console.warn(…))
}
```

Depends on: Three.js `TextureLoader`, `EquirectangularReflectionMapping`, `SRGBColorSpace`;
`threeScene` from §A; `baseUrl` derived from world URL.

**`apps/client/src/app.js` — DIVERGENT. See §2 and §5.**

---

#### G. Camera sync in tick

**Both consumers — WALK / FLY / ORBIT sync block in `tick(now)`:**

```js
if (localNode && cameraNode) {
  if (nav.mode === 'ORBIT') {
    camera.position.set(…localNode.translation…)
    camera.lookAt(…nav.orbitTarget…)
  } else {
    const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), nav.yaw)
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), nav.pitch)
    const hasOffset = Math.abs(cameraNode.translation[2]) > 0.001
    if (hasOffset) {
      // third-person: offset behind avatar
      const offset = new THREE.Vector3(0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z).applyQuaternion(qYaw)
      camera.position.set(avatarPos + offset)
      camera.lookAt(avatarPos.y + 1.0)
      camera.rotateX(pitch)
    } else {
      // first-person: direct yaw+pitch
      camera.position.set(avatarPos)
      camera.quaternion.copy(qYaw).multiply(qPitch)
    }
  }
}
```

Logic is **identical** in both consumers. The first-person branch is reached in
`apps/client` when the V-key sets `avatar.cameraNode.translation = [0, 1.6, 0]`
(no Z offset); the inspector never exercises that branch in practice but has the same
code path.

Depends on: Three.js `Quaternion`, `Vector3`; `nav`, `avatar` from `@atrium/client`
controllers; `camera` from §A.

---

#### H. Pointer bridge call site

Both consumers construct the bridge identically except for `suppressOnCapture`:

| Consumer | Options |
|---|---|
| `apps/client` | `{ client, canvas, camera, sceneRoot: () => sceneGroup, suppressOnCapture: true }` |
| `som-inspector` | `{ client, canvas, camera, sceneRoot: () => sceneGroup, suppressOnCapture: true }` |
| `apps/playground` | `{ client, canvas, camera, sceneRoot: () => sceneGroup, suppressOnCapture: false }` |

Already extracted; call site is a single `new PointerInputBridge({…})` line in each.

---

#### I. LabelOverlay (`apps/client` only)

`apps/client/src/LabelOverlay.js` imports `THREE` for:
- `new THREE.Vector3(t[0], t[1] + LABEL_HEIGHT_OFFSET, t[2])`
- `pos.project(this._camera)` — world-to-NDC projection via the active camera

Takes `somNode` (duck-typed as `{ translation: number[] }`) and the Three.js camera.
Returns DOM `div` elements positioned in CSS. No `@atrium/*` package dependencies.

App-specific: the inspector has no peer-avatar label overlay.

---

## 2. Divergence classification

### Shared touchpoints across `apps/client` and `som-inspector`

| Functional area | `apps/client` | `som-inspector` | Classification |
|---|---|---|---|
| `WebGLRenderer` construction | `antialias: true`, pixelRatio, shadowMap | identical | **Identical** |
| Scene background color | `0x1a1a2e` (dark blue) | `0x111111` (near-black) | **App-specific** (aesthetic choice) |
| Lighting (ambient + directional) | `AmbientLight(0xffffff, 0.6)`, `DirectionalLight(0xffffff, 1.2)`, `sun.position.set(5,10,5)`, `castShadow` | identical | **Identical** |
| Grid helper colors | `0x333333, 0x222222` | `0x1e293b, 0x0f172a` | **App-specific** (aesthetic) |
| Camera FOV / near / far | `PerspectiveCamera(70, 1, 0.01, 1000)` | identical | **Identical** |
| Camera initial position | `(0, 1.6, 4)` avatar eye height | `(0, 5, 10)` overhead | **App-specific** (different default views) |
| Canvas focusability | identical | identical | **Identical** |
| `onResize()` | identical | identical | **Identical** |
| `initDocumentView()` | identical | identical | **Identical** |
| `buildClipsFromSOM()` | identical | identical | **Identical** |
| `initAnimations()` | identical except `[app]` log prefix | identical except `[inspector]` log prefix | **Identical** (prefix trivial) |
| `mixer.addEventListener('finished')` | identical | identical | **Identical** |
| `animCtrl.on('animation:play')` | identical except `[app]` log prefix | identical except `[inspector]` log prefix | **Identical** |
| `animCtrl.on('animation:pause')` | identical | identical | **Identical** |
| `animCtrl.on('animation:stop')` | identical | identical | **Identical** |
| `animCtrl.on('animation:playback-changed')` | identical | identical | **Identical** |
| `replayPlayingAnimations()` | has extra log at function entry: `console.log('[app] replayPlayingAnimations — animations:', som.animations.length, 'mixer:', !!mixer)` | no entry log | **Divergent** — client has diagnostic log inspector lacks. Looks like debugging residue, not intentional. |
| Camera sync in tick (ORBIT+WALK/FLY) | identical | identical | **Identical** |
| `mixer.update(dt)` in tick | identical | identical | **Identical** |
| `animCtrl.tick(dt)` in tick | identical | identical | **Identical** |
| Background loading | **DIVERGENT — see below** | **DIVERGENT — see below** | **Divergent** — significant |
| `NavigationController` initial mode | `'WALK'`, mouseSensitivity `0.002` | `'ORBIT'`, mouseSensitivity `0.005` | **App-specific** (intentional) |
| `PointerInputBridge` call site | `suppressOnCapture: true` | `suppressOnCapture: true` | **Identical** |

---

### Background loading — full divergence documentation

This is the most significant divergence found.

**`som-inspector` (correct pattern):**

The inspector defines `loadBackground(bg, baseUrl)` as a function and calls it
consistently from two sites:
1. `world:loaded` handler: `loadBackground(client.som.extras?.atrium?.background, worldBaseUrl)`
2. `som:set` handler: `loadBackground(client.som.extras?.atrium?.background, worldBaseUrl)`

Both sites go through the same code path. If the function changes, both callers benefit.

**`apps/client` (broken pattern):**

`apps/client` defines a `loadBackground(bg, baseUrl)` function at lines 363–386.
That function is called **only** from the `som:set` handler (hot-reload path).

In `world:loaded`, instead of calling `loadBackground()`, the app has a **second inline
copy** of the same logic at lines 408–432:

```js
// world:loaded handler (apps/client, lines 408–432):
const extras = client.som.document.getRoot().getExtras()    // ← different access pattern
const bg = extras?.atrium?.background
if (bg?.texture) {
  if (bg.type && bg.type !== 'equirectangular') {
    console.warn(…)
  } else {
    const worldUrl    = worldUrlInput.value.trim()            // ← re-reads the input
    const absWorldUrl = new URL(worldUrl, …).href
    const baseUrl     = absWorldUrl.substring(…)
    const textureUrl  = new URL(bg.texture, baseUrl).href
    const loader = new THREE.TextureLoader()
    loader.load(textureUrl, (texture) => {
      texture.mapping   = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace
      threeScene.background  = texture
      threeScene.environment = texture
    }, undefined, (err) => console.warn(…))
  }
}
```

The `loadBackground()` function (referenced in `som:set`) uses `worldBaseUrl` (a module
variable set earlier in `world:loaded`). The inline version in `world:loaded` re-derives
`baseUrl` from `worldUrlInput.value` directly. These should be equivalent, but the
inline version uses `somDocument.document.getRoot().getExtras()` while the function
uses `client.som.extras` — a different accessor path to the same data.

**Assessment:** This is **copy-paste drift** — the function and the inline block are
supposed to do the same thing and currently do, but they can diverge independently. This
is a pre-existing bug, not introduced by Session 35. The `worldBaseUrl` variable in
`world:loaded` is computed before the background loading block, so switching the inline
block to call `loadBackground()` instead should be straightforward — but it is an
`apps/client`-only fix, not extraction work.

---

## 3. Dependency and ordering notes

### Initialization order within `world:loaded`

Both consumers call their animation machinery in the same order:
```
initDocumentView(client.som)   // 1. sceneGroup must exist before mixer is created
initAnimations()               // 2. builds clipMap + mixer (requires sceneGroup)
replayPlayingAnimations(...)   // 3. starts any already-playing animations (requires mixer + clipMap)
```

This order is a hard constraint: `initAnimations()` creates `mixer = new THREE.AnimationMixer(sceneGroup)`,
so `initDocumentView` must run first to populate `sceneGroup`. `replayPlayingAnimations`
must run after `initAnimations` to have `mixer` and `clipMap` available.

### AnimationController handler ordering (noted in canonical handoff)

`AnimationController` is constructed at module level and registers its own internal
`world:loaded` listener at construction time. The app's `world:loaded` listener
(which calls `initAnimations`) is registered later. Therefore:
- `AnimationController`'s internal `world:loaded` handler fires **first**
- The app's `initAnimations()` fires **second**

In the current implementation this is safe: `AnimationController` processes the world
state for animation tracking; `initAnimations` sets up the Three.js mixer independently.
The `animCtrl.on('animation:play', …)` handlers guard with `if (!mixer) return`, so any
play events that fire before `initAnimations()` runs are silently dropped. In practice this
window does not occur because `AnimationController` only emits `animation:play` in response
to SOM animation:play events, not on `world:loaded`. However, if that assumption breaks,
animations would silently not start.

The canonical doc flags this ordering constraint. It should be preserved (or made explicit)
in any extraction.

### `sceneGroup` as a shared mutable reference

`sceneGroup` is populated by `initDocumentView` and consumed by:
- `initAnimations` (passed to `THREE.AnimationMixer`)
- `PointerInputBridge` (via getter `() => sceneGroup`)
- drag-to-translate handlers (via `sceneGroup?.getObjectByName(node.name)`)

Any extraction that wraps `initDocumentView` needs to expose `sceneGroup` to all three
consumers, or otherwise route the reference.

### `clipMap` as a shared mutable reference

`clipMap` is populated by `initAnimations` and consumed by all four `animCtrl` event
handlers and by `replayPlayingAnimations`. All are in the same module scope; extraction
must keep them co-located or pass `clipMap` explicitly.

### Natural seam: `initDocumentView` vs animation setup

`initDocumentView` has no Three.js animation dependencies — it just creates the
`DocumentView` and `sceneGroup`. Conceptually it is a DocumentView wiring concern (§B),
not animation (§C). This means the DocumentView setup and animation setup could be
extracted as separate units, or together.

### Natural seam: `buildClipsFromSOM` is pure

`buildClipsFromSOM(somDocument)` takes a `SOMDocument` and returns `THREE.AnimationClip[]`.
It has no side effects and no dependency on `sceneGroup`, `mixer`, or module state.
It is the cleanest extraction candidate in the animation block — could be a pure function
exported from an extended `packages/renderer-three/` or a new package.

---

## 4. Recommended extraction phasing

### Overall shape

The animation machinery (§C + §D) is the most valuable extraction: it is identical
between both consumers, it is the most intricate runtime flow, and it is the duplication
the canonical doc explicitly calls out. DocumentView wiring (§B) is small and simple;
it can travel with animation or independently.

The bootstrap (§A) is mostly app-specific configuration (colors, camera position, initial
mode) with a thin layer of identical boilerplate underneath. Extracting it produces a
module with many configuration knobs that differs mostly in its defaults — lower value
than animation.

**Recommendation: phase into two sessions.**

### Phase 1 — Animation + DocumentView extraction (one session, medium)

Extract the following into `packages/renderer-three/`:

1. `buildClipsFromSOM(somDocument)` — pure function, easy win.
2. `initDocumentView(renderer, threeScene, somDocument)` → returns `{ docView, sceneGroup }`.
   (Or a factory class that holds state.)
3. `initAnimations(som, sceneGroup, client)` → returns `{ mixer, clipMap }` or a
   `AnimationBridge` class that wraps them.
4. `replayPlayingAnimations(som, mixer, clipMap)` — pure function given the above.
5. The four `animCtrl.on(…)` handler bodies — can be methods on `AnimationBridge` or
   passed as a setup function.
6. `mixer.update(dt)` call remains in the app tick (one line; no benefit to wrapping).
7. `loadBackground()` — straightforward extract; fixes the apps/client duplication bug
   as a side effect.

The extraction seam already exists: both consumers call `initDocumentView`,
`initAnimations`, `replayPlayingAnimations` in the same order with the same inputs.
No divergences require design decisions before extracting these.

The `animCtrl` event handlers and their dependency on `mixer`/`clipMap` are the one
tricky part: they must be wired after `initAnimations` creates those objects. An
`AnimationBridge` class that encapsulates `mixer`, `clipMap`, the four handlers, and
`replayPlayingAnimations` as a method would contain all this coupling in one place.

### Phase 2 — Bootstrap + camera sync (separate session, if desired)

Bootstrap and camera sync are smaller payoffs for more configuration surface:

- Scene/renderer bootstrap has meaningful app-specific values (background color, grid
  colors, camera position, initial nav mode). A factory that takes config is feasible
  but increases `packages/renderer-three/` surface area significantly.
- Camera sync logic is identical but tightly coupled to `NavigationController` API
  (`nav.yaw`, `nav.pitch`, `nav.orbitTarget`). Extracting it requires deciding whether
  `NavigationController` should move to `renderer-three` or whether camera sync
  stays in the app layer.
- `LabelOverlay` is `apps/client`-specific and low-priority.
- `buildAvatarDescriptor` is `apps/client`-specific and genuinely not shared.

**Verdict:** Phase 2 is optional. The canonical doc's "AnimationMixer / AvatarController
modular review" note suggests the animation path is the intended target; bootstrap and
camera sync are bonus.

---

## 5. Surprises / risks

### S1 — `apps/client` background loading duplication (pre-existing bug)

`apps/client` defines `loadBackground()` but does not call it from `world:loaded`,
instead inlining a second copy. The two paths currently produce the same output but
can drift. Not a regression from Session 35; a pre-existing copy-paste bug. The extraction
session should fix it as part of wiring `apps/client` to the extracted function.

### S2 — `replayPlayingAnimations` extra diagnostic log in `apps/client`

`apps/client` adds `console.log('[app] replayPlayingAnimations — animations:', som.animations.length, 'mixer:', !!mixer)` that the inspector omits. This is probably debugging residue from Sessions 28–31. Worth removing from `apps/client` before extraction rather than baking it into the shared function.

### S3 — `buildClipsFromSOM` does not handle `weights` (morph targets)

Neither consumer handles `targetPath === 'weights'`. Three.js `NumberKeyframeTrack`
would be the equivalent. Not a blocker for extraction, but a known gap if content with
morph targets is loaded.

### S4 — `mixer` is only created when clips exist

```js
if (clips.length > 0) {
  mixer = new THREE.AnimationMixer(sceneGroup)
  …
}
```

If a world has no animations, `mixer` stays `null`. The `animCtrl.on('animation:play')`
handlers guard with `if (!mixer) return`. This means: if a world without animations is
loaded, then through some mechanism (e.g. `som:add` adding an animated node) an
`animation:play` event fires, it will be silently dropped. This is an existing behavioral
edge case in both consumers. The extraction should preserve the guard (not resolve it).

### S5 — `apps/playground` uses `THREE.Vector3` in drag callbacks

The playground's `onNodeMouseDown` and `onNodeMouseMove` call
`threeObj.getWorldPosition(new THREE.Vector3())`. These are inline in the playground
`app.js` and are not shared with the other consumers. The drag math itself uses
`projectRayToPlane` and `computeParentInverse` from the already-extracted `renderer-three`.
No surprise here; just noting the playground retains a small amount of inline Three.js
that is playground-specific.

### S6 — `LabelOverlay` has no `@atrium/*` import

`LabelOverlay.js` uses `somNode.translation` via duck-typing (no import of `SOMNode`).
It is purely a DOM + Three.js concern. If it were ever to be extracted, it would sit in
`packages/renderer-three/` naturally — but it is `apps/client`-specific and low priority.

### S7 — `animCtrl.on(…)` handlers are attached at module load, before `world:loaded`

The handlers are live before any world is loaded. They guard `if (!mixer) return`, so
they are safe. However, they close over `clipMap` (a module-level `Map`). If extraction
produces an `AnimationBridge` class, the handlers must reference the *instance's*
`clipMap`, not a module global. This is a closure vs. instance-method distinction that
the extraction brief must resolve.

### S8 — No `dispatchPointerEvent` on non-geometry events in both consumers

This was already noted in the canonical doc and in the pointer bridge. Not new, just
confirmed: the bridge dispatches `pointermove`/`pointerup` with `node: null` for
off-geometry events; handlers that fire on `null` dispatch are global-state effects.
Not relevant to the animation extraction but logged for completeness.

---

## Appendix — File × Three.js usage matrix

| File | THREE imports used |
|---|---|
| `apps/client/src/app.js` | `WebGLRenderer`, `Scene`, `Color`, `AmbientLight`, `DirectionalLight`, `GridHelper`, `PerspectiveCamera`, `AnimationMixer`, `AnimationClip`, `QuaternionKeyframeTrack`, `VectorKeyframeTrack`, `TextureLoader`, `EquirectangularReflectionMapping`, `SRGBColorSpace`, `CapsuleGeometry`, `Quaternion`, `Vector3`, `LoopRepeat`, `LoopOnce` |
| `apps/client/src/LabelOverlay.js` | `Vector3` |
| `tools/som-inspector/src/app.js` | same as apps/client minus `CapsuleGeometry`, `LabelOverlay`; adds nothing new |
| `apps/playground/src/app.js` | `WebGLRenderer`, `Scene`, `Color`, `AmbientLight`, `DirectionalLight`, `GridHelper`, `PerspectiveCamera`, `Vector3` (drag callback only) |
| `packages/renderer-three/src/PointerInputBridge.js` | `Raycaster`, `Vector2` |
| `packages/renderer-three/src/drag-math.js` | `Vector3`, `Matrix4` (via matrixWorld) |
| `packages/renderer-three/src/hit-test.js` | none |
| `tools/som-inspector/src/TreeView.js` | none |
| `tools/som-inspector/src/PropertySheet.js` | none |
| `tools/som-inspector/src/WorldInfoPanel.js` | none |
| `tools/som-inspector/src/AnimationsPanel.js` | none |
| `packages/client/`, `packages/som/`, `packages/server/`, `packages/protocol/`, `packages/interaction/` | none (confirmed) |
