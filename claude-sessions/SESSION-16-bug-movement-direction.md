# Bug Fix — WASD Movement Directions Wrong After Yaw Rotation

## 2026-03-31 · Session 16 continuation

---

## Problem

In static mode (and likely connected mode too), WASD movement works
correctly at the initial yaw (yaw = 0). But after rotating with mouse
drag:

- **W/S move left/right** instead of forward/back
- **A/D move forward/back** instead of strafing

The movement directions are swapped — as if forward and right vectors
are transposed or rotated 90 degrees from where they should be.

---

## Where to Look

File: `packages/client/src/NavigationController.js`

The movement math in `tick()` computes a world-space movement vector
from the currently pressed keys and the current yaw. The helper
functions are:

```javascript
function forwardVec(yaw) { return [Math.sin(yaw), 0, -Math.cos(yaw)] }
function rightVec(yaw)   { return [Math.cos(yaw), 0,  Math.sin(yaw)] }
```

And the yaw quaternion applied to the avatar node:

```javascript
function yawQuat(yaw) { return [0, Math.sin(yaw/2), 0, Math.cos(yaw/2)] }
```

---

## Diagnosis

The bug is likely one of these:

### Possibility 1 — forwardVec and rightVec are swapped or have wrong signs

In glTF right-handed coordinates:
- **Forward** is **-Z**: `[0, 0, -1]` at yaw = 0
- **Right** is **+X**: `[1, 0, 0]` at yaw = 0
- **Yaw** rotates around **+Y** (up)

As yaw increases (turning right / clockwise when viewed from above):
- Forward should rotate from -Z toward -X
- Right should rotate from +X toward -Z

Verify the trig is correct:
- `forwardVec(yaw)` should produce `[-sin(yaw), 0, -cos(yaw)]` — note
  the **negative** sin for the X component
- `rightVec(yaw)` should produce `[cos(yaw), 0, -sin(yaw)]` — note
  the **negative** sin for the Z component

The current implementation has `[Math.sin(yaw), 0, -Math.cos(yaw)]`
for forward — the X component sign may be wrong. And
`[Math.cos(yaw), 0, Math.sin(yaw)]` for right — the Z component sign
may be wrong.

### Possibility 2 — yaw direction convention mismatch

`onMouseMove` does `this._yaw -= dx * sensitivity`. If the yaw sign
convention doesn't match the vector math, forward/right vectors will
compute in the wrong direction relative to where the camera is
actually looking.

### Possibility 3 — movement applied in node-local space instead of world space

If the avatar node has a yaw rotation applied AND the movement vector
also accounts for yaw, the movement is effectively double-rotated.
Translation should be in world space (since `forwardVec(yaw)` already
incorporates the yaw).

---

## How to Verify the Fix

1. Load a world (static mode is easiest — no server needed)
2. Without rotating, press W — should move forward (into the scene,
   toward -Z)
3. Rotate ~90 degrees right (drag mouse left)
4. Press W — should move in the new forward direction (roughly toward -X)
5. Press A — should strafe left relative to the new forward direction
6. Rotate back to original orientation — W should move toward -Z again
7. Test at various yaw angles — 45°, 90°, 180° — movement should
   always be relative to the direction you're facing

---

## Scope

- **Only** fix the movement direction math in
  `packages/client/src/NavigationController.js`
- The fix is likely a sign correction in `forwardVec()` and/or
  `rightVec()`, or a double-rotation issue in `tick()`
- Do NOT change AvatarController, AtriumClient, SOM, or app.js
- All 182 automated tests must still pass — update NavigationController
  unit tests if the expected direction values change
