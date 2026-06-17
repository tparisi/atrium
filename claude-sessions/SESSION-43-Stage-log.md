# Session 43 — Stage — Build Log

**Date:** 2026-06-17
**Branch:** main
**Status:** Complete

---

## Summary

Introduced a `Stage` class in `packages/renderer-three` that absorbs the
replicated Three.js setup, resize, and tick logic previously copy-pasted across
`apps/client`, `tools/som-inspector`, and `apps/playground`.

1. `Stage.js` — new class owning renderer, scene, camera, and all controllers
2. `index.js` — `Stage` added to `@atrium/renderer-three` exports
3. `stage.test.js` — 15 new tests (brief targeted 14; one was naturally split into two)
4. `apps/client/src/app.js` — migrated to Stage
5. `tools/som-inspector/src/app.js` — migrated to Stage
6. `apps/playground/src/app.js` — migrated to Stage

**New total: 425 tests** (410 baseline + 15 new Stage tests).

---

## Files Changed

| File | Change |
|---|---|
| `packages/renderer-three/src/Stage.js` | **New** |
| `packages/renderer-three/src/index.js` | Added `Stage` export |
| `packages/renderer-three/tests/stage.test.js` | **New** — 15 tests |
| `apps/client/src/app.js` | Migrated to Stage |
| `tools/som-inspector/src/app.js` | Migrated to Stage |
| `apps/playground/src/app.js` | Migrated to Stage |

### No changes in

- `packages/protocol/`, `packages/som/`, `packages/server/`
- `packages/client/`, `packages/interaction/`
- `tests/` (fixtures, client SOM copy)

---

## Implementation Details

### Stage.js

Constructor accepts `container` and an options object. All Three.js setup is
internal; the `_renderer`, `_AvatarCtor`, `_NavCtor`, `_AnimCtrlCtor`, and
`_AnimBridgeCtor` underscore-prefixed options allow test injection without
WebGL.

**Controller construction order:**
1. `THREE.WebGLRenderer` (or injected mock) — pixel ratio, shadow map, canvas
   focusability
2. `THREE.Scene` — background, ambient light, directional light (castShadow),
   optional GridHelper
3. `THREE.PerspectiveCamera` at `cameraPosition`
4. If `client` provided: AvatarController, NavigationController (if `nav: true`),
   AnimationController (if `animCtrl: true`)
5. AnimationBridge deferred to `setSceneGroup()`

**`setSceneGroup(sceneGroup)`** — disposes any previous bridge, constructs a
new `AnimationBridge`, and calls `init()` + `replayPlayingAnimations()` if
`client.som` is already available. No-op if `animBridge: false` or `animCtrl`
is absent.

**`tick(dt)`** — calls `nav.tick`, `animCtrl.tick`, `animBridge.update` (all
null-safe), then `_syncCamera()`, then `renderer.render`.

**`resize(width, height)`** — calls `renderer.setSize(w, h)`, updates
`camera.aspect`, calls `updateProjectionMatrix`.

**`_syncCamera()`** — extracted verbatim from `apps/client/src/app.js`. Reads
`nav.mode` to branch between ORBIT (lookAt orbit target) and WALK
(third-person offset vs. first-person quaternion). Both `avatar` and `nav`
must be non-null; returns early otherwise.

### Test design

`node --test` with zero WebGL dependencies. `THREE.WebGLRenderer` is replaced
by a lightweight `makeRenderer()` stub injected via `_renderer`. Other THREE
classes (Scene, PerspectiveCamera, Quaternion, Vector3, Color, etc.) work fine
in Node and are used directly — no mocking needed.

Four controller stub factories: `makeAvatarCtor`, `makeNavCtor`,
`makeAnimCtrlCtor`, `makeAnimBridgeCtor`. Each takes an options object and
returns a constructor class, making them spy-capable for call tracking.

### apps/client/src/app.js migration

- Removed: `AvatarController`, `NavigationController`, `AnimationController`,
  `AnimationBridge` imports
- Moved `const client = new AtriumClient()` before Stage (Stage needs client
  at construction)
- Replaced the 27-line THREE setup block + CAMERA_OFFSET_Y/Z with Stage
  construction (12 lines including extraction of renderer, scene, camera,
  nav, animCtrl, avatar, canvas)
- `CAMERA_OFFSET_Y/Z` retained as local constants for the V-key
  first/third-person toggle (`avatar.cameraNode.translation`)
- Resize handler: 6 lines → `stage.resize(w, h)`
- `animBridge` state variable removed
- `world:loaded`: 4-line animBridge disposal+creation+init+replay → 1-line
  `stage.setSceneGroup(sceneGroup)` call
- Tick: 50-line nav+animCtrl+animBridge+camera-sync+render block → 2 lines
  (`stage.tick(dt)` + `labels.update()`)

### tools/som-inspector/src/app.js migration

Same pattern. Non-default Stage options: `navMode: 'ORBIT'`,
`navMouseSensitivity: 0.005`. All other values match Stage defaults exactly
(bg `0x111111`, camera `[0, 5, 10]`, grid `0x1e293b, 0x0f172a`).
No `LabelOverlay`, so tick reduces to just `stage.tick(dt)`.

### apps/playground/src/app.js migration

Simplest case: `nav: false, animCtrl: false, animBridge: false,
cameraFov: 60, cameraPosition: [0, 6, 10]`. Stage created before the
`AtriumClient` (no client dependency needed). After camera position is set by
Stage, `stage.camera.lookAt(0, 0, 0)` restores the original fixed-camera
orientation. The playground's own `initDocumentView` function (using
`@gltf-transform/view` `DocumentView` directly) is unchanged; it uses
`renderer` and `threeScene` from the Stage extraction. Tick becomes
`stage.tick(0)` (no dt tracking needed; no controllers consume dt).

---

## Cosmetic Diffs Noted (not stop-and-flag)

- **Grid colors** in `apps/client`: original used `0x333333, 0x222222`; Stage
  uses `0x1e293b, 0x0f172a`. Stage wins — no grid color override option exists.
- **`setSize` third argument**: all apps previously called `setSize(w, h, false)`
  to suppress CSS style updates; Stage's `resize()` calls `setSize(w, h)`
  without the flag. Following the brief exactly.

---

## Test Results

| Package | Tests | Pass | Delta |
|---|---|---|---|
| `@atrium/protocol` | 55 | 55 | 0 |
| `@atrium/som` | 176 | 176 | 0 |
| `@atrium/server` | 32 | 32 | 0 |
| `@atrium/client` | 106 | 106 | 0 |
| `@atrium/renderer-three` | 47 | 47 | +15 |
| `@atrium/interaction` | 9 | 9 | 0 |
| **Total** | **425** | **425** | **+15** |

Baseline 410 + 15 new = **425**. All 410 baseline tests still pass.

Note: `packages/gltf-extension` has no test files and fails with "Could not
find test/*.test.js" — this failure predates Session 43 and is unrelated.

---

## Acceptance Criteria — Status

- [x] `Stage` class exists in `packages/renderer-three`, exported from index
- [x] All Stage tests pass (15 of 15)
- [x] Total test count across all packages = 425 ≥ 424 (brief target)
- [x] `apps/client` no longer contains duplicated Three.js setup block or tick internals
- [x] `tools/som-inspector` no longer contains duplicated Three.js setup block or tick internals
- [x] `apps/playground` no longer contains duplicated Three.js setup block
- [x] No regressions in any other package test suite
- [ ] Manual smoke test (`apps/client`, `tools/som-inspector` against live server)
