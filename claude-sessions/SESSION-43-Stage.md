# SESSION-43 · Stage — Design Brief

## Goal

Introduce a `Stage` class in `packages/renderer-three` that absorbs the
replicated Three.js setup and tick logic currently copy-pasted across
`apps/client`, `tools/som-inspector`, and `apps/playground`.

`Stage` is a Tier C tenant of `packages/renderer-three`, alongside
`AnimationBridge` and `PointerInputBridge`. It is Three.js-specific; no
abstract base class is needed yet.

---

## Non-goals (explicit)

- SOMCamera reconciliation — deferred to a future session. The Three.js
  camera is driven entirely by avatar/nav state, as today.
- Any changes to protocol, SOM, or server packages.
- Render loop ownership — `requestAnimationFrame` stays in each app.
- `LabelOverlay` or any other app-specific tick concern — Stage does not
  own these; apps call them after `stage.tick()`.
- Pointer input wiring (`PointerInputBridge`) — not part of Stage; apps
  wire this themselves as today.

---

## Where Stage Lives

```
packages/renderer-three/src/Stage.js          ← new file
packages/renderer-three/src/index.js          ← add Stage to exports
packages/renderer-three/tests/stage.test.js   ← new test file
```

No other packages change.

---

## Constructor

```javascript
new Stage(container, options)
```

### Parameters

**`container`** — `HTMLElement`. Stage appends `renderer.domElement` to it.

**`options`** — all optional:

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `client` | `AtriumClient` | `null` | Required for controllers |
| `cameraOffsetY` | number | `2.0` | Passed to `AvatarController` |
| `cameraOffsetZ` | number | `4.0` | Passed to `AvatarController` |
| `nav` | boolean | `true` | Whether to create `NavigationController` |
| `navMode` | string | `'WALK'` | Initial nav mode |
| `navMouseSensitivity` | number | `0.002` | Nav mouse sensitivity |
| `animCtrl` | boolean | `true` | Whether to create `AnimationController` |
| `animBridge` | boolean | `true` | Whether to create `AnimationBridge` |
| `backgroundColor` | number (hex) | `0x111111` | `THREE.Scene` background color |
| `cameraFov` | number | `70` | PerspectiveCamera fov |
| `cameraNear` | number | `0.01` | PerspectiveCamera near |
| `cameraFar` | number | `1000` | PerspectiveCamera far |
| `cameraPosition` | `[x,y,z]` | `[0, 5, 10]` | Initial camera position |
| `antialias` | boolean | `true` | WebGLRenderer antialias |
| `shadows` | boolean | `true` | WebGLRenderer shadowMap.enabled |
| `grid` | boolean | `true` | Whether to add GridHelper |
| `ambientLightColor` | number | `0xffffff` | Ambient light color |
| `ambientLightIntensity` | number | `0.6` | Ambient light intensity |
| `sunColor` | number | `0xffffff` | Directional light color |
| `sunIntensity` | number | `1.2` | Directional light intensity |
| `sunPosition` | `[x,y,z]` | `[5, 10, 5]` | Directional light position |

### Construction order (internal)

1. Create `THREE.WebGLRenderer`, set pixel ratio, shadow map, append to
   container.
2. Configure canvas: `tabindex='0'`, `outline: none`,
   `pointerdown → canvas.focus()`.
3. Create `THREE.Scene` with background color, ambient light, directional
   light (with `castShadow = true`), and (if `grid`) `GridHelper(40, 40,
   0x1e293b, 0x0f172a)`.
4. Create `THREE.PerspectiveCamera` at `cameraPosition`.
5. If `client` provided:
   a. Create `AvatarController(client, { cameraOffsetY, cameraOffsetZ })`.
   b. If `nav`: create `NavigationController(avatar, { mode: navMode,
      mouseSensitivity: navMouseSensitivity })`.
   c. If `animCtrl`: create `AnimationController(client)`.
   d. `AnimationBridge` cannot be constructed here — it requires
      `sceneGroup` from `initDocumentView`, which only exists after
      `world:loaded`. If `animBridge` is true and both `client` and
      `animCtrl` are present, Stage registers a one-time `world:loaded`
      listener on `client` that constructs `AnimationBridge(sceneGroup,
      client, this._animCtrl)`. The app must call `stage.setSceneGroup(sg)`
      from its own `world:loaded` handler (see API below), OR Stage can
      obtain `sceneGroup` via that listener if the app passes it — see
      "AnimationBridge deferral" below.
6. If `client` not provided, all controller properties are `null`.

### AnimationBridge deferral

`AnimationBridge` needs `sceneGroup` (the `THREE.Object3D` returned by
`initDocumentView`). Stage cannot obtain this on its own — it doesn't call
`initDocumentView`. The app calls `initDocumentView` in its `world:loaded`
handler and then must hand the result to Stage.

API:

```javascript
stage.setSceneGroup(sceneGroup)
```

Call this from the app's `world:loaded` handler, after `initDocumentView`.
If `animBridge` was `true` at construction and `animCtrl` exists, Stage
constructs `AnimationBridge` at this point. Calling `setSceneGroup` when
`animBridge` was `false` or `animCtrl` is absent is a no-op.

---

## Public API

```javascript
// Read-only accessors — Three.js objects
stage.renderer   // THREE.WebGLRenderer
stage.scene      // THREE.Scene
stage.camera     // THREE.PerspectiveCamera

// Read-only accessors — controllers (null if not created)
stage.avatar     // AvatarController | null
stage.nav        // NavigationController | null
stage.animCtrl   // AnimationController | null
stage.animBridge // AnimationBridge | null

// Called once after world:loaded, when sceneGroup is available
stage.setSceneGroup(sceneGroup)

// Called every frame from the app's rAF loop
stage.tick(dt)

// Called when the viewport is resized
stage.resize(width, height)
```

---

## `stage.tick(dt)`

Performs, in order, with null-checks on every controller:

```javascript
if (this._nav)       this._nav.tick(dt)
if (this._animCtrl)  this._animCtrl.tick(dt)
if (this._animBridge) this._animBridge.update(dt)
// camera sync (see below)
this._renderer.render(this._scene, this._camera)
```

### Camera sync (extracted from `apps/client/src/app.js`)

Runs after controller ticks, before render. Full null-safe version of the
existing camera sync block. Requires both `this._avatar` and `this._nav`
to be non-null; if either is absent, skips camera sync entirely (camera
stays wherever the app last placed it).

```javascript
_syncCamera() {
  if (!this._avatar || !this._nav) return

  const localNode  = this._avatar.localNode
  const cameraNode = this._avatar.cameraNode
  if (!localNode || !cameraNode) return

  if (this._nav.mode === 'ORBIT') {
    const pos = localNode.translation ?? [0, 0, 0]
    this._camera.position.set(pos[0], pos[1], pos[2])
    const t = this._nav.orbitTarget
    this._camera.lookAt(t[0], t[1], t[2])
  } else {
    const yaw    = this._nav.yaw
    const pitch  = this._nav.pitch
    const qYaw   = new THREE.Quaternion().setFromAxisAngle(
                     new THREE.Vector3(0, 1, 0), yaw)
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
                     new THREE.Vector3(1, 0, 0), pitch)
    const avatarPos  = localNode.translation  ?? [0, 0, 0]
    const camOffset  = cameraNode.translation ?? [0, 0, 0]
    const hasOffset  = Math.abs(camOffset[2]) > 0.001

    if (hasOffset) {
      const offset = new THREE.Vector3(
        0,
        this._avatar._cameraOffsetY,
        this._avatar._cameraOffsetZ
      )
      offset.applyQuaternion(qYaw)
      this._camera.position.set(
        avatarPos[0] + offset.x,
        avatarPos[1] + offset.y,
        avatarPos[2] + offset.z,
      )
      const lookTarget = new THREE.Vector3(
        avatarPos[0], avatarPos[1] + 1.0, avatarPos[2])
      this._camera.lookAt(lookTarget)
      this._camera.rotateX(pitch)
    } else {
      this._camera.position.set(avatarPos[0], avatarPos[1], avatarPos[2])
      this._camera.quaternion.copy(qYaw).multiply(qPitch)
    }
  }
}
```

> **Note:** `_cameraOffsetY` and `_cameraOffsetZ` are accessed from
> `this._avatar` rather than stored separately on Stage, since
> `AvatarController` already owns them.

---

## `stage.resize(width, height)`

```javascript
resize(width, height) {
  this._renderer.setSize(width, height)
  this._camera.aspect = width / height
  this._camera.updateProjectionMatrix()
}
```

Apps should call this from their `ResizeObserver` or `window.resize`
handler, as today.

---

## Tests (`packages/renderer-three/tests/stage.test.js`)

Tests run under `node --test`. Three.js is not available in Node — use the
same lightweight stub approach used by existing `renderer-three` tests (read
those tests first to match the pattern).

Cover:

1. **Construction — no client.** `new Stage(container)` produces non-null
   `renderer`, `scene`, `camera`; all controllers are `null`.
2. **Construction — with client, all controllers enabled.**  `avatar`,
   `nav`, `animCtrl` are non-null; `animBridge` is null (deferred).
3. **Construction — nav: false.** `nav` is null; `avatar` and `animCtrl`
   still constructed.
4. **Construction — animCtrl: false.** `animCtrl` and `animBridge` are
   null even after `setSceneGroup`.
5. **`setSceneGroup` constructs AnimationBridge** when `animBridge: true`
   and `animCtrl` exists.
6. **`setSceneGroup` is a no-op** when `animBridge: false`.
7. **`tick()` is null-safe** — calling `tick(0.016)` with no controllers
   does not throw.
8. **`tick()` calls controller methods** when controllers are present —
   verify `nav.tick`, `animCtrl.tick`, `animBridge.update` are called.
9. **`resize()` updates camera aspect** and calls
   `updateProjectionMatrix`.
10. **Camera sync skipped** when `avatar` is null.
11. **Camera sync skipped** when `localNode` is null.
12. **ORBIT camera sync** — verify `camera.position` and `lookAt` are
    called from ORBIT branch.
13. **WALK third-person camera sync** — verify position offset applied
    when `camOffset[2] > 0.001`.
14. **WALK first-person camera sync** — verify quaternion path taken when
    `camOffset[2] ≈ 0`.

---

## App Migration

After Stage is implemented and tested, migrate the three consumers. Each
migration is a small focused change — remove the duplicated setup block and
tick internals, replace with Stage.

### `apps/client/src/app.js`

**Before (setup, in mainline):**
```javascript
const renderer = new THREE.WebGLRenderer({ antialias: true })
// ... (full setup block from handoff)
const CAMERA_OFFSET_Y = 2.0
const CAMERA_OFFSET_Z = 4.0
```

**After:**
```javascript
const stage = new Stage(viewportEl, {
  client,
  cameraOffsetY: 2.0,
  cameraOffsetZ: 4.0,
})
const { renderer, scene: threeScene, camera, nav, animCtrl } = stage
```

**Before (tick internals):**
```javascript
nav.tick(dt)
animCtrl.tick(dt)
if (animBridge) animBridge.update(dt)
// ... camera sync block ...
renderer.render(threeScene, camera)
```

**After:**
```javascript
stage.tick(dt)
labels.update()   // app-specific — stays here, after stage.tick()
```

**world:loaded handler** — add `stage.setSceneGroup(sceneGroup)` call.

**ResizeObserver** — replace manual resize logic with `stage.resize(w, h)`.

### `tools/som-inspector/src/app.js`

Same pattern. No `LabelOverlay`, so tick becomes just `stage.tick(dt)`.
No `animBridge` needed if inspector doesn't use it — pass `animBridge:
false` if that's the case (read the existing code to confirm).

### `apps/playground/src/app.js` (or equivalent)

Simpler — no nav controller. Pass `nav: false, animCtrl: false,
animBridge: false`. Tick becomes just `stage.tick(dt)`.

---

## Files Expected to Change

| File | Change |
|------|--------|
| `packages/renderer-three/src/Stage.js` | **New** |
| `packages/renderer-three/src/index.js` | Export `Stage` |
| `packages/renderer-three/tests/stage.test.js` | **New** |
| `apps/client/src/app.js` | Migrate to Stage |
| `tools/som-inspector/src/app.js` | Migrate to Stage |
| `apps/playground/index.html` or `app.js` | Migrate to Stage |

## Files That Must Not Change

- Any file under `packages/protocol/`
- Any file under `packages/som/`
- Any file under `packages/server/`
- Any file under `packages/client/`
- Any file under `packages/interaction/`
- `tests/` (fixture files, client SOM copy)

---

## Implementation Order

1. Read existing `packages/renderer-three/src/` and `tests/` to understand
   current file shape and stub patterns before writing anything.
2. Write `Stage.js`.
3. Export from `index.js`.
4. Write `stage.test.js` — all tests passing before migration begins.
5. Migrate `apps/client/src/app.js`.
6. Migrate `tools/som-inspector/src/app.js`.
7. Migrate `apps/playground`.
8. Run full test suite — confirm count is ≥ 410 + new Stage tests.
9. Smoke test `apps/client` and `tools/som-inspector` manually against a
   running world server.

---

## Stop-and-Flag Conditions

Stop and report (do not auto-fix) if:

- Any existing test count drops below its Session 42 baseline.
- The three consumer apps have setup or tick patterns materially different
  from what this brief describes — flag the diff rather than silently
  absorbing it.
- `AvatarController._cameraOffsetY` / `_cameraOffsetZ` are not accessible
  from Stage (e.g. renamed or made truly private) — flag rather than
  hardcoding fallback values.
- `initDocumentView` returns something other than a `THREE.Object3D` /
  scene group — flag before wiring `AnimationBridge`.

---

## Acceptance Criteria

- `Stage` class exists in `packages/renderer-three`, exported from index.
- All 14 Stage tests pass.
- Total test count across all packages ≥ 424 (410 + 14).
- `apps/client`, `tools/som-inspector`, and `apps/playground` no longer
  contain the duplicated Three.js setup block or duplicated tick internals.
- `apps/client` renders correctly and nav/animation work after migration.
- `tools/som-inspector` renders correctly after migration.
- No regressions in any other package test suite.
