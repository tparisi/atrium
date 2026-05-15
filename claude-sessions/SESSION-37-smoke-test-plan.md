# Session 37 — Smoke Test Plan

**Covers:** `apps/client` and `tools/som-inspector` post-extraction.
**Purpose:** Verify both consumers behave identically to their pre-session behavior
after the Phase 1 extraction. Each case must pass in **both** consumers unless
marked app-specific.

---

## Setup

- Start the dev server: `pnpm dev` (or equivalent) from the repo root.
- Open `apps/client` at its local URL (e.g. `http://localhost:5173/apps/client/`).
- Open `tools/som-inspector` at its local URL (e.g. `http://localhost:5173/tools/som-inspector/`).
- Test assets referenced below live in `test-assets/` or equivalent; adjust paths
  as needed for your local setup.

---

## Cases

### 1. Animation-free world — no crash, mixer stays null

**Asset:** `space.gltf` (no animations)

- [ ] **Client:** Load `space.gltf`. World renders. No console errors. No crash.
- [ ] **Inspector:** Same.
- [ ] `mixer` is never created (no `AnimationMixer ready` log appears in either consumer).

---

### 2. Animated world — animations present but stopped

**Asset:** `space-anim.gltf` (has animations, no autoStart)

- [ ] **Client:** Load `space-anim.gltf`. World renders. `AnimationMixer ready — N clip(s): …` logged to console with prefix `[renderer-three]`. Animations do **not** auto-play.
- [ ] **Inspector:** Same. AnimationsPanel lists the available animations.

---

### 3. Autoplay world — animation loops on load

**Asset:** `space-anim-autoplay.gltf` (has autoStart animation)

- [ ] **Client:** Load. Animation starts playing automatically. Visual loops continuously.
- [ ] **Inspector:** Same. AnimationsPanel shows animation as playing.

---

### 4. Late-joiner time sync

**Asset:** `space-anim-autoplay.gltf` served from the Atrium server

- [ ] Start server with the autoplay world loaded. First client joins and animation is playing.
- [ ] Second client joins. Animation starts at the **correct current position** (time-synced), not at t=0.
- [ ] Visual check: both clients show the animation at the same phase.

---

### 5. Live `loop: false` edit mid-play via Inspector

**Asset:** `space-anim-autoplay.gltf` (looping animation)

- [ ] While animation is looping, use the Inspector's PropertySheet or AnimationsPanel to change `loop` to `false` mid-play.
- [ ] The currently-running cycle completes normally.
- [ ] After cycle completion, the action **clamps** at its final frame — it does not snap, restart, or throw.
- [ ] SOM `playing` flips to `false` (AnimationsPanel updates).

---

### 6. Natural LoopOnce completion

**Asset:** A world with a `LoopOnce` (non-looping) animation

- [ ] Play a non-looping animation.
- [ ] After it plays to the end, it clamps at the final frame.
- [ ] SOM `animation.playing` flips to `false` (the `mixer 'finished'` listener called `anim.stop()`).
- [ ] **Inspector:** AnimationsPanel reflects stopped state.

---

### 7. Background — equirect skybox on world load

**Asset:** A world with an equirectangular background texture in extras

- [ ] **Client:** Load. Background renders as skybox. `threeScene.background` is a texture.
- [ ] **Inspector:** Same.

---

### 8. Background — Inspector live hot-reload

**Asset:** A world with a background, loaded in the Inspector

- [ ] While the world is loaded, use the Inspector's WorldInfoPanel to edit the `__document__` `extras.atrium.background.texture` path to a different image.
- [ ] Background updates in the viewport **without** reloading the world.
- [ ] No errors in console.

---

### 9. `world:loaded` background path — client-specific

**Asset:** Any world with an equirectangular background, loaded in `apps/client`

- [ ] Verify the skybox renders correctly on initial load.
- [ ] This specifically exercises the path that replaced the inline copy in `world:loaded` — confirm no regression vs. pre-session behavior.

---

### 10. World reload — no leaked bridges

- [ ] Load a world, then load a **different** world.
- [ ] No doubled animation events, no stale handlers, no console errors.
- [ ] `animBridge.dispose()` is called before the new bridge is created (verify via `AnimationMixer ready` appearing only once in the console per load, with `[renderer-three]` prefix).

---

## Pass criteria

All 10 cases pass in both `apps/client` and `tools/som-inspector`.
No new console errors introduced. No behavior regression vs. pre-session builds.
