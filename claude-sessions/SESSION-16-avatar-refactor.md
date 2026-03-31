# Session 16 — Avatar Refactor

## 2026-03-31 · Design Brief for Claude Code

---

## Context

Avatar lifecycle is currently split between AtriumClient and `apps/client/src/app.js`.
AtriumClient handles SOM ingestion and protocol, while `app.js` manually creates
Three.js meshes for peer avatars, manages a `peerMeshes` Map, assembles `view`
messages every frame, and syncs the camera rig. This split causes two known bugs:

- **Bug 1:** Late-joining clients show wrong peer count — `peerMeshes` is not
  populated for peers that arrived via `som-dump`
- **Bug 2:** Peer capsules render gray — DocumentView renders the SOM material
  while `addPeerMesh` creates a separate colored Three.js mesh that may be
  hidden behind it

Both bugs stem from a dual rendering path: DocumentView renders avatar SOM nodes,
AND `app.js` creates manual Three.js meshes for the same avatars.

This session introduces two new classes (AvatarController, NavigationController),
eliminates the manual mesh path in favor of DocumentView, and adds delta-based
view send optimization.

**Reference:** `Project_Atrium_2026-03-30.md` in `docs/` is the full project
handoff. Read it for architecture, conventions, and known issues.

**Reference:** `docs/sessions/SESSION-15-browser-ux.md` for the current state
of `apps/client` after Session 15.

---

## Design Principles

These constraints govern the entire refactor:

1. **AtriumClient is unchanged.** No modifications to `packages/client/src/AtriumClient.js`.
   It remains the connection/protocol/SOM sync layer.

2. **Principle #6 preserved.** AvatarController and NavigationController never
   construct or inspect mesh geometry. They operate on SOM nodes only.

3. **SOM is source of truth (Principle #7).** All avatar state lives in SOM nodes.
   No parallel data structures for tracking avatars.

4. **Option A rendering.** DocumentView renders all avatar nodes. The manual
   Three.js mesh path (`addPeerMesh` / `updatePeerMesh` / `removePeerMesh` and
   the `peerMeshes` Map) is eliminated entirely.

5. **Avatars are ephemeral (the cursor analogy).** Avatar nodes are full SOM
   citizens at runtime — geometry, materials, physics-ready — but they are
   session-scoped. They exist in `som-dump` for late joiners but would be
   excluded from canonical world serialization (serialization is future work,
   not in scope for this session).

---

## New File Locations

Both new classes live in `packages/client/src/`:

```
packages/client/src/
├── AtriumClient.js          # existing — unchanged
├── AvatarController.js      # new
└── NavigationController.js  # new
```

`apps/client` imports them directly from source, same pattern as AtriumClient:

```javascript
// in apps/client index.html import map:
"@atrium/client/AvatarController":    "../../packages/client/src/AvatarController.js"
"@atrium/client/NavigationController": "../../packages/client/src/NavigationController.js"
```

---

## AvatarController

### Role

Manages the local avatar node and all peer avatar nodes in the SOM. Owns the
camera child node. Owns `setView` calls with delta-based send optimization.
Emits events the app uses to attach rendering (geometry, materials, colors).

### Constructor

```javascript
const avatar = new AvatarController(client, {
  cameraOffsetY: 2.0,    // meters above avatar
  cameraOffsetZ: 4.0,    // meters behind avatar
})
```

`client` is the AtriumClient instance. AvatarController reads `client.som`,
`client.connected`, `client.displayName`, and calls `client.setView()`.

### Lifecycle — Local Avatar

AvatarController listens on AtriumClient events to manage the local avatar:

1. **`world:loaded`** — if connected:
   - Look up the local avatar node: `client.som.getNodeByName(client.displayName)`
   - Create the camera child node:
     `client.som.createNode({ name: '${displayName}-camera', translation: [0, offsetY, offsetZ] })`
   - Add camera node as child of avatar node
   - Emit `avatar:local-ready` with `{ node: localAvatarNode }`
   - The app listens for this event — this is where it knows its avatar node
     exists and can inspect it, but the app does NOT create geometry (the
     descriptor already has geometry from `connect()`)

2. **`disconnected`** — clear `localAvatarNode` and `localCameraNode` references

### Lifecycle — Peer Avatars

AvatarController tracks all peers in an internal Map keyed by display name.

**Live joins — `peer:join` event:**
- Look up the peer node: `client.som.getNodeByName(displayName)`
- Add to peer map
- Set a random bright color on the peer's SOM material:
  ```javascript
  const r = Math.random() * 0.5 + 0.5
  const g = Math.random() * 0.5 + 0.5
  const b = Math.random() * 0.5 + 0.5
  peerNode.mesh.primitives[0].material.baseColorFactor = [r, g, b, 1]
  ```
  This is a SOM mutation — DocumentView will propagate it to the Three.js
  material automatically. No manual Three.js mesh creation.
- Emit `avatar:peer-added` with `{ displayName, node: peerNode }`

**Late joiners — `som-dump` peers:**
After `world:loaded`, AvatarController scans all SOM nodes to find peers
that are already present (nodes with `extras.displayName` that are not the
local avatar and not world geometry). For each:
- Add to peer map
- Set random color on SOM material (same as live join path)
- Emit `avatar:peer-added`

Identifying peer nodes: peer avatar nodes have `extras.displayName` set by
AtriumClient during `connect()`. World geometry nodes do not have this field.
This is the discriminator.

**Peer leave — `peer:leave` event:**
- Remove from peer map
- Emit `avatar:peer-removed` with `{ displayName }`

**Peer count:**
```javascript
avatar.peerCount   // getter — returns peer map size
```

### `setView` and Delta-Based Send Optimization

AvatarController owns `setView` — the app no longer calls `client.setView()`
directly.

```javascript
avatar.setView({ position, look, move, velocity, up })
```

Before forwarding to `client.setView()`, AvatarController compares each field
against the last-sent values. If nothing has changed, the call is skipped
entirely. This eliminates the flood of identical `view` messages when the user
is standing still.

**Comparison logic:**

```javascript
function vec3Equal(a, b, epsilon = 0.0001) {
  return Math.abs(a[0] - b[0]) < epsilon
      && Math.abs(a[1] - b[1]) < epsilon
      && Math.abs(a[2] - b[2]) < epsilon
}
```

Compare `position`, `look`, `move`, `up` with `vec3Equal`. Compare `velocity`
with a scalar epsilon. If ALL fields match the last-sent values, skip the send.

Store last-sent values after each successful send:

```javascript
this._lastSentView = { position: [...position], look: [...look], ... }
```

Copy arrays to avoid reference aliasing.

**Important:** The time-based heartbeat (`positionInterval`) in AtriumClient's
existing send policy still applies. AvatarController's delta check is an
additional optimization that prevents redundant calls to `setView`. AtriumClient
still decides when to actually send based on its rate policy.

### Events

```javascript
avatar.on('avatar:local-ready', ({ node }) => {})
avatar.on('avatar:peer-added', ({ displayName, node }) => {})
avatar.on('avatar:peer-removed', ({ displayName }) => {})
```

AvatarController uses the same `on`/`emit` pattern as AtriumClient (simple
EventEmitter or equivalent).

### Public API Summary

```javascript
avatar.localNode          // SOMNode — the local avatar, null before world:loaded
avatar.cameraNode         // SOMNode — the camera child, null before world:loaded
avatar.peerCount          // number — current peer count
avatar.getPeerNode(name)  // SOMNode or null

avatar.setView({ position, look, move, velocity, up })

avatar.on(event, handler)
```

---

## NavigationController

### Role

Translates user input into avatar state changes. Reads NavigationInfo from the
SOM to determine available modes and speed parameters. Applies position and
orientation changes to AvatarController's SOM nodes. Knows nothing about
Three.js, DOM events, or networking.

### Constructor

```javascript
const nav = new NavigationController(avatarController, {
  mode: 'WALK',           // initial mode — overridden by NavigationInfo if present
  mouseSensitivity: 0.002,
})
```

`avatarController` is the AvatarController instance. NavigationController reads
`avatar.localNode` and `avatar.cameraNode` to apply transforms.

### NavigationInfo Integration

When the SOM is ready (after `avatar:local-ready`), NavigationController reads
NavigationInfo from the SOM:

```javascript
const root = client.som.document.getRoot()
const extras = root.getExtras()
const navInfo = extras?.atrium?.navigation
```

NavigationController uses:
- `mode` — array of allowed modes; first entry is default
- `speed.default` / `speed.min` / `speed.max` — movement speed
- `updateRate.positionInterval` / `updateRate.maxViewRate` — passed through
  (AtriumClient already reads these, but NavigationController may need speed)

If NavigationInfo is absent, NavigationController uses sensible defaults
(WALK mode, speed 1.4 m/s).

### Input Methods

The app calls these from DOM event handlers. NavigationController does not
listen to DOM events directly.

```javascript
nav.onMouseMove(movementX, movementY)
// Applies yaw and pitch based on sensitivity and current mode.
// In WALK/FLY: free look. In ORBIT: orbital rotation around focus point.

nav.onKeyDown(key)
nav.onKeyUp(key)
// Tracks pressed keys in a Set. Keys: 'W', 'S', 'A', 'D', 'ArrowUp', etc.

nav.setMode(mode)
// Switch navigation mode ('WALK', 'FLY', 'ORBIT'). Validates against
// NavigationInfo's allowed modes.
```

### Tick

```javascript
nav.tick(deltaTime)
```

Called by the app each frame with delta time in seconds. NavigationController:

1. Reads currently pressed keys
2. Computes movement vector relative to current yaw (WALK: XZ plane only;
   FLY: along look vector including pitch)
3. Applies speed from NavigationInfo
4. Updates `avatar.localNode.translation` (position)
5. Updates `avatar.localNode.rotation` (yaw quaternion)
6. Updates `avatar.cameraNode.rotation` (pitch quaternion)
7. Calls `avatar.setView()` with current state:
   - `position`: from `localNode.translation`
   - `look`: yaw-only forward vector (no pitch — per existing design)
   - `move`: movement direction unit vector, `[0,0,0]` if still
   - `velocity`: current speed in m/s, `0` if still
   - `up`: omitted in WALK mode (defaults to `[0,1,0]`)

### Yaw and Pitch State

NavigationController owns yaw and pitch as internal state (radians). These
are the same values currently tracked as bare variables in `app.js`.

```javascript
this._yaw = 0
this._pitch = 0
```

Pitch is clamped to prevent flipping (same clamp as current `app.js`):

```javascript
this._pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this._pitch))
```

### Navigation Modes (Session 16 scope)

Only **WALK** mode needs to be fully implemented for Session 16. This matches
the current `app.js` behavior:

- Movement on the XZ ground plane
- Yaw rotates the avatar
- Pitch tilts the camera (local only, not sent to peers)
- `up` vector is always `[0,1,0]`, omitted from `view` messages

FLY and ORBIT modes are stubbed — `setMode('FLY')` and `setMode('ORBIT')`
should be accepted (if NavigationInfo allows them) and stored, but `tick()`
falls back to WALK behavior. Full implementation is future work.

### Public API Summary

```javascript
nav.mode                  // current mode string
nav.yaw                   // current yaw (radians, read-only)
nav.pitch                 // current pitch (radians, read-only)

nav.onMouseMove(dx, dy)
nav.onKeyDown(key)
nav.onKeyUp(key)
nav.setMode(mode)
nav.tick(deltaTime)
```

---

## Changes to `apps/client/src/app.js`

### What Gets Removed

- `addPeerMesh` / `updatePeerMesh` / `removePeerMesh` functions — eliminated
- `peerMeshes` Map — eliminated
- Manual yaw/pitch/position tracking variables — moved to NavigationController
- `view` message assembly and `client.setView()` calls — moved to
  AvatarController/NavigationController
- Camera child node creation — moved to AvatarController
- `peer:join` / `peer:view` / `peer:leave` handlers that create/update/remove
  Three.js meshes — replaced with AvatarController event handlers

### What Stays

- Three.js renderer/scene/camera setup
- DocumentView initialization and `docView.view()` call
- The render loop: `renderer.render(threeScene, camera)`
- Three.js camera sync from SOM state each frame (reading avatar node and
  camera child node positions from the SOM to position the Three.js camera)
- DOM event listeners (mouse, keyboard) — but they now delegate to
  NavigationController
- HUD updates, connection state UI, drag-to-look toggle (Session 15 features)
- Avatar descriptor construction (capsule geometry + material) — still built
  by the app, passed to `client.connect({ avatar: descriptor })`

### What Changes

**Initialization:**

```javascript
import { AtriumClient } from '@atrium/client'
import { AvatarController } from '@atrium/client/AvatarController'
import { NavigationController } from '@atrium/client/NavigationController'

const client = new AtriumClient({ debug: false })
const avatar = new AvatarController(client, {
  cameraOffsetY: CAMERA_OFFSET_Y,
  cameraOffsetZ: CAMERA_OFFSET_Z,
})
const nav = new NavigationController(avatar, {
  mode: 'WALK',
  mouseSensitivity: 0.002,
})
```

**DOM event wiring (drag-to-look example):**

```javascript
viewportEl.addEventListener('mousedown', () => { dragging = true })
document.addEventListener('mouseup', () => { dragging = false })
document.addEventListener('mousemove', (e) => {
  if (!dragging) return
  nav.onMouseMove(e.movementX, e.movementY)
})

document.addEventListener('keydown', (e) => nav.onKeyDown(e.key))
document.addEventListener('keyup', (e) => nav.onKeyUp(e.key))
```

**Tick loop:**

```javascript
function tick() {
  const now = performance.now()
  const deltaTime = (now - lastTime) / 1000
  lastTime = now

  nav.tick(deltaTime)

  // Three.js camera sync from SOM (stays in app.js)
  if (avatar.localNode && avatar.cameraNode) {
    // read SOM node positions, compute Three.js camera transform
    // (same math as current app.js, reading from avatar.localNode
    //  and avatar.cameraNode instead of local variables)
  }

  renderer.render(threeScene, camera)
  requestAnimationFrame(tick)
}
```

**Avatar events:**

```javascript
avatar.on('avatar:local-ready', ({ node }) => {
  // Avatar node exists in SOM with geometry — DocumentView renders it.
  // App can do any additional setup here (e.g. UI updates).
  // No Three.js mesh creation needed.
})

avatar.on('avatar:peer-added', ({ displayName, node }) => {
  // Peer node exists in SOM with colored material — DocumentView renders it.
  // Update HUD peer count.
  updateHud()
})

avatar.on('avatar:peer-removed', ({ displayName }) => {
  // Peer node already removed from SOM by AtriumClient.
  // Update HUD peer count.
  updateHud()
})
```

**HUD peer count** now reads from `avatar.peerCount` instead of
`peerMeshes.size`.

---

## DocumentView Dependency — MUST VERIFY

The entire Option A approach depends on DocumentView propagating changes for
dynamically added nodes. The handoff doc notes: "it is not confirmed whether
dynamically added nodes are fully observed."

**Before implementing the full refactor, Claude Code must test this:**

1. Load a world via DocumentView
2. Add a new node to the SOM (via `som.ingestNode()`) after the initial
   `docView.view()` call
3. Check if the new node appears in the Three.js scene

**If DocumentView does NOT handle dynamic additions:**

Fall back to a hybrid approach — still eliminate the `peerMeshes` Map and
track peers in AvatarController, but create Three.js meshes from
AvatarController's `avatar:peer-added` event instead of relying on
DocumentView. This is less clean but still fixes both bugs and centralizes
avatar lifecycle. Document the finding for future work.

**If DocumentView DOES handle dynamic additions:**

Proceed with pure Option A as designed. The manual mesh path is fully
eliminated.

---

## Ephemeral Node Marking

Avatar nodes are marked as session-scoped via `extras`:

```json
{
  "extras": {
    "displayName": "User-3f2a",
    "atrium": {
      "ephemeral": true
    }
  }
}
```

`ephemeral: true` signals that this node should be excluded from canonical
world serialization (future work). For Session 16, the field is set but not
consumed — it's forward-looking metadata.

**Who sets it:** AtriumClient already stamps `name` and `extras.displayName`
onto the avatar descriptor in `connect()`. The `ephemeral` flag should be
stamped at the same time. This is the ONE small change to AtriumClient
permitted in this session — adding `extras.atrium.ephemeral = true` to the
avatar descriptor in `connect()`.

---

## Testing Strategy

### New Unit Tests

Add tests in `packages/client/tests/`:

**AvatarController tests:**
- Local avatar node setup on `world:loaded`
- Camera child node creation with correct offset
- Peer tracking from `peer:join` events
- Peer tracking from `som-dump` (pre-existing peers)
- Peer removal on `peer:leave`
- `peerCount` accuracy
- `setView` delta optimization — skip send when nothing changes
- `setView` sends when values change
- `avatar:local-ready` event fires at correct time
- `avatar:peer-added` / `avatar:peer-removed` events fire correctly
- Random color applied to peer SOM material on `peer:added`
- Ephemeral flag set on avatar nodes

**NavigationController tests:**
- WALK mode: forward/backward movement on XZ plane
- WALK mode: strafe left/right
- Yaw rotation from mouse X movement
- Pitch rotation from mouse Y movement, clamped
- Pitch not included in `view` look vector
- Speed read from NavigationInfo
- Mode validation against NavigationInfo allowed modes
- `tick()` with no keys pressed produces zero movement
- `setView` called with correct values after tick

### Manual Testing

After implementation, re-run the Session 15 test plan (Tests 4–8) to verify:
- Peer count correct for late joiners (Bug 1 fixed)
- Peer capsules show random colors (Bug 2 fixed)
- Connection state UI works end-to-end
- Drag-to-look and WASD movement work through NavigationController
- HUD updates correctly from AvatarController events
- Third-person camera rig works via AvatarController's camera child node

---

## Scope Boundary

**In scope:**
- `AvatarController.js` — new file in `packages/client/src/`
- `NavigationController.js` — new file in `packages/client/src/`
- `apps/client/src/app.js` — refactored to use new controllers
- `apps/client/index.html` — import map additions
- `packages/client/src/AtriumClient.js` — ONE change: stamp
  `extras.atrium.ephemeral = true` on avatar descriptor in `connect()`
- Unit tests for both new classes
- DocumentView dynamic node verification (test first)

**Explicitly deferred:**
- FLY and ORBIT mode implementation (stubs only)
- AtriumRenderer / Three.js abstraction
- Navigation mode toggle hotkey (UX backlog)
- Canonical world serialization (future)
- `ATRIUM_world` glTF extension
- SOM Inspector tool (backlog)

---

## Design Principles Check

| Principle | Respected |
|---|---|
| Design before code | ✅ This brief |
| No throwaway code | ✅ Both classes are permanent architecture |
| Incremental correctness | ✅ Verify DocumentView first, then build |
| glTF on the wire | ✅ Avatar descriptors unchanged |
| Server is policy-free on geometry | ✅ No server changes |
| AtriumClient is geometry-agnostic | ✅ One small extras change, no geometry |
| SOM is source of truth | ✅ All avatar state in SOM, no parallel structures |
| Static first, multiplayer second | ✅ NavigationController works without connection |
| glTF is world state | ✅ Avatars are full SOM nodes, ephemeral-marked for serialization |
