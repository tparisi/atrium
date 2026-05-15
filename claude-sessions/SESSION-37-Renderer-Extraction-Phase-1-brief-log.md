# Session 37 — Renderer Extraction Phase 1: Animation + DocumentView — Build Log

**Date:** 2026-05-14
**Branch:** main
**Status:** Complete

---

## Summary

Extracted shared animation + DocumentView code from `apps/client` and
`tools/som-inspector` into `packages/renderer-three/`. Four new modules created.
Both consumers rewired. 13 new `AnimationBridge` unit tests added; 19 pre-existing
`renderer-three` tests preserved and passing. All package test suites pass.

---

## New modules in `packages/renderer-three/src/`

| Module | Exported symbol | Type |
|---|---|---|
| `build-clips.js` | `buildClipsFromSOM` | Pure function |
| `document-view.js` | `initDocumentView` | Plain function |
| `load-background.js` | `loadBackground` | Plain function |
| `AnimationBridge.js` | `AnimationBridge` | Stateful class |

### `buildClipsFromSOM(somDocument) → THREE.AnimationClip[]`

Verbatim extraction — byte-identical across both consumers. Converts
glTF-Transform animation data to Three.js keyframe tracks. `weights`
(morph-target) tracks remain unhandled — known gap, deferred.

### `initDocumentView(renderer, threeScene, somDocument, { prevDocView, prevSceneGroup }) → { docView, sceneGroup }`

Plain exported function. Disposes previous `docView`/`sceneGroup` pair if
provided, creates a fresh `DocumentView`, adds new `sceneGroup` to `threeScene`,
returns `{ docView, sceneGroup }`. Caller owns the refs. No instance state.

### `loadBackground(threeScene, bg, baseUrl)`

Extracted from `tools/som-inspector`'s correct implementation. The inspector
version was the canonical form — `apps/client` had an inline copy inside
`world:loaded` that used a divergent accessor (`document.getRoot().getExtras()`
vs `extras` shorthand) and bypassed the existing `loadBackground()` function.
The inline copy was deleted during extraction; `world:loaded` now calls the
extracted function. This eliminates the pre-existing copy-paste drift as a side
effect of the extraction, per the brief.

### `AnimationBridge(sceneGroup, client, animCtrl)`

Stateful class owning `mixer`, `_clipMap`, and four `animCtrl` event handlers.

**Constructor ordering enforcer:** Takes `sceneGroup` at construction, which is
produced by `initDocumentView`. This makes the required init order
(`initDocumentView` → construct bridge) structurally unskippable.

**Per-world-load lifecycle:**
1. Call `initDocumentView(...)` → get `sceneGroup`
2. If a previous bridge exists: `prevBridge.dispose()` (removes old handlers)
3. `new AnimationBridge(sceneGroup, client, animCtrl)` (registers handlers)
4. `bridge.init(somDocument)` — builds clipMap; creates mixer if clips > 0
5. `bridge.replayPlayingAnimations(som)` — syncs already-playing animations

**Exposed methods:**
- `init(somDocument)` — builds clips + mixer
- `replayPlayingAnimations(som)` — late-joiner / autoStart sync
- `update(dt)` — call in frame loop; no-ops when mixer is null
- `dispose()` — stops all actions, removes finished listener, deregisters all four animCtrl handlers

**Null-mixer guard preserved exactly:** If a world has no animations, `mixer`
stays `null` after `init()`. All handlers and `replayPlayingAnimations` check
`if (!this.mixer) return` — identical to the original behavior.

**Log prefix:** Neutral `[renderer-three]` replaces consumer-specific `[app]` /
`[inspector]`. The extra entry-point diagnostic log that existed in `apps/client`'s
`replayPlayingAnimations` (residue) was dropped — duplicate-removal, per the brief.

---

## Consumer rewiring

### `apps/client/src/app.js`

- Removed import: `import { DocumentView } from '@gltf-transform/view'`
- Updated renderer-three import: `{ PointerInputBridge, initDocumentView, AnimationBridge, loadBackground }`
- Removed module vars: `mixer`, `clipMap` (const Map)
- Added module var: `let animBridge = null`
- Removed functions: `buildClipsFromSOM`, `initAnimations`, `replayPlayingAnimations`, `initDocumentView` (local), `loadBackground` (local)
- Removed 4 inline `animCtrl.on(...)` blocks
- `world:loaded`: replaced `initDocumentView(client.som)` + `initAnimations()` + `replayPlayingAnimations(client.som)` + inline background block (lines 408-432) with:
  ```js
  ;({ docView, sceneGroup } = initDocumentView(renderer, threeScene, client.som, { prevDocView: docView, prevSceneGroup: sceneGroup }))
  if (animBridge) animBridge.dispose()
  animBridge = new AnimationBridge(sceneGroup, client, animCtrl)
  animBridge.init(client.som)
  animBridge.replayPlayingAnimations(client.som)
  loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)
  ```
- `som:set`: `loadBackground(client.som.extras?.atrium?.background, worldBaseUrl)` → `loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)`
- Tick loop: `if (mixer) mixer.update(dt)` → `if (animBridge) animBridge.update(dt)`

### `tools/som-inspector/src/app.js`

Same changes. Additionally:
- `WorldInfoPanel` `onBackgroundChange` callback: `(bg) => loadBackground(bg, worldBaseUrl)` → `(bg) => loadBackground(threeScene, bg, worldBaseUrl)`
- Inspector had no inline background copy in `world:loaded` (it already called `loadBackground()` correctly) — single call site updated to pass `threeScene`

---

## `sceneGroup` reference routing

The single `sceneGroup` reference (produced by `initDocumentView`, stored in
the module-level `let sceneGroup`) is passed to:
- `new AnimationBridge(sceneGroup, ...)` at construction
- `PointerInputBridge` via the `sceneRoot: () => sceneGroup` getter (already used)
- Drag handlers via `sceneGroup?.getObjectByName(...)` (unchanged)

No duplicate `sceneGroup` instances were introduced.

---

## `packages/renderer-three/package.json`

- Updated `description`
- Added `@gltf-transform/view: ^4.3.0` to `peerDependencies` (required by `document-view.js`)

---

## Test results

### `packages/renderer-three`

```
1..32
# tests 32
# suites 0
# pass 32
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 132.944209
```

19 pre-existing tests (drag-math, hit-test) preserved and passing.
13 new `AnimationBridge` tests added.

### Full package suite

```
@atrium/protocol    tests 46  pass 46  fail 0
@atrium/som         tests 109 pass 109 fail 0
@atrium/client      tests 96  pass 96  fail 0
@atrium/renderer-three tests 32 pass 32 fail 0
@atrium/interaction tests 9  pass 9   fail 0
@atrium/server      — session.test.js WebSocket hang is pre-existing (unchanged)
```

### `packages/som` sync

`packages/som` was not touched this session. No `cp` sync needed.

---

## Intentional behavior deltas

1. **`apps/client` inline background copy deleted** — the `world:loaded` handler's
   24-line inline background block (using `document.getRoot().getExtras()`) is
   gone; replaced by a call to `loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)`.
   This is extraction of a duplicate, not a logic change. Both accessors return the
   same extras object — `client.som.extras` is the documented shorthand.

2. **`replayPlayingAnimations` residue log dropped** — `apps/client`'s
   `replayPlayingAnimations` had an extra entry-point diagnostic line
   (`console.log('[app] replayPlayingAnimations — animations:', ...)`) not present
   in the inspector. Dropped during extraction per the brief.

No other behavior changes.

---

## Open follow-up — deferred test coverage

`buildClipsFromSOM` was extracted this session without unit tests. It is now a
clean, testable seam (`SOMDocument` → `THREE.AnimationClip[]`; track types, names,
and counts all assertable). A future session should add direct coverage to
`packages/renderer-three/tests/build-clips.test.js`.

---

## Files changed

| File | Change |
|---|---|
| `packages/renderer-three/src/build-clips.js` | **NEW** |
| `packages/renderer-three/src/document-view.js` | **NEW** |
| `packages/renderer-three/src/load-background.js` | **NEW** |
| `packages/renderer-three/src/AnimationBridge.js` | **NEW** |
| `packages/renderer-three/src/index.js` | Updated — 4 new exports |
| `packages/renderer-three/package.json` | Updated — description, `@gltf-transform/view` peerDep |
| `packages/renderer-three/tests/AnimationBridge.test.js` | **NEW** — 13 tests |
| `apps/client/src/app.js` | Rewired — inline duplication removed |
| `tools/som-inspector/src/app.js` | Rewired — inline duplication removed |

### No changes in

- `packages/som`, `packages/client`, `packages/server`, `packages/protocol`,
  `packages/interaction` — headless/neutral, untouched
- `apps/playground` — not a consumer (confirmed; not edited)
- `apps/client/src/LabelOverlay.js`, `buildAvatarDescriptor`, bootstrap/camera-sync code — Phase 2
- Any scene/renderer/camera bootstrap code in either consumer
