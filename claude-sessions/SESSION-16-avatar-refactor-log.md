# Session 16 Log — Avatar Refactor

## 2026-03-31

---

## Summary

Introduced `AvatarController` and `NavigationController` to centralize avatar lifecycle
and navigation input. Eliminated the manual `peerMeshes` Three.js mesh path from
`app.js` in favor of DocumentView rendering all avatar nodes. Fixed two known bugs:

- **Bug 1 (late joiners — wrong peer count):** AvatarController now scans all SOM
  nodes on `world:loaded` and registers any peer avatars already present from the
  `som-dump`. Previously, `peerMeshes` was only populated from live `peer:join`
  events, so late joiners saw 0 peers even when others were already in the session.

- **Bug 2 (gray peer capsules):** AvatarController sets a random bright color on
  each peer's SOM material (`prim.material.baseColorFactor`) when the peer is added.
  This is a SOM mutation — DocumentView propagates it to the Three.js material
  automatically. Previously, the manual Three.js mesh and the DocumentView-rendered
  SOM mesh were both present, causing z-fighting and the colored mesh being hidden.

---

## New Files

### `packages/client/src/AvatarController.js`

Manages all avatar state in the SOM. Never constructs or inspects mesh geometry
directly — only operates on SOM node properties.

**Constructor:** `new AvatarController(client, { cameraOffsetY, cameraOffsetZ })`

**Lifecycle — local avatar:**
- On `world:loaded` (when connected): looks up `client.som.getNodeByName(displayName)`,
  creates a camera child node at `[0, offsetY, offsetZ]`, adds it as a child of the
  avatar node, emits `avatar:local-ready`.

**Lifecycle — peers:**
- On `world:loaded`: scans `som.nodes` for nodes with `extras.displayName` that are
  not the local avatar. Registers each as a peer and emits `avatar:peer-added`. This
  is the late-joiner fix.
- On `peer:join`: looks up the peer node by display name, sets a random bright color
  on the peer's SOM material, registers in the peer map, emits `avatar:peer-added`.
- On `peer:leave`: removes from peer map, emits `avatar:peer-removed`.
- On `disconnected`: clears `_localNode`, `_cameraNode`, peer map, and last-sent view.

**`setView()` with delta optimization:**
Compares `position`, `look`, `move`, `up` (via `vec3Equal`) and `velocity` (scalar
epsilon) against last-sent values. Skips the `client.setView()` call entirely when
nothing has changed — eliminates the flood of identical view messages when standing
still.

```javascript
function vec3Equal(a, b, epsilon = 0.0001) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(a[0]-b[0]) < epsilon
      && Math.abs(a[1]-b[1]) < epsilon
      && Math.abs(a[2]-b[2]) < epsilon
}
```

**Bug fixed during implementation:** original `vec3Equal` used `!a || !b` which
returned `a === b` for nullish values. `undefined === null` is `false`, so calls
with an unset `up` parameter were always dirty. Fixed to `a == null && b == null`.

**Events emitted:**
- `avatar:local-ready` `{ node }`
- `avatar:peer-added` `{ displayName, node }`
- `avatar:peer-removed` `{ displayName }`

**Public API:**
- `avatar.localNode`, `avatar.cameraNode`, `avatar.peerCount`, `avatar.getPeerNode(name)`
- `avatar.setView({ position, look, move, velocity, up })`
- `avatar.on(event, handler)`

---

### `packages/client/src/NavigationController.js`

Translates user input into SOM node mutations. No Three.js dependency — all
quaternion and vector math is done manually.

**Module-level helpers:**
```javascript
function yawQuat(yaw)   { return [0, Math.sin(yaw/2), 0, Math.cos(yaw/2)] }
function pitchQuat(p)   { return [Math.sin(p/2), 0, 0, Math.cos(p/2)] }
function forwardVec(yaw){ return [Math.sin(yaw), 0, -Math.cos(yaw)] }
function rightVec(yaw)  { return [Math.cos(yaw), 0,  Math.sin(yaw)] }
```

**Constructor:** `new NavigationController(avatar, { mode, mouseSensitivity })`

**Input methods (called from DOM event handlers in `app.js`):**
- `nav.onMouseMove(dx, dy)` — updates yaw/pitch, clamps pitch to `±π/2.5`
- `nav.onKeyDown(key)` / `nav.onKeyUp(key)` — tracks pressed keys in a Set
- `nav.setMode(mode)` — validates against allowed modes, stores if valid

**`nav.tick(dt)`** — called each frame with delta time in seconds:
1. Applies yaw quaternion to `avatar.localNode.rotation`
2. Applies pitch quaternion to `avatar.cameraNode.rotation`
3. Computes WASD movement on XZ plane, applies scaled by `speed * dt`
4. Calls `avatar.setView({ position, look, move, velocity })` — look is yaw-only
   (`forwardVec(yaw)`), no pitch component

**NavigationInfo integration:** On `avatar:local-ready`, reads
`som.document.getRoot().getExtras()?.atrium?.navigation` for `speed.default` and
`mode[]`. If present, overrides defaults.

**WALK mode only implemented.** FLY and ORBIT accepted in `setMode()` (if
NavigationInfo allows) but `tick()` falls back to WALK behavior.

**Public API:**
- `nav.mode`, `nav.yaw`, `nav.pitch`
- `nav.onMouseMove(dx, dy)`, `nav.onKeyDown(key)`, `nav.onKeyUp(key)`
- `nav.setMode(mode)`, `nav.tick(dt)`

---

## Modified Files

### `packages/client/src/AtriumClient.js`

One change in `connect()` — stamps `extras.atrium.ephemeral = true` on the avatar
descriptor alongside the existing `displayName` stamp:

```javascript
this._avatarDescriptor.extras.atrium = {
  ...(this._avatarDescriptor.extras.atrium ?? {}),
  ephemeral: true,
}
```

This marks avatar nodes as session-scoped for future canonical world serialization.
The field is set but not yet consumed.

---

### `apps/client/src/app.js`

**Removed:**
- `peerMeshes` Map
- `buildCapsuleMesh`, `addPeerMesh`, `removePeerMesh`, `updatePeerMesh` functions
- Inline `yaw`, `pitch`, `keys`, `pointerLock`, `dragging` navigation state
- `getLookVector()`, `getMoveVector()` functions
- Direct `client.setView()` calls
- Camera child node creation (moved to AvatarController)
- `peer:join` / `peer:leave` / `peer:view` handlers that created/updated Three.js meshes

**Added:**
```javascript
const avatar = new AvatarController(client, {
  cameraOffsetY: CAMERA_OFFSET_Y,
  cameraOffsetZ: CAMERA_OFFSET_Z,
})
const nav = new NavigationController(avatar, {
  mode: 'WALK',
  mouseSensitivity: 0.002,
})
```

DOM events now delegate to NavigationController:
```javascript
document.addEventListener('mousemove', (e) => {
  if (!dragging) return
  nav.onMouseMove(e.movementX, e.movementY)
})
document.addEventListener('keydown', (e) => nav.onKeyDown(e.code))
document.addEventListener('keyup',   (e) => nav.onKeyUp(e.code))
```

Tick loop:
```javascript
nav.tick(dt)
// Three.js camera sync from SOM (stays in app.js)
const localNode = avatar.localNode
if (localNode && avatar.cameraNode) {
  // read nav.yaw/pitch, compute world-space camera position from SOM
}
renderer.render(threeScene, camera)
```

HUD peer count now reads `avatar.peerCount` instead of `peerMeshes.size`.

Avatar events update HUD and log to console:
```javascript
avatar.on('avatar:peer-added',   ({ displayName }) => { updateHud(); console.log(...) })
avatar.on('avatar:peer-removed', ({ displayName }) => { updateHud(); console.log(...) })
```

---

### `apps/client/index.html`

Two entries added to the import map:
```json
"@atrium/client/AvatarController":     "../../packages/client/src/AvatarController.js",
"@atrium/client/NavigationController": "../../packages/client/src/NavigationController.js"
```

---

## New Tests

### `packages/client/tests/avatar-controller.test.js` — 13 tests

- `localNode` null before `world:loaded`
- `localNode` set after `world:loaded` when connected
- Camera child node created with correct offset translation
- `avatar:local-ready` fires at correct time
- Peer tracked from `peer:join`
- Peer removed on `peer:leave`
- Pre-existing peers scanned from `som-dump` (late-joiner fix)
- `avatar:peer-added` fires for live join
- `avatar:peer-removed` fires on `peer:leave`
- `setView` skipped when nothing changes (delta optimization)
- `setView` sent when position changes
- `disconnected` clears all state
- Ephemeral flag set on avatar descriptor (via AtriumClient)

### `packages/client/tests/navigation-controller.test.js` — 13 tests

- Yaw state updated by `onMouseMove`
- Pitch clamped to `±π/2.5`
- No position change with no keys pressed
- KeyW moves forward (translation Z < 0)
- KeyS moves backward (Z > 0)
- KeyA strafes left (X < 0)
- KeyD strafes right (X > 0)
- Yaw quaternion applied to `localNode.rotation`
- Pitch quaternion applied to `cameraNode`, not `localNode`
- `setView` called with position and look after tick
- Look vector is yaw-only (`look[1] === 0`)
- `setMode` validates against allowed modes
- Tick with no keys produces zero velocity in `setView`

---

## Final Test Counts

| Package | Tests | Pass |
|---------|-------|------|
| `@atrium/protocol` | 43 | 43 |
| `@atrium/som` | 63 | 63 |
| `@atrium/server` | 32 | 32 |
| `@atrium/client` | 44 | 44 |
| **Total** | **182** | **182** |
