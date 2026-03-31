# Session 16 Bug Fix Log — Static Mode Navigation

## 2026-03-31

---

## Problem

Loading a world without connecting to a server produced no navigation. Mouse
drag and WASD had no effect — the camera was stuck at its initial position.

**Root cause:** The Session 16 refactor routed all navigation through
`NavigationController → AvatarController → SOM nodes`. `AvatarController`
only created the local avatar node on `world:loaded` when `client.connected`
was true. In static mode there is no connection, so `avatar.localNode` was
null, and `NavigationController.tick()` returned immediately with nothing to
operate on. The direct-drive camera fallback that existed in the old `app.js`
had been removed in the refactor.

---

## Fix

### `packages/client/src/AvatarController.js`

Added an `else` branch to `_onWorldLoaded()` for the static (not connected)
case. Instead of looking up an avatar node from the SOM, AvatarController
creates two bare nodes with no geometry:

```javascript
} else {
  // Static mode — bare navigation node with no geometry, first-person offset
  const localNode = som.createNode({
    name:        '__local_camera',
    translation: [0, 1.6, 0],   // eye height
  })
  som.scene.addChild(localNode)
  const camNode = som.createNode({
    name:        '__local_camera-child',
    translation: [0, 0, 0],     // zero offset = first-person
  })
  localNode.addChild(camNode)
  this._localNode  = localNode
  this._cameraNode = camNode
  this.emit('avatar:local-ready', { node: localNode })
}
```

- `__local_camera` starts at eye height `[0, 1.6, 0]`
- Camera child at `[0, 0, 0]` (zero offset signals first-person mode)
- `avatar:local-ready` is emitted — NavigationController's `_readNavInfo()`
  runs, and `nav.tick()` has a node to operate on from the first frame

**Transition to connected mode is clean:** when the user subsequently
connects, `_onSomDump` replaces the entire SOM with a fresh document from
the server. The subsequent `world:loaded` event fires with `client.connected
=== true`, so the connected path runs and `_localNode` / `_cameraNode` are
updated to the real avatar and camera child nodes.

Also removed a debug `console.log` left in `setView()`.

---

### `apps/client/src/app.js` — camera sync

The previous camera sync hardcoded `CAMERA_OFFSET_Y` / `CAMERA_OFFSET_Z`
and always used `camera.lookAt()`. With a zero camera offset the `lookAt`
target would be 1 m above the camera position — directly overhead — causing
the camera to aim straight up.

Fixed to read `cameraNode.translation` from the SOM and branch on whether
an offset is present:

```javascript
const camOffset = cameraNode.translation ?? [0, 0, 0]
const hasOffset = Math.abs(camOffset[1]) > 0.001 || Math.abs(camOffset[2]) > 0.001

if (hasOffset) {
  // Third-person: offset camera behind and above avatar, lookAt avatar head
  const offset = new THREE.Vector3(0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z)
  offset.applyQuaternion(qYaw)
  camera.position.set(avatarPos[0] + offset.x, ...)
  camera.lookAt(lookTarget)
  camera.rotateX(pitch)
} else {
  // First-person (static mode): camera at avatar position, direct yaw+pitch
  camera.position.set(avatarPos[0], avatarPos[1], avatarPos[2])
  camera.quaternion.copy(qYaw).multiply(qPitch)
}
```

Third-person path (connected, `camOffset = [0, 2, 4]`) is unchanged.
First-person path (static, `camOffset = [0, 0, 0]`) positions the camera
at the avatar node's translation and applies `qYaw × qPitch` directly —
no degenerate `lookAt`.

---

## No test changes

NavigationController requires no changes — it already handles both cases
via `avatar.localNode`. The static bare node satisfies the null check and
responds to translation/rotation writes identically to a real avatar node.

All 182 automated tests continue to pass (44 client / 63 SOM / 43 protocol
/ 32 server).
