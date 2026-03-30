# Design Brief — Avatar-Camera Parenting

## 2026-03-20 · Design Session D (Session 14)

---

## Summary

Refactor `apps/client` navigation so that the SOM is the source of truth
for avatar position and camera orientation. Currently `app.js` drives a
Three.js camera directly, completely outside the SOM. The avatar capsule
never moves locally, and the SOM doesn't reflect the user's position.

After this change: navigation input drives SOM nodes, `app.js` reads SOM
state to sync the Three.js rendering camera each frame, and the avatar
capsule moves in the SOM — visible to peers via `view` messages and to
DocumentView. The camera is positioned in a third-person view — above
and behind the avatar — so the user can see their own capsule.

---

## Current State (Problems)

1. `app.js` owns a Three.js `camera` and drives it directly with
   `yaw`/`pitch`/`camera.position`. The SOM knows nothing about it.

2. The local avatar node sits at its initial position `[0, 0.7, 0]`
   forever. Peers never see it move through the SOM — only through
   `view` messages, which `app.js` applies to a separate Three.js mesh.

3. No relationship between the avatar and the camera in the scene graph.
   They are completely independent objects.

---

## Design

### Scene graph structure

```
Scene
  ├─ ... (world geometry)
  ├─ AuthoredCameraNode1 (translation, rotation, camera: perspective)
  ├─ AuthoredCameraNode2 (translation, rotation, camera: perspective)
  └─ AvatarNode (translation, yaw rotation, mesh: capsule)
       └─ CameraChildNode (translation: [0, 2, 4], pitch rotation, camera: AvatarCamera)
```

**AvatarNode** — holds the user's world position and yaw (Y-axis)
rotation. The capsule mesh is attached here. This is the node that peers
see moving.

**CameraChildNode** — child of AvatarNode. Has a **third-person offset**
translation that places the camera above and behind the avatar. Holds
pitch (X-axis) rotation and a perspective camera. Inherits position and
yaw from parent. The camera's projection properties (fov, near, far) are
set once at creation.

glTF uses right-handed coordinates with -Z as forward. The offset
`[0, 2, 4]` places the camera 2m above and 4m behind the avatar in
the avatar's local space (+Z is behind).

### Third-person camera constants

Tunable constants at the top of `app.js`:

```javascript
const CAMERA_OFFSET_Y     = 2.0    // meters above avatar
const CAMERA_OFFSET_Z     = 4.0    // meters behind avatar (+Z = behind in glTF)
const CAMERA_FOV          = 70     // degrees
const CAMERA_NEAR         = 0.01
const CAMERA_FAR          = 1000
```

These can be adjusted to taste during testing. The offset is set once
on the camera child node at creation time.

**Authored cameras** — pre-positioned viewpoints defined in the glTF by
the world creator. Read-only reference points. When the user selects one
(via future UI), its transform and projection properties are copied into
the AvatarNode + CameraChildNode. The user then navigates freely from
that position.

### Navigation input → SOM

Navigation input updates the SOM, not Three.js directly:

```javascript
// In the tick loop:

// Yaw: rotate AvatarNode around Y
avatarNode.rotation = yawQuaternion

// Pitch: rotate CameraChildNode around X
cameraChildNode.rotation = pitchQuaternion

// Movement: update AvatarNode translation
const pos = avatarNode.translation
// apply WASD movement relative to yaw
avatarNode.translation = [newX, newY, newZ]
```

### SOM → Three.js rendering camera

`app.js` still owns the Three.js `camera` and the `renderer.render()`
call. Each frame, it computes the world-space camera position from the
avatar node transform and the camera child's local offset:

```javascript
// Avatar world position and yaw
const avatarPos = localAvatarNode.translation
const yawQuat   = new THREE.Quaternion(...localAvatarNode.rotation)

// Camera offset in avatar-local space: [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]
// Transform to world space by applying avatar's yaw rotation
const offset = new THREE.Vector3(0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z)
offset.applyQuaternion(yawQuat)

// World-space camera position = avatar position + rotated offset
camera.position.set(
    avatarPos[0] + offset.x,
    avatarPos[1] + offset.y,
    avatarPos[2] + offset.z
)

// Camera looks at the avatar (or slightly above it)
const lookTarget = new THREE.Vector3(
    avatarPos[0],
    avatarPos[1] + 1.0,   // look at head height, not feet
    avatarPos[2]
)
camera.lookAt(lookTarget)

// Apply pitch adjustment on top
// (pitch tilts the view up/down relative to the avatar)

renderer.render(threeScene, camera)
```

DocumentView does not drive the Three.js camera — it only handles scene
geometry. The app always reads from the SOM and writes to the Three.js
camera.

### SOM → `view` messages

The `setView` call in the tick loop already sends position and look.
After this refactor, it reads from the SOM instead of from Three.js
camera state:

```javascript
const position = avatarNode.translation
const look     = getLookVector()  // derived from yaw + pitch
client.setView({ position, look, move, velocity })
```

### Mutation events and the avatar node

When `app.js` sets `avatarNode.translation` each frame, this fires a
mutation event. AtriumClient's listener would try to send a `send`
message — but avatar position should go through `view`, not `send`.

Options:

**Option A — AtriumClient skips mutation events on the local avatar
node.** During `_attachNodeListeners`, skip the node whose name matches
`this._avatarNodeName`. The avatar's position is communicated exclusively
via `setView`/`view` messages.

**Option B — AtriumClient recognizes avatar nodes and routes them to
`setView` instead of `send`.** More complex, less clear.

**Recommended: Option A.** Simple, explicit. The local avatar node is
special — it's the only node whose position is driven by navigation
input every frame. All other node mutations go through `send`/`set`.

```javascript
_attachNodeListeners(node) {
    const nodeName = node.name
    // Skip local avatar — position communicated via view messages
    if (nodeName === this._avatarNodeName) return
    // ... attach listeners as before
}
```

### Peer avatar rendering

Unchanged from current design. When `peer:view` arrives:

1. AtriumClient updates the peer's SOM node translation/rotation
   (guarded by `_applyingRemote`)
2. `apps/client` receives `peer:view` event and updates the manual
   Three.js capsule mesh position

The manual Three.js mesh path remains for v0.1. When DocumentView
supports dynamic node observation, peer avatars could render through
the SOM automatically.

### Avatar descriptor changes

`buildAvatarDescriptor` now returns a descriptor with two nodes —
the avatar and the camera child. Or: the camera child is created
separately in `app.js` after `connect()` and added as a child of
the avatar node.

Simpler approach: `app.js` creates the camera child node locally
after `connect()`:

```javascript
client.on('session:ready', ({ displayName }) => {
    const avatarNode = client.som.getNodeByName(displayName)

    // Create camera child node with third-person offset
    const camNode = client.som.createNode({
        name: `${displayName}-camera`,
        translation: [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z],
    })
    avatarNode.addChild(camNode)

    // Store references for tick loop
    localAvatarNode = avatarNode
    localCameraNode = camNode
})
```

The camera child is a local-only node — not sent to the server, not
part of the avatar descriptor. Peers don't need to know about it.
Only the position and look vector matter for peers, and those go
through `view` messages.

### Authored camera switching (future)

When the user selects an authored camera viewpoint:

```javascript
function switchToViewpoint(authoredCameraNode) {
    // Copy position and yaw to avatar
    localAvatarNode.translation = authoredCameraNode.translation
    localAvatarNode.rotation = extractYaw(authoredCameraNode.rotation)

    // Copy pitch to camera child
    localCameraNode.rotation = extractPitch(authoredCameraNode.rotation)

    // Copy projection properties if they differ
    // (fov, near, far from the authored camera)

    // Update local yaw/pitch state variables to match
    yaw = extractYawAngle(authoredCameraNode.rotation)
    pitch = extractPitchAngle(authoredCameraNode.rotation)
}
```

This is not implemented in this session — noted here for design
completeness.

---

## Changes by File

### `apps/client/src/app.js`

1. Remove direct Three.js camera position/orientation driving from
   tick loop.
2. Store references to `localAvatarNode` and `localCameraNode` after
   `session:ready`.
3. Navigation input updates SOM nodes:
   - WASD → `localAvatarNode.translation`
   - Mouse yaw → `localAvatarNode.rotation`
   - Mouse pitch → `localCameraNode.rotation`
4. Each frame, read SOM state and sync to Three.js `camera`.
5. `setView` reads position from `localAvatarNode.translation`.

### `packages/client/src/AtriumClient.js`

1. `_attachNodeListeners` skips the local avatar node
   (`nodeName === this._avatarNodeName`).

---

## Automated Tests

### AtriumClient

- Local avatar node is excluded from mutation listeners — set
  `avatarNode.translation`, verify no `send` message produced
- Non-avatar nodes still produce `send` messages as before

### SOM (no new SOM tests needed)

- `addChild` on a node works and fires childList event (already tested)
- `createNode` registers in maps (already tested)

---

## Manual Tests

### Navigation

1. Load world, connect. WASD + mouse navigation works.
2. Own capsule is visible in front of and below the camera
   (third-person view).
3. Open console: `window.atriumClient.som.getNodeByName('User-XXXX').translation`
   updates as you move.
4. Two windows: peer capsule moves when the other user navigates.

### Camera orientation

5. Look left/right — capsule rotates to match yaw direction, camera
   orbits to stay behind.
6. Look up/down — camera tilts but capsule does NOT pitch (yaw only
   on avatar node).
7. Camera always remains above and behind the avatar.

### Mutation isolation

8. Navigate around — no `send` messages produced for avatar position
   (only `view` messages).
9. Change a world object property from console — `send` message IS
   produced.

### Static mode

10. Load without server. Navigate. Camera follows avatar in third-person,
    no errors.

---

## Implementation Order

1. `AtriumClient.js` — skip local avatar in `_attachNodeListeners`
2. `app.js` — create camera child node on `session:ready`
3. `app.js` — refactor tick loop: navigation input → SOM nodes
4. `app.js` — refactor tick loop: SOM → Three.js camera sync
5. `app.js` — update `setView` call to read from SOM
6. Test navigation locally (static mode, no server)
7. Test multiplayer (two windows, peer visibility and movement)
8. Verify no `send` messages from avatar movement

---

## Open Questions (deferred)

- **DocumentView camera observation:** Does DocumentView create Three.js
  cameras from glTF camera nodes? If so, can we use that instead of
  manual sync? Current answer: no, `app.js` always owns the Three.js
  camera and render call.
- **Authored camera switching UI:** Not designed yet. Noted in design
  for future reference.
- **Camera child node and `som-dump`:** The camera child node is
  local-only, but if it's part of the glTF-Transform document, it would
  appear in `som-dump` for late-joining clients. May need to mark it
  as local/ephemeral, or create it outside the document.
