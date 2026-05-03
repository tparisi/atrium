# Session 35 Backlog — Post-Pointer-Events-Pass-1

After completing Sessions 32–34 (the foundational pointer-events arc),
the following issues and improvement items have been identified. They
are not all suitable for a single Session 35; this is a backlog from
which sessions can be planned.

Items are grouped by theme. Within each group, items are roughly
ordered by impact / urgency.

---

## Pointer event system gaps (from Sessions 32–34 work)

### Pointer event bubbling — DESIGN + IMPLEMENT

**Status:** Critical design item, first concrete need surfaced in
Session 34.

**Discovered:** Playground smoke test, Test 2 — clicking the lamp
parent in `space.gltf` fires no event because the lamp has no mesh of
its own; only its children (`lamp-shade`, `lamp-stand`) are
hit-targets. Workaround: attach handlers to leaf children. Doesn't
scale beyond demos.

**Scope sketch (from Session 34 discussion):**
- Leaf-first dispatch with bubble-up propagation
- `stopPropagation()` activated (currently a no-op reservation)
- `event.target` (the leaf) vs `event.currentTarget` (the node whose
  listener is currently firing) — new event semantics
- Bubble-only (no DOM-style capture phase — defer)
- `pointerover` / `pointerout` bubbling semantics need careful
  design — DOM's behavior is subtle (deep-leaf-only fires + bubbles)
  and shouldn't be blindly copied
- Coordinate-space decision: `localPoint` / `localNormal` stay
  leaf-local, documented; parent handlers compute their own if needed

**Why it matters:** Without bubbling, real scenes (anything with
hierarchical groupings) can't have unit-level interaction handlers.
Every "click the lamp" UX requires per-leaf wiring. Filed as
medium-high priority because it's the first concrete need; will keep
surfacing in any non-trivial scene.

**Suggested approach:** Standalone session for design, separate session
for implementation. Possibly land together if design comes through
clean. Bubbling implementation will likely touch SOM event dispatch,
not just AtriumClient — worth scoping carefully.

---

### Hit-test resolves to invisible nodes — BUG

**Status:** Confirmed during Session 34 smoke testing. Root cause
unconfirmed.

**Behavior:** Setting `threeObj.visible = false` on a SOM node's
Three.js Object3D continues to allow that node to be hit by the
bridge's raycaster, contrary to default Three.js raycaster behavior
(which skips invisible objects since ~r128).

**Suspected cause:** Visibility toggled on a parent transform node,
but raycaster traversal still hits child mesh whose own `visible` is
true. Three.js may not propagate visibility checks during recursive
raycast traversal in all cases.

**Diagnostic procedure** (not yet run):
```js
const lampShade = sceneGroup.getObjectByName('lamp-01-shade')
console.log('shade visible:', lampShade.visible)
console.log('shade children:', lampShade.children.map(c => ({
  name: c.name, visible: c.visible, isMesh: c.isMesh
})))
```

**Fix candidates:**
- (a) Bridge walks hit ancestry checking visibility at every level,
  masking invisible-ancestor hits. Centralizes the fix; consumers
  don't need to think about it.
- (b) Per-call-site discipline to toggle visibility at the mesh level
  (recursively), not parent transform level. Easy to forget.

**Recommendation:** (a). Run the diagnostic first to confirm root cause
before designing the fix.

**Severity:** Low for current consumers (the playground's "click
toggles visibility" demo actually still works as a true toggle, just
for the wrong reason). Higher importance for future bridge consumers
who may rely on hidden-equals-untouchable semantics.

---

### Property sheet doesn't reactively update on mutations — UX BUG

**Status:** Discovered during Session 34 regression testing. Specific
to `tools/som-inspector`.

**Behavior:** During a drag, SOM mutates continuously and the renderer
reconciles, but the Inspector's property sheet shows the values that
were captured at selection time. They don't update until the node is
re-selected.

**Root cause:** Property sheet renders on `propSheet.show(somNode)`
once per selection change. No subscription to mutation events on the
displayed node.

**Fix:** Subscribe to mutation events on the displayed node when
`show(node)` is called; re-render on mutation; unsubscribe on next
`show(other)` or `show(null)`. Standard observable pattern.

**Generalizes to:** future networked-Inspector case where remote peers
can mutate nodes — property sheet should stay current automatically.

**Subtlety:** ~60 mutations/sec during drag. Re-rendering 60Hz is fine
for small property sheets but may need rAF coalescing for complex
ones. Don't preemptively optimize; profile if jank appears.

**Effort:** Small. Estimated 1-2 hours.

---

## Renderer abstraction follow-ups (from Session 34)

### AnimationMixer / AvatarController modular review — DESIGN

**Status:** Deferred from Session 34 brief.

**Context:** `packages/renderer-three/` was created with the bridge
as its first tenant. Long-term it should house all Three.js-specific
glue — including the AnimationMixer integration code currently
duplicated between `apps/client` and `tools/som-inspector`.

**Why not yet:** The animation integration code wasn't designed for
extraction. Sessions 27–31 drove it to its current shape solving real
bugs, not for modularity. Needs an analysis pass before extraction.

**Suggested approach:**
1. Analysis-only session: read the current AnimationMixer code in
   both apps; identify shared patterns, divergent assumptions, and
   the actual coupling to non-renderer concerns.
2. Decide whether the right abstraction is "AnimationBridge-style"
   (analogous to PointerInputBridge), shared helpers, or some other
   shape.
3. Extract in a follow-up session.

**Not urgent.** The duplication is stable (no recent churn), so it's
not actively biting. Extract when modularity is the bottleneck for
some other goal.

---

### Diagnostic console handlers in apps/client — POLISH

**Status:** Outstanding TODO from Session 32.

**Behavior:** `apps/client/src/app.js` attaches console-log handlers
to every non-ephemeral SOM node on `world:loaded`. Useful during
development; noisy in production-ish demos.

**Fix:** Gate behind a debug flag (e.g.,
`window.ATRIUM_DEBUG_POINTER`, off by default). One-line change.

**Effort:** Trivial.

**Worth bundling with:** any other apps/client polish (e.g., the
fixture path cleanup below).

---

### Click-to-deselect on empty space — TODO

**Status:** Deferred from Session 33; flagged with `// TODO Session 34`
in code; deferred again from Session 34.

**Behavior:** Currently the only way to deselect a node in the
Inspector is to reload the world or select a different node. Clicking
empty viewport space does nothing.

**Why deferred:** Distinguishing "click on empty space" from "drag
that started on empty space" requires care. Easier to defer than to
handle awkwardly mid-other-work.

**Possible approach:** Track mousedown world position + mousedown
target. On mouseup, if same target (null) and cursor hasn't moved
beyond a small threshold, treat as deselect click. Standard pattern.

**Effort:** Small to medium. Worth pairing with any drag-UX work that
touches similar code.

---

### Fixture loading paths are fragile across apps — POLISH

**Status:** Discovered during Session 34 playground setup.

**Behavior:** Different apps have different relative paths to
`tests/fixtures/space.gltf` because they're at different depths in
the directory tree. Hand-counting `../`s is fragile.

**Fix:** Either:
- Use server-root-relative paths (`/tests/fixtures/space.gltf`) if
  the dev server serves the repo root.
- Use `new URL('...', import.meta.url)` for module-relative paths
  that don't depend on which HTML loaded the JS.

**Effort:** Trivial. Worth applying to all three apps for consistency.

---

## Drag UX (from Session 33 + Session 34 observations)

### Camera-relative drag — UX BUG

**Status:** Identified during Session 33 smoke testing. World-space
ground-plane drag is correct math but feels wrong when the camera is
rotated.

**Behavior:** "Drag right on screen" moves the object world-east,
which feels backwards when the camera has been turned to face other
directions. The fix is to interpret cursor delta in screen-space and
project onto camera-relative axes (camera right + camera forward
projected to horizontal), keeping the drag plane horizontal.

**Effort:** Medium. Changes the math in the Inspector's drag
handlers (which will eventually move to a shared helper). Specifically
captures camera right/forward at mousedown, transforms screen-space
cursor delta → world-axes motion.

**Worth pairing with:**
- Axis-locked drag (modifier-key escapes for vertical / single-axis)
- Possibly visible drag-axis indicators
- Re-evaluating the "first click selects, second click drags"
  two-step UX

**All four are drag-UX questions.** Probably want to tackle them as a
"drag UX polish" session rather than piecemeal.

---

### Rotation / scale drag gestures — FEATURE

**Status:** Out of scope for Sessions 32–34. No design exists.

**Need:** Some way for users to rotate and scale objects, not just
translate. Standard editor affordances are visible gizmos
(translate/rotate/scale handles) or modifier-key escapes
(Shift+drag = rotate, etc.).

**Effort:** Medium-large. Visible gizmos are a real implementation
effort (mesh + interaction state + hit-test priority). Modifier keys
are simpler but require careful UX design.

**Pair with drag UX polish session.**

---

### Visual feedback for selected node in viewport — UX

**Status:** Deferred from Session 33. Selection currently visible only
in the tree panel.

**Need:** Some visual indication in the viewport that a node is
selected — outline, bounding-box, tint, etc.

**Effort:** Variable. Outline shaders / post-processing are heavier;
a colored bounding box is simpler. Either way, render-only concern.

**Worth pairing with drag UX polish session.**

---

## Process / project items

### Test count reporting in build logs

**Status:** Process improvement, not a code item.

**Observation:** Session 33's build log misreported test counts
(showed "18/18" when actual was 96). Caught during Session 34 review.
Cause: Claude Code summarized partial test output rather than running
full recursive test command.

**Fix:** Future session briefs explicitly require build logs to
include the full output of `pnpm -r test` (or whatever the recursive
command resolves to in this project), not summary numbers. Verifiable
rather than trusted-by-narration.

**Effort:** Trivial — boilerplate in future briefs.

---

### Smoke-test plan provenance

**Status:** Process observation.

**Pattern:** When sessions ship with new smoke-test plans authored by
Claude Code (vs. the assistant), there's drift risk — Session 33's
initial smoke plan dropped tests from the original. Worth being
explicit in future briefs that smoke-test plans, when extending or
modifying existing ones, should preserve the existing tests and add to
them, not replace.

**Fix:** Boilerplate in future briefs.

---

## Out-of-scope reminders (not to forget)

These were correctly deferred during Sessions 32–34 and aren't
backlog items per se, but worth keeping visible so they're not lost:

- **Touch / pen pointer events.** API named `pointer*` for forward-compat,
  only mouse drives it currently. Real touch support is its own session.
- **Networked pointer events / interactivity extension.** The original
  framing in Session 32 had this as a follow-up arc — local pointer
  events first, then `ATRIUM_interactivity` extension for declarative
  trigger/action pairs that broadcast through SOM mutations. Hasn't
  been started. Bubbling is probably a prerequisite.
- **Undo/redo.** Mentioned as deferred in Session 33; no current work.
  When it lands, drag mutations need to be a single undoable unit, not
  60 per second.

---

## Suggested Session 35 framings

A few options for what Session 35 could actually be, with rough scope:

- **"Bubbling design" (small).** Just the design brief, no code.
  Settle the open questions (pointerover/pointerout semantics,
  currentTarget shape, propagation order). Hand off the brief to a
  Session 36 implementation. — *Recommended if you want to think
  carefully before building.*
- **"Bubbling implementation" (medium-large).** Combined with the
  design. More ambitious. Risk: design might not survive
  implementation; better split. — *Don't recommend without a design
  pass first.*
- **"Pointer events polish" (small-medium).** Bundle the small fixes:
  property sheet reactivity, fixture paths, debug flag for diagnostic
  handlers, and possibly click-to-deselect. Solid week of paying down
  cleanup before tackling bubbling. — *Recommended if you want a
  breather before the next big design.*
- **"Drag UX polish" (medium).** Camera-relative drag, axis-locked
  drag with modifiers, visual selection feedback. Closes out drag
  feeling-rough rough edges before bubbling makes selection more
  complex. — *Recommended if drag UX is a noticeable irritant.*
- **"Hit-test invisibility bug investigation" (small).** Run the
  diagnostic, decide on fix shape, implement. Could be paired with
  pointer events polish. — *Low effort, decent payoff for hygiene.*

The bubbling work is the highest-impact item in the backlog but also
the riskiest if rushed. A pointer-events-polish session before
bubbling would land a bunch of small wins and surface anything else
that's been bothering you. Either order is defensible.
