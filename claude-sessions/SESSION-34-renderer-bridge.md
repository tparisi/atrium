# Session 34 — Renderer/Input Bridge + Pointer-Test Playground

## Goal

Extract the duplicated renderer-side pointer wiring from `apps/client`
and `tools/som-inspector` into a new package, `packages/renderer-three/`,
and validate the abstraction against a third call site: a new
pointer-test playground app.

By the end of this session:

- `packages/renderer-three/` exists, with a `PointerInputBridge` that
  owns hit-testing, event detail construction, canvas listener
  attachment, navigation-coexistence pragma, and pure drag math
  helpers.
- `tools/som-inspector` migrated to consume the bridge. Selection +
  drag still work identically. Smoke test from Session 33 still
  passes.
- `apps/client` migrated to consume the bridge. Diagnostic console
  handlers still work. Smoke test from Session 32 still passes
  (or its current equivalent).
- `apps/playground/` exists as a new app with three demonstration
  scenes: rollover-changes-material, click-toggles-visibility,
  drag-translates. All implemented through the bridge from the start.

The three call sites validate the abstraction. If any one of them
needs to reach around the bridge to access raw Three.js or
DOM-event state, that's a signal the abstraction's shape is wrong —
fix it then, not after Session 34 ships.

---

## What's deferred (explicit non-goals)

- **AnimationMixer / AvatarController extraction.** The
  `packages/renderer-three/` package will eventually house all
  Three.js-specific glue, but the AnimationMixer integration code
  wasn't designed for extraction and needs its own analysis pass.
  Defer to a future "modular rendering review" session. Session 34
  scope is pointer wiring only.
- **Rotation/scale drag gestures.** The playground's drag
  demonstration uses the same translate-only drag from Session 33.
  Rotation, scale, and modifier-key drag variants are deferred to a
  dedicated drag-UX session.
- **Camera-relative drag UX fix.** The "drag-right-moves-world-east"
  issue noted in Session 33's commit message is filed for a future
  drag-UX session. Session 34 preserves Session 33's behavior
  exactly — bug-for-bug compatible — so the migration is a true
  refactor.
- **Click-to-deselect on empty space.** Still a TODO from Session 33.
  Worth tackling in the bridge if it falls out naturally; otherwise
  defer once more.
- **Touch / pen support.** Pointer events are still mouse-only.
- **Bridge testing via Three.js test harness.** The bridge has Three.js
  dependencies that don't unit-test cleanly. Coverage strategy:
  unit-test the pure math, rely on smoke testing across three call
  sites for the rest.

---

## Architecture

The Session 32 dispatch flow is unchanged at the dispatch layer:

```
DOM PointerEvent
    │
    ▼
[PointerInputBridge]  ← raycast, resolve, buildDetail, dispatch
    │
    ▼
client.dispatchPointerEvent(somNode, type, detail)
    │
    ▼
[AtriumClient]
    │
    ▼
[SOMObject._dispatchEvent]
```

The bridge sits in front of `AtriumClient.dispatchPointerEvent`, owning
everything between DOM events and the SOM dispatch call. The bridge is
a single object configured once per app and disposed when the app tears
down.

---

## `packages/renderer-three/` — package layout

```
packages/renderer-three/
  package.json              ← name: "@atrium/renderer-three", peerDeps: three, @atrium/client, @atrium/som
  src/
    index.js                ← public exports
    PointerInputBridge.js   ← the bridge
    drag-math.js            ← pure math helpers (moved from tools/som-inspector)
    hit-test.js             ← hit-testing internals (extracted from current duplication)
  tests/
    drag-math.test.js       ← unit tests for pure math
    hit-test.test.js        ← unit tests for any pure helpers in hit-test.js
```

**Public API (from `index.js`):**

```js
export { PointerInputBridge } from './PointerInputBridge.js'
export { projectRayToPlane, computeParentInverse } from './drag-math.js'
```

`hit-test.js` internals are **not** exported. If a consumer thinks it
needs them directly, that's a sign the bridge API is missing a feature;
fix the bridge.

---

## `PointerInputBridge` API

### Construction

```js
const bridge = new PointerInputBridge({
  client,             // AtriumClient instance
  canvas,             // HTMLCanvasElement (where DOM events come from)
  camera,             // THREE.Camera
  sceneRoot,          // THREE.Object3D (raycaster target — typically sceneGroup)
  resolveSOMNode,     // optional: (Object3D) => SOMNode | null
                      //   Defaults to walking parents matching .name via client.som.getNodeByName
  suppressOnCapture,  // optional bool, default true
                      //   Whether to call e.stopPropagation() on mousedown when capture is set
})
```

The constructor attaches DOM listeners on `canvas` immediately and
begins dispatching events through `client.dispatchPointerEvent`.

`resolveSOMNode` defaults to the established walk-up-by-name pattern.
The override exists for cases where a consumer has a different
naming-to-SOM-node mapping (none currently exist, but it's a low-cost
escape hatch for future flexibility).

`suppressOnCapture` defaults to `true` (matches current behavior). The
override exists for the playground, which has no nav controller and
therefore no need for stopPropagation — and which can serve as a
self-test that the option works. It's also a useful escape valve if
some future consumer integrates with an event system that needs to see
the events even during capture.

### Methods

```js
bridge.dispose()
```

Removes DOM listeners. Must be called when the consumer unmounts /
tears down. Idempotent.

That's the entire public method surface. The bridge is fire-and-forget
once constructed — apps still attach listeners to SOM nodes via
`somNode.addEventListener('click', handler)`, exactly as Sessions 32
and 33 did. The bridge changes nothing about how event handlers are
written; it only consolidates the wiring that delivers events to SOM.

### Internal responsibilities

- Hit-testing (raycaster, NDC math, scene-root traversal)
- Resolving Three.js Object3D → SOM node
- Building event detail (`localPoint`, `localNormal`, `distance`, `uv`,
  ray, modifiers — full Session 32 amendment shape)
- Attaching/removing canvas DOM listeners
- Calling `client.dispatchPointerEvent`
- Capture-coexistence pragma: peeking `client.hasPointerCapture` after
  pointerdown dispatch and calling `e.stopPropagation()` if set and
  `suppressOnCapture: true`

### Internal state

The bridge holds:

- The constructor args
- `THREE.Raycaster` and `THREE.Vector2` scratch objects
- Bound listener references (for `removeEventListener` on dispose)

Nothing else. The bridge does not own selection, drag state, capture
state (that lives on `AtriumClient`), or any per-app concerns.

---

## Drag math helpers — moved to `packages/renderer-three/`

`projectRayToPlane(ray, planeY)` and `computeParentInverse(threeObj)`
move from `tools/som-inspector/src/drag-math.js` to
`packages/renderer-three/src/drag-math.js`. The Inspector imports them
from the new location.

API is unchanged from Session 33. Same edge cases (parallel ray,
negative t, identity-parent fast path).

If Session 33's implementation included additional helpers worth
preserving, move those too. Don't expand the API surface in this
session; just move what exists.

---

## Migration plan

### Step 1 — Build `packages/renderer-three/`

Create the package, move drag-math from the Inspector, build the
bridge by consolidating the duplicated wiring from `apps/client` and
`tools/som-inspector`. The bridge's behavior at this point should be
*the union* of what those two apps currently do — same hit-testing,
same buildDetail, same capture pragma.

Write unit tests for the moved drag-math helpers. The existing tests,
if any, come along; don't add new ones unless gaps surface. (Session 33
log noted Inspector has no test infrastructure, so likely no tests to
move.)

### Step 2 — Migrate `tools/som-inspector`

Replace the Inspector's hit-testing and canvas listener code with
construction of a `PointerInputBridge`. The Inspector's drag handlers
(`onNodeMouseDown`, `onNodeMouseMove`, `onNodeMouseUp`) and selection
logic stay exactly as they are — they attach to SOM nodes via
`addEventListener`, which the bridge doesn't touch. Inspector's
`drag-math.js` import path updates to point at
`@atrium/renderer-three`.

Run Session 33's smoke test plan unmodified. All ten tests should pass
exactly as they did before migration. **If any test behaves differently,
the bridge isn't bug-for-bug compatible and the diff needs
investigation before proceeding.**

### Step 3 — Migrate `apps/client`

Replace `apps/client`'s hit-testing and canvas listener code with
construction of a `PointerInputBridge`. The diagnostic console handlers
attached on `world:loaded` stay as-is.

Run Session 32's smoke test plan (or its merged version with the
Session 32 update). All tests should pass. The
NavigationController coexistence tests (6a–e in the merged plan) are
the most likely failure surface — those exercise the
suppressOnCapture pragma in its original setting.

### Step 4 — Build `apps/playground/`

New directory, new app. Three demonstration scenes (or one scene with
three demonstration nodes):

1. **Rollover changes material.** A node whose `pointerover` listener
   swaps the material to a highlight color, and whose `pointerout`
   restores the original.
2. **Click toggles visibility.** A node whose `click` listener toggles
   `node.visible` (or whatever the SOM analog is — verify by inspection
   of how `apps/client` handles this).
3. **Drag translates.** A node with the same select-then-drag
   behavior as Session 33's Inspector. Reuses
   `projectRayToPlane`/`computeParentInverse` from the package.

The playground constructs a `PointerInputBridge` from the start. No
duplicated wiring. If the bridge needs additional features to support
the playground cleanly, extract them — that's exactly what the third
call site is for.

The playground does **not** need:
- A nav controller (so it tests `suppressOnCapture: false`)
- Multi-user / WebSocket connection
- The full Inspector tree/property-sheet UI
- Configurable scene loading — a hardcoded fixture is fine

Keep it minimal. The playground is a test surface, not a production app.

---

## Tests

### Unit tests — `packages/renderer-three/tests/`

**`drag-math.test.js`** — preserve any tests Session 33 might have had
for the math helpers, plus:

- `projectRayToPlane`: parallel ray (|direction.y| < ε) returns null,
  negative t returns null, normal case returns correct point on the
  plane.
- `computeParentInverse`: object with no parent returns identity,
  object with translated parent returns translation inverse, object
  with rotated parent returns rotation inverse.

These are the tests Session 33 deferred when it noted the Inspector
had no test infrastructure. Session 34 has the new package, so they
land now.

**`hit-test.test.js`** — to the extent any hit-test logic is purely
functional (e.g., a "given a Three.js intersect result, walk up to
find a SOM node" helper that takes pure inputs), unit-test it. If
hit-test is too entangled with raycaster + camera state to test
without a Three.js scene, skip — rely on smoke testing.

### Integration tests — none required

The bridge depends on Three.js, DOM canvas, and AtriumClient state.
Setting up a test harness that exercises all three is more pain than
it's worth for a Session 34-shaped session. Smoke testing across three
real call sites is the integration coverage.

### Smoke tests

Three plans, run after migration:

1. **Session 32 (apps/client) smoke plan** — re-run unchanged, expect
   identical pass.
2. **Session 33 (Inspector) smoke plan** — re-run unchanged, expect
   identical pass.
3. **Playground smoke plan (new)** — see below.

### Playground smoke test plan (sketch)

Will be drafted as a separate doc following Session 34 implementation,
but expected scope:

- Rollover scene: hover node → material changes; unhover → material
  restores.
- Visibility scene: click node → it disappears; click again → it
  reappears (probably needs invisible-but-still-hittable design, or
  click-empty-space-to-restore — implementer's call).
- Drag scene: drag node, it translates correctly; release, position
  persists.
- Three scenes don't interfere — events on one don't fire handlers on
  another.

---

## Files expected to change

- `packages/renderer-three/` — new package, full contents
- `tools/som-inspector/src/app.js` — replace pointer wiring with bridge
- `tools/som-inspector/src/drag-math.js` — **delete** (moved)
- `apps/client/src/app.js` — replace pointer wiring with bridge
- `apps/playground/` — new app, full contents
- Workspace config (`pnpm-workspace.yaml` or `package.json` workspaces
  field) — add the new package and app

No changes expected in:

- `packages/client` — bridge consumes its API, doesn't change it
- `packages/som`, `packages/protocol`, `packages/server`

---

## Implementation order

1. Create `packages/renderer-three/` package skeleton
2. Move `drag-math.js`, write unit tests, confirm green
3. Build `PointerInputBridge` consolidating the duplicated wiring
4. Migrate `tools/som-inspector`; run Session 33 smoke tests; iterate
   until all pass identically
5. Migrate `apps/client`; run Session 32 smoke tests; iterate
6. Build `apps/playground/`; manual verification
7. Build log

---

## Risks / watch-outs

- **Bug-for-bug compatibility on migration.** If Session 32 or Session
  33 smoke tests behave even slightly differently after migration,
  investigate before proceeding. The temptation will be to "improve
  while extracting" — resist. Improvements come after the abstraction
  has proven stable.
- **The capture-coexistence pragma is the most likely shape-of-the-API
  question.** Session 32 chose `client.hasPointerCapture` as the
  read; the bridge must use the same read. If the bridge's
  consolidation introduces a different ordering — e.g., calling
  stopPropagation before dispatching pointerdown rather than after —
  navigation coexistence will break in subtle ways. Same order as
  Sessions 32/33: dispatch first, then peek capture, then maybe
  stopPropagation.
- **Three Object3D `.name` collisions.** Session 33's `getObjectByName`
  approach has a known fragility with non-unique names. The bridge's
  `resolveSOMNode` default uses the same walk-up-parents pattern. If
  the playground exposes a name collision (e.g., a fixture with two
  meshes named the same thing), document and treat as a known limit
  for now.
- **Workspace config.** New package + new app means workspace config
  needs updating. Easy to forget; manifests as "package not found"
  errors at install time.
- **`@atrium/renderer-three` peer dependencies.** Three.js,
  AtriumClient, SOM are peer deps, not regular deps. Avoids version
  drift between consumers and the bridge. Worth getting right
  early — fixing peer dep declarations after consumers ship is
  awkward.
- **Inspector drag handler refactor temptation.** The Inspector's drag
  handlers are still in `tools/som-inspector/src/app.js`. Tempting to
  also extract them to the bridge ("DragController" or similar). Don't —
  drag is per-app behavior layered on top of pointer events. The bridge
  is event delivery only. Drag generalization is a different session.
- **Hit-test on a scene that hasn't rendered yet.** The bridge's
  raycaster needs `matrixWorld` values that are only populated after
  at least one render. Sessions 32 and 33 happened to be safe because
  pointer events couldn't fire before the first paint. The playground
  may have a tighter init loop — worth verifying that the bridge
  doesn't dispatch on stale matrices during the first few frames.

---

## Acceptance

- All three smoke test plans pass (Session 32, Session 33, playground).
- All unit tests pass: existing 96 client + 109 SOM + 46 protocol +
  new drag-math tests in renderer-three.
- No regressions in `apps/client` or `tools/som-inspector` behavior.
- The duplicated hit-test/buildDetail/listener code is gone from
  `apps/client/src/app.js` and `tools/som-inspector/src/app.js`.
  Each call site's pointer wiring is now ~5 lines (constructor +
  dispose).
