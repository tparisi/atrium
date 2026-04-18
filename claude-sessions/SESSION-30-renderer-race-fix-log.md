# Session 30 — Animation Renderer Startup Race Fix — Build Log

**Date:** 2026-04-17
**Branch:** main
**Status:** Complete — race fixed in both apps/client and som-inspector, 227/227 tests pass

---

## Problem

`apps/client` did not start playback for animations already `playing` at
`world:loaded` time. Three user-visible cases, same root cause:

1. **Late joiner** — connected to a server with an animation already playing;
   `som-dump` carries `playing: true`; renderer idle.
2. **AutoStart over connection** — connected to empty server with an autoplay
   world; `AnimationController` fires `anim.play()` synchronously; renderer idle.
3. **AutoStart static load** — dropped an autoplay `.gltf` with no server;
   same synchronous `play()` path; renderer idle.

Diagnostic: hitting Pause → Play in the Inspector on a stuck animation made it
play correctly, ruling out clip construction, mixer attachment, node-name
resolution, and loop/timeScale propagation. The bug was exclusively about
**when** `animation:play` fired relative to renderer wiring.

---

## Root cause

Both `apps/client` and `AnimationController` subscribe to `world:loaded` on
the same `AtriumClient` instance. Handler order is not guaranteed.

When AnimationController's handler fires **first**:

1. AnimationController scans `som.animations` — emits `animation:play` for
   any `playing: true`, and calls `anim.play()` for `autoStart && peerCount === 0`
2. The renderer's `animation:play` handler fires: `if (!mixer) return` — dropped
3. Renderer's `world:loaded` handler runs: `initAnimations()` creates the mixer
4. Nothing starts the mixer for animations that are now `playing: true`

When the renderer's handler fires **first**, the steady-state `animation:play`
event arrives with a valid mixer and works correctly. This explains why the bug
was intermittent in testing but reproducible in certain load paths.

---

## Fix

Added `replayPlayingAnimations(som)` to both:

- [apps/client/src/app.js](../../apps/client/src/app.js)
- [tools/som-inspector/src/app.js](../../tools/som-inspector/src/app.js)

Called immediately after `initAnimations()` in each file's `world:loaded` handler.

```js
function replayPlayingAnimations(som) {
  if (!mixer) return
  for (const anim of som.animations) {
    if (!anim.playing) continue
    const clip = clipMap.get(anim.name)
    if (!clip) { console.warn(`[app] replayPlayingAnimations — no clip for "${anim.name}"`); continue }
    const pb     = anim.playback
    const action = mixer.clipAction(clip)
    action.loop              = pb.loop ? THREE.LoopRepeat : THREE.LoopOnce
    action.clampWhenFinished = !pb.loop
    action.timeScale         = pb.timeScale
    action.reset().play()
    action.time              = anim.currentTime   // seek to computed position
    console.log(`[app] replayPlayingAnimations — started "${anim.name}" at t=${anim.currentTime.toFixed(2)}`)
  }
}
```

Call site in `world:loaded`:

```js
initDocumentView(client.som)
initAnimations()
replayPlayingAnimations(client.som)   // ← new
```

---

## Why this works regardless of handler order

| Handler order | What happens |
|---|---|
| AnimationController first | `anim.play()` sets `playing: true`, emits `animation:play` (dropped — no mixer). Renderer runs: `initAnimations()` creates mixer, `replayPlayingAnimations` sees `playing: true`, starts action. |
| Renderer first | `initAnimations()` creates mixer, `replayPlayingAnimations` finds nothing to start (autoStart hasn't fired yet). AnimationController runs: fires `anim.play()`, emits `animation:play` into a ready mixer. |
| Late joiner (som-dump) | `playing: true` in SOM before either handler runs. Both orderings: `replayPlayingAnimations` starts action; subsequent `animation:play` event resets it harmlessly (idempotent). |

The invariant: **the renderer reconciles to current SOM state when it's ready,
without depending on observed event ordering.**

---

## Why not other approaches

- **Defer AnimationController via `queueMicrotask`** — solves the symptom but
  bakes in a fragile timing assumption in the controller. Rejected.
- **Subscribe to `animation:play` only after `initAnimations()`** — functionally
  equivalent; the chosen approach is cleaner because the subscription is
  permanent and the reconciliation is an explicit one-time step.
- **Change AnimationController** — the controller is correct. Renderers are
  responsible for their own startup ordering.

---

## Files changed

| File | Change |
|---|---|
| `apps/client/src/app.js` | Added `replayPlayingAnimations(som)` helper; called after `initAnimations()` in `world:loaded` |
| `tools/som-inspector/src/app.js` | Same — identical helper (prefixed `[inspector]` in log output) |

**Not changed:** `packages/client/src/AnimationController.js`, all `packages/som`,
`packages/protocol`, `packages/server`.

---

## Test results

| Package | Tests | Pass | Fail |
|---|---|---|---|
| `packages/som` | 109 | 109 | 0 |
| `packages/protocol` | 46 | 46 | 0 |
| `packages/client` | 72 | 72 | 0 |

227/227 pass. No regressions.

The fix lives entirely in renderer-side app code — no automated tests cover
that layer by design (per brief). Manual acceptance testing required per the
test plan in the brief.

---

## Known open items (cleared)

- Session 28 late-joiner renderer bug — **fixed by this session**
- Session 29 autoStart symptom (autoplay world doesn't visibly play) — **fixed by this session**
