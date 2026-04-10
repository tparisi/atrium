# Project Atrium
## 2026-04-09 · As of Session 26

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

**All generated artifacts — design briefs, handoff documents, and Claude
Code instructions — should be produced as markdown files.**

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
│   └── som-inspector/                  # SOM Inspector (Sessions 19, 22–26)
│       ├── index.html
│       └── src/
│           ├── app.js
│           ├── TreeView.js
│           ├── PropertySheet.js
│           └── WorldInfoPanel.js       # World metadata editor (Session 22)
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # Minimal world fixture (gray-box)
│   │   ├── space.atrium.json   # World manifest for space
│   │   ├── generate-space.js   # Geometry + fixture generator for space
│   │   ├── atrium.gltf         # Atrium scene fixture (Session 21)
│   │   ├── atrium.atrium.json  # World manifest for atrium
│   │   ├── generate-atrium.js  # Geometry + fixture generator for atrium
│   │   ├── crate.gltf         # Standalone crate model (external ref test, Session 24)
│   │   ├── lamp.gltf          # Standalone lamp model (external ref test, Session 24)
│   │   ├── space-ext.gltf     # External references world fixture (Session 24)
│   │   ├── space-ext.atrium.json  # World manifest for space-ext (+ baseUrl, Session 26)
│   │   ├── generate-space-ext.js  # Fixture generator for external ref tests
│   │   └── skyboxtest1.png     # Equirectangular sky texture (3072×1536)
│   └── client/
│       ├── index.html          # Legacy test client (protocol scratch pad)
│       └── som/                # Manual source copy of packages/som/src/
├── docs/
│   └── sessions/        # Design briefs + session logs
└── ...
```

---

## Test Counts (after Session 26)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 43 |
| `@atrium/som` | 87 |
| `@atrium/server` | 81 |
| `@atrium/client` | 65 |
| **Total** | **~276** |

Counts approximate — verify with `pnpm --filter <package> test` after
pulling latest. No new tests added in Session 26 — existing
`external-references.test.js` tests cover the downstream behavior of the
base URL refactor.

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
- `set` with `name: '__document__'` targets document-root extras instead
  of a named node (Session 22)

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
| `SOMDocument` | glTF-Transform `Document` | `extras` (Session 22), `setExtrasAtrium(path, value)`, factories, lookups, resolve helpers |
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

### SOMDocument extras (Session 22)

`SOMDocument` exposes document-root extras via getter/setter with
mutation events, following the same pattern as `SOMNode.extras`:

```javascript
som.extras                              // getter — returns root extras by reference
som.extras = { atrium: { ... } }        // setter — replaces, fires mutation event
som.setExtrasAtrium('background.texture', 'sky.png')  // convenience deep-set
```

`setExtrasAtrium(path, value)` deep-clones extras, traverses the
dot-delimited path into `extras.atrium`, sets the leaf value, creates
intermediate objects as needed, and writes back via the setter (which
fires the mutation event). Keeps UI code clean — one call per field edit.

`SOMDocument` extends `SOMObject`, so `addEventListener`,
`_hasListeners`, `_dispatchEvent` are all inherited.

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

som.extras                        // document-root extras (Session 22)
som.setExtrasAtrium(path, value)  // deep-set into extras.atrium (Session 22)

som.ingestNode(descriptor)        // create node + full mesh geometry from glTF descriptor
som.createNode(descriptor)        // create bare node (no mesh)
som.createMesh / Material / etc.  // individual factories

som.ingestExternalScene(containerName, externalDocument)  // Session 24
    // Copies nodes/meshes/materials from externalDocument into the world
    // document as children of the named container node. All ingested node
    // names are prefixed: containerName/originalName (recursive). Registers
    // wrappers in SOM caches, fires childList mutation on container.
    // External document's root extras are discarded. Returns SOMNode[].

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

Connection, protocol, SOM sync layer.

**Constructor:** `new AtriumClient({ debug: false, fetch: globalThis.fetch })`

The `fetch` parameter is injectable for testing. Called via
`this._fetch.call(globalThis, url)` to preserve browser API context.

**Properties:** `client.som`, `client.connected`, `client.displayName`,
`client.worldBaseUrl`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)               // fetch glTF from URL, init SOM — expects absolute URL
client.loadWorldFromData(data, name) // load from string (glTF JSON) or ArrayBuffer (GLB) — Session 23
client.setView({ position, look, move, velocity, up })
client.resolveExternalReferences()  // Session 24 — resolve extras.atrium.source nodes
```

**`worldBaseUrl` (Sessions 24, 26):** Base URL for resolving relative
paths in `extras.atrium.source`. Exposed as a public getter/setter
(Session 26). Set automatically by `loadWorld(url)` — strips the
filename to derive the directory:
```javascript
const lastSlash = url.lastIndexOf('/')
this._worldBaseUrl = lastSlash >= 0 ? url.substring(0, lastSlash + 1) : ''
```
Set to `null` by `loadWorldFromData()` (no URL context available). Can
also be set explicitly by the app layer via the setter — used in
connect-only flows where `loadWorld()` isn't called.

**Browser decoupling (Session 26):** `loadWorld()` no longer calls
`new URL(url, window.location.href)` — it expects an already-absolute
URL from the caller. The app layer (`apps/client`, SOM Inspector) is
responsible for absolutizing relative URLs before calling `loadWorld()`.
This keeps `packages/client` free of `window`/`document` references,
preserving headless portability.

**Events:**
```javascript
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})
client.on('session:ready', ({ sessionId, displayName }) => {})
client.on('world:loaded', ({ name, description, author }) => {})
client.on('world:loaded', ({ name, description, author, source, containerName }) => {})  // external ref
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

**`world:loaded` event shapes (Session 24):** `world:loaded` fires once
for the base world (same as pre-Session 24), then once per successfully
resolved external reference. When `source` and `containerName` are
present, it's an external reference. When absent, it's the base world.
The base world fires first; external references fire after, in parallel
completion order. Listeners that don't care about the distinction ignore
the extra fields. This follows the same convention as `som:set` using
`nodeName: '__document__'` to distinguish mutation types.

**Scene events for UI consumers:** `som:add`, `som:remove`, and `som:set`
are the primary events for building UI on top of AtriumClient. `som:set`
only fires for remote mutations (loopback already filtered), so UI code
that writes to SOM setters will not trigger its own refresh. The SOM
Inspector (Session 19) uses only these three events to drive its entire
tree view and property sheet — no polling, no per-object listeners.

**Document extras sync (Session 22):** `som:set` with
`nodeName: '__document__'` indicates a document-root extras mutation.
AtriumClient listens for mutation events on the `SOMDocument` itself
(not just individual nodes) and sends `set` messages with
`name: '__document__'`. Inbound `__document__` set messages apply
`som.extras = value` under the `_applyingRemote` loopback guard.

**Automatic SOM → Server sync:** Mutation listeners on all SOM nodes
(and on `SOMDocument` for extras) forward local changes to the server.
Loopback prevention via session ID check (own echo) and
`_applyingRemote` flag (inbound re-broadcast).

**`setView` send policy:** Position heartbeat at `positionInterval` ms,
look/move/up/velocity event-driven on change, overall rate capped at
`maxViewRate` msg/s. Values from `NavigationInfo.updateRate`.

**`loadWorldFromData(data, name)` (Session 23):** Accepts already-read
data — a string for `.gltf` JSON or an ArrayBuffer for `.glb`. Internally
shares the same SOM initialization path as `loadWorld`. The `name`
parameter is for logging/display only. Used by the drag-and-drop feature
in both apps.

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
`tools/som-inspector/src/app.js`. Both apps extract a `loadBackground()`
helper function (Session 22) for reuse in hot-reload scenarios.

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

### URL absolutization (Session 26)

The app layer absolutizes all URLs before passing them to AtriumClient:

- **Load button:** `new URL(url, window.location.href).href` before
  calling `client.loadWorld(absoluteUrl)`
- **Connect button:** if the world URL bar has a value, absolutizes it
  and sets `client.worldBaseUrl` before connecting — enables external
  reference resolution in connect-only flows
- **`.atrium.json` loading:** already absolutized via
  `new URL(config.world.gltf, configBaseUrl).href` (unchanged from
  Session 23)
- **Disconnect handler reload:** absolutizes before `loadWorld()`

### Drag-and-drop (Session 23)

Drop a `.gltf`, `.glb`, or `.atrium.json` file onto the viewport to load
it. Equivalent to the URL bar Load button for local files. Visual drop
indicator (dashed border) appears during drag.

- `.gltf` / `.glb` → loaded via `client.loadWorldFromData()`
- `.atrium.json` → parsed; if glTF path is absolute, loads the world and
  populates the server field; if relative (local drop), shows guidance
  to drop the `.gltf` directly and populates the server field only

### `.atrium.json` loading (Session 23)

Entering an `.atrium.json` URL in the URL bar and clicking Load fetches
the config, resolves the `.gltf` path relative to the config URL, loads
the world, and populates the server/Connect field. Does **not**
auto-connect — populate only.

### Keyboard focus scoping (Session 22)

Keyboard hotkeys (M, V, WASD) only fire when the 3D viewport canvas has
focus. The canvas has `tabindex="0"` and focuses on `pointerdown`. Clicking
input fields (URL bar, etc.) moves focus away from the canvas, preventing
hotkey interference while typing. Same pattern in both `apps/client` and
the SOM Inspector.

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

### Background hot-reload (Session 22)

`apps/client` extracts a `loadBackground(bg, baseUrl)` helper and calls
it on `world:loaded` and on inbound `__document__` extras changes via
the `som:set` handler. Remote background edits update the skybox live.

### Disconnect behavior

On disconnect, app reloads the world via `client.loadWorld(url)`. This
creates a fresh SOM (no avatars), DocumentView re-renders the clean scene,
AvatarController creates a bare static-mode node. User returns to static
browsing seamlessly. The reload URL is absolutized before calling
`loadWorld()` (Session 26).

### Console access

```javascript
window.atriumClient          // the AtriumClient instance
window.atriumClient.som      // the live SOMDocument
```

---

## SOM Inspector (`tools/som-inspector/`) — Sessions 19, 22–26

Developer tool for viewing and editing the live SOM. Uses the full client
stack (AtriumClient, AvatarController, NavigationController) with an
inspection-focused UI.

### Architecture

AtriumClient events drive all UI updates — no polling, no per-object
mutation listeners:

| Event | Handler |
|---|---|
| `world:loaded` | Init DocumentView, build tree, clear property sheet, show WorldInfoPanel |
| `som:add` | Rebuild tree |
| `som:remove` | Rebuild tree; clear property sheet if selected node was removed |
| `som:set` (node) | Refresh property sheet if `nodeName` matches selected node |
| `som:set` (`__document__`) | Refresh WorldInfoPanel, hot-reload background (Session 22) |

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [URL bar: .gltf or .atrium.json]  [Load]  ● [Connect]      │
│                                              [Orbit ▾]       │
├────────────────────┬─────────────────────────────────────────┤
│                    │                                         │
│  ▸ World Info      │          3D Viewport                    │
│                    │       (ORBIT default)                   │
├────────────────────┤                                         │
│                    │                                         │
│   Scene graph      │                                         │
│   tree view        │                                         │
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

### URL absolutization (Session 26)

Same pattern as `apps/client` — absolutizes before `loadWorld()`, sets
`client.worldBaseUrl` on connect, absolutizes on disconnect reload.

### Drag-and-drop (Session 23)

Same behavior as `apps/client` — drop `.gltf`, `.glb`, or `.atrium.json`
onto the viewport.

### WorldInfoPanel (Session 22)

Collapsible panel above the tree view displaying all `extras.atrium`
fields from the document root. Collapsed by default.

**Sections:**

- **Identity:** Name, Description, Author (text inputs)
- **Background:** Type (dropdown: equirectangular/cubemap), Texture (text input)
- **Navigation:** Modes (read-only comma list), Speed default/min/max (number inputs), Terrain Following (checkbox), Collision Enabled (checkbox), Position Interval (number), Max View Rate (number)

**Behavior:**
- Click header to expand/collapse. Collapsed by default.
- `show(som)` populates form from SOM, does not auto-expand.
- `refresh()` re-reads SOM values into existing inputs via updater closures
  (same pattern as PropertySheet — no DOM rebuild, no focus loss).
- `clear()` empties content, collapses.
- Each editable input calls `som.setExtrasAtrium(path, value)` on `change`.
- Number inputs reject `NaN` and revert to previous value.
- Navigation `mode` array is read-only (array editing UI deferred).
- Background field edits additionally call `onBackgroundChange(bg)` callback,
  which triggers `loadBackground()` for live skybox hot-reload.

**Constructor:** `new WorldInfoPanel(containerEl, { onBackgroundChange })`

### Background hot-reload (Session 22)

Skybox loading logic extracted into `loadBackground(bg, baseUrl)` in
`app.js`. Called from:
- `world:loaded` handler (initial load)
- `onBackgroundChange` callback (local WorldInfoPanel edits)
- `som:set` handler for `__document__` mutations (remote edits)

Clearing the texture field (empty string) sets `scene.background = null`
and `scene.environment = null`.

### Property sheet sections

**Node:** translation (vec3), rotation (vec4), scale (vec3), visible (checkbox).

**External Reference** (when `node.extras?.atrium?.source` is present):
source URL (read-only). Shown after Node section, before Material.
(Session 25)

**Material** (when `node.mesh?.primitives?.[0]?.material` is non-null):
base color (color picker + alpha), metallic factor (number + slider),
roughness factor (number + slider), emissive factor (vec3), alpha mode
(dropdown), alpha cutoff (conditional on MASK), double sided (checkbox).

**Camera** (when `node.camera` is non-null): type dropdown, Y-FOV
(number + slider), Z-near, Z-far.

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
- **WorldInfoPanel** uses the same updater pattern as PropertySheet.
- **Live cross-client editing.** Confirmed working: editing a peer's
  material properties from the inspector propagates to `apps/client`
  in real time via the full SOM → AtriumClient → server → broadcast
  pipeline. Document-root extras edits also propagate cross-client
  (Session 22).

### Deferred inspector features

- Object highlighting / selection in viewport (wireframe overlay)
- Click-to-select in viewport (raycast → SOM node → tree selection)
- Focus orbit on selected node
- Navigation mode array editing UI
- Undo/redo
- Full scene editor capabilities (add/delete nodes)

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
    "server": "ws://localhost:3000",
    "baseUrl": "http://localhost:8080/tests/fixtures/"
  }
}
```

| Field | Consumed by | Purpose |
|-------|-------------|---------|
| `world.gltf` | Client (resolve relative to config URL), Server (resolve relative to config file directory) | Path to the glTF world file |
| `world.server` | Client (populate Connect field), Server (extract port) | WebSocket URL |
| `world.baseUrl` | Server only | HTTP URL prefix for server-side external reference resolution. Optional — if absent, server uses `pathToFileURL` for local filesystem resolution. Not sent to clients. |

**Client consumption (Session 23):** `apps/client` and the SOM Inspector
load `.atrium.json` via the URL bar. The glTF path is resolved relative
to the config file URL, absolutized, and passed to `loadWorld()`. The
server field populates the Connect input. Does not auto-connect.
Dropping an `.atrium.json` file also works — for absolute glTF URLs it
loads the world; for relative paths (local drop) it populates the server
field and shows guidance to drop the `.gltf` directly.

**Server consumption (Session 26):** If `WORLD_PATH` ends with `.json`,
the server reads it as `.atrium.json`:
- `world.gltf` resolved relative to the config file's directory →
  absolute filesystem path
- Port extracted from `world.server` via `new URL(wsUrl).port`. `PORT`
  env var takes precedence if set (standard convention).
- `world.baseUrl` (if present) used as the server's base URL for
  external reference resolution instead of the default `pathToFileURL`
  derivation

If `WORLD_PATH` ends with `.gltf` or `.glb`, behavior is unchanged from
pre-Session 26.

**Key distinction:** World metadata (name, description, author, navigation,
background) lives in `extras.atrium` inside the glTF. The `.atrium.json`
is purely operational config — where to find things, not what they are.

---

## External References (Designed Session 21, Implemented Sessions 24–25)

A mechanism for nodes in a world `.gltf` to reference external glTF
assets that are loaded and composed into the scene at runtime.

**Core rule:** An external reference must be a complete, valid glTF 2.0
file — its own `asset` block, scenes, nodes, meshes, materials,
accessors, buffers. Any glTF viewer can open it independently. Atrium
composes standard files; no fragment format.

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
- Both client and server resolve external references independently
  using `ingestExternalScene()` (Session 25)
- **Client:** `_worldBaseUrl` is set by `loadWorld(url)` (derived from
  the absolute URL passed by the app layer), or explicitly via the
  `worldBaseUrl` setter (Session 26). `null`'d by `loadWorldFromData`
  — external references in dropped files silently skip resolution.
- **Server:** Base URL derived from `world.baseUrl` in `.atrium.json`
  (if present), or from `pathToFileURL(resolve(gltfPath))` (default).
  Uses `fs.readFile` for `file://` URLs, `fetch` for `http(s)://`.

### Loading lifecycle

- Base `world:loaded` fires immediately on SOM init (unchanged from
  pre-Session 24 behavior)
- `resolveExternalReferences()` runs after the base `world:loaded`,
  walks SOM for `extras.atrium.source` nodes, fetches each referenced
  glTF in parallel, ingests into SOM via `ingestExternalScene()`
- Each successful reference fires another `world:loaded` with additional
  `source` and `containerName` fields (see AtriumClient events above)
- Per-reference errors are caught and warned — not fatal
- Late joiners (`som-dump`) also call `resolveExternalReferences()`
  independently

### Implementation notes (Session 24)

`SOMDocument.ingestExternalScene(containerName, externalDocument)` uses
a direct copy approach rather than glTF-Transform's `document.merge()`
(which delegates to `mergeDocuments()` from `@gltf-transform/functions`,
not installed). Iterates external nodes/meshes/primitives/materials and
creates equivalent objects in the world document. Accessor component
type is inferred from typed arrays (`setComponentType()` absent in
glTF-Transform 4.3.0).

The external document's root `extras` (including `extras.atrium`) are
discarded — only its scene graph is consumed.

**`_applyingRemote` guard:** `_loadExternalRef` wraps the
`ingestExternalScene()` call in `_applyingRemote = true` to suppress
outbound SOM → server sync during ingestion. Without this, the mutation
listeners on newly created nodes fire `set` messages for ingestion
events, causing protocol validation errors (missing `field`). The guard
is released after ingestion, so subsequent user-initiated edits to
externally-loaded nodes propagate normally.

**`fetch` context:** The injectable `fetch` is stored as `this._fetch`
and called via `this._fetch.call(globalThis, url)` to preserve browser
API context. Without `.call(globalThis, ...)`, calling `this._fetch(url)`
throws "Illegal invocation" because the browser's `fetch` requires
`window` as its `this` context.

**`_worldBaseUrl` resolution (Session 26):** `loadWorld(url)` derives
`_worldBaseUrl` by stripping the filename from the (already-absolute)
URL:
```javascript
const lastSlash = url.lastIndexOf('/')
this._worldBaseUrl = lastSlash >= 0 ? url.substring(0, lastSlash + 1) : ''
```
The app layer is responsible for absolutizing the URL before calling
`loadWorld()`. This replaced the previous `new URL(url, window.location.href)`
approach that coupled AtriumClient to the browser.

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

### Multiplayer implications (updated Session 25)

The server resolves external references into its own SOM at startup,
before accepting connections. This gives the server the full node graph
for validation and mutation state. Cross-client editing of externally-
loaded nodes works end-to-end: `set` messages targeting prefixed names
(e.g. `Crate/Crate`) validate against the server's SOM and broadcast
to all clients.

**`som-dump` filtering:** The server tracks which nodes were created by
`ingestExternalScene` in an `externalNodeNames` Set. When serializing
for `som-dump`, these nodes are excluded. Container nodes (with
`extras.atrium.source`) are included. Every client — early joiner and
late joiner — always resolves external references locally.

**Design rationale — why not server-authoritative distribution?**
We considered having the server distribute externally-loaded nodes via
`som-dump` (clients would skip local resolution on connect). This was
rejected for three reasons: (1) `som-dump` size — external models with
detailed geometry could add megabytes to the payload; (2) server
outbound coupling — the server would need HTTP access to arbitrary
asset domains in production; (3) clients still need resolution logic
for static browsing (principle #8), so server-authoritative adds a
second codepath without removing the first.

**Timing dependency:** If a client modifies a node inside an externally-
loaded model, the `set` message uses the prefixed name. Other clients
need to have resolved the same external reference to find that node.
Since all clients load the same world file, this should work — but
it's a timing dependency (see known issues).

### PropertySheet external reference display (Session 25)

The SOM Inspector PropertySheet shows a read-only "External Reference"
section when a container node (one with `extras.atrium.source`) is
selected. Displays the source URL. Positioned after the Node section,
before Material. Not shown on externally-loaded child nodes (they have
no `source` field). Collaborative editing of the source field is a
future feature.

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
| SOMDocument extras + `setExtrasAtrium` | ✅ Complete (Session 22) |
| AtriumClient — connection, protocol, SOM sync | ✅ Complete |
| AtriumClient — automatic SOM → server sync | ✅ Complete (Session 13) |
| AtriumClient — loopback prevention | ✅ Complete (Session 13) |
| AtriumClient — document extras sync (`__document__`) | ✅ Complete (Session 22) |
| AtriumClient — `loadWorldFromData` (string/ArrayBuffer) | ✅ Complete (Session 23) |
| AtriumClient — browser decoupling (`worldBaseUrl` setter) | ✅ Complete (Session 26) |
| Server — `__document__` set handling | ✅ Complete (Session 22) |
| Server — configurable `PORT` env var | ✅ Complete (Session 23) |
| Server — external reference resolution at startup | ✅ Complete (Session 25) |
| Server — `som-dump` filtering of external nodes | ✅ Complete (Session 25) |
| Server — `.atrium.json` consumption | ✅ Complete (Session 26) |
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
| `apps/client` — background hot-reload | ✅ Complete (Session 22) |
| `apps/client` — drag-and-drop glTF/config loading | ✅ Complete (Session 23) |
| `apps/client` — `.atrium.json` URL bar loading | ✅ Complete (Session 23) |
| `apps/client` — URL absolutization (browser decoupling) | ✅ Complete (Session 26) |
| Keyboard focus scoping (canvas-only hotkeys) | ✅ Complete (Session 22) |
| SOM Inspector — tree view + property sheet + viewport | ✅ Complete (Session 19) |
| SOM Inspector — live cross-client editing | ✅ Confirmed working (Session 19) |
| SOM Inspector — WorldInfoPanel | ✅ Complete (Session 22) |
| SOM Inspector — background hot-reload | ✅ Complete (Session 22) |
| SOM Inspector — drag-and-drop glTF/config loading | ✅ Complete (Session 23) |
| SOM Inspector — `.atrium.json` URL bar loading | ✅ Complete (Session 23) |
| SOM Inspector — short display names for prefixed nodes | ✅ Complete (Session 24) |
| SOM Inspector — PropertySheet external reference section | ✅ Complete (Session 25) |
| SOM Inspector — URL absolutization (browser decoupling) | ✅ Complete (Session 26) |
| Atrium scene fixture (`tests/fixtures/atrium.gltf`) | ✅ Complete (Session 21) |
| External ref test fixtures (`space-ext.gltf`, `crate.gltf`, `lamp.gltf`) | ✅ Complete (Session 24) |
| Background loading (equirectangular skybox + IBL) | ✅ Complete (Session 21) |
| External references (`extras.atrium.source`) | ✅ Complete (Session 24) |
| `SOMDocument.ingestExternalScene()` | ✅ Complete (Session 24) |
| `AtriumClient.resolveExternalReferences()` | ✅ Complete (Session 24) |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

- **Load while connected** — Loading a new `.gltf` (via URL bar or
  drag-and-drop) while connected to a server does not disconnect. The
  client ends up with a local SOM that doesn't match the server's world,
  but SOM mutations still flow over the WebSocket. Should auto-disconnect
  (or prompt) before loading a different world. Deferred — will be
  addressed when we rationalize the Load/Connect lifecycle.

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

- **Remote background hot-reload gap in `apps/client`** — when a remote
  peer edits background fields via the inspector, the `som:set` handler
  in `apps/client` does not call `loadBackground()`. The SOM value
  updates correctly but the skybox doesn't visually change until the
  next world reload. The SOM Inspector handles this correctly for both
  local and remote edits. (Session 22)

- **External ref timing hazard** — if a `set` message arrives from the
  server targeting a prefixed node name before the local client has
  finished resolving that external reference, the target node won't
  exist. Logged as warning. (Session 24)

- **External ref late-joiner mutation gap** — the server's SOM holds
  mutated state for externally-loaded nodes (Session 25), but
  `som-dump` excludes them (clients resolve locally). Late joiners
  get original values from the source file, not mutations applied by
  earlier clients. Closing this requires either mutation replay or
  including external nodes in `som-dump` with client-side dedup.
  (Session 24, updated Session 25)

- **External refs in dropped files skip resolution** —
  `loadWorldFromData` sets `_worldBaseUrl = null`, so external
  references in a locally dropped `.gltf` cannot resolve relative
  paths. (Session 24)

- **Connect-only external refs require world URL** — if a user connects
  to a server without having a world URL in the URL bar, `worldBaseUrl`
  remains null and external references cannot resolve. This is expected:
  without knowing where the world is served, relative paths can't be
  resolved. The Load-then-Connect flow and the `.atrium.json` flow both
  work correctly. (Session 24, fixed for known-URL case in Session 26)

- **Server `.atrium.json` startup tests missing** — the server's
  `.atrium.json` parsing logic (Session 26) is covered by manual testing
  but lacks automated tests. Should add tests for: `.json` path loads
  correctly, `.gltf` path still works, `PORT` env overrides config port,
  missing `baseUrl` falls back to `pathToFileURL`. (Session 26)

---

## Backlog (Prioritized)

### Next: Real content + external reference stress testing
- Test external references with real glTF models from Sketchfab /
  KhronosGroup samples (confirm ingestion, rendering, multiplayer)
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
- Navigation mode array editing UI (multi-select or tag input)

### Architecture
- **External reference reconciliation** — after a client resolves
  external references locally, compare the set of resolved prefixes
  against an expected list from the server (sent in `hello` or
  `som-dump` metadata). Detect and warn on mismatches (fetch failures,
  CORS issues). Future hardening for production reliability. (Session 25)
- **Server `.atrium.json` startup tests** — automated tests for config
  file parsing, port extraction, `baseUrl` fallback behavior.
  (Session 26 gap)
- Persistence — periodic glTF snapshots, ephemeral node filtering,
  last-write-wins
- Permissions model design
- Design Session B — User Object Extensions (`ATRIUM_user_object`)

### UX polish
- **App-layer `world:loaded` for external refs** — `apps/client` and
  SOM Inspector `world:loaded` handlers need to react to external
  reference events (with `source`/`containerName`) to update DocumentView
  and rebuild the tree. Currently the Load-then-Connect flow works
  because DocumentView picks up nodes added before its initial build,
  but the tree and scene aren't updated for references that resolve
  after initial render. (Session 24 gap)
- Label height offset tuning
- ORBIT → WALK avatar placement polish
- Debug view spew fix (throttle or verbose flag)
- HDR background support (RGBELoader)
- `apps/client` remote background hot-reload fix
- Load/Connect lifecycle rationalization (auto-disconnect on Load,
  drag-and-drop inherits same fix)

### Deferred
- Nested external references (referenced file with its own `source` nodes)
- Dedicated `reference:error` event for failed external refs
- External ref resolution for dropped files (needs base URL strategy)
- Drag-and-drop "add to scene" behavior (application/mode-dependent)
- Drag-and-drop relative URL resolution for external buffers/textures
- `.atrium.json` auto-connect option (for retail client)
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
10. **`packages/client` is headless.** No `window`, `document`, or browser
    globals — portable across browser, Node.js, and bot clients. The app
    layer owns browser-specific concerns. (Session 26)

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

# start a world server (original space, glTF path)
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# start a world server (atrium scene, custom port)
cd packages/server
WORLD_PATH=../../tests/fixtures/atrium.gltf PORT=3001 node src/index.js

# start a world server (from .atrium.json config file — Session 26)
cd packages/server
WORLD_PATH=../../tests/fixtures/space-ext.atrium.json node src/index.js

# start a world server (.atrium.json with PORT env override)
cd packages/server
WORLD_PATH=../../tests/fixtures/atrium.atrium.json PORT=4000 node src/index.js

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
