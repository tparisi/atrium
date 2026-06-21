<!-- SPDX-License-Identifier: CC0-1.0 -->
# Session 46 Brief — SOM Inspector Camera Switching + Nested/Animated Camera Fixtures

## Context

Manual smoke testing of the `activeCamera` Phase 2 arc (Sessions 45, 45a)
relied entirely on visual inspection of `apps/client` against
`space-cameras.gltf`. Two gaps came out of that:

1. **No flexible testbed.** The sample client's only camera control is a
   Space-bar cycle through `client.som.cameras` — fine for a quick check,
   useless for repeatedly switching to a specific camera while inspecting
   its properties. `tools/som-inspector` already shows camera properties
   (`PropertySheet._buildCameraSection`) but has no way to *activate* a
   camera at all.
2. **No coverage for nested or animated camera host nodes.**
   `space-cameras.gltf` (see `tests/fixtures/generate-space-cameras.js`)
   has exactly two cameras, `MainCamera` and `OrthoCamera`, both added as
   direct scene children — i.e. both have an identity parent transform.
   The Session 45 smoke-test plan's Step 0 confirmed this. ORBIT's
   world-to-local conversion in `Stage._syncCamera()` has never been
   exercised against a real non-identity ancestor, static or animated.

Confirmed in chat: SOM Inspector's `Stage` is already constructed with a
`client` and `navMode: 'ORBIT'` (`tools/som-inspector/src/app.js`), and
`AvatarController._onWorldLoaded()` creates a local nav node even when
disconnected — so `stage.setActiveCamera()` and ORBIT both work in the
inspector with no server connection required. No changes needed there.

This brief covers three independent pieces of work, all small, landing
together because they share the same testbed and the same file
(`PropertySheet.js`) for two of them:

- **A.** Active-camera switching UI in SOM Inspector (toolbar dropdown +
  per-camera button + status-bar indicator).
- **B.** Orthographic `xmag`/`ymag` property rows in `PropertySheet.js`
  (pre-existing gap, found while scoping A — the Camera section currently
  renders Type / Y-FOV / Z-Near / Z-Far unconditionally for *every*
  camera, perspective or orthographic; there is no `xmag`/`ymag` editor
  at all today).
- **C.** Two new camera fixtures in `space-cameras.gltf`: one nested under
  a static non-identity transform, one nested under an animated
  transform. Both are new, independent nodes — `MainCamera` and
  `OrthoCamera` are untouched.

**Explicitly out of scope:** whether/how ORBIT should behave while bound
to a camera whose parent is actively animating. That's a real design
fork (flagged at the end of the Session 45 design conversation) and
needs its own session. This brief only needs the *fixture* to exist;
do not attempt to make ORBIT-while-animating "correct" as part of this
work, and do not change ORBIT's behavior in `_syncCamera` at all.

---

## A. SOM Inspector — Active Camera Switching UI

Three surfaces, all driving the same state (`nav.activeCamera`), no
surface is authoritative over another — they're three views of one
underlying `stage.setActiveCamera()` call.

### A1. Toolbar dropdown (primary control)

In `tools/som-inspector/index.html`, add a `<select id="camera-switcher">`
immediately after the existing `<select id="mode-switcher">` in the
`.toolbar` div. Style it the same as `mode-switcher` (the existing
`.toolbar select` CSS rule already covers it generically).

In `tools/som-inspector/src/app.js`:

- Maintain a module-level `let camerasList = []`, rebuilt in the
  `world:loaded` handler from `client.som.cameras` (alongside the
  existing `treeView.build(client.som)` call).
- Rebuild the dropdown's `<option>` list from `camerasList` on every
  `world:loaded`: a first option `value=""` / label `"Default"`, then one
  option per camera with **`value` = the camera's index in
  `camerasList`** (as a string), label = `cam.name`. Reset
  `cameraSwitcher.value = ''` on rebuild.
  - **Use array index, not camera name, as the option value.**
    `space-cameras.gltf`'s existing `MainCamera`/`OrthoCamera` pair is
    deliberately a node-name/camera-name collision case (see the
    fixture generator's own comment), and `SOMDocument.getObjectByName()`
    is a flat global namespace lookup — not safe for resolving a camera
    specifically by name when a node could share that name. Indexing
    into `camerasList` directly sidesteps this; don't use
    `getObjectByName()` here.
- Wire a single `change` listener (once, not inside `world:loaded`):
  reads `cameraSwitcher.value`, resolves `'' → null` or
  `camerasList[Number(value)]`, and calls a new shared helper (see A4)
  rather than calling `stage.setActiveCamera()` directly.

### A2. Per-camera button in PropertySheet

In `tools/som-inspector/src/PropertySheet.js`, `_buildCameraSection(cam)`
gets one new row, e.g. labeled `'Active'`:

- A single `<button>` that **toggles**: if `cam` is not the active camera,
  label "Set as Active Camera" and clicking it activates `cam`. If `cam`
  *is* the active camera, label something like "Active ✓ — click to
  deactivate" and clicking it deactivates (reverts to default).
- `PropertySheet` needs to know (a) whether `cam` is currently active and
  (b) how to change it, without depending on `Stage` or `app.js`
  directly — same pattern `WorldInfoPanel` already uses for
  `onBackgroundChange`. Add a third constructor parameter:
  ```js
  constructor(containerEl, headerEl, {
    isActiveCamera   = () => false,
    onSetActiveCamera = () => {},
  } = {}) { ... }
  ```
  store both on `this`, and use them in the button's render/click logic.
- **Reuse the existing `_updaters` mechanism** for live state sync rather
  than inventing a new refresh path: push a small render function (re-
  computes label/class from `isActiveCamera(cam)`) onto `this._updaters`
  the same way every other row in this file already does. This means the
  button updates for free whenever `propSheet.refresh(node)` is called —
  which app.js already needs to call from the shared helper in A4 below,
  so no new refresh plumbing is needed beyond that one call.

### A3. Status-bar indicator

Add a small child element inside `#status-bar` (e.g.
`<span id="camera-indicator"></span>`, or build it in JS and append it —
match whatever's more consistent with how `#status-bar`'s sibling
elements in this file are typically constructed) — **do not** modify
`updateStatusBar(text)` itself or any of its existing call sites. They
write the whole status-bar text for unrelated reasons (connection state,
load errors, world name) and routing the camera suffix through that
function risks it getting clobbered by the next unrelated
`updateStatusBar()` call, the same class of bug already diagnosed and
fixed once this arc (stale destructured references). A second,
independently-updated element avoids that entirely.

Content when set: `` `🎥 ${activeCamera.name}` ``, matching the sample
client's `apps/client/src/app.js` `updateHintText()` suffix convention
exactly (same emoji, same format). Empty string when no active camera.

### A4. Shared helper — single source of truth for "switch camera"

All three surfaces above must go through one function in `app.js` —
do not call `stage.setActiveCamera()` from more than one place. Suggested
shape:

```js
function applyActiveCamera(somCamera) {
  stage.setActiveCamera(somCamera)
  cameraSwitcher.value = somCamera ? String(camerasList.indexOf(somCamera)) : ''
  cameraIndicatorEl.textContent = somCamera ? `🎥 ${somCamera.name}` : ''
  const sel = treeView.selectedNode
  if (sel) propSheet.refresh(sel)
}
```

The toolbar `change` listener, and `PropertySheet`'s
`onSetActiveCamera` callback (passed in at construction, see A2), both
call this same function — never `stage.setActiveCamera()` directly from
either call site.

---

## B. Orthographic `xmag`/`ymag` rows in PropertySheet

In `_buildCameraSection(cam)`, add `xmag` and `ymag` rows using the same
pattern already used for `znear`/`zfar` (plain number `<input>`, not
`_addFactorRow` — those are linear distances, not the FOV-style factor
the Y-FOV row uses). Reasonable defaults/bounds: mirror what
`generate-space-cameras.js`'s `OrthoCamera` already authors (`xmag: 5`,
`ymag: 3`) for the fallback-when-undefined case, `min="0.01"`, no
particular `step` requirement beyond something sane (`step="0.1"` is
fine).

**Scope decision, made explicitly so it isn't a silent drive-by:** the
existing Type / Y-FOV / Z-Near / Z-Far rows are rendered unconditionally
today regardless of `cam.type` — a perspective camera's section doesn't
hide Z-Near/Z-Far (correctly, those apply to both types) but an
orthographic camera's section currently still shows the Y-FOV row, which
is meaningless for orthographic. **This brief's scope is additive only**
— add `xmag`/`ymag`, do not also hide Y-FOV for orthographic cameras or
otherwise restructure the section's conditional layout. If reorganizing
unconditional-vs-type-specific rows turns out to be trivial once you're
in there, flag it as a suggestion in the build log rather than doing it
silently.

---

## C. Two new camera fixtures

Extend `tests/fixtures/generate-space-cameras.js` (same script, same
output file — don't fork a new fixture). `MainCamera` and `OrthoCamera`
are unchanged; add two new, independent node chains.

### C1. `NestedCameraMount` → `NestedCamera` (static, non-identity nesting)

- `NestedCameraMount` — a plain transform node, **no camera**, added as a
  direct child of the scene. Give it a non-identity translation (pick
  something in the same neighborhood as the existing cameras/geometry —
  roughly the 0–10 unit range already used elsewhere in this fixture
  family) **and** a non-identity rotation.
  - **The rotation must be a compound rotation, not a single
    axis-aligned special case** (e.g. not just "90° about Y"). A pure
    axis-aligned 90°/180°/270° rotation can produce a matrix whose
    inverse "looks" correct even if the inversion math has a subtle bug,
    because of how cleanly those special-case matrices factor. Combine
    at least two axes (e.g. a yaw *and* a pitch component) so the
    resulting quaternion genuinely exercises
    `Stage._syncCamera()`'s `parent.matrixWorld.invert()` /
    quaternion-inverse-and-multiply path.
- `NestedCamera` — child of `NestedCameraMount`, carries a new
  **perspective** `SOMCamera` (reuse the same `createCamera()` /
  `setType('perspective')` / `setYFov()` / `setZNear()` / `setZFar()`
  pattern `MainCamera` already uses). Give it its own small non-zero
  local translation relative to the mount (so it's a genuine two-level
  chain, not a camera sitting exactly at its parent's origin).

This new perspective camera is also a side effect a fix for the
already-tracked backlog item: Session 45a's acceptance criterion 2
(stale aspect on a perspective camera that wasn't active during a
resize) was previously only verifiable by code inspection because the
fixture had only one perspective camera. This brief should note in the
build log that `NestedCamera` now allows that criterion to be
re-verified end-to-end if anyone wants to re-run that check.

### C2. `AnimatedCameraMount` → `AnimatedCamera` (animated nesting)

- `AnimatedCameraMount` — same idea as `NestedCameraMount` above (plain
  transform node, no camera, non-identity bind-pose translation/rotation,
  same compound-rotation requirement), but additionally gets a rotation
  animation channel.
- Author the animation using the **exact same idiom** as
  `tests/fixtures/generate-space-anim-base.js`'s `CrateRotate`: a
  `SCALAR` time accessor and a `VEC4` quaternion-output accessor, linear
  interpolation, targeting `AnimatedCameraMount`'s `rotation` path,
  start and end keyframe both identity-relative-to-bind-pose (i.e. a full
  loop back to the start value, same shape as `CrateRotate`'s
  0→90°→180°→270°→360°-about-Y keyframe set — reuse that exact value
  pattern, just targeting the new node). Name the animation something
  distinct, e.g. `CameraMountRotate`.
- **Do not set loop/autoplay extras** — match `CrateRotate`'s own
  fixture, which has no `animExtras` override and therefore uses
  `SOMAnimation`'s default (`loop: false`, not autoplaying). The
  animation should sit at its bind pose until manually played from SOM
  Inspector's existing `AnimationsPanel` Play button — no new playback
  wiring needed, `AnimationsPanel` already drives any animation in the
  loaded world.
- `AnimatedCamera` — child of `AnimatedCameraMount`, a second new
  **perspective** `SOMCamera`, same construction pattern as
  `NestedCamera` in C1.

Both new cameras are perspective (not orthographic) — deliberately, to
keep this fixture's purpose (nesting/animation) decoupled from the
already-known, already-deferred, separately-tracked orthographic
view-volume-doesn't-rescale-with-resize issue.

After regenerating, confirm `space-cameras.bin` is rewritten alongside
`space-cameras.gltf` (the existing generator writes both via `NodeIO`) —
don't hand-edit the `.gltf` JSON and leave a stale `.bin`.

---

## Non-Goals

- ORBIT behavior while bound to an animated parent — explicitly punted,
  see Context. The new `AnimatedCameraMount`/`AnimatedCamera` fixture
  existing does **not** imply this brief expects that case to work
  correctly; it only needs to be *available* for whoever picks up that
  design question next.
- Any change to `Stage.js`, `NavigationController`, or `_syncCamera()`.
  This brief is UI (SOM Inspector) and fixture-only; if anything here
  seems to require touching renderer-three or client packages, stop and
  flag rather than expanding scope.
- Reorganizing `PropertySheet`'s Camera section to conditionally
  show/hide rows by camera type — see the explicit scope note in §B.
- Touching `apps/client` or `apps/playground` — the active-camera
  switching UI is SOM-Inspector-only this session. The sample client
  keeps its existing Space-bar cycle, untouched.
- `MainCamera` / `OrthoCamera` — untouched; the name-collision case they
  exercise stays exactly as-is.

## Files Expected to Change

- `tools/som-inspector/index.html` — new `camera-switcher` select.
- `tools/som-inspector/src/app.js` — `camerasList`, dropdown
  population/wiring, status-bar indicator element + update, the shared
  `applyActiveCamera()` helper, `PropertySheet` constructor call site
  updated with the two new options.
- `tools/som-inspector/src/PropertySheet.js` — constructor signature
  (`isActiveCamera`, `onSetActiveCamera`), new button row in
  `_buildCameraSection`, new `xmag`/`ymag` rows.
- `tests/fixtures/generate-space-cameras.js` — two new node/camera
  chains, one new animation.
- `tests/fixtures/space-cameras.gltf`, `tests/fixtures/space-cameras.bin`
  — regenerated output.

## No Changes Expected In

- `packages/renderer-three/src/Stage.js` — `setActiveCamera()` and
  `_syncCamera()` are consumed as-is, not modified.
- `packages/client/src/NavigationController.js`,
  `packages/client/src/AvatarController.js`.
- `packages/som/src/SOMCamera.js` — no new properties needed; `xmag`/
  `ymag`/`yfov`/`znear`/`zfar` all already exist and are already mutable
  and networked (Session 42).
- `apps/client/src/app.js`, `apps/playground/**` — see Non-Goals.

---

## Risks / Watch-Outs

- **Don't let the toolbar dropdown and the PropertySheet button drift.**
  Both must go through `applyActiveCamera()` (§A4) — if a future change
  adds a third way to call `stage.setActiveCamera()` directly, the other
  two surfaces will silently go stale. This is the same class of bug
  Session 45 already fixed once (stale destructured `camera`
  references) — don't reintroduce a variant of it at the UI layer.
- **Dropdown rebuild on world reload.** `camerasList` and the dropdown's
  options must be fully rebuilt on every `world:loaded`, not just the
  first one — loading a second world with a different camera set (or no
  cameras at all) must not leave stale options pointing at SOMCamera
  instances from the previous world.
- **Axis-aligned rotation trap (C1/C2).** Called out above, repeating
  here because it's easy to default to for convenience: a single-axis
  90°-multiple rotation on either new mount node would make the fixture
  *look* like it covers the non-identity-parent case without actually
  stress-testing the inversion math. Use a compound rotation for both.
- **PropertySheet's `_updaters` already fires on unrelated `som:set`
  events** (existing mechanism, `app.js`'s `client.on('som:set', ...)`
  handler calls `propSheet.refresh()` for the selected node). The new
  button's render function living in `_updaters` means it'll also
  re-render on those — harmless (it's idempotent, just reads
  `isActiveCamera(cam)` again), but don't add any one-time-only logic to
  that render function that assumes it only fires after an explicit
  camera-switch.

---

## Acceptance Criteria

1. Loading `space-cameras.gltf` in SOM Inspector populates the toolbar
   dropdown with `Default`, `MainCamera`, `OrthoCamera`, `NestedCamera`,
   `AnimatedCamera` (order matches `client.som.cameras` order).
2. Selecting any camera from the dropdown activates it (viewport
   switches), updates the status-bar indicator to `🎥 <name>`, and — if
   that camera's host node happens to be selected in the tree — flips its
   PropertySheet button to the "active" state.
3. Clicking "Set as Active Camera" on a camera's PropertySheet row
   activates it and updates the dropdown + indicator to match. Clicking
   it again (now "Active ✓") deactivates and reverts the dropdown to
   "Default".
4. Selecting `NestedCamera`, switching nav to ORBIT (already the
   inspector's default mode), and dragging to orbit produces correct,
   non-degenerate orbit behavior around the camera's authored look
   direction — i.e. this is the manual verification of the previously-
   unverified "ORBIT under a static non-identity parent" case. Note the
   result explicitly in the build log; this is the actual point of C1.
5. Selecting `AnimatedCamera`, pressing Play on `CameraMountRotate` in
   the Animations panel, visibly shows the camera's rendered view
   rotating with its parent. No claim is made or required about ORBIT's
   correctness while this is playing — see Non-Goals — just that the
   camera follows its animated host node at all (i.e. the basic
   `updateMatrixWorld()` cascade this whole arc is built on still works
   for an actually-moving ancestor, not just a static one).
6. Orthographic `xmag`/`ymag` rows appear when `OrthoCamera` is selected,
   editing them live-updates the rendered view when `OrthoCamera` is
   active, and matches the existing `znear`/`zfar` rows' edit/refresh
   behavior (including surviving a `som:set` echo round-trip if
   connected to a server).
7. Full recursive test output; no regressions against the Session 45a
   baseline of 432. (No new automated tests are expected — this is all
   either SOM-Inspector DOM/WebGL UI, exactly the existing
   not-unit-testable-without-live-DOM constraint, or static fixture
   data. If any part of this *is* cleanly unit-testable — e.g. a pure
   fixture-shape assertion on the regenerated `.gltf` — feel free to add
   it, but it's not required.)

---

## Stop-and-Flag Conditions

- If wiring `isActiveCamera`/`onSetActiveCamera` into `PropertySheet`
  turns out to require restructuring how `_build()`/`show()`/`refresh()`
  pass state around more than the minimal constructor-option addition
  described in §A2 — stop and flag rather than refactoring the whole
  file's update model.
- If the compound-rotation fixture values chosen for C1/C2 produce a
  degenerate or confusing-to-eyeball orbit/animation in practice (e.g.
  gimbal-lock-adjacent angles) — stop and flag and propose different
  values rather than shipping a fixture that's technically non-axis-
  aligned but practically hard to visually verify.
- If anything in this brief seems to actually require touching
  `Stage.js` or `NavigationController` — stop and flag immediately. This
  was deliberately scoped to be UI- and fixture-only; if that's wrong,
  it's a scoping error to fix in chat, not something to quietly expand
  in the implementation.
