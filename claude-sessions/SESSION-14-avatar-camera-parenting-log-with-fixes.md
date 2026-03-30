# Session 14 Log — Avatar-Camera Parenting

## 2026-03-26

---

## Summary

Refactored `apps/client` navigation so the SOM is the source of truth for avatar position and
camera orientation. Navigation input now drives SOM nodes; the tick loop reads SOM state to
sync the Three.js rendering camera in a third-person view above and behind the avatar capsule.

Session included both a Claude Code pass and a manual testing/fix pass. Several bugs were
found and fixed during manual testing.

---

## Changes by File

### `packages/client/src/AtriumClient.js`

**`get displayName()`** — new public getter exposing `this._displayName` so `app.js` can read
the session display name after `session:ready`.

**`get connected()`** — new public getter exposing `this._connected`. Returns `true` if the
client is currently connected to a world server, `false` otherwise. Used by `app.js` to
distinguish static load from multiplayer mode in the `world:loaded` handler.

**`_attachNodeListeners(node)`** — skip the local avatar node at the top of the method:

```javascript
if (nodeName === this._avatarNodeName) return
```

The local avatar's position is communicated exclusively via `view` messages. All other node
mutations still go through `send`/`set`.

**Avatar descriptor name stamping in `connect()`** — AtriumClient now stamps its own
`displayName` onto the avatar descriptor received from `app.js`:

```javascript
if (this._avatarDescriptor) {
  this._avatarDescriptor.name = this._displayName
  this._avatarDescriptor.extras = { ...this._avatarDescriptor.extras, displayName: this._displayName }
}
```

This fixes a bug where `apps/client`'s `deriveIdentity()` generated a separate UUID from
`connect()`, causing the avatar node name to mismatch the session-derived display name.
The mismatch broke peer join/add correlation and peer avatar lookups in `_onView`.

---

### `apps/client/src/app.js`

**Constants** added near camera setup:

```javascript
const CAMERA_OFFSET_Y = 2.0   // meters above avatar
const CAMERA_OFFSET_Z = 4.0   // meters behind avatar (+Z = behind in glTF)
```

**`localAvatarNode` / `localCameraNode`** module-level variables, initialized to `null`.

**`deriveIdentity()` removed** — this function generated a separate UUID to derive a display
name for the avatar descriptor. With AtriumClient now stamping its own display name onto the
descriptor, this function is unnecessary and was the root cause of the name mismatch bug.

**`buildAvatarDescriptor()` simplified** — no longer takes a `name` parameter. Returns a
descriptor without `name` or `extras.displayName` (AtriumClient stamps these in `connect()`).

**Random capsule colors** — `buildAvatarDescriptor` now generates a random `baseColorFactor`:

```javascript
baseColorFactor: [Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, 1.0],
```

`buildCapsuleMesh` (for peer avatars rendered via Three.js) also uses a random color:

```javascript
const r = Math.random() * 0.5 + 0.5, g = Math.random() * 0.5 + 0.5, b = Math.random() * 0.5 + 0.5
const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g, b) })
```

**Connect button handler simplified:**

```javascript
connectBtn.addEventListener('click', () => {
  if (connectBtn.textContent === 'Disconnect') {
    client.disconnect()
    return
  }
  const wsUrl = wsUrlInput.value.trim()
  if (!wsUrl) return
  setStatus('connecting')
  const avatar = buildAvatarDescriptor()
  client.connect(wsUrl, { avatar })
})
```

**Avatar/camera setup moved from `session:ready` to `world:loaded`** — `session:ready` fires
before `_onSomDump`, so the SOM doesn't exist yet and `getNodeByName` returns `null`. The
`world:loaded` event fires at the end of `_onSomDump` after the avatar node has been ingested.
Guards on `client.connected` to skip setup during static loads:

```javascript
client.on('world:loaded', () => {
  if (!client.som) return
  if (!client.connected) return
  const displayName = client.displayName
  localAvatarNode = client.som.getNodeByName(displayName)
  if (!localAvatarNode) return

  localCameraNode = client.som.createNode({
    name:        `${displayName}-camera`,
    translation: [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z],
  })
  localAvatarNode.addChild(localCameraNode)
})
```

**Tick loop refactored** — two code paths:

*SOM-driven (avatar present after world:loaded):*
- Yaw quaternion → `localAvatarNode.rotation`
- WASD movement → `localAvatarNode.translation` (Y clamped to 0.7, avatar height)
- Pitch quaternion → `localCameraNode.rotation`
- Three.js camera synced from SOM each frame: world position = avatar pos + yaw-rotated offset;
  `lookAt` the avatar's head height (pos.y + 1.0); `rotateX(pitch)` applied on top for tilt
- `setView` reads position from `localAvatarNode.translation`

*Direct-drive fallback (pre-connect / static mode):*
- Original first-person camera drive unchanged — no regression for load-without-server

**`setView` sends avatar look, not camera look** — the `look` vector sent in `view` messages
is now the avatar's yaw-only forward direction, not the camera's combined yaw+pitch direction:

```javascript
const avatarLook = [Math.sin(yaw), 0, -Math.cos(yaw)]
client.setView({
    position: localAvatarNode.translation,
    look: avatarLook,
    move: move ?? [0, 0, 0],
    velocity: move ? SPEED : 0,
})
```

This fixes a bug where peer capsules were pitching and rolling because the receiving client
applied the full camera orientation (including pitch) to the peer's avatar node via
`lookToQuaternion`. With yaw-only data, peer capsules only rotate on the Y axis.

**`window.atriumClient = client`** — exposed for manual console testing.

---

## Bugs Found and Fixed During Manual Testing

### Bug: Peer capsule not appearing in first client when second user joins

**Root cause:** `deriveIdentity()` in `app.js` generated a UUID separate from the one
`AtriumClient.connect()` generates. The avatar descriptor was named `User-XXXX` but the
session ID derived `User-YYYY`. When `_onAdd` tried to correlate the incoming node name
with `_peerSessions` (populated from `_onJoin` using the session ID), names didn't match.
`peer:join` never fired, so `addPeerMesh` was never called.

**Fix:** Removed `deriveIdentity()`. `buildAvatarDescriptor()` no longer sets a name.
AtriumClient stamps its own `displayName` onto the descriptor in `connect()`.

### Bug: Local avatar capsule not moving with WASD navigation

**Root cause:** `session:ready` fires from `_onServerHello`, which runs *before*
`_onSomDump`. At the time `session:ready` fires, the SOM doesn't exist yet —
`_initSom` hasn't been called and the avatar node hasn't been ingested.
`getNodeByName(displayName)` returned `null`, `localAvatarNode` was never set,
and the tick loop fell through to the direct-drive fallback path.

**Fix:** Moved avatar/camera setup from `session:ready` handler to `world:loaded` handler,
which fires at the end of `_onSomDump` after the avatar is ingested.

### Bug: Peer capsules pitching when remote user looks up/down

**Root cause:** `setView` was sending the camera's `getLookVector()` which includes both
yaw and pitch. The receiver applied this via `lookToQuaternion` to the peer avatar node,
causing the capsule to tilt.

**Fix:** `setView` now sends a yaw-only avatar forward vector:
`[Math.sin(yaw), 0, -Math.cos(yaw)]`. No protocol change — same `look` field, different
data.

### Bug: All capsules same color

**Fix:** Random color generation in both `buildAvatarDescriptor` (sent to server) and
`buildCapsuleMesh` (local Three.js peer rendering). Colors biased toward brighter values
via `Math.random() * 0.5 + 0.5`.

---

## Tests

### `packages/client/tests/client.test.js` — 2 new tests (+2, now 18 total)

**`mutation-sync — avatar node excluded from mutation listeners → no send emitted`**
Wires a client with `_avatarNodeName = 'User-avtr'`, builds a SOM with an `'User-avtr'` node
and a `'Crate'` node, attaches listeners, mutates the avatar node's translation — verifies
zero `send` messages emitted.

**`mutation-sync — non-avatar node mutation still produces send when avatar present`**
Same setup — mutates `'Crate'` instead — verifies a `send` message is emitted with correct
`node`, `field`, and `value`.

---

## Known Issues (deferred)

- **Possible duplicate capsule rendering** — DocumentView may render avatar nodes from the
  SOM scene graph while `addPeerMesh` also creates a manual Three.js mesh. Not visibly
  broken after fixes, but the two rendering paths should be reconciled in a future session.

- **Debug `view` message spew** — enabling `_debug = true` floods the console with `view`
  messages from peers. Needs throttling or a separate verbose flag. Cleanup pass deferred.

- **DocumentView camera observation** — DocumentView does not drive the Three.js rendering
  camera. `app.js` manually syncs the Three.js camera from SOM state each frame. This logic
  could move into AtriumClient in a future refactor.

---

## Final Test Counts

| Package | Tests | Pass |
|---------|-------|------|
| `@atrium/protocol` | 43 | 43 |
| `@atrium/som` | 63 | 63 |
| `@atrium/server` | 32 | 32 |
| `@atrium/client` | 18 | 18 |
| **Total** | **156** | **156** |
