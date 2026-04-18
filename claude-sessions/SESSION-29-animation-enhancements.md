# Session 29 — Animation Enhancements

**Status:** Design settled, ready to build
**Depends on:** Session 27 (SOMAnimation), Session 28 (renderer + Panel)
**Does not depend on:** Open Session 28 late-joiner renderer bug. That bug
remains; this work does not fix it but is designed to interoperate cleanly
with the eventual fix.

---

## Goals

Three independent enhancements to the animation system, deliverable in any
order but most naturally in the sequence below:

1. **Add `autoStart` to `playback`** — declarative authoring hint that says
   "start this animation when the world is loaded into an empty room."
2. **New fixture `space-anim-autoplay`** — sibling to `space-anim` with both
   animations authored to autostart and loop.
3. **Expand the Inspector AnimationsPanel rows** — disclosure triangle per
   animation, full `playback` object visible, `loop` / `timeScale` /
   `autoStart` editable live.

---

## 1 · `autoStart` field

### Schema change

Add `autoStart: boolean` to the `playback` compound property. Updated shape:

```js
{
  playing: false,
  paused: false,
  loop: false,
  autoStart: false,     // NEW — authoring hint, consumed on world:loaded
  timeScale: 1.0,
  startTime: 0,
  startWallClock: null,
  pauseTime: null
}
```

`autoStart` lives inside `playback` for consistency with `loop` (also a
behavior-modifier field, not pure runtime state). One compound property,
one atomic mutation, one wire format. Round-trips through `som-dump`
naturally — no special handling.

### Default value

`autoStart` defaults to `false`. Existing fixtures and any worlds without
the field behave identically to today.

### Trigger semantics

`AnimationController._onWorldLoaded` already scans `som.animations` and
emits `animation:play` for any with `playing: true` (the late-joiner path).
Add a parallel autoStart check, evaluated *after* the existing late-joiner
check for each animation:

```
For each animation in som.animations:
  if playback.playing:
    emit animation:play (existing late-joiner path — unchanged)
  else if playback.autoStart && peerCount === 0:
    anim.play({ loop: playback.loop, timeScale: playback.timeScale })
    // The play() call mutates playback → fires mutation event →
    // AtriumClient broadcasts set → AnimationController's own mutation
    // listener emits animation:play. Renderer wires up normally.
```

**Why `peerCount === 0`:** `autoStart` is the world's preference when
nobody is around to have an opinion. If peers are already connected,
they may have stopped the animation deliberately; respect that. We do
not want a new joiner restarting an animation a peer just stopped.

`peerCount` is the number of *other* connected sessions at the moment
`world:loaded` fires. AvatarController tracks peers via `peer:join` /
`peer:leave`, but at `world:loaded` time peers may not have arrived yet
in the message stream. Use the count of peer entries delivered in the
initial `som-dump` — i.e. SOM nodes with `extras.atrium.ephemeral === true`
that are not the local avatar. AtriumClient should expose this as
`client.peerCount` (a getter computed from the SOM), or AnimationController
can compute it directly from `som.nodes.filter(n => n.extras?.atrium?.ephemeral && n.name !== localAvatarName)`.

Pick whichever fits cleanest; a `client.peerCount` getter feels most
reusable.

### Cases this handles correctly

| Scenario | Result |
|---|---|
| First-ever client connects, fresh server, `autoStart: true` | Plays. (`!playing && peerCount === 0`) |
| Client connects to empty server with stale `playing: true` state | Plays via existing late-joiner path. (`playing` branch wins.) |
| Client connects, peer already there with animation playing | `som-dump` carries `playing: true` → late-joiner path. |
| Client connects, peer already there who had stopped the animation | `playing: false && peerCount > 0` → autoStart suppressed. Respects peer's stop. |
| Static viewer (no server) loads `.gltf` with `autoStart: true` | Plays. (No connection, no peers, `peerCount === 0`.) |

### Known incomplete edges (acceptable for this session)

- Two clients load simultaneously: both fire autoStart, both call `play()`,
  one set wins, both end up with `playing: true`. Fine.
- Client A stops animation, client B is mid-load: B's autoStart may fire
  before B sees A's stop. Last-write-wins on `playback`; acceptable for now.
- "Sticky stop" across reconnects (B's stop persists after B leaves) is
  out of scope. We're going with: `autoStart` re-fires for the next
  empty-room joiner. This will be revisited when persistence lands.

### `anim.play()` signature

No change required. `play({ loop, timeScale, startTime })` already accepts
these as optional overrides of current `playback`. The autoStart caller
passes `loop` and `timeScale` explicitly so the authored values are
honored — without these, `play()` would default `loop` to `false` and
ignore the authored `loop` field.

### SOM tests to add (`packages/som`)

- `playback` setter accepts and round-trips `autoStart`
- Default playback object includes `autoStart: false`
- `play()` does not touch `autoStart` (it's authoring; not runtime-managed
  by play/pause/stop)
- `pause()` and `stop()` do not touch `autoStart`
- `extras.atrium.playback.autoStart` survives serialize → parse round-trip

### Client tests to add (`packages/client`)

`AnimationController._onWorldLoaded` autoStart trigger:

- Empty room (`peerCount === 0`), `autoStart: true`, `playing: false`
  → emits `animation:play`, animation transitions to `playing: true`
- Non-empty room (`peerCount > 0`), `autoStart: true`, `playing: false`
  → no `animation:play` emitted, `playing` stays `false`
- Empty room, `autoStart: true`, `playing: true` (server has stale state)
  → existing late-joiner path runs, autoStart branch is skipped (no
  double-play)
- Empty room, `autoStart: false`, `playing: false` → nothing happens
- Authored `loop: true` is honored — autoStart's `play()` call passes
  `loop: true` through

### Protocol tests to add (`@atrium/protocol`)

- Schema validates `set` messages with `field: 'playback'` and a value
  containing `autoStart` (boolean)
- Schema rejects `autoStart` of non-boolean type

---

## 2 · `space-anim-autoplay` fixture

A sibling to `space-anim`, identical geometry and animations, but with
both animations authored to autostart and loop.

### Files to create

```
tests/fixtures/
├── generate-space-anim-autoplay.js
├── space-anim-autoplay.gltf            (generated)
└── space-anim-autoplay.atrium.json
```

### `generate-space-anim-autoplay.js`

Base it on `generate-space-anim.js` (attached for reference). The only
substantive difference: after creating each animation, set its
`extras.atrium.playback` with `autoStart: true` and `loop: true`.

Recommended approach — *do not duplicate the generation code*. Either:

- **(a)** Refactor: extract the shared geometry/animation building into a
  helper module that both generators import, and the two generators differ
  only in the final extras-stamping step. This is cleaner long-term.
- **(b)** Copy `generate-space-anim.js` verbatim, change the output path,
  and append the extras-setting calls before the write. Faster, more
  duplication.

Use your judgment. (a) is preferred if it's a small refactor; (b) is fine
if extracting cleanly is more work than it's worth right now. If you go
(a), keep `generate-space.js` (the original non-animated generator) alone
— don't pull it into the refactor, it's stable and out of scope.

The animation-specific stamp (in either approach):

```js
crateRotateAnim.setExtras({
  atrium: {
    playback: {
      playing: false,
      paused: false,
      loop: true,
      autoStart: true,
      timeScale: 1.0,
      startTime: 0,
      startWallClock: null,
      pauseTime: null,
    },
  },
})
```

Same for `CrateBob`. The world's `extras.atrium` block (name, description,
navigation) should match `space-anim` but with:

- `name: 'Space (Autoplay)'`
- `description: 'A minimal gray-box test world with autostarting looped animations.'`

### `space-anim-autoplay.atrium.json`

```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./space-anim-autoplay.gltf",
    "server": "ws://localhost:3000"
  }
}
```

### Manual acceptance test

1. Start the server with `WORLD_PATH=tests/fixtures/space-anim-autoplay.atrium.json`
2. Open `apps/client` and connect (no peers yet)
3. **Expected:** Both crate animations start playing immediately on
   connect, both loop forever
4. Open a second `apps/client`, connect
5. **Expected:** Animations are already playing for the second client,
   `som-dump` carries `playing: true` for both (late-joiner path)
6. Stop `CrateRotate` from either client
7. **Expected:** Stops on both clients
8. Disconnect both clients, reconnect one
9. **Expected:** `CrateBob` is still playing (server state retained),
   `CrateRotate` stays stopped (server state retained — peer's stop is
   sticky as long as the server is running)
10. Restart the server, connect a fresh client
11. **Expected:** Both animations autostart again (fresh server,
    authored `autoStart: true` consulted)

### Static viewer test

12. Drop `space-anim-autoplay.gltf` into `apps/client` *without*
    connecting to a server
13. **Expected:** Both animations play immediately (no server, no peers,
    autoStart fires)

---

## 3 · Inspector AnimationsPanel — expandable rows

### Current state

Each animation row shows: name, duration, current time, `[▶] [⏸] [⏹]`
buttons. Button states update via mutation listener.

### Target state

Each row gets a disclosure triangle (▸/▾) on the left. Collapsed: same
as today. Expanded: a property panel below the row showing the full
`playback` object, with editable controls for the mutable-by-design
fields and read-only display for the rest.

### Layout sketch

```
▾ CrateRotate        4.00s    1.23s    [▶] [⏸] [⏹]
    playing      true     (read-only)
    paused       false    (read-only)
    loop         [✓]      (editable, checkbox)
    autoStart    [✓]      (editable, checkbox)
    timeScale    [1.00]   (editable, number input, step 0.1, min 0)
    startTime    0.00     (read-only, seconds)
    startWallClock  1713384283912  (read-only, ms epoch)
    pauseTime    —        (read-only, "—" when null)

▸ CrateBob           2.00s    —        [▶] [⏸] [⏹]
```

### Editable fields and write semantics

All edits write through to `anim.playback` as a single compound
assignment, not via `play()` / `pause()` / `stop()`:

```js
anim.playback = { ...anim.playback, loop: newValue }
```

This fires one `mutation` event → AtriumClient broadcasts one `set`
message → all clients update. Same flow as Play/Pause/Stop, just
mutating different fields.

| Field | Control | Write semantics |
|---|---|---|
| `loop` | Checkbox | Effective immediately. A currently-looping animation will finish its current cycle and stop (Three.js `LoopRepeat` → `LoopOnce` transition; the action runs to `duration` then halts naturally). Renderer must honor the `loop` change in its mutation handler. |
| `timeScale` | Number input | Effective immediately. Renderer applies via `action.setEffectiveTimeScale(value)` (or equivalent) in its mutation handler. |
| `autoStart` | Checkbox | Written through to `playback`, broadcast normally. *No immediate runtime effect* — `autoStart` is consulted only on `world:loaded`. Future-proofing for persistence; today it's effectively a no-op for the live session. Add a small "(authoring)" tag next to the label or a tooltip explaining this. |

Read-only fields display the live value, updating via the same mutation
listener already used for button states. Format: `playing` / `paused`
as `true`/`false`, `startWallClock` and `pauseTime` show `—` when
`null`, `startTime` shows seconds with two decimals.

### Renderer wiring updates (`apps/client`)

The current renderer reacts to `animation:play` / `animation:pause` /
`animation:stop` semantic events. With `loop` and `timeScale` now
editable mid-playback, the renderer also needs to react to live
`playback` mutations *that aren't a play/pause/stop transition*.

Two options:

- **(a)** AnimationController emits a new event (`animation:playback-changed`?)
  for non-state-transition playback mutations, renderer subscribes.
- **(b)** Renderer subscribes directly to `mutation` events on each
  `SOMAnimation` (parallel to AnimationController) and updates
  `action.loop` / `action.timeScale` in response.

Prefer **(a)** — keep the renderer working only through AnimationController
events, consistent with the existing pattern. AnimationController already
has the mutation listener; it just needs to emit a new semantic event
when a mutation arrives that doesn't change `playing` or `paused`.

Specifically: when the playback mutation listener fires, after handling
the playing/paused state-transition cases, also emit a generic
`animation:playback-changed` event with the full new playback object.
Renderer handler:

```js
animCtrl.on('animation:playback-changed', ({ animation, playback }) => {
  const action = clipActions.get(animation.name)
  if (!action) return
  action.setLoop(playback.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
  action.setEffectiveTimeScale(playback.timeScale)
})
```

Note: `setLoop(LoopOnce, Infinity)` is the documented Three.js way to
say "stop after current cycle." A `LoopRepeat` action that gets switched
to `LoopOnce` mid-play continues to its `duration` and then stops, which
matches the spec'd behavior.

### Inspector implementation notes

- Disclosure state is per-row local UI state; no need to persist across
  reloads, no need to sync across clients.
- Use the existing `show()` / `clear()` lifecycle for listener attachment.
  Expanded rows attach the same mutation listener — the listener handler
  just updates more DOM. Don't add a second listener for the expanded
  view.
- Validate `timeScale` input as a positive number; reject (and revert to
  current value) on invalid entry. Don't write garbage through to
  `playback`.
- Checkbox edits: use `change` event, not `input`, to avoid mid-typing
  noise (irrelevant for checkboxes but stay consistent if you reuse a
  helper).
- Keep the row visually compact when collapsed — disclosure triangle
  shouldn't widen existing rows noticeably.

### Inspector tests / manual acceptance

Inspector doesn't have an automated test suite (per the handoff structure),
so manual acceptance:

1. Load `space-anim-autoplay` in the Inspector
2. Both rows show animations playing, current-time ticking
3. Expand `CrateRotate` — full playback object visible, `loop` and
   `autoStart` checked, `timeScale` shows 1.00, `playing` shows true
4. Uncheck `loop` while playing — animation completes its current
   rotation, then stops cleanly. `playing` flips to `false` in the
   readout. (Note: this happens via the natural `LoopOnce` completion
   in the renderer; the renderer should call `anim.stop()` when the
   action finishes naturally, so SOM state stays in sync.)
5. Open a second client — `loop` change visible there too
6. Change `timeScale` to 2.0 on `CrateBob` — animation visibly speeds
   up on both clients
7. Toggle `autoStart` — value updates in both clients' panels, no other
   visible effect (correct — authoring-only field)
8. Disconnect, reconnect one client — `autoStart` value retained from
   server SOM state

### Edge case worth flagging

Step 4's "renderer calls `anim.stop()` when action finishes naturally"
may or may not already be wired up in `apps/client`. Check
`AnimationController` and the `apps/client` mixer integration. If a
natural completion currently leaves SOM `playing: true` while the
renderer has stopped, that's a separate small bug worth fixing as part
of this work — otherwise the loop-toggle UX in step 4 will leave SOM
state stale.

---

## Sync reminder

After modifying `packages/som`:

```bash
cp packages/som/src/*.js tests/client/som/
```

The `playback` schema change touches `SOMAnimation` (almost certainly)
and possibly a default-playback factory. Sync after.

---

## Test count expectations

Rough additions:

- `@atrium/protocol`: +2–3 (autoStart in playback schema)
- `@atrium/som`: +4–6 (autoStart round-trip, default value, play/pause/stop
  don't touch it, serialization)
- `@atrium/client`: +4–5 (AnimationController autoStart branch with
  various peerCount / playing combinations)

New total in the ballpark of 253–257.

---

## Files touched (summary)

**New:**
- `tests/fixtures/generate-space-anim-autoplay.js`
- `tests/fixtures/space-anim-autoplay.gltf`
- `tests/fixtures/space-anim-autoplay.atrium.json`

**Modified:**
- `packages/som/src/SOMAnimation.js` — add `autoStart` to default
  playback, ensure setter round-trips it
- `packages/protocol/src/schemas/*` — extend playback schema with
  `autoStart`
- `packages/client/src/AnimationController.js` — autoStart trigger in
  `_onWorldLoaded`, new `animation:playback-changed` event
- `packages/client/src/AtriumClient.js` — `peerCount` getter (if going
  that route)
- `apps/client/src/app.js` — handle `animation:playback-changed`,
  call `anim.stop()` on natural action completion if not already
- `tools/som-inspector/src/AnimationsPanel.js` — expandable rows,
  editable controls, mutation-driven readouts
- `tools/som-inspector/index.html` and/or CSS — disclosure-triangle
  styling, expanded-row layout
- `tests/client/som/SOMAnimation.js` — sync from packages/som
- Test files in each affected package

---

## Out of scope for this session

- Fixing the open Session 28 late-joiner renderer bug (separate work)
- External-ref animations (Phase 6, deferred)
- Persistence of authored playback edits back to the `.gltf` on disk
  (the reason `autoStart` edits feel ineffectual today)
- Sticky-stop semantics across reconnects
- A "reset to authored defaults" button in the Inspector
