# Project Atrium — Session 40 Brief
## `AtriumClient` Light Listener Wiring + Smoke Re-run

## Session type: Small implementation + smoke test

This session closes the outbound mutation-dispatch gap discovered in Session 39:
`AtriumClient._attachMutationListeners` does not subscribe to `SOMLight` mutation
events, so light edits are local-only and never broadcast to peers.

After the fix, Smokes 3–6 from the Session 39 plan are re-run to confirm
`SOMLight` works end-to-end in a running multiplayer session, including
late-joiner sync (design-doc §8.1 / verify-doc §6.2).

**Test baseline before starting: 368 tests (55 protocol, 144 som, 32 server,
96 client, 32 renderer-three, 9 interaction). All must still pass after this
session.**

---

## Non-goals

- No `SOMCamera` completeness work.
- No `Stage` / Tier C work.
- No new SOM types or SOM API changes beyond the `_qualifiedName` field.
- No protocol schema changes.
- No changes to `apps/`, `tools/`, `packages/interaction/`, or
  `packages/renderer-three/`.
- No changes to `packages/server/` — the Session 39 fix is complete there.

---

## Background: why Option B

`AtriumClient` must include the qualified alias (e.g. `"Sun.light"`) as the
`node` field in outbound `send` messages for light mutations — not the bare
name. The bare name (`"Sun"`) routes to the `SOMNode` on the server, not the
`SOMLight`, because the node wins the bare-name slot in `_objectsByName` on
collision (the existing Session 27 rule).

`_buildObjectGraph` already knows the qualified alias at the moment it creates
each `SOMLight` wrapper — it is `somNode.name + '.light'`, computed right there
in the light-registration loop. Storing it on the wrapper at that point
(Option B) makes it a first-class property: authoritative, zero-cost to read
at listener attachment time, and available to any future code that needs to
wire-address a light without re-deriving the alias by searching nodes.

---

## Files expected to change

```
packages/som/src/SOMLight.js              # add _qualifiedName field
packages/som/src/SOMDocument.js           # set somLight._qualifiedName in light pass
packages/client/src/AtriumClient.js       # _attachLightListeners + call site
packages/client/tests/atrium-client.test.js  # new light listener tests
tests/client/som/                         # sync after SOMLight.js change
```

## No changes expected in

```
packages/server/                          # Session 39 fix complete
packages/protocol/                        # no schema changes
packages/renderer-three/                  # untouched
packages/interaction/                     # untouched
apps/                                     # untouched
tools/                                    # untouched
tests/fixtures/                           # space-lights.gltf already exists
```

If Claude Code finds it necessary to modify any file outside the list above,
**stop and flag** before proceeding.

---

## Implementation order

### Step 1 — `SOMLight._qualifiedName` field

In `packages/som/src/SOMLight.js`, add a public `_qualifiedName` field:

```js
export class SOMLight extends SOMObject {
  constructor(light) {
    super()
    this._light = light
    this._qualifiedName = null   // set by SOMDocument._buildObjectGraph
  }
  // ...
}
```

`_qualifiedName` is `null` until `SOMDocument._buildObjectGraph` sets it.
The leading underscore follows the project convention for fields set by the
owning document rather than by the constructor caller — consistent with
`SOMNode._light` set by `_buildObjectGraph` in Session 38.

Add a read-only getter so callers don't access the raw field:

```js
get qualifiedName() { return this._qualifiedName }
```

### Step 2 — Set `_qualifiedName` in `SOMDocument._buildObjectGraph`

In the light-registration loop added in Session 38, add the assignment
immediately after the alias is computed — it is already known there:

```js
const alias = somNode.name + '.light'
this._objectsByName.set(alias, somLight)
somLight._qualifiedName = alias    // ← add this line
```

This is a one-line addition in the existing loop. No other changes to
`SOMDocument`.

### Step 3 — `AtriumClient._attachLightListeners`

In `packages/client/src/AtriumClient.js`, add a new private method
`_attachLightListeners(somLight)`, modelled directly on
`_attachAnimationListeners`. Read `_attachAnimationListeners` first and
follow its pattern exactly — attachment style, guard clause, event detail
access, `_onLocalMutation` call signature.

```js
_attachLightListeners(somLight) {
  const alias = somLight.qualifiedName
  if (!alias) return   // detached or unregistered light — skip
  somLight.addEventListener('mutation', (event) => {
    if (this._applyingRemote) return
    if (!event.detail.property) return
    this._onLocalMutation(alias, event.detail.property, event.detail.value)
  })
}
```

**`_applyingRemote` guard:** this is critical. Without it, when `_onSet`
applies an inbound remote mutation via `setPath`, the setter fires a
`mutation` event, the listener sees it, and dispatches another `send` back
to the server — an echo loop. `_applyingRemote` is already set to `true`
during `_onSet` (confirmed in the Session 38 verification log). Confirm the
flag name in the live `AtriumClient.js` before writing — use whatever the
code actually calls it.

**`event.detail.property` guard:** skips compound or child-list mutations
that aren't simple property changes (consistent with the animation listener
pattern).

### Step 4 — Call site in `_attachMutationListeners`

In `_attachMutationListeners` (the method called on `world:loaded` to wire
up all mutation listeners), add a loop for lights after the existing
animation loop:

```js
for (const somLight of this._som.lights) {
  this._attachLightListeners(somLight)
}
```

Place it after animations, following the ordering pattern of the existing
listener attachment code. Read the existing method to find the right
insertion point before writing.

**`world:loaded` teardown:** confirm whether `_attachMutationListeners`
is preceded by a teardown of previous listeners on world reload. If nodes
and animations have their listeners removed before re-attachment, lights
must be handled the same way. Check the live code — do not assume.

### Step 5 — Tests: `packages/client/tests/atrium-client.test.js`

Extend the existing client test file. **Do not replace existing tests —
add to them.**

Add a section `AtriumClient — light mutation dispatch` with these cases:

```
light mutation sends a set message with the qualified alias as node field
  - mutate light.intensity on a SOMLight in the client's SOM
  - confirm a send message is dispatched with node: 'Sun.light'
  - confirm field: 'intensity', value: the new value

light mutation does not fire during _applyingRemote
  - simulate an inbound _onSet for a light
  - confirm no outbound send message is generated (no echo loop)

light color mutation sends array value
  - mutate light.color
  - confirm send message value is a plain array [r,g,b]

light range null mutation sends null
  - mutate light.range = null
  - confirm send message value is null (not 0, not undefined)

light with null qualifiedName is skipped silently
  - construct a SOMLight with _qualifiedName = null
  - call _attachLightListeners
  - mutate a property
  - confirm no send message is dispatched (guard clause)
```

Follow the pattern of existing `AtriumClient` animation dispatch tests for
test structure, mock/spy setup, and assertion style.

**Test count target:** ≥ 5 new client tests. Aim for quality over quantity —
the echo-loop case and the null-range case are the ones most likely to catch
real bugs.

### Step 6 — Sync `tests/client/som/`

`SOMLight.js` changed in Step 1. Sync the manual copy:

```bash
cp packages/som/src/*.js tests/client/som/
```

Required after every `packages/som/src/` change. Do not skip.

---

## Risks / watch-outs

1. **`_applyingRemote` flag name.** The Session 38 verification log confirmed
   the flag exists and is set during `_onSet`. Confirm the exact identifier
   in the live `AtriumClient.js` before using it in `_attachLightListeners`.
   If it has a different name, use the actual name.

2. **World-reload listener teardown.** If `_attachMutationListeners` is
   called on each `world:loaded` and old listeners are not removed first,
   lights will accumulate duplicate listeners across world loads — each
   mutation sends multiple `send` messages. Check how nodes and animations
   handle this and apply the same teardown pattern to lights. This is the
   most likely source of a subtle multiplayer bug if missed.

3. **`som.lights` availability at listener attachment time.** `som.lights`
   is populated by `_buildObjectGraph`, which runs when the SOM is
   constructed from the `som-dump`. Confirm that `_attachMutationListeners`
   is called after `this._som` is fully constructed — i.e. that `som.lights`
   is non-empty when the loop runs. The same guarantee exists for
   `som.animations`; lights should be identical.

4. **`somLight.qualifiedName` for dynamically-added lights (`som:add`).** If
   a `SOMLight` is added at runtime via `som:add`, it must also get its
   listeners wired. Check whether `_attachMutationListeners` is re-run on
   `som:add`, or whether there is a separate `som:add` handler for
   animations that lights must mirror. Do not leave the `som:add` path
   unwired if it exists.

5. **`tests/client/som/` sync.** Step 6 is required. `SOMLight.js` changed;
   the test client copy must be updated or it silently runs stale code.

---

## Verification: automated tests

After all steps, run the full suite:

```bash
pnpm --filter @atrium/protocol test
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test
pnpm --filter @atrium/client test
pnpm --filter @atrium/renderer-three test
pnpm --filter @atrium/interaction test
```

Target: ≥ 373 total (368 baseline + ≥ 5 new client tests). Report the full
per-package breakdown.

---

## Smoke test re-run

After automated tests pass, re-run Smokes 3–6 from the Session 39 plan.
These were all blocked by the outbound listener gap; they should now be
unblocked.

Use `tests/fixtures/space-lights.gltf` throughout.

### Smoke 3 — Light mutation routes server → all clients

```
Server running with space-lights.gltf. Two browser windows (A and B)
connected.

In Window A:
  client.som.getObjectByName('Sun.light').intensity = 0.5

Expected:
- AtriumClient sends: { type: 'send', node: 'Sun.light', field: 'intensity',
  value: 0.5, seq: N }
- Server setField('Sun.light', 'intensity', 0.5) resolves and broadcasts
- Window B _onSet receives set, resolves 'Sun.light', applies intensity = 0.5
- Window B viewport dims (Three.js reflects updated intensity)
- Window A receives its own echo; loopback prevention skips it (no double-apply)

Confirm in both windows:
  client.som.getObjectByName('Sun.light').intensity  // → 0.5
```

### Smoke 4 — Late-joiner sync

```
Setup: server running, Window A connected, Sun.light intensity mutated to 0.5.

Open new Window C and connect.

Expected:
- som-dump carries the mutated Document (intensity 0.5 persisted in-memory)
- After Window C loads:
    client.som.getObjectByName('Sun.light').intensity  // → 0.5, not 3.0
- No additional set messages needed

Pass: Window C sees 0.5 immediately on connect.
Fail: Window C sees 3.0 (mutation did not persist into som-dump) — record
clearly, do not rationalize into a pass.
```

### Smoke 5 — Color mutation (array value)

```
  client.som.getObjectByName('LampGlow.light').color = [1.0, 0.0, 0.0]

Expected: broadcast, received by peers, viewport turns red.
Confirm: light.color === [1.0, 0.0, 0.0] (plain array) in both windows.
```

### Smoke 6 — Range null round-trip

```
  client.som.getObjectByName('LampGlow.light').range = null

Expected: send message value is null; server and client apply null via
setPath without error; light.range returns null in both windows.
```

Record all results in `docs/sessions/SESSION-40-smoke-log.md`. PASS / FAIL
/ SKIP for each, with one line of observation. A FAIL on Smoke 4 is a valid
result and must be recorded as-is.

---

## Acceptance criteria

- [ ] `SOMLight._qualifiedName` field added; `qualifiedName` getter exposed
- [ ] `SOMDocument._buildObjectGraph` sets `somLight._qualifiedName = alias`
- [ ] `AtriumClient._attachLightListeners` implemented with `_applyingRemote`
      guard and `qualifiedName` guard
- [ ] Light listener loop added to `_attachMutationListeners`
- [ ] World-reload teardown handled consistently with nodes/animations
- [ ] `som:add` path checked and handled if it exists
- [ ] ≥ 5 new `@atrium/client` tests; all pass
- [ ] All 368 baseline tests still pass
- [ ] Full per-package test count reported and reconciled
- [ ] `tests/client/som/` synced
- [ ] Smokes 3–6 re-run; results in `SESSION-40-smoke-log.md`
- [ ] Smoke 3 (mutation routing) passes
- [ ] Smoke 4 (late-joiner sync) result recorded — pass or fail

---

## Suggested commit message

```
feat(client): wire AtriumClient light mutation listeners for multiplayer sync

- SOMLight._qualifiedName set by SOMDocument._buildObjectGraph (alias key)
- AtriumClient._attachLightListeners uses qualifiedName as set node field
- _applyingRemote guard prevents echo loop on inbound set application
- Light listener loop added to _attachMutationListeners (world:loaded path)
- 5+ new @atrium/client tests covering dispatch, echo-loop guard, null range
- tests/client/som/ synced
```
