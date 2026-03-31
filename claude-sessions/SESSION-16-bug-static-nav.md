# Bug Fix — Static Mode Navigation

## 2026-03-31 · Session 16 continuation

---

## Problem

Loading a world without connecting to a server produces no navigation.
Mouse drag and WASD have no effect. The world renders but the camera is
stuck.

**Root cause:** The Session 16 refactor moved all navigation through
NavigationController → AvatarController → SOM nodes. But AvatarController
only creates the local avatar node on `world:loaded` when
`client.connected` is true. In static mode there is no connection, so
`avatar.localNode` is null, and NavigationController's `tick()` has
nothing to operate on.

Previously, `app.js` had a direct-drive fallback that moved the Three.js
camera without the SOM. That code was removed in the refactor.

---

## Design

AvatarController creates a local navigation node in static mode too.
One code path for both connected and static — NavigationController works
identically in both cases.

### `world:loaded` handler in AvatarController — two cases:

**Connected:**
- Look up avatar node by display name (already ingested into SOM)
- Create camera child node at `[0, cameraOffsetY, cameraOffsetZ]`
- Third-person view — avatar geometry is visible

**Static (not connected):**
- Create a bare node in the SOM: `som.createNode({ name: '__local_camera' })`
  (no mesh, no geometry)
- Create camera child node at `[0, 0, 0]` (no offset — first-person view)
- Add camera child as child of the bare node
- Emit `avatar:local-ready` with the bare node

The bare node name `__local_camera` (or similar) should be distinctive
and not collide with world geometry names. It is local-only — never sent
to a server.

### NavigationController

No changes needed. It reads `avatar.localNode` and `avatar.cameraNode`
and applies transforms. It doesn't know or care whether there's geometry
on the node or whether the camera offset is zero.

### `app.js` camera sync

The tick loop already reads avatar node and camera child node positions
to compute the Three.js camera transform. With first-person offset
`[0, 0, 0]`, the camera will be positioned at the node's location and
oriented by NavigationController's yaw/pitch. This should just work — but
verify that the existing camera sync math doesn't break when the offset
is zero (e.g. `lookAt` targeting the avatar position from the same
position would produce a degenerate result).

**If the camera sync math has issues at zero offset**, the fix is to
special-case the camera sync when there's no offset: set camera position
directly from the node translation, and apply yaw + pitch rotation
directly, rather than using `lookAt`. This would be a small change in
`app.js`'s tick loop.

### `setView` calls in static mode

NavigationController will call `avatar.setView()`, which calls
`client.setView()`. AtriumClient already silently drops `setView` when
not connected. No change needed.

---

## Acceptance

1. Load `tests/fixtures/space.gltf` without connecting — world renders
2. Drag to look — camera rotates (yaw + pitch)
3. WASD — camera moves through the world in first-person
4. No avatar capsule visible (bare node, no geometry)
5. No console errors
6. Connect to server after static browsing — avatar appears, transitions
   to third-person view, multiplayer works normally
7. All 182 automated tests still pass

---

## Scope

- `packages/client/src/AvatarController.js` — add static mode node
  creation in `world:loaded` handler
- `apps/client/src/app.js` — verify/fix camera sync at zero offset
- No changes to NavigationController, AtriumClient, SOM, or protocol
- No new tests required (manual verification), but if convenient, add
  a unit test for AvatarController static mode (bare node + zero offset)

---

## Test After Fix

Re-run Session 16 Test 10:

| # | Step | Expected |
|---|---|---|
| 10.1 | Load world URL without connecting | World renders. No avatar capsule. |
| 10.2 | Drag to look | Camera rotates (first-person). |
| 10.3 | WASD to move | Camera moves through the world. |
| 10.4 | HUD | "World:" line shows. "You" and "Peers" hidden. |
| 10.5 | No console errors | Clean console. |
| 10.6 | Now click Connect | Avatar appears. Camera transitions to third-person. Navigation continues working. |
