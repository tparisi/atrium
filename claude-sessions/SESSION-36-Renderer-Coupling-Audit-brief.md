# Session 36 Brief — Renderer-Coupling Audit

**Type:** Audit / design-input. **No production code changes.**
**Deliverable:** One markdown findings document committed to `claude-sessions/` in the repo root.

---

## Background

The Three.js renderer abstraction effort to date (`packages/renderer-three/`,
Session 34) covered **only pointer handling** — `PointerInputBridge`,
`drag-math`, `hit-test`. Everything else Three.js-coupled is still inline
in the app-layer `app.js` files: Three.js scene/camera/renderer bootstrap,
DocumentView wiring, animation mixer/clip machinery, `replayPlayingAnimations`
reconciliation, avatar geometry construction, background loading.

The canonical handoff flags this as the "AnimationMixer / AvatarController
modular review" follow-up and notes the code is "duplicated across
`apps/client` and `tools/som-inspector`."

This session **audits** that coupling. It does **not** extract anything. The
extraction brief will be drafted in chat *from this audit's findings*, so the
abstraction shape is derived from what is actually there rather than guessed.

### Why audit-first

- This is a **two-consumer extraction** (`apps/client` and `som-inspector`;
  `playground` is pointer-only and does **not** render animations). The
  project's own process lesson is that two-consumer extractions are riskier
  because there is no third site to validate the abstraction shape — so the
  audit has to do that validation work instead.
- The animation startup lifecycle is the most intricate runtime flow in the
  system. If the two consumers have **diverged** in how they do mixer setup
  or reconciliation, "bug-for-bug compatibility on migration" becomes a
  deliberate design decision that cannot be made before the divergence is
  documented.

---

## Goal

Produce a findings document that inventories every Three.js touchpoint in the
three app/tool front-ends, classifies each as identical / divergent /
app-specific across consumers, and gives the chat session enough fact to
draft a well-scoped extraction brief.

---

## Scope — files to inventory

- `apps/client/src/app.js` (and `apps/client/src/LabelOverlay.js` if it
  touches Three.js)
- `tools/som-inspector/src/app.js` (and sibling `src/` files if they touch
  Three.js — `TreeView.js`, `PropertySheet.js`, `WorldInfoPanel.js`,
  `AnimationsPanel.js`)
- `apps/playground/` — inventory only enough to **confirm** it is
  pointer-only and renders no animations. If that assumption is wrong, stop
  and report; it changes the consumer count and the whole extraction calculus.
- `packages/renderer-three/src/` — inventory what is **already** extracted,
  so the findings doc can describe the boundary between done and not-done.

## Out of scope

- `packages/client`, `packages/som`, `packages/server`, `packages/protocol`,
  `packages/interaction` — these are headless / renderer-neutral by design
  (Principles 10, 12, 13). The audit should *confirm* no Three.js has leaked
  into them, but they are not the subject.
- Any code change. No extraction, no refactor, no "while I'm here" cleanup.
- Proposing the extracted API surface. The findings doc may *observe* natural
  seams, but designing the `packages/renderer-three/` API is a chat decision
  from the findings, not part of this session.

---

## What the findings document must contain

### 1. Touchpoint inventory

For each app/tool file, every distinct piece of Three.js-coupled code,
grouped into functional areas. Expected areas (confirm, correct, or extend
this list):

- **Renderer/scene/camera bootstrap** — `WebGLRenderer`, `Scene`,
  `PerspectiveCamera`, resize handling, render loop.
- **DocumentView wiring** — how the Three.js<->glTF-Transform bridge is
  constructed and synced.
- **Animation machinery** — `buildClipsFromSOM`, `KeyframeTrack`
  construction from accessor arrays, `AnimationMixer`, `clipMap`,
  `existingAction`/`clipAction`, the `mixer.update()` call site.
- **Reconciliation** — `replayPlayingAnimations`, the
  `mixer.addEventListener('finished', ...)` natural-completion sync, the
  `animation:*` event handlers that drive the mixer.
- **Avatar geometry** — capsule/avatar mesh construction passed to
  `client.connect()`.
- **Background** — `loadBackground`, equirectangular texture handling.
- **Anything else** — pointer bridge construction (already extracted, but
  note its call site), label overlay, lighting, helpers.

For each item record: file + approximate location, what it does, and which
`@atrium/*` package (if any) it already depends on.

### 2. Divergence classification

This is the most important section. For each touchpoint that appears in
**both** `apps/client` and `som-inspector`, classify as:

- **Identical** — same logic, safe to extract as-is.
- **Divergent** — same purpose, different implementation. Document *both*
  behaviors precisely. Flag whether the divergence looks intentional
  (app-specific need) or accidental (copy-paste drift). Do **not** resolve
  it — just document it.
- **App-specific** — exists in only one consumer, or genuinely differs by
  design. Note why it is app-specific if discernible.

A table keyed by functional area, with a column per consumer, is the
expected format.

### 3. Dependency and ordering notes

- Which touchpoints depend on which others (e.g. reconciliation depends on
  mixer + clipMap existing).
- Any initialization-ordering constraints observed (the handoff calls out
  that AnimationController and the renderer both subscribe to `world:loaded`
  and handler order is not guaranteed — note where that shows up).
- Natural seams the inventory reveals — but as *observations*, not as a
  proposed API.

### 4. Recommended extraction phasing

A short section: given the divergences found, does this extraction look like
one session, or does it need phasing? If phased, suggest the cut points and
say why. This feeds the chat decision; it is a recommendation, not a commitment.

### 5. Surprises / risks

Anything the audit turned up that a brief author would not have predicted —
divergences, hidden coupling, dead code, a touchpoint in an unexpected file.

---

## Risks / watch-outs

- **The `playground` assumption.** If `playground` turns out to render
  animations, stop and report before completing the audit — consumer count
  drives everything downstream.
- **Silent divergence.** Copy-paste duplication drifts. Assume the two
  `app.js` files are *not* identical until proven; diff them carefully
  rather than eyeballing.
- **Don't design the API.** It will be tempting to write the extracted
  module's interface. Resist — that is the next brief's job, made in chat.
- **Don't fix anything.** Dead code, bugs, or smells found during the audit
  go in the findings doc as observations. No edits this session.

---

## Acceptance criteria

- One markdown findings document in `docs/sessions/`, covering all five
  required sections.
- Every Three.js touchpoint in the three front-ends accounted for.
- `apps/playground` confirmed pointer-only (or the assumption flagged as
  broken).
- Headless/neutral packages confirmed Three.js-free (or leaks flagged).
- Every shared touchpoint classified identical / divergent / app-specific,
  with divergences documented in enough detail to design against.
- **No changes to any file outside `docs/sessions/`.**

## Files expected to change

- `docs/sessions/SESSION-36-renderer-coupling-audit.md` (new) — the findings
  document.

## No changes expected in

- Any `packages/`, `apps/`, or `tools/` source file. Any other file at all.
  This is a read-and-report session.
