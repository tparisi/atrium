# Project Atrium
## 2026-03-30 · As of Session 14

---

## What Atrium Is

An open multiplayer 3D world platform built on glTF and WebSockets. The
philosophy: it should feel like a browser, not a platform. Point it at any
`.gltf` file and it renders. Point it at one with a world server behind it
and you're in a shared space with other people.

Built by Tony Parisi (co-creator of VRML, co-author of glTF) following the
principles of his [Seven Rules of the Metaverse](https://medium.com/meta-verses/the-seven-rules-of-the-metaverse-7d4e06fa864c).

**GitHub:** https://github.com/tparisi/atrium

---

## Stack & Conventions

- **Server:** Node.js + glTF-Transform + ws
- **Client:** Three.js + DocumentView (Three.js glTF-Transform bridge)
- **Protocol:** JSON over WebSocket, Ajv-validated
- **Modules:** ES modules throughout — no TypeScript, no build step
- **Tests:** `node --test` — no external test framework
- **Style:** SPDX license header in every `.js` file
- **Package manager:** pnpm workspaces

---

## Repository Structure

```
atrium/
├── packages/
│   ├── protocol/        # SOP message schemas (JSON Schema) + Ajv validator
│   ├── som/             # Scene Object Model — DOM-inspired API over glTF-Transform
│   ├── server/          # WebSocket world server
│   ├── client/          # AtriumClient — connection, SOM, avatar lifecycle (no UI)
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── apps/
│   └── client/          # Browser UI shell — Three.js viewport, navigation, avatars
├── tools/
│   └── protocol-inspector/index.html   # Single-file interactive protocol debugger
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # Minimal world fixture
│   │   ├── space.atrium.json   # World manifest
│   │   └── generate-space.js   # Geometry + fixture generator
│   └── client/
│       ├── index.html          # Single-file test/dev client — protocol scratch pad
│       └── som/                # Manual source copy of packages/som/src/
│                               # (sync required when packages/som changes)
└── docs/
    └── sessions/        # Claude Code session briefs — the build history
```

---

## Test Counts (after Session 14)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 43 |
| `@atrium/som` | 63 |
| `@atrium/server` | 32 |
| `@atrium/client` | 18 |
| **Total** | **156** |

All pass. Verify with `pnpm --filter <package> test` after pulling latest.

---

## Architecture — Three Layers

### Content layer
Standard glTF 2.0. A world is a `space.gltf` file with Atrium metadata in
`extras.atrium` at the root. Any glTF viewer can render it without a server.

### Protocol layer — SOP (Scene Object Protocol)
JSON over WebSocket, Ajv-validated. Defined in `@atrium/protocol`.

**Client → Server:** `hello`, `ping`, `send`, `add`, `remove`, `view`
**Server → Client:** `hello`, `pong`, `tick`, `set`, `add`, `remove`, `join`,
`leave`, `view`, `error`, `som-dump`

Key semantics:
- `send`/`set` mutations are echoed to sender as confirmation; the `set`
  broadcast includes `session` field so clients can identify their own echo
- `view` is NOT echoed back; fire-and-forget, last-write-wins
- `add` is broadcast to all clients *except* the sender (`broadcastExcept`)
- `som-dump` is the full current glTF (world state + all avatar nodes) sent
  to a newly connecting client immediately after `hello`
- All message types include `seq`

### Runtime layer — SOM (Scene Object Model)
`@atrium/som` — DOM-inspired API over glTF-Transform.

The SOM is **symmetric** — same package used server-side (world state) and
client-side (AtriumClient + DocumentView sync). `tests/client/som/` is a
manual copy of `packages/som/src/`. **Must be re-synced whenever
`packages/som` changes:**
```bash
cp packages/som/src/*.js tests/client/som/
```

---

## SOM Object Model (Session 13+)

The SOM has a full object hierarchy wrapping glTF-Transform properties.
Every SOM type inherits from `SOMObject`.

### SOM Types

| Class | Wraps | Key mutable properties |
|-------|-------|----------------------|
| `SOMDocument` | glTF-Transform `Document` | (container — factories, lookups) |
| `SOMScene` | glTF-Transform `Scene` | `addChild`, `removeChild` |
| `SOMNode` | glTF-Transform `Node` | `translation`, `rotation`, `scale`, `name`, `extras`, `visible`, `mesh`, `camera` |
| `SOMMesh` | glTF-Transform `Mesh` | `name`, `weights`, `addPrimitive`, `removePrimitive` |
| `SOMPrimitive` | glTF-Transform `Primitive` | `mode`, `material` |
| `SOMMaterial` | glTF-Transform `Material` | `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `emissiveFactor`, `alphaMode`, `alphaCutoff`, `doubleSided` |
| `SOMCamera` | glTF-Transform `Camera` | `type`, `yfov`, `znear`, `zfar`, `aspectRatio`, `xmag`, `ymag` |
| `SOMAnimation` | glTF-Transform `Animation` | `loop`, `timeScale` |
| `SOMTexture` | glTF-Transform `Texture` | (read-only in v0.1) |
| `SOMSkin` | glTF-Transform `Skin` | (read-only in v0.1) |

### SOMObject base class

Provides DOM-style event listener API:

```javascript
addEventListener(type, callback)
removeEventListener(type, callback)
_hasListeners(type)      // internal — zero-cost check before allocating events
_dispatchEvent(event)    // internal
```

### SOMEvent

```javascript
class SOMEvent {
    constructor(type, detail = {}) {
        this.type = type
        this.target = detail.target ?? null
        this.detail = detail
    }
}
```

### Mutation events

Every setter on every SOM type fires a `mutation` event after updating
the underlying glTF-Transform object. Only allocates a `SOMEvent` if
listeners are present (`_hasListeners` check).

**Property change:**
```javascript
// event.detail shape:
{ target: somObject, property: 'baseColorFactor', value: [1, 0, 0, 1] }
```

**Child list change:**
```javascript
// event.detail shape:
{ target: somObject, childList: { addedNodes: ['nodeName'] } }
{ target: somObject, childList: { removedNodes: ['nodeName'] } }
```

### Wrapper caching and stable identity

`SOMDocument` builds the full object graph at construction time, bottom-up:

```
textures → materials → meshes+primitives → cameras → skins → animations → nodes → scenes
```

All wrappers cached in maps (by glTF-Transform object and by name). Wired
together directly: `somNode._mesh`, `somPrimitive._material`, etc. Getters
are trivial property access — no lazy creation, no new allocations.

```javascript
som.getNodeByName('x') === som.getNodeByName('x')   // true — stable identity
node.mesh === node.mesh                               // true
mesh.primitives[0] === mesh.primitives[0]            // true
primitive.material === primitive.material             // true
```

`getNodeByName` is O(1) via `_nodesByName` Map.

Factory methods (`createNode`, `createMesh`, `createMaterial`,
`createCamera`, `createPrimitive`, `createAnimation`) and `ingestNode`
all register new wrappers in the maps.

### Key SOM API

```javascript
som.getNodeByName(name)           // O(1) lookup → SOMNode or null
som.nodes                         // all SOMNode instances (from Map)
som.meshes / .materials / etc.    // same for other types
som.scene                         // the first SOMScene

som.ingestNode(descriptor)        // create node + full mesh geometry from glTF descriptor
som.createNode(descriptor)        // create bare node (no mesh)
som.createMesh / Material / etc.  // individual factories

som.setPath(somNode, 'mesh.primitives[0].material.baseColorFactor', value)
som.getPath(somNode, path)

som.document                      // underlying glTF-Transform Document
```

`ingestNode` is the primary path for adding new objects to the scene graph.
It handles full descriptors with inline geometry arrays, materials, etc.

### SOM ↔ glTF-Transform relationship

The SOM wrappers are thin — every mutation flows through to the real
glTF-Transform document. The glTF-Transform `Document` is always the
ground truth. Serialize the document, you have serialized the world.

---

## AtriumClient (`packages/client`)

The connection/session/state API. Zero Three.js or DOM dependency —
portable across browser UI, headless tests, and future bot clients.

### Constructor

```js
const client = new AtriumClient({ debug: false });
// debug: true enables verbose logging; lifecycle events always logged
```

### Public Properties

```js
client.som              // live SOMDocument instance (read-only for apps/client)
client.connected        // true if connected to a world server
client.displayName      // session display name (e.g. "User-3f2a"), null if not connected
```

### Methods

```js
client.connect(wsUrl, { avatar: descriptor })
// avatar: opaque glTF node descriptor built by apps/client (no name required —
//   AtriumClient stamps its own displayName onto the descriptor)
// AtriumClient sends it in 'add' after hello — never inspects geometry

client.disconnect()

client.loadWorld(url)     // HTTP URL to .gltf or .atrium.json
                          // static — works without a server

client.setView({ position, look, move, velocity, up })
// apps/client calls this freely; AtriumClient owns send policy
// dropped silently if not connected
```

### Events

```js
// Connection
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})

// Session — own identity, fired after hello exchange
client.on('session:ready', ({ sessionId, displayName }) => {})

// World — SOM fully initialized (static load or som-dump)
// NOTE: fires AFTER avatar is ingested into SOM when connected
client.on('world:loaded', ({ name, description, author }) => {})

// Peers
client.on('peer:join', ({ sessionId, displayName }) => {})
client.on('peer:leave', ({ sessionId, displayName }) => {})
// AtriumClient has already updated SOM before these fire

// Peer navigation — apps/client updates Three.js scene directly
client.on('peer:view', ({ displayName, position, look, move, velocity, up }) => {})

// SOM mutations — for non-avatar runtime changes
client.on('som:add', ({ nodeName }) => {})
client.on('som:remove', ({ nodeName }) => {})
client.on('som:set', ({ nodeName, path, value }) => {})
```

### Event timing (critical)

`session:ready` fires from `_onServerHello` — **before** `_onSomDump`.
At this point the SOM does not exist yet. Do not look up nodes here.

`world:loaded` fires at the end of `_onSomDump` — **after** the SOM is
initialized and the avatar node is ingested. This is the correct place
to look up the avatar node and set up the camera rig.

### Incoming Message → SOM Mutation → Event Table

| SOP message | SOM mutation | Event(s) emitted |
|---|---|---|
| `som-dump` | Replaces entire SOM | `world:loaded` |
| `add` (peer avatar) | `som.ingestNode(descriptor)` | `peer:join`, `som:add` |
| `add` (world object) | `som.ingestNode(descriptor)` | `som:add` |
| `remove` (peer avatar) | `node.dispose()` | `peer:leave`, `som:remove` |
| `remove` (world object) | `node.dispose()` | `som:remove` |
| `set` | `som.setPath(node, path, value)` | `som:set` |
| `view` | `peerNode.translation` + `peerNode.rotation` | `peer:view` |

### Automatic SOM → Server sync (Session 13)

AtriumClient automatically reflects local SOM changes to the server.
After connecting, it walks all nodes and attaches `addEventListener('mutation', ...)`
listeners to each node and its mesh → primitives → materials → camera subtree.

Each listener captures the node name and dot-path in a **closure** — no IDs
or extra data stored on SOM objects:

```javascript
material.addEventListener('mutation', (event) => {
    this._onLocalMutation(nodeName, `mesh.primitives[${i}].material.${event.detail.property}`, event.detail.value)
})
```

When a listener fires, `_onLocalMutation` sends a `send` message to the server
(if connected and not applying a remote update).

**Local avatar node is excluded** from mutation listeners — its position is
communicated exclusively via `view` messages.

### Loopback prevention

**Case 1 — Own echo:** Server reflects our `send` back as a `set` with
`session: ourSessionId`. `_onSet` checks session ID and returns early.
SOM is never touched.

**Case 2 — Inbound re-broadcast:** Server sends `set` from another session.
`_onSet` applies it to the local SOM. The setter fires a mutation event.
AtriumClient's listener would try to send it back out. Prevented by a
synchronous `_applyingRemote` flag with try/finally:

```javascript
this._applyingRemote = true
try {
    this._som.setPath(node, msg.field, msg.value)
} finally {
    this._applyingRemote = false
}
```

Safe because the entire chain executes synchronously. The `_applyingRemote`
guard is also used in `_onView` when updating peer avatar positions.

### `setView` Send Policy (owned entirely by AtriumClient)

- `position` — time-driven heartbeat, every `positionInterval` ms
- `look` / `move` / `up` / `velocity` — event-driven, on change
- Overall rate capped at `maxViewRate` messages/second
- Values sourced from `NavigationInfo.updateRate` in `extras.atrium`

---

## Avatar System

### Core design decisions

**Avatar nodes are regular SOM nodes** — ephemeral per session, not persisted
to the canonical `space.gltf`. Included in `som-dump` so newly connecting
clients see all present avatars automatically.

**Session identity = avatar node identity.** AtriumClient generates a
`sessionId` (UUID v4) in `connect()` and derives the display name:

```js
const sessionId   = crypto.randomUUID();        // full UUID v4
const shortId     = sessionId.slice(0, 4);      // e.g. "3f2a"
const displayName = `User-${shortId}`;          // e.g. "User-3f2a"
const nodeName    = displayName;                // e.g. "User-3f2a"
```

**AtriumClient stamps the display name onto the avatar descriptor.** The
app builds the avatar descriptor without a name; `connect()` sets `name`
and `extras.displayName` to ensure the avatar node name matches the
session-derived display name. This is critical — a name mismatch breaks
peer join/add correlation and avatar lookups.

**Server and AtriumClient are geometry-agnostic.** `apps/client` builds the
avatar descriptor (capsule geometry, material, translation) and passes it
to `client.connect()`. Neither the server nor AtriumClient constructs or
inspects geometry.

**Connect / disconnect sequence:**
1. Client calls `connect(wsUrl, { avatar })` → AtriumClient generates
   session ID, stamps display name onto avatar descriptor
2. WebSocket opens → client sends `hello` (sessionId)
3. Server responds with `hello` → `session:ready` event fires
4. Server sends `som-dump` → SOM initialized, avatar ingested into local
   SOM, `world:loaded` event fires
5. AtriumClient sends `add` with avatar descriptor
6. Server ingests, broadcasts `add` to all other clients
7. Client begins sending `view` messages as user navigates
8. On disconnect: server removes avatar node, broadcasts `remove`

### NavigationInfo (in `extras.atrium` at glTF root)

```json
"navigation": {
  "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
  "terrainFollowing": true,
  "speed": { "default": 1.4, "min": 0.5, "max": 5.0 },
  "collision": { "enabled": false },
  "updateRate": { "positionInterval": 1000, "maxViewRate": 20 }
}
```

### `view` message fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `seq` | number | Yes | Sequence number — on all message types |
| `position` | `[x,y,z]` | Yes | Avatar world position |
| `look` | `[x,y,z]` | Yes | Avatar forward unit vector (yaw only, no pitch) |
| `move` | `[x,y,z]` | Yes | Movement direction unit vector; `[0,0,0]` if still |
| `velocity` | number | Yes | Speed in m/s; `0` if still |
| `up` | `[x,y,z]` | No | Up unit vector; omit in WALK (defaults to `[0,1,0]`) |

Every `view` is a complete snapshot — absolute values, no differential
encoding. `look`/`move`/`up` are unit vectors (not Euler, not quaternions).

**Important:** `look` represents the avatar's facing direction (yaw only),
NOT the camera direction. The camera may include pitch, but pitch is
local-only and not sent to peers. This prevents peer capsules from tilting
when the user looks up/down.

---

## `apps/client` — Browser UI Shell

Single `index.html` + `src/app.js`. ES modules, import map for Three.js,
no build step.

### Import map

```html
<script type="importmap">
{
  "imports": {
    "three":                      "https://esm.sh/three@0.163.0",
    "three/addons/":              "https://esm.sh/three@0.163.0/addons/",
    "@gltf-transform/core":       "https://esm.sh/@gltf-transform/core@4.3.0",
    "@gltf-transform/extensions": "https://esm.sh/@gltf-transform/extensions@4.3.0",
    "@gltf-transform/view":       "https://esm.sh/@gltf-transform/view@4.3.0?deps=three@0.163.0,@gltf-transform/core@4.3.0",
    "@atrium/som":                "../../packages/som/src/index.js",
    "@atrium/protocol":           "../../packages/protocol/src/index.js",
    "@atrium/client":             "../../packages/client/src/AtriumClient.js"
  }
}
</script>
```

Note: `@gltf-transform/view` must pin both `three` and `@gltf-transform/core`
in its `deps` parameter to ensure a single shared instance of each. Without
this, DocumentView internal assertions fail at runtime even though the objects
look correct in the debugger.

### DocumentView integration — critical notes

**1. No `docView.render()` call.** DocumentView has no `render()` method.
The Three.js render call is sufficient:
```js
renderer.render(threeScene, camera)
```

**2. `docView.view()` takes a glTF `Scene` node, not the `Document` root.**
```js
const sceneDef = somDocument.document.getRoot().listScenes()[0]
sceneGroup = docView.view(sceneDef)
```

**3. DocumentView does NOT drive the Three.js camera.** It only produces
scene geometry as a Three.js group. The app owns the Three.js camera and
the `renderer.render()` call, and manually syncs camera state from the SOM
each frame.

**4. DocumentView appears to propagate SOM node property changes** (e.g.
translation updates on avatar nodes are reflected in the Three.js scene).
However, it is not confirmed whether dynamically added nodes are fully
observed. Peer avatars use a separate manual Three.js mesh path as a
safety measure.

### Console access

```javascript
window.atriumClient          // the AtriumClient instance
window.atriumClient.som      // the live SOMDocument
window.atriumClient.connected
window.atriumClient.displayName
```

### UI layout

```
┌─────────────────────────────────────────────────┐
│  [URL bar: .gltf or .atrium.json URL] [Connect] │
├─────────────────────────────────────────────────┤
│                                                 │
│              Three.js viewport                  │
│           (pointer lock, full area)             │
│                                                 │
└─────────────────────────────────────────────────┘
```

Default URL bar value: `tests/fixtures/space.gltf`.

### Navigation — Third-Person Camera (Session 14)

The camera is positioned above and behind the avatar in a third-person view.
The user can see their own capsule.

**Scene graph structure:**
```
Scene
  ├─ ... (world geometry)
  └─ AvatarNode (translation, yaw rotation, mesh: capsule)
       └─ CameraChildNode (translation: [0, 2, 4], pitch rotation)
```

**Tunable constants** at top of `app.js`:
```javascript
const CAMERA_OFFSET_Y = 2.0   // meters above avatar
const CAMERA_OFFSET_Z = 4.0   // meters behind avatar (+Z = behind in glTF right-handed coords)
```

**Two code paths in the tick loop:**

*SOM-driven (after world:loaded, when connected):*
- Yaw quaternion → `localAvatarNode.rotation`
- WASD movement → `localAvatarNode.translation`
- Pitch quaternion → `localCameraNode.rotation`
- Three.js camera synced from SOM: world position = avatar pos + yaw-rotated
  offset; `lookAt` avatar head height; `rotateX(pitch)` for tilt
- `setView` sends avatar position and yaw-only look vector

*Direct-drive fallback (static load, pre-connect):*
- Original first-person camera, driven directly by Three.js — no SOM involvement

**Avatar setup happens in `world:loaded` handler**, NOT `session:ready`
(the SOM doesn't exist yet at `session:ready` time):

```javascript
client.on('world:loaded', () => {
  if (!client.som) return
  if (!client.connected) return   // skip for static loads
  localAvatarNode = client.som.getNodeByName(client.displayName)
  localCameraNode = client.som.createNode({
    name: `${client.displayName}-camera`,
    translation: [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z],
  })
  localAvatarNode.addChild(localCameraNode)
})
```

The camera child node is local-only — not sent to the server.

| Input | Action |
|---|---|
| `W` / `↑` | Move forward |
| `S` / `↓` | Move backward |
| `A` / `←` | Strafe left |
| `D` / `→` | Strafe right |
| Mouse move | Look (yaw + pitch) — pointer lock |
| `Escape` | Release pointer lock |

### Peer avatar rendering

- `peer:join` → `addPeerMesh`: create Three.js capsule mesh with random color
- `peer:view` → `updatePeerMesh`: update position and yaw-only orientation
- `peer:leave` → `removePeerMesh`: remove from Three.js scene

Avatar capsules use random bright colors (biased `Math.random() * 0.5 + 0.5`
per RGB channel) for visual distinction.

---

## Test Client (`tests/client/index.html`)

Protocol-level scratch pad and SOM inspector.

**Known issue — SOM source copy:** `tests/client/som/` must be manually
synced from `packages/som/src/` whenever the package changes:
```bash
cp packages/som/src/*.js tests/client/som/
```

**Known flaky test:** "handles client disconnect cleanly" in
`packages/server/tests/session.test.js` (test #19) — race condition, known
pre-existing issue, not a blocker.

---

## Design Documents in Repo

- `docs/sessions/DESIGN-avatar-navigation.md` — full avatar/navigation/view
  message design brief (updated Design Session A, 2026-03-09)
- `docs/sessions/DESIGN-som-mutation-events.md` — SOM mutation event system
  and AtriumClient sync design (Design Session C, 2026-03-20)
- `docs/sessions/DESIGN-avatar-camera-parenting.md` — third-person camera rig
  design (Design Session D, 2026-03-26)
- `docs/sessions/SESSION-*.md` — Claude Code session briefs, Sessions 1–14

---

## What's Been Built (Status)

| Layer | Status |
|---|---|
| Protocol schemas (`@atrium/protocol`) | ✅ Complete |
| Server session lifecycle | ✅ Complete |
| World state — glTF-Transform + send/set/add/remove | ✅ Complete |
| Presence — join/leave | ✅ Complete |
| SOM — Scene Object Model (`@atrium/som`) | ✅ Complete |
| SOM mutation events + SOMObject base class | ✅ Complete (Session 13) |
| SOM wrapper caching + stable identity | ✅ Complete (Session 13) |
| Avatar nodes — SOM lifecycle, connect/disconnect | ✅ Complete |
| AtriumClient — automatic SOM → server sync | ✅ Complete (Session 13) |
| AtriumClient — loopback prevention | ✅ Complete (Session 13) |
| NavigationInfo — mode, speed, updateRate | ✅ Complete |
| Test client — viewport, SOM tree, send/set UI | ✅ Complete |
| `AtriumClient` (`packages/client`) | ✅ Complete |
| `apps/client` — third-person navigation | ✅ Complete (Session 14) |
| `apps/client` — avatar-camera parenting | ✅ Complete (Session 14) |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

- **Possible duplicate capsule rendering** — DocumentView may render avatar
  nodes from the SOM while `addPeerMesh` also creates a manual Three.js mesh.
  Not visibly broken, but the two rendering paths should be reconciled.

- **Debug `view` message spew** — `_debug = true` floods the console with
  `view` messages from peers. Needs throttling or a separate verbose flag.

- **DocumentView camera observation** — DocumentView does not drive the
  Three.js camera. `app.js` manually syncs from SOM state each frame. This
  logic could eventually move into AtriumClient.

- **Camera child node in `som-dump`** — the camera child node is local-only
  but exists in the glTF-Transform document. It could appear in `som-dump`
  for late-joining clients. May need ephemeral node marking or creation
  outside the document.

- **Known flaky test** — "handles client disconnect cleanly" in
  `packages/server/tests/session.test.js` — race condition, pre-existing.

---

## Next Steps

### Near-term improvements to `apps/client`

- **Drag-to-look mode** — `mousedown`/`mousemove`/`mouseup` flag, no pointer
  lock required. Suggested: `USE_POINTER_LOCK = false` toggle at top of
  `app.js` to switch between modes.
- **World metadata console logging** — world name/description/author on
  `world:loaded`, peer count on `peer:join`/`peer:leave`
- **Reconcile avatar rendering paths** — choose either DocumentView or
  manual Three.js mesh for avatar rendering, eliminate the duplicate

### Design Session B — User Object Extensions

`ATRIUM_user_object` — the object type registry. Open questions:
- Scene graph fragment instancing
- Script execution context
- Type definition location (inline in glTF? separate registry file?)
- Authority model (who can create/mutate which UO types?)

### Deferred — can be picked up anytime

- **Dead reckoning** — `view` message design enables it
  (`position + move * velocity * Δt`), implementation deferred
- **`up` vector send in FLY mode** — WALK clients never send `up`; FLY
  clients should
- **View send frequency delta thresholds** — `maxViewRate` caps rate but
  minimum delta for event-driven sends not specified; currently sends
  `view` every frame which causes debug spew
- **Avatar name label overlay** in viewport
- **`ATRIUM_world` extension formalization** — NavigationInfo currently in
  `extras.atrium`; migrate to `extensions.ATRIUM_world` when formalized
- **Collision proxy conventions** — deferred with collision implementation
- **Gravity as scalar** — reintroduced as m/s² when physics is in scope
- **Viewpoints** — named subset of glTF camera nodes with designated default;
  switching copies authored camera transform into avatar node
- **`@atrium/som` npm publish** + import map for test client
- **README / TESTING.md** updates

---

## Key Design Principles (never violate these)

1. **Design before code.** Every session starts from a settled design brief.
   Unresolved questions get a design session, not a coding guess.

2. **No throwaway code.** Every line is tested against the real implementation.
   No fake stubs, no mock world state.

3. **Incremental correctness.** Each layer is fully working and tested before
   the next is built on top of it. You can always run what exists.

4. **glTF on the wire.** The protocol carries glTF node descriptors directly.
   No translation layer. No impedance mismatch.

5. **Server is policy-free on geometry.** The server never constructs or
   interprets mesh geometry. It ingests whatever the client sends.

6. **AtriumClient is geometry-agnostic.** Like the server, `packages/client`
   never constructs or inspects mesh geometry. The avatar descriptor is
   opaque — built and owned entirely by `apps/client`.

7. **SOM is the source of truth.** All world state mutations — world geometry
   and avatar nodes alike — go through the SOM. Navigation input drives SOM
   nodes; the rendering layer reads from the SOM.

8. **Static first, multiplayer second.** The client renders the world even
   if the server is unreachable. Multiplayer is an overlay.

9. **glTF is world state.** The SOM is a live API lens over a glTF-Transform
   Document. Serialize the Document, you have serialized the world — avatar
   nodes and all.

---

## Getting Started (for Claude Code)

```bash
git clone https://github.com/tparisi/atrium.git
cd atrium
pnpm install

# run all tests
pnpm --filter @atrium/protocol test
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test
pnpm --filter @atrium/client test

# start a world server
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# open the real client (from repo root, in a browser)
open apps/client/index.html
# default URL bar: tests/fixtures/space.gltf
# connect to ws://localhost:3000

# open the test client (protocol scratch pad)
open tests/client/index.html
# connect to ws://localhost:3000

# open the protocol inspector
open tools/protocol-inspector/index.html
```

**When you change `packages/som`, always sync the test client:**
```bash
cp packages/som/src/*.js tests/client/som/
```
