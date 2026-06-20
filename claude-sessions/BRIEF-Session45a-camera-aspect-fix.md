<!-- SPDX-License-Identifier: CC0-1.0 -->
# Session 45a Brief — Fix: Per-Camera Aspect Ratio Not Initialized / Stale While Inactive

## Context

Manual smoke testing of Session 45 (`activeCamera` Phase 2) surfaced a bug
not caught by the automated test suite (expected — this path requires a
live DOM/WebGL context):

> Switching to the perspective camera (`MainCamera`), at least the first
> time, renders with a visibly wrong aspect ratio. Resizing the window
> fixes it.

## Root Cause

`Stage.resize()` is the only code path that currently sets `aspect` on a
camera from the container's actual viewport dimensions. It only touches
`this._camera` — whichever camera happens to be active at the moment
`resize()` fires.

Per-`SOMCamera` `THREE.PerspectiveCamera` objects are constructed in the
`setSceneGroup` camera loop (Session 45) using only the glTF camera's own
lens properties. glTF's `aspectRatio` field is optional and explicitly
advisory (`SOMCamera.aspectRatio` is documented as "advisory hint;
renderer may ignore"); it is not guaranteed to match the actual viewport,
and is frequently absent entirely, in which case the constructed
`THREE.PerspectiveCamera` is left at whatever Three.js's constructor
default produces. Nothing pushes the real container aspect onto a
newly-constructed per-camera object at construction time.

This produces two related symptoms:

1. **First switch to any per-SOMCamera perspective camera renders with
   the wrong aspect**, until the next `resize()` event happens to fire
   and correct `this._camera` (which is now pointing at that object).
2. **Any per-SOMCamera object that was *not* active during a resize
   carries a stale aspect indefinitely.** If the user resizes the window
   while `MainCamera` is active, then switches to a second perspective
   camera that was sitting unused in the scene graph, that second
   camera's `aspect` still reflects whatever it had at construction time
   (or whatever it last had if it was previously active before an earlier
   resize) — not the current viewport.

Symptom 1 is what was observed in smoke testing. Symptom 2 is the same
root cause and should be fixed at the same time rather than left for a
future bug report — it's the same gap, just not yet observed because the
fixture only has one perspective camera to switch between.

The default Tier-C camera does not exhibit this bug because it has always
existed by the time any resize fires, and is the camera active at startup
in the common case.

---

## Fix

Two complementary changes — both are small, both address the same root
cause from different angles, and the brief is intentionally narrow to
just these:

### 1. Set aspect at construction time

In the `setSceneGroup` camera-construction loop, immediately after
constructing each `THREE.PerspectiveCamera` (orthographic cameras are
unaffected — `OrthographicCamera` doesn't use `.aspect`), set its `aspect`
from the container's **current** actual dimensions — the same
width/height source `Stage.resize()` already reads — and call
`updateProjectionMatrix()`. Do not rely on or read the glTF's
`aspectRatio` field for this; that field stays exactly as advisory as it
is today and is not part of this fix.

### 2. Push current aspect onto the camera being activated, in `setActiveCamera`

In `setActiveCamera`'s non-null path, after `this._camera = somCamera.rawCamera`,
if the assigned camera is a `THREE.PerspectiveCamera`, set its `aspect`
from the container's current dimensions and call
`updateProjectionMatrix()`, before returning. This covers the case where
the camera being switched to was constructed (or last touched) before a
resize that happened while a *different* camera was active — i.e. fixes
symptom 2 directly, and as a side effect also fully covers symptom 1
without depending on fix #1 alone.

Do **not** add this same push to the null path (`setActiveCamera(null)`)
beyond what already exists — the default camera should already be kept
correctly sized by `resize()` in the common case; if smoke testing during
this fix reveals it isn't, stop and flag rather than expanding scope.

### Shared aspect source

Both fixes should read width/height from whatever single source
`Stage.resize()` already uses (container/canvas dimensions) — do not
introduce a second way of computing aspect. If `resize()`'s current
implementation makes the width/height awkward to reuse from elsewhere
(e.g. they're local variables not stored on `this`), it's fine to factor
out a small private helper (e.g. `_currentAspect()`) that both `resize()`
and these two new call sites use — but this should be a pure extraction
of existing logic, not a new computation.

---

## Non-Goals

- Orthographic camera resize behavior (left/right/top/bottom not
  rescaling with viewport) — pre-existing, separately tracked, not this
  bug.
- Nested or animated camera host nodes — separate follow-on brief.
- Any change to how `aspectRatio` is read from or written to `SOMCamera`
  / glTF — that field's semantics are unchanged; this fix is purely about
  what the live `THREE.PerspectiveCamera` object's `.aspect` is set to at
  two specific moments (construction, activation).

## Files Expected to Change

- `packages/renderer-three/src/Stage.js` only.

## No Changes Expected In

- `packages/som/src/SOMCamera.js` — `aspectRatio` property and its
  semantics are untouched.
- `apps/client/src/app.js`, `LabelOverlay.js`, `PointerInputBridge.js` —
  no reference-hygiene changes needed for this fix; Session 45 already
  addressed live-reads.
- `NavigationController` — uninvolved.
- Test fixtures — no fixture change needed for this fix (contrast with
  the separate nested/animated-camera follow-on, which will need one).

---

## Risks / Watch-Outs

- **Don't call `updateProjectionMatrix()` on an `OrthographicCamera`
  as part of either fix's aspect-setting branch** — guard with an
  `instanceof THREE.PerspectiveCamera` check (or equivalent) before
  touching `.aspect`, since `OrthographicCamera` doesn't have that
  property and setting it would be a silent no-op at best, confusing at
  worst if someone later reads it expecting it to mean something.
- **Ordering in `setActiveCamera`:** make sure the aspect push happens
  after the reference assignment (`this._camera = somCamera.rawCamera`)
  and before any nav-seeding step that might itself trigger a render or
  rely on a correct projection matrix.
- **Double-correction is harmless but worth knowing about:** after this
  fix, a camera that's both freshly constructed *and* immediately
  activated will have its aspect set twice (once by fix #1, once by fix
  #2). This is fine — it's idempotent — but don't try to "optimize" it
  away by skipping one of the two call sites; they cover different
  trigger conditions (construction-time vs. activation-time) and both
  are needed for the symptom-2 case described above.

---

## Acceptance Criteria

1. Switching to `MainCamera` (perspective) for the first time in a
   session, with no resize having occurred yet, renders with the correct
   aspect ratio immediately — no visible stretch/squash, no resize
   required to correct it.
2. With two or more perspective `SOMCamera`s available (if the test
   fixture has only one, note this as a coverage gap rather than
   skipping verification — see below), resizing the window while one is
   active, then switching to the other, shows the second camera with the
   correct current aspect — not whatever it had at construction.
3. Orthographic camera behavior is unchanged (no new code path touches
   it).
4. Full recursive test output; no regressions against the Session 45
   baseline of 432.
5. Manual smoke: repeat Session 45's smoke-test Step 4 (ortho ↔
   perspective round trip) and Step 8 (resize while each camera type is
   active) to confirm this fix doesn't interact badly with either.

**Coverage note:** `space-cameras.gltf` has exactly one perspective camera
(`MainCamera`) and one orthographic (`OrthoCamera`), per the existing
fixture table. Acceptance criterion 2 as written needs a second
perspective camera to verify symptom 2 directly. Stop and flag rather
than silently extending the fixture — note in the build log whether
criterion 2 was verified directly (fixture changed under a separate,
explicitly-approved step) or only reasoned about from code inspection
(fixture unchanged, logic verified by reading the diff against the
described trigger condition).

---

## Stop-and-Flag Conditions

- If `Stage.resize()`'s current width/height source turns out not to be
  a clean, reusable value (e.g. it's computed via something
  side-effecting, or there's no single source of truth and the two apps'
  configurations diverge) — stop and flag rather than introducing a
  second independent way of computing aspect just to avoid refactoring.
- If fixing symptom 2 properly seems to require touching
  `setActiveCamera`'s null path after all — stop and flag rather than
  expanding it, per the explicit instruction above.
