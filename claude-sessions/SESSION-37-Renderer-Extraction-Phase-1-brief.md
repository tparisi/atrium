# Session 37 Brief — Renderer Extraction, Phase 1: Animation + DocumentView

**Type:** Refactor / extraction. Production code changes.
**Predecessor:** `SESSION-36-renderer-coupling-audit.md` — read it first; this
brief is drafted directly from its findings.
**Deliverables:** Extracted code in `packages/renderer-three/`, both consumers
rewired, tests, and a build log.

---

## Background

Session 36 audited all Three.js coupling in the app/tool front-ends. Key
finding: the animation machinery is **near-identical** between `apps/client`
and `tools/som-inspector` — `buildClipsFromSOM`, `initDocumentView`,
`initAnimations`, the four `animCtrl` handlers, the `finished` listener,
`replayPlayingAnimations`, and the camera-sync block are all classified
**Identical**, differing only in log-prefix strings. `apps/playground` is
confirmed pointer-only and is **not** a consumer of any of this.

The audit recommends a two-phase extraction. This brief is **Phase 1**:
animation machinery + DocumentView wiring. Phase 2 (scene/camera bootstrap,
camera sync) is **deferred** — not in scope, not committed.

This is a **two-consumer extraction**. Per the project's process lessons,
that is riskier than three — the audit did the abstraction-shape validation
work that a third consumer normally would. The shape below follows the
audit's identified seams; do not deviate from it without stopping to flag.

---

## Goal

Extract the shared animation + DocumentView code into
`packages/renderer-three/`, and rewire `apps/client` and `tools/som-inspector`
to consume it. **Behavior must be identical post-migration** for both
consumers — this is a pure structural refactor, not an improvement pass.

---

## The extraction shape (settled — do not redesign)

Three new units in `packages/renderer-three/src/`, following the existing
package precedent (one stateful class — `PointerInputBridge` — plus pure
helper modules):

### 1. `buildClipsFromSOM(somDocument)` — pure function

Verbatim extraction of the existing function. `SOMDocument` in,
`THREE.AnimationClip[]` out. No state, no side effects. New module, e.g.
`build-clips.js`. The audit confirms this is byte-identical in both
consumers.

### 2. `initDocumentView(renderer, threeScene, somDocument)` — plain exported function

**Form: a plain exported helper function, not a class and not a method.**
Returns `{ docView, sceneGroup }`. Encapsulates the existing
`initDocumentView` body, including the dispose-and-remove of a prior
`docView`/`sceneGroup` (which it operates on via its arguments and return
value — it retains no instance state between calls, so there is nothing for
a class to hold). The caller owns the returned references and is responsible
for passing `sceneGroup` onward. New module, e.g. `document-view.js`.

This follows the package precedent: stateless helpers (`drag-math`,
`hit-test`) are plain functions; only the genuinely stateful unit
(`AnimationBridge`, as `PointerInputBridge` before it) is a class.

Note: this is conceptually DocumentView wiring, not animation — keep it a
**separate export**, not folded into `AnimationBridge`.

### 3. `AnimationBridge` — stateful class

Owns the genuinely-coupled stateful cluster. New module, e.g.
`AnimationBridge.js`.

- **Constructor takes `sceneGroup`** (plus `client` and `animCtrl`, whatever
  the handlers need). Taking `sceneGroup` at construction makes the
  audit's hard ordering constraint (`initDocumentView` must run before the
  mixer is created) **structurally unskippable** — you cannot construct an
  `AnimationBridge` before `initDocumentView` has produced a `sceneGroup`.
  This is **not a behavior change** — it is the same required order the
  code already depends on, made impossible to get wrong.
- Owns `mixer` and `clipMap` as instance state.
- Owns the four `animCtrl.on(...)` handler bodies — as instance methods or
  instance-bound closures referencing `this.clipMap` / `this.mixer`, **not**
  module globals (the audit's S7 flags this explicitly).
- Owns the `mixer.addEventListener('finished', ...)` natural-completion sync.
- Exposes `replayPlayingAnimations(som)` as a **method** (it needs `this.mixer`
  and `this.clipMap`).
- Exposes whatever the app tick needs to call: `mixer.update(dt)` stays a
  one-liner in the app tick — the bridge can expose an `update(dt)` method
  or expose `mixer` directly; pick the smaller change and note which.
- Provide a `dispose()` (mirrors `PointerInputBridge`) that stops actions
  and removes the `finished` listener.

The `if (clips.length > 0)` guard that leaves `mixer === null` for
animation-free worlds, and the `if (!mixer) return` guards in the handlers,
are **preserved exactly** — see Non-goals.

---

## `loadBackground` — extract, do not "fix"

The audit found `apps/client`'s background loading is divergent: a correct
`loadBackground(bg, baseUrl)` function exists and is called from `som:set`,
but `world:loaded` has a **second inline copy** of the logic (copy-paste
drift, a pre-existing bug — *not* a Session 35 regression).

**Handle this strictly as extraction, not bugfixing:**

- Extract `tools/som-inspector`'s `loadBackground` — the correct version —
  into `packages/renderer-three/` verbatim (e.g. `load-background.js`).
- Rewire **both** call sites in `tools/som-inspector` to the extracted
  function.
- In `apps/client`: rewire the `som:set` call site to the extracted
  function, and **delete the inline copy** in `world:loaded`, replacing it
  with a call to the extracted function.
- The pre-existing bug disappears as a *consequence* of deleting a
  duplicate — that is legitimate extraction work. What you must **not** do
  is edit or "reconcile" the logic itself (e.g. harmonizing the
  `client.som.extras` vs `getRoot().getExtras()` accessor difference the
  audit noted). Adopt the inspector's version wholesale; delete the
  divergent copy. If the two genuinely cannot be made equivalent by
  straight substitution, **stop and flag it** — do not improvise a fix.

---

## Log-prefix differences

The audit found `initAnimations`, `animation:play`, and
`replayPlayingAnimations` differ between consumers **only** in log-prefix
strings (`[app]` vs `[inspector]`), plus one extra diagnostic log in
`apps/client`'s `replayPlayingAnimations` (audit S2, "debugging residue").

- The extracted code should log with a single neutral prefix (e.g.
  `[renderer-three]`) or accept a prefix/label option — pick the smaller
  change.
- Drop the extra `apps/client` diagnostic-residue log. This is removing a
  duplicate-with-drift artifact during extraction, consistent with the
  `loadBackground` treatment — not an "improvement."
- Do **not** add new logging.

---

## Implementation order

1. Extract `buildClipsFromSOM` (pure, zero risk). Rewire both consumers. Run
   both consumers' tests + a smoke check.
2. Extract `initDocumentView` factory. Rewire both consumers.
3. Extract `loadBackground`. Rewire all three call sites (2 inspector, 1+1
   client incl. inline-copy deletion).
4. Extract `AnimationBridge` (the substantial step). Rewire both consumers:
   construct after `initDocumentView`, pass `sceneGroup`.
5. Write `packages/renderer-three/` unit tests for the new units (see below).
6. Full recursive test run, all packages. Smoke test both consumers.

Doing the easy, low-risk extractions first means that if `AnimationBridge`
surfaces a design question, the rest is already safely landed.

---

## Tests

- **Add to `packages/renderer-three/tests/`**, do not replace existing
  tests. The audit's process notes flag that smoke/test plans have been
  *rewritten* rather than amended in past sessions, dropping coverage —
  **preserve all 19 existing `renderer-three` tests; add to them.**
- `buildClipsFromSOM` — **no unit coverage this session.** This function
  had no direct unit tests before (it was only exercised through the apps),
  and adding them would be new test surface beyond a strict structural
  refactor. It is deferred: see "Follow-up — deferred test coverage" below.
- `AnimationBridge` — at minimum: constructor wiring, the `null`-mixer
  guard path (animation-free world), `replayPlayingAnimations` against a
  SOM with a playing animation, `dispose()`.
- Consumers: `apps/client` and `tools/som-inspector` have no automated
  renderer tests today; do **not** invent a test harness for them this
  session. They are covered by the smoke test plan instead.

## Smoke test plan

Produce a separate `SESSION-37-smoke-test-plan.md`. Must cover, for **both**
`apps/client` and `tools/som-inspector`:

- Load `space-anim.gltf` — animations present but stopped; nothing auto-plays.
- Load `space-anim-autoplay.gltf` solo — autoStart fires, animation loops.
- Late-joiner: second client joins a running autoplay world — animation is
  already running and correctly time-synced (not snapped to t=0).
- Live `loop: false` edit mid-play via the Inspector — action finishes its
  cycle and clamps, does not snap.
- Natural `LoopOnce` completion — SOM `playing` flips back to `false`.
- Load a world with **no** animations (`space.gltf`) — no errors, `mixer`
  stays null, no crash.
- Background: load a world with an equirect skybox — renders. Hot-reload
  background via Inspector `__document__` edit — updates in both consumers.
- `apps/client` specifically: confirm the `world:loaded` background path
  (formerly the inline copy) still renders the skybox correctly.

---

## Follow-up — deferred test coverage

`buildClipsFromSOM` is being extracted as a pure function this session but
**without** unit tests, to keep Phase 1 a strict structural refactor. It is
now a cleanly testable seam (`SOMDocument` in, `THREE.AnimationClip[]` out —
track types, names, counts all assertable) and currently has no direct
coverage at all. **A future session should add `buildClipsFromSOM` unit
tests to `packages/renderer-three/tests/`.** The build log for this session
should restate this as an open follow-up so it lands in the canonical doc's
backlog.

## Risks / watch-outs

- **Two-consumer extraction.** No third site to catch a wrong abstraction
  shape. If the shape above fights the code during implementation, **stop
  and flag** — per the audit's framing, fighting-the-shape is the signal
  the shape is wrong, not an invitation to improvise.
- **`sceneGroup` / `clipMap` as shared mutable refs** (audit §3). Post-
  extraction, `sceneGroup` is produced by `initDocumentView` and consumed
  by `AnimationBridge` *and* `PointerInputBridge` *and* the drag handlers.
  Make sure the rewire routes the single reference to all consumers — do
  not let two `sceneGroup`s come into existence.
- **Handler closures vs instance state** (audit S7). The `animCtrl`
  handlers currently close over module-level `mixer`/`clipMap`. As
  `AnimationBridge` methods they must reference instance state. Getting
  this half-right (handler bound, but still reading a stale module var) is
  a plausible bug — verify.
- **Init ordering** (audit §3). `initDocumentView` → construct
  `AnimationBridge` → `replayPlayingAnimations`. The constructor-takes-
  `sceneGroup` shape enforces step 1 before 2; step 3 is a method call so
  it is naturally after 2. Confirm both consumers follow this.
- **Bug-for-bug compatibility.** Both consumers must behave identically
  post-migration. The only intentional behavior deltas this session are:
  (a) deleting `apps/client`'s inline background copy, (b) dropping the
  residue log. Both are duplicate-removal, not logic changes. Anything
  else that changes behavior is a regression.
- **Test-count reporting.** The canonical doc flags build logs misreporting
  test counts. The build log for this session must include **full
  recursive `pnpm --filter <pkg> test` output** for every package, not
  summary numbers.
- **`som` test-client sync.** This session does not touch `packages/som`,
  so the `cp packages/som/src/*.js tests/client/som/` sync should not be
  needed — but confirm `packages/som` is genuinely untouched before
  skipping it.

## Non-goals (do not do these this session)

- **Phase 2** — scene/renderer/camera bootstrap (§A of the audit) and
  camera sync (§G) stay inline. Not this session.
- **Do not "resolve" the `null`-mixer edge case** (audit S4). The guard
  stays. If a world has no animations, `mixer` stays `null` and play
  events are dropped by the guard — preserve exactly.
- **Do not handle morph-target (`weights`) animation tracks** (audit S3).
  Known gap; out of scope.
- **Do not extract `LabelOverlay`** (audit §I / S6). `apps/client`-specific,
  low priority, Phase 2-or-later.
- **Do not extract `buildAvatarDescriptor`** (audit §E). `apps/client`-
  specific, genuinely not shared.
- **Do not touch `apps/playground`** beyond confirming it still builds —
  it is not a consumer of any Phase 1 code.
- **Do not reconcile the background accessor-path difference** by editing
  logic — adopt the inspector version wholesale (see above).
- No new logging, no new features, no "while I'm here" cleanup.

---

## Acceptance criteria

- `packages/renderer-three/src/` contains the three new units
  (`buildClipsFromSOM`, `initDocumentView`, `AnimationBridge`) plus
  extracted `loadBackground`, each following the shape specified above.
- `apps/client` and `tools/som-inspector` both consume the extracted code;
  no animation/DocumentView/background Three.js logic remains inline-
  duplicated between them.
- `apps/client`'s inline `world:loaded` background copy is deleted and
  routed through the extracted function.
- All 19 pre-existing `renderer-three` tests still pass; new unit tests
  added for `AnimationBridge`. (`buildClipsFromSOM` unit tests are
  deferred — see "Follow-up — deferred test coverage".)
- Full recursive test output for every package in the build log.
- Smoke test plan produced and run; both consumers pass all cases.
- Both consumers behave identically to their pre-session behavior, with the
  only deltas being the two documented duplicate-removals.

## Files expected to change

- `packages/renderer-three/src/` — new: `build-clips.js`,
  `document-view.js`, `AnimationBridge.js`, `load-background.js` (names
  indicative); `index.js` updated to export them.
- `packages/renderer-three/tests/` — new test files; existing tests
  untouched.
- `apps/client/src/app.js` — rewired to consume; inline duplication removed.
- `tools/som-inspector/src/app.js` — rewired to consume.
- `docs/sessions/SESSION-37-renderer-extraction-phase-1-log.md` — build log.
- `docs/sessions/SESSION-37-smoke-test-plan.md` — smoke plan.

## No changes expected in

- `packages/som`, `packages/client`, `packages/server`, `packages/protocol`,
  `packages/interaction` — headless/neutral, not the subject.
- `apps/playground` — not a consumer (confirm it still builds; do not edit).
- `apps/client/src/LabelOverlay.js`, `buildAvatarDescriptor`, any
  bootstrap/camera-sync code — deferred to Phase 2.
- Any scene/renderer/camera bootstrap code in either consumer.
