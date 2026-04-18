# Session 30 — Animation Renderer Startup Race Fix

**Status:** Design settled, ready to build
**Depends on:** Session 28 (renderer integration), Session 29 (autoStart)
**Fixes:** The open Session 28 late-joiner renderer bug, and the closely
related Session 29 autoStart symptom (autoplay world doesn't visibly play).

---

## Problem

`apps/client` does not start playback for animations that are already
`playing` at `world:loaded` time. The SOM is correct — `playing: true`,
the tick loop runs, transform values update (visible in the SOM Inspector,
which uses the same client stack with a different renderer integration).
The Three.js mixer never receives the `play()` call.

This affects three user-visible cases, all with the same root cause:

1. **Late joiner.** Client connects to a server with an animation already
   playing. `som-dump` carries `playing: true`. Renderer is idle.
2. **AutoStart over connection.** Client connects to an empty server with
   an autoplay world. AnimationController fires `play()` synchronously.
   Renderer is idle.
3. **AutoStart static load.** Client loads an autoplay `.gltf` directly,
   no server involved. AnimationController fires `play()` synchronously.
   Renderer is idle.

The bug is independent of the network. Anything that puts SOM into
`playing: true` at or before `world:loaded` time exposes the race.

## Diagnostic confidence

In the SOM Inspector, hitting **Pause → Play** on a stuck animation
makes it play correctly. This rules out clip construction, mixer
attachment, node-name resolution, and `loop`/`timeScale` propagation.
The bug is exclusively about **when** `animation:play` fires relative
to renderer wiring.

## Root cause

In `apps/client/src/app.js`, the `world:loaded` flow is roughly:

1. `client.on('world:loaded', ...)` handler runs
2. `initAnimations()` builds Three.js `AnimationClip`s from the SOM and
   creates the `AnimationMixer`
3. AnimationController, *separately subscribed* to `world:loaded`, runs
   its own `_onWorldLoaded` — scans `som.animations`, emits
   `animation:play` for any with `playing: true`, and (Session 29) calls
   `anim.play()` for `autoStart && peerCount === 0`

The renderer's `animation:play` handler does
`mixer.clipAction(clip).play()`. If AnimationController's handler runs
before `initAnimations()` — or if AnimationController's `play()` call
fires synchronous mutation events before `initAnimations()` finishes —
the play event lands in a renderer that has no mixer and no clips.

The Inspector exhibits the same symptom for the SOM-tick-driven case
(transforms updating) but its renderer is wired differently and may
mask part of the problem; the canonical broken case is `apps/client`.

---

## Fix

**Renderer-side initialization-order fix.** AnimationController is not
changed. The renderer is responsible for its own startup ordering.

In the `apps/client` `world:loaded` handler, perform initialization in
this order:

1. Build clips and mixer (`initAnimations()`)
2. Walk `som.animations`, and for each with `playing: true`, manually
   trigger the same play wiring the `animation:play` handler would do —
   `mixer.clipAction(clip).play()` plus `setLoop` / `setEffectiveTimeScale`
   from current `playback`
3. Steady-state `animation:play` / `pause` / `stop` /
   `playback-changed` handlers continue to work for all subsequent
   transitions

The "walk and replay current playing state" step is the canonical
late-joiner-style reconciliation. Factor it as a helper —
`replayPlayingAnimations(som, mixer, clipMap)` or similar — so it can
be reused by the SOM Inspector's renderer integration if needed.

### Why this approach (vs. alternatives)

The "walk and replay current SOM playing state" pattern is
deliberately network-agnostic. It doesn't care whether `playing: true`
arrived via `som-dump` from a server, was set by a synchronous
autoStart call during a fresh connection, or was set by a synchronous
autoStart call during a static file load. All three cases reduce to
"the SOM says `playing: true`, the renderer needs to start the mixer
accordingly."

We considered three options:

- **Renderer-side late-replay (this fix).** Renderer manages its own
  ordering and reconciles current state once it's ready. Single, clear
  responsibility boundary.
- **Defer AnimationController side effects via `queueMicrotask`.**
  Solves the symptom but introduces fragile timing assumptions in the
  controller. Rejected.
- **Renderer subscribes to `animation:play` only after `initAnimations()`.**
  Functionally equivalent to the chosen fix; the chosen fix is
  marginally cleaner because the subscription is permanent and the
  reconciliation is an explicit one-time step.

### Order-of-handlers concern

Because both `apps/client` and AnimationController subscribe to
`world:loaded` on the same client object, handler order matters. The
fix above works regardless of order — even if AnimationController's
handler ran first and called `play()` (firing into a renderer with no
mixer), the renderer's late-replay step still picks up `playing: true`
from the SOM and starts the mixer correctly.

This is the property we want: **the renderer can wire up at any time
and reconcile to current SOM state**, without depending on observed
event ordering.

### Inspector parity

`tools/som-inspector/src/app.js` does its own renderer wiring (added
in Session 29 for `animation:playback-changed`). Apply the same
late-replay pattern there. Use the shared helper if extracted.

---

## Test plan

### Manual acceptance — `apps/client`

1. **Autoplay fresh load.** Start a server with
   `WORLD_PATH=tests/fixtures/space-anim-autoplay.atrium.json`. Open
   `apps/client`, connect.
   **Expected:** Both crate animations play immediately. Crate rotates,
   crate bobs.

2. **Static viewer autoplay.** Drop
   `tests/fixtures/space-anim-autoplay.gltf` into `apps/client` without
   connecting.
   **Expected:** Both animations play immediately.

3. **Late joiner to manually-started animation.** Start a server with
   `space-anim` (the non-autoplay version). Connect client A. Click Play
   on `CrateRotate` in the Inspector. Verify it plays in client A's
   viewport. Connect client B (`apps/client`).
   **Expected:** B's viewport shows `CrateRotate` already playing,
   correctly synchronized with A's.

4. **Pause/Play after autoStart.** Use the autoplay world. After the
   animation is autoplaying, hit Pause in the Inspector — visibly
   pauses. Hit Play — visibly resumes.
   **Expected:** No regression in the working manual-control path.

5. **Reload while playing.** With autoplay world running, click Load
   again to reload the same world.
   **Expected:** Animations restart cleanly (or whatever the existing
   behavior is — verify no stuck-mixer or duplicated-action artifacts).
   This is testing that re-running `initAnimations()` plus late-replay
   doesn't accumulate stale state.

### Manual acceptance — SOM Inspector

6. Repeat steps 1, 2, 3 in the SOM Inspector. Same expected outcomes.

7. Confirm Pause → Play continues to work (was the diagnostic workaround;
   should remain working post-fix).

### Automated tests

The renderer integration in `apps/client` and the Inspector is not
under automated test. The fix lives in renderer-side code, so this is
fundamentally a manual acceptance gate. **Do not** add a "test" that
mocks the mixer just to claim coverage — it would only confirm the
helper function works in isolation, not that the integration is
correctly ordered.

If a small unit test for the helper (`replayPlayingAnimations`) is
trivial — pure function, takes a SOM and a clip map, calls a fake
mixer interface, asserts `play` was invoked on the right actions —
add one. Otherwise leave it.

---

## Files touched (expected)

**Modified:**
- `apps/client/src/app.js` — reorder `world:loaded` handler, add
  late-replay step
- `tools/som-inspector/src/app.js` — same pattern
- Possibly a new shared helper module if extraction makes sense
  (location TBD by Claude Code — `apps/client/src/` is fine if neither
  package nor tool feels right; both consumers are app-layer)

**Not touched:**
- `packages/client/src/AnimationController.js` — the controller is
  correct; renderers are responsible for their own startup ordering
- `packages/som`, `packages/protocol`, `packages/server` — unaffected

No SOM sync needed.

---

## Out of scope

- External-ref animations (Phase 6, deferred)
- Persistence
- Server-side timing / wall-clock authority
- Any change to the `playback` schema or `autoStart` semantics

---

## Definition of done

- All five `apps/client` manual scenarios above pass
- All Inspector manual scenarios pass
- Existing 260-ish test count holds, no regressions
- Session 28 late-joiner bug can be removed from the Known Issues list
  in the next handoff doc
