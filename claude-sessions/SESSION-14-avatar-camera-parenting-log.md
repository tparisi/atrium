# Session 14 Log — Avatar-Camera Parenting

## 2026-03-26

---

## Summary

Refactored `apps/client` navigation so the SOM is the source of truth for avatar position and
camera orientation. Navigation input now drives SOM nodes; the tick loop reads SOM state to
sync the Three.js rendering camera in a third-person view above and behind the avatar capsule.

---

## Changes by File

### `packages/client/src/AtriumClient.js`

**`get displayName()`** — new public getter exposing `this._displayName` so `app.js` can read
the session display name after `session:ready`.

**`_attachNodeListeners(node)`** — skip the local avatar node at the top of the method:

```javascript
if (nodeName === this._avatarNodeName) return
```

The local avatar's position is communicated exclusively via `view` messages. All other node
mutations still go through `send`/`set`.

---

### `apps/client/src/app.js`

**Constants** added near camera setup:

```javascript
const CAMERA_OFFSET_Y = 2.0   // meters above avatar
const CAMERA_OFFSET_Z = 4.0   // meters behind avatar (+Z = behind in glTF)
```

**`localAvatarNode` / `localCameraNode`** module-level variables, initialized to `null`.

**`session:ready` handler** — runs after the server confirms the session and sends the
`som-dump`. Looks up the avatar node by display name, creates a local-only camera child node
with the third-person offset, and wires it as a child of the avatar node:

```javascript
client.on('session:ready', () => {
  if (!client.som) return
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

The camera child node is local-only — not sent to the server and not part of the avatar
descriptor. Peers don't need it; only the position and look vector from `view` messages matter.

**Tick loop refactored** — two code paths:

*SOM-driven (avatar present after session:ready):*
- Yaw quaternion → `localAvatarNode.rotation`
- WASD movement → `localAvatarNode.translation` (Y clamped to 0.7, avatar height)
- Pitch quaternion → `localCameraNode.rotation`
- Three.js camera synced from SOM each frame: world position = avatar pos + yaw-rotated offset;
  `lookAt` the avatar's head height (pos.y + 1.0); `rotateX(pitch)` applied on top for tilt
- `setView` reads position from `localAvatarNode.translation`

*Direct-drive fallback (pre-connect / static mode):*
- Original first-person camera drive unchanged — no regression for load-without-server

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

## Final Test Counts

| Package | Tests | Pass |
|---------|-------|------|
| `@atrium/protocol` | 43 | 43 |
| `@atrium/som` | 63 | 63 |
| `@atrium/server` | 32 | 32 |
| `@atrium/client` | 18 | 18 |
| **Total** | **156** | **156** |
