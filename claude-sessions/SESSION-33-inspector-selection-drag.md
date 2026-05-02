# Session 33 — Inspector Selection + Drag

## Goal

Land click-to-select and drag-to-translate in the SOM Inspector,
exercising the Session 32 pointer event API in its first real consumer
beyond the diagnostic handlers in `apps/client`.

By the end of this session:

- Clicking a SOM node in the Inspector viewport selects it; the tree
  highlights the selected node (using the Inspector's existing
  selection state, however it currently wires up).
- Mousedown + drag on a selected node translates it along a fixed
  world-space horizontal plane (captured at mousedown).
- The drag fires continuous SOM mutations on every `pointermove`, so
  the renderer reconciles to current SOM state via the established
  pattern. No renderer/SOM divergence during drag.
- Translation is written in parent-local coordinates (the only frame
  `node.translation` accepts).

This session deliberately ships the second copy of the renderer-side
hit-testing wiring, in `tools/som-inspector/`. Session 34 will extract
once we have three real call sites informing the shape.

---

## What's deferred (explicit non-goals)

- **Session 34 abstraction.** Duplication of `buildDetail`, hit-test,
  and canvas listener wiring between `apps/client` and
  `tools/som-inspector` is expected. Don't pre-extract.
- **Rotation and scale gestures.** Translate only. Rotation/scale need
  separate UI affordances (modifier keys or visible gizmos) that we
  haven't specified.
- **Highlighting / outline for selected node.** That's a render-only
  concern, separately scoped. Selection is reflected in the tree
  panel; the viewport gives no visual indication of selection in
  Session 33. Acceptable.
- **Surface-following drag** ("drop crate onto whatever's underneath").
  Session 33 uses a fixed plane captured at mousedown. The crate
  floats in mid-air if dragged off an edge — correct behavior for
  this spec.
- **Axis-locked drag, modifier-key escapes for vertical drag, etc.**
  If ground-plane drag feels wrong in practice, we add modifiers as a
  follow-up.
- **Undo/redo integration.** No coordination needed if no undo system
  exists yet; if one lands later, drag-as-undoable-unit will need to
  be revisited.
- **Networked drag.** Mutations are local to the Inspector's SOM
  document. When the Inspector is later wired to a connected world,
  mutation rate-limiting and intent-vs-state semantics will need a
  separate design pass.
- **Selection in SOM.** Selection is purely Inspector-local UI state;
  no SOM extension, no transient property, nothing observable to
  other clients.

---

## Architecture

The pointer event flow established in Session 32 is unchanged:

```
DOM PointerEvent
    │
    ▼
[tools/som-inspector viewport]  ← raycast, resolve to SOM node
    │
    ▼
client.dispatchPointerEvent(somNode, type, detail)
    │
    ▼
[AtriumClient]  ← capture + hover state (already implemented)
    │
    ▼
[SOMObject._dispatchEvent]  ← fires listeners attached by Inspector code
```

What's new: the Inspector attaches its own pointer event listeners to
SOM nodes (selection, drag) instead of (or in addition to) the
diagnostic console handlers from `apps/client`.

---

## Selection

### Behavior

- Clicking a node in the viewport selects that node.
- Clicking empty space (no node hit) deselects, matching the
  established UX pattern in most editors.
- The Inspector's tree panel reflects the selected node — clicking in
  the viewport drives the tree, just as clicking in the tree currently
  drives selection.
- Selection state persists across pointer events that don't change it
  (hovering does not change selection; only `click` does).

### Implementation

The Inspector already has selection state for tree-side clicks. Find
that state (likely a reactive store, Vue ref, or whatever pattern the
Inspector uses) and reuse it. Don't introduce a parallel selection
concept.

A `click` event handler attached to every non-ephemeral SOM node on
`world:loaded` calls into the Inspector's existing setSelected(node)
or equivalent. The same handler should be re-attached when the world
reloads (mirror the Session 32 pattern in `apps/client`).

For "click empty space to deselect," there is no SOM node to attach
to, so the deselect logic lives at the viewport level. One option:
listen for `mousedown` on the canvas, hit-test, and if the hit is null
*and* no drag is in progress, call setSelected(null). Workable but
slightly tangled with the drag logic below — implementer's choice
whether to handle this at the canvas listener level or via a
`pointerdown` handler on a special "background" target. If unclear,
defer click-to-deselect with a `// TODO Session 34` and implement only
the positive-selection case in Session 33. We can live without
click-to-deselect for one session.

### Out of scope for selection

- Multi-select
- Selection visual feedback in the viewport (highlight/outline)
- Selection modifiers (shift-click to extend, etc.)

---

## Drag

### Behavior

1. **Mousedown on selected node:** capture state, set pointer capture
   on the node, do not fire any mutation yet.
2. **Mousemove while dragging:** project cursor onto the captured
   ground plane, compute world delta, apply to initial node world
   position, convert to parent-local, write `node.translation`. The
   mutation flows through SOM and the renderer reconciles, so the node
   visually moves with the cursor.
3. **Mouseup:** release pointer capture. End drag. No special "final"
   mutation — the last `pointermove` already wrote the final state.

Drag is initiated by `pointerdown` *only when the pointerdown target
is the currently-selected node*. Pointerdown on an unselected node
selects it via the click handler (after pointerup, since `click`
fires only on matching down/up) but does *not* drag — first click
selects, subsequent click+drag translates. This is the standard
"click to select, then drag" pattern.

(Open question for the implementer: does this two-step feel right, or
should pointerdown-on-any-node both select and start a drag in one
gesture? Standard editor behavior varies. The two-step is simpler to
implement and reason about. Try it; if it feels wrong, document and
revise in a follow-up.)

### Drag math

Captured at `pointerdown` (after selection check passes):

- `dragPlaneY` — `node.getWorldPosition().y` at mousedown. The drag
  plane is the world-space horizontal plane at this height. Held
  constant for the duration of the drag — does not follow the node as
  it moves.
- `initialCursorWorld` — cursor ray projected onto the drag plane,
  computed from the `pointerdown` event's `ray` field in detail.
- `initialNodeWorldPos` — `node.getWorldPosition()` snapshot at
  mousedown.
- `parentWorldInverse` — inverse of the parent Three.js Object3D's
  `matrixWorld`. If the node's parent is the scene root with identity
  transform, this is identity and the inversion can be skipped as a
  fast path. Otherwise: `parent.matrixWorld.clone().invert()`.

On each `pointermove`:

1. **Project cursor onto drag plane.** From `event.detail.ray.origin`
   and `event.detail.ray.direction`, find `t` such that
   `origin.y + t * direction.y === dragPlaneY`. If `direction.y` is
   near zero (camera looking horizontally, ray parallel to plane),
   skip this move — the projection is degenerate. World cursor point:
   `origin + t * direction`.
2. **Compute world delta.** `delta = currentCursorWorld - initialCursorWorld`.
3. **Compute new node world position.** `newWorldPos = initialNodeWorldPos + delta`.
4. **Convert to parent-local.** `newLocalPos = parentWorldInverse · newWorldPos`.
   Written as a Three.js Vector3 operation, this is
   `newWorldPos.clone().applyMatrix4(parentWorldInverse)`.
5. **Write to SOM.** `node.setTranslation([newLocalPos.x, newLocalPos.y, newLocalPos.z])`
   (or whatever the SOM node's translation-write API actually is —
   verify by inspection).

The mutation triggers the renderer's existing reconciliation path; the
node visually moves.

### Why parent-local

`node.translation` in SOM is the local transform — the node's position
relative to its parent. If the parent has a non-identity transform
(translation, rotation, scale, or any combination), writing world
coordinates directly to `node.translation` would place the node at the
wrong spot. The inverse-parent-world-matrix conversion handles all
parent transforms correctly.

For nodes whose parent *is* the scene root with identity transform,
local and world coincide and the conversion is a no-op. The fast path
("if parent is identity, skip the matrix inversion") is a worthwhile
microoptimization since it covers the common case.

### Why this formulation (not localPoint-based)

The Session 32 amendment added `localPoint` to the event detail with
drag handlers in mind. For *translate-only* drag, the world-delta
formulation above is simpler and sufficient — the grab offset is
implicit in `initialCursorWorld - initialNodeWorldPos`, captured at
mousedown and held constant, because the node doesn't rotate during
the drag.

`localPoint` would be load-bearing if the node rotated during drag
(rotating-grab gestures), or for axis-locked drag relative to the
node's local axes. Neither is in Session 33's scope. Leaving
`localPoint` as available-but-unused is fine — the field is there when
future drag modes need it.

### Drag plane edge cases

- **Camera looking nearly horizontally.** Ray is nearly parallel to
  the drag plane. Projection gives huge `t` or division by near-zero.
  Skip the move (don't apply translation, don't fire mutation).
  Document this as a known limitation; in practice, ORBIT mode usually
  has the camera looking somewhat downward, and WALK mode isn't a
  typical Inspector-edit context.
- **Ray pointing away from drag plane.** If `t` comes out negative,
  the cursor is "behind" the drag plane from the camera's perspective.
  Treat the same as the parallel case — skip the move.
- **Node moved off-screen during drag.** No special handling. The drag
  continues based on cursor ray + drag plane; the user can drag the
  cursor back into view to recover. Capture is held until `pointerup`.

---

## Inspector wiring

### Hit-testing and event dispatch

Mirror the Session 32 wiring from `apps/client/src/app.js` into
`tools/som-inspector/`. Specifically, in whichever Inspector file owns
the viewport / Three.js scene setup:

- A `THREE.Raycaster` and `THREE.Vector2` (NDC scratch).
- A `hitTest(domEvent)` helper that converts DOM coords to NDC,
  raycasts against the DocumentView root, and returns
  `{ node, point, normal, hit } | null`.
- A `resolveHitToSOMNode(hit)` helper that walks Object3D parents
  matching names against `client.som.getNodeByName()`.
- A `buildDetail(domEvent, hitResult)` that constructs the event
  detail object — same shape as `apps/client`'s version, including
  the Session 32 amendment's `localPoint`, `localNormal`, `distance`,
  `uv` fields.
- Canvas listeners on `mousemove`, `mousedown`, `mouseup` that call
  `client.dispatchPointerEvent`.

This is intentional duplication of the `apps/client` code. Session 34
extracts. **Do not import from `apps/client`** — that would create an
apps→apps coupling worse than the duplication.

### Listener attachment on world:loaded

Replace (or augment) the `apps/client`-style diagnostic logging with
Inspector-specific listeners:

```js
client.on('world:loaded', () => {
  for (const node of client.som.nodes) {
    if (node.extras?.atrium?.ephemeral) continue
    node.addEventListener('click',       (e) => onNodeClick(node, e))
    node.addEventListener('pointerdown', (e) => onNodeMouseDown(node, e))
    node.addEventListener('pointermove', (e) => onNodeMouseMove(node, e))
    node.addEventListener('pointerup',   (e) => onNodeMouseUp(node, e))
  }
})
```

`onNodeClick` selects the node. `onNodeMouseDown` initiates drag if
the node is the currently-selected one and captures all the initial
state (drag plane, cursor world point, node world pos, parent inverse
matrix). `onNodeMouseMove` is the per-frame drag update. `onNodeMouseUp`
ends the drag and releases capture.

Drag state is held in a single object scoped to the Inspector
viewport, not on the node itself. Something like:

```js
let dragState = null  // null when no drag, populated during drag

function onNodeMouseDown(node, e) {
  if (selected !== node) return         // first click selects, doesn't drag
  client.setPointerCapture(node)
  dragState = {
    node,
    dragPlaneY:           node.getWorldPosition().y,
    initialCursorWorld:   projectRayToPlane(e.detail.ray, node.getWorldPosition().y),
    initialNodeWorldPos:  node.getWorldPosition().clone(),
    parentWorldInverse:   computeParentInverse(node)
  }
}

function onNodeMouseMove(node, e) {
  if (!dragState || dragState.node !== node) return
  const cursorWorld = projectRayToPlane(e.detail.ray, dragState.dragPlaneY)
  if (!cursorWorld) return  // ray parallel to plane
  const delta       = cursorWorld.clone().sub(dragState.initialCursorWorld)
  const newWorldPos = dragState.initialNodeWorldPos.clone().add(delta)
  const newLocalPos = newWorldPos.applyMatrix4(dragState.parentWorldInverse)
  node.setTranslation([newLocalPos.x, newLocalPos.y, newLocalPos.z])
}

function onNodeMouseUp(node, e) {
  if (!dragState || dragState.node !== node) return
  dragState = null
  // pointer capture released automatically by AtriumClient on pointerup
}
```

The `node.getWorldPosition()` and parent inverse logic require access
to the corresponding Three.js Object3D for the SOM node. The Inspector
already has a SOM-node-to-Object3D mapping (the DocumentView build
maintains it); use that. If the mapping isn't directly accessible, the
hit-test result already includes `hit.object` — but capturing it at
mousedown means we trust the Object3D to remain valid for the duration
of the drag, which it should.

### Navigation coexistence

The Inspector's viewport may have its own camera nav (orbit). The
Session 32 pattern applies: when a `pointerdown` lands on a node *and*
a handler sets pointer capture, suppress nav drag via
`stopPropagation()`. Use the `client.hasPointerCapture` getter, same
as `apps/client`.

If the Inspector currently has no nav controller, this is a no-op.

---

## Tests

### Unit tests — `packages/client`

No new tests needed in `packages/client`. The pointer event API is
unchanged. The Session 32 test suite (96 tests) should continue to pass
unmodified.

### Inspector tests

If `tools/som-inspector` has a test suite, add tests for the
selection and drag logic at whatever layer is testable without DOM /
Three.js. The drag math (project ray to plane, compute delta, convert
to parent-local) is a pure function and can be unit-tested in
isolation:

- **Project ray to plane.** Given an origin, direction, and plane Y,
  returns the correct world point. Test the edge cases: parallel ray
  → null, negative t → null, normal case.
- **World-to-parent-local conversion.** Given a parent world matrix
  and a world point, returns the correct local point. Test identity
  parent (no-op), translated parent, rotated parent.
- **Drag delta application.** Given initial state and a new cursor
  world point, returns the new translation to write. Composition of
  the above.

If the Inspector has no existing test infrastructure, skip the unit
tests and rely on manual verification — but at minimum extract the
math into a pure helper file (`tools/som-inspector/src/drag-math.js`
or similar), so Session 34's extraction has clean seams.

### Manual smoke test

A separate smoke test plan should accompany this brief, in the same
style as Session 32's. Required scenarios:

1. **Click selection.** Click crate → tree highlights crate. Click
   floor → tree highlights floor (or whatever the equivalent is).
2. **First-click selects, second-click drags.** Click an unselected
   node — no drag. Mousedown again on the selected node and drag —
   it moves.
3. **Drag tracks cursor on the ground plane.** Click+drag the crate;
   the crate stays at the same world Y, slides along its drag plane.
4. **Drag with rotated parent.** If the fixture has a node with a
   non-identity parent transform (or one can be authored), drag it
   and confirm it moves correctly in world space — i.e., the drag
   feels right visually, not skewed/scaled.
5. **Drag with rotated node.** Drag a rotated node; confirm it
   translates without rotating, and the grab point feels reasonable.
6. **Drag plane is captured at mousedown.** Drag a crate; the crate
   stays at its initial Y throughout, even if the user drags up/down
   in screen space.
7. **Camera nav still works on empty space.** Click+drag empty space
   → camera orbits / pans as before, no node moves.
8. **Pointer capture suppresses nav.** Drag a node — the camera does
   *not* orbit during the drag.
9. **World reload during drag (defensive).** Initiate a drag, then
   trigger a world reload. No errors; capture state cleared. (This
   is an artificial scenario but exercises the
   `_clearPointerState()` path under load.)
10. **SOM mutations fire continuously during drag.** Open browser
    devtools, watch the SOM mutation event stream (or add a temporary
    console log on the document mutation event); confirm one mutation
    fires per `pointermove` during a drag.

### What to do if smoke tests fail

- **Drag feels wrong** (jumpy, drift, wrong axis): the drag math is
  almost certainly the culprit. Specifically, parent-world-matrix
  inversion is the most likely site of bugs. Verify with a node whose
  parent has an identity transform first; if that works, the issue is
  in the inverse step.
- **Drag plane drifts during drag:** `dragPlaneY` is being recomputed
  per-move instead of captured at mousedown. Check the state capture.
- **Selection doesn't update tree:** the existing tree-side selection
  state isn't being shared with the new viewport-side selection
  handler. Verify both sides reference the same state.
- **Drag continues after mouseup off-geometry:** capture isn't being
  released. AtriumClient's logic releases capture on `pointerup`
  regardless of where the up landed (verified in Session 32 unit
  tests). If it's not happening, something else is wrong — check the
  build log for that test.

---

## Implementation order

1. Inspector hit-test and dispatch wiring (mirror `apps/client`).
2. Click-to-select handler. Manually verify selection works
   end-to-end before moving to drag.
3. Drag math as pure helpers. Write unit tests if Inspector test
   infrastructure exists.
4. Drag handlers (`onNodeMouseDown` / `Move` / `Up`) wired up. Manual
   verification.
5. Navigation coexistence. Verify camera doesn't fight drag.
6. Smoke test pass.
7. Build log written.

---

## Files expected to change

- `tools/som-inspector/src/...` — viewport hit-testing, click-select,
  drag handlers, drag math helpers
- Possibly `tools/som-inspector/tests/` — drag math unit tests, if
  test infrastructure exists

No changes expected in:

- `packages/client` — pointer API is sufficient
- `packages/som`, `packages/protocol`, `packages/server`
- `apps/client` — its diagnostic handlers are unchanged

---

## Risks / watch-outs

- **Parent-world-matrix inversion is the most likely bug site.** Test
  with a non-identity parent at minimum; an identity-only test will
  pass with broken math.
- **Three.js Object3D access from SOM node** — if the SOM↔Object3D
  mapping isn't easily accessible from the Inspector's drag code,
  there's a temptation to walk the scene graph to find it. Don't —
  capture the Object3D at hit-test time (`hit.object`) and hold it in
  drag state. Cleaner and avoids a lookup per move.
- **Capture-state coexistence with nav.** Session 32 punted on this
  by having the renderer peek at `client.hasPointerCapture`. Same
  pattern works here. Session 34 will formalize.
- **Continuous mutation cost.** ~60 mutations/sec during drag. Should
  be fine — SOM mutations are cheap and we have no expensive
  listeners. If profiling shows otherwise, rate-limit, but don't
  preemptively throttle.
- **The "first click selects, second click drags" two-step** may
  feel wrong on first use. If so, document in the build log and
  consider switching to "pointerdown-on-any-node selects-and-starts-drag"
  as a follow-up. Both are defensible; we picked the simpler one.
- **No visual selection feedback in the viewport.** Users will rely on
  the tree panel to see what's selected. This is awkward but
  acceptable for Session 33 — highlighting is its own concern.
- **Drag plane captured at node's world Y, not zero.** Important for
  correctness when nodes are stacked (crate on table). If a smoke test
  shows the crate teleporting to Y=0 on first drag, the plane is being
  captured at zero instead of the node's current Y.
