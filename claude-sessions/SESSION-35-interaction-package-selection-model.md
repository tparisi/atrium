# SESSION-35 — `@atrium/interaction` package launch + selection model

**Date:** 2026-05-03
**Predecessor:** Session 34 (renderer-three bridge extraction)
**Type:** New package + first tenant (small)
**Risk:** Low. Pure-function logic over SOM trees, two real consumers, no
network or lifecycle implications.

---

## Goal

Create `packages/interaction/` (`@atrium/interaction`) as the canonical
home for user-interaction policy, and land its first tenant: a
selection-model module supporting the lamp-style "click any part,
select the whole" pattern in the SOM Inspector and pointer playground.

This session is deliberately scoped to the package launch + selection
model only. It establishes the package's coherence criterion and seeds
it with a single, well-shaped module. Future drag UX, visual selection
feedback policy, and gesture conventions will land in subsequent
sessions.

---

## Background

### The lamp problem

`space.gltf` contains a `lamp` parent node with two mesh children
(`lamp-shade`, `lamp-stand`). The lamp parent has no mesh of its own.
In the Inspector today, clicking either child selects that child and
drags translate the child only — the lamp doesn't act as a unit.

This is the typical pattern for hierarchical content (chairs with
cushions, vehicles with wheels, characters with hat/body/shoes), not a
quirk of one fixture. Real worlds will be quite hierarchical.

### Why selection, not bubbling

This was originally framed as a bubbling problem ("we need parent
handlers to fire for child clicks"), but on inspection it's not.
Bubbling is a dispatch mechanism — *which handlers fire*. Selection is
a semantic question — *given a click on a leaf, what does the user
mean to select*. Selection policy is app-level logic; bubbling, when
it lands, will be a separate concern.

### Why a new package

Selection isn't the right kind of thing to live in `packages/client/`
(which is mechanism: connection, dispatch, sync — no UX policy) or
`packages/som/` (which is core data: load-bearing for server, client,
and tests; not a home for interaction heuristics). Selection isn't a
one-off either: drag math, axis-locked drag, gesture conventions,
visual-feedback policy, multi-select are all the same kind of thing —
shared interaction utilities that apps compose over.

`@atrium/interaction` is the named home for that category. Launching
it now, with a single well-scoped tenant, costs little; refactoring
selection out of client later when the category grows costs more.

---

## Selection-model design

### Pattern C — heuristic with modifier-key escape

Default selection walks up to a "selection root" determined by a
heuristic. Modifier-key (Alt) descends to the leaf as escape. No
explicit `selectable` marker in the data model — the glTF node
hierarchy itself is the authoring expression of grouping.

### The heuristic — `nearestNonMeshAncestor`

Walk up from the leaf to the nearest non-mesh transform ancestor.

```javascript
let current = leaf
while (current.parent && !isScene(current.parent)) {
  if (current.parent.mesh === null) return current.parent
  current = current.parent
}
return leaf
```

- Walks one step at a time. The *first* non-mesh ancestor wins, not
  the highest. This naturally respects whatever level of grouping the
  modeler authored.
- Stops at the scene boundary. The scene root itself is never returned.
- Falls back to the leaf if no non-mesh transform ancestor is found
  before the scene — so an orphan top-level mesh selects itself.

### Cases

| Click target                | Resolves to        |
|-----------------------------|--------------------|
| `lamp-shade` (mesh, parent `lamp` no mesh) | `lamp` |
| `lamp-stand` (mesh, parent `lamp` no mesh) | `lamp` |
| `crate` (orphan mesh, parent is scene)     | `crate` |
| `cushion-mesh` (under `cushion-group` under `chair`) | `cushion-group` (nearest, not highest) |
| Empty transform with no children | itself |
| Mesh with mesh children (parent has its own mesh) | itself — mesh-ness wins |

The last case is worth a comment in the code: a node that is *both*
geometry and a parent does not act as a selection group. If a modeler
wants such a node to be selectable as a group, they put the mesh in a
child node. This is conventional Blender-style "Empty parent" usage.

### The descent escape

Alt-click returns the leaf. Implemented in the wrapper, not the
policy — the policy stays a pure walk; descent is a UX convention
that wraps any policy.

```javascript
export function resolveSelectionRoot(leaf, {
  policy = nearestNonMeshAncestor,
  descend = false,
} = {}) {
  if (descend) return leaf
  return policy(leaf)
}
```

No ascent gesture. To get back to the lamp after Alt-clicking the
shade, click empty space (deselect — separate backlog item) and
re-click the lamp from scratch.

---

## Package design

### Coherence criterion

`@atrium/interaction` houses **user-interaction policy**: pure
utilities and conventions for how user input maps to world mutations
and selection state.

### In scope

- Selection policies (this session)
- Drag math, axis locks, modifier conventions (future)
- Gesture conventions — single-click vs double-click, modifier
  semantics (future)
- Multi-selection state and policy (future)
- Visual-feedback *policy* — what should be highlighted, when (future)

### Out of scope

- **No mechanism.** Connection, dispatch, sync stay in `@atrium/client`.
  The pointer bridge stays in `@atrium/renderer-three`.
- **No rendering.** Visual-feedback policy may live here; the actual
  meshes/materials/shaders that implement highlight stay in
  renderer-specific packages.
- **No app-shell concerns.** Layout, panels, HUD stay in `apps/` and
  `tools/`.
- **No protocol.** If selection ever becomes shared (peer A sees what
  peer B has selected), the wire format goes in `@atrium/protocol` and
  the broadcast policy follows the existing SOM-mutation pattern.
  `@atrium/interaction` does not grow a network layer.

The README must state these inclusions and exclusions explicitly. This
is the load-bearing artifact preventing the package from becoming a
junk drawer.

### Dependency rule

```
@atrium/interaction depends on @atrium/som
@atrium/interaction does NOT depend on @atrium/client
@atrium/client does NOT depend on @atrium/interaction
```

Apps and tools depend on both. AtriumClient stays narrow.

If a future feature would require AtriumClient to import from
`@atrium/interaction`, that is a signal the design is wrong and the
feature belongs elsewhere.

---

## Files expected to change

### New

- `packages/interaction/package.json`
- `packages/interaction/README.md` — package purpose, coherence
  criterion, in-scope/out-of-scope sections (per above)
- `packages/interaction/src/index.js` — re-exports
- `packages/interaction/src/selectionModel.js` — exports
  `nearestNonMeshAncestor`, `leafOnly`, `resolveSelectionRoot`
- `packages/interaction/tests/selectionModel.test.js` — unit tests
  against pure SOM trees

### Modified

- `tools/som-inspector/src/app.js` — pointerdown handler routes
  through `resolveSelectionRoot(leaf, { descend: event.detail.altKey })`;
  tree-selection sync and property-sheet display use the resolved
  node, not the raw leaf
- `tools/som-inspector/index.html` — import map adds
  `@atrium/interaction`
- `apps/playground/src/*` — visibility-toggle handler routes through
  `resolveSelectionRoot`; default click hides the lamp, Alt-click hides
  individual parts
- `apps/playground/index.html` — import map adds `@atrium/interaction`
- `apps/client/index.html` — import map adds `@atrium/interaction`
  (forward-compat; not consumed yet)
- Root `pnpm-workspace.yaml` if needed (verify package is picked up)

### No changes expected in

- `packages/client/` — AtriumClient stays free of interaction-package
  awareness
- `packages/som/` — selection logic does not modify SOM
- `packages/renderer-three/` — bridge stays renderer↔SOM resolution
  only; selection policy lives one layer up
- `packages/protocol/` — no wire-format changes
- `packages/server/` — server is unaware of selection
- `apps/client/src/` — `apps/client` doesn't currently do click-to-select
  in the viewport; only the import map is updated for forward-compat

---

## Tests

### Unit tests (`packages/interaction/tests/selectionModel.test.js`)

Build pure SOM trees in-memory (no Three.js, no DOM). Assert
resolution outcomes:

1. `nearestNonMeshAncestor` — lamp case. Tree: `scene → lamp (no mesh)
   → lamp-shade (mesh)`. Resolves shade to lamp.
2. `nearestNonMeshAncestor` — orphan mesh. Tree: `scene → crate (mesh)`.
   Resolves crate to itself.
3. `nearestNonMeshAncestor` — deeply nested. Tree: `scene → chair (no
   mesh) → cushion-group (no mesh) → cushion-mesh (mesh)`. Resolves
   cushion-mesh to cushion-group, *not* to chair.
4. `nearestNonMeshAncestor` — empty transform. Tree: `scene →
   empty-pivot (no mesh, no children)`. Resolves empty-pivot to itself.
5. `nearestNonMeshAncestor` — mesh with mesh children. Tree:
   `scene → building (mesh) → sign (mesh)`. Resolves sign to itself
   (mesh-ness wins, building is not a selection root).
6. `leafOnly` — returns input unchanged for all of the above.
7. `resolveSelectionRoot` — default (no opts) matches
   `nearestNonMeshAncestor`.
8. `resolveSelectionRoot` — `descend: true` matches `leafOnly`.
9. `resolveSelectionRoot` — explicit `policy: leafOnly` matches
   `leafOnly`.

Test count target: 9+ tests in the new package.

### Smoke tests

Append to existing smoke-test plans, do not replace.

**Inspector** (`tools/som-inspector/`) — load `space.gltf`:

1. Click `lamp-shade` in viewport. Expected: `lamp` is selected
   (highlighted in tree, shown in property sheet). Drag translates the
   lamp; both shade and stand move with it.
2. Click `lamp-stand` in viewport. Expected: `lamp` is selected. Drag
   translates the lamp.
3. Alt-click `lamp-shade`. Expected: `lamp-shade` is selected. Drag
   translates the shade only; stand stays put.
4. Click `crate` (orphan mesh). Expected: `crate` is selected. Drag
   translates the crate. Alt-click does the same — no escape needed
   for non-grouped objects.
5. Tree-click on `lamp-shade` directly. Expected: `lamp-shade` is
   selected (tree clicks bypass the heuristic; tree shows the literal
   structure).

**Playground** (`apps/playground/`) — load `space.gltf`:

1. Click `lamp-shade` in viewport. Expected: the entire lamp hides
   (visibility toggles on `lamp`).
2. Click `lamp-stand`. Expected: same — entire lamp hides.
3. Alt-click `lamp-shade`. Expected: only the shade hides; stand
   remains visible.
4. Click `crate`. Expected: crate hides.

The playground's previous Test 2 ("clicking lamp parent fires no event
because lamp has no mesh") is obsolete — the lamp parent is still not
hit-targetable, but its children now resolve to it via the selection
model. Update the smoke plan to reflect the new shape.

---

## Implementation order

1. Create `packages/interaction/` with `package.json`, README,
   `src/index.js`, empty `selectionModel.js`, empty test file.
   Verify `pnpm install` and `pnpm --filter @atrium/interaction test`
   work end-to-end before writing logic.
2. Implement `nearestNonMeshAncestor` and `leafOnly`. Land tests 1–6.
3. Implement `resolveSelectionRoot` wrapper. Land tests 7–9.
4. Add `@atrium/interaction` to the three apps' import maps.
5. Wire the Inspector: pointerdown handler resolves the leaf; tree
   selection points to resolved node; property sheet shows resolved
   node. Pass Alt-key state through from the pointer event detail.
6. Wire the playground: visibility-toggle handler resolves the leaf
   before mutating.
7. Run smoke tests against `space.gltf`.
8. Update the canonical handoff (`Project_Atrium_2026-05-03.md`) to
   add Principle 13 and reflect the new package in the repo
   structure, status table, and test counts.

---

## Risks / watch-outs

### "Where does the Alt key state come from?"

Pointer event detail already carries `altKey`. The Inspector's
existing pointerdown handler reads `event.detail.altKey` and passes it
through to `resolveSelectionRoot`. Verify this on the way through —
the field is documented in the canonical doc but worth re-checking
against the actual implementation.

### Tree click vs viewport click

Selecting a node via the Inspector tree should *not* go through the
selection heuristic — the tree is a literal view of structure, and a
user clicking `lamp-shade` in the tree means they want to see
`lamp-shade`. Only viewport clicks invoke `resolveSelectionRoot`.
Verify the Inspector keeps these paths distinct.

### Property-sheet-during-drag is a separate bug

The property sheet still doesn't update reactively during a drag (see
canonical doc Known Issues). This brief does not fix that. After this
session, the property sheet *will* show the lamp's properties when the
user clicks the shade, but it still won't update during a drag —
that's a separate fix in the polish backlog.

### Playground's old Test 2

The previous smoke plan included a test that clicking the lamp parent
fires no event. That test was correct under leaf-only dispatch with no
selection model. After this session, the *user-perceived* behavior
changes (clicking any part of the lamp hides the lamp), but the
*technical* fact that the lamp parent has no mesh and is not directly
hit-testable is unchanged. Update the smoke plan; do not "fix"
anything in the bridge.

### Don't widen scope

Resist the temptation to extract drag math into the new package this
session. Drag math currently lives in `@atrium/renderer-three`. A
future session ("drag UX polish") may extract a renderer-neutral
portion of it into `@atrium/interaction`. That's a real and good idea;
it is not this session's idea.

### Resist over-narrating in code comments

Selection-model code is small. The README and this brief carry the
"why." Keep code comments to "what unusual thing is happening here";
defer the explanatory prose to the README.

---

## Acceptance criteria

- `pnpm --filter @atrium/interaction test` passes with 9+ tests.
- Existing test counts hold (or grow only via additions): protocol 46,
  som 109, server 32 (verify, see canonical doc note), client 96,
  renderer-three 19. New: interaction 9+.
- Inspector smoke tests 1–5 pass.
- Playground smoke tests 1–4 pass.
- README clearly states the coherence criterion and out-of-scope list.
- AtriumClient (`packages/client/`) has no new imports from
  `@atrium/interaction`.
- `Project_Atrium_2026-05-03.md` is updated with Principle 13, the new
  package in the repo map, the new test count line, and a status-table
  row for `@atrium/interaction`.

---

## Principle 13 (to add to canonical doc)

> **User interaction policy lives in `@atrium/interaction`.** AtriumClient,
> SOM, and renderer packages do not encode interaction conventions; they
> expose mechanism that interaction policies compose over. Apps consume
> `@atrium/interaction` directly, not via AtriumClient.

---

## Open questions for the next session

- Drag UX session: camera-relative drag, axis locks, visual selection
  feedback. Probably the next interaction-package tenant.
- Does the Inspector want a "click empty space to deselect" behavior
  this session, or wait for the drag-UX polish session? (Recommend:
  wait — it touches similar code.)
- Does `nearestNonMeshAncestor` want a configurable scene-boundary
  predicate (for future apps that scope selection to a sub-tree)? Not
  this session; flagged for later.
