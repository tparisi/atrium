# Session 20 — SOM Wrapper Identity Fix

## Goal

Ensure every SOM accessor that returns child nodes resolves through
`SOMDocument._nodesByName` — the same cached instances that carry
AtriumClient mutation listeners. Today, `.children` on `SOMScene`,
`SOMNode`, and joint accessors on `SOMSkin` create fresh wrappers on
each call. Writes to these fresh wrappers update the glTF-Transform
document but never fire mutation events to listeners, silently dropping
network sync.

---

## The Problem

`SOMDocument` builds a wrapper cache at construction time. Every
`SOMNode` gets a single instance stored in `_nodesByName`. AtriumClient
attaches mutation listeners to these cached instances. The stable
identity contract:

```javascript
som.getNodeByName('Crate') === som.getNodeByName('Crate')  // true
```

But `.children` bypasses the cache:

```javascript
const cached = som.getNodeByName('Crate');
const fresh  = som.scene.children[2];       // new SOMNode wrapper
cached === fresh;                            // false

cached.translation = [1, 0, 0];             // mutation event → server sync ✓
fresh.translation  = [1, 0, 0];             // mutation event → nobody listening ✗
```

Both update the underlying glTF-Transform data, so serialization is
correct. But only the cached instance triggers the AtriumClient sync
pipeline. This is a silent data loss bug for any code that walks the
tree and writes to the nodes it finds.

---

## The Fix

### 1. Thread `_document` reference through all SOM wrappers

`SOMDocument`'s constructor is where all wrappers are created. Pass
`this` (the `SOMDocument` instance) as a constructor argument to every
wrapper that needs to resolve children:

- `SOMScene` — needs it for `.children`
- `SOMNode` — needs it for `.children`
- `SOMSkin` — needs it for joint node accessors

Store as `this._document` on each.

### 2. Fix `.children` on `SOMScene`

Before:
```javascript
get children() {
  return this._scene.listChildren().map(child => new SOMNode(child));
}
```

After:
```javascript
get children() {
  return this._scene.listChildren().map(child =>
    this._document.getNodeByName(child.getName())
  );
}
```

### 3. Fix `.children` on `SOMNode`

Same pattern — resolve through `this._document.getNodeByName()` instead
of creating fresh wrappers.

### 4. Fix joint accessors on `SOMSkin`

Audit all methods on `SOMSkin` that return node references (joints,
skeleton). Resolve through `this._document.getNodeByName()`.

### 5. Audit other SOM classes

Check every SOM class for any accessor or method that returns a
`SOMNode`, `SOMMesh`, `SOMMaterial`, or any other wrapped type. All
must resolve through the document's cache maps. The wrappers that
need checking:

- `SOMDocument` — `.nodes`, `.meshes`, `.materials`, etc. (likely
  already correct since these return from the cache maps directly)
- `SOMScene` — `.children`
- `SOMNode` — `.children`, `.mesh`, `.camera`, `.skin`
- `SOMMesh` — `.primitives` (if wrapped)
- `SOMPrimitive` — `.material`
- `SOMSkin` — joints, skeleton

Any accessor that calls a glTF-Transform `list*()` or `get*()` method
and wraps the result is suspect.

---

## Tests

All new tests go in `packages/som/tests/`. Run with
`pnpm --filter @atrium/som test`.

### Identity tests

```
SOMScene.children returns cached SOMNode instances
SOMNode.children returns cached SOMNode instances
SOMSkin joints returns cached SOMNode instances
SOMNode.mesh returns cached SOMMesh instance
SOMNode.camera returns cached SOMCamera instance
SOMPrimitive.material returns cached SOMMaterial instance
```

Core assertion pattern:
```javascript
const child = som.scene.children[0];
const cached = som.getNodeByName(child.name);
assert.strictEqual(child, cached);
```

### Mutation listener tests

```
mutation listener fires when setting property on node from .children
mutation listener fires when setting property on node from SOMSkin joints
```

These confirm the real-world consequence: a listener attached to the
cached instance fires when a property is set on the object returned
by `.children`.

### Regression

All 63 existing `@atrium/som` tests must continue to pass.

---

## After: Inspector Cleanup

Once the SOM fix lands and all tests pass, go back to
`tools/som-inspector/src/TreeView.js` and remove the
`som.getNodeByName()` workaround. TreeView can walk `.children`
directly and hand nodes to PropertySheet — the identity is now
guaranteed by the SOM layer.

---

## Key Principles (from handoff — always apply)

1. Design before code.
2. No throwaway code.
3. Incremental correctness.
4. SOM is the source of truth.
