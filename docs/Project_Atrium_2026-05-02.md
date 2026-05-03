# Project Atrium — Handoff Document
## Through Session 34 (2026-05-02)

This document hands off context for continuing Project Atrium work in
a new chat. It supplements (does not replace) the running
`Project_Atrium_2026-04-17.md` handoff that covers Sessions 1–31. The
present document focuses on Sessions 32–34 (the foundational
pointer-events arc) and the current state of the system, plus
forward-looking guidance.

---

## Where we left off

Sessions 32–34 landed Pass 1 of the input/interaction system. As of
Session 34, the project has:

- A working SOM-level pointer event API (`pointerover`, `pointerout`,
  `pointerdown`, `pointerup`, `pointermove`, `click`)
- Pointer capture via `setPointerCapture` / `releasePointerCapture`
- Click-to-select and ground-plane drag-to-translate in the SOM Inspector
- A reusable `PointerInputBridge` in `packages/renderer-three/`
  consumed by three call sites (`apps/client`, `tools/som-inspector`,
  `apps/playground`)
- 96 client + 109 SOM + 46 protocol + 19 renderer-three unit tests, all green
- Three smoke test plans (Session 32, Session 33, Session 34
  playground) all currently passing

Two real issues surfaced during Session 34 final testing and are
filed for Session 35: a hit-test-on-invisible-nodes bug, and the
first concrete need for pointer event bubbling.

---

## Architecture additions in Sessions 32–34

### Pointer event flow

```
DOM PointerEvent
    │
    ▼
[PointerInputBridge in @atrium/renderer-three]
    │   ← raycast, resolve hit to SOM node, build event detail
    ▼
client.dispatchPointerEvent(somNode, type, detail)
    │   ← Session 32 API on AtriumClient
    │     manages capture state, hover state, pointerDown target
    ▼
SOMObject._dispatchEvent
    │   ← existing SOM event mechanism
    ▼
listener handlers
```

Three layers, headless-principle-preserved at the top. SOM nodes never
touch Three.js. AtriumClient never touches Three.js. The bridge is the
only place where Three.js + DOM + AtriumClient meet.

### Event detail shape (Session 32 + amendment)

```javascript
{
  pointerId, button, buttons,
  point,        // [x,y,z] world-space
  normal,       // [x,y,z] world-space
  localPoint,   // [x,y,z] hit-leaf local space (Session 32 amendment)
  localNormal,  // [x,y,z] hit-leaf local space
  ray: { origin, direction },
  distance,
  uv,           // [u,v] | null
  shiftKey, ctrlKey, altKey, metaKey,
  stopPropagation()  // currently a no-op; reserved for bubbling
}
```

Renderer-neutral. No Three.js fields leak through (no `face`,
`faceIndex`, `object`, `instanceId`).

### Dispatch semantics (Session 32)

- **Leaf-only.** Hit-test resolves to one leaf SOM node. No bubbling
  yet.
- **`pointerover` / `pointerout`** fire on leaf transitions.
- **`click`** fires when `pointerdown` and `pointerup` resolve to the
  same node (or, with capture active, when `pointerup` resolves via
  hit-test to the captured node).
- **Pointer capture** routes all `pointermove` and `pointerup` to the
  captured node regardless of hit-test, until released. Released
  automatically on `pointerup`.
- **Hover state cleared** on `disconnect()` and on `world:loaded`.

### `PointerInputBridge` (Session 34)

```javascript
const bridge = new PointerInputBridge({
  client,
  canvas,
  camera,
  sceneRoot,           // THREE.Object3D | () => THREE.Object3D
  resolveSOMNode,      // optional, defaults to walk-up-by-name
  suppressOnCapture,   // optional, defaults to true
})
bridge.dispose()
```

Constructor + dispose. That's the entire surface. The bridge owns:

- Hit-testing (raycaster, NDC, traversal, walk-up-by-name)
- Event detail construction
- DOM listener attachment (on `canvas`)
- `client.dispatchPointerEvent` calls
- Capture-coexistence pragma (peek `client.hasPointerCapture` after
  pointerdown dispatch, conditional `stopPropagation`)

### Drag math (`packages/renderer-three/src/drag-math.js`)

Pure helpers, no DOM, no AtriumClient deps:

- `projectRayToPlane(ray, planeY)` — ray onto horizontal world plane
- `computeParentInverse(threeObj)` — inverse of parent's world matrix

Used by the Inspector's drag handlers. Intentionally pure for
testability and future reuse.

### Drag mechanism (Session 33)

- World-space horizontal plane at the node's world Y captured at
  mousedown
- Cursor projects onto that plane each `pointermove`
- World delta `(currentCursor - initialCursor)` added to initial node
  world position
- Result converted to parent-local via `parentWorldInverse`
- Written to `node.translation`
- One mutation per move; renderer reconciles via existing pattern (no
  SOM/renderer divergence)

---

## Principles established or reinforced in 32–34

These are working principles, not formal architecture documents. They
guided design choices and are worth carrying forward.

### Renderer-neutrality of `packages/client`

`AtriumClient` never sees Three.js. The bridge is the boundary. Future
non-Three renderers (Babylon, raw WebGPU, server-side bots) should be
able to consume `client.dispatchPointerEvent` with their own hit-test
implementation.

### Plain-data event details

`event.detail` is JSON-serializable plain data (modulo
`stopPropagation`). No live object references, no renderer types. This
came up sharply in the `target`-pollution bug from Session 32:
embedding the SOM node in `detail` produced 350-line `JSON.stringify`
dumps and would have made future event-replay or wire-serialization
impossible.

### Three call sites before extracting

Session 34's bridge extraction was guided by *three* real consumers
(`apps/client`, Inspector, playground). The original plan had two; the
playground was added specifically as a third call site to stress the
abstraction. Worth applying to future extractions: don't extract from
two call sites if a cheap third can validate the shape.

### Bug-for-bug compatibility on migration

When extracting a shared abstraction, the existing call sites should
behave identically post-migration. Resist "improve while extracting" —
deviations are signals that the abstraction's shape is wrong, and
distinguishing them from intentional improvements is hard.

### Renderer reconciles to current SOM state (Principle 11, from earlier sessions)

This was the big lesson of Sessions 27–31 (animation arc). Session 33
applied it deliberately: drag fires continuous SOM mutations rather
than directly manipulating Three.js, and the renderer reconciles. No
"renderer state diverges from SOM during drag" trap.

### Walk before run

Sessions 32–34 are explicit about leaf-only dispatch, mouse-only
input, no rotation/scale, no bubbling. Each is a deliberate "we'll add
that when we have a use case." This kept session scopes tight enough
to ship cleanly.

---

## Process patterns that worked

These aren't principles about the system, they're patterns about how
sessions ran. Worth repeating.

### Brief → Claude Code → smoke test plan → results

Each session ran:
1. Discussion in chat to settle design open questions.
2. Markdown brief drafted, reviewed.
3. Brief handed to Claude Code; build log returned.
4. Smoke test plan drafted (sometimes pre-implementation, sometimes
   post-).
5. Smoke tests run manually; results reviewed.
6. Commit message; sometimes a follow-up cleanup brief.

The brief-as-handoff pattern was critical. Claude Code's interpretation
of conversational instructions varied; brief docs constrained scope
and made the handoff legible.

### Session 32 had an amendment, not a v2

When `localPoint`/`localNormal`/`distance`/`uv` were added
post-Session-32, they shipped as a "Session 32 Update" doc, additive
only. The original brief stayed valid. Pattern worth using when
expanding event detail or adding fields to existing APIs.

### Smoke test plans need preservation discipline

When Claude Code regenerated a smoke test plan in Session 32 and
again in Session 33, both times tests got dropped or condensed.
Future briefs should explicitly say "preserve existing tests, add to
them, don't replace." Filed in Session 35 backlog as a process item.

### Test count verification

Build logs occasionally misreport test counts (Session 33 showed
18/18 when actual was 96). Future briefs should require full
recursive test output, not summary numbers. Filed in Session 35
backlog.

---

## Open issues for Session 35+

See `SESSION-35-backlog.md` for full detail. Summary:

**Highest impact:**
- **Pointer event bubbling** — design + implementation. First
  concrete need surfaced (lamp parent in space.gltf can't receive
  clicks). Filed as design-first so the implementation has a clean
  spec.

**Bug fixes:**
- **Hit-test on invisible nodes** — visibility=false objects still
  hittable in some cases. Diagnostic procedure documented; root
  cause unconfirmed.
- **Property sheet doesn't update during drag** — Inspector property
  sheet shows stale values until re-selection. Standard observable
  pattern fix.

**UX polish:**
- **Camera-relative drag** — current world-space drag feels wrong
  when camera is rotated.
- **Click-to-deselect on empty space** — outstanding TODO since 33.
- **Visual selection feedback in viewport** — outstanding from 33.
- **Diagnostic console handlers gated behind debug flag**.
- **Fixture loading paths consistent across apps**.

**Larger work:**
- **AnimationMixer / AvatarController modular review** — extract to
  `packages/renderer-three/` after analysis pass.
- **Rotation / scale drag gestures** — design + implement.
- **`ATRIUM_interactivity` extension** — declarative trigger/action
  pairs with networked broadcast. Was Session B–C in the original
  pointer arc framing; not started. Bubbling is a likely
  prerequisite.

---

## Code map

Where things live as of Session 34:

```
packages/
  som/                   Source of truth for world state, SOM events, mutation
  client/                AtriumClient — connection, dispatch, capture, hover state
  protocol/              Wire format
  server/                WebSocket server
  renderer-three/        Three.js-specific glue
    src/
      PointerInputBridge.js
      drag-math.js
      hit-test.js
      index.js
    tests/

apps/
  client/                Main world client (multi-user)
  playground/            Pointer-test bench (Session 34)

tools/
  som-inspector/         Editor-style world inspector

tests/
  fixtures/              .gltf scenes for testing
```

`packages/renderer-three/` is new in Session 34. It will eventually
also house animation glue (deferred — separate analysis pass needed).

---

## Working with Claude Code on this project

Brief Claude Code carefully on each session. Patterns that have
worked:

- **Explicit non-goals.** Every Session 32–34 brief had a "What's
  deferred" section. Without it, scope drifts.
- **Files expected to change** + **No changes expected in**. Both
  matter; the second prevents over-eager modification.
- **Implementation order.** Helps Claude Code sequence work; also
  forces the brief author to think it through.
- **Risks / watch-outs.** A surprising number of bugs were caught
  pre-implementation by listing them as risks.
- **Acceptance criteria.** Explicit pass conditions reduce ambiguity
  about whether a session is done.

Things to watch for in build logs:

- **Test count regressions.** Always cross-check the build log's
  reported numbers against actual `pnpm --filter X test` runs before
  trusting them.
- **Smoke test plans.** If Claude Code rewrites rather than amends,
  check what was dropped.
- **Implementation deviations.** When the build log describes
  deviating from the brief (e.g., Session 34's `sceneRoot` getter),
  evaluate whether it's a genuine improvement or scope creep. The
  getter was a legitimate fix; not every deviation will be.

---

## Known process risks

- **Process drift across sessions.** The "test count misreport"
  pattern showed up because Session 33 ran tests differently than
  Session 32. Worth keeping process boilerplate consistent across
  briefs.
- **Smoke test plan ownership.** When the assistant drafts the plan,
  it tends to be richer; when Claude Code drafts, it tends to be
  tighter and sometimes lossy. Authorship should be explicit per
  session.
- **Sessions involving multiple call sites.** Session 34 worked
  because there were three real consumers. Future modularity work
  (AnimationMixer extraction, etc.) should look for similar
  three-consumer validation before extracting.

---

## Ready-to-run starters for Session 35

The current backlog has several Session 35 candidate framings. The
**recommended next session**, in order of decreasing safety:

1. **"Pointer events polish"** — bundle property sheet reactivity,
   fixture paths, debug flag, possibly click-to-deselect. Solid
   small wins, no design risk. Good breather before bubbling.
2. **"Bubbling design (no code)"** — settle the open design
   questions, produce a brief for Session 36 implementation. Higher
   impact, more thought required.
3. **"Hit-test invisibility investigation"** — run the diagnostic,
   decide on fix shape. Could pair with #1.
4. **"Drag UX polish"** — camera-relative drag, axis-locked drag,
   visual selection. Self-contained, real user-facing improvement.

Avoid combining bubbling design + implementation in one session
without splitting; the design risk warrants its own pass.

---

## Files referenced from this handoff

If continuing in a new chat, the following session artifacts are
useful to have on hand:

- `Project_Atrium_2026-04-17.md` — running handoff covering Sessions
  1–31
- `SESSION-32-Pointer-Events-brief.md` — original Session 32 brief
- `SESSION-32-update-extended-detail.md` — amendment adding
  localPoint, etc.
- `SESSION-32-pointer-events-log.md` and update log — build logs
- `SESSION-32-smoke-test-plan-merged.md` — Session 32 smoke plan
- `SESSION-33-Inspector-Selection-Drag-brief.md` — Session 33 brief
- `SESSION-33-inspector-selection-drag-log.md` — build log
- `SESSION-33-smoke-test-plan-rewritten.md` — Session 33 smoke plan
- `SESSION-34-Renderer-Bridge-brief.md` — Session 34 brief
- `SESSION-34-renderer-bridge-log.md` — build log
- `SESSION-34-playground-smoke-test-plan.md` — Session 34 playground
  smoke plan
- `SESSION-35-backlog.md` — issues / TODOs / Session 35 framings

A new chat should be primed by uploading the older
`Project_Atrium_2026-04-17.md` (for pre-32 context) and this document
(for 32–34 + forward-looking guidance), at minimum.
