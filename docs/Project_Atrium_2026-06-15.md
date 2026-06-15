# Project Atrium
## 2026-06-15 · As of Session 42

This document is the canonical project handoff. It supersedes
`Project_Atrium_2026-06-14.md` (Sessions 1–41) and is self-contained —
the next session does not need any predecessor. The prior handoff is
retained in the repo as historical record.

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
│   │                    #   AnimationController, pointer dispatch + capture
│   ├── interaction/     # User interaction policy (Session 35)
│   │                    #   selection model; future: drag UX, gestures, multi-select
│   ├── renderer-three/  # Three.js-specific glue (Sessions 34, 37)
│   │                    #   PointerInputBridge, drag-math, hit-test,
│   │                    #   AnimationBridge, buildClipsFromSOM,
│   │                    #   initDocumentView, loadBackground
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── apps/
│   ├── client/          # Browser UI shell — Three.js viewport, navigation, avatars
│   │   ├── index.html
│   │   └── src/
│   │       ├── app.js
│   │       └── LabelOverlay.js
│   └── playground/      # Pointer-event test bench (Session 34)
├── tools/
│   ├── protocol-inspector/index.html   # Single-file interactive protocol debugger
│   └── som-inspector/                  # SOM Inspector
│       ├── index.html
│       └── src/
│           ├── app.js
│           ├── TreeView.js
│           ├── PropertySheet.js
│           ├── WorldInfoPanel.js
│           └── AnimationsPanel.js
├── tests/
│   ├── fixtures/                       # See "Test Fixtures" below
│   └── client/
│       ├── index.html
│       └── som/                        # Manual source copy of packages/som/src/
├── docs/
│   └── sessions/                       # Design briefs + session logs
└── ...
```

---

## Test Counts (after Session 42)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 55 |
| `@atrium/som` | 176 |
| `@atrium/server` | 32 |
| `@atrium/client` | 106 |
| `@atrium/renderer-three` | 32 |
| `@atrium/interaction` | 9 |
| **Total** | **410** |

Run with `pnpm --filter <package> test`.

> **Action item:** server tests don't run cleanly in batch mode —
> `session.test.js` opens port 3001 and hangs `pnpm --filter
> @atrium/server test`. Individual files run fine. Known intermittent;
> harness fix (teardown issue) is a small hygiene item for a future session.

> **Process note:** build logs have misreported test counts in past
> sessions. Future briefs must require full recursive test output, not
> summary numbers, and reconcile the total against the prior baseline.

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
  animations, lights, cameras, or `__document__` — resolved via
  `som.getObjectByName()` (Session 27). The field accepts any non-empty
  string; dotted names like `"Sun.light"` and `"MainCamera.camera"` are
  valid and route correctly.

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
| `SOMDocument` | glTF-Transform `Document` | `extras`, `setExtrasAtrium(path, value)`, factories, lookups, resolve helpers |
| `SOMScene` | glTF-Transform `Scene` | `addChild`, `removeChild` |
| `SOMNode` | glTF-Transform `Node` | `translation`, `rotation`, `scale`, `name`, `extras`, `visible`, `mesh`, `camera`, `light` |
| `SOMMesh` | glTF-Transform `Mesh` | `name`, `weights`, `addPrimitive`, `removePrimitive` |
| `SOMPrimitive` | glTF-Transform `Primitive` | `mode`, `material` |
| `SOMMaterial` | glTF-Transform `Material` | `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `emissiveFactor`, `alphaMode`, `alphaCutoff`, `doubleSided` |
| `SOMCamera` | glTF-Transform `Camera` | `type`, `yfov`, `znear`, `zfar`, `aspectRatio`, `xmag`, `ymag` — **fully mutable, networked, Session 42** |
| `SOMLight` | glTF-Transform `Light` (`KHR_lights_punctual`) | `color`, `intensity`, `type`, `range`, `innerConeAngle`, `outerConeAngle`, `extras` — **fully mutable, networked, Sessions 38–41** |
| `SOMAnimation` | glTF-Transform `Animation` | `playback` (compound), `play()`, `pause()`, `stop()`, `tick()` |
| `SOMTexture` | glTF-Transform `Texture` | (read-only in v0.1) |
| `SOMSkin` | glTF-Transform `Skin` | (read-only in v0.1) |

### `_objectsByName` registration

`SOMDocument` maintains a single flat `_objectsByName` Map. Not all SOM
types are registered — only those that need wire-addressability by name:

| SOM type | Registered in `_objectsByName` |
|---|---|
| `SOMDocument` | YES — as `'__document__'` |
| `SOMNode` | YES — bare name |
| `SOMAnimation` | YES — bare name |
| `SOMLight` | YES — bare name **+ qualified alias** `<hostNode>.light` (Sessions 38–41) |
| `SOMCamera` | YES — bare name **+ qualified alias** `<hostNode>.camera` **(Session 42)** |
| `SOMMaterial` | NO — reached via parent node path traversal |
| `SOMMesh` | NO |
| `SOMPrimitive`, `SOMTexture`, `SOMSkin` | NO |

### SOMObject base class

DOM-style event listener API:

```javascript
addEventListener(type, callback)
removeEventListener(type, callback)
_hasListeners(type)      // zero-cost check before allocating events
_dispatchEvent(event)
```

### Mutation events

Every setter on every mutable SOM type fires a `mutation` event after
updating the underlying glTF-Transform object. Only allocates a `SOMEvent`
if listeners are present. Event detail accessed via `event.detail`.

**Property change:**
```javascript
{ target: somObject, property: 'intensity', value: 0.5 }
```

**Child list change:**
```javascript
{ target: somObject, childList: { addedNodes: ['nodeName'] } }
{ target: somObject, childList: { removedNodes: ['nodeName'] } }
```

### Pointer events (Sessions 32–34)

`SOMObject` also carries pointer event dispatch. The renderer-side
`PointerInputBridge` calls `client.dispatchPointerEvent(node, type, detail)`
which routes through `SOMObject._dispatchEvent`. Event types: `pointerover`,
`pointerout`, `pointerdown`, `pointerup`, `pointermove`, `click`. Dispatch
is currently leaf-only; bubbling remains design-only.

### Global SOM Namespace (Session 27)

`SOMDocument` maintains a single flat `_objectsByName` Map — all registered
named SOM objects share one namespace, following the DOM `id` model.

```javascript
som.getObjectByName('Crate')              // → SOMNode
som.getObjectByName('WalkCycle')          // → SOMAnimation
som.getObjectByName('Sun.light')          // → SOMLight (qualified alias)
som.getObjectByName('Sun')                // → SOMNode (node wins bare-name slot)
som.getObjectByName('MainCamera.camera')  // → SOMCamera (qualified alias)
som.getObjectByName('MainCamera')         // → SOMNode (node wins bare-name slot)
som.getObjectByName('__document__')       // → SOMDocument

som.getNodeByName('Crate')             // typed convenience — nodes only
som.getAnimationByName('WalkCycle')    // typed convenience — animations only
```

**Name uniqueness:** Names must be unique across all types. If collision,
node wins in `_objectsByName` (registered first); the loser is reachable
only via typed accessor or qualified alias. Warning logged.

**Protocol routing:** Server and AtriumClient both resolve `set` message
targets via `getObjectByName(msg.node)` — a single uniform path, regardless
of the target object's type.

---

## SOMLight (Sessions 38–41)

`SOMLight` wraps a glTF-Transform `Light` property from
`@gltf-transform/extensions` (`KHR_lights_punctual`). It is the first Atrium
SOM type backed by a glTF *extension* rather than core glTF.

### API

```javascript
// Intrinsic
light.name              // string | null — read-only

// Mutable (each setter fires mutation event)
light.color             // [r,g,b] linear, plain JS array
light.intensity         // number
light.type              // 'directional' | 'point' | 'spot'
light.range             // number | null (null = infinite; point/spot only)
light.innerConeAngle    // number (radians; spot only)
light.outerConeAngle    // number (radians; spot only)
light.extras            // object

// Registration identity
light.qualifiedName     // '<hostNodeName>.light' — set by SOMDocument at construction
```

### `SOMNode.light` accessor

```javascript
somNode.light           // → SOMLight | null
```

### `som.lights` enumeration

```javascript
som.lights              // → SOMLight[] (deduplicated; separate _lights array)
```

### Naming / aliasing scheme

A `SOMLight` is registered under **two literal keys** in `_objectsByName`:

- **Bare glTF name** (`"Sun"`) — registered if non-null and non-colliding;
  node wins on collision (Session 27 rule).
- **Qualified alias** (`"Sun.light"`) — always registered unconditionally;
  stable wire identity regardless of collision state.

Both keys point to the same cached wrapper. The qualified alias is the
**correct wire address** for protocol `set` messages targeting light
intrinsics — the bare name may resolve to the host node on collision.

**Separator convention:**
- `.` = intrinsic contained child (`"Sun.light"`, `"MainCamera.camera"`)
- `/` = external-ref ingested node (`"Chair/Body"`) — pre-existing, distinct

**Collision warning:** when a light's bare name collides with its host node:
```
SOM: duplicate name "Sun" — SOMNode wins bare-name slot; use "Sun.light" to address this light
```

**Detached lights** (in the document dictionary but not attached to any node)
are not registered — they have no transform, render nothing, and have no SOM
presence. Deliberate fence; amendment if ever needed.

### Wire format

```json
{ "type": "set", "node": "Sun.light", "field": "intensity", "value": 0.8, "seq": 57 }
{ "type": "set", "node": "Sun", "field": "rotation", "value": [0,0,0,1], "seq": 59 }
```

Light intrinsic changes use the qualified alias. Re-aiming a light is a
host-node rotation mutation, not a light mutation.

### glTF backing

Lights live in a document-level dictionary
(`glTF.extensions.KHR_lights_punctual.lights`) and are attached to nodes
via `node.extensions.KHR_lights_punctual.light`. A light has no position or
direction of its own — both come from the host node's transform
(position from translation; direction from node's local −Z axis after
rotation). Changing aim = `SOMNode.rotation` mutation.

### glTF-Transform registration requirement

`KHRLightsPunctual` must be **explicitly registered** on the glTF-Transform
`Document` before I/O, or authored lights do not parse. This is done on:

- **Server:** `new NodeIO().registerExtensions([KHRLightsPunctual])` in
  `packages/server/src/world.js` (Session 39)
- **Client:** already correct via `new WebIO().registerExtensions(KHRONOS_EXTENSIONS)`

### `AtriumClient` outbound listener

`AtriumClient._attachLightListeners(somLight)` subscribes to each light's
`mutation` event on `world:loaded` and dispatches outbound `send` messages
using `somLight.qualifiedName` as the `node` field. `_applyingRemote` guard
prevents echo loops when inbound `set` messages trigger local setters.

---

## SOMCamera (Session 42)

`SOMCamera` wraps a glTF-Transform `Camera` (core glTF — no extension
registration required). It is now a first-class mutable, wire-addressable
SOM type following the identical pattern as `SOMLight`.

### API

```javascript
// Intrinsic
camera.name             // string | null — read-only

// Mutable (each setter fires mutation event)
camera.type             // 'perspective' | 'orthographic'
camera.yfov             // number (radians; perspective only)
camera.znear            // number
camera.zfar             // number | null (null = infinite projection; perspective only)
camera.aspectRatio      // number | null (advisory hint; renderer may ignore)
camera.xmag             // number (orthographic half-extent)
camera.ymag             // number (orthographic half-extent)

// Registration identity
camera.qualifiedName    // '<hostNodeName>.camera' — set by SOMDocument at construction
```

### `SOMNode.camera` accessor

```javascript
somNode.camera          // → SOMCamera | null
```

Returns the cached `SOMCamera` wrapper via `_resolveCamera`. Consistent
with `.mesh` and `.light` accessors.

### `som.cameras` enumeration

```javascript
som.cameras             // → SOMCamera[] (node-attached only; separate _cameras array)
```

`_cameraMap` still holds all cameras (including detached) for
`_resolveCamera()` resolution; `_cameras` is enumeration-only.

### Naming / aliasing scheme

Identical to `SOMLight`:

- **Bare glTF name** (`"MainCamera"`) — registered if non-null and
  non-colliding; node wins on collision.
- **Qualified alias** (`"MainCamera.camera"`) — always registered
  unconditionally.

**Collision warning:**
```
SOM: duplicate name "MainCamera" — SOMNode wins bare-name slot; use "MainCamera.camera" to address this camera
```

**Detached cameras** (not attached to any node) are not registered.

### Wire format

```json
{ "type": "set", "node": "MainCamera.camera", "field": "yfov", "value": 1.2, "seq": 61 }
{ "type": "set", "node": "MainCamera", "field": "rotation", "value": [0,0,0,1], "seq": 62 }
```

Camera intrinsic changes use the qualified alias. Re-aiming is a host-node
rotation mutation.

### `aspectRatio` note

`aspectRatio` is mutable in the SOM for spec completeness. The renderer
should ignore incoming `aspectRatio` mutations and derive aspect from the
canvas instead — two peers with different viewport sizes would otherwise
fight over it. This is a renderer concern, not a SOMCamera concern.

### No extension registration required

Cameras are core glTF. No `registerExtensions` call is needed on `NodeIO`
or `WebIO`. Do not add one.

### Three.js reconciliation — deferred

`apps/client/src/app.js` constructs its own Three.js camera directly;
DocumentView has no camera reconciliation path. `SOMCamera` mutations
reach the glTF-Transform backing object and stop there for now. Renderer
reconciliation (reading `SOMCamera` state and updating the Three.js camera)
is a `Stage` (Tier C) concern in the next implementation session.

### `AtriumClient` outbound listener

`AtriumClient._attachCameraListeners(somCamera)` subscribes to each
camera's `mutation` event on `world:loaded` and dispatches outbound `send`
messages using `somCamera.qualifiedName` as the `node` field.
`_applyingRemote` guard prevents echo loops.

**Note:** an old camera listener in `_attachNodeListeners` (routing via
`node: nodeName, field: 'camera.yfov'` — wrong wire address) was removed in
Session 42 to prevent double-dispatch. The new listener routes via the
qualified alias only.

---

## The Three-Tier Model (Rendering Independence)

This is the settled design for how camera/lighting/setup concerns are
classified. Every such concern belongs to exactly one tier. The tiers are
distinguished by **ownership and authority**, not by subject matter.

### Tier A — World-metadata hints

Advisory configuration in `extras.atrium` at the glTF root (same home as
`navigation` and `background`). E.g. "this world prefers ambient light at
~0.3" or "default camera is MainCamera." Advisory only — overridden by Tier B
if present. **Concrete hint schema is future work** — the tier and its
precedence authority are defined; the field names are not yet specified.

### Tier B — Scene-graph lights and cameras (`SOMLight`, `SOMCamera`)

Real glTF lights (`KHR_lights_punctual`) and cameras that exist in the scene
graph as first-class SOM objects. Mutable, broadcast, late-joiner synced,
inspectable. If a world ships Tier B objects, those are authoritative —
nothing injects defaults over them.

**`SOMLight`: complete (Sessions 38–41).** See above.
**`SOMCamera`: complete (Session 42).** See above. Three.js reconciliation deferred to Stage.

### Tier C — App-side setup (`Stage`)

Per-app machinery with no SOM analog: renderer instantiation, frame loop,
canvas/resize/devicePixelRatio handling, and the *fallback* default light +
default camera that keep a bare `.gltf` viewable. Lives in
`@atrium/renderer-three` as a new tenant alongside `PointerInputBridge` and
`AnimationBridge`. **Not yet implemented — next implementation session.**

### Precedence resolution chain

For lighting and for camera, independently:

> **1. Tier B wins if present.** If the SOM contains ≥1 `SOMLight` (resp.
> ≥1 `SOMCamera`), the app uses the scene-graph objects and injects no
> fallback.
>
> **2. Else Tier A applies.** If no scene-graph object exists but the world
> supplies a Tier A hint, the app honors the hint. *(Hint schema deferred.)*
>
> **3. Else Tier C fallback.** With neither, the app injects its built-in
> default. A bare `.gltf` is always viewable.
>
> **Orthogonally: Tier C app-specific overrides** (e.g. inspector flat
> lighting) are an explicit, opt-in path — not a step in this chain.

### Runtime tier transitions (§4.2)

Because `SOMLight` and `SOMCamera` are mutable networked state, a world can
start with no scene-graph objects (Tier A/C) and have a peer add one at
runtime. The recommended behavior: Tier C fallback is suppressed whenever ≥1
`SOMLight` (resp. `SOMCamera`) exists; predicate re-evaluated on
`som:add`/`som:remove`; renderer walks current SOM state when ready
(Principle 11). **This reconcile behavior is implemented as part of the
`Stage` session, not independently.**

---

## `Stage` (Tier C) — Design (not yet implemented)

`Stage` is the new `@atrium/renderer-three` tenant that absorbs replicated
per-app setup. It is designed at concept/responsibility level only.

**Package shape:** one stateful class + pure/plain helpers (same pattern as
`PointerInputBridge` and `AnimationBridge`). Same package — not a new one.

**Responsibilities:**
- Renderer instantiation (WebGLRenderer + parameters), per-app parameterized
- Frame loop scaffold (rAF, dt, calling `animBridge.update(dt)` etc.)
- Canvas wiring, resize, devicePixelRatio handling
- Tier C fallback injection: default light when precedence chain resolves to
  Tier C; default camera likewise
- **Camera reconciliation:** reads `SOMCamera` state and updates the Three.js
  camera on mutation events (the renderer bridge work deferred from Session 42)
- Fallback suppression/restore as `SOMLight`/`SOMCamera` membership changes
  (the §4.2 reconcile behavior)
- Opt-in app-specific override hook (inspector flat lighting)

**Boundaries:**
- Stage is renderer-coupled by definition — it lives in `@atrium/renderer-three`,
  it touches Three.js. Correct; not a Principle-12 violation.
- Stage does **not** own scene-graph state. Lights/cameras that are SOM
  objects flow through the SOM/DocumentView path.
- Stage does **not** subsume `AnimationBridge`, `PointerInputBridge`, or
  `initDocumentView`. It composes with them and likely formalizes their
  construction ordering as shared code.
- Three consumers: `apps/client`, `tools/som-inspector`, `apps/playground`.
  `tools/protocol-inspector` (no Three.js scene) is out of scope.

---

## Background — settled, not reopened

`extras.atrium.background` placement was settled April-era design (Session
~21): the skybox is world metadata, not a scene-graph object. `loadBackground`
is already extracted into `@atrium/renderer-three` (Session 37). No
`SOMBackground`/`SOMEnvironment` type is proposed; placement is not reopened.
"Environment" is not reused as a name (overloads IBL vs scene settings vs
runtime — explicitly renamed away from in April).

---

## SOMAnimation (Sessions 27–29)

Wraps a glTF-Transform `Animation` with playback state, multiplayer sync,
and local-only time events.

### Full API

```javascript
// Intrinsic (read-only)
anim.name             // string
anim.duration         // number (seconds)
anim.channels         // object[]
anim.samplers         // object[]

// Playback state (read-only accessors)
anim.playing / .paused / .loop / .autoStart / .timeScale
anim.startTime / .startWallClock / .pauseTime
anim.currentTime      // derived live from wall clock — never stored or sent

// Mutable compound property (fires single mutation event)
anim.playback         // getter/setter — full playback state object

// Methods
anim.play({ startTime, loop, timeScale })
anim.pause()
anim.stop()
anim.tick()           // fires 'timeupdate' if playing and listeners exist
```

### Wire format

```json
{ "type": "set", "node": "WalkCycle", "field": "playback", "value": { ... }, "seq": 42 }
```

### Animation Startup Lifecycle

- **SOM** — source of truth. `playing` is authoritative.
- **AnimationController** (`packages/client`) — headless; tracks animations,
  emits semantic events, runs the `tick()` loop.
- **AnimationBridge** (`packages/renderer-three`) — owns the Three.js mixer,
  clip map, the four `animCtrl` handlers, `finished` listener, and
  `replayPlayingAnimations`.

`_onWorldLoaded` behavior:
```
tear down previous tracking
peerCount = client.peerCount
for each anim in som.animations:
  track + attach mutation listener
  if anim.playing: emit animation:play   (late-joiner path)
  else if anim.playback.autoStart && peerCount === 0:
    anim.play(...)                        (autoStart path — empty room)
```

`replayPlayingAnimations` syncs already-playing animations after
`AnimationBridge.init()` completes — handles event ordering uncertainty
between AnimationController and renderer (Principle 11).

---

## `packages/renderer-three/` (Sessions 34, 37)

Three.js-specific glue. One stateful class + pure/plain helpers per concern.

```
packages/renderer-three/
├── src/
│   ├── PointerInputBridge.js      # stateful class (Session 34)
│   ├── drag-math.js               # pure helpers
│   ├── hit-test.js                # pure helpers
│   ├── AnimationBridge.js         # stateful class (Session 37)
│   ├── build-clips.js             # buildClipsFromSOM, pure
│   ├── document-view.js           # initDocumentView, plain function
│   ├── load-background.js         # loadBackground, plain function
│   └── index.js
└── tests/                         # 32 tests
```

**`AnimationBridge` per-world-load lifecycle:**
1. `({ docView, sceneGroup } = initDocumentView(renderer, threeScene, som, { prevDocView, prevSceneGroup }))`
2. `if (prevBridge) prevBridge.dispose()`
3. `bridge = new AnimationBridge(sceneGroup, client, animCtrl)`
4. `bridge.init(som)` — builds clipMap; creates mixer if clips > 0
5. `bridge.replayPlayingAnimations(som)` — syncs already-playing animations

Dependencies of note: `renderer-three` declares `@gltf-transform/view` as a
peer dependency (added Session 37). `@gltf-transform/extensions` is used by
`packages/som` (added Session 38 for `KHRLightsPunctual`).

---

## Client Package (`packages/client`)

Zero Three.js or DOM dependency — portable across browser UI, headless
tests, and future bot clients.

### AtriumClient (`AtriumClient.js`)

**Constructor:** `new AtriumClient({ debug: false, fetch: globalThis.fetch })`

**Properties:** `client.som`, `client.connected`, `client.displayName`,
`client.worldBaseUrl`, `client.peerCount`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)
client.loadWorldFromData(data, name)
client.setView({ position, look, move, velocity, up })
client.resolveExternalReferences()
client.dispatchPointerEvent(somNode, type, detail)
client.setPointerCapture(somNode, pointerId)
client.releasePointerCapture(pointerId)
client.hasPointerCapture(pointerId)
```

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

### Mutation listener wiring (as of Session 42)

`_attachMutationListeners` is called on `world:loaded` and wires outbound
`send` dispatch for:

- **Document root** (`__document__` — extras)
- **All `SOMNode` objects** (and mesh/primitive/material sub-trees via path
  traversal — materials are NOT registered by name; they are addressed via
  parent node name + compound field path, e.g.
  `{ node: "Alice", field: "mesh.primitives[0].material.baseColorFactor" }`)
- **All `SOMAnimation` objects** (playback only)
- **All `SOMLight` objects** (via `_attachLightListeners`; uses
  `somLight.qualifiedName` as the `node` field — Session 40)
- **All `SOMCamera` objects** (via `_attachCameraListeners`; uses
  `somCamera.qualifiedName` as the `node` field — Session 42)

`_applyingRemote` is set to `true` during `_onSet` to prevent echo loops
when inbound mutations trigger local setters.

World-reload teardown: `_initSom(doc)` creates a fresh `new SOMDocument(doc)`,
replacing `this._som`. Old wrappers with their listeners are garbage collected;
`_attachMutationListeners` always runs on a clean slate.

`som:add` path: only `_attachNodeListeners` is wired for dynamically-added
nodes. Lights and cameras cannot be added via `som:add` (that message only
carries node descriptors, not extension data).

### Other controllers

**AvatarController** — local + peer avatar lifecycle. Ephemeral nodes stamped
`extras.atrium.ephemeral = true`.

**NavigationController** — WALK (WASD + yaw), ORBIT (spherical drag/zoom),
FLY (stub, falls back to WALK). No Three.js or DOM dependency.

**AnimationController** — headless animation lifecycle. Emits
`animation:play/pause/stop/playback-changed/added/removed`.

---

## Avatar System

Avatar nodes are regular SOM nodes, ephemeral per session.
`displayName = User-${sessionId.slice(0,4)}`. Geometry built by app, passed
as a descriptor to `client.connect()`.

### `view` message fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `seq` | number | Yes | Sequence number |
| `position` | `[x,y,z]` | Yes | Avatar/camera world position |
| `look` | `[x,y,z]` | Yes | Forward unit vector (yaw only) |
| `move` | `[x,y,z]` | Yes | Movement direction |
| `velocity` | number | Yes | Speed in m/s |
| `up` | `[x,y,z]` | No | Up vector; omit in WALK |

---

## `extras.atrium` Root Metadata

```json
"extras": {
  "atrium": {
    "name": "The Atrium",
    "description": "A circular gathering space.",
    "author": "Project Atrium",
    "navigation": {
      "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
      "terrainFollowing": true,
      "speed": { "default": 1.4, "min": 0.5, "max": 5.0 },
      "collision": { "enabled": false },
      "updateRate": { "positionInterval": 1000, "maxViewRate": 20 }
    },
    "background": {
      "texture": "skyboxtest1.png",
      "type": "equirectangular"
    }
  }
}
```

Schema is flat — all fields live directly under `extras.atrium`. Legacy
`extras.atrium.world` schema was removed in Session 28.

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

Client consumption: URL bar or drag-and-drop. Server consumption: `WORLD_PATH=*.json`.

---

## External References (Sessions 24–25)

Nodes with `extras.atrium.source` reference external glTF files. Prefixed
naming: `Chair/Body`, `Chair/Seat`. Server filters external nodes from
`som-dump`. **Animations in external refs not yet supported (Phase 6,
deferred).**

---

## Test Fixtures

| Fixture | Contents |
|---|---|
| `space.gltf` | Minimal gray-box world — ground plane, crate, lamp |
| `atrium.gltf` | Procedural circular gathering space, 56 nodes, equirect skybox |
| `space-anim.gltf` | space.gltf + CrateRotate + CrateBob animations |
| `space-anim-autoplay.gltf` | space-anim.gltf with autoStart:true on both animations |
| `space-ext.gltf` | External references test world |
| `space-lights.gltf` | Session 38 (rebuilt Session 41) — space.gltf geometry + Sun (directional) + LampGlow (point); both use collision-name pattern |
| `space-cameras.gltf` | **NEW (Session 42)** — space.gltf geometry + MainCamera (perspective) + OrthoCamera (orthographic); both use collision-name pattern |

`space-lights.gltf` is generated by `generate-space-lights.js`.
`space-cameras.gltf` is generated by `generate-space-cameras.js` (reads
`space.gltf` via `NodeIO`, adds core-glTF cameras, writes result — no
extension registration required).

---

## What's Been Built (Status)

| Feature | Status |
|---|---|
| Protocol schemas + Ajv validator | ✅ Complete |
| Server session lifecycle, world state, presence | ✅ Complete |
| SOM — full object model, mutation events, wrapper caching | ✅ Complete |
| SOMAnimation — playback state machine + autoStart | ✅ Complete (Sessions 27–29) |
| Global SOM namespace (`_objectsByName`) | ✅ Complete (Session 27) |
| AtriumClient — connection, protocol, SOM sync, pointer dispatch | ✅ Complete |
| AvatarController, NavigationController, AnimationController | ✅ Complete |
| `apps/client` — full UI | ✅ Complete |
| `apps/playground` — pointer test bench | ✅ Complete (Session 34) |
| SOM Inspector — full tool | ✅ Complete |
| `@atrium/renderer-three` — PointerInputBridge + AnimationBridge + helpers | ✅ Complete (Sessions 34, 37) |
| `@atrium/interaction` — selection model | ✅ Complete (Session 35) |
| Renderer-coupling audit | ✅ Complete (Session 36) |
| `SOMLight` — KHR_lights_punctual, mutable, networked, late-joiner synced | ✅ Complete (Sessions 38–41) |
| Server `KHRLightsPunctual` IO registration | ✅ Complete (Session 39) |
| `AtriumClient` light mutation listener wiring | ✅ Complete (Session 40) |
| `space-lights.gltf` fixture | ✅ Complete (Session 41) |
| **`SOMCamera` — mutable, registered, wire-addressable** | **✅ Complete (Session 42)** |
| **`space-cameras.gltf` fixture** | **✅ Complete (Session 42)** |
| `Stage` (Tier C renderer-three tenant) + Three.js camera reconciliation | 🔜 Next session |
| Tier A `extras.atrium` hint schema | 🔜 Future |
| Active-camera selection (`activeCamera` field) | 🔜 Future (Tier A session) |
| Renderer extraction Phase 2 (bootstrap + camera sync) | 🔜 Unbundled, pending Stage |
| External reference animations (Phase 6) | 🔜 Deferred |
| Pointer event bubbling | 🔜 Design-only until concrete use case |
| Networked interactivity (`ATRIUM_interactivity`) | 🔜 Awaits bubbling |
| `ATRIUM_world` glTF extension formalization | 🔜 Upcoming |
| Physics, persistence, permissions | 🔜 Future |

---

## Known Issues

### Active (carry-forward)

- **Animation late-joiner time-sync (smoke case 4) and live `loop: false`
  edit mid-play (smoke case 5) not regression-tested.** Deferred to
  full-system QA pass.
- **`buildClipsFromSOM` has no unit coverage.** Extracted Session 37 without
  tests. Clean testable seam; add at
  `packages/renderer-three/tests/build-clips.test.js`.
- **Pointer event bubbling not implemented** — leaf-only dispatch.
- **Hit-test resolves to invisible nodes.** Diagnostic in
  `SESSION-35-backlog.md`.
- **Property sheet doesn't update during drag.**
- **Morph-target (`weights`) animation tracks unhandled** by
  `buildClipsFromSOM`.
- **External ref late-joiner mutation gap** — `som-dump` excludes
  externally-loaded nodes.
- **External refs in dropped files skip resolution.**
- **Load while connected** — SOM mismatch (useful diagnostic artifact).
- **Server test harness batch-mode hang** — `session.test.js` port teardown.
- **`apps/client` remote background hot-reload** — peer edits don't call
  `loadBackground()`.
- **Known flaky test** — "handles client disconnect cleanly" in
  `session.test.js:184`.
- **Debug view spew** — `_debug = true` floods console.
- **Camera child node in `som-dump`** — may appear for late joiners.
- **No permissions model.**
- **Label height offset.**
- **ORBIT → WALK avatar placement.**
- **Three.js camera not reconciled to `SOMCamera` state.** `SOMCamera`
  mutations travel over the wire and apply to the glTF-Transform backing
  object, but `apps/client` constructs its own Three.js camera independently.
  The viewport does not respond to `SOMCamera` mutations until `Stage`
  implements camera reconciliation.

---

## Key Design Principles (never violate these)

1. **Design before code.** Every session starts from a settled design brief.
2. **No throwaway code.** Every line is tested against the real implementation.
3. **Incremental correctness.** Each layer is fully working and tested before
   the next is built on top of it.
4. **glTF on the wire.** The protocol carries glTF node descriptors directly.
5. **Server is policy-free on geometry.**
6. **AtriumClient is geometry-agnostic.**
7. **SOM is the source of truth.**
8. **Static first, multiplayer second.**
9. **glTF is world state.**
10. **`packages/client` is headless.**
11. **Renderers reconcile to current state.** Cannot assume event ordering
    relative to their own initialization.
12. **`packages/client` is renderer-neutral.** Renderer-specific glue lives
    in `@atrium/renderer-three`.
13. **User interaction policy lives in `@atrium/interaction`.**

---

## Working Notes — Process & Patterns

### Brief → Claude Code → smoke test plan → results

1. Discussion in chat to settle design open questions.
2. Markdown brief drafted, reviewed.
3. Brief handed to Claude Code; build log returned.
4. Smoke test plan run manually; results reviewed.
5. Commit; sometimes a follow-up cleanup brief.

### Briefs that worked

- **Explicit non-goals.** Without it, scope drifts.
- **Files expected to change + No changes expected in.** The second prevents
  over-eager modification.
- **"Stop and flag" instructions.** Session 39 demonstrated this correctly:
  Claude Code flagged the server IO gap rather than auto-patching outside
  the declared scope.
- **Implementation order.** Forces the brief author to sequence work.
- **Risks / watch-outs.** Catches bugs pre-implementation.
- **Acceptance criteria.** Reduces ambiguity about done.

### SOMLight arc lessons (Sessions 38–41)

- **Extension registration is an I/O concern, not just a SOM concern.**
  `KHRLightsPunctual` must be registered on both the server `NodeIO` and
  client `WebIO` read paths or authored data silently disappears. The SOM
  tests pass without it (programmatic construction, no IO) — the gap only
  surfaces at runtime. Check this for every new extension-backed SOM type.
- **The correct live analog for `getObjectByName`-resolved wire addressing
  is `SOMAnimation`, not `SOMMaterial`.** Materials are addressed via parent
  node name + compound field path; they are not in `_objectsByName`.
- **Qualified alias must be stored on the wrapper at construction time.**
  `somLight.qualifiedName` is set by `_buildObjectGraph` when the alias is
  computed — not derived at listener attachment time. Avoids O(n) node scans
  and makes the alias authoritative.
- **Always-on qualification.** The alias (`"Sun.light"`) is created
  unconditionally, not collision-conditionally. Wire identity must not depend
  on current global namespace state (Principle 11 / §4.2 hazard class).
- **`som:add` does not carry extension data.** Lights and cameras cannot
  arrive via `som:add`; only node descriptors travel that path. No
  `som:add` listener needed for lights or cameras.

### SOMCamera arc lessons (Session 42)

- **Watch for latent partial wiring in `_attachNodeListeners`.** An old
  camera listener was already present, routing via
  `node: nodeName, field: 'camera.yfov'` — wrong wire address, and would
  have double-dispatched with the new alias-based listener. Removed in
  Session 42. When adding a new qualified-alias listener for any SOM type,
  audit `_attachNodeListeners` for existing compound-path listeners targeting
  the same type.
- **Core glTF types need no extension registration.** Cameras are core glTF;
  no `registerExtensions` call is needed anywhere. Contrast with
  `KHR_lights_punctual`. Do not conflate the two.
- **`_cameraMap` vs `_cameras`.** `_cameraMap` holds all cameras (including
  detached) for `_resolveCamera()` correctness; `_cameras` holds only
  node-attached cameras for enumeration and listener wiring. Same
  split as `_lightMap` / `_lights`.

### Patterns from the code itself

- **`SOMMaterial` is not in `_objectsByName`.** Reached via parent node path
  traversal. Do not use it as a model for wire-addressable SOM types.
- **Test doubles must not bypass the thing under test.**
- **Regression tests need a known-good baseline.**
- **`renderer-three` package shape:** one stateful class + pure/plain helpers
  per concern.
- **Amendments, not v2s.**

---

## Backlog (Prioritized)

### Immediate

- **`Stage` (Tier C).** Absorbs replicated per-app setup across three
  consumers (`apps/client`, `tools/som-inspector`, `apps/playground`).
  Also owns Three.js camera reconciliation (reading `SOMCamera` state,
  updating the Three.js camera on mutation). Draft brief from this
  document's Stage section.
- **Full-system QA pass.** Validates Session 37 deferrals (smoke cases 4 and
  5: late-joiner time-sync, live `loop: false` mid-play). Independent of
  Stage work.

### High impact (after Stage)

- **`buildClipsFromSOM` unit tests.** Clean testable seam.
  `packages/renderer-three/tests/build-clips.test.js`.
- **Server test harness batch-mode fix.** Small hygiene item.
- **Drag UX polish.** Camera-relative drag, axis-locked drag, visual
  selection feedback. Next `@atrium/interaction` tenant.

### Larger work

- **Tier A `extras.atrium` hint schema.** Field names for lighting hints and
  `activeCamera` reference. Own design session.
- **`ATRIUM_interactivity` extension.** Awaits bubbling design.
- **Pointer event bubbling design + implement.**
- **External reference animations (Phase 6).**
- **Real content stress testing** with actual glTF character models.

### Deferred

- Touch / pen pointer events; nested external references; dedicated
  `reference:error` event; drag-and-drop "add to scene"; `.atrium.json`
  auto-connect; `ATRIUM_world` glTF extension; dead reckoning; collision /
  physics; viewpoints; `@atrium/som` npm publish; README updates; animation
  blend weights; morph-target tracks; animation grouping; sticky-stop
  semantics; undo/redo.

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
pnpm --filter @atrium/renderer-three test
pnpm --filter @atrium/interaction test

# start a world server (lit world — recommended for SOMLight smoke)
cd packages/server
WORLD_PATH=../../tests/fixtures/space-lights.gltf node src/index.js

# start a world server (camera world — recommended for SOMCamera smoke)
WORLD_PATH=../../tests/fixtures/space-cameras.gltf node src/index.js

# start a world server (space, glTF path)
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# start a world server (animated space)
WORLD_PATH=../../tests/fixtures/space-anim.gltf node src/index.js

# start a world server (autoplay animated space)
WORLD_PATH=../../tests/fixtures/space-anim-autoplay.atrium.json node src/index.js

# start a world server (from .atrium.json config file)
WORLD_PATH=../../tests/fixtures/space-ext.atrium.json node src/index.js

# serve the browser apps (repo root — use a static server, not file://)
npx serve . --listen 8080
# then open http://localhost:8080/apps/client/index.html
# or      http://localhost:8080/tools/som-inspector/index.html

# open the protocol inspector (static — no server needed)
open tools/protocol-inspector/index.html
```

**When you change `packages/som`, always sync the test client:**
```bash
cp packages/som/src/*.js tests/client/som/
```

---

## Key Reference Documents

### Historical handoffs
- `Project_Atrium_2026-04-17.md` — Sessions 1–31 reference
- `Project_Atrium_2026-05-03.md` — Sessions 1–35 canonical (superseded)
- `Project_Atrium_2026-05-14.md` — Sessions 1–37 canonical (superseded)
- `Project_Atrium_2026-06-14.md` — Sessions 1–41 canonical (superseded by this document)

### Design documents (folded into prior handoffs)
- `DESIGN-Rendering-Independence.md` — three-tier model, SOMLight/SOMCamera/Stage design
- `DESIGN-SOMLight-Naming.md` — aliasing scheme, qualified alias, collision handling

### SOMCamera arc (Session 42)
- `SESSION-42-SOMCamera-brief.md` — implementation brief
- `SESSION-42-SOMCamera-log.md` — build log

### SOMLight arc (Sessions 38–41)
- `VERIFY-SOMLight-Set-Resolution-findings.md` — pre-brief verification
- `SESSION-38-SOMLight-log.md` — SOMLight class + registration
- `SESSION-39-SOMLight-update-log.md` — server IO registration
- `SESSION-40-SOMLight-mutation-log.md` — AtriumClient listener wiring
- `SESSION-41-SOMLIght-fix-log.md` — collision warning fix + fixture rebuild

### Animation arc (Sessions 27–31)
- `Atrium_Animation_Design_Spec.md` and session logs

### Pointer events arc (Sessions 32–34)
- `SESSION-32` through `SESSION-34` briefs and logs

### Renderer extraction arc (Sessions 36–37)
- `SESSION-36-Renderer-Coupling-Audit-brief.md`
- `SESSION-37-Renderer-Extraction-Phase-1-brief.md` and log

### Free glTF Asset Sources

| Source | Best for | License |
|--------|---------|---------|
| [KhronosGroup glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | PBR test models | Various CC |
| [Sketchfab](https://sketchfab.com) | Environments, characters, props | Filter by CC |
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR textures | CC0 |
| [Poly Pizza](https://poly.pizza) | Low-poly game assets | CC0 |
| [Quaternius](https://quaternius.com) | Low-poly packs | CC0 |
| [Ready Player Me](https://readyplayer.me) | Avatars (glTF) | Various |
| [Mixamo](https://mixamo.com) | Characters (FBX → glTF) | Free |
| [Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) | Proven Three.js-compatible | Various |
