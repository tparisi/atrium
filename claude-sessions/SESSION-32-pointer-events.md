# Session 32 — SOM Pointer Events (Foundational)

## Goal

Land the foundational pointer event layer for Atrium. By the end of this
session, any SOM node can have pointer event listeners attached, and
those listeners fire correctly in response to mouse interaction with the
node's geometry in `apps/client`'s viewport.

This is **walk-before-run** scope. We are deliberately not building:

- Bubbling / capture-phase propagation (leaf-only dispatch)
- Network sync of pointer events (purely local for now)
- The Inspector's selection / drag UX (Session 33)
- The renderer/input abstraction (Session 34)
- Touch / pen support (the API is named `pointer*` for forward-compat,
  but only mouse drives it in Session 32)

Duplication of the renderer-side hit-testing wiring between `apps/client`
and (later) the Inspector is **expected and acceptable** — Session 34
will extract once we have three real call sites informing the shape.

---

## Architecture

Three layers, mirroring the existing animation pattern:

```
DOM PointerEvent
    │
    ▼
[apps/client viewport]  ← raycast, resolve to SOM node
    │
    ▼
client.dispatchPointerEvent(somNode, type, detail)
    │
    ▼
[AtriumClient]  ← thin pass-through, owns capture state
    │
    ▼
[SOMObject._dispatchEvent]  ← fires listeners attached via addEventListener
```

**Headless principle preserved.** `packages/client` never sees a Three.js
object, a mesh, or a raycaster. It receives an already-resolved SOM node
and an event detail object, and it dispatches. The renderer (in
`apps/client`) owns hit-testing entirely.

**SOM is the source of truth for listeners.** Listeners attach via the
existing `SOMObject.addEventListener` API — no new registration mechanism.

---

## Event Types

Six event types, mirroring DOM `PointerEvent` semantics with leaf-only
dispatch:

| Type | When it fires |
|---|---|
| `pointerover` | Pointer enters a leaf node (hit-tested target changed to this node) |
| `pointerout` | Pointer leaves a leaf node (hit-tested target changed away from this node) |
| `pointerdown` | Pointer button pressed while over this node |
| `pointerup` | Pointer button released while over this node (or while captured by it) |
| `pointermove` | Pointer moved while over this node (or while captured by it) |
| `click` | `pointerdown` followed by `pointerup` on the same node, no intervening capture release |

**Leaf-only enter/exit semantics:** Hit-testing resolves to exactly one
leaf SOM node per frame (the deepest mesh-bearing node under the cursor).
When the resolved leaf changes from A to B:

1. Fire `pointerout` on A
2. Fire `pointerover` on B

Parents are never involved. There is no bubbling. If a node has children
with their own meshes and the pointer moves from parent-mesh to
child-mesh, the parent gets `pointerout` and the child gets `pointerover`
— they are independent leaves.

**Click semantics:** `click` fires after `pointerup` if and only if the
`pointerdown` and `pointerup` resolved to the same SOM node. If pointer
capture is active (see below), `click` fires when capture is released
via `pointerup`, on the captured node, regardless of where the cursor is.

---

## Event Detail Shape

```javascript
{
  pointerId,         // number — DOM pointer ID (always 1 for primary mouse in Session 32)
  button,            // number — DOM button code (0=primary, 1=middle, 2=secondary)
  buttons,           // number — DOM buttons bitmask
  point,             // [x, y, z] — world-space hit point on the geometry
  normal,            // [x, y, z] — surface normal at hit point (world space)
  ray: {
    origin,          // [x, y, z] — ray origin in world space (camera position)
    direction        // [x, y, z] — ray direction in world space (unit vector)
  },
  shiftKey,          // bool
  ctrlKey,           // bool
  altKey,            // bool
  metaKey,           // bool
  stopPropagation()  // no-op in Session 32; reserved for when bubbling lands
}
```

**Notably excluded** (deferred until a real use case demands them):

- Screen / client / page coordinates — handlers can derive from `ray` if needed
- `movementX` / `movementY` — drag handlers track their own previous-ray state
- `target` / `currentTarget` — the SOM object dispatching the event is
  already accessible as `event.target` via the existing `SOMEvent` base
  class; no new field needed

For `pointerover` / `pointerout` on a leaf change, `point`, `normal`, and
`ray` reflect the pointer position **at the moment of the change**.

For `pointerout` when the pointer leaves all geometry (cursor moves off
any hit), `point` and `normal` are still populated from the last hit,
but `ray` reflects the current pointer ray.

---

## SOMObject API

No new methods on `SOMObject` itself — the existing event listener API
covers it:

```javascript
node.addEventListener('pointerover', handler)
node.addEventListener('pointerdown', handler)
node.addEventListener('click', handler)
node.removeEventListener('pointerover', handler)
```

Handlers receive a `SOMEvent` whose `detail` is the shape above:

```javascript
node.addEventListener('click', (event) => {
  const { point, shiftKey } = event.detail
  console.log('clicked', event.target.name, 'at', point, 'shift:', shiftKey)
})
```

The existing `_hasListeners(type)` zero-cost check applies — pointer
events should only allocate a `SOMEvent` if listeners are attached, same
as `mutation`.

---

## AtriumClient API

One new method, two new pieces of state:

### `client.dispatchPointerEvent(somNode, type, detail)`

Called by the renderer. Dispatches the event on the SOM node and manages
capture / hover state.

- `somNode`: the resolved SOM node, or `null` if the pointer is not over
  any geometry (used for `pointermove` off-geometry while capture is
  active, and for clearing the hover target on `pointerout`-equivalent
  transitions).
- `type`: one of the six event types.
- `detail`: the event detail object as described above (without
  `stopPropagation` — AtriumClient adds that before dispatching).

**Internal logic:**

```
if pointer capture is set:
    target = capturedNode
    dispatch type on target with detail
    if type === 'pointerup':
        if somNode === capturedNode: dispatch 'click' on target
        release capture
else:
    if type === 'pointermove':
        if somNode !== currentHoverNode:
            if currentHoverNode: dispatch 'pointerout' on currentHoverNode
            if somNode:          dispatch 'pointerover' on somNode
            currentHoverNode = somNode
        if somNode: dispatch 'pointermove' on somNode
    elif type === 'pointerdown':
        if somNode:
            dispatch 'pointerdown' on somNode
            remember pointerDownTarget = somNode
    elif type === 'pointerup':
        if somNode:
            dispatch 'pointerup' on somNode
            if somNode === pointerDownTarget: dispatch 'click' on somNode
        pointerDownTarget = null
```

The renderer should call `dispatchPointerEvent` with type `'pointermove'`
on every DOM `mousemove` (with `somNode` either the hit node or `null`).
AtriumClient handles the `pointerover` / `pointerout` transitions itself
— the renderer doesn't track hover state.

### `client.setPointerCapture(somNode)`

Called from inside a pointer event handler (typically `pointerdown`).
Subsequent `pointermove` / `pointerup` events route to `somNode`
regardless of what the renderer's hit-test resolves to.

```javascript
node.addEventListener('pointerdown', (e) => {
  client.setPointerCapture(e.target)
  // node now receives all pointermove + pointerup until release
})
```

### `client.releasePointerCapture()`

Called from a pointer event handler or programmatically. Clears capture.
Capture is also automatically released on `pointerup` (see dispatch logic
above).

### Internal state

```javascript
this._capturedNode = null
this._currentHoverNode = null
this._pointerDownTarget = null
```

All cleared on `disconnect()` and on `world:loaded` (defensive — a SOM
swap could leave dangling references to nodes that no longer exist).

---

## Renderer-Side Wiring (apps/client)

`apps/client/src/app.js` grows a small pointer-input section. Goal: keep
it focused enough that the Session 34 extraction is a clean cut.

### Hit-testing

Standard Three.js raycasting against the `DocumentView` scene root:

```javascript
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()

function hitTest(domEvent) {
  const rect = canvas.getBoundingClientRect()
  ndc.x = ((domEvent.clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((domEvent.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObject(documentViewRoot, true)
  if (hits.length === 0) return null
  return resolveHitToSOMNode(hits[0])
}

function resolveHitToSOMNode(hit) {
  // Walk up Object3D parents until we find one whose name matches a
  // SOM node. DocumentView sets Object3D.name = glTFNode.getName(),
  // same convention used by the animation integration.
  let obj = hit.object
  while (obj) {
    if (obj.name) {
      const node = client.som.getNodeByName(obj.name)
      if (node) return { node, point: hit.point, normal: hit.face?.normal, hit }
    }
    obj = obj.parent
  }
  return null
}
```

### DOM → SOM dispatch

```javascript
canvas.addEventListener('mousemove', (e) => {
  const result = hitTest(e)
  client.dispatchPointerEvent(
    result?.node ?? null,
    'pointermove',
    buildDetail(e, result)
  )
})

canvas.addEventListener('mousedown', (e) => {
  const result = hitTest(e)
  if (result) {
    client.dispatchPointerEvent(result.node, 'pointerdown', buildDetail(e, result))
  }
})

canvas.addEventListener('mouseup', (e) => {
  const result = hitTest(e)
  client.dispatchPointerEvent(result?.node ?? null, 'pointerup', buildDetail(e, result))
})
```

`buildDetail(domEvent, hitResult)` constructs the event detail object,
transforming the surface normal to world space if needed.

### Coexistence with NavigationController

NavigationController already attaches mousedown/mouseup/mousemove
listeners for ORBIT and WALK drag-to-look behavior. Two scenarios:

1. **No SOM node hit on `pointerdown`** — let navigation handle it
   normally (drag the camera). This is the existing behavior; nothing
   changes.

2. **SOM node hit on `pointerdown` and a handler calls
   `setPointerCapture`** — navigation should *not* drag the camera for
   this gesture. The pointer is captured by the node.

For Session 32, the simplest correct approach:

- The pointer-input listeners on `canvas` run first (attached earlier or
  via capture phase) and call `setPointerCapture` if appropriate.
- After dispatching `pointerdown`, if `client._capturedNode` is set
  (i.e., a handler captured), the renderer calls
  `domEvent.preventDefault()` and `domEvent.stopPropagation()` to keep
  navigation from also acting on the gesture.

This is a slight pragma — exposing `_capturedNode` for the renderer to
peek at. Acceptable for Session 32; Session 34 will formalize it (likely
by making `dispatchPointerEvent` return whether the event was captured /
handled).

If this proves messier than expected during implementation, an alternate
approach is to make `setPointerCapture` also set a flag the renderer can
check via a public getter (`client.hasPointerCapture`). Implementer's
choice — pick the cleaner one and note it in the build log.

---

## Test Handlers (apps/client)

Wire up minimal console-logging handlers on every node in the SOM after
`world:loaded`, so the events are visible in the browser console during
manual testing:

```javascript
client.on('world:loaded', () => {
  for (const node of client.som.nodes) {
    if (node.extras?.atrium?.ephemeral) continue  // skip avatars
    node.addEventListener('pointerover', (e) => console.log('over',  node.name))
    node.addEventListener('pointerout',  (e) => console.log('out',   node.name))
    node.addEventListener('pointerdown', (e) => console.log('down',  node.name, e.detail.button))
    node.addEventListener('pointerup',   (e) => console.log('up',    node.name))
    node.addEventListener('click',       (e) => console.log('click', node.name, 'at', e.detail.point))
  }
})
```

Avatar nodes are skipped because peer avatars are noisy hover targets
and not the focus of this session.

This wiring is **temporary diagnostic scaffolding**. It can be gated
behind a debug flag or removed at the end of the session — the real
test surface is the unit tests below. The point of the scaffolding is
manual smoke testing during development.

---

## Tests

### `@atrium/client` — new test file `pointer-events.test.js`

Unit tests for `dispatchPointerEvent` and capture state. No DOM, no
Three.js — drive `client.dispatchPointerEvent` directly with synthetic
detail objects and a real SOM built from a fixture.

Required test cases:

1. **Listener fires on dispatch.** Attach handler to node, dispatch
   `pointerdown`, verify handler called with correct `event.target` and
   `event.detail`.
2. **`_hasListeners` short-circuit.** No listener attached → no
   `SOMEvent` allocated. (Spy on `_dispatchEvent` or check via a
   ref-counting mock.)
3. **`pointerover` / `pointerout` transitions.** Dispatch `pointermove`
   with node A, then node B → A gets `pointerout`, B gets `pointerover`.
4. **`pointerover` not refired on same node.** Dispatch `pointermove`
   with node A twice → `pointerover` fires once.
5. **`pointerout` on transition to null.** Dispatch `pointermove` with
   A, then with `null` → A gets `pointerout`, no `pointerover` fires.
6. **`click` fires on matching down/up.** Dispatch `pointerdown` on A,
   `pointerup` on A → `click` fires on A after `pointerup`.
7. **`click` does not fire on mismatched down/up.** Dispatch
   `pointerdown` on A, `pointerup` on B → no `click` fires.
8. **Capture routes events.** `setPointerCapture(A)`, dispatch
   `pointermove` with `null` (off-geometry) → A receives `pointermove`.
9. **Capture released on pointerup.** After `setPointerCapture(A)` and
   `pointerup`, capture is cleared; subsequent `pointermove` resolves
   normally via hit target.
10. **Capture survives off-target pointerup is treated as click.** With
    capture on A, `pointerup` with `null` somNode → A gets `pointerup`
    (because captured), but `click` does NOT fire (the up didn't resolve
    to A via hit-test). *Note: this differs from non-captured behavior
    where same-target down+up → click. Document the rationale in the
    build log if implementation differs.*
11. **`releasePointerCapture` clears capture.** Manual release works.
12. **`world:loaded` clears capture and hover state.** Set capture, fire
    `world:loaded`, verify state cleared.
13. **Disconnect clears capture and hover state.**
14. **Multiple listeners on same event.** Both fire, in attach order.
15. **`removeEventListener` removes listener.**

Use the existing `space.gltf` fixture for SOM construction. Keep tests
synchronous where possible — no `setTimeout`, no real network.

### `@atrium/som` — extension to existing event tests

If anything in `SOMObject._dispatchEvent` or `SOMEvent` needs to change
to support the `target` pattern in pointer event details, add tests for
those in the relevant SOM test file. Otherwise this layer is unchanged.

### `apps/client` — manual smoke test

After implementation, manually verify in the browser:

- Hover crate → console shows `over Crate`, `out Crate` on exit
- Click crate → `down`, `up`, `click` in order
- Mousedown on crate, drag off, mouseup off-geometry → `down Crate`,
  `up Crate` does NOT fire (no capture set), no `click` fires
- All gestures coexist with WALK / ORBIT navigation when pointer is over
  empty space

Document the smoke-test result in the session log.

---

## Implementation Order

1. `@atrium/client` — `dispatchPointerEvent` and capture API in
   `AtriumClient.js`. Write tests alongside.
2. Run `@atrium/client` tests — green before touching anything else.
3. `apps/client` — hit-testing helpers, DOM event listeners, test
   handlers, navigation coexistence.
4. Manual smoke test in browser. Iterate on coexistence with
   NavigationController until it feels right.
5. Build log written. Smoke-test results documented.

---

## Files Expected to Change

- `packages/client/src/AtriumClient.js` — new methods, new state
- `packages/client/test/pointer-events.test.js` — new file
- `apps/client/src/app.js` — hit-testing, dispatch, test handlers

No changes expected in:

- `packages/som` — existing event API is sufficient
- `packages/protocol` — no wire format changes (events are local-only)
- `packages/server` — server is not involved
- `tools/som-inspector` — Session 33's job

---

## Out of Scope (Explicit Deferrals)

Stated for clarity, so the boundaries don't drift mid-session:

- **Bubbling.** Leaf-only dispatch. `stopPropagation` is a no-op
  reservation.
- **Network sync.** Pointer events are purely local. The interactivity
  extension (future) will broadcast intent through SOM mutations as
  usual, but not in this session.
- **Inspector integration.** Selection, drag, highlighting — Session 33.
- **Renderer abstraction.** Duplication is expected. Session 34
  extracts.
- **Touch / pen.** API named `pointer*` for forward-compat. Only mouse
  drives it for now.
- **Screen / client coordinates in event detail.** Deferred until a use
  case demands them.
- **Movement deltas.** Drag handlers will track their own previous-ray
  state when Session 33 needs them.
- **Pointer events on non-node SOM types** (animations, materials,
  etc.). Nodes only — the only SOM types with geometry to hit-test.

---

## Risks / Watch-outs

- **NavigationController coexistence is the most likely source of
  friction.** The "hit a node, capture, suppress nav drag" path needs
  manual testing across WALK and ORBIT modes. If it gets ugly, document
  the ugliness in the build log — Session 34 will be the place to clean
  it up.

- **`hit.face?.normal` is in mesh-local space.** It needs to be
  transformed by the world matrix of the hit Object3D before being
  exposed in the event detail. Easy to forget. Test with a non-axis-aligned
  rotated node if possible.

- **`getNodeByName` resolution assumes unique names.** This is already
  a SOM invariant, but the hit-test walk-up could in principle find a
  parent Object3D whose name happens to match a different SOM node
  than intended. In practice DocumentView preserves the glTF structure
  faithfully, but worth a sanity check during smoke testing.

- **Avatar node skip in test handlers.** Make sure peer avatars *can*
  receive pointer events at the API level (don't gate at dispatch
  time) — we just don't attach test listeners to them. Future
  features (clicking peers to interact) will need this.

- **Defensive teardown on `world:loaded`.** Capture state references a
  SOM node from the previous world. If we forget to clear it, a stale
  reference leaks and subtle bugs appear when capture activates after
  a reload. The animation arc taught us this lesson; apply it
  preemptively here.
