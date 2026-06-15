# Session 39 — SOMLight Smoke Test Log

**Date:** 2026-06-14
**World:** `tests/fixtures/space-lights.gltf`
**Status:** Smokes 1–6 require a live server + browser. Results recorded as SKIP
with static analysis notes where the outcome can be determined from code.

---

## Smoke 1 — Server starts with a lit world

**Result: SKIP (requires running server process)**

**Static analysis:** With `KHRLightsPunctual` now registered on `NodeIO`, the
server's `io.read('space-lights.gltf')` will parse the extension and populate
the light properties on node objects. `SOMDocument._buildObjectGraph` will then
find two lights via `node.getExtension('KHR_lights_punctual')` and register
them under `'Sun.light'` and `'LampGlow.light'`. No "unknown extension" warning
is expected because `KHRLightsPunctual` is now a registered extension, not an
unknown one. Requires a running process to confirm the console is clean.

---

## Smoke 2 — Client loads the lit world and lights are present in the SOM

**Result: SKIP (requires browser)**

**Static analysis:** The client already uses `registerExtensions(KHRONOS_EXTENSIONS)`
(which includes `KHRLightsPunctual`) before `io.readBinary()`. This path was
correct before Session 38. After Session 38, `SOMDocument._buildObjectGraph`
walks nodes and calls `getExtension('KHR_lights_punctual')`. For a client loading
`space-lights.gltf` directly (no server), this path produces:
- `som.lights.length === 2`
- `som.getObjectByName('Sun.light')` → SOMLight (intensity 3.0)
- `som.getObjectByName('LampGlow.light')` → SOMLight (range 5.0)
- `som.getObjectByName('Sun')` → SOMNode (bare name taken by node, per collision rule)

Verifiable in the SOM Inspector or browser console. Requires browser to confirm.

---

## Smoke 3 — Light mutation routes server → all clients

**Result: SKIP (requires live server + two browser windows)**

**Static analysis:** The mutation chain is confirmed uniform by the Session 38
verification (VERIFY-SOMLight-Set-Resolution-findings.md):

1. `light.intensity = 0.5` triggers `SOMLight.intensity` setter
2. Setter calls `this._light.setIntensity(0.5)` then fires `mutation` event
3. `AtriumClient._attachNodeListeners` does NOT attach to `SOMLight` directly —
   this needs investigation (see note below)

**IMPORTANT NOTE — mutation listener gap:**

`AtriumClient._attachMutationListeners` in `packages/client/src/AtriumClient.js`
attaches listeners to nodes, animations, and the document root — but NOT to
`SOMLight` objects. When `light.intensity = 0.5` fires a `mutation` event on
the `SOMLight`, no `AtriumClient` listener is wired to it, so no `send` message
is dispatched to the server.

This means Smoke 3 as written (`light.intensity = 0.5` from console) will NOT
route via the server. The mutation fires locally but is not broadcast.

**This is a design gap beyond the scope of Session 38's implementation.**
Session 38 confirmed that the `set`-resolution path (server receiving → applying)
is correct. The outbound mutation-listener wiring (client sending when a SOMLight
is mutated) was not scoped to either Session 38 or Session 39.

To complete Smoke 3, `AtriumClient` would need to attach mutation listeners to
`SOMLight` objects (similar to how it attaches to animation objects). This is a
follow-up task — see SESSION-40 suggestion in the session log.

---

## Smoke 4 — Late-joiner sync

**Result: SKIP (requires live server + two browser windows)**

**Static analysis (design-doc §8.1 reasoning):**

The design doc's "reasoned-correct" late-joiner claim holds if:
1. `SOMLight.intensity = 0.5` mutates the underlying glTF-Transform `Light`
   property in the in-memory `Document` (it does — `setIntensity` mutates
   the live `Document` object)
2. The server's `som-dump` serializes the full `Document` via `io.writeJSON()`
   (it does — `som-dump` is the full serialized glTF)
3. The mutated intensity is present in the serialized JSON under
   `extensions.KHR_lights_punctual.lights[0].intensity`

If the outbound mutation listener gap (Smoke 3 note) is fixed and the server
does receive and apply the light mutation, late-joiner sync follows automatically
because `setPath` writes directly to the glTF-Transform `Light` object (via
`SOMLight.intensity` setter calling `this._light.setIntensity(v)`), and that
object IS serialized in the `som-dump` glTF.

**Prerequisite:** Smoke 3 (outbound listener wiring) must work before Smoke 4
can be verified. Currently blocked by the listener gap.

---

## Smoke 5 — Color mutation (array value)

**Result: SKIP (requires browser + running server)**

**Static analysis:** Blocked by the same outbound listener gap as Smoke 3.
The `value: [1.0, 0.0, 0.0]` payload passes the open `value: {}` schema
and would route correctly if a `send` message were dispatched. The client's
`_onSet` and server's `setField` both handle array values correctly (confirmed
by Session 38 tests: `setPath(somLight, 'color', [1,0,0])` passes).

---

## Smoke 6 — Range null round-trip

**Result: SKIP (requires browser + running server)**

**Static analysis:** Same outbound listener gap as Smoke 3. The `null` value
passes the open schema. `setPath(somLight, 'range', null)` is confirmed correct
(Session 38 test 33 passes). Blocked by listener gap.

---

## Summary

| Smoke | Result | Note |
|---|---|---|
| 1 — Server starts | SKIP | Requires live process |
| 2 — Client SOM lights present | SKIP | Requires browser |
| 3 — Mutation routing | SKIP + BLOCKED | Outbound listener not wired |
| 4 — Late-joiner sync | SKIP + BLOCKED | Depends on Smoke 3 |
| 5 — Color mutation array | SKIP + BLOCKED | Outbound listener not wired |
| 6 — Range null round-trip | SKIP + BLOCKED | Outbound listener not wired |

**Root cause of Smokes 3–6 blockage:** `AtriumClient._attachMutationListeners`
does not subscribe to `SOMLight` mutation events. This is a missing wire-up,
not a gap in the server, SOM, or protocol layers (all confirmed correct by
automated tests). It is analogous to the animation listener wiring in
`_attachAnimationListeners`. A SESSION-40 to add `_attachLightListeners` is
the recommended follow-up.
