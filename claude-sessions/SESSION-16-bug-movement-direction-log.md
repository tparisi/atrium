# Session 16 Bug Fix Log — WASD Movement Directions Wrong After Yaw Rotation

## 2026-03-31

---

## Problem

WASD movement worked correctly at the initial yaw (yaw = 0), but after
rotating with mouse drag, W/S moved left/right and A/D moved forward/back.
The directions were transposed at any non-zero yaw, and the bug was
invisible at startup because it only manifests when `sin(yaw) ≠ 0`.

---

## Root Cause

Two helper functions in `NavigationController.js` had wrong signs on the
`sin` term:

```javascript
// Wrong
function forwardVec(yaw) { return [ Math.sin(yaw), 0, -Math.cos(yaw)] }
function rightVec(yaw)   { return [ Math.cos(yaw), 0,  Math.sin(yaw)] }
```

In glTF right-handed coordinates (+Y up, -Z forward), applying the Y-axis
rotation matrix `Ry(yaw)` to the default vectors gives:

- Forward `[0, 0, -1]` → `[-sin(yaw), 0, -cos(yaw)]`
- Right `[1, 0, 0]` → `[cos(yaw), 0, -sin(yaw)]`

Both had `+sin` where the correct formula requires `-sin`. At yaw = 0,
`sin(0) = 0` so the error was invisible. At yaw = π/2 (90° left turn),
old `forwardVec` returned `[1, 0, 0]` (pointing right) instead of
`[-1, 0, 0]` (pointing left-forward), which transposed the movement axes.

---

## Fix

One line changed in `packages/client/src/NavigationController.js`:

```javascript
// Correct
function forwardVec(yaw) { return [-Math.sin(yaw), 0, -Math.cos(yaw)] }
function rightVec(yaw)   { return [ Math.cos(yaw), 0, -Math.sin(yaw)] }
```

---

## No test changes

The NavigationController unit tests exercise all four movement directions
(KeyW/S/A/D) at yaw = 0. At yaw = 0, `sin(0) = 0`, so both the old and
new formulas produce identical results (`[0, 0, -1]` for forward,
`[1, 0, 0]` for right). All 13 navigation tests and all 182 total tests
continue to pass without modification.
