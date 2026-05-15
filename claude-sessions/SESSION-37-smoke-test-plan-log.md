# Session 37 — Smoke Test Plan Log

**Date:** 2026-05-14
**Method:** Playwright headless Chromium (v1.60.0 / Chrome 148)
**Server:** Node.js static file server, repo root at `http://localhost:8765`
**Assets:** `tests/fixtures/space.gltf`, `space-anim.gltf`, `space-anim-autoplay.gltf`

---

## Automated results — 24/24 checks pass

Both consumers tested: `apps/client` and `tools/som-inspector`.

| # | Check | CLIENT | INSPECTOR |
|---|---|---|---|
| 1 | Page loads without uncaught JS errors | PASS | PASS |
| 2a | `space.gltf` (animation-free) — no crash | PASS | PASS |
| 2b | Animation-free world — no `AnimationMixer` created | PASS | PASS |
| 2c | Animation-free world — no `[app]`/`[inspector]` prefix in animation logs | PASS | PASS |
| 3a | `space-anim.gltf` (animated) — no crash | PASS | PASS |
| 3b | `space-anim.gltf` — `AnimationMixer ready` logged | PASS | PASS |
| 3c | `AnimationMixer ready` log uses `[renderer-three]` prefix | PASS | PASS |
| 4a | `space-anim-autoplay.gltf` — no crash | PASS | PASS |
| 4b | Autoplay — `replayPlayingAnimations — started` logged (animation fired) | PASS | PASS |
| 4c | Autoplay — no `[app]`/`[inspector]` prefix in animation logs | PASS | PASS |
| 5a | World reload (anim → autoplay) — no crash on second load | PASS | PASS |
| 5b | World reload — `AnimationMixer ready` logged exactly twice (once per load, not accumulated) | PASS | PASS |

---

## Note on prefix check scope

The initial prefix check (Cases 2c, 4c) caught `[app] World: Space...` and was marked a failure. That log is a non-animation world-metadata line in `apps/client`'s `world:loaded` handler that predates this session and is out of scope for extraction. The check was corrected to match only animation-related log messages (`AnimationMixer`, `replayPlaying`, `animation:play/stop/pause`). Inspector has no such non-animation `[inspector]` logs at module scope, so it passed both before and after the correction.

---

## Cases requiring manual browser verification

The following cases from `SESSION-37-smoke-test-plan.md` are not automatable without a live WebSocket server, multi-client setup, or visual rendering verification. They remain pending manual run.

| Plan case | Requires |
|---|---|
| 4. Late-joiner time sync | Live Atrium server + two browser sessions |
| 5. Live `loop: false` edit mid-play | Live interaction via AnimationsPanel |
| 6. Natural LoopOnce completion | Visual + SOM state check |
| 7. Background — equirect skybox renders | Visual rendering check |
| 8. Background — Inspector live hot-reload | Live interaction via WorldInfoPanel |
| 9. `world:loaded` background path (client-specific) | Visual rendering check |

---

## Full recursive test counts

| Package | Tests | Pass | Fail |
|---|---|---|---|
| `@atrium/protocol` | 46 | 46 | 0 |
| `@atrium/som` | 109 | 109 | 0 |
| `@atrium/client` | 96 | 96 | 0 |
| `@atrium/renderer-three` | 32 | 32 | 0 |
| `@atrium/interaction` | 9 | 9 | 0 |
| `@atrium/server` | 32 | 32 | 0 |
| **Total** | **324** | **324** | **0** |

**`@atrium/server` note:** `test/` contains avatar (6), presence (6), world (9), session (11) = 32. `tests/external-refs.test.js` is a separate integration test not run by `pnpm --filter @atrium/server test`; it passes 6/6 independently. The session.test.js hang noted in Session 35 did not occur this run.

**`@atrium/client` — untouched both sides:** `packages/client/` was not edited this session. The 96 count is identical to the Session 35 baseline.

---

## Reconciliation against Session 35 baseline

| Package | Session 35 | Session 37 | Delta |
|---|---|---|---|
| `@atrium/protocol` | 46 | 46 | — |
| `@atrium/som` | 109 | 109 | — |
| `@atrium/client` | 96 | 96 | — |
| `@atrium/renderer-three` | 19 | 32 | **+13** |
| `@atrium/interaction` | 9 | 9 | — |
| `@atrium/server` | 32 | 32 | — |
| **Total** | **311** | **324** | **+13** |

The +13 are the new `AnimationBridge` unit tests added to `packages/renderer-three/tests/AnimationBridge.test.js`. No other package test count changed.
