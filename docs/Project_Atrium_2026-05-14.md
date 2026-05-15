# Project Atrium
## 2026-05-14 · As of Session 37

This document is the canonical project handoff. It supersedes
`Project_Atrium_2026-05-03.md` (Sessions 1–35) and folds back in the
per-controller, `.atrium.json`, and external-references detail from
`Project_Atrium_2026-04-17.md` so this document is self-contained — the
next session does not need either predecessor. Both remain in the repo
as historical record.

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
│   ├── renderer-three/  # Three.js-specific glue (Session 34; expanded Session 37)
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
│           ├── WorldInfoPanel.js       # World metadata editor (Session 22)
│           └── AnimationsPanel.js      # Animation controls + expandable rows (Sessions 28, 29)
├── tests/
│   ├── fixtures/                       # See "Test Fixtures" below
│   └── client/
│       ├── index.html                  # Legacy test client (protocol scratch pad)
│       └── som/                        # Manual source copy of packages/som/src/
├── docs/
│   └── sessions/                       # Design briefs + session logs
└── ...
```

---

## Test Counts (after Session 37)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 46 |
| `@atrium/som` | 109 |
| `@atrium/server` | 32 (avatar 6 + presence 6 + world 9 + session 11; `external-refs.test.js` is a separate 6-test integration file not run by `pnpm --filter @atrium/server test`) |
| `@atrium/client` | 96 |
| `@atrium/renderer-three` | 32 (19 pre-Session-37 + 13 new `AnimationBridge` tests) |
| `@atrium/interaction` | 9 |
| **Total** | **324** |

Run with `pnpm --filter <package> test`.

> **Action item:** server tests don't run cleanly in batch mode —
> `session.test.js` opens port 3001 and hangs `pnpm --filter
> @atrium/server test`. Individual files run fine. The Session 37 run
> did not hit the hang, but it is a known intermittent — do not treat
> its absence as fixed. Harness fix (likely a teardown issue) is a
> small hygiene item for a future session.

> **Process note:** build logs have misreported test counts in past
> sessions (Session 33 showed 18/18 when actual was 96). Future briefs
> must require full recursive test output, not summary numbers, and
> reconcile the total against the prior baseline. Session 37 followed
> this — keep that standard.

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

### Pointer events (Sessions 32–34)

`SOMObject` also carries pointer event dispatch. The renderer-side
`PointerInputBridge` (see below) calls `client.dispatchPointerEvent(node,
type, detail)` which routes through `SOMObject._dispatchEvent`. Event
types: `pointerover`, `pointerout`, `pointerdown`, `pointerup`,
`pointermove`, `click`. Dispatch is currently leaf-only; bubbling
remains design-only (see Backlog).

### Global SOM Namespace (Session 27)

`SOMDocument` maintains a single flat `_objectsByName` Map — all named
SOM objects share one namespace, following the DOM `id` model.

```javascript
som.getObjectByName('Crate')        // → SOMNode
som.getObjectByName('WalkCycle')    // → SOMAnimation
som.getObjectByName('__document__') // → SOMDocument

som.getNodeByName('Crate')          // typed convenience — nodes only
som.getAnimationByName('WalkCycle') // typed convenience — animations only
```

**Name uniqueness:** Names must be unique across all types. If collision,
node wins in `_objectsByName` (registered first); animation still accessible
via `getAnimationByName`. Warning logged.

**Protocol routing:** Server and AtriumClient both resolve `set` message
targets via `getObjectByName(msg.node)` — a single uniform path.

### SOMDocument extras (Session 22)

```javascript
som.extras                                            // getter
som.extras = { atrium: { ... } }                      // setter — fires mutation event
som.setExtrasAtrium('background.texture', 'sky.png')  // convenience deep-set
```

### Wrapper caching, stable identity

`SOMDocument` builds the full object graph at construction time, bottom-up.
All wrappers cached. `getNodeByName` is O(1) via `_nodesByName` Map.
Stable identity holds: `som.getNodeByName('x') === som.getNodeByName('x')`.

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

`autoStart` is authoring, not runtime. `play()`, `pause()`, `stop()` all
preserve `autoStart`. It's consumed once by `AnimationController` on
`world:loaded`; after that the live playback state takes over.

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
- **AnimationBridge** (`packages/renderer-three`, Session 37) — owns the
  Three.js mixer, clip map, the four `animCtrl` handlers, the `finished`
  listener, and `replayPlayingAnimations`. Shared by `apps/client` and
  `tools/som-inspector`. Before Session 37 this logic was inline-duplicated
  in both consumers.

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
assume `animation:play` events arrive after it's built its mixer. After
`AnimationBridge.init()` completes, the consumer calls
`bridge.replayPlayingAnimations(som)`:

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

Network-agnostic — handles late-joiner (`som-dump` carried `playing:
true`), autoStart-on-connect (AnimationController flipped SOM
synchronously), and autoStart-static-load (same, no server). All three
cases reconcile to current SOM state when ready.

`action.time = anim.currentTime` is critical for late joiners — without
it they start the mixer at t=0 and visibly snap.

`clampWhenFinished = !pb.loop` is critical for live `loop: false` edits
mid-play — the action finishes its current cycle and stops at the final
frame rather than snapping back to t=0.

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

Excludes the local avatar by name. The local avatar enters the SOM via
`som-dump` before `world:loaded` fires on connected clients, so a naive
count-all-ephemeral approach over-counts by one.

### Natural completion sync

`AnimationBridge` registers `mixer.addEventListener('finished', ...)` so
that when a `LoopOnce` action finishes naturally, `anim.stop()` is called
on the SOM. Without this, SOM would retain `playing: true` while the
renderer was idle.

---

## Pointer Event System (Sessions 32–34)

Pass 1 of the input/interaction system. Three layers, headless principle
preserved at the top:

```
DOM PointerEvent
    │
    ▼
[PointerInputBridge in @atrium/renderer-three]
    │   ← raycast, resolve hit to SOM node, build event detail
    ▼
client.dispatchPointerEvent(somNode, type, detail)
    │   ← Session 32 API on AtriumClient
    │     manages capture state, hover state, pointerDown target
    ▼
SOMObject._dispatchEvent
    │   ← existing SOM event mechanism
    ▼
listener handlers
```

SOM nodes never touch Three.js. AtriumClient never touches Three.js. The
bridge is the only place where Three.js + DOM + AtriumClient meet.

### Event detail shape

Renderer-neutral; no Three.js fields leak through (no `face`,
`faceIndex`, `object`, `instanceId`).

```javascript
{
  pointerId, button, buttons,
  point,        // [x,y,z] world-space
  normal,       // [x,y,z] world-space
  localPoint,   // [x,y,z] hit-leaf local space (Session 32 amendment)
  localNormal,  // [x,y,z] hit-leaf local space
  ray: { origin, direction },
  distance,
  uv,           // [u,v] | null
  shiftKey, ctrlKey, altKey, metaKey,
  stopPropagation()  // currently a no-op; reserved for bubbling
}
```

### Dispatch semantics

- **Leaf-only.** Hit-test resolves to one leaf SOM node. No bubbling yet.
- **`pointerover` / `pointerout`** fire on leaf transitions.
- **`click`** fires when `pointerdown` and `pointerup` resolve to the
  same node (or, with capture active, when `pointerup` resolves via
  hit-test to the captured node).
- **Pointer capture** routes all `pointermove` and `pointerup` to the
  captured node regardless of hit-test, until released. Released
  automatically on `pointerup`.
- **Hover state cleared** on `disconnect()` and on `world:loaded`.

### `PointerInputBridge` (Session 34)

```javascript
const bridge = new PointerInputBridge({
  client,
  canvas,
  camera,
  sceneRoot,           // THREE.Object3D | () => THREE.Object3D
  resolveSOMNode,      // optional, defaults to walk-up-by-name
  suppressOnCapture,   // optional, defaults to true
})
bridge.dispose()
```

Constructor + dispose. That's the entire surface. The bridge owns:

- Hit-testing (raycaster, NDC, traversal, walk-up-by-name)
- Event detail construction
- DOM listener attachment (on `canvas`)
- `client.dispatchPointerEvent` calls
- Capture-coexistence pragma (peek `client.hasPointerCapture` after
  pointerdown dispatch, conditional `stopPropagation`)

Three call sites consume the bridge: `apps/client`, `tools/som-inspector`,
`apps/playground`. The third was added specifically as a stress-test of
the abstraction shape during extraction.

### Drag math (`packages/renderer-three/src/drag-math.js`)

Pure helpers, no DOM, no AtriumClient deps:

- `projectRayToPlane(ray, planeY)` — ray onto horizontal world plane
- `computeParentInverse(threeObj)` — inverse of parent's world matrix

Used by the Inspector's drag handlers. Intentionally pure for
testability and future reuse.

### Drag mechanism (Session 33)

- World-space horizontal plane at the node's world Y captured at mousedown
- Cursor projects onto that plane each `pointermove`
- World delta `(currentCursor - initialCursor)` added to initial node
  world position
- Result converted to parent-local via `parentWorldInverse`
- Written to `node.translation`
- One mutation per move; renderer reconciles via existing pattern (no
  SOM/renderer divergence — Principle 11 in action)

---

## `packages/renderer-three/` (Sessions 34, 37)

Three.js-specific glue. Created in Session 34 with the pointer bridge as
first tenant; expanded in Session 37 with the animation + DocumentView
extraction. Long-term home for all Three.js coupling.

```
packages/renderer-three/
├── src/
│   ├── PointerInputBridge.js      # stateful class (Session 34)
│   ├── drag-math.js               # pure helpers (Session 34)
│   ├── hit-test.js                # pure helpers (Session 34)
│   ├── AnimationBridge.js         # stateful class (Session 37)
│   ├── build-clips.js             # buildClipsFromSOM, pure (Session 37)
│   ├── document-view.js           # initDocumentView, plain function (Session 37)
│   ├── load-background.js         # loadBackground, plain function (Session 37)
│   └── index.js
└── tests/                         # 32 tests
```

**Package shape (established pattern, as of Session 37):**
**one stateful class + pure/plain helpers per concern.**
`PointerInputBridge` + `drag-math`/`hit-test` for pointer; `AnimationBridge`
+ `build-clips`/`document-view`/`load-background` for animation. Future
tenants should follow the same shape unless there's a clear reason not to.

**Dependencies of note:** `renderer-three` now declares
`@gltf-transform/view` as a peer dependency (added Session 37, required by
`initDocumentView`). This is the first time the package depends on
`@gltf-transform/view` — a deliberate dependency-graph change, consistent
with the package's role as the renderer/DOM/client meeting point.

### `AnimationBridge` (Session 37)

```javascript
const bridge = new AnimationBridge(sceneGroup, client, animCtrl)
bridge.init(somDocument)
bridge.replayPlayingAnimations(som)
bridge.update(dt)        // in the frame loop; no-ops if mixer is null
bridge.dispose()
```

**Constructor ordering enforcer:** takes `sceneGroup` at construction,
which is produced by `initDocumentView`. This makes the required init
order (`initDocumentView` → bridge construction) **structurally
unskippable** — you cannot construct an `AnimationBridge` before
`initDocumentView` has produced a `sceneGroup`. Not a behavior change;
just makes the existing hard constraint impossible to violate.

**Per-world-load lifecycle:**
1. `({ docView, sceneGroup } = initDocumentView(renderer, threeScene, som, { prevDocView, prevSceneGroup }))`
2. `if (prevBridge) prevBridge.dispose()` (removes old handlers)
3. `bridge = new AnimationBridge(sceneGroup, client, animCtrl)` (registers handlers)
4. `bridge.init(som)` — builds clipMap; creates mixer if clips > 0
5. `bridge.replayPlayingAnimations(som)` — syncs already-playing animations

**Null-mixer guard preserved exactly:** if a world has no animations,
`mixer` stays `null` after `init()`. All handlers and
`replayPlayingAnimations` check `if (!this.mixer) return` — identical to
pre-Session-37 behavior.

**Log prefix:** unified to `[renderer-three]` (replaced consumer-specific
`[app]`/`[inspector]`).

### Other Session 37 helpers

- **`buildClipsFromSOM(somDocument) → THREE.AnimationClip[]`** — pure.
  Iterates animations, builds `KeyframeTrack` objects from raw accessor
  arrays. `weights` (morph-target) tracks remain unhandled — known gap.
- **`initDocumentView(renderer, threeScene, somDocument, { prevDocView, prevSceneGroup }) → { docView, sceneGroup }`** —
  plain function. Disposes prior pair if provided, creates a fresh
  `DocumentView`, adds new `sceneGroup` to `threeScene`. Caller owns the
  refs.
- **`loadBackground(threeScene, bg, baseUrl)`** — plain function.
  Extracted from `tools/som-inspector`'s correct version. The Session 37
  extraction also deleted `apps/client`'s inline duplicate (a pre-existing
  copy-paste-drift bug) by routing `world:loaded` through this function —
  the bug vanished as a consequence of the duplicate removal, not as a
  separate logic edit.

---

## Client Package (`packages/client`)

Zero Three.js or DOM dependency — portable across browser UI, headless
tests, and future bot clients.

### AtriumClient (`AtriumClient.js`)

Connection, protocol, SOM sync, pointer dispatch.

**Constructor:** `new AtriumClient({ debug: false, fetch: globalThis.fetch })`

**Properties:** `client.som`, `client.connected`, `client.displayName`,
`client.worldBaseUrl`, `client.peerCount`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)                // expects absolute URL
client.loadWorldFromData(data, name) // string (glTF JSON) or ArrayBuffer
client.setView({ position, look, move, velocity, up })
client.resolveExternalReferences()

// Pointer dispatch (Session 32)
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

### `background`

| Field | Type | Description |
|-------|------|-------------|
| `texture` | string | Path to image, resolved relative to `.gltf` URL |
| `type` | string | `"equirectangular"` or `"cubemap"` (only equirect implemented) |

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

## `apps/client` — Browser UI Shell

Single `index.html` + `src/app.js` + `src/LabelOverlay.js`. ES modules,
import map for Three.js, no build step.

### Pointer integration (Session 34)

`apps/client` consumes `PointerInputBridge` to forward DOM pointer
events into SOM-level dispatch. Diagnostic console handlers attach to
every non-ephemeral SOM node on `world:loaded` for development; gating
behind a debug flag is in the polish backlog.

### Animation integration (Session 37)

As of Session 37, `apps/client` consumes `AnimationBridge`,
`initDocumentView`, `buildClipsFromSOM`, and `loadBackground` from
`@atrium/renderer-three`. The previously-inline animation machinery
(mixer, clipMap, the four `animCtrl` handlers, `replayPlayingAnimations`,
the `finished` listener) was extracted in Session 37; see
`packages/renderer-three/` above for the full lifecycle.

`world:loaded` flow:
```javascript
;({ docView, sceneGroup } = initDocumentView(renderer, threeScene, client.som, { prevDocView: docView, prevSceneGroup: sceneGroup }))
if (animBridge) animBridge.dispose()
animBridge = new AnimationBridge(sceneGroup, client, animCtrl)
animBridge.init(client.som)
animBridge.replayPlayingAnimations(client.som)
loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)
```

Tick loop: `if (animBridge) animBridge.update(dt)`.

`AnimationController` is constructed once at startup. The `animBridge`
(with its mixer and clipMap) is rebuilt on each `world:loaded`.

---

## `apps/playground` — Pointer Test Bench (Session 34)

Third call site for `PointerInputBridge`. Exists primarily to validate
the bridge abstraction against a third real consumer (the original
extraction plan had only two; the playground was added to stress the
shape). Useful as a minimal interactive surface for pointer-event
experimentation without the weight of `apps/client` or the Inspector.

**Not** an animation-rendering consumer — confirmed Session 36. Not
affected by the Session 37 animation extraction.

---

## SOM Inspector (`tools/som-inspector/`)

Developer tool for viewing and editing the live SOM. Uses the full
client stack with an inspection-focused UI. As of Session 37, shares
the `AnimationBridge` / `initDocumentView` / `loadBackground` code path
with `apps/client` via `@atrium/renderer-three`.

### Architecture

AtriumClient events drive all UI updates — no polling:

| Event | Handler |
|---|---|
| `world:loaded` | Init DocumentView, build tree, clear property sheet, show WorldInfoPanel, init animations, replay playing animations |
| `som:add` | Rebuild tree |
| `som:remove` | Rebuild tree; clear property sheet if selected node removed |
| `som:set` (node) | Refresh property sheet if `nodeName` matches selected |
| `som:set` (`__document__`) | Refresh WorldInfoPanel, hot-reload background |

### Click-to-select + drag (Session 33)

The Inspector consumes `PointerInputBridge` for viewport interaction:

- Click on a node in the viewport selects it (mirrors tree selection)
- Mouse-drag on a selected node translates it on the world-horizontal
  plane (drag mechanism described above)
- Mutations flow SOM → renderer via the standard reconcile path
- Property sheet does **not** currently update during drag — see Known
  Issues

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

Play/Pause/Stop buttons remain visible in both collapsed and expanded
states. Single mutation listener per animation drives both summary and
detail panel updates.

---

## Test Fixtures

### `space.gltf` — Minimal gray-box world
Ground plane, crate, lamp with stand and shade. The lamp parent has
no mesh of its own; only its children (`lamp-shade`, `lamp-stand`)
are hit-targets. This is the canonical case motivating compound-object
UX — handled by the selection model in Session 35; bubbling remains
useful for hierarchical event handling (parent-receives-child-clicks)
when that need surfaces.

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
`extras.atrium.playback` with `autoStart: true, loop: true`. First
client into an empty room triggers autoStart; late joiners pick up the
running state.

Generator extracted common builder logic into `generate-space-anim-base.js`;
both `generate-space-anim.js` and `generate-space-anim-autoplay.js` import
it and differ only in the final `animExtras` argument.

### `space-ext.gltf` — Session 24
External references test world. Paired with standalone `crate.gltf` and
`lamp.gltf`.

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
| AtriumClient — `peerCount` getter (local-avatar exclusion) | ✅ Complete (Session 31) |
| AtriumClient — pointer dispatch + capture + hover state | ✅ Complete (Session 32) |
| Server — `__document__` set handling (unified) | ✅ Complete (Session 27) |
| Server — configurable `PORT` env var | ✅ Complete (Session 23) |
| Server — external reference resolution at startup | ✅ Complete (Session 25) |
| Server — `som-dump` filtering of external nodes | ✅ Complete (Session 25) |
| Server — `.atrium.json` consumption | ✅ Complete (Session 26) |
| AnimationController — full lifecycle + reconciliation | ✅ Complete (Sessions 27–31) |
| AvatarController — local + peer avatar lifecycle | ✅ Complete |
| NavigationController — WALK + ORBIT modes | ✅ Complete |
| `apps/client` — full UI (HUD, nav, labels, modes) | ✅ Complete |
| `apps/client` — drag-and-drop + `.atrium.json` loading | ✅ Complete (Session 23) |
| `apps/client` — pointer bridge integration | ✅ Complete (Session 34) |
| `apps/playground` — pointer test bench | ✅ Complete (Session 34) |
| SOM Inspector — tree + property sheet + viewport | ✅ Complete |
| SOM Inspector — WorldInfoPanel | ✅ Complete (Session 22) |
| SOM Inspector — AnimationsPanel + expandable rows | ✅ Complete (Sessions 28, 29) |
| SOM Inspector — animation renderer integration + reconciliation | ✅ Complete (Sessions 28, 30) |
| SOM Inspector — click-to-select + drag-to-translate | ✅ Complete (Session 33) |
| SOM Inspector — live cross-client editing | ✅ Confirmed working |
| `packages/renderer-three/` — PointerInputBridge + drag-math | ✅ Complete (Session 34) |
| `@atrium/interaction` package launch | ✅ Complete (Session 35) |
| `@atrium/interaction` — selection model (`nearestNonMeshAncestor`, `leafOnly`, `resolveSelectionRoot`) | ✅ Complete (Session 35) |
| SOM Inspector + playground — selection-root resolution (Pattern C: heuristic + Alt-descend) | ✅ Complete (Session 35) |
| **Renderer-coupling audit — `apps/client` / Inspector / playground** | **✅ Complete (Session 36)** |
| **`packages/renderer-three/` Phase 1 — `AnimationBridge`, `initDocumentView`, `buildClipsFromSOM`, `loadBackground`** | **✅ Complete (Session 37)** |
| **`apps/client` + Inspector — extraction consumers (animation/DocumentView/background)** | **✅ Complete (Session 37)** |
| Test fixtures — space, atrium, space-ext, space-anim, space-anim-autoplay | ✅ Complete |
| External references (`extras.atrium.source`) | ✅ Complete (Session 24) |
| External ref animations | 🔜 Phase 6 (deferred) |
| Pointer event bubbling | 🔜 Design-only until a concrete use case |
| Networked interactivity (`ATRIUM_interactivity`) | 🔜 Awaits bubbling |
| **Renderer extraction Phase 2 (bootstrap + camera sync)** | **🔜 Unbundled, pending rendering-independence design session** |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

### From Session 37

- **Animation late-joiner time-sync (smoke case 4) and live `loop: false`
  edit mid-play (smoke case 5) not regression-tested by Session 37.**
  These behaviors lacked a known-good pre-session baseline, so they
  cannot be regression-tested by an extraction session — testing them
  then would conflate "did the refactor break it" with "did it ever
  work." Explicitly deferred to the **upcoming full-system QA pass**,
  where they should be validated as *feature* behavior. Smoke cases 6–9
  (LoopOnce natural completion, background paths, hot-reload, the
  `apps/client` `world:loaded` background line that replaced the
  deleted inline copy) all pass.
- **`buildClipsFromSOM` has no unit coverage.** Extracted as a pure
  function in Session 37 without tests, to keep Phase 1 a strict
  structural refactor. It is now a clean, testable seam (`SOMDocument`
  → `THREE.AnimationClip[]`; track types, names, counts all assertable)
  and should get direct coverage in a future session at
  `packages/renderer-three/tests/build-clips.test.js`.

### From Sessions 32–34

- **Pointer event bubbling not implemented** — leaf-only dispatch.
  The lamp/compound-object UX is now handled at the selection layer
  (Session 35), so bubbling is no longer chasing a concrete gap. It
  remains the right answer for genuine event-handler hierarchy and is
  a probable prerequisite for `ATRIUM_interactivity`. Design-only
  until a concrete use case surfaces.

- **Hit-test resolves to invisible nodes** — setting `threeObj.visible
  = false` continues to allow that node to be hit by the bridge's
  raycaster, contrary to default Three.js raycaster behavior. Root
  cause unconfirmed; suspected to be visibility toggled on a parent
  transform with visible mesh children. Diagnostic procedure
  documented in `SESSION-35-backlog.md`.

- **Property sheet doesn't update during drag** — Inspector property
  sheet shows values captured at selection time; doesn't update until
  re-selection. Standard observable-pattern fix (subscribe to mutation
  on displayed node).

### Carried over

- **Morph-target (`weights`) animation tracks unhandled** by
  `buildClipsFromSOM`. Known gap; pre-existed extraction; carried
  forward.

- **External ref late-joiner mutation gap** — `som-dump` excludes
  externally-loaded nodes. Late joiners get original values from the
  source file, not mutations applied by earlier clients. (Session 24)

- **External refs in dropped files skip resolution** —
  `loadWorldFromData` sets `_worldBaseUrl = null`. (Session 24)

- **Load while connected** — Loading a new `.gltf` while connected does
  not disconnect. SOM mismatch. (Known, deferred — useful as a
  diagnostic artifact during connect-time bug investigation.)

- **Label height offset** — peer labels may float too high. (Deferred)

- **ORBIT → WALK avatar placement** — avatar at orbit camera position,
  may float. (Deferred)

- **Known flaky test** — "handles client disconnect cleanly" race
  condition in `session.test.js:184`. Pre-existing.

- **Debug view spew** — `_debug = true` floods console. (Deferred)

- **Camera child node in `som-dump`** — may appear for late joiners.
  (Deferred)

- **No permissions model** — any client can mutate any node. (Deferred)

- **`apps/client` remote background hot-reload** — peer background
  edits update SOM but don't call `loadBackground()`. (Session 22)
  Note: distinct from the `apps/client` `world:loaded` background path,
  which Session 37 fixed as a side effect of duplicate-removal.

- **External ref timing hazard** — `set` for prefixed node before local
  client has resolved that reference. (Session 24)

- **Server `.atrium.json` startup tests missing** — manual testing only.
  (Session 26 gap)

- **Server test harness — batch-mode hang** — `pnpm --filter
  @atrium/server test` hangs because `session.test.js` opens a live
  WebSocket server on port 3001 and the harness doesn't tear down
  cleanly. Individual test files all pass when run separately. The
  Session 37 run did not hit it, but treat the absence as luck, not
  fix. Harness-level fix (likely teardown) is a small hygiene item.

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
12. **`packages/client` is renderer-neutral.** AtriumClient never imports
    a renderer. Renderer-specific glue lives in its own package
    (`packages/renderer-three/` for Three.js); the bridge pattern is the
    single seam where renderer + DOM + client meet. Future non-Three
    renderers consume the same client API. (Sessions 32–34, extended
    Session 37.)
13. **User interaction policy lives in `@atrium/interaction`.**
    AtriumClient, SOM, and renderer packages do not encode interaction
    conventions; they expose mechanism that interaction policies
    compose over. Apps consume `@atrium/interaction` directly, not via
    AtriumClient. (Session 35.)

---

## Working Notes — Process & Patterns

These are observations about how sessions run, not principles about the
system. Worth carrying forward.

### Brief → Claude Code → smoke test plan → results

Each session ran:
1. Discussion in chat to settle design open questions.
2. Markdown brief drafted, reviewed.
3. Brief handed to Claude Code; build log returned.
4. Smoke test plan drafted (sometimes pre-implementation, sometimes post-).
5. Smoke tests run manually; results reviewed.
6. Commit message; sometimes a follow-up cleanup brief.

The brief-as-handoff pattern is critical. Claude Code's interpretation
of conversational instructions varies; brief docs constrain scope and
make the handoff legible.

### Audit before extraction (Sessions 36–37)

When the next extraction target is non-trivial, run a **design-input
audit session first**, then draft the extraction brief *from the audit's
findings*. Session 36 was such an audit (no code); Session 37 executed
the extraction brief drafted from it. The audit's job is to inventory
touchpoints and classify divergence across consumers — not to design the
API. The API decision is made in chat from the audit's facts. This
discipline kept Session 37's two-consumer extraction safe despite the
lack of a validating third consumer.

### Briefs that worked

- **Explicit non-goals.** Every Session 32–37 brief had a "What's
  deferred" / "Non-goals" section. Without it, scope drifts.
- **Files expected to change** + **No changes expected in**. Both
  matter; the second prevents over-eager modification.
- **Implementation order.** Helps Claude Code sequence work; also
  forces the brief author to think it through. Session 37 ordered
  easy-and-safe extractions first so a hard `AnimationBridge` design
  question wouldn't block the safe wins.
- **Risks / watch-outs.** A surprising number of bugs were caught
  pre-implementation by listing them as risks.
- **Acceptance criteria.** Explicit pass conditions reduce ambiguity
  about whether a session is done.
- **"Stop and flag" instructions.** Session 37's brief told Claude
  Code to stop if the abstraction shape fought the code, rather than
  improvise. For two-consumer extractions especially, an explicit
  escape hatch beats a forced commit.

### Things to watch in build logs

- **Test count regressions or misreports.** Cross-check the build
  log's numbers against actual `pnpm --filter X test` runs before
  trusting them. Briefs must require full recursive output. Session 37
  followed this and produced a clean reconciliation against the 311
  baseline.
- **Smoke test plans rewritten rather than amended.** Session 32 and
  33 both saw tests dropped during regeneration. Briefs should say
  "preserve existing tests, add to them, don't replace."
- **Implementation deviations from the brief.** Evaluate whether
  they're genuine improvements or scope creep. Session 37 example:
  the `initDocumentView` signature gained a fourth options arg
  (`{ prevDocView, prevSceneGroup }`) because a pure function cannot
  close over module-level state the way the inline version did — a
  forced, legitimate improvement, recorded so it doesn't read as
  undisciplined drift later.
- **The redefined-check pattern.** When a verification check fails
  and is then "corrected" until it passes, scrutinize whether the
  correction was legitimate (genuinely out-of-scope signal excluded)
  or whether a real failure was rationalized into a green
  checkmark. Session 37's prefix-check correction (excluding a
  pre-existing world-metadata log unrelated to animation) was
  legitimate — but the pattern warrants attention every time.
- **"Headline pass rate" can hide deferred cases.** Session 37's
  smoke log reported "24/24 checks pass" — but six of the ten *plan*
  cases were "pending manual run," not automated. Read pass rates as
  "of-what-was-run," not "of-what-was-planned." A complete plan can
  still be a partially-run plan.
- **Build logs surface canonical-doc updates the brief didn't
  predict.** After future build logs land, do a quick "what did we
  learn that the update spec didn't predict?" pass before applying
  canonical-doc updates.

### Patterns from the code itself

- **Three call sites before extracting.** Session 34's bridge
  extraction was guided by three real consumers. Two-consumer
  extractions are riskier; the third validates the abstraction's
  shape. Session 37 was a two-consumer extraction — the Session 36
  audit had to do the abstraction-shape validation work that a third
  consumer normally would.
- **Bug-for-bug compatibility on migration.** When extracting a shared
  abstraction, existing call sites should behave identically
  post-migration. "Improve while extracting" deviations are signals
  that the abstraction's shape is wrong. **Nuance from Session 37:**
  a bug that vanishes as an *intrinsic consequence* of removing a
  duplicate is legitimate (the `apps/client` background copy
  deletion); editing the logic of either copy to make them "equivalent"
  before extraction is not.
- **Regression tests need a known-good baseline.** A behavior that
  was never confirmed working cannot be *regression*-tested by a
  refactor session. Session 37 explicitly deferred two such cases
  to a dedicated QA pass.
- **`renderer-three` package shape.** One stateful class + pure/plain
  helpers per concern. Pointer (`PointerInputBridge` +
  `drag-math`/`hit-test`) and animation (`AnimationBridge` +
  `build-clips`/`document-view`/`load-background`) both follow this.
  Future tenants should follow the same shape unless there's a clear
  reason not to.
- **Amendments, not v2s.** When `localPoint`/`localNormal` were added
  post-Session-32, they shipped as a "Session 32 Update" doc, additive
  only. The original brief stayed valid.
- **Walk before run.** Sessions 32–34 were explicit about leaf-only
  dispatch, mouse-only input, no rotation/scale, no bubbling. Each is
  a deliberate "we'll add that when we have a use case."
- **Plain-data event details.** `event.detail` is JSON-serializable.
  No live object references, no renderer types. (The SOM-node-in-detail
  bug from Session 32 made this sharp.)
- **Test doubles must not bypass the thing under test.** The Session
  29 tests stubbed `peerCount` directly, which made it impossible for
  any test to catch the local-avatar bug fixed in Session 31. *If your
  test double lets you bypass the thing you're testing, you're testing
  the double.*

### Arc lessons

- **Lifecycle arcs take more sessions than briefs predict.** The
  animation arc landed over four sessions (27–31), not the one its
  initial brief implied. The renderer extraction landed over two
  (36 audit + 37 execution), with Phase 2 deliberately unbundled.
  When a future feature touches non-trivial existing structure, plan
  for two or three iterations rather than one. Bubbling is likely to
  have a similar shape — design first, then expect implementation to
  surface questions the design didn't fully answer.
- **Unbundle, don't postpone.** Session 36's audit recommended a
  two-phase extraction. Phase 2 was unbundled (not just deferred) at
  the end of Session 37 — meaning the *phases* are no longer
  contractually linked; Phase 2 will be reassessed from facts (and
  perhaps a friction signal) rather than committed to as an automatic
  next step. This is a stronger discipline than "deferred for later."

---

## Backlog (Prioritized)

### Immediate

- **Full-system QA pass.** Owns the two Session 37 deferrals (smoke
  cases 4 and 5: late-joiner time-sync, live `loop: false` edit
  mid-play). These should be validated as feature behavior, not
  regressions, since they lacked a known-good pre-session baseline.
- **Rendering-independence design session.** Phase 2 of the renderer
  extraction (scene/camera/renderer **bootstrap** + **camera sync**)
  was unbundled at the end of Session 37. Before any further
  extraction, a design session settles: what "rendering independence"
  actually means as a goal (it is *not* "zero Three.js in apps" —
  some Three.js, like `buildAvatarDescriptor` and per-app bootstrap
  config, is legitimately app-specific). Likely outputs: a sharper
  goal statement, a decision on whether bootstrap extraction is
  worthwhile (probably not, low value), and the design question
  around `NavigationController`'s API boundary that would need
  settling before camera-sync extraction. Recommended trigger to
  start: either the QA pass clears, or a concrete friction signal
  appears in the existing duplication.

### Highest impact

- **Pointer event bubbling — DESIGN + IMPLEMENT.** The lamp-style
  compound-object UX is now handled at the selection layer (Session
  35), so bubbling is no longer needed for that case. Bubbling remains
  the right answer for genuine event-handler hierarchy — e.g., a
  parent node that wants to react to clicks on any descendant
  (highlight, sound, broadcast). Open design questions:
  `pointerover`/`pointerout` bubbling semantics, `target` vs
  `currentTarget` shape, propagation order, whether to inherit DOM's
  capture-phase (recommend: not), how `localPoint`/`localNormal`
  behave for ancestors. Recommended split: design-only session, then
  implementation session. Bubbling is also a probable prerequisite
  for `ATRIUM_interactivity`. Build when a concrete use case forces it.

### Renderer abstraction follow-ups

- **`buildClipsFromSOM` unit tests.** Extracted Session 37 without
  coverage; clean testable seam now (`SOMDocument` →
  `THREE.AnimationClip[]`; track types, names, counts all assertable).
  Add at `packages/renderer-three/tests/build-clips.test.js`.
- **Renderer extraction Phase 2** — see "Immediate" above.
- **Server test harness — batch-mode fix.** `pnpm --filter
  @atrium/server test` hangs because `session.test.js` doesn't tear
  down its WebSocket server cleanly. Individual files all pass.
  Small hygiene item; pair with any session that next touches the
  server.

### Pointer events polish (Session 32–34 followups)

- **Hit-test invisibility bug investigation.** Run the diagnostic
  documented in `SESSION-35-backlog.md`, decide on fix shape.
  Recommended fix: bridge walks hit ancestry, masks
  invisible-ancestor hits.
- **Property sheet reactivity during drag.** Subscribe to mutation on
  displayed node; ~60Hz re-render acceptable for small sheets.
- **Click-to-deselect on empty space.** Outstanding TODO since Session
  33. Standard mousedown-vs-drag threshold pattern.
- **Diagnostic console handlers gated behind debug flag.** One-line
  fix in `apps/client`.
- **Fixture loading paths consistent across apps.** Use
  `new URL('...', import.meta.url)` or server-root-relative paths.

### Drag UX (next `@atrium/interaction` tenant candidate)

- **Camera-relative drag.** Current world-space drag feels wrong when
  camera is rotated. Capture camera right/forward at mousedown,
  transform screen-space cursor delta → world axes. Renderer-neutral
  portion of drag math is a candidate for migration from
  `@atrium/renderer-three` into `@atrium/interaction` during this work.
- **Axis-locked drag** (modifier-key escapes for vertical / single-axis).
- **Visual selection feedback in viewport.** Outline, bounding box, or
  tint.
- **Rotation / scale drag gestures.** No design exists. Visible gizmos
  vs modifier-key escapes.
- **Reconsider "first click selects, second click drags" two-step UX.**
- All five are drag-UX questions; tackle as a single session, not
  piecemeal.

### Larger work

- **`ATRIUM_interactivity` extension.** Declarative trigger/action
  pairs with networked broadcast. Was Session B–C in the original
  pointer arc framing; not started. Bubbling is a probable
  prerequisite.
- **Real content + external reference stress testing.** Test external
  references with real glTF models. Replace capsule avatars with
  static glTF character models. Source free glTF assets.
- **External ref late-joiner mutation gap** — carries over from
  animation arc.

### Navigation

- **FLY mode** — remove Y constraint, include pitch in movement vector.
- **Terrain following for WALK** — raycast ground callback.
- **Gravity** — downward velocity when not on ground.

### Architecture / future

- **External reference animations** (Phase 6) — `ingestExternalScene`
  copies animations, prefix naming, registration.
- **External reference reconciliation** — prefix mismatch detection.
- **Server `.atrium.json` startup tests.**
- **Persistence** — periodic glTF snapshots (unlocks meaningful
  `autoStart` edits).
- **Permissions model design.**
- **Design Session B — User Object Extensions (`ATRIUM_user_object`).**

### UX polish

- App-layer `world:loaded` for external refs.
- Label height offset tuning.
- ORBIT → WALK avatar placement.
- Debug view spew fix.
- HDR background support.
- `apps/client` remote background hot-reload fix (distinct from the
  Session 37 `world:loaded` fix — this is the peer-edit path).
- Load/Connect lifecycle rationalization.

### Deferred

- Touch / pen pointer events (API named `pointer*` for forward-compat,
  only mouse drives it currently).
- Nested external references.
- Dedicated `reference:error` event.
- External ref resolution for dropped files.
- Drag-and-drop "add to scene" behavior.
- `.atrium.json` auto-connect option.
- `ATRIUM_world` glTF extension formalization.
- Dead reckoning.
- Collision / physics.
- Viewpoints.
- `@atrium/som` npm publish.
- README / TESTING.md updates.
- Animation blend weights / blending.
- Morph-target (`weights`) animation tracks.
- Animation grouping / playlists.
- Sticky-stop semantics (revisit when persistence lands).
- Undo/redo (drag mutations need single-undoable-unit treatment, not
  60/sec).

---

## Suggested Session 38 framings

Two live threads coming out of Session 37. Either can go first; they
don't block each other.

- **Rendering-independence design session (recommended next design
  work).** Settle what "rendering independence" actually means as a
  project goal, decide whether bootstrap extraction is worth doing
  (probably not), and surface the `NavigationController` boundary
  question that any camera-sync extraction would need to address.
  Design-only, no code. Output: either a Phase 2 brief or a clear
  "Phase 2 deferred indefinitely" decision with reasoning.
- **Full-system QA pass.** Validates the two Session 37 deferred smoke
  cases (4 and 5) as feature behavior, plus a broader system sweep.
  Independent of the design session.

Other live candidates:

- **Drag UX polish.** Camera-relative drag, axis-locked drag, visual
  selection feedback. Natural next `@atrium/interaction` tenant. Was
  the May 3 doc's top Session 36 recommendation; deferred when
  Session 36 became the renderer audit. Still strong; pick this up
  when the rendering-independence question is settled and the QA
  pass has cleared.
- **`buildClipsFromSOM` unit tests + server test harness batch-mode
  fix.** Hygiene bundle, low effort. Could pair with any session.
- **Bubbling design.** Design-only brief; still waiting for a concrete
  use case (`ATRIUM_interactivity` is the likely one, itself unstarted).

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

# open the pointer playground
open apps/playground/index.html
```

**When you change `packages/som`, always sync the test client:**
```bash
cp packages/som/src/*.js tests/client/som/
```

---

## Key Reference Documents

### Historical handoffs
- `Project_Atrium_2026-04-17.md` — Sessions 1–31 reference (animation
  arc, pre-pointer architecture). Per-controller and external-ref
  detail from this doc is now folded into this handoff; the original
  remains for historical reference.
- `Project_Atrium_2026-05-02.md` — Sessions 32–34 delta + reflective
  notes (superseded by 05-03).
- `Project_Atrium_2026-05-03.md` — Sessions 1–35 canonical
  (superseded by this document).

### Animation arc (Sessions 27–31)
- `Atrium_Animation_Design_Spec.md` — full animation spec
- `SESSION-27-Animation-log.md`
- `SESSION-28-more-animation-log.md`
- `SESSION-Fix-Space-Extras-Schema-log.md`
- `SESSION-29-Animation-Enhancements-brief.md` and log
- `SESSION-30-Renderer-Race-Fix-brief.md` and log
- `SESSION-31-peerCount-fix-brief.md` and log

### Pointer events arc (Sessions 32–34)
- `SESSION-32-Pointer-Events-brief.md` — original Session 32 brief
- `SESSION-32-update-extended-detail.md` — amendment adding
  `localPoint`/`localNormal`/etc.
- `SESSION-32-pointer-events-log.md` and update log
- `SESSION-32-smoke-test-plan-merged.md` — Session 32 smoke plan
- `SESSION-33-Inspector-Selection-Drag-brief.md` and log
- `SESSION-33-smoke-test-plan-rewritten.md` — Session 33 smoke plan
- `SESSION-34-Renderer-Bridge-brief.md` and log
- `SESSION-34-playground-smoke-test-plan.md`

### Renderer extraction arc (Sessions 36–37)
- `SESSION-36-Renderer-Coupling-Audit-brief.md` — audit brief (no code)
- `SESSION-36-renderer-coupling-audit.md` — audit findings
- `SESSION-37-Renderer-Extraction-Phase-1-brief.md` — Phase 1 brief,
  drafted from the audit
- `SESSION-37-Renderer-Extraction-Phase-1-brief-log.md` — Phase 1 log
- `SESSION-37-smoke-test-plan.md` — Phase 1 smoke plan
- `SESSION-37-smoke-test-plan-log.md` — smoke run log

### Working backlog
- `SESSION-35-backlog.md` — issues, TODOs, and Session 35 framings
  (largely subsumed into this document but retains diagnostic
  procedures and finer-grained notes).
