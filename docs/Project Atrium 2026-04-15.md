# Project Atrium
## 2026-04-15 · As of Session 28

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
│   ├── client/          # AtriumClient, AvatarController, NavigationController,
│   │                    #   AnimationController
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── apps/
│   └── client/          # Browser UI shell — Three.js viewport, navigation, avatars
│       ├── index.html
│       └── src/
│           ├── app.js
│           └── LabelOverlay.js
├── tools/
│   ├── protocol-inspector/index.html   # Single-file interactive protocol debugger
│   └── som-inspector/                  # SOM Inspector (Sessions 19, 22–28)
│       ├── index.html
│       └── src/
│           ├── app.js
│           ├── TreeView.js
│           ├── PropertySheet.js
│           ├── WorldInfoPanel.js       # World metadata editor (Session 22)
│           └── AnimationsPanel.js      # Animation controls (Session 28)
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # Minimal world fixture (gray-box)
│   │   ├── space.atrium.json   # World manifest for space
│   │   ├── generate-space.js   # Geometry + fixture generator for space
│   │   ├── atrium.gltf         # Atrium scene fixture (Session 21)
│   │   ├── atrium.atrium.json  # World manifest for atrium
│   │   ├── generate-atrium.js  # Geometry + fixture generator for atrium
│   │   ├── space-anim.gltf     # Animated world fixture (Session 28)
│   │   ├── space-anim.atrium.json  # World manifest for space-anim
│   │   ├── generate-space-anim.js  # Fixture generator for animated world
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

## Test Counts (after Session 28)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 43 |
| `@atrium/som` | 103 |
| `@atrium/server` | 32 |
| `@atrium/client` | 65 |
| **Total** | **243** |

Run with `pnpm --filter <package> test`.

---

## Architecture — Three Layers

### Content layer
Standard glTF 2.0. A world is a `.gltf` file with Atrium metadata in
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
- The `node` field in `set` messages targets any named SOM object — nodes,
  animations, or `__document__` — resolved via `som.getObjectByName()`
  (Session 27)

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
| `SOMAnimation` | glTF-Transform `Animation` | `playback` (compound), `play()`, `pause()`, `stop()`, `tick()` (Session 27) |
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
listeners are present (`_hasListeners` check). Event detail is accessed
via `event.detail.property`, `event.detail.value`, etc. (`SOMEvent`
wraps the payload under `detail`.)

**Property change:**
```javascript
{ target: somObject, property: 'baseColorFactor', value: [1, 0, 0, 1] }
```

**Child list change:**
```javascript
{ target: somObject, childList: { addedNodes: ['nodeName'] } }
{ target: somObject, childList: { removedNodes: ['nodeName'] } }
```

### Global SOM Namespace (Session 27)

`SOMDocument` maintains a single flat `_objectsByName` Map — all named
SOM objects share one namespace, following the DOM `id` model.

```javascript
som.getObjectByName('Crate')       // → SOMNode
som.getObjectByName('WalkCycle')   // → SOMAnimation
som.getObjectByName('__document__') // → SOMDocument

som.getNodeByName('Crate')         // typed convenience — nodes only
som.getAnimationByName('WalkCycle') // typed convenience — animations only
```

**Name uniqueness:** Names must be unique across all types. If a glTF file
has a node and an animation with the same name, the node wins in
`_objectsByName` (nodes registered first during construction); the animation
is still accessible via `getAnimationByName`. A warning is logged.

**Registration:** `_registerObject(name, somObject)` handles collision
detection. Called during construction and by `createNode`, `ingestNode`,
`ingestExternalScene`, `createAnimation`. `_registerNodeDispose` unregisters.

**Protocol routing:** The server and AtriumClient both resolve `set` message
targets via `getObjectByName(msg.node)` — a single uniform path that handles
nodes, animations, and `__document__` without branching. The `__document__`
special case in `session.js` and `AtriumClient._onSet` was removed in
Session 27.

### SOMDocument extras (Session 22)

`SOMDocument` exposes document-root extras via getter/setter with
mutation events, following the same pattern as `SOMNode.extras`:

```javascript
som.extras                              // getter — returns root extras by reference
som.extras = { atrium: { ... } }        // setter — replaces, fires mutation event
som.setExtrasAtrium('background.texture', 'sky.png')  // convenience deep-set
```

### Wrapper caching, stable identity, and document threading (Session 20)

`SOMDocument` builds the full object graph at construction time, bottom-up.
All wrappers are cached in maps keyed by both glTF-Transform object and
by name. Build order: nodes first, then animations (Session 27).

```javascript
som.getNodeByName('x') === som.getNodeByName('x')   // true — stable identity
```

`getNodeByName` is O(1) via `_nodesByName` Map.

**Document reference threading:** Every wrapper that can return child
objects receives the parent `SOMDocument` as a constructor argument and
stores it as `this._document`. All accessors resolve through `SOMDocument`
resolve helpers to return the cached wrapper instance.

### Key SOM API

```javascript
som.getObjectByName(name)         // O(1) → any SOM type (Session 27)
som.getNodeByName(name)           // O(1) → SOMNode or null
som.getAnimationByName(name)      // O(1) → SOMAnimation or null (Session 27)
som.nodes                         // all SOMNode instances
som.animations                    // all SOMAnimation instances (Session 27)
som.meshes / .materials / etc.    // same for other types
som.scene                         // the first SOMScene

som.extras                        // document-root extras (Session 22)
som.setExtrasAtrium(path, value)  // deep-set into extras.atrium (Session 22)

som.ingestNode(descriptor)        // create node + full mesh geometry from glTF descriptor
som.createNode(descriptor)        // create bare node (no mesh)
som.createMesh / Material / etc.  // individual factories

som.ingestExternalScene(containerName, externalDocument)  // Session 24
som.setPath(somObj, path, value)  // works on any SOM type (Session 27)
som.getPath(somObj, path)

som.document                      // underlying glTF-Transform Document
```

---

## SOMAnimation (Session 27, implemented Session 27–28)

Wraps a glTF-Transform `Animation` with playback state management,
multiplayer sync, and local-only time events.

### Full API

```javascript
// Intrinsic (read-only, from glTF content)
anim.name             // string
anim.duration         // number (seconds) — max keyframe time across samplers
anim.channels         // object[] — { targetNode, targetProperty, samplerIndex }
anim.samplers         // object[] — { interpolation, inputCount, outputCount }

// Playback state (read-only convenience accessors into _playback)
anim.playing          // bool
anim.paused           // bool
anim.loop             // bool
anim.timeScale        // number
anim.startTime        // number (seconds)
anim.startWallClock   // number (ms) or null
anim.pauseTime        // number (seconds) or null

// Computed (read-only, derived live from wall clock)
anim.currentTime      // number (seconds) — never stored or sent on wire

// Mutable compound property (fires single mutation event)
anim.playback         // getter/setter — full playback state object

// Methods (write playback atomically — one mutation, one set message)
anim.play({ startTime, loop, timeScale })
anim.pause()
anim.stop()

// Local event driver (called by app frame loop via AnimationController)
anim.tick()           // fires 'timeupdate' if playing and listeners exist

// Events
'mutation'            // fired by playback setter — consumed by AtriumClient
'timeupdate'          // fired by tick() — local only, never on the wire
```

### Playback compound property

All playback state is stored as a single object. Writing to `playback`
fires one mutation event → one `set` message → atomic state transition.

```javascript
{
  playing: false,          // true after play(), false after stop()/pause()
  paused: false,           // true after pause(), false after play()/stop()
  loop: false,             // loop playback
  timeScale: 1.0,          // playback speed multiplier
  startTime: 0,            // animation-local time where playback began
  startWallClock: null,     // wall-clock timestamp (ms) when play() invoked
  pauseTime: null           // animation-local time where pause() froze
}
```

### Wire format

```json
{ "type": "set", "node": "WalkCycle", "field": "playback", "value": { ... }, "seq": 42 }
```

Uses the existing `node` field (not renamed). `getObjectByName` resolves it.

### glTF storage

Playback state persists in `extras.atrium.playback` on the glTF Animation
object. Round-trips through `som-dump` naturally — no special handling.

### Wall clock

Client-stamped (`Date.now()`) for v1. Server-stamped timing deferred for
future tighter sync requirements.

---

## Client Package (`packages/client`)

Four classes, zero Three.js or DOM dependency — portable across browser
UI, headless tests, and future bot clients.

### AtriumClient (`AtriumClient.js`)

Connection, protocol, SOM sync layer.

**Constructor:** `new AtriumClient({ debug: false, fetch: globalThis.fetch })`

**Properties:** `client.som`, `client.connected`, `client.displayName`,
`client.worldBaseUrl`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)               // expects absolute URL
client.loadWorldFromData(data, name) // string (glTF JSON) or ArrayBuffer (GLB)
client.setView({ position, look, move, velocity, up })
client.resolveExternalReferences()  // resolve extras.atrium.source nodes
```

**`worldBaseUrl` (Sessions 24, 26):** Base URL for resolving relative paths
in `extras.atrium.source`. Set automatically by `loadWorld(url)`, null'd by
`loadWorldFromData()`, can be set explicitly via setter.

**Browser decoupling (Session 26):** `loadWorld()` expects an already-absolute
URL from the caller. The app layer absolutizes before calling.

**Events:**
```javascript
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})
client.on('session:ready', ({ sessionId, displayName }) => {})
client.on('world:loaded', ({ name, description, author }) => {})
client.on('world:loaded', ({ name, description, author, source, containerName }) => {})
client.on('peer:join', ({ sessionId, displayName }) => {})
client.on('peer:leave', ({ sessionId, displayName }) => {})
client.on('peer:view', ({ displayName, position, look, move, velocity, up }) => {})
client.on('som:add', ({ nodeName }) => {})
client.on('som:remove', ({ nodeName }) => {})
client.on('som:set', ({ nodeName, path, value }) => {})
```

**`world:loaded` reads from `extras.atrium`** (fixed Session 28 — was
reading legacy `extras.atrium.world`). Reads `name`, `description`,
`author` from `extras.atrium` directly.

**Uniform `_onSet` routing (Session 27):** Uses `som.getObjectByName(msg.node)`
for all inbound `set` messages — nodes, animations, `__document__`. No
special-case branching.

**Animation mutation listeners (Session 27):** `_attachAnimationListeners`
listens for `mutation` events on each `SOMAnimation`. Only broadcasts
`property === 'playback'` mutations. `timeupdate` is local-only and never
sent.

### AvatarController (`AvatarController.js`) — Session 16

Manages local and peer avatar lifecycle in the SOM.

- On `world:loaded`: creates local avatar node from descriptor
- On `peer:join`: creates peer node, assigns random color
- On `peer:leave`: removes from peer map
- Peer discriminator: `extras.displayName` field
- Delta-based view optimization: `setView()` skips when nothing changed

**Events:** `avatar:local-ready`, `avatar:peer-added`, `avatar:peer-removed`

### NavigationController (`NavigationController.js`) — Sessions 16, 18

Translates user input into SOM node mutations. No Three.js or DOM dependency.

**WALK mode:** WASD on XZ plane, yaw/pitch quaternion split.
**ORBIT mode:** Spherical camera, drag orbits, scroll zooms, WASD disabled.
**FLY mode:** Stub — falls back to WALK.

### AnimationController (`AnimationController.js`) — Sessions 27–28

Manages SOM-level animation lifecycle. Headless, no Three.js dependency.

**Constructor:** `new AnimationController(client)`

**Lifecycle:**
- On `world:loaded`: tears down previous tracking, scans `som.animations`,
  sets up mutation listeners, emits `animation:play` for any with
  `playing: true` (late-joiner path)
- On `som:add`: checks for new animation, tracks it, emits `animation:added`
- On `som:remove`: tears down listener, emits `animation:removed`
- Mutation listener: on `playback` change → emits semantic event

**`tick(dt)`:** Iterates `_playing` Set, calls `anim.tick()` on each.
Only playing animations — O(playing) not O(all).

**Events:**
```javascript
animController.on('animation:play',    ({ animation }) => {})
animController.on('animation:pause',   ({ animation }) => {})
animController.on('animation:stop',    ({ animation }) => {})
animController.on('animation:added',   ({ animation }) => {})
animController.on('animation:removed', ({ animation }) => {})
```

**World reload teardown (Session 28 Fix 2):** `_onWorldLoaded` clears
`_tracked` and `_playing`, removes all mutation listeners before
re-scanning. Prevents listener accumulation on disconnect/reload.

---

## Avatar System

### Core design

**Avatar nodes are regular SOM nodes** — ephemeral per session.
`extras.atrium.ephemeral = true` stamped by AtriumClient. Session
identity = avatar node identity: `displayName = User-${sessionId.slice(0,4)}`

**Geometry ownership:** Apps build avatar geometry and pass it as a
descriptor to `client.connect()`. AtriumClient stamps the name.

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
| `look` | `[x,y,z]` | Yes | Forward unit vector (yaw only) |
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

**Schema is flat** — `name`, `description`, `author`, `navigation`,
`background` all live directly under `extras.atrium`. There is no
`world` nesting level. (Legacy `extras.atrium.world` schema was
removed in Session 28.)

### `background` (Session 21)

| Field | Type | Description |
|-------|------|-------------|
| `texture` | string | Path to image, resolved relative to `.gltf` URL |
| `type` | string | `"equirectangular"` or `"cubemap"` (only equirect implemented) |

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
    "@atrium/client/NavigationController": "../../packages/client/src/NavigationController.js",
    "@atrium/client/AnimationController":  "../../packages/client/src/AnimationController.js"
  }
}
```

### Animation integration (Session 28)

`apps/client` builds Three.js `AnimationClip` objects manually from the
glTF-Transform document because `@gltf-transform/view` does not produce
clips. `buildClipsFromSOM(somDocument)` iterates animations, builds
`KeyframeTrack` objects from raw accessor arrays.

**Key finding:** `DocumentView` sets `Object3D.name = glTFNode.getName()`,
so Three.js track name resolution (`"nodeName.quaternion"`) works by bare
node name without path prefixes.

```javascript
const animCtrl = new AnimationController(client)

// Frame loop
animCtrl.tick(dt)
if (mixer) mixer.update(dt)

// Events
animCtrl.on('animation:play', ({ animation }) => { /* clipAction + seek */ })
animCtrl.on('animation:pause', ({ animation }) => { /* action.paused */ })
animCtrl.on('animation:stop', ({ animation }) => { /* action.stop() */ })
```

`AnimationController` is constructed once at startup. `AnimationMixer` is
rebuilt on each `world:loaded` (bound to `sceneGroup`).

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

---

## SOM Inspector (`tools/som-inspector/`) — Sessions 19, 22–28

Developer tool for viewing and editing the live SOM. Uses the full client
stack with an inspection-focused UI.

### Architecture

AtriumClient events drive all UI updates — no polling:

| Event | Handler |
|---|---|
| `world:loaded` | Init DocumentView, build tree, clear property sheet, show WorldInfoPanel, init animations |
| `som:add` | Rebuild tree |
| `som:remove` | Rebuild tree; clear property sheet if selected node removed |
| `som:set` (node) | Refresh property sheet if `nodeName` matches selected |
| `som:set` (`__document__`) | Refresh WorldInfoPanel, hot-reload background |

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
│                    │                                         │
├────────────────────┤                                         │
│                    │                                         │
│  Property sheet    │                                         │
│                    │                                         │
├────────────────────┤                                         │
│                    │                                         │
│  Animations        │                                         │
│  CrateRotate 4.00s │                                         │
│  [▶] [⏸] [⏹]      │                                         │
│                    │                                         │
└────────────────────┴─────────────────────────────────────────┘
```

### AnimationsPanel (Session 28)

Displays all world animations in the left sidebar. One row per animation:
name, duration, live current time display, Play/Pause/Stop buttons.

- Button states update via direct mutation listeners on each `SOMAnimation`
- `timeupdate` event drives the live time display
- `show()` attaches listeners, `clear()` removes them
- Inspector Play defaults to `loop: true`

### WorldInfoPanel (Session 22)

Collapsible panel. Sections: Identity (name, description, author),
Background (type, texture), Navigation (modes, speed, terrain, collision,
update rate). Editable inputs call `som.setExtrasAtrium(path, value)`.

---

## `.atrium.json` Config Files

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

**Client consumption:** URL bar or drag-and-drop. Resolves glTF path
relative to config URL, populates server field, does not auto-connect.

**Server consumption (Session 26):** `WORLD_PATH=*.json` reads config.
Port extracted from `world.server` (`PORT` env overrides). `world.baseUrl`
used for external ref resolution if present.

---

## External References (Sessions 24–25)

Nodes with `extras.atrium.source` reference external glTF files:

```json
{ "name": "Chair", "extras": { "atrium": { "source": "models/chair.glb" } } }
```

- Both client and server resolve independently
- `ingestExternalScene(containerName, externalDocument)` copies nodes/meshes/materials
- Prefixed naming: `Chair/Body`, `Chair/Seat`
- Server filters external nodes from `som-dump`
- **Animations in external refs not yet supported** (Phase 6, deferred)

---

## Atrium Scene (`tests/fixtures/atrium.gltf`) — Session 21

Procedurally generated circular gathering space. 56 nodes, 43 meshes,
9 PBR materials. Self-contained glTF. Equirectangular skybox.

---

## Animated Scene (`tests/fixtures/space-anim.gltf`) — Session 28

Fork of `space.gltf` with two loopable animations:

- **CrateRotate** — Y-axis full rotation, 4 seconds, 5 quaternion keyframes
- **CrateBob** — Y-axis translation oscillation, 2 seconds, 5 VEC3 keyframes

Both seamlessly loopable. No `extras.atrium.playback` authored (start stopped).

---

## What's Been Built (Status)

| Layer | Status |
|---|---|
| Protocol schemas (`@atrium/protocol`) | ✅ Complete |
| Server session lifecycle | ✅ Complete |
| World state — glTF-Transform + send/set/add/remove | ✅ Complete |
| Presence — join/leave | ✅ Complete |
| SOM — Scene Object Model (`@atrium/som`) | ✅ Complete |
| SOM mutation events + SOMObject base class | ✅ Complete |
| SOM wrapper caching + stable identity | ✅ Complete |
| SOM document threading + resolve helpers | ✅ Complete |
| SOMDocument extras + `setExtrasAtrium` | ✅ Complete (Session 22) |
| SOMAnimation — full playback state machine | ✅ Complete (Session 27) |
| Global SOM namespace (`_objectsByName`) | ✅ Complete (Session 27) |
| AtriumClient — connection, protocol, SOM sync | ✅ Complete |
| AtriumClient — automatic SOM → server sync | ✅ Complete |
| AtriumClient — loopback prevention | ✅ Complete |
| AtriumClient — document extras sync (`__document__`) | ✅ Complete (Session 22) |
| AtriumClient — animation mutation listeners | ✅ Complete (Session 27) |
| AtriumClient — uniform `getObjectByName` routing | ✅ Complete (Session 27) |
| AtriumClient — `loadWorldFromData` (string/ArrayBuffer) | ✅ Complete (Session 23) |
| AtriumClient — browser decoupling (`worldBaseUrl` setter) | ✅ Complete (Session 26) |
| AtriumClient — `extras.atrium` schema fix | ✅ Complete (Session 28) |
| Server — `__document__` set handling (unified) | ✅ Complete (Session 27) |
| Server — configurable `PORT` env var | ✅ Complete (Session 23) |
| Server — external reference resolution at startup | ✅ Complete (Session 25) |
| Server — `som-dump` filtering of external nodes | ✅ Complete (Session 25) |
| Server — `.atrium.json` consumption | ✅ Complete (Session 26) |
| Server — `extras.atrium` schema fix | ✅ Complete (Session 28) |
| AnimationController — lifecycle + semantic events | ✅ Complete (Session 27) |
| AnimationController — world reload teardown | ✅ Complete (Session 28) |
| AvatarController — local + peer avatar lifecycle | ✅ Complete |
| NavigationController — WALK + ORBIT modes | ✅ Complete |
| `apps/client` — Three.js animation integration | ✅ Complete (Session 28) |
| `apps/client` — full UI (HUD, nav, labels, modes) | ✅ Complete |
| `apps/client` — drag-and-drop + `.atrium.json` loading | ✅ Complete (Session 23) |
| `apps/client` — background hot-reload | ✅ Complete (Session 22) |
| `apps/client` — URL absolutization | ✅ Complete (Session 26) |
| SOM Inspector — tree + property sheet + viewport | ✅ Complete |
| SOM Inspector — WorldInfoPanel | ✅ Complete (Session 22) |
| SOM Inspector — AnimationsPanel | ✅ Complete (Session 28) |
| SOM Inspector — animation renderer integration | ✅ Complete (Session 28) |
| SOM Inspector — live cross-client editing | ✅ Confirmed working |
| Test fixtures — space, atrium, space-ext, space-anim | ✅ Complete |
| External references (`extras.atrium.source`) | ✅ Complete (Session 24) |
| External ref animations | 🔜 Phase 6 (deferred) |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

- **Late-joiner animation renderer does not start playback** — SOM state
  is correct (Inspector shows rotation updating), but the Three.js
  `AnimationMixer` in `apps/client` does not start playing. Likely a
  startup ordering issue: `AnimationController._onWorldLoaded` emits
  `animation:play` before `initAnimations()` has built the clips and
  mixer. The SOM layer works — the problem is purely renderer timing.
  Related to the broader late-joiner sync class of issues. (Session 28)

- **External ref late-joiner mutation gap** — `som-dump` excludes
  externally-loaded nodes. Late joiners get original values from the
  source file, not mutations applied by earlier clients. (Session 24)

- **External refs in dropped files skip resolution** —
  `loadWorldFromData` sets `_worldBaseUrl = null`. (Session 24)

- **Load while connected** — Loading a new `.gltf` while connected does
  not disconnect. SOM mismatch. (Known, deferred)

- **Label height offset** — peer labels may float too high. (Deferred)

- **ORBIT → WALK avatar placement** — avatar at orbit camera position,
  may float. (Deferred)

- **Known flaky test** — "handles client disconnect cleanly" race
  condition. (Pre-existing)

- **Debug view spew** — `_debug = true` floods console. (Deferred)

- **Camera child node in `som-dump`** — may appear for late joiners.
  (Deferred)

- **No permissions model** — any client can mutate any node. (Deferred)

- **`apps/client` remote background hot-reload** — peer background edits
  update SOM but don't call `loadBackground()`. (Session 22)

- **External ref timing hazard** — `set` for prefixed node before local
  client has resolved that reference. (Session 24)

- **Server `.atrium.json` startup tests missing** — manual testing only.
  (Session 26 gap)

---

## Backlog (Prioritized)

### Next: Late-joiner sync fixes
- Fix animation renderer startup ordering (Session 28 bug)
- Address external ref late-joiner mutation gap
- General late-joiner reconciliation design pass

### Real content + external reference stress testing
- Test external references with real glTF models
- Replace capsule avatars with static glTF character models
- Source free glTF assets and stress-test the pipeline

### Navigation
- **FLY mode** — remove Y constraint, include pitch in movement vector
- **Terrain following for WALK** — raycast ground callback
- **Gravity** — downward velocity when not on ground

### Inspector interaction
- Object highlighting in viewport (wireframe overlay)
- Click-to-select in viewport (raycast → SOM → tree)
- Focus orbit on selected node
- Select-and-drag to move
- Navigation mode array editing UI

### Architecture
- **External reference animations** (Phase 6) — `ingestExternalScene`
  copies animations, prefix naming, registration
- **External reference reconciliation** — prefix mismatch detection
- **Server `.atrium.json` startup tests**
- Persistence — periodic glTF snapshots
- Permissions model design
- Design Session B — User Object Extensions (`ATRIUM_user_object`)

### UX polish
- App-layer `world:loaded` for external refs
- Label height offset tuning
- ORBIT → WALK avatar placement
- Debug view spew fix
- HDR background support
- `apps/client` remote background hot-reload fix
- Load/Connect lifecycle rationalization

### Deferred
- Nested external references
- Dedicated `reference:error` event
- External ref resolution for dropped files
- Drag-and-drop "add to scene" behavior
- `.atrium.json` auto-connect option
- `ATRIUM_world` glTF extension formalization
- Dead reckoning
- Collision / physics
- Viewpoints
- `@atrium/som` npm publish
- AtriumRenderer abstraction
- README / TESTING.md updates
- Animation blend weights / blending
- Animation grouping / playlists
- Authored auto-play behavior

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
    globals — portable across browser, Node.js, and bot clients.

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

# start a world server (space, glTF path)
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# start a world server (atrium scene, custom port)
cd packages/server
WORLD_PATH=../../tests/fixtures/atrium.gltf PORT=3001 node src/index.js

# start a world server (animated space)
cd packages/server
WORLD_PATH=../../tests/fixtures/space-anim.gltf node src/index.js

# start a world server (from .atrium.json config file)
cd packages/server
WORLD_PATH=../../tests/fixtures/space-ext.atrium.json node src/index.js

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

---

## Key Reference Documents

- `Atrium_Animation_Design_Spec.md` — full animation spec (Session 27)
- `SESSION-27-Animation-log.md` — animation build log
- `SESSION-28-more-animation-log.md` — renderer integration build log
- `SESSION-Fix-Space-Extras-Schema-log.md` — extras schema fix log
