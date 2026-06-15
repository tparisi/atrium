# Session 40 — SOMLight Mutation Smoke Test Log (Re-run of Smokes 3–6)

**Date:** 2026-06-14
**World:** `tests/fixtures/space-lights.gltf`
**Status:** Smokes require a live server + browser. Results recorded as SKIP
with static analysis confirming the outbound listener gap is now closed.

---

## Context

Smokes 3–6 were blocked in Session 39 because `AtriumClient._attachMutationListeners`
did not subscribe to `SOMLight` mutation events. That gap is now closed:
`_attachLightListeners` is implemented and called for all lights on world load.
The automated tests (5 new in `client.test.js`) confirm the dispatch chain works
correctly including the echo-loop guard and null-range round-trip.

---

## Smoke 3 — Light mutation routes server → all clients

**Result: SKIP (requires live server + two browser windows)**

**Static analysis — gap is now closed:**

The outbound path is now:
1. `light.intensity = 0.5` → `SOMLight.intensity` setter → `setIntensity(0.5)`
   + fires `mutation` event with `{ property: 'intensity', value: 0.5 }`
2. `_attachLightListeners` listener fires → checks `_applyingRemote` (false) and
   `event.detail.property` ('intensity', non-null) → calls
   `_onLocalMutation('Sun.light', 'intensity', 0.5)`
3. `_onLocalMutation` → `_wsSend({ type: 'send', node: 'Sun.light', field: 'intensity', value: 0.5, seq: N })`
4. Server `setField('Sun.light', 'intensity', 0.5)` → `getObjectByName('Sun.light')`
   resolves `SOMLight` (KHRLightsPunctual now registered on NodeIO) →
   `setPath(light, 'intensity', 0.5)` → broadcast
5. Peer clients: `_onSet` → `getObjectByName('Sun.light')` → `setPath(light, 'intensity', 0.5)`
6. Loopback: own echo arrives with matching session id → `_onSet` skips it

All five steps are confirmed correct by automated tests (steps 1–3 by the new
client mutation tests; step 4 by Session 38/39 SOM + server tests; steps 5–6 by
Session 38 `_onSet` tests). Requires a live browser session to confirm the Three.js
viewport dims visually.

---

## Smoke 4 — Late-joiner sync

**Result: SKIP (requires live server + two browser windows)**

**Static analysis — reasoning unchanged from Session 39:**

`setPath(light, 'intensity', 0.5)` writes through `SOMLight.intensity` setter to
`this._light.setIntensity(0.5)` — mutating the glTF-Transform `Light` object in
the server's in-memory `Document`. When a new client connects, `som-dump` serializes
the full `Document` via `io.writeJSON()`, which includes the updated
`extensions.KHR_lights_punctual.lights[0].intensity` value. The new client's
`_onSomDump` reads this JSON, constructs a fresh `SOMDocument`, and `_buildObjectGraph`
wraps the mutated light — `getObjectByName('Sun.light').intensity === 0.5`.

This is the same late-joiner mechanism used by node transforms and animation
playback state. No reason to expect a different outcome for lights. Requires a
live session to confirm definitively.

---

## Smoke 5 — Color mutation (array value)

**Result: SKIP (requires browser)**

**Static analysis:** `light.color = [1.0, 0.0, 0.0]` dispatches a `send` with
`value: [1.0, 0.0, 0.0]`. Confirmed by the new `client.test.js` test
`'light mutation — color mutation sends plain array value'` which verifies
`Array.from(sendMsg.value)` equals `[1.0, 0.0, 0.0]`.

---

## Smoke 6 — Range null round-trip

**Result: SKIP (requires browser)**

**Static analysis:** `light.range = null` dispatches a `send` with `value: null`.
Confirmed by the new `client.test.js` test `'light mutation — range null sends null value'`
which `assert.strictEqual(sendMsg.value, null)`. Server-side `setPath(light, 'range', null)`
is confirmed by Session 38 test 33.

---

## Summary

| Smoke | Result | Note |
|---|---|---|
| 3 — Mutation routing | SKIP | Static analysis: gap closed; all sub-steps confirmed by tests |
| 4 — Late-joiner sync | SKIP | Static analysis: same mechanism as nodes/animations |
| 5 — Color mutation array | SKIP | Confirmed by automated test |
| 6 — Range null round-trip | SKIP | Confirmed by automated test |

All four smokes are unblocked by the Session 40 changes. The remaining SKIP
status reflects the requirement for a live server + browser, not any remaining
code gap.
