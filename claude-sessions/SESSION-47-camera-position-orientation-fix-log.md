# Session 47 — Fix: activeCamera Position Not Seeded + Third-Person Rig Corrupts Orientation — Build Log

**Date:** 2026-06-22
**Branch:** main
**Status:** Complete (manual smoke test pending)

---

## Summary

Two complementary fixes to `Stage.js` that together ensure switching to a `SOMCamera` in
WALK or FLY mode lands the view at the authored camera position facing the authored
direction, rather than at the avatar's current position looking at the avatar's head.

**Total tests: 436 / 436** (+4 new, delta vs Session 46 baseline of 432).

---

## Files Changed

| File | Change |
|---|---|
| `packages/renderer-three/src/Stage.js` | Fix 1: `hasOffset` gated by `!nav.activeCamera`; Fix 2: WALK/FLY position seed in `setActiveCamera` |
| `packages/renderer-three/tests/stage.test.js` | 4 new tests (15–18) covering WALK/FLY bound third-person, first-person, and bind/unbind cycle |

### No changes in

- `packages/client/src/NavigationController.js`, `AvatarController.js`
- `apps/client/src/app.js`, `tools/som-inspector/**` — no call-site changes needed
- Test fixtures — `space-cameras.gltf` already has `MainCamera` at `[0, 2, 8]` for smoke

---

## Root Cause (from brief's audit)

### Bug 1 — position never seeded for WALK/FLY

`Stage.setActiveCamera()` seeded `nav.yaw`/`nav.pitch` unconditionally and orbit state
inside the ORBIT branch, but had no WALK/FLY position seed at all. After binding to a
`SOMCamera`, the eye position was wherever `avatar.localNode.translation` already was
(the avatar's pre-switch position), completely disconnected from the camera being bound.
`NavigationController.tick()` only ever *moves* `localNode.translation` in response to
WASD input — it never re-derives it from a bound camera.

### Bug 2 — third-person rig computes look-at-avatar when bound

In `_syncCamera()`'s WALK/FLY branch, the `hasOffset` check (`camOffset[2] > 0.001`)
was gated only on the camera-node's Z offset, not on whether a SOMCamera was bound. When
`apps/client`'s default third-person offset is active (`cameraOffsetZ: 4.0`), this caused
the camera to point at the avatar's own head regardless of the bound camera's authored
orientation. This is correct behavior for the unbound follow-cam but has no meaning once
a SOMCamera is bound — there is no avatar to look at; the view should reflect the
authored orientation.

These two bugs compound: Bug 1 puts the eye at the wrong position; Bug 2 then looks in
entirely the wrong direction from that wrong position. Together, they explain why binding
to a SOMCamera in WALK mode in `apps/client` (which defaults to third-person) has
"never worked" since Phase 1.

---

## Fix Details

### Fix 1 — `_syncCamera()`: gate `hasOffset` behind `!nav.activeCamera`

```javascript
// Before:
const hasOffset = Math.abs(camOffset[2]) > 0.001

// After:
const hasOffset = !this._nav.activeCamera && Math.abs(camOffset[2]) > 0.001
```

When bound (`nav.activeCamera` is non-null), `hasOffset` is always false, routing through
the `else` branch — `worldPos = avatarPos`, `worldQuat = qYaw * qPitch`. This is the
correct "pure yaw/pitch, no avatar-relative look-at" behavior for a bound camera, and is
already exercised by the existing first-person test (test 14). The fix restores this path
for third-person rigs while bound, without changing the rig's behavior for the unbound
default camera.

The `Math.abs(camOffset[2]) > 0.001` threshold is unchanged.

### Fix 2 — `setActiveCamera()`: seed position for WALK/FLY

Added `else if` alongside the existing ORBIT block, so WALK/FLY also seeds
`avatar.localNode.translation` from the camera's authored world position:

```javascript
if (this._nav.mode === 'ORBIT') {
  // ... existing ORBIT seeding, unchanged ...
} else if (this._avatar?.localNode) {
  this._avatar.localNode.translation = [worldPos.x, worldPos.y, worldPos.z]
}
```

`worldPos` is the value already computed earlier in `setActiveCamera` via
`somCamera.rawCamera.getWorldPosition(worldPos)` — the same value used for the
orientation seed. No new computation.

The `?. ` guard mirrors the existing null-guards elsewhere in Stage (e.g. `_syncCamera`
early-returns if `localNode` is null); `setActiveCamera` can be called before an avatar
exists (disconnected/static mode) and must not throw.

Because of fix 1, no offset back-solve is needed — `worldPos` (the camera's exact authored
world position) is also the correct value for `avatarPos` in the bound path, since the
offset term is now bypassed whenever a camera is bound.

---

## New Tests

Four tests added to `packages/renderer-three/tests/stage.test.js`, numbered 15–18.
A shared `makeBoundCamera(x, y, z)` helper was added above test 14 to avoid duplicating
the `THREE.Object3D` + `THREE.PerspectiveCamera` parent setup across all four.

| # | Description | What it verifies |
|---|---|---|
| 15 | WALK bound, third-person active | position lands at `[0, 2, 8]` (not avatar+offset); forward faces -Z (not look-at-avatar) |
| 16 | WALK bound, first-person active | position seed works even when `hasOffset` was already false (Fix 2 covers both cases) |
| 17 | FLY bound, third-person active | same fix applies to FLY mode (hits the same `else` branch) |
| 18 | WALK bind then unbind | third-person rig (`hasOffset = true`) restored after `setActiveCamera(null)` |

All tests use a `THREE.PerspectiveCamera` parented under a `THREE.Object3D` at identity
(host at origin, camera at `[0, 2, 8]` local = world). No DOM or WebGL required — this
is the same plain-THREE-in-Node pattern as the existing ORBIT and first-person tests.

**Existing test 13 (`WALK third-person`)** — the test that exercises the third-person
rig without binding — is unchanged and still passes (confirms the fix doesn't regress
the unbound case).

---

## Test Results

| Package | Tests | Pass | Delta vs S46 |
|---|---|---|---|
| `@atrium/protocol` | 55 | 55 | 0 |
| `@atrium/som` | 176 | 176 | 0 |
| `@atrium/server` | 32 | 32 | 0 |
| `@atrium/client` | 106 | 106 | 0 |
| `@atrium/renderer-three` | 58 | 58 | **+4** |
| `@atrium/interaction` | 9 | 9 | 0 |
| **Total** | **436** | **436** | **+4** |

---

## Acceptance Criteria — Status

- [x] **Criterion 1** (unit test — WALK bound third-person): test 15 ✓
- [x] **Criterion 2** (unit test — WALK bound first-person): test 16 ✓
- [x] **Criterion 3** (unit test — FLY bound): test 17 ✓
- [x] **Criterion 4** (unit test — bind/unbind restores third-person): test 18 ✓
- [x] **Criterion 5** (ORBIT tests unaffected): tests 52 (ORBIT) unchanged ✓
- [x] **Criterion 6** (436 tests, delta shown): confirmed above
- [ ] **Criterion 7** (manual smoke): `apps/client` — connect, switch to `MainCamera` via
      Space, confirm view at `[0, 2, 8]` facing authored direction; V-key while bound;
      FLY mode with bound camera — pending

---

## FLY-mode movement gap (new backlog item, not fixed here)

The audit also found `NavigationController.tick()`'s WALK/FLY movement code clamps Y to
`Math.max(0.7, pos[1])` regardless of mode, preventing vertical movement in FLY mode.
This contradicts `docs/DESIGN-avatar-navigation.md`'s documented FLY behavior (gravity
ignored). Fixing it requires a design decision on which keys drive ascend/descend (Space
is already claimed by camera-cycling in `apps/client`). **Tracked as a separate backlog
item; not addressed here.**

---

## Stop-and-Flag Notes

None triggered.

- Seeding `avatar.localNode.translation` in `setActiveCamera` does not bypass or suppress
  any networking path — `NavigationController.tick()` already mutates this property every
  frame in WALK mode via the WASD handler; this is the same mutation path.
- V-key toggle while bound is expected to be a visual no-op (offset bypassed per fix 1),
  not tested automated. Noted for manual smoke confirmation.
- The stub pattern cleanly supports parented `THREE.Object3D` without any DOM/WebGL
  dependency — no stop-and-flag on test extensibility.
