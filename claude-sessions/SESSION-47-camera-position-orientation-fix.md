<!-- SPDX-License-Identifier: CC0-1.0 -->
# Session 47 Brief — Fix: `activeCamera` Position Not Seeded + Third-Person Rig Corrupts Orientation in WALK/FLY

## Context

Flagged in the 2026-06-20 handoff as an active, unverified investigation:
manual testing after Session 46 found camera position/orientation "not at
all what I would expect" when navigating with `apps/client`, suspected
long-standing rather than a regression. The handoff traced one hypothesis
through the code but explicitly deferred writing a fix brief pending
further audit. This brief is the result of that audit — done by reading
`packages/renderer-three/src/Stage.js` directly against the live repo,
not just reasoning from the handoff's description.

The audit confirms the handoff's hypothesis **and finds a second,
related bug that changes the predicted symptom.** Both are fixed together
below because they share a root cause and the correct fix for one
naturally subsumes the other.

## Root Cause

### Bug 1 (hypothesized in handoff, confirmed by code read): position never seeded for WALK/FLY

In `Stage.setActiveCamera()`:

```javascript
const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ')
this._nav.yaw   = euler.y
this._nav.pitch = euler.x

if (this._nav.mode === 'ORBIT') {
  // ...seeds orbitTarget, orbitRadius, orbitAzimuth, orbitElevation...
}
```

Yaw/pitch are seeded unconditionally. Position is seeded **only** inside
the `ORBIT` branch. In WALK or FLY mode, nothing in `setActiveCamera`
touches `this._avatar.localNode`. `NavigationController.tick()`'s
WALK/FLY branch only ever *moves* `localNode.translation` in response to
WASD input — it never re-derives it from a bound camera. After binding,
the eye position is wherever the avatar was already standing, completely
disconnected from the camera being switched to.

### Bug 2 (found during this audit, not in the handoff): third-person rig corrupts orientation when bound

`apps/client` defaults to third-person (`cameraOffsetZ: 4.0`, set in
`AvatarController`'s constructed `cameraNode`). In `Stage._syncCamera()`,
the WALK/FLY branch checks `hasOffset` (`camOffset[2] > 0.001`) and, when
true, computes orientation via:

```javascript
const lookTarget = new THREE.Vector3(avatarPos[0], avatarPos[1] + 1.0, avatarPos[2])
const m = new THREE.Matrix4().lookAt(worldPos, lookTarget, new THREE.Vector3(0, 1, 0))
worldQuat.setFromRotationMatrix(m).multiply(qPitch)
```

This points the camera **at the avatar's own head**, not in the
direction implied by `yaw`/`pitch`. That's the correct behavior for the
default free camera (third-person follow-cam), but it has no meaning
once bound to an authored `SOMCamera` — there's no avatar to look at;
the view should just be the bound camera's own orientation, with
yaw/pitch providing look-around freedom on top of it.

This means the handoff's predicted symptom — "looks in roughly the right
direction, sits at the wrong position" — does not hold in `apps/client`'s
default state. Because third-person is the default there, binding to
`MainCamera` produces an orientation pointed at wherever the avatar
happens to be standing, unrelated to `MainCamera`'s authored direction,
**compounding** the position gap rather than leaving orientation correct
on its own. This is a plausible explanation for why the bug has "felt
wrong from the very beginning" — `apps/client` has likely never hit a
state where binding to a SOMCamera in WALK mode produced a correct view,
because third-person is the default and this path has been broken since
Phase 1.

### Why both bugs point at the same fix

Bypassing the third-person/look-at-avatar logic entirely while
`nav.activeCamera` is set fixes Bug 2 directly, and as a side effect
makes the Bug 1 fix trivial: with the offset rig bypassed, the eye
position in the bound case is just `avatarPos` (no offset term), so
seeding `localNode.translation` to the camera's authored world position
is sufficient — no back-solve through the third-person offset is needed.

---

## Fix

Both changes are in `Stage.js` only.

### 1. `_syncCamera()` — don't apply the third-person rig while bound

Change the `hasOffset` condition so it's only ever true for the
*default* (unbound) camera:

```javascript
const hasOffset = !this._nav.activeCamera && Math.abs(camOffset[2]) > 0.001
```

Leave everything else in that branch (the `if (hasOffset) {...} else
{...}` body) unchanged. When bound, this routes through the existing
`else` branch — `worldPos = avatarPos`, `worldQuat = qYaw.multiply(qPitch)`
— which is the correct "pure yaw/pitch, no avatar-relative look-at"
behavior for a bound camera, and is already exercised by the existing
first-person test (`Stage: WALK first-person...`).

### 2. `setActiveCamera()` — seed position for WALK/FLY, mirroring the ORBIT branch

Add an `else` alongside the existing `if (this._nav.mode === 'ORBIT')`
block, so WALK/FLY also seeds `localNode.translation` from the camera's
world position computed just above it in the same function
(`worldPos`/`somCamera.rawCamera.getWorldPosition(...)`):

```javascript
if (this._nav.mode === 'ORBIT') {
  // ...existing ORBIT seeding, unchanged...
} else if (this._avatar?.localNode) {
  this._avatar.localNode.translation = [worldPos.x, worldPos.y, worldPos.z]
}
```

Because of fix #1, no offset back-solve is needed — `worldPos` (the
camera's exact authored world position, already computed earlier in
`setActiveCamera` for the orientation seed) is also the correct value
for `avatarPos`, since the offset term is now bypassed whenever a camera
is bound.

**Guard rationale for `this._avatar?.localNode`:** mirrors the existing
null-guards elsewhere in `Stage` (`_syncCamera` already early-returns if
`localNode` is null); `setActiveCamera` can in principle be called before
an avatar exists (e.g. static/disconnected mode), and should no-op the
position seed rather than throw.

---

## Non-Goals

- **FLY-mode movement itself.** This audit also found that
  `NavigationController.tick()`'s WALK/FLY movement code is mode-blind —
  there is no vertical movement, and position is hard-clamped to
  `Math.max(0.7, pos[1])` regardless of mode. `docs/DESIGN-avatar-navigation.md`
  documents that terrain-following/gravity should be **ignored** in FLY
  mode, so FLY currently can't do what it's designed to do. This is a
  real, separate bug, but fixing it requires a design decision this brief
  doesn't make (what keys drive ascend/descend — `Space` is already
  bound to camera-cycling in `apps/client`). **Flagging as a new backlog
  item, not fixing here.** Do not address it as part of this brief.
- **ORBIT under a moving/animated parent** — separate, already-tracked
  design question (carried forward in the handoff's Known Issues);
  unrelated to either bug fixed here.
- **Roll/banking (`up` vector) support** — referenced in
  `DESIGN-avatar-navigation.md`'s FLY-mode wire format but not implemented
  anywhere in `NavigationController`; out of scope.
- Any change to `ORBIT`'s seeding or math — unaffected by either fix,
  not touched.

## Files Expected to Change

- `packages/renderer-three/src/Stage.js` only.
- `packages/renderer-three/tests/stage.test.js` — new unit tests (see
  Acceptance Criteria). Despite the handoff's note that the `activeCamera`
  path generally isn't unit-testable without a live `sceneGroup`, this
  specific logic is: the existing stub pattern (`makeAvatarCtor`,
  `makeNavCtor`, plain-object `localNode`/`cameraNode` stand-ins) already
  exercises `_syncCamera`'s ORBIT and WALK branches without any DOM/WebGL
  dependency. `setActiveCamera` needs a `somCamera` stub whose
  `rawCamera` is a real `THREE.Camera` (works fine in Node) parented
  under a real `THREE.Object3D` with a known transform — no renderer or
  `DocumentView` required.

## No Changes Expected In

- `NavigationController.js` — uninvolved in either fix; the FLY-mode
  movement gap noted above is explicitly deferred, not fixed here.
- `AvatarController.js` — the third-person offset rig's own logic and
  defaults (`cameraOffsetY`/`cameraOffsetZ`) are unchanged; this fix only
  changes *when* that rig is consulted, not how it computes.
- `apps/client/src/app.js`, `tools/som-inspector` — no call-site changes
  needed; both already call `stage.setActiveCamera(...)` and read
  `stage.camera` live per Session 45/46's reference-hygiene fix.
- Test fixtures (`space-cameras.gltf`) — unchanged; `MainCamera`'s
  authored position `[0, 2, 8]` is exactly what's needed to verify this
  fix and is already in place.

---

## Risks / Watch-Outs

- **Order of operations in `setActiveCamera`:** the position seed must
  use the same `worldPos` already computed for the orientation seed
  (from `somCamera.rawCamera.getWorldPosition(...)`), not a re-derived
  value — there's exactly one correct value here and the function already
  computes it once.
- **Don't special-case `apps/client`'s default third-person state.** The
  fix to `hasOffset` is in `Stage.js` and applies regardless of which app
  is hosting it or what `cameraOffsetZ` is set to. Resist the temptation
  to "fix" this by changing `apps/client`'s defaults instead — that would
  leave the underlying bug in place for any other app or future caller
  that binds a camera while in third-person mode.
- **V-key (first/third-person toggle) interaction while bound:**
  `apps/client`'s `KeyV` handler doesn't currently check
  `nav.activeCamera` — a user can toggle third-person on while bound to a
  `SOMCamera`. After this fix, that toggle becomes a no-op for rendering
  purposes (the offset is bypassed whenever bound), which is correct, but
  confirm during smoke testing that toggling `V` while bound doesn't
  throw or visibly do anything odd — it should simply have no visible
  effect on the view until the camera is unbound again.
- **`Math.abs(camOffset[2]) > 0.001` threshold is unchanged** — this fix
  only gates that check behind `!this._nav.activeCamera`; don't adjust
  the threshold itself, it's an unrelated pre-existing constant.

---

## Acceptance Criteria

1. **Unit test — WALK, bound, third-person state active:** with
   `localNode.translation` at some arbitrary non-zero starting point and
   `cameraNode.translation` set to a third-person offset (Z > 0.001),
   call `setActiveCamera(somCamera)` where `somCamera.rawCamera` is
   parented at a known world transform (e.g. position `[0, 2, 8]`,
   identity rotation). After one `tick()`, assert `stage.camera`'s world
   position equals `[0, 2, 8]` and its forward direction matches the
   bound camera's authored forward — not pointed at the avatar.
2. **Unit test — WALK, bound, first-person state active:** same as
   above but with `cameraNode.translation` at `[0, *, 0]` (Z ≈ 0). Same
   assertions; confirms the fix doesn't regress the already-correct
   first-person path.
3. **Unit test — FLY mode, bound:** same as criterion 1 with
   `nav.mode = 'FLY'`, confirming the fix applies to both non-ORBIT
   modes (the handoff's hypothesis covered both under the same `else`
   branch; this brief's fix does too — verify it).
4. **Unit test — unbinding (`setActiveCamera(null)`) restores third-person
   behavior:** bind, then unbind, then confirm a subsequent `tick()` in
   third-person WALK produces the existing look-at-avatar behavior
   (i.e. the existing `Stage: WALK third-person...` test's assertions
   still hold when run *after* a bind/unbind cycle, not just in isolation).
5. **Regression — existing ORBIT tests unaffected:** no changes to
   ORBIT's seeding or sync path; existing ORBIT tests should pass
   unmodified.
6. **Full recursive test output**, reconciled against the Session 46
   baseline of 432 plus whatever new tests this brief adds (do not report
   a bare "all passing" — show the count and the delta, per the
   handoff's standing process note).
7. **Manual smoke test** (per the handoff's own "Next steps," now
   actually checkable): in `apps/client`, connect (default third-person,
   WALK mode), switch to `MainCamera` via the `Space` key. Confirm the
   view sits at `[0, 2, 8]` and faces the camera's authored direction —
   not near spawn, not pointed at the avatar. Repeat after pressing `V`
   (first-person) to confirm no regression there. Repeat once more after
   switching the mode selector to `FLY`.

---

## Stop-and-Flag Conditions

- If seeding `this._avatar.localNode.translation` inside
  `setActiveCamera` turns out to trigger unexpected network traffic or
  side effects beyond the ordinary position-mutation path that
  `NavigationController.tick()` already exercises every frame in WALK
  mode — stop and flag rather than adding a suppression mechanism ad hoc.
- If the `V`-key toggle while bound (see Risks above) does something
  more disruptive than "no visible effect" during smoke testing — stop
  and flag; do not add a guard against toggling while bound as a silent
  extension of this brief's scope.
- If extending unit-test coverage to `setActiveCamera` reveals the stub
  pattern doesn't actually support a parented `THREE.Object3D` cleanly
  (contrary to what this brief's audit found) — stop and flag rather
  than falling back to smoke-test-only coverage without saying so.
