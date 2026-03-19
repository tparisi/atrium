# Atrium — Session 11 Design Brief
## `packages/client` + `apps/client` v0.1

---

## Overview

Session 11 introduces two new workspace members:

- **`packages/client`** — `AtriumClient`: a pure JS class owning WebSocket
  lifecycle, SOP message handling, SOM state, and avatar lifecycle. No UI, no
  Three.js. Fully tested with `node --test`.
- **`apps/client`** — the browser UI shell: URL bar, Three.js viewport,
  first-person navigation, peer avatar rendering. Depends on `packages/client`.
  Exercised by hand against a running server.

The test client (`tests/client/index.html`) is **not modified** this session.
It remains the protocol-level scratch pad and SOM inspector.

The README is updated to reflect the new repo structure (`apps/` top-level
directory, updated package table).

---

## Repo Structure After Session 11

```
atrium/
├── packages/
│   ├── protocol/        # ✅ existing
│   ├── som/             # ✅ existing
│   ├── server/          # ✅ existing
│   ├── client/          # NEW — AtriumClient, no UI
│   │   ├── package.json
│   │   └── src/
│   │       └── AtriumClient.js
│   └── gltf-extension/  # 🔜 upcoming
├── apps/
│   └── client/          # NEW — browser UI shell
│       ├── package.json
│       ├── index.html
│       └── src/
│           └── app.js
├── tools/
│   └── protocol-inspector/
├── tests/
│   └── client/          # existing test client — unchanged
└── docs/
    └── sessions/
```

---

## Dependency Graph

```
apps/client
  └── packages/client
        ├── packages/som
        └── packages/protocol
```

`apps/client` never touches the SOM directly. All world state flows through
`AtriumClient`.

---

## `packages/client` — `AtriumClient`

### Conventions

- ES module, SPDX license header
- Extends `EventEmitter` (Node.js built-in; available in modern browsers via
  the `events` package, or a minimal inline implementation)
- No Three.js dependency
- No DOM dependency
- `node --test` test suite, same pattern as `packages/server`

### Constructor

```js
const client = new AtriumClient({ debug: false });
```

`debug: false` gates verbose console logging. Connection lifecycle events
are always logged regardless of `debug`.

### Methods

```js
// Connection
client.connect(wsUrl, { avatar: descriptor })
// wsUrl: WebSocket URL, e.g. ws://localhost:3000
// avatar: opaque glTF node descriptor built by apps/client
//   AtriumClient stores it and sends it in 'add' after hello handshake
//   AtriumClient never inspects the geometry — fully opaque
//   The capsule is a v0.1 placeholder; real avatars replace it in apps/client only
client.disconnect()

// World loading — independent of connection
client.loadWorld(url)     // url: HTTP URL to .gltf or .atrium.json
                          // works without a server (static render path)

// Navigation — called by apps/client on every nav tick
client.setView({ position, look, move, velocity, up })
// AtriumClient owns send policy: rate limiting, heartbeat, event-driven
// Dropped silently if not connected — apps/client never guards this

// SOM access — read-only for apps/client to drive DocumentView
client.som                // live SOMDocument instance
```

### `setView` Send Policy

`apps/client` calls `setView` freely. `AtriumClient` applies the send policy
internally, derived from `NavigationInfo.updateRate`:

- `position` — time-driven heartbeat, sent every `positionInterval` ms
- `look` / `move` / `up` / `velocity` — event-driven, sent on change
- Overall rate capped at `maxViewRate` messages/second

`move` and `velocity` are carried through to the `view` message as-is.
Dead reckoning implementation is deferred — the wire format already supports
it.

### Events

#### Connection

```js
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})
```

#### Session

```js
client.on('session:ready', ({ sessionId, displayName }) => {})
// Fired after hello handshake completes and own avatar node is added to SOM.
// apps/client uses this to know its own identity.
```

#### World

```js
client.on('world:loaded', ({ name, description, author }) => {})
// Fired when SOM is fully initialized:
//   - after loadWorld() completes a static fetch, OR
//   - after som-dump is received and ingested on connect
// Fields are from extras.atrium.world — may be undefined if not present.
// apps/client uses this to trigger initial DocumentView render.
// AtriumClient logs world metadata to console regardless of debug flag.
```

#### Peers

```js
client.on('peer:join', ({ sessionId, displayName }) => {})
// Fired after AtriumClient has ingested the peer's avatar node into SOM.

client.on('peer:leave', ({ sessionId, displayName }) => {})
// Fired after AtriumClient has removed the peer's avatar node from SOM.
// apps/client removes the capsule from the Three.js scene here.
```

#### SOM mutations

```js
client.on('som:add', ({ nodeName }) => {})
// Fired after som.ingestNode() — for non-avatar nodes added at runtime.

client.on('som:remove', ({ nodeName }) => {})
// Fired after som.removeNode() — for non-avatar nodes removed at runtime.

client.on('som:set', ({ nodeName, path, value }) => {})
// Fired after som.setPath() — for property mutations via 'set' messages.
```

#### Peer navigation

```js
client.on('peer:view', ({ displayName, position, look, move, velocity, up }) => {})
// Fired on every incoming 'view' message from a peer.
// AtriumClient has already updated the peer's avatar node translation/rotation
// in the SOM before this fires.
// apps/client uses this to update the peer's Three.js object directly.
// move/velocity are passed through for future dead reckoning — ignored for now.
```

### Incoming Message → SOM Mutation → Event Table

| SOP message | SOM mutation | Event(s) emitted |
|---|---|---|
| `som-dump` | Replaces entire SOM | `world:loaded` |
| `add` (peer avatar) | `som.ingestNode(descriptor)` | `peer:join`, `som:add` |
| `add` (world object) | `som.ingestNode(descriptor)` | `som:add` |
| `remove` (peer avatar) | `som.removeNode(name)` | `peer:leave`, `som:remove` |
| `remove` (world object) | `som.removeNode(name)` | `som:remove` |
| `set` | `som.setPath(node, path, value)` | `som:set` |
| `view` | `som.setPath(avatarNode, 'translation', position)` + rotation | `peer:view` |
| `join` | none | `peer:join` (with `add`) |
| `leave` | none | `peer:leave` (with `remove`) |
| `hello` (server) | none | `session:ready` |
| `pong` | none | — |
| `error` | none | `error` |

Note: `join` and `leave` arrive alongside `add` and `remove` respectively.
`peer:join` and `peer:leave` are emitted once per peer event, coordinated
between the two message pairs.

### Console Logging

Always logged (regardless of `debug`):
- Connection open / close
- Session ID and display name on `session:ready`
- World name / description / author on `world:loaded` (if present)
- Peer join / leave with display name and current peer count

Logged only when `debug: true`:
- Every incoming SOP message (type + summary)
- Every outgoing `view` message
- SOM mutation details
- `view` messages dropped due to rate limiting
- `setView` calls dropped because not connected

---

## `apps/client` — Browser UI Shell

### Conventions

- ES modules, import map for Three.js (same pattern as `tests/client`)
- No build step
- Single `index.html` entry point
- `src/app.js` — main application logic
- Depends on `packages/client` via import map or relative path

### UI Layout

```
┌─────────────────────────────────────────────────┐
│  [URL bar: atrium.json or .gltf URL]  [Connect] │
├─────────────────────────────────────────────────┤
│                                                 │
│              Three.js viewport                  │
│           (pointer lock, full area)             │
│                                                 │
└─────────────────────────────────────────────────┘
```

Minimal chrome. No SOP message panel — that stays in the test client.

### URL Bar

- Accepts a `.gltf` or `.atrium.json` URL
- Default URL pre-populated: `tests/fixtures/space.gltf` — the existing test
  world, so manual visual testing works out of the box with no extra setup
- On load: calls `client.loadWorld(url)` — renders statically, no server required
- On Connect: calls `client.connect(wsUrl, { avatar: descriptor })` — multiplayer overlay
- The WebSocket URL is either derived from the world URL or entered separately
  (exact UX TBD during implementation — keep it simple for v0.1)

### Avatar Descriptor

`apps/client` is solely responsible for building the avatar node descriptor.
For v0.1 this is a capsule (matching the test client geometry). The descriptor
is passed to `client.connect()` and is otherwise opaque to `packages/client`.

The capsule descriptor (geometry, material, dimensions) should match the test
client exactly so both clients are visually consistent during development.

When real avatars are introduced, only `apps/client` changes — `packages/client`
and `AtriumClient` are untouched.

### Navigation — First Person

Keyboard + mouse, pointer lock on viewport click.

| Input | Action |
|---|---|
| `W` / `↑` | Move forward |
| `S` / `↓` | Move backward |
| `A` / `←` | Strafe left |
| `D` / `→` | Strafe right |
| Mouse move | Look (yaw + pitch) |
| `Escape` | Release pointer lock |

`apps/client` computes `position`, `look`, `move`, `velocity` from input
state each tick and calls `client.setView(...)`. `AtriumClient` owns the
send policy — `apps/client` does not throttle or rate-limit.

Navigation uses `NavigationInfo` from `extras.atrium` for speed values,
once available via `world:loaded`. Default speed: 1.4 m/s (the
`NavigationInfo` default).

`up` vector: omitted in WALK mode (server defaults to `[0,1,0]`).

### Peer Avatar Rendering

On `peer:join`: create a capsule mesh in the Three.js scene, keyed by
`displayName`. The capsule geometry matches what the client sends in its own
`add` message.

On `peer:view`: update the peer's Three.js object position and orientation
directly. Orientation derived from `look` (forward vector → quaternion).

On `peer:leave`: remove the peer's capsule from the Three.js scene.

### DocumentView Integration

`apps/client` owns DocumentView (the Three.js / glTF-Transform bridge).
`packages/client` owns the SOM. On `world:loaded`, `apps/client` initializes
DocumentView from `client.som` and renders the world. Subsequent `som:add`,
`som:remove`, `som:set` events drive DocumentView updates.

Peer avatar movement bypasses DocumentView — driven directly by `peer:view`
for v0.1. (This is a pragmatic shortcut; a fully symmetric path through
DocumentView is the correct long-term design but is deferred.)

### Static-First

The world renders from `loadWorld()` alone. `connect()` is an optional
overlay. If the server is unreachable, the world is still visible.

---

## Test Coverage

### `packages/client` — `node --test`

Test setup: spin up a local WebSocket server (same pattern as
`packages/server` tests). No mock WebSocket — use a real server.

Key test cases:

- `connect()` → `hello` handshake → `session:ready` fires with correct
  `sessionId` and `displayName`
- `som-dump` received → SOM initialized → `world:loaded` fires
- `world:loaded` payload includes world metadata if present in
  `extras.atrium.world`
- `add` (avatar) → SOM updated → `peer:join` + `som:add` fire
- `add` (non-avatar) → SOM updated → `som:add` fires, `peer:join` does not
- `remove` (avatar) → SOM updated → `peer:leave` + `som:remove` fire
- `set` → SOM updated → `som:set` fires with correct `nodeName`, `path`,
  `value`
- `view` → peer avatar SOM translation updated → `peer:view` fires with
  correct shape including `move` and `velocity`
- `setView()` while disconnected → dropped silently, no error, no event
- `disconnect()` → cleans up, `disconnected` fires
- Two clients connect → one disconnects → other receives `peer:leave` →
  avatar node removed from SOM

### `apps/client` — hand tested

Exercised manually against a running server (`packages/server`). Verify:

- World loads statically from URL without server
- Connect to server → own avatar appears
- Navigate → peer sees movement
- Second client connects → avatar appears
- Second client disconnects → avatar disappears (the bug fixed from test
  client)
- Console output is correct and readable

---

## Session Deliverables Checklist

- [ ] `packages/client/package.json`
- [ ] `packages/client/src/AtriumClient.js`
- [ ] `packages/client/tests/` — full `node --test` suite
- [ ] `apps/client/package.json`
- [ ] `apps/client/index.html`
- [ ] `apps/client/src/app.js`
- [ ] `pnpm-workspace.yaml` updated to include `apps/client`
- [ ] README updated — repo structure, package table, `apps/` directory,
      getting started instructions for `apps/client`
- [ ] All existing tests still pass (92 + new `packages/client` tests)

---

## Key Design Principles (as always)

1. `packages/client` has zero Three.js / DOM dependency
2. `apps/client` never mutates the SOM directly
3. `AtriumClient` is the sole owner of SOM mutation in response to SOP messages
4. `setView` send policy lives entirely in `AtriumClient`
5. Static render works without a server
6. Dead reckoning is explicitly deferred — wire format supports it, implementation does not
