# Project Atrium
## 2026-04-04 · As of Session 21

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

## Workflow

**Claude (chat) is the design partner.** Architecture, design briefs,
specs, procedural content generation, and handoff documents are produced
here. Claude chat does not modify the repo directly.

**Claude Code is the builder.** All implementation against the live repo —
code changes, test writing, debugging — is done by Claude Code, working
from design briefs produced in chat.

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
│   ├── client/          # AtriumClient, AvatarController, NavigationController
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── apps/
│   └── client/          # Browser UI shell — Three.js viewport, navigation, avatars
│       ├── index.html
│       └── src/
│           ├── app.js
│           └── LabelOverlay.js
├── tools/
│   ├── protocol-inspector/index.html   # Single-file interactive protocol debugger
│   └── som-inspector/                  # SOM Inspector (Session 19)
│       ├── index.html
│       └── src/
│           ├── app.js
│           ├── TreeView.js
│           └── PropertySheet.js
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # Minimal world fixture (gray-box)
│   │   ├── space.atrium.json   # World manifest for space
│   │   ├── generate-space.js   # Geometry + fixture generator for space
│   │   ├── atrium.gltf         # Atrium scene fixture (Session 21)
│   │   ├── atrium.atrium.json  # World manifest for atrium
│   │   ├── generate-atrium.js  # Geometry + fixture generator for atrium
│   │   └── skyboxtest1.png     # Equirectangular sky texture (3072×1536)
│   └── client/
│       ├── index.html          # Legacy test client (protocol scratch pad)
│       └── som/                # Manual source copy of packages/som/src/
├── docs/
│   └── sessions/        # Design briefs + session logs
└── ...
```

---

## Test Counts (after Session 20)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 43 |
| `@atrium/som` | 67 |
| `@atrium/server` | 32 |
| `@atrium/client` | 54 |
| **Total** | **196** |

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

## SOM Object Model

The SOM has a full object hierarchy wrapping glTF-Transform properties.
Every SOM type inherits from `SOMObject`.

### SOM Types

| Class | Wraps | Key mutable properties |
|-------|-------|----------------------|
| `SOMDocument` | glTF-Transform `Document` | (container — factories, lookups, resolve helpers) |
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

### Mutation events

Every setter on every SOM type fires a `mutation` event after updating
the underlying glTF-Transform object. Only allocates a `SOMEvent` if
listeners are present (`_hasListeners` check).

**Property change:**
```javascript
{ target: somObject, property: 'baseColorFactor', value: [1, 0, 0, 1] }
```

**Child list change:**
```javascript
{ target: somObject, childList: { addedNodes: ['nodeName'] } }
{ target: somObject, childList: { removedNodes: ['nodeName'] } }
```

### Wrapper caching, stable identity, and document threading (Session 20)

`SOMDocument` builds the full object graph at construction time, bottom-up.
All wrappers are cached in maps keyed by both glTF-Transform object and
by name.

```javascript
som.getNodeByName('x') === som.getNodeByName('x')   // true — stable identity
```

`getNodeByName` is O(1) via `_nodesByName` Map.

**Document reference threading:** Every wrapper that can return child
objects (`SOMScene`, `SOMNode`, `SOMMesh`, `SOMPrimitive`, `SOMSkin`)
receives the parent `SOMDocument` as a constructor argument and stores
it as `this._document`. All accessors (`.children`, `.parent`, `.mesh`,
`.camera`, `.skin`, `.primitives`, `.material`, `.joints`, `.skeleton`)
resolve through `SOMDocument` resolve helpers to return the cached
wrapper instance.

**Resolve helpers** on `SOMDocument`:
```javascript
_resolveNode(n)      // → cached SOMNode or null
_resolveMesh(m)      // → cached SOMMesh or null
_resolveCamera(c)    // → cached SOMCamera or null
_resolvePrimitive(p) // → cached SOMPrimitive or null
_resolveMaterial(m)  // → cached SOMMaterial or null
_resolveSkin(s)      // → cached SOMSkin or null
```

This guarantees stable identity everywhere — walking the tree via
`.children`, accessing `.mesh`, `.camera`, etc. all return the same
instances that carry AtriumClient mutation listeners. Prior to Session 20,
these accessors created fresh wrappers that silently dropped mutations.

### Key SOM API

```javascript
som.getNodeByName(name)           // O(1) lookup → SOMNode or null
som.nodes                         // all SOMNode instances
som.meshes / .materials / etc.    // same for other types
som.scene                         // the first SOMScene

som.ingestNode(descriptor)        // create node + full mesh geometry from glTF descriptor
som.createNode(descriptor)        // create bare node (no mesh)
som.createMesh / Material / etc.  // individual factories

som.setPath(somNode, 'mesh.primitives[0].material.baseColorFactor', value)
som.getPath(somNode, path)

som.document                      // underlying glTF-Transform Document
```

### SOM ↔ glTF-Transform relationship

The SOM wrappers are thin — every mutation flows through to the real
glTF-Transform document. The glTF-Transform `Document` is always the
ground truth. Serialize the document, you have serialized the world.

---

## Client Package (`packages/client`)

Three classes, zero Three.js or DOM dependency — portable across browser
UI, headless tests, and future bot clients.

### AtriumClient (`AtriumClient.js`)

Connection, protocol, SOM sync layer. Unchanged since Session 16 (one
small addition: stamps `extras.atrium.ephemeral = true` on avatar
descriptors in `connect()`).

**Constructor:** `new AtriumClient({ debug: false })`

**Properties:** `client.som`, `client.connected`, `client.displayName`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)
client.setView({ position, look, move, velocity, up })
```

**Events:**
```javascript
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})
client.on('session:ready', ({ sessionId, displayName }) => {})
client.on('world:loaded', ({ name, description, author }) => {})
client.on('peer:join', ({ sessionId, displayName }) => {})
client.on('peer:leave', ({ sessionId, displayName }) => {})
client.on('peer:view', ({ displayName, position, look, move, velocity, up }) => {})
client.on('som:add', ({ nodeName }) => {})
client.on('som:remove', ({ nodeName }) => {})
client.on('som:set', ({ nodeName, path, value }) => {})
```

**Event timing:** `session:ready` fires before SOM exists. `world:loaded`
fires after SOM is initialized and avatar is ingested. Always use
`world:loaded` for node lookups.

**Scene events for UI consumers:** `som:add`, `som:remove`, and `som:set`
are the primary events for building UI on top of AtriumClient. `som:set`
only fires for remote mutations (loopback already filtered), so UI code
that writes to SOM setters will not trigger its own refresh. The SOM
Inspector (Session 19) uses only these three events to drive its entire
tree view and property sheet — no polling, no per-object listeners.

**Automatic SOM → Server sync:** Mutation listeners on all SOM nodes
forward local changes to the server. Loopback prevention via session ID
check (own echo) and `_applyingRemote` flag (inbound re-broadcast).

**`setView` send policy:** Position heartbeat at `positionInterval` ms,
look/move/up/velocity event-driven on change, overall rate capped at
`maxViewRate` msg/s. Values from `NavigationInfo.updateRate`.

### AvatarController (`AvatarController.js`) — Session 16

Manages all avatar state in the SOM. Never constructs or inspects mesh
geometry — operates on SOM node properties only.

**Constructor:** `new AvatarController(client, { cameraOffsetY, cameraOffsetZ })`

**Lifecycle — local avatar:**
- **Connected:** On `world:loaded`, looks up avatar node by display name,
  creates camera child at `[0, offsetY, offsetZ]`, emits `avatar:local-ready`
- **Static:** On `world:loaded` when not connected, creates bare node
  `__local_camera` at eye height `[0, 1.6, 0]`, camera child at `[0, 0, 0]`
  (first-person), emits `avatar:local-ready`
- **Disconnected:** Clears all references

**Lifecycle — peers:**
- On `peer:join`: looks up peer node, sets random bright color on SOM material
  (`baseColorFactor`), registers in peer map, emits `avatar:peer-added`
- On `world:loaded` (late joiner): scans SOM nodes for `extras.displayName`,
  registers pre-existing peers from `som-dump`
- On `peer:leave`: removes from peer map, emits `avatar:peer-removed`
- Peer node discriminator: `extras.displayName` field (set by AtriumClient,
  absent on world geometry nodes)

**Delta-based view optimization:** `setView()` compares position/look/move/up
(via `vec3Equal` with epsilon) and velocity (scalar epsilon) against last-sent
values. Skips `client.setView()` entirely when nothing changed.

**Events:** `avatar:local-ready`, `avatar:peer-added`, `avatar:peer-removed`

**Properties:** `avatar.localNode`, `avatar.cameraNode`, `avatar.peerCount`,
`avatar.getPeerNode(name)`

### NavigationController (`NavigationController.js`) — Sessions 16, 18

Translates user input into SOM node mutations. No Three.js or DOM dependency.

**Constructor:** `new NavigationController(avatar, { mode, mouseSensitivity })`

**Input methods (called by app from DOM event handlers):**
```javascript
nav.onMouseMove(dx, dy)    // yaw/pitch in WALK, azimuth/elevation in ORBIT
nav.onKeyDown(code)        // tracks pressed keys
nav.onKeyUp(code)
nav.onWheel(deltaY)        // scroll zoom in ORBIT, ignored in WALK
nav.setMode(mode)          // 'WALK', 'FLY', 'ORBIT' — validates against NavigationInfo
nav.tick(dt)               // called each frame
```

**WALK mode (fully implemented):**
- WASD movement on XZ ground plane, speed from NavigationInfo
- Yaw quaternion → `localNode.rotation`, pitch quaternion → `cameraNode.rotation`
- Look vector is yaw-only (no pitch) — pitch is camera-local
- Forward: `[-sin(yaw), 0, -cos(yaw)]`, Right: `[cos(yaw), 0, -sin(yaw)]`

**ORBIT mode (Session 18, fully implemented):**
- Spherical camera around `orbitTarget` focus point
- Drag orbits (azimuth + elevation), scroll zooms (multiplicative ×1.1/0.9)
- Elevation clamped ±π/2.2, radius clamped [0.5, 100]
- WASD disabled — viewing mode only
- `setView` sends camera position with zero move/velocity
- `setMode('ORBIT')` derives orbit params from current position (no teleport)

**FLY mode:** Stub — accepted by `setMode`, falls back to WALK behavior.

**NavigationInfo integration:** On `avatar:local-ready`, reads
`extras.atrium.navigation` from SOM for speed/mode config.

**Properties:** `nav.mode`, `nav.yaw`, `nav.pitch`, `nav.orbitTarget`,
`nav.orbitRadius`

---

## Avatar System

### Core design

**Avatar nodes are regular SOM nodes** — ephemeral per session, full glTF
citizens at runtime (geometry, materials, physics-ready), but session-scoped.
The cursor analogy: like a cursor in Google Docs — present while viewing,
reflected to all users, disappears on close, not persisted to the document.

**Ephemeral marking:** `extras.atrium.ephemeral = true` stamped by AtriumClient
in `connect()`. Consumed by:
- SOM Inspector TreeView — purple circle indicator on ephemeral nodes
- Future canonical serialization — will exclude ephemeral nodes

**Session identity = avatar node identity:** `displayName = User-${sessionId.slice(0,4)}`

**Geometry ownership:** Apps build avatar geometry (capsule, model, etc.) and
pass it as a descriptor to `client.connect()`. AtriumClient stamps the name.
AvatarController and the server never construct or inspect geometry.

**Single rendering path:** DocumentView renders all avatar nodes from the SOM.
No manual Three.js meshes. Peer colors set via SOM material mutation
(`baseColorFactor`), propagated by DocumentView automatically.

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
| `seq` | number | Yes | Sequence number |
| `position` | `[x,y,z]` | Yes | Avatar/camera world position |
| `look` | `[x,y,z]` | Yes | Forward unit vector (yaw only, no pitch) |
| `move` | `[x,y,z]` | Yes | Movement direction; `[0,0,0]` if still |
| `velocity` | number | Yes | Speed in m/s; `0` if still |
| `up` | `[x,y,z]` | No | Up vector; omit in WALK |

---

## `extras.atrium` Root Metadata

World-level metadata lives in `extras.atrium` on the glTF document root.
This is read by the app layer; the server does not interpret it.

```json
"extras": {
  "atrium": {
    "name": "The Atrium",
    "description": "A circular gathering space.",
    "author": "Project Atrium",
    "navigation": { ... },
    "background": {
      "texture": "skyboxtest1.png",
      "type": "equirectangular"
    }
  }
}
```

### `background` (Session 21)

| Field | Type | Description |
|-------|------|-------------|
| `texture` | string | Path to image, resolved relative to the `.gltf` file URL |
| `type` | string | `"equirectangular"` or `"cubemap"`. Only equirectangular is implemented. |

The texture is used for both `scene.background` (visible skybox) and
`scene.environment` (IBL reflections on PBR materials). Loaded after
`world:loaded` via Three.js `TextureLoader` with
`EquirectangularReflectionMapping` and `SRGBColorSpace`. Fire-and-forget;
warns on failure. Cleared on disconnect/reload before loading the next
world's background.

Implemented in both `apps/client/src/app.js` and
`tools/som-inspector/src/app.js`.

---

## `apps/client` — Browser UI Shell

Single `index.html` + `src/app.js` + `src/LabelOverlay.js`. ES modules,
import map for Three.js, no build step.

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
    "@atrium/client":             "../../packages/client/src/AtriumClient.js",
    "@atrium/client/AvatarController":     "../../packages/client/src/AvatarController.js",
    "@atrium/client/NavigationController": "../../packages/client/src/NavigationController.js"
  }
}
```

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [URL bar] [Load]  ● [Connect]  [Walk ▾]                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              Three.js viewport                              │
│                                                             │
│  ┌─ HUD (top-left) ──────────┐                              │
│  │ World: Space               │                              │
│  │ You: User-3f2a             │                              │
│  │ Peers: 2                   │                              │
│  └────────────────────────────┘                              │
│                                                             │
│                          [User-a1b2]  ← peer label          │
│                              🧍       ← peer capsule        │
│                                                             │
│  Drag to look · WASD to move · [M] mouse lock · [V] 1st    │
└─────────────────────────────────────────────────────────────┘
```

### Navigation Modes

**Drag-to-look (default):** Mousedown + drag rotates yaw/pitch. Cursor
visible. `M` key toggles to pointer lock and back.

**Pointer lock:** Click engages lock. Mouse movement rotates. Escape releases.

**Camera perspective:** `V` key toggles first-person / third-person while
connected. First-person: `cameraNode.translation = [0, 1.6, 0]`,
`localNode.visible = false`. Third-person: `[0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]`,
`visible = true`.

**ORBIT mode:** Select from toolbar dropdown. Drag orbits, scroll zooms.
WASD disabled. `M`/`V` keys inactive in ORBIT.

**Camera sync branches in tick loop:**
```
nav.mode === 'ORBIT'  → position from node, lookAt orbitTarget
camOffset Z > 0.001   → third-person: lookAt with offset (WALK connected)
else                  → first-person: direct quaternion (WALK static or V-toggled)
```

### Peer avatar rendering

All via DocumentView from SOM. AvatarController sets random bright colors
on peer materials (`baseColorFactor`). `LabelOverlay` projects CSS labels
above peer capsules each frame.

### Disconnect behavior

On disconnect, app reloads the world via `client.loadWorld(url)`. This
creates a fresh SOM (no avatars), DocumentView re-renders the clean scene,
AvatarController creates a bare static-mode node. User returns to static
browsing seamlessly.

### Console access

```javascript
window.atriumClient          // the AtriumClient instance
window.atriumClient.som      // the live SOMDocument
```

---

## SOM Inspector (`tools/som-inspector/`) — Session 19

Developer tool for viewing and editing the live SOM. Uses the full client
stack (AtriumClient, AvatarController, NavigationController) with an
inspection-focused UI.

### Architecture

Three AtriumClient events drive all UI updates — no polling, no per-object
mutation listeners:

| Event | Handler |
|---|---|
| `world:loaded` | Init DocumentView, build tree, clear property sheet |
| `som:add` | Rebuild tree |
| `som:remove` | Rebuild tree; clear property sheet if selected node was removed |
| `som:set` | Refresh property sheet if `nodeName` matches selected node |

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [URL bar: .gltf or .atrium.json]  [Load]  ● [Connect]      │
│                                              [Orbit ▾]       │
├────────────────────┬─────────────────────────────────────────┤
│                    │                                         │
│   Scene graph      │          3D Viewport                    │
│   tree view        │       (ORBIT default)                   │
│   (scrollable)     │                                         │
│                    │                                         │
│  ▸ Scene           │                                         │
│    ▸ Ground        │                                         │
│    ▸ Crate         │                                         │
│    ▸ Light         │                                         │
│    ▸ User-3f2a ◉   │                                         │
│                    │                                         │
├────────────────────┤                                         │
│                    │                                         │
│  Property sheet    │                                         │
│                    │                                         │
│  Node: Crate       │                                         │
│  Translation: ...  │                                         │
│  Material: ...     │                                         │
│                    │                                         │
└────────────────────┴─────────────────────────────────────────┘
```

### Key design decisions

- **ORBIT is the default navigation mode.** Higher mouse sensitivity
  (0.005 vs apps/client's 0.002) for fluid inspection.
- **No visible avatars.** Meshless avatar descriptor (translation only,
  no geometry). Avatars exist in the SOM for networking but aren't
  rendered.
- **No LabelOverlay.** Peer nodes appear in the tree view as ephemeral
  nodes (purple circle indicator) instead.
- **Ephemeral node indicator.** Tree checks `extras.atrium.ephemeral`
  on each node.
- **TreeView** rebuilds fully on structural changes. Selection preserved
  across rebuilds by node name.
- **PropertySheet** uses an updater pattern — `show()` stores closures
  per input that read SOM → write DOM. `refresh()` runs all updaters
  with no DOM reconstruction and no focus loss.
- **Live cross-client editing.** Confirmed working: editing a peer's
  material properties from the inspector propagates to `apps/client`
  in real time via the full SOM → AtriumClient → server → broadcast
  pipeline.

### Property sheet sections

**Node:** translation (vec3), rotation (vec4), scale (vec3), visible (checkbox).

**Material** (when `node.mesh?.primitives?.[0]?.material` is non-null):
base color (color picker + alpha), metallic factor (number + slider),
roughness factor (number + slider), emissive factor (vec3), alpha mode
(dropdown), alpha cutoff (conditional on MASK), double sided (checkbox).

**Camera** (when `node.camera` is non-null): type dropdown, Y-FOV
(number + slider), Z-near, Z-far.

### Deferred inspector features

- Object highlighting / selection in viewport (wireframe overlay)
- Click-to-select in viewport (raycast → SOM node → tree selection)
- Focus orbit on selected node
- Undo/redo
- Full scene editor capabilities (add/delete nodes)
- World metadata panel (extras.atrium editing UI)

---

## Atrium Scene (`tests/fixtures/atrium.gltf`) — Session 21

Procedurally generated circular gathering space. 56 nodes, 43 meshes,
9 PBR materials. Self-contained glTF (base64-embedded buffer, no
separate `.bin`).

### Scene graph

```
Atrium (Scene)
├── Floor                    — disc, MarbleFloor (cream, polished)
├── FloorAccent              — torus ring, DarkStone
├── Ceiling                  — disc rotated 180° X, StoneWall
├── Walls
│   ├── WallSegment-1        — arc, StoneWall (sandstone)
│   ├── WallSegment-2
│   ├── WallSegment-3
│   └── WallSegment-4        — gaps between = archway openings
├── Columns
│   ├── Column-1 … Column-8  — capped cylinders, Marble
├── Furniture
│   ├── Table-Center          — offset to [-3, 0, 0]
│   │   ├── Table-Center-Top        — cylinder, DarkWood
│   │   ├── Table-Center-Pedestal   — cylinder, BrushedMetal
│   │   └── Table-Center-Base       — cylinder, BrushedMetal
│   ├── Credenza-North/South/East/West  — each with -Body + -Top
│   └── Bench-NE/SE/SW/NW              — each with -Seat + -LegLeft + -LegRight
└── Fountain                  — offset to [4.5, 0, 0]
    ├── Fountain-Basin        — capped cylinder, DarkStone
    ├── Fountain-Water        — disc, Water (translucent blue, BLEND)
    ├── Fountain-Pillar       — capped cylinder, Marble
    ├── Fountain-Sphere       — UV sphere, BrushedMetal
    └── Fountain-GlowRing    — torus, GlowRing (emissive warm)
```

### Materials

| Name | Base Color | Metallic | Roughness | Notes |
|------|-----------|----------|-----------|-------|
| MarbleFloor | warm cream | 0.1 | 0.3 | Polished stone |
| StoneWall | warm sandstone | 0.0 | 0.8 | |
| Marble | light marble | 0.05 | 0.25 | Columns |
| DarkWood | dark walnut | 0.0 | 0.6 | Table top, bench seats |
| LightWood | oak | 0.0 | 0.55 | Credenza bodies |
| BrushedMetal | steel | 0.9 | 0.35 | Pedestal, legs |
| DarkStone | dark gray | 0.0 | 0.7 | Accent ring, credenza tops |
| Water | translucent blue | 0.2 | 0.1 | Alpha 0.6, BLEND mode |
| GlowRing | white | 0.0 | 1.0 | Emissive [0.8, 0.7, 0.5] |

### Generator

`tests/fixtures/generate-atrium.js` — ES module, uses glTF-Transform
resolved from `packages/server/node_modules/`. Run from repo root:

```bash
node tests/fixtures/generate-atrium.js
```

Geometry builders: `buildDisc`, `buildBox`, `buildCylinder`, `buildTorus`,
`buildSphere`, `buildWallArc`. All produce correct CCW winding for
outward-facing normals (or inward for wall arcs). Output is self-contained
via base64 data URI embedding.

---

## `.atrium.json` Config Files

Launcher/pointer files that sit alongside `.gltf` files. Current format:

```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./atrium.gltf",
    "server": "ws://localhost:3000"
  }
}
```

**Status:** Not actively consumed by any code yet. The server takes
`WORLD_PATH` env var pointing directly to the `.gltf`. The client has a
URL bar for the `.gltf` path and a separate Connect button for the
WebSocket. The `.atrium.json` exists as a convention for future use — when
consumed, loading an `.atrium.json` URL will give the client both the
world file path and server address in one shot.

**Key distinction:** World metadata (name, description, author, navigation,
background) lives in `extras.atrium` inside the glTF. The `.atrium.json`
is purely operational config — where to find things, not what they are.

---

## External References (Designed Session 21, Not Yet Implemented)

A mechanism for nodes in a world `.gltf` to reference external glTF
assets that are loaded and composed into the scene at runtime.

### Schema

A node with no mesh but an `extras.atrium.source` field:

```json
{
  "name": "Chair-NorthWall",
  "translation": [3, 0, -5],
  "extras": {
    "atrium": {
      "source": "models/chair.glb"
    }
  }
}
```

### Resolution

- Relative paths resolve against the referencing `.gltf` file's URL
  (same convention as glTF buffer/image URIs)
- Absolute URLs also supported
- AtriumClient resolves references — the server never loads external assets

### Loading lifecycle

- `world:loaded` fires on the skeleton scene (all source nodes present
  as empty containers)
- AtriumClient walks the SOM looking for nodes with `extras.atrium.source`,
  fetches each referenced glTF, ingests into the SOM as children of the
  container node
- Per-reference load completion events deferred to a future enhancement

### Naming — path prefix scheme

External models may contain nodes with names that collide with existing
world nodes or other external models. To guarantee uniqueness:

- When ingesting an external reference, every node in the loaded model
  gets its name prefixed with `ContainerName/` (slash separator)
- Example: `Chair-NorthWall` loads a model containing `Body`, `Seat`,
  `Leg-1` → they become `Chair-NorthWall/Body`, `Chair-NorthWall/Seat`,
  `Chair-NorthWall/Leg-1`
- Prefixing happens at the SOM layer only; underlying glTF-Transform
  nodes keep their original names
- `getNodeByName` uses the full prefixed path
- Protocol messages carry the full prefixed name
- Nests naturally: `Chair-NorthWall/Lamp/Bulb`

### Display name in inspector

- **Tree view:** shows only the last path segment (`Seat`, not
  `Chair-NorthWall/Seat`) — hierarchy provides context
- **Property sheet title:** shows full prefixed path for unambiguous
  identification

### Multiplayer implications

World-authored external references are **client-side only**. Each client
resolves the same `source` fields independently from the shared world
file. No `add` messages are broadcast for loaded external geometry.
This is distinct from user objects (avatars), where geometry must be
broadcast because each user brings something different.

**Possible gotcha (noted):** If a client modifies a node inside an
externally-loaded model, the `set` message will use the prefixed name.
Other clients need to have loaded the same external reference to find
that node. Since all clients load the same world file, this should work —
but it's a timing dependency to watch for.

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
| SOM wrapper caching + stable identity | ✅ Complete (Session 13, fixed Session 20) |
| SOM document threading + resolve helpers | ✅ Complete (Session 20) |
| AtriumClient — connection, protocol, SOM sync | ✅ Complete |
| AtriumClient — automatic SOM → server sync | ✅ Complete (Session 13) |
| AtriumClient — loopback prevention | ✅ Complete (Session 13) |
| AvatarController — local + peer avatar lifecycle | ✅ Complete (Session 16) |
| AvatarController — delta-based view optimization | ✅ Complete (Session 16) |
| NavigationController — WALK mode | ✅ Complete (Session 16) |
| NavigationController — ORBIT mode | ✅ Complete (Session 18) |
| `apps/client` — third-person navigation | ✅ Complete (Session 14) |
| `apps/client` — drag-to-look + pointer lock toggle | ✅ Complete (Sessions 15, 17) |
| `apps/client` — first/third person toggle | ✅ Complete (Session 17) |
| `apps/client` — HUD overlay + connection state UI | ✅ Complete (Session 15) |
| `apps/client` — peer name labels (LabelOverlay) | ✅ Complete (Session 17) |
| `apps/client` — mode switcher (Walk/Orbit dropdown) | ✅ Complete (Session 18) |
| `apps/client` — disconnect → static mode reload | ✅ Complete (Session 18) |
| SOM Inspector — tree view + property sheet + viewport | ✅ Complete (Session 19) |
| SOM Inspector — live cross-client editing | ✅ Confirmed working (Session 19) |
| Atrium scene fixture (`tests/fixtures/atrium.gltf`) | ✅ Complete (Session 21) |
| Background loading (equirectangular skybox + IBL) | ✅ Complete (Session 21) |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| External references (`extras.atrium.source`) | 🔜 Designed Session 21, not yet implemented |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

- **Label height offset** — peer name labels may float too high above
  capsules (`LABEL_HEIGHT_OFFSET = 2.2`). Needs visual tuning.

- **ORBIT → WALK avatar placement** — switching from ORBIT back to WALK
  places the avatar at the orbit camera position, which may be floating
  in the air. Deferred polish.

- **Known flaky test** — "handles client disconnect cleanly" in
  `packages/server/tests/session.test.js` — race condition, pre-existing.

- **Debug `view` message spew** — `_debug = true` floods console with
  peer `view` messages. Needs throttling or separate verbose flag.

- **Camera child node in `som-dump`** — local-only camera child node
  could appear in `som-dump` for late joiners. May need ephemeral marking
  or creation outside the document.

- **No permissions model** — any connected client can mutate any node's
  properties, including other peers' avatars. Confirmed via SOM Inspector
  editing a peer's material color in `apps/client`. Needs a design pass
  before real-world use.

---

## Backlog (Prioritized)

### Next: External references
- Implement `extras.atrium.source` resolution in AtriumClient
- SOM ingestion with path-prefix naming (`ContainerName/ChildName`)
- Inspector tree view: display last path segment only
- Inspector property sheet: show full prefixed path in title
- Test with real glTF models from Sketchfab / KhronosGroup samples

### Real content (continued)
- Replace capsule avatars with static glTF character models
- Source additional free glTF assets (Sketchfab CC0, KhronosGroup
  samples, Quaternius packs, Poly Haven)
- Stress-test renderer, SOM, and avatar system against real-world assets

### Navigation
- **FLY mode** — remove Y constraint, include pitch in movement vector.
  Simpler than terrain following — do first.
- **Terrain following for WALK** — raycast downward to find ground surface.
  Needs a `getGroundHeight(x, z)` callback from app layer (keeps
  NavigationController free of Three.js dependency). App implements with
  Three.js `Raycaster`.
- **Gravity** — apply downward velocity when not on ground. Builds on
  terrain following infrastructure.

### Inspector interaction
- Object highlighting in viewport (wireframe overlay on selected node)
- Click-to-select in viewport (raycast → SOM node → tree selection)
- Focus orbit on selected node (`nav.orbitTarget` = node world position)
- Select-and-drag to move (simple editor)
- World metadata panel (extras.atrium editing UI)

### Architecture
- Persistence — periodic glTF snapshots, ephemeral node filtering,
  last-write-wins
- Permissions model design
- Design Session B — User Object Extensions (`ATRIUM_user_object`)

### UX polish
- Label height offset tuning
- ORBIT → WALK avatar placement polish
- Debug view spew fix (throttle or verbose flag)
- HDR background support (RGBELoader)

### Deferred
- `.atrium.json` consumption by client (auto-load world + auto-connect)
- `ATRIUM_world` glTF extension formalization
- Dead reckoning
- Collision / physics
- Viewpoints (named camera nodes)
- `@atrium/som` npm publish
- AtriumRenderer abstraction (Three.js → renderer-agnostic)
- README / TESTING.md updates

---

## Free glTF Asset Sources

| Source | Best for | License |
|--------|---------|---------|
| [KhronosGroup glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | PBR test models, stress testing | Various CC |
| [Sketchfab](https://sketchfab.com) | Environments, characters, props | Filter by CC |
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR textures, some models | CC0 |
| [Poly Pizza](https://poly.pizza) | Low-poly game assets | CC0 |
| [Quaternius](https://quaternius.com) | Low-poly packs, consistent style | CC0 |
| [Ready Player Me](https://readyplayer.me) | Avatars (glTF) | Various |
| [Mixamo](https://mixamo.com) | Characters (FBX → glTF convert) | Free |
| [Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) | Proven Three.js-compatible | Various |

---

## Key Design Principles (never violate these)

1. **Design before code.** Every session starts from a settled design brief.
2. **No throwaway code.** Every line is tested against the real implementation.
3. **Incremental correctness.** Each layer is fully working and tested before
   the next is built on top of it.
4. **glTF on the wire.** The protocol carries glTF node descriptors directly.
5. **Server is policy-free on geometry.** The server never constructs or
   interprets mesh geometry.
6. **AtriumClient is geometry-agnostic.** `packages/client` never constructs
   or inspects mesh geometry. The avatar descriptor is opaque.
7. **SOM is the source of truth.** All world state mutations go through the SOM.
8. **Static first, multiplayer second.** The client renders the world even
   if the server is unreachable.
9. **glTF is world state.** Serialize the Document, you have serialized the
   world.

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

# start a world server (original space)
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# start a world server (atrium scene)
cd packages/server
WORLD_PATH=../../tests/fixtures/atrium.gltf node src/index.js

# open the browser client
open apps/client/index.html

# open the protocol inspector
open tools/protocol-inspector/index.html

# open the SOM inspector
open tools/som-inspector/index.html
```

**When you change `packages/som`, always sync the test client:**
```bash
cp packages/som/src/*.js tests/client/som/
```
