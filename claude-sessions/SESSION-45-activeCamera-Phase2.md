<!-- SPDX-License-Identifier: CC0-1.0 -->
# Session 45 Brief — `activeCamera` Phase 2: Real Per-Camera Three.js Objects

## Context

Session 44 shipped `activeCamera` Phase 1 as a deliberate scaffold:
`Stage.setActiveCamera` reads a host node's world transform once at switch
time, seeds `NavigationController` from it, and copies lens values into a
single mutable `this._camera`. This does not follow animated/moved camera
host nodes, and a separate bug (stale destructured `camera` reference in
`apps/client/src/app.js`) causes broken perspective/orthographic cycling.

This session replaces the seed-and-copy model with **real, persistent
Three.js camera objects, one per `SOMCamera`, parented into the live scene
graph under their host node's `Object3D`.** This makes animated-camera
following automatic (via the normal `updateMatrixWorld()` cascade) and
turns `setActiveCamera` into a reference swap instead of a copy.

**This brief explicitly punts on:**
- Animated/moving camera host nodes actually being bound while in motion
  (the mechanism will support it structurally, but per-tick ORBIT
  world-to-local re-derivation for a *moving* parent is not required to
  work correctly this session — only for a static parent).
- Free-look while bound to a camera (nav offset vs. pure ride-along).
- ORBIT correctness under a parent that rotates after bind time.

These are real follow-on work, not forgotten — see Non-Goals below.

---

## Design Summary

### 1. Per-camera Three.js object construction

In `Stage.setSceneGroup(sceneGroup)`, after the existing `AnimationBridge`
setup, walk `client.som.cameras`. For each `SOMCamera`:

- Construct a `THREE.PerspectiveCamera` or `THREE.OrthographicCamera`
  based on `camera.type`, with lens values (`yfov`/`znear`/`zfar` or
  `xmag`/`ymag`/`znear`/`zfar`) read from the current `SOMCamera` state.
- Resolve the host node's live `Object3D` via
  `sceneGroup.getObjectByName(camera.node.name)`. If `camera.node` is
  `null` (detached camera) or the lookup fails, skip construction for that
  camera and log a warning — do not throw.
- `hostObject3D.add(threeCamera)` — parent the camera as a child at
  identity local transform (translation `[0,0,0]`, identity rotation).
  This local transform is reserved for nav's offset (see §3) — do not seed
  it from anything at construction time.
- Store the live camera on the `SOMCamera` under **`rawCamera`** (renderer-
  neutral name; not `_threeCamera`). `Stage` is the only writer of this
  property. This is new state on `SOMCamera` — confirm whether `@atrium/som`
  or `@atrium/renderer-three` is the right place for the property
  declaration itself (likely: declared/documented in `@atrium/som` as an
  renderer-populated slot, analogous to how `node` back-reference works,
  but never written to by `@atrium/som` itself).

- Each constructed `THREE.Camera` subscribes to its `SOMCamera`'s
  `mutation` event. On `yfov`/`znear`/`zfar`/`xmag`/`ymag`/`aspectRatio`
  change (perspective or orthographic as appropriate to `event.detail.property`),
  update the corresponding Three.js property and call
  `updateProjectionMatrix()`. This subscription should be torn down
  alongside whatever `setSceneGroup` already tears down for the previous
  `AnimationBridge`, to avoid leaking listeners across reconnect/re-load.

- This resolves the existing Known Issue **"Three.js camera not
  reconciled to SOMCamera mutation state"** as a side effect — call this
  out explicitly in the build log.

### 2. Persistent default Tier-C camera

The existing constructor-time `THREE.PerspectiveCamera` (built from
`cameraFov`/`cameraNear`/`cameraFar`/`cameraPosition` options) becomes a
**persistent object stored for the lifetime of the Stage** — e.g.
`this._defaultCamera`. It is never reconstructed by `setActiveCamera`'s
null path; the null path simply reassigns `this._camera = this._defaultCamera`.
No parenting change for this camera — it remains free-standing, positioned
directly in world space by nav, exactly as today.

### 3. `Stage.setActiveCamera(somCamera)` — rewritten

- **Non-null path:**
  - Guard: if `somCamera.node === null` or `somCamera.rawCamera` is
    undefined (construction skipped per §1), log a warning and do not
    proceed — leave the current `this._camera` and `this._nav.activeCamera`
    unchanged. (Matches existing Session 44 guard intent, just against new
    state.)
  - `this._camera = somCamera.rawCamera` — reference assignment, no
    copying, no type branching, no construction.
  - Seed `NavigationController` from the host node's *current* live world
    transform — reuse the existing decomposition logic from Session 44
    (world position + quaternion → yaw/pitch for WALK/FLY via
    `THREE.Euler('YXZ')`; orbitTarget + radius/azimuth/elevation for
    ORBIT). This seed continues to feed nav's per-tick world-space
    computation (§4) rather than being a one-time camera write.
  - `this._nav.activeCamera = somCamera`.
- **Null path:**
  - `this._camera = this._defaultCamera`.
  - `this._nav.activeCamera = null`.
  - No lens reconstruction, no `_cameraFov`/`_cameraNear`/`_cameraFar`
    stored-option copying — that pattern is fully retired.

### 4. `_syncCamera()` — generalized world-to-local conversion

Nav's internal computation **does not change**. It continues to produce a
world-space eye transform every tick from its yaw/pitch/position (WALK/FLY)
or orbitTarget/radius/azimuth/elevation (ORBIT) state, exactly as it does
today for the no-active-camera case.

`_syncCamera()`'s new structure:

1. Ask nav for the world-space transform (position + quaternion) it wants
   the eye to have this tick. (If this isn't already a clean single nav
   accessor returning both, this brief includes adding one — see
   Implementation Order.)
2. If `this._nav.activeCamera` is `null`: write that world-space transform
   directly onto `this._camera` (the default camera, parent-free — local
   == world, no conversion). This is today's behavior, structurally
   unchanged.
3. If `this._nav.activeCamera` is non-null: take `this._camera`'s parent
   (the host node's `Object3D`) `matrixWorld`, invert it, and use it to
   convert nav's world-space result into the local transform `this._camera`
   needs. Write that local position/quaternion onto `this._camera`.
   - Per this session's scope, the parent is assumed **static** — i.e. it
     is acceptable to recompute the parent's `matrixWorld` inverse every
     tick (cheap, robust, and correctly handles the case where the parent
     itself sits under further static transforms) rather than caching it
     once at bind time. Do not special-case "cache at bind and never
     re-read" — that would silently break the moment Phase 3 allows
     animated parents, and per-tick recomputation costs little.

### 5. Reference hygiene — kill the stale-camera bug structurally

- `Stage.camera` must be a **getter** (`get camera() { return this._camera; }`),
  not a plain property assigned once at construction — confirm current
  implementation and convert if it is not already.
- Audit `apps/client/src/app.js`, `LabelOverlay`, and `PointerInputBridge`
  for any destructuring or caching of `stage.camera` (e.g.
  `const { camera } = stage`). Replace with live reads (`stage.camera`)
  at the point of use, every frame / every call — not captured once.
- This is the fix for the existing Known Issue **"perspective/orthographic
  cycling is buggy"** — confirm in the build log that the root cause
  (stale destructured reference) is gone, not merely that the manual smoke
  test happens to pass.

---

## Non-Goals (explicit)

- **Animated camera host nodes while bound.** The mechanism (real parented
  camera, scene-graph cascade) structurally supports this, but this
  session's acceptance criteria only require correctness for **static**
  host nodes (possibly nested under a non-identity but unchanging parent
  transform). Do not write tests or smoke-test steps that bind to a camera
  whose node is mid-animation.
- **ORBIT under a moving parent.** Out of scope. ORBIT must work correctly
  for a static parent (see Acceptance Criteria) — that is the full bar.
- **Free-look vs. ride-along while bound.** Nav continues to apply its
  full offset on top of the bound camera's transform unconditionally,
  exactly as today. No suspension logic, no per-mode branching on this
  axis.
- **`window.atrium` namespace consolidation.** Tracked separately in the
  backlog; do not fold in.
- **Detached-camera handling beyond "skip and warn."** No SOM/protocol
  changes for cameras that become attached/detached at runtime.

---

## Files Expected to Change

- `packages/renderer-three/src/Stage.js` — construction loop in
  `setSceneGroup`, rewritten `setActiveCamera`, generalized `_syncCamera`,
  persistent default camera, `camera` getter.
- `packages/som/src/SOMCamera.js` — `rawCamera` property slot (declared,
  documented, never written internally).
- `tests/client/som/SOMCamera.js` — re-synced copy (per project convention:
  `cp packages/som/src/*.js tests/client/som/`).
- `apps/client/src/app.js` — remove destructured `camera` caching; read
  `stage.camera` live.
- `packages/renderer-three/src/LabelOverlay.js` (or wherever it actually
  lives — confirm path) — same live-read fix if it currently caches.
- `packages/renderer-three/src/PointerInputBridge.js` — same live-read fix
  if it currently caches.

## No Changes Expected In

- `packages/client/src/NavigationController.js` — its world-space output
  math is unchanged. If this brief's implementation finds itself wanting
  to change nav's internal yaw/pitch/orbit computation rather than adding
  a read-only accessor for the world-space result, **stop and flag** —
  that indicates a design mismatch with this brief, not a green light to
  improvise.
- `@atrium/protocol` — no wire format changes.
- `@atrium/server` — no server changes; cameras are not touched server-side
  beyond existing `SOMCamera` networking from Session 42.
- glTF-Transform / `DocumentView` internals — we are working around the
  missing `CameraSubject`, not patching it upstream.

---

## Implementation Order

1. Confirm/add a single `NavigationController` accessor that returns the
   current world-space eye transform (position + quaternion) regardless of
   mode (WALK/FLY/ORBIT), if one doesn't already cleanly exist. **This
   should be a read accessor only — no new nav state, no new nav
   computation.** If today's nav code computes this inline inside the old
   `_syncCamera()` rather than exposing it, surfacing it as an accessor is
   in-scope; changing what it computes is not.
2. Add the persistent default camera (`this._defaultCamera`) to `Stage`
   construction; convert `camera` to a getter.
3. Implement the per-`SOMCamera` construction loop in `setSceneGroup`,
   including the `mutation` listener wiring and `rawCamera` assignment.
   Add the listener teardown alongside existing `AnimationBridge` teardown.
4. Rewrite `setActiveCamera` per §3.
5. Rewrite `_syncCamera` per §4 (world-to-local conversion via parent
   `matrixWorld` inverse).
6. Fix reference hygiene per §5 across `app.js`, `LabelOverlay`,
   `PointerInputBridge`.
7. Manual smoke test (see below) — no automated test exists for this path
   today (per Session 44's note: not unit-testable without DOM/WebGL); that
   constraint is unchanged this session.

---

## Risks / Watch-Outs

- **`rawCamera` naming collision or confusion with `node` back-reference
  pattern.** `SOMCamera.node` is set by `SOMDocument` during the registration
  walk; `rawCamera` is set later, by `Stage`, after scene-graph construction.
  Different lifecycle — make sure this is documented clearly on the
  property, not just inferred from this brief.
- **Detached cameras and cameras whose host node lookup fails.** Must
  degrade to "skip and warn," not throw — a malformed or edge-case world
  should not crash Stage construction.
- **Listener leak on reconnect/re-load.** `setSceneGroup` already disposes
  the previous `AnimationBridge` on re-entry (reconnect/re-load case per
  Session 43). The new per-camera `mutation` listeners must be torn down
  in the same pass, or repeated reconnects will accumulate duplicate
  listeners and double-apply lens mutations.
- **Orthographic camera construction parameters.** `THREE.OrthographicCamera`
  takes `left/right/top/bottom`, not `xmag/ymag` directly — confirm the
  correct mapping from glTF orthographic camera semantics (`xmag`, `ymag`
  as half-extents) to Three.js's constructor args. Get this right at
  construction *and* in the mutation-listener update path (§1) — both
  need the same conversion.
- **World-to-local conversion correctness depends on `updateMatrixWorld()`
  having actually run for the parent before `_syncCamera()` reads it that
  tick.** Confirm where in Stage's `tick(dt)` ordering (relative to
  `animBridge.update()`, which presumably mutates node transforms) the new
  `_syncCamera()` call sits, and whether a `sceneGroup.updateMatrixWorld(true)`
  (or equivalent targeted update) is needed before reading the host node's
  `matrixWorld` to avoid reading a stale parent transform from the previous
  frame.
- **`aspectRatio` mutation and resize interaction.** `Stage.resize()`
  presumably updates the active camera's aspect ratio already for the
  default camera. Confirm resize also reaches whichever per-`SOMCamera`
  object is currently active (via `this._camera`, which is fine since it's
  always the live reference) — should be automatic given §3/§5, but
  worth an explicit smoke-test step rather than assuming.

---

## Acceptance Criteria

1. Cycling through `som.cameras` (space-cameras.gltf fixture: `MainCamera`
   perspective → `OrthoCamera` orthographic → back to perspective → back to
   default) renders correctly at every step — no FOV/aspect/type
   corruption on the perspective→ortho→perspective round trip. This is the
   direct regression test for the Phase 1 Known Issue.
2. WALK/FLY navigation works correctly while bound to a static camera —
   movement and look feel the same as when unbound, just originating from
   the camera's seeded position.
3. **ORBIT works correctly while bound to a static camera, including one
   whose host node has a non-identity parent transform** (i.e. test with a
   camera node that is not a direct child of the scene root, if the fixture
   supports it, or note in the build log if `space-cameras.gltf` needs a
   fixture change to exercise this — flag, don't silently add one outside
   this brief's declared file list).
4. A `SOMCamera` mutation (e.g. via SOM Inspector or console:
   `camera.yfov = ...`) sent while that camera is currently active is
   visibly reflected in the live viewport without re-binding.
5. No consumer of `stage.camera` (`app.js`, `LabelOverlay`,
   `PointerInputBridge`) holds a destructured/cached reference anywhere in
   the codebase — confirmed by grep, not just by behavior.
6. Reconnecting / reloading the world (re-triggering `setSceneGroup`) does
   not accumulate duplicate `mutation` listeners on cameras — confirmed by
   code inspection of the teardown path, not just absence of visible bugs.
7. Full recursive test output provided per existing project process note
   (not summary counts), reconciled against the Session 44 baseline of 432.
   No regressions expected in any package; this work is additive
   (`rawCamera` property, new construction/teardown logic) and should not
   change existing test behavior anywhere, since no existing automated
   test exercises this path (per Session 44's note on DOM/WebGL
   dependency).

---

## Stop-and-Flag Conditions

- If `NavigationController`'s existing internals do not cleanly separate
  "compute world-space transform" from "write it onto a specific
  `THREE.Object3D`" — i.e. if exposing a read accessor requires restructuring
  nav's actual yaw/pitch/orbit math rather than just exposing its result —
  stop and flag rather than refactoring nav's computation. That would be a
  bigger change than this brief authorizes.
- If `space-cameras.gltf` cannot exercise "camera under a non-identity
  parent transform" as-is, stop and flag rather than silently extending the
  fixture or generator script.
- If orthographic camera construction/update reveals the existing Session
  42 `SOMCamera` orthographic semantics are ambiguous or inconsistently
  applied elsewhere, stop and flag rather than reinterpreting them.
