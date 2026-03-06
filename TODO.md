# Atrium — Running Decisions & Deferred Items

This document captures architectural decisions made during vibe coding sessions
and deferred items to address in future sessions. Feed it to Claude at the start
of each new session alongside the session briefs.

---

## Architectural Decisions

### HTTP serving — keep it separate from the Atrium server
**Decided:** Session 5 planning

The Atrium server (`packages/server`) is a WebSocket world state server only.
It will not serve static files (HTML, glTF assets) over HTTP. Adding HTTP
serving would bloat the server and violate its single responsibility.

In production: a standard web server (nginx, Caddy, etc.) serves static files;
the Atrium WebSocket server runs alongside it.

In local dev: `npx serve -l 5173 tests/` serves the test client. This is a
two-terminal workflow and that's fine. It requires no install and is a footnote,
not a problem worth solving.

A separate `packages/dev-server` was considered and rejected — complexity for
zero architectural benefit.

---

### Avatars are client-side only — not world nodes
**Decided:** Session 6 planning

Avatar representations are pure Three.js objects managed by the client renderer.
They are NOT added to the glTF-Transform Document and NOT part of the world
scene graph. Avatars are transient runtime presence; the Document represents
persistent world state. Mixing them would conflate two separate concerns.

### Avatar protocol — the `view` message type
**Decided:** Session 6 planning

A new SOP message type `view` carries a client's observer state. It is
semantically distinct from `send` (which mutates world state). Key properties:
- Fire-and-forget, last-write-wins, not echoed back to sender
- Server relays to all clients EXCEPT the sender
- Not persisted — server stores latest position in presence for bootstrap only
- Client sends `view`, server broadcasts `view` (same type, server version adds `id`)
- Schema has optional `look`, `move`, `velocity` fields reserved for the real
  client. Test client sends `position` only.

The name `view` was chosen because every client is simultaneously an observer
of the world and a presence within it. "Here is my current view" reads naturally.

Considered and rejected:
- Overloading `send` — would require routing hacks and blur the semantic
  distinction between world mutation and self-state broadcast
- `avatar-*` node naming convention on `send` — fragile string prefix matching,
  could collide with real world node names
- `move`/`pose`, `observe`/`observer`, `awareness` — either too narrow,
  too abstract, or too domain-specific

### Camera mode selector — combo box in the header
**Decided:** Session 6 planning

The test client exposes a `Camera:` combo box in the header bar (not a keyboard
toggle). Options: Orbit (OrbitControls, scene inspection) and Walk (WASD +
mouse drag, avatar broadcasting). Avatar position only broadcasts in Walk mode.

### Walk mode controls
**Decided:** Session 6 planning

- WASD movement (forward/back/strafe)
- Mouse drag in viewport to rotate yaw and pitch (no Pointer Lock)
- Pitch clamped ±80°
- Camera locked at head height 1.7 units
- No avatar broadcasting in Orbit mode

### packages/client promotion — deferred
**Decided:** Session 6 planning

The world client lives in `tests/client/` for now. Promotion to
`packages/client` is deferred until the client design is more settled.

### glTF extension work — deferred
**Decided:** Session 6 planning

`packages/gltf-extension` (ATRIUM_world, ATRIUM_avatar) is a significant
design effort. Deferred to a future focused session.

---

## Deferred Items

### Avatar extension design
**Deferred:** Session 6 planning

The full `ATRIUM_avatar` glTF extension needs a dedicated design session.
Should include: movement vectors, animation state, gaze direction, and whatever
other properties help clients optimize and provide better UX. The interim
`avatar-*` node naming convention is a placeholder until this is designed.

### glTF extension package (`packages/gltf-extension`)
**Deferred:** Session 6 planning

`ATRIUM_world` and `ATRIUM_avatar` extension definitions. Significant design
effort — deferred to a future focused session.


**Deferred:** Session 5

The README needs to be updated with testing and local dev workflow information,
OR it should reference a dedicated doc (e.g. `tests/TESTING.md`) that describes:
- How to run the test suite (`pnpm --filter @atrium/server test`)
- How to start the Atrium server
- How to serve the test client (`npx serve`)
- The two-terminal dev workflow
- How to run the magic moment smoke test end-to-end

Decide in a future session whether this lives in the README directly or in a
separate `tests/TESTING.md` that the README references. Lean toward a separate
doc to keep the README high-level.

### Known flaky test: "handles client disconnect cleanly" (session.test.js)
**Noted:** Session 6

Test 19 in packages/server fails intermittently — roughly 1 in 3 runs.
Root cause: timing/race condition in the WebSocket close event and session
cleanup within the test's async window. Not a production correctness issue.
Pre-existing — present since Session 2, not introduced by Session 6.

To investigate in a future session: add a small delay or use a proper
async signal (e.g. waiting for the sessions Map to update) rather than
relying on timing.

---
