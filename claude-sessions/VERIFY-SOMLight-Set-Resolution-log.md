# SOMLight Pre-Brief Verification — Findings

## Verdict

CONFIRMED — with registration amendment.

The `set`-resolution mechanism is uniform for any named SOM object: both server and
client call `getObjectByName(name)` → `setPath(target, field, value)` with no
type-branching at any step. A `SOMLight` registered in `_objectsByName` will be
wire-addressed identically to a node or animation. However, `SOMMaterial` is **not**
in `_objectsByName` and is therefore not a live analog for this pattern; the correct
live analog is `SOMAnimation`. `SOMLight` must explicitly self-register in
`_objectsByName` during `SOMDocument._buildObjectGraph` — this does not happen
automatically.

---

## 3.1 Protocol schema

**Files read:** `packages/protocol/src/` — `set.json` (schema for `set` message).

**Q1 — `node` field constraints:**

```json
"node": { "type": "string", "minLength": 1 }
```

`string` with a minimum length of 1. No pattern restriction, no format, no `$ref`
to any named-node registry.

**Q2 — Dotted names pass validation:**

Yes. `"Sun.light"`, `"MainCamera.camera"`, `"Chair/Body"` all satisfy
`{ "type": "string", "minLength": 1 }`. Ajv will accept them without modification.

**Q3 — `field` and `value` constraints:**

```json
"field": { "type": "string", "minLength": 1 },
"value": {}
```

`field` is a non-empty string. `value` is an open schema (`{}`) that accepts any
JSON-serialisable value — numbers, arrays, `null`, objects, booleans. No constraints
that would need extending for light property values (color arrays like `[1,0,0,1]`,
numbers for `intensity`, or `null` for `range`).

---

## 3.2 Server `set` handler

**File:** `packages/server/src/session.js` (dispatch) + `packages/server/src/world.js` (resolution)

**Q4 — Server handler code:**

`session.js` — the `'send'` case in the inbound message switch:

```js
case 'send': {
  if (!world) { sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded'); break }
  const result = world.setField(msg.node, msg.field, msg.value)
  if (!result.ok) { sendError(ws, msg.seq, result.code, `${result.code}: ${msg.node}`); break }
  broadcast({ type: 'set', seq: nextSeq(), node: msg.node, field: msg.field, value: msg.value, serverTime: Date.now(), session: session.id })
  break
}
```

`world.js` — `setField`:

```js
function setField(nodeName, field, value) {
  const target = som.getObjectByName(nodeName)
  if (!target) return { ok: false, code: 'NODE_NOT_FOUND' }
  try { som.setPath(target, field, value) } catch { return { ok: false, code: 'INVALID_FIELD' } }
  return { ok: true }
}
```

**Q5 — Resolution method:**

`som.getObjectByName(nodeName)` — the same function used for every named SOM object.
No `getNodeByName`, no `instanceof` check, no type gate before or after the lookup.

**Q6 — Post-resolution uniformity:**

`som.setPath(target, field, value)` is called unconditionally on whatever
`getObjectByName` returns. There is no branch on object type.

**Q7 — Null handling:**

Returns `{ ok: false, code: 'NODE_NOT_FOUND' }`. The session handler receives this,
calls `sendError(ws, msg.seq, 'NODE_NOT_FOUND', 'NODE_NOT_FOUND: <name>')`, and does
not broadcast. The originating client gets an error response; other clients receive
nothing.

---

## 3.3 AtriumClient `set` handler

**File:** `packages/client/src/AtriumClient.js`

**Q8 — Client handler code:**

```js
_onSet(msg) {
  if (!this._som) return
  if (msg.session === this._sessionId) return  // own echo
  this._applyingRemote = true
  try {
    const target = this._som.getObjectByName(msg.node)
    if (target) this._som.setPath(target, msg.field, msg.value)
  } finally {
    this._applyingRemote = false
  }
  this.emit('som:set', { nodeName: msg.node, path: msg.field, value: msg.value })
}
```

**Q9 — Resolution method, post-resolution uniformity, null handling:**

Same pattern as the server: `getObjectByName` → `setPath`. No type check after
resolution. If `target` is null (name not in `_objectsByName`), the `if (target)`
guard makes it a silent no-op. `som:set` is still emitted even for the no-op case.

**Q10 — Same `getObjectByName` path:**

Yes. The client operates on `this._som` (its local `SOMDocument` copy) using the
identical `getObjectByName` → `setPath` path. No separate resolution mechanism.

---

## 3.4 SOMMaterial as live analog

**Files read:** `packages/som/src/SOMMaterial.js`, `packages/client/src/AtriumClient.js`
(mutation listener wiring), `packages/client/src/AvatarController.js` (mutation trigger).

**Q11 — Does `SOMMaterial` extend `SOMObject`? Does it self-register in `_objectsByName`?**

```js
// SOMMaterial.js:8
export class SOMMaterial extends SOMObject {
  constructor(material) {
    super()
    this._material = material
  }
```

`SOMMaterial` extends `SOMObject`. It does **not** register itself in `_objectsByName`.
There is no `_registerObject` call in its constructor, and `SOMDocument._buildObjectGraph`
does not call `_registerObject` for materials — it only stores them in `_materialMap`.
This means `getObjectByName('SomeMaterialName')` always returns null for materials,
regardless of what name the underlying glTF material has.

**Q12 — How avatar `baseColorFactor` mutation flows:**

`AvatarController._addPeer` (line 155) sets `prim.material.baseColorFactor = [r, g, b, 1]`
directly. This triggers the `mutation` event on the `SOMMaterial` wrapper.

`AtriumClient._attachNodeListeners` registers a listener on the material via:
```js
material.addEventListener('mutation', (event) => {
  if (!event.detail.property) return
  this._onLocalMutation(
    nodeName,                                          // e.g. "Alice"  — the parent NODE name
    `mesh.primitives[${i}].material.${event.detail.property}`,  // e.g. "mesh.primitives[0].material.baseColorFactor"
    event.detail.value
  )
})
```

The resulting `send` message carries the **parent node name** as `node`:
```json
{ "type": "send", "node": "Alice", "field": "mesh.primitives[0].material.baseColorFactor", "value": [0.9,0.6,0.5,1] }
```

`SOMMaterial` is never the direct wire-address target. It is reached structurally
through its parent node name + a compound path.

**Q13 — Receiving end:**

On receipt, `getObjectByName("Alice")` returns the `SOMNode` for Alice (which IS in
`_objectsByName`). `setPath(aliceNode, "mesh.primitives[0].material.baseColorFactor", value)`
then walks `aliceNode.mesh.primitives[0].material.baseColorFactor` via `resolvePath`
and applies the assignment. The SOMMaterial is reached by path traversal from the node,
not by direct name lookup.

**Conclusion:** `SOMMaterial` is **not** a live analog for `getObjectByName`-resolved
wire addressing. The mutation path for materials routes through the parent node name,
not the material name. The correct live analog for a `getObjectByName`-resolved
non-node object is `SOMAnimation`, which IS registered in `_objectsByName` and IS
wire-addressed by its own name (e.g. `node: "WalkCycle"`, `field: "playback"`).

---

## 3.5 `getObjectByName` implementation

**File:** `packages/som/src/SOMDocument.js`

**Q14 — Implementation:**

```js
getObjectByName(name) {
  return this._objectsByName.get(name) ?? null
}
```

Direct `Map.get` lookup. O(1). No fallback logic, no case folding, no type filtering.
Returns `null` (not `undefined`) when the name is absent.

**Q15 — What is registered in `_objectsByName`:**

During `_buildObjectGraph` (called from the constructor and on scene reload):

| SOM type | Registered in `_objectsByName` |
|---|---|
| `SOMDocument` itself | YES — as `'__document__'` |
| `SOMNode` (scene nodes) | YES — via `_registerObject(name, somNode)` |
| `SOMAnimation` | YES — via `_registerObject(name, somAnim)` |
| `SOMMaterial` | **NO** — stored only in `_materialMap` |
| `SOMMesh` | **NO** |
| `SOMCamera` | **NO** |
| `SOMPrimitive` | **NO** |
| `SOMTexture` | **NO** |
| `SOMSkin` | **NO** |

Any new SOM type that needs wire-addressability by name must call `_registerObject`
explicitly during graph construction.

---

## Failure modes found

NONE of the specific failure modes listed in §4 are present:

- **Type-gating on `node` resolution:** Not found. Neither server nor client does
  `instanceof SOMNode` or any equivalent check after `getObjectByName`.
- **`getNodeByName` used instead of `getObjectByName`:** Not found. Both call
  `getObjectByName` directly.
- **Protocol schema pattern restriction on `node`:** Not found. `{ "type": "string", "minLength": 1 }` — no pattern.
- **`som.setPath` type-branching:** Not found. `setPath` is a generic path-walker that
  operates identically on any SOM object.
- **SOMMaterial not in `_objectsByName`:** FOUND — but this is the analog claim in the
  brief, not a failure mode in the wire mechanism. Materials are addressed via parent
  node path; they are not a wire-addressable name target. This finding corrects the
  brief's framing but does not affect the SOMLight design.

---

## Implications for the SOMLight brief

**CONFIRMED** — the `set`-resolution mechanism is genuinely uniform. Any named object
that is registered in `_objectsByName` is wire-addressable via `getObjectByName` →
`setPath` with no type-branching at any point on either server or client.

**Required amendment to the brief:**

The brief states that `SOMMaterial` / avatar `baseColorFactor` is "a non-node SOM
object whose properties are wire-mutated today" and serves as the live analog. This
framing is incorrect. `SOMMaterial` is not wire-addressed by its own name — it is
reached via its parent node name + compound field path. The correct live analog is
`SOMAnimation` (e.g. `node: "WalkCycle"`, `field: "playback"`), which IS in
`_objectsByName`.

**Registration requirement:**

`SOMLight` must be registered in `_objectsByName` during `SOMDocument._buildObjectGraph`
using `_registerObject(name, somLight)` — the same pattern used for nodes and
animations. This is the only implementation step not already guaranteed by the
existing mechanism. Once registered, the full wire-address path (`getObjectByName` →
`setPath`) works as designed in `DESIGN-SOMLight-Naming.md` without any changes to
the server, the client `_onSet` handler, or the protocol schema.

The `SOMLight` wire design (`node: "Sun.light"`, `field: "intensity"`) proceeds as
specified.
