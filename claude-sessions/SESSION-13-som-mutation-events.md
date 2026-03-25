# Design Brief — SOM Mutation Events & AtriumClient Sync

## 2026-03-20 · Design Session C

---

## Summary

Add a DOM-inspired mutation event system to the SOM, and use it in
AtriumClient to automatically reflect local scene graph changes to the
server. This turns AtriumClient into a transparent sync bridge: the app
just mutates the SOM; if connected, changes go out on the wire
automatically.

---

## Principles

1. Applications operate on the SOM scene graph, not glTF-Transform
   directly.
2. The mutation event system is a general-purpose SOM feature — usable by
   any application, single-user or multiplayer, whether or not it uses
   any other part of Atrium.
3. AtriumClient's jobs: load a glTF from a URL (single-user by default);
   connect to an Atrium server for shared worlds; reflect local SOM
   changes to the server via `send`, `add`, `remove`, `view` messages;
   prevent both loopback scenarios.

---

## New Files

### `packages/som/src/SOMEvent.js`

```javascript
export class SOMEvent {
    constructor(type, detail = {}) {
        this.type = type
        this.target = detail.target ?? null
        this.detail = detail
    }
}
```

### `packages/som/src/SOMObject.js`

Base class for all SOM types. DOM-style event listener API.

```javascript
export class SOMObject {
    constructor() {
        this._listeners = {}
    }

    addEventListener(type, callback) {
        if (!this._listeners[type]) this._listeners[type] = []
        this._listeners[type].push(callback)
    }

    removeEventListener(type, callback) {
        if (!this._listeners[type]) return
        this._listeners[type] = this._listeners[type].filter(cb => cb !== callback)
    }

    _hasListeners(type) {
        return (this._listeners[type]?.length ?? 0) > 0
    }

    _dispatchEvent(event) {
        for (const cb of this._listeners[event.type] ?? []) {
            cb(event)
        }
    }
}
```

All SOM types inherit from `SOMObject`: `SOMDocument`, `SOMScene`,
`SOMNode`, `SOMMesh`, `SOMPrimitive`, `SOMMaterial`, `SOMCamera`,
`SOMAnimation`, `SOMTexture`, `SOMSkin`.

---

## Mutation Events on Every Setter

Every setter on every SOM type fires a `mutation` event after updating the
underlying glTF-Transform object. Only allocates a `SOMEvent` if listeners
are present.

### Property change (attributes)

```javascript
// SOMMaterial example
set baseColorFactor(v) {
    this._material.setBaseColorFactor(v)
    if (this._hasListeners('mutation')) {
        this._dispatchEvent(new SOMEvent('mutation', {
            target: this,
            property: 'baseColorFactor',
            value: v
        }))
    }
}
```

Mutation record shape:

```javascript
{ type: 'attributes', property: 'baseColorFactor', value: [1, 0, 0, 1] }
```

No `oldValue` — if an application needs it, it can save the value in a
closure when the handler is set up.

### Child list change

```javascript
// SOMNode example
addChild(node) {
    this._node.addChild(node._node)
    if (this._hasListeners('mutation')) {
        this._dispatchEvent(new SOMEvent('mutation', {
            target: this,
            childList: { addedNodes: [node.name] }
        }))
    }
}

removeChild(node) {
    this._node.removeChild(node._node)
    if (this._hasListeners('mutation')) {
        this._dispatchEvent(new SOMEvent('mutation', {
            target: this,
            childList: { removedNodes: [node.name] }
        }))
    }
}
```

---

## SOMDocument Builds the Full Object Graph at Construction

`SOMDocument` creates all SOM wrappers up front and wires them together
directly. Two maps per type: one keyed by glTF-Transform object (for
wiring during construction and ingest), one keyed by name (for fast
lookup).

```javascript
constructor(document) {
    super()
    this._document = document
    this._root = document.getRoot()

    // Maps keyed by glTF-Transform object — for wiring
    this._materials = new Map()
    this._meshes = new Map()
    this._cameras = new Map()
    this._nodes = new Map()
    this._primitives = new Map()
    // etc.

    // Map keyed by name — for fast lookup
    this._nodesByName = new Map()

    // Create all wrappers bottom-up and wire together
    for (const m of this._root.listMaterials()) {
        this._materials.set(m, new SOMMaterial(m))
    }

    for (const mesh of this._root.listMeshes()) {
        const somMesh = new SOMMesh(mesh)
        this._meshes.set(mesh, somMesh)
        // wire primitives → cached materials
        for (const prim of mesh.listPrimitives()) {
            const mat = prim.getMaterial()
            if (mat) somPrim._material = this._materials.get(mat)
        }
    }

    for (const n of this._root.listNodes()) {
        const somNode = new SOMNode(n)
        this._nodes.set(n, somNode)
        this._nodesByName.set(n.getName(), somNode)
        const m = n.getMesh()
        if (m) somNode._mesh = this._meshes.get(m)
        const c = n.getCamera()
        if (c) somNode._camera = this._cameras.get(c)
    }
}
```

Getters become trivial property access:

```javascript
// SOMNode
get mesh() { return this._mesh ?? null }
set mesh(v) {
    this._mesh = v
    this._node.setMesh(v ? v._mesh : null)
}

// SOMDocument
get nodes() { return Array.from(this._nodesByName.values()) }

getNodeByName(name) {
    return this._nodesByName.get(name) ?? null
}
```

When new objects are created (`createNode`, `createMaterial`,
`ingestNode`, etc.), they are added to the maps and wired the same way.

### Wrapper identity

Because the document owns and caches all wrappers, the same underlying
glTF-Transform object always yields the same SOM wrapper instance. Event
listeners attached to a wrapper are durable.

---

## AtriumClient — Local Change → Outbound Message

After connecting, AtriumClient iterates `this._som.nodes` (a flat list of
all nodes) and for each node walks its attachments: mesh → primitives →
materials, camera, etc. These are fixed-depth paths, not recursive scene
graph traversal.

At each SOM object, it attaches an `addEventListener('mutation', ...)`
listener. The listener captures the node name and constructed path in a
**closure** — no IDs or extra data stored on SOM objects.

```javascript
_attachMutationListeners() {
    for (const node of this._som.nodes) {
        const nodeName = node.name

        node.addEventListener('mutation', (event) => {
            this._onLocalMutation(nodeName, event.detail.property, event.detail.value)
        })

        const mesh = node.mesh
        if (mesh) {
            mesh.addEventListener('mutation', (event) => {
                this._onLocalMutation(nodeName, `mesh.${event.detail.property}`, event.detail.value)
            })

            mesh.primitives.forEach((prim, i) => {
                prim.addEventListener('mutation', (event) => {
                    this._onLocalMutation(
                        nodeName,
                        `mesh.primitives[${i}].${event.detail.property}`,
                        event.detail.value
                    )
                })

                const material = prim.material
                if (material) {
                    material.addEventListener('mutation', (event) => {
                        this._onLocalMutation(
                            nodeName,
                            `mesh.primitives[${i}].material.${event.detail.property}`,
                            event.detail.value
                        )
                    })
                }
            })
        }

        const camera = node.camera
        if (camera) {
            camera.addEventListener('mutation', (event) => {
                this._onLocalMutation(nodeName, `camera.${event.detail.property}`, event.detail.value)
            })
        }
    }
}

_onLocalMutation(nodeName, path, value) {
    if (this._applyingRemote) return
    if (!this._connected) return
    this._send({ type: 'send', node: nodeName, field: path, value })
}
```

When new nodes enter the scene graph dynamically, AtriumClient walks and
attaches listeners to the new subtree using the same pattern.

---

## AtriumClient — Loopback Prevention

### Case 1 — Own echo

Server echoes our `set` back. `_onSet` checks session ID and returns
early. Never touches the SOM.

### Case 2 — Inbound re-broadcast

Server sends `set` from another session. `_onSet` applies it to the local
SOM, which fires a mutation event. AtriumClient's listener would try to
send it back out. Prevented by a synchronous `_applyingRemote` flag.

```javascript
_onSet(msg) {
    if (!this._som) return
    if (msg.session === this._sessionId) return   // Case 1

    this._applyingRemote = true                   // Case 2
    try {
        const node = this._som.getNodeByName(msg.node)
        if (node) this._som.setPath(node, msg.field, msg.value)
    } finally {
        this._applyingRemote = false
    }

    if (this._debug) this._log(`som:set ${msg.node}.${msg.field}`)
    this.emit('som:set', { nodeName: msg.node, path: msg.field, value: msg.value })
}
```

This is safe because the entire chain — setter, `_dispatchEvent`, listener
callback — executes synchronously in the same microtask. The `finally`
block ensures the flag is always cleared.

---

## Browser Console Access

`apps/client/src/app.js` exposes the AtriumClient instance for manual
testing:

```javascript
window.atriumClient = client
```

Console usage:

```javascript
const node = window.atriumClient.som.getNodeByName('Crate')
node.mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
```

---

## Automated Test Plan

### SOMObject / SOMEvent

- `addEventListener` registers a callback; `_dispatchEvent` calls it
- Multiple listeners on same event type all fire
- `removeEventListener` removes a specific callback; others still fire
- Removing a never-added listener is a no-op
- `_hasListeners` returns false → true → false across add/remove

### Wrapper caching (identity)

- `som.getNodeByName('x') === som.getNodeByName('x')`
- `node.mesh === node.mesh`
- `node.camera === node.camera`
- `mesh.primitives[0] === mesh.primitives[0]`
- `primitive.material === primitive.material`
- `som.nodes` returns same instances on repeated calls
- `node.mesh = newMesh` then `node.mesh === newMesh`
- `node.mesh = null` then `node.mesh === null`

### Mutation events — property changes

For each SOM type, verify that setting a property:

1. Fires a `mutation` event
2. Event has correct shape: `event.type === 'mutation'`,
   `event.target` is the SOM object, `event.detail.property` and
   `event.detail.value` are correct
3. The underlying glTF-Transform object was actually updated

Cover every setter on: `SOMNode` (translation, rotation, scale, name,
extras, visible), `SOMMaterial` (baseColorFactor, metallicFactor,
roughnessFactor, emissiveFactor, alphaMode, alphaCutoff, doubleSided),
`SOMCamera` (type, yfov, znear, zfar, aspectRatio, xmag, ymag),
`SOMMesh` (name, weights), `SOMPrimitive` (mode, material),
`SOMAnimation` (loop, timeScale).

### Mutation events — child list changes

- `node.addChild(child)` → event with `detail.childList.addedNodes`
- `node.removeChild(child)` → event with `detail.childList.removedNodes`
- `scene.addChild(node)` → same
- `scene.removeChild(node)` → same
- `mesh.addPrimitive(prim)` → same
- `mesh.removePrimitive(prim)` → same

### No event when no listeners

- Set a property with no listeners attached — no error

### AtriumClient integration

- **Local mutation → outbound message:** Connect with mock WebSocket,
  change a SOM property, assert `send` message was written with correct
  `node`, `field`, `value`
- **Inbound remote set → SOM updated, no outbound:** Inject `set` from
  different session, assert SOM updated, no outbound `send`
- **Inbound own echo → SOM not touched:** Inject `set` with own session
  ID, assert SOM unchanged
- **Not connected → no outbound:** Change SOM property without
  connecting, assert no message sent

---

## Manual Test Plan

### Existing functionality (regression)

- **Pass 1** — Static load: open `apps/client`, world renders, no errors
- **Pass 2** — Connect and navigate: WASD + mouse, own avatar appears
- **Pass 3** — Two windows: peer capsule appears, peer movement visible
- **Pass 4** — Close one window: peer capsule disappears

### SOM mutation sync (new)

Setup: start server, open two browser windows connected to same world.

- **Test 1 — Change material from console (window A):**
  ```javascript
  const node = window.atriumClient.som.getNodeByName('Crate')
  node.mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
  ```
  Verify: crate turns green in A immediately, turns green in B

- **Test 2 — Change from other side (window B):**
  ```javascript
  const node = window.atriumClient.som.getNodeByName('Crate')
  node.mesh.primitives[0].material.baseColorFactor = [1, 0, 0, 1]
  ```
  Verify: crate turns red in B, turns red in A

- **Test 3 — Move a node (window A):**
  ```javascript
  const node = window.atriumClient.som.getNodeByName('Crate')
  node.translation = [2, 0, 0]
  ```
  Verify: crate moves in A and B

- **Test 4 — No loopback:** Enable debug logging. Repeat Test 1. Verify:
  A sends exactly one `send`, receives one `set` echo (ignored), B
  receives one `set` (applied), no repeated messages, no flicker

- **Test 5 — Static mode (no server):** Load without connecting. Change
  a property from console. Verify: renders locally, no errors

---

## Implementation Order

1. `SOMEvent.js` — new file
2. `SOMObject.js` — new file
3. Refactor all SOM types to inherit `SOMObject`; add wrapper caching;
   add mutation events on every setter
4. Refactor `SOMDocument` constructor to build full object graph up front
5. Update `index.js` exports to include `SOMEvent` and `SOMObject`
6. SOM tests — event listeners, wrapper identity, mutation events,
   scene graph correctness
7. AtriumClient changes — `_attachMutationListeners`,
   `_onLocalMutation`, updated `_onSet` with `_applyingRemote` guard
8. AtriumClient tests — outbound send, inbound apply, loopback
   prevention
9. `apps/client/src/app.js` — add `window.atriumClient = client`
10. Manual testing passes
11. Sync `packages/som/src/SOMDocument.js` →
    `tests/client/som/SOMDocument.js`
