# Session 13 Log — SOM Mutation Events & AtriumClient Sync

## 2026-03-20

---

## Summary

Added a DOM-inspired mutation event system to the SOM, refactored `SOMDocument` to cache all
wrappers for stable identity, and wired `AtriumClient` to automatically reflect local SOM
changes to the server. The app now only needs to mutate the SOM; if connected, changes go out
on the wire automatically with full loopback prevention.

---

## New Files

### `packages/som/src/SOMEvent.js`
Simple value object: `type`, `target`, `detail`.

### `packages/som/src/SOMObject.js`
Base class for all SOM types. DOM-style `addEventListener`, `removeEventListener`,
`_hasListeners`, `_dispatchEvent`. All SOM types now extend `SOMObject`.

---

## SOM Type Refactors

Every setter on every SOM type now fires a `mutation` event after updating the underlying
glTF-Transform object. Only allocates a `SOMEvent` if listeners are present (zero cost when
no listeners).

Setters covered:

| Type | Properties |
|------|-----------|
| `SOMNode` | `translation`, `rotation`, `scale`, `name`, `extras`, `visible`, `mesh`, `camera` |
| `SOMMaterial` | `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `emissiveFactor`, `alphaMode`, `alphaCutoff`, `doubleSided`, `name`, `extras` |
| `SOMCamera` | `type`, `yfov`, `znear`, `zfar`, `aspectRatio`, `xmag`, `ymag`, `name`, `extras` |
| `SOMMesh` | `name`, `weights`, `extras` |
| `SOMPrimitive` | `mode`, `material`, `extras` |
| `SOMAnimation` | `loop`, `timeScale` |

Child list events (`childList.addedNodes` / `childList.removedNodes`) on:
- `SOMNode.addChild` / `removeChild`
- `SOMScene.addChild` / `removeChild`
- `SOMMesh.addPrimitive` / `removePrimitive`

`SOMTexture` and `SOMSkin` extend `SOMObject` (no new setters at v0.1).

---

## SOMDocument — Wrapper Caching

`SOMDocument` now builds the full object graph at construction time. All wrappers are cached
in maps (by glTF-Transform object and by name), wired bottom-up:

```
textures → materials → meshes+primitives → cameras → skins → animations → nodes → scenes
```

Key consequence: stable identity across calls.

```javascript
som.getNodeByName('x') === som.getNodeByName('x')   // true
node.mesh === node.mesh                               // true
mesh.primitives[0] === mesh.primitives[0]            // true
primitive.material === primitive.material             // true
```

Factory methods (`createNode`, `createMesh`, `createMaterial`, `createCamera`,
`createPrimitive`, `createAnimation`, `ingestNode`) all register new wrappers in the maps.

### Dispose fix

`SOMNode.dispose()` now calls `_onDispose()` which removes the node from `_nodesByName` and
`_nodeMap`. Without this, `getNodeByName` returned the cached (disposed) wrapper instead of
`null`, breaking the server's `removeNode` → `getNode` === null check.

---

## AtriumClient Changes

### `_attachMutationListeners()` / `_attachNodeListeners(node)`

Called after `_initSom()` in both `loadWorld` and `_onSomDump`. For each node in the SOM,
attaches listeners to the node and its mesh → primitives → materials + camera subtree.
Node name is captured in a **closure** — no IDs stored on SOM objects.

```javascript
_attachNodeListeners(node) {
    node.addEventListener('mutation', (e) => {
        this._onLocalMutation(nodeName, e.detail.property, e.detail.value)
    })
    // mesh, primitives, materials, camera — same pattern
}
```

Also called from `_onAdd` so peer avatar nodes get listeners too (mutations guarded by
`_applyingRemote`).

### `_onLocalMutation(nodeName, path, value)`

Sends `{ type: 'send', seq: ++this._sendSeq, node, field, value }` to the server if:
- `!this._applyingRemote` (not currently applying a remote update)
- `this._connected` (WebSocket is live)

### `_onSet` — loopback prevention

Two cases, handled synchronously:

**Case 1 — Own echo**: server reflects our `send` back with `session: ourSessionId`.
`_onSet` returns early; SOM is never touched, no mutation event fires.

**Case 2 — Remote update**: wraps the `setPath` call with `_applyingRemote = true / false`
in a try/finally. The mutation listener fires but `_onLocalMutation` sees `_applyingRemote`
and returns immediately. No outbound `send`.

### `_onView` guard

Peer avatar position/rotation updates (`peerNode.translation = msg.position` etc.) also
wrapped with `_applyingRemote = true / false` to prevent those mutations re-broadcasting.

### `_sendSeq`

New counter for outbound `send` messages, separate from `_viewSeq`.

---

## Protocol + Server Changes

### `packages/protocol/src/schemas/set.json`

Added optional `"session"` field (type: string). Required to allow the server to include
the originating session ID in its `set` broadcast without `additionalProperties: false`
rejecting it.

### `packages/server/src/session.js`

`set` broadcast now includes `session: session.id`:

```javascript
broadcast({
    type: 'set', seq: nextSeq(),
    node: msg.node, field: msg.field, value: msg.value,
    serverTime: Date.now(),
    session: session.id,   // ← new
})
```

This enables clients to detect their own echoes and skip SOM updates.

### `packages/server/test/avatar.test.js`

All `{ type: 'view', position: [...] }` sends updated to include `seq: 1`. These were
silently broken since Session 12 made `seq` required in `view-client.json`; the tests were
hanging because failed assertions left WebSocket connections open, preventing `wss.close()`
from resolving in `after()`.

---

## apps/client/src/app.js

Added `window.atriumClient = client` for manual console testing:

```javascript
const node = window.atriumClient.som.getNodeByName('Crate')
node.mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
// → crate turns green locally and on all connected peers
```

---

## tests/client/som/

Fully synced with `packages/som/src/`. Added `SOMEvent.js` and `SOMObject.js`; updated all
type files; updated `index.js` to export new types.

---

## Tests

### New SOM tests (+44, now 63 total)

- `SOMObject` / `SOMEvent` API: addEventListener, removeEventListener, _hasListeners,
  multiple listeners, dispatch shape
- Wrapper identity: 7 tests covering all cached getters
- Mutation events: every setter on `SOMNode`, `SOMMaterial`, `SOMCamera`, `SOMMesh`,
  `SOMPrimitive`, `SOMAnimation`
- Child list events: `addChild`, `removeChild`, `addPrimitive`, `removePrimitive` on node,
  scene, and mesh
- No error when setter fires with no listeners

### New client tests (+4, now 16 total)

- Local SOM mutation → outbound `send` message
- Inbound remote `set` → SOM updated, no outbound `send`
- Inbound own echo → SOM unchanged
- Not connected → SOM change produces no outbound message

Uses `MockWebSocket` that records sent messages and allows simulating inbound messages.
Client is wired via `connect()` (registers dispatch handler) then state is set directly
(bypasses server handshake).

---

## Final Test Counts

| Package | Tests | Pass |
|---------|-------|------|
| `@atrium/protocol` | 43 | 43 |
| `@atrium/som` | 63 | 63 |
| `@atrium/server` | 32 | 32 |
| `@atrium/client` | 16 | 16 |
| **Total** | **154** | **154** |
