# Project Atrium
## 2026-04-17 · As of Session 31

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
│   └── som-inspector/                  # SOM Inspector (Sessions 19, 22–28, 29)
│       ├── index.html
│       └── src/
│           ├── app.js
│           ├── TreeView.js
│           ├── PropertySheet.js
│           ├── WorldInfoPanel.js       # World metadata editor (Session 22)
│           └── AnimationsPanel.js      # Animation controls + expandable rows (Sessions 28, 29)
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # Minimal world fixture (gray-box)
│   │   ├── space.atrium.json
│   │   ├── generate-space.js
│   │   ├── atrium.gltf         # Atrium scene fixture (Session 21)
│   │   ├── atrium.atrium.json
│   │   ├── generate-atrium.js
│   │   ├── space-anim.gltf     # Animated world fixture (Session 28)
│   │   ├── space-anim.atrium.json
│   │   ├── generate-space-anim.js
│   │   ├── generate-space-anim-base.js      # Shared builder (Session 29)
│   │   ├── space-anim-autoplay.gltf         # Autoplay fixture (Session 29)
│   │   ├── space-anim-autoplay.atrium.json
│   │   ├── generate-space-anim-autoplay.js
│   │   ├── crate.gltf          # Standalone crate (external ref test, Session 24)
│   │   ├── lamp.gltf           # Standalone lamp (external ref test, Session 24)
│   │   ├── space-ext.gltf      # External references world (Session 24)
│   │   ├── space-ext.atrium.json            # (+ baseUrl, Session 26)
│   │   ├── generate-space-ext.js
│   │   └── skyboxtest1.png     # Equirectangular sky texture (3072×1536)
│   └── client/
│       ├── index.html          # Legacy test client (protocol scratch pad)
│       └── som/                # Manual source copy of packages/som/src/
├── docs/
│   └── sessions/        # Design briefs + session logs
└── ...
```

---

## Test Counts (after Session 31)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 46 |
| `@atrium/som` | 109 |
| `@atrium/server` | 32 (31 passing, 1 pre-existing flake) |
| `@atrium/client` | 78 |
| **Total** | **265** |

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
| `SOMAnimation` | glTF-Transform `Animation` | `playback` (compound, includes `autoStart`), `play()`, `pause()`, `stop()`, `tick()` |
| `SOMTexture` | glTF-Transform `Texture` | (read-only in v0.1) |
| `SOMSkin` | glTF-Transform `Skin` | (read-only in v0.1) |

### SOMObject base class

DOM-style event listener API:

```javascript
addEventListener(type, callback)
removeEventListener(type, callback)
_hasListeners(type)      // zero-cost check before allocating events
_dispatchEvent(event)
```

### Mutation events

Every setter on every SOM type fires a `mutation` event after updating
the underlying glTF-Transform object. Only allocates a `SOMEvent` if
listeners are present. Event detail is accessed via `event.detail`.

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

**Name uniqueness:** Names must be unique across all types. If collision,
node wins in `_objectsByName` (registered first); animation still accessible
via `getAnimationByName`. Warning logged.

**Protocol routing:** Server and AtriumClient both resolve `set` message
targets via `getObjectByName(msg.node)` — a single uniform path.

### SOMDocument extras (Session 22)

```javascript
som.extras                              // getter
som.extras = { atrium: { ... } }        // setter — fires mutation event
som.setExtrasAtrium('background.texture', 'sky.png')  // convenience deep-set
```

### Wrapper caching, stable identity (Session 20)

`SOMDocument` builds the full object graph at construction time, bottom-up.
All wrappers cached in maps keyed by both glTF-Transform object and name.
Build order: nodes first, then animations.

```javascript
som.getNodeByName('x') === som.getNodeByName('x')   // true
```

`getNodeByName` is O(1) via `_nodesByName` Map.

Every wrapper receives parent `SOMDocument` as constructor argument
(`this._document`). Accessors resolve through `SOMDocument` resolve helpers.

### Key SOM API

```javascript
som.getObjectByName(name)         // O(1) → any SOM type
som.getNodeByName(name)           // O(1) → SOMNode or null
som.getAnimationByName(name)      // O(1) → SOMAnimation or null
som.nodes / .animations / .meshes / .materials / ...
som.scene                         // the first SOMScene

som.extras                        // document-root extras
som.setExtrasAtrium(path, value)

som.ingestNode(descriptor)        // create node + full mesh geometry
som.createNode(descriptor)        // create bare node
som.createMesh / Material / ...   // individual factories

som.ingestExternalScene(containerName, externalDocument)  // Session 24
som.setPath(somObj, path, value)  // works on any SOM type
som.getPath(somObj, path)

som.document                      // underlying glTF-Transform Document
```

---

## SOMAnimation (Sessions 27–29)

Wraps a glTF-Transform `Animation` with playback state, multiplayer
sync, and local-only time events.

### Full API

```javascript
// Intrinsic (read-only)
anim.name             // string
anim.duration         // number (seconds)
anim.channels         // object[]
anim.samplers         // object[]

// Playback state (read-only accessors)
anim.playing          // bool
anim.paused           // bool
anim.loop             // bool
anim.autoStart        // bool — authoring hint (Session 29)
anim.timeScale        // number
anim.startTime        // number (seconds)
anim.startWallClock   // number (ms) or null
anim.pauseTime        // number (seconds) or null

// Computed (read-only, derived live from wall clock)
anim.currentTime      // number (seconds) — never stored or sent on wire

// Mutable compound property (fires single mutation event)
anim.playback         // getter/setter — full playback state object

// Methods
anim.play({ startTime, loop, timeScale })  // autoStart preserved
anim.pause()                                 // autoStart preserved
anim.stop()                                  // autoStart preserved

// Local event driver
anim.tick()           // fires 'timeupdate' if playing and listeners exist

// Events
'mutation'            // fired by playback setter — consumed by AtriumClient
'timeupdate'          // fired by tick() — local only, never on the wire
```

### Playback compound property

All playback state stored as a single object. Writing to `playback`
fires one mutation event → one `set` message → atomic state transition.

```javascript
{
  playing: false,          // true after play(), false after stop()/pause()
  paused: false,           // true after pause()
  loop: false,             // loop playback
  autoStart: false,        // authoring hint — consumed on world:loaded (Session 29)
  timeScale: 1.0,          // playback speed multiplier
  startTime: 0,            // animation-local time where playback began
  startWallClock: null,    // wall-clock timestamp (ms) when play() invoked
  pauseTime: null          // animation-local time where pause() froze
}
```

**`autoStart` is authoring, not runtime.** `play()`, `pause()`, `stop()`
all preserve `autoStart`. It's consumed once by `AnimationController` on
`world:loaded`; after that the live playback state takes over. The rest
of the fields are runtime state.

### Wire format

```json
{ "type": "set", "node": "WalkCycle", "field": "playback", "value": { ... }, "seq": 42 }
```

### glTF storage

Playback state persists in `extras.atrium.playback` on the glTF Animation
object. Round-trips through `som-dump` naturally. `autoStart` serializes
alongside the other fields.

### Wall clock

Client-stamped (`Date.now()`). Server-stamped timing deferred.

---

## Animation Startup Lifecycle (Sessions 27–31)

This is the most intricate runtime flow in the system. Understanding it
is critical before modifying anything in the animation path. The arc
landed over four sessions; here's the settled picture.

### Participants

- **SOM** — source of truth for animation state. `playing` is the
  authoritative runtime flag.
- **AnimationController** (`packages/client`) — headless; tracks animations,
  emits semantic events, runs the `tick()` loop. Does not know about Three.js.
- **App-layer renderer** (`apps/client/src/app.js` and the Inspector's
  `tools/som-inspector/src/app.js`) — builds Three.js mixer and clips, reacts
  to AnimationController events.

### Events

AnimationController emits:
- `animation:play` / `animation:pause` / `animation:stop` — state transitions
- `animation:playback-changed` — non-transition mutations (loop, timeScale edits)
- `animation:added` / `animation:removed` — lifecycle

### `_onWorldLoaded` behavior

```
tear down previous tracking
peerCount = client.peerCount
for each anim in som.animations:
  track + attach mutation listener
  if anim.playing:
    emit animation:play        (late-joiner path — SOM already says playing)
  else if anim.playback.autoStart && peerCount === 0:
    anim.play({ loop, timeScale })   (autoStart path — empty room)
```

`autoStart` is the world's preference when nobody is around to have an
opinion. If peers are present, respect whatever the current playback
state is — they may have stopped it deliberately.

### Renderer reconciliation (`replayPlayingAnimations`)

Because AnimationController and the renderer both subscribe to
`world:loaded` and handler order is not guaranteed, the renderer cannot
assume `animation:play` events arrive after it's built its mixer. To
solve this, after `initAnimations()` completes the renderer runs
`replayPlayingAnimations(som)`:

```javascript
for each anim in som.animations:
  if !anim.playing: continue
  const clip = clipMap.get(anim.name)
  const action = mixer.clipAction(clip)
  action.loop = pb.loop ? LoopRepeat : LoopOnce
  action.clampWhenFinished = !pb.loop
  action.timeScale = pb.timeScale
  action.reset().play()
  action.time = anim.currentTime      // seek to wall-clock-derived position
```

This is network-agnostic — it handles the late-joiner case (`som-dump`
carried `playing: true`), the autoStart-on-connect case (AnimationController
flipped SOM to `playing: true` synchronously), and the autoStart-static-load
case (same, without a server). In all three cases the renderer reconciles
to current SOM state when ready.

**`action.time = anim.currentTime` is critical for late joiners** —
without it they start the mixer at t=0 and visibly snap, instead of
joining the animation at its current wall-clock-derived position.

**`clampWhenFinished = !pb.loop` is critical for loop toggles** — when
`LoopRepeat` transitions to `LoopOnce` mid-play (a live `loop: false`
edit), the action finishes its current cycle and stops at the final frame
rather than snapping back to t=0.

### `peerCount` semantics (Session 31)

```javascript
get peerCount() {
  if (!this._som) return 0
  const localName = this._displayName ?? null
  return this._som.nodes.filter(n =>
    n.extras?.atrium?.ephemeral === true &&
    n.name !== localName
  ).length
}
```

**Excludes the local avatar by name.** The local avatar enters the SOM
via `som-dump` before `world:loaded` fires on connected clients, so a
naive count-all-ephemeral approach over-counts by one. The name-based
exclusion is minimal and correct; a future refactor could route this
through AvatarController's peer tracking if richer semantics become
useful.

### Natural completion sync

The renderer registers `mixer.addEventListener('finished', ...)` so
that when a `LoopOnce` action finishes naturally (either authored that
way or flipped mid-play by a loop toggle), `anim.stop()` is called on
the SOM. Without this, SOM would retain `playing: true` while the
renderer was idle — the loop-toggle UX would desynchronize the two
layers.

---

## Client Package (`packages/client`)

Four classes, zero Three.js or DOM dependency — portable across browser
UI, headless tests, and future bot clients.

### AtriumClient (`AtriumClient.js`)

Connection, protocol, SOM sync layer.

**Constructor:** `new AtriumClient({ debug: false, fetch: globalThis.fetch })`

**Properties:** `client.som`, `client.connected`, `client.displayName`,
`client.worldBaseUrl`, `client.peerCount`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)               // expects absolute URL
client.loadWorldFromData(data, name) // string (glTF JSON) or ArrayBuffer
client.setView({ position, look, move, velocity, up })
client.resolveExternalReferences()
```

**`peerCount`:** count of ephemeral SOM nodes excluding the local avatar
(matched by `name === displayName`). Falls back to "all ephemeral" if
no local displayName yet (pre-handshake or static-load paths).

**`worldBaseUrl` (Sessions 24, 26):** Base URL for resolving relative paths
in `extras.atrium.source`. Set automatically by `loadWorld(url)`, null'd by
`loadWorldFromData()`, can be set explicitly via setter.

**Events:**
```javascript
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})
client.on('session:ready', ({ sessionId, displayName }) => {})
client.on('world:loaded', ({ name, description, author, source, containerName }) => {})
client.on('peer:join', ({ sessionId, displayName }) => {})
client.on('peer:leave', ({ sessionId, displayName }) => {})
client.on('peer:view', ({ displayName, position, look, move, velocity, up }) => {})
client.on('som:add', ({ nodeName }) => {})
client.on('som:remove', ({ nodeName }) => {})
client.on('som:set', ({ nodeName, path, value }) => {})
```

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

### AnimationController (`AnimationController.js`) — Sessions 27–31

Manages SOM-level animation lifecycle. Headless, no Three.js dependency.

**Constructor:** `new AnimationController(client)`

**Lifecycle:**
- On `world:loaded`: tears down previous tracking, scans `som.animations`,
  sets up mutation listeners, emits `animation:play` for any with
  `playing: true`, triggers `autoStart` path for `autoStart && peerCount === 0`
- On `som:add`: checks for new animation, tracks it, emits `animation:added`
- On `som:remove`: tears down listener, emits `animation:removed`
- Mutation listener: on `playback` change → emits semantic event(s)

**`tick(dt)`:** Iterates `_playing` Set, calls `anim.tick()` on each.
Only playing animations — O(playing) not O(all).

**Events:**
```javascript
animController.on('animation:play',             ({ animation }) => {})
animController.on('animation:pause',            ({ animation }) => {})
animController.on('animation:stop',             ({ animation }) => {})
animController.on('animation:playback-changed', ({ animation, playback }) => {})
animController.on('animation:added',            ({ animation }) => {})
animController.on('animation:removed',          ({ animation }) => {})
```

**World reload teardown:** `_onWorldLoaded` clears `_tracked` and
`_playing`, removes all mutation listeners before re-scanning.

---

## Avatar System

### Core design

**Avatar nodes are regular SOM nodes** — ephemeral per session.
`extras.atrium.ephemeral = true` stamped by AtriumClient. Session
identity = avatar node identity: `displayName = User-${sessionId.slice(0,4)}`
and the avatar node's `name` equals the displayName.

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

Schema is flat — `name`, `description`, `author`, `navigation`,
`background` all live directly under `extras.atrium`. Legacy
`extras.atrium.world` schema was removed in Session 28.

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

### Animation integration (Sessions 28–31)

`apps/client` builds Three.js `AnimationClip` objects manually from the
glTF-Transform document. `buildClipsFromSOM(somDocument)` iterates
animations, builds `KeyframeTrack` objects from raw accessor arrays.

**Key finding:** `DocumentView` sets `Object3D.name = glTFNode.getName()`,
so Three.js track name resolution works by bare node name.

`world:loaded` flow:

```javascript
initDocumentView(client.som)
initAnimations()                   // builds clipMap and mixer
replayPlayingAnimations(client.som) // reconciles to current SOM state

animCtrl.on('animation:play',             ({ animation }) => { ... })
animCtrl.on('animation:pause',            ({ animation }) => { ... })
animCtrl.on('animation:stop',             ({ animation }) => { ... })
animCtrl.on('animation:playback-changed', ({ animation, playback }) => {
  const action = mixer.existingAction(clipMap.get(animation.name))
  action.setLoop(playback.loop ? LoopRepeat : LoopOnce, Infinity)
  action.setEffectiveTimeScale(playback.timeScale)
})

// Natural completion sync
mixer.addEventListener('finished', ({ action }) => {
  const anim = client.som.getAnimationByName(action.getClip().name)
  if (anim && anim.playing) anim.stop()
})
```

`AnimationController` is constructed once at startup. `AnimationMixer`
and `clipMap` are rebuilt on each `world:loaded`.

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

## SOM Inspector (`tools/som-inspector/`) — Sessions 19, 22–29

Developer tool for viewing and editing the live SOM. Uses the full client
stack with an inspection-focused UI. Shares animation integration patterns
with `apps/client` — `initAnimations()`, `replayPlayingAnimations()`,
the four semantic event handlers, and the mixer `finished` listener.

### Architecture

AtriumClient events drive all UI updates — no polling:

| Event | Handler |
|---|---|
| `world:loaded` | Init DocumentView, build tree, clear property sheet, show WorldInfoPanel, init animations, replay playing animations |
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
│  ▸ World Info      │          3D Viewport                    │
├────────────────────┤       (ORBIT default)                   │
│   Scene graph      │                                         │
│   tree view        │                                         │
├────────────────────┤                                         │
│  Property sheet    │                                         │
├────────────────────┤                                         │
│  Animations        │                                         │
│  ▾ CrateRotate     │                                         │
│    4.00s  1.23s    │                                         │
│    [▶][⏸][⏹]       │                                         │
│    playing  true   │                                         │
│    loop     [✓]    │                                         │
│    autoStart [✓]   │                                         │
│    timeScale 1.00  │                                         │
│  ▸ CrateBob        │                                         │
└────────────────────┴─────────────────────────────────────────┘
```

### AnimationsPanel (Sessions 28, 29)

Each animation row has a disclosure triangle (▸/▾) that expands to show
the full `playback` object.

| Field | Control | Notes |
|---|---|---|
| `playing` | read-only text | live from mutation listener |
| `paused` | read-only text | |
| `loop` | checkbox | effective immediately — writes `anim.playback = { ...anim.playback, loop: v }` |
| `autoStart` | checkbox + `(authoring)` hint | writes through, broadcasts, no immediate runtime effect (consumed on `world:loaded` only) |
| `timeScale` | number input | step 0.1, min 0.01, reverts on invalid |
| `startTime`, `startWallClock`, `pauseTime` | read-only | `—` when null |

Play/Pause/Stop buttons remain visible in both collapsed and expanded states.

Single mutation listener per animation drives both summary (button states,
current time) and detail panel updates.

### WorldInfoPanel (Session 22)

Collapsible. Sections: Identity (name, description, author), Background
(type, texture), Navigation (modes, speed, terrain, collision, update
rate). Editable inputs call `som.setExtrasAtrium(path, value)`.

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

## Test Fixtures

### `space.gltf` — Minimal gray-box world
Ground plane, crate, lamp with stand and shade.

### `atrium.gltf` — Session 21
Procedurally generated circular gathering space. 56 nodes, 43 meshes,
9 PBR materials. Self-contained glTF. Equirectangular skybox.

### `space-anim.gltf` — Session 28
Fork of `space.gltf` with two loopable animations:
- **CrateRotate** — Y-axis full rotation, 4 seconds, 5 quaternion keyframes
- **CrateBob** — Y-axis translation oscillation, 2 seconds, 5 VEC3 keyframes

Both seamlessly loopable. No `extras.atrium.playback` authored (start stopped).

### `space-anim-autoplay.gltf` — Session 29
Sibling to `space-anim.gltf`. Both animations author
`extras.atrium.playback` with `autoStart: true, loop: true`. First client
into an empty room triggers autoStart; late joiners pick up the running state.

Generator extracted common builder logic into `generate-space-anim-base.js`;
both `generate-space-anim.js` and `generate-space-anim-autoplay.js` import
it and differ only in the final `animExtras` argument.

### `space-ext.gltf` — Session 24
External references test world.

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
| SOMAnimation — `autoStart` authoring field | ✅ Complete (Session 29) |
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
| AtriumClient — `peerCount` getter (local-avatar exclusion) | ✅ Complete (Session 31) |
| Server — `__document__` set handling (unified) | ✅ Complete (Session 27) |
| Server — configurable `PORT` env var | ✅ Complete (Session 23) |
| Server — external reference resolution at startup | ✅ Complete (Session 25) |
| Server — `som-dump` filtering of external nodes | ✅ Complete (Session 25) |
| Server — `.atrium.json` consumption | ✅ Complete (Session 26) |
| Server — `extras.atrium` schema fix | ✅ Complete (Session 28) |
| AnimationController — lifecycle + semantic events | ✅ Complete (Session 27) |
| AnimationController — world reload teardown | ✅ Complete (Session 28) |
| AnimationController — `autoStart` trigger | ✅ Complete (Session 29) |
| AnimationController — `animation:playback-changed` event | ✅ Complete (Session 29) |
| AvatarController — local + peer avatar lifecycle | ✅ Complete |
| NavigationController — WALK + ORBIT modes | ✅ Complete |
| `apps/client` — Three.js animation integration | ✅ Complete (Session 28) |
| `apps/client` — renderer-side reconciliation (`replayPlayingAnimations`) | ✅ Complete (Session 30) |
| `apps/client` — live loop/timeScale reaction (`animation:playback-changed`) | ✅ Complete (Session 29) |
| `apps/client` — natural completion sync | ✅ Complete (Session 29) |
| `apps/client` — full UI (HUD, nav, labels, modes) | ✅ Complete |
| `apps/client` — drag-and-drop + `.atrium.json` loading | ✅ Complete (Session 23) |
| `apps/client` — background hot-reload | ✅ Complete (Session 22) |
| `apps/client` — URL absolutization | ✅ Complete (Session 26) |
| SOM Inspector — tree + property sheet + viewport | ✅ Complete |
| SOM Inspector — WorldInfoPanel | ✅ Complete (Session 22) |
| SOM Inspector — AnimationsPanel | ✅ Complete (Session 28) |
| SOM Inspector — AnimationsPanel expandable rows | ✅ Complete (Session 29) |
| SOM Inspector — renderer-side reconciliation | ✅ Complete (Session 30) |
| SOM Inspector — animation renderer integration | ✅ Complete (Session 28) |
| SOM Inspector — live cross-client editing | ✅ Confirmed working |
| Test fixtures — space, atrium, space-ext, space-anim, space-anim-autoplay | ✅ Complete |
| External references (`extras.atrium.source`) | ✅ Complete (Session 24) |
| External ref animations | 🔜 Phase 6 (deferred) |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

- **External ref late-joiner mutation gap** — `som-dump` excludes
  externally-loaded nodes. Late joiners get original values from the
  source file, not mutations applied by earlier clients. (Session 24)

- **External refs in dropped files skip resolution** —
  `loadWorldFromData` sets `_worldBaseUrl = null`. (Session 24)

- **Load while connected** — Loading a new `.gltf` while connected does
  not disconnect. SOM mismatch. (Known, deferred — but see "useful
  artifact" note below)

- **Label height offset** — peer labels may float too high. (Deferred)

- **ORBIT → WALK avatar placement** — avatar at orbit camera position,
  may float. (Deferred)

- **Known flaky test** — "handles client disconnect cleanly" race
  condition in `session.test.js:184`. Pre-existing.

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

**Previously-listed, now resolved:**
- ~~Late-joiner animation renderer does not start playback~~ — fixed in Session 30

---

## Concerns & Arc Observations (Sessions 27–31)

This section captures things worth knowing before touching the animation
path or building the next arc. These aren't bugs; they're context.

### The animation arc took four sessions, not one

Session 27 built the SOM-level animation layer. Session 28 wired the
renderer. Session 29 added `autoStart` and the AnimationsPanel
expansion. Session 30 fixed the renderer race exposed by autoStart
(which was also the Session 28 late-joiner bug, unrecognized as such).
Session 31 fixed the `peerCount` semantic bug that was suppressing
autoStart on live server connects.

**Pattern:** each session exposed a connect-time lifecycle assumption
that the previous design hadn't modeled. The design briefs were
individually reasonable but the integration surface between
AnimationController, the renderer, and AtriumClient lifecycle had more
moving parts than any single brief captured. When a future feature
touches the connect-time path, plan for two or three iterations rather
than one.

### Test doubles that let you sidestep the real code path

The Session 29 tests stubbed `peerCount` directly via a test helper,
which made it impossible for any test to catch the local-avatar bug.
Session 31 added real-SOM tests to close that gap, but the pattern is
worth naming: **if your test double lets you bypass the thing you're
testing, you're testing the double.**

### `peerCount` is still slightly fragile

The current implementation identifies the local avatar by matching
`node.name === this._displayName`. This is correct today but will break
if:
- The avatar naming convention changes
- Two sessions ever end up with the same displayName (collision of the
  4-char session ID prefix; probability ~1 in 65k, so not impossible
  in long-running servers)
- The local avatar gets renamed after creation

A more principled solution would be to route `peerCount` through
AvatarController's peer tracking. Left for future consideration — the
current fix is adequate and cheap to revisit.

### The `autoStart` persistence question

`autoStart` edits in the Inspector currently have no runtime effect
because worlds aren't persisted back to disk. Users can flip the
checkbox and the change broadcasts across clients, but nothing retains
it past server shutdown. This was a conscious future-proofing decision
(flagged with an "(authoring)" label in the UI), but when persistence
lands, `autoStart` becomes meaningful and the behavior needs revisiting.

### The "load-while-connected" path is a useful diagnostic artifact

During Session 31 debugging, Load-while-connected was observed to
successfully trigger autoStart on a stuck connection — because the load
rebuilds the SOM from static content, which momentarily drops the local
avatar, producing a `peerCount === 0` window during which autoStart
fires. This is technically the "load while connected" known issue
(SOM mismatch, deferred) behaving in a way that *helped* diagnose
Session 31. Keep this in the diagnostic toolkit when debugging
connect-time state bugs.

### Sticky-stop semantics

If a peer stops an animation and the server restarts, `autoStart` fires
again for the next empty-room joiner — peer's stop doesn't persist.
This is acceptable for now ("get features in and discover coverage in
practice") but is the kind of thing that will feel wrong once
persistence lands. Pre-flagged, not scheduled.

### Renderer-side reconciliation is a pattern worth reusing

`replayPlayingAnimations(som)` is the template: when a renderer
subscribes to stateful events, it should also run a one-time
reconciliation against current state during its own initialization.
This makes the renderer robust to handler ordering and to arriving
mid-stream (late-joiner, reconnect, reload). The pattern applies
beyond animations — any future renderer integration (physics,
particles, skinned avatars) should follow the same shape.

---

## Backlog (Prioritized)

### Next: Real content + external reference stress testing
- Test external references with real glTF models
- Replace capsule avatars with static glTF character models
- Source free glTF assets and stress-test the pipeline
- Address external ref late-joiner mutation gap (carries over from animation arc)

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
- Persistence — periodic glTF snapshots (unlocks meaningful `autoStart` edits)
- Permissions model design
- Design Session B — User Object Extensions (`ATRIUM_user_object`)
- `peerCount` refactor via AvatarController (low priority)

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
- Sticky-stop semantics (revisit when persistence lands)

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
11. **Renderers reconcile to current state.** Renderers cannot assume event
    ordering relative to their own initialization; they must walk the SOM
    once they're ready. (Sessions 30–31.)

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

# start a world server (autoplay animated space)
cd packages/server
WORLD_PATH=../../tests/fixtures/space-anim-autoplay.atrium.json node src/index.js

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
- `SESSION-29-Animation-Enhancements-brief.md` — autoStart + autoplay fixture + Inspector expansion
- `SESSION-29-animation-enhancements-log.md` — Session 29 build log
- `SESSION-30-Renderer-Race-Fix-brief.md` — renderer race fix
- `SESSION-30-renderer-race-fix-log.md` — Session 30 build log
- `SESSION-31-peerCount-fix-brief.md` — peerCount local-avatar exclusion
- `SESSION-31-peerCount-fix-log.md` — Session 31 build log
