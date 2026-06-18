# Project Atrium
## 2026-06-18 · As of Session 44

This document is the canonical project handoff. It supersedes
`Project_Atrium_2026-06-17.md` (Sessions 1–43b) and is self-contained — the
next session does not need any predecessor. The prior handoff is retained
in the repo as historical record.

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
│   ├── renderer-three/  # Three.js-specific glue (Sessions 34, 37, 43, 43b)
│   │                    #   PointerInputBridge, drag-math, hit-test,
│   │                    #   AnimationBridge, buildClipsFromSOM,
│   │                    #   initDocumentView, loadBackground,
│   │                    #   Stage (Session 43), geometry-utils (Session 43b)
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

## Test Counts (after Session 44)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 55 |
| `@atrium/som` | 176 |
| `@atrium/server` | 32 |
| `@atrium/client` | 106 |
| `@atrium/renderer-three` | 54 |
| `@atrium/interaction` | 9 |
| **Total** | **432** |

Run with `pnpm --filter <package> test`.

No new tests were added in Session 44. The `setActiveCamera` path requires
a live sceneGroup populated by `@gltf-transform/view`'s `DocumentView` —
not unit-testable without DOM/WebGL. Behavior is validated manually against
`space-cameras.gltf`.

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
| `SOMCamera` | glTF-Transform `Camera` | `type`, `yfov`, `znear`, `zfar`, `aspectRatio`, `xmag`, `ymag` — fully mutable, networked, Session 42 |
| `SOMLight` | glTF-Transform `Light` (`KHR_lights_punctual`) | `color`, `intensity`, `type`, `range`, `innerConeAngle`, `outerConeAngle`, `extras` — fully mutable, networked, Sessions 38–41 |
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
| `SOMCamera` | YES — bare name **+ qualified alias** `<hostNode>.camera` (Session 42) |
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

## SOMCamera (Sessions 42, 44)

`SOMCamera` wraps a glTF-Transform `Camera` (core glTF — no extension
registration required). It is a first-class mutable, wire-addressable SOM
type following the identical pattern as `SOMLight`.

### API

```javascript
// Intrinsic
camera.name             // string | null — read-only
camera.node             // SOMNode | null — host node back-reference (Session 44)

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
som.cameras              // → SOMCamera[]
```

**`_cameraMap` vs `_cameras`:** `_cameraMap` holds all cameras (including
detached) for `_resolveCamera()` correctness; `_cameras` holds only
node-attached cameras for enumeration and listener wiring. Same split as
`_lightMap` / `_lights`.

**Core glTF types need no extension registration.** Cameras are core glTF;
no `registerExtensions` call is needed anywhere. Contrast with
`KHR_lights_punctual`.

### `SOMCamera.node` back-reference (Session 44)

`SOMCamera._hostNode` is set by `SOMDocument._buildObjectGraph` during the
camera registration node-walk, immediately after the qualified alias is
assigned. The `get node()` getter exposes it. Cameras registered while
detached from a node have `node === null`; `Stage.setActiveCamera` guards
on this.

---

## `activeCamera` — Phase 1 (Session 44, Work-In-Progress)

Session 44 implemented the first phase of `activeCamera` support — a
mechanism for selecting which glTF-authored `SOMCamera` the viewport renders
through, with user navigation continuing relative to that camera's starting
transform. The implementation is checked in as work-in-progress; known
issues with perspective/orthographic cycling are tracked below. A redesign
is contemplated for Phase 2 (see below).

### What was built

**`NavigationController.activeCamera`** — a stored reference to the currently
active `SOMCamera` (or `null` for the Tier C default). Getter/setter. The
setter stores the reference and fires a `camerachange` event. Nav seeding is
done by Stage before setting this property; the setter itself does no
geometry math. `NavigationController` gained `set yaw(v)` and `set pitch(v)`
setters (Stage needs to seed these from world camera orientation) and a
minimal `_dispatchEvent` / `_listeners` implementation to support the
`camerachange` event.

**`Stage.setActiveCamera(somCamera)`** — the public entry point for camera
switching:

- *Non-null path:* looks up the host node's live `THREE.Object3D` via
  `sceneGroup.getObjectByName(somCamera.node.name)`, extracts world position
  and quaternion, converts to nav seed values (yaw/pitch for WALK/FLY via
  `THREE.Euler('YXZ')`; orbitTarget + `_orbitRadius/Azimuth/Elevation` for
  ORBIT), does a one-time lens copy into `this._camera` (update in place if
  same type; construct a new `THREE.PerspectiveCamera` or
  `THREE.OrthographicCamera` if type differs), then sets
  `this._nav.activeCamera = somCamera`.
- *Null path:* reverts to default `THREE.PerspectiveCamera` using the
  stored constructor `_cameraFov/Near/Far` values; sets
  `this._nav.activeCamera = null`.

`_syncCamera()` is **not modified** — it continues driving `this._camera`
from nav state every tick. Once seeded, nav just runs from the new starting
point.

**`apps/client/src/app.js`:**
- `window.stage` exposed for console testing alongside `window.atriumClient`
- Space key cycles through `som.cameras` and back to null (default):
  `null → cam[0] → cam[1] → … → null → cam[0] → …`
- Hint bar shows `🎥 CameraName` badge when `nav.activeCamera` is non-null

### Known issues (Phase 1)

> **Perspective/orthographic cycling is buggy.** After cycling through an
> orthographic camera and back to a perspective camera, the perspective view
> is incorrect — FOV, aspect, or camera type appears wrong. Root cause is
> likely the stale `camera` reference captured at startup in `app.js`:
> `const { scene: threeScene, camera } = stage` destructures `camera` once;
> after `setActiveCamera` swaps `this._camera` to a new object,
> `LabelOverlay`, `PointerInputBridge`, and potentially the render call
> itself hold the old reference. Not fixed in Session 44 — a Phase 2
> redesign is contemplated (see below) that will address this structurally.

> **`window.atrium` namespace.** `window.stage` and `window.atriumClient`
> are separate globals. A `window.atrium = { client, stage }` namespace
> consolidation was identified as the right long-term shape but deferred as
> out-of-scope for Session 44.

### Phase 2 redesign — animated cameras

The Phase 1 model seeds nav state *once* at switch time from the camera's
authored world transform, then nav runs freely from there. This works for
static cameras but **does not support animated or dynamically moved cameras**
— if the camera's host node moves (e.g. a rotating turret, a scripted
flythrough), the viewer's position does not follow it, because `_syncCamera()`
reads nav state, not the live host node transform.

The VRML Viewpoint model (the design reference for this work) handles this
correctly: once a Viewpoint is bound, *all subsequent changes to its
coordinate system change the user's view automatically*. For Atrium, this
means `_syncCamera()` would need to read the bound camera's **current** world
transform every tick as the base, and apply nav's accumulated yaw/pitch offset
on top of it — rather than seeding once and forgetting.

This is the contemplated Phase 2 redesign. It changes `_syncCamera()`'s
structure (which Phase 1 deliberately avoided), resolves the stale-camera-
reference issue structurally (renderer always reads `stage.camera`, not a
cached destructure), and is the correct long-term model. Phase 2 is a
dedicated future session. The Phase 1 implementation should be understood as
a scaffold — useful for testing the `SOMCamera.node` back-reference and the
`NavigationController.activeCamera` event plumbing — not a finished feature.

---

## `@atrium/renderer-three` — Stage (Session 43)

`Stage` is a new Tier C tenant of `packages/renderer-three`, alongside
`AnimationBridge` and `PointerInputBridge`. It absorbs the Three.js setup,
resize, and tick logic that was previously copy-pasted across `apps/client`,
`tools/som-inspector`, and `apps/playground`.

### Construction

```javascript
const stage = new Stage(container, options)
```

`options` (all optional): `client`, `cameraOffsetY`/`cameraOffsetZ`, `nav`
(bool, default `true`), `navMode`, `navMouseSensitivity`, `animCtrl` (bool,
default `true`), `animBridge` (bool, default `true`), `backgroundColor`,
`cameraFov`/`cameraNear`/`cameraFar`/`cameraPosition`, `antialias`,
`shadows`, `grid` (bool), `ambientLightColor`/`ambientLightIntensity`,
`sunColor`/`sunIntensity`/`sunPosition`.

Construction order: `WebGLRenderer` → canvas focusability → `Scene` (bg,
ambient light, directional light, optional `GridHelper`) →
`PerspectiveCamera` → if `client` provided: `AvatarController` (always, not
optional — see Known Issues), then `NavigationController` (if `nav`), then
`AnimationController` (if `animCtrl`).

`AnimationBridge` cannot be constructed at Stage-construction time — it
needs `sceneGroup` from `initDocumentView`, which only exists after
`world:loaded`. The app must call:

```javascript
stage.setSceneGroup(sceneGroup)
```

from its own `world:loaded` handler, after calling `initDocumentView`
itself. `setSceneGroup` disposes any previous bridge, constructs a new
`AnimationBridge`, and calls `init()` + `replayPlayingAnimations()` if
`client.som` is already available (handles reconnect / re-load). No-op if
`animBridge: false` or `animCtrl` is absent.

### Public API

```javascript
stage.renderer / stage.scene / stage.camera   // Three.js objects
stage.avatar / stage.nav / stage.animCtrl / stage.animBridge  // controllers, nullable
stage.setSceneGroup(sceneGroup)
stage.setActiveCamera(somCamera)    // Session 44 — see activeCamera section
stage.tick(dt)        // app calls this every frame from its own rAF loop
stage.resize(width, height)
```

`rAF` ownership stays with the app — Stage exposes `tick(dt)`, it does not
run its own loop. This lets apps control ordering (e.g. `apps/client` calls
`labels.update()` immediately after `stage.tick(dt)`, so label projection
uses the post-camera-sync frame position).

`stage.tick(dt)` is fully null-safe: it calls `nav.tick`, `animCtrl.tick`,
`animBridge.update` only if each is present, then runs internal camera sync
(`_syncCamera()` — extracted from the former `apps/client` tick, branches on
`nav.mode` for ORBIT vs. WALK third-person/first-person), then
`renderer.render()`.

### Migration status

All three consumers migrated:
- `apps/client` — full controller set, `LabelOverlay` stays app-level
- `tools/som-inspector` — `navMode: 'ORBIT'`, `navMouseSensitivity: 0.005`,
  no `LabelOverlay`
- `apps/playground` — `nav: false, animCtrl: false, animBridge: false`,
  `cameraFov: 60`, `cameraPosition: [0, 6, 10]`, `camera.lookAt(0,0,0)`
  called after construction to restore fixed-camera orientation

Manual smoke test (Session 43): **passed**, full regression pass across all
three apps including window resize, navigation modes, animation playback,
peer labels, and disconnect/reconnect. Two pre-existing-default deviations
were noted during smoke testing and remain open decisions — see Known
Issues.

---

## `@atrium/renderer-three` — geometry-utils (Session 43b)

`packages/renderer-three/src/geometry-utils.js` — extracted from an inline
function in `apps/client/src/app.js`. Two exported functions:

```javascript
threeGeometryToGltfPrimitive(geometry, material)
// Generic: extracts POSITION/NORMAL/indices from any THREE.BufferGeometry
// as plain JS arrays, disposes the input geometry, returns a glTF
// primitive descriptor: { attributes: { POSITION, NORMAL }, indices, material }
// Material is passed through by reference, not copied.

buildAvatarDescriptor(name)
// Avatar-specific wrapper: builds a THREE.CapsuleGeometry(0.3, 0.8, 4, 8),
// generates a random pastel RGBA color, calls threeGeometryToGltfPrimitive,
// returns the full glTF node descriptor ({ translation, extras, mesh })
// used as the avatar arg to AtriumClient.connect().
```

Both exported from `@atrium/renderer-three` (bare import, not a subpath —
see Known Issues re: import map wildcard coverage).

`apps/client/src/app.js` no longer has its own `THREE` import — removing
the inline `buildAvatarDescriptor` eliminated the last direct `THREE` usage
in that file.

**Open question (unresolved, carried forward):** the original
`buildAvatarDescriptor` had its top-level `name` field commented out
(`//    name,`). This omission predates Session 43/43b and was carried
forward as-is per design decision — not investigated. `extras.displayName`
remains the active path used by `LabelOverlay`/HUD. See Known Issues.

---

## NavigationController — `view` message (SOP)

Each tick, `AtriumClient` checks if navigation state changed enough to
warrant sending a `view` message:

| Field | Type | Required | Notes |
|---|---|---|---|
| `position` | `[x,y,z]` | Yes | Camera position in world space |
| `target` | `[x,y,z]` | No | Look-at target; omit in WALK |
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
| `space-cameras.gltf` | Session 42 — space.gltf geometry + MainCamera (perspective) + OrthoCamera (orthographic); both use collision-name pattern |

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
| `SOMCamera` — mutable, registered, wire-addressable | ✅ Complete (Session 42) |
| `space-cameras.gltf` fixture | ✅ Complete (Session 42) |
| `Stage` — Three.js setup/tick/resize unification across 3 apps | ✅ Complete (Session 43) |
| `geometry-utils` — `threeGeometryToGltfPrimitive` + `buildAvatarDescriptor` | ✅ Complete (Session 43b) |
| `SOMCamera.node` back-reference | ✅ Complete (Session 44) |
| `NavigationController.activeCamera` + `camerachange` event | ✅ Complete (Session 44) |
| `Stage.setActiveCamera()` — Phase 1 scaffold | ⚠️ WIP (Session 44) — see Known Issues |
| Space-key camera cycling in `apps/client` | ⚠️ WIP (Session 44) — ortho↔perspective buggy |
| `activeCamera` Phase 2 — animated cameras, live per-tick reconcile | 🔜 Future session |
| Tier A `extras.atrium` hint schema | 🔜 Future |
| Three.js camera reconciliation to `SOMCamera` mutation state | 🔜 Future (part of Phase 2) |
| Renderer extraction Phase 2 (bootstrap + camera sync) | 🔜 Unbundled, pending camera work |
| External reference animations (Phase 6) | 🔜 Deferred |
| Pointer event bubbling | 🔜 Design-only until concrete use case |
| Networked interactivity (`ATRIUM_interactivity`) | 🔜 Awaits bubbling |
| `ATRIUM_world` glTF extension formalization | 🔜 Upcoming |
| Physics, persistence, permissions | 🔜 Future |

---

## Known Issues

### Active (carry-forward)

- **`activeCamera` Phase 1 — perspective/orthographic cycling is buggy.**
  After cycling through an orthographic camera and back to a perspective
  camera, the perspective view renders incorrectly (FOV, aspect, or camera
  type appears wrong). Root cause is the stale `camera` reference captured
  at startup in `app.js` via `const { scene: threeScene, camera } = stage`:
  `LabelOverlay`, `PointerInputBridge`, and potentially the render call hold
  the pre-swap reference after `setActiveCamera` replaces `this._camera`.
  Not fixed in Session 44 — intentionally deferred pending the Phase 2
  redesign, which will address this structurally by having all consumers
  read `stage.camera` dynamically rather than caching a destructured reference.

- **`activeCamera` Phase 2 redesign needed for animated cameras.** The
  Phase 1 model seeds nav state once at switch time and then runs nav
  freely from there. This is correct for static cameras but wrong for
  animated or dynamically-moved camera host nodes. Phase 2 redesign:
  `_syncCamera()` reads the bound camera's *current* world transform every
  tick as the base, applies nav's accumulated offset on top. This changes
  `_syncCamera()`'s structure (deliberately avoided in Phase 1) and is the
  correct long-term model. Phase 1 should be treated as a scaffold.

- **`window.atrium` namespace consolidation deferred.** `window.stage` and
  `window.atriumClient` are separate globals. `window.atrium = { client, stage }`
  was identified as the right shape but left for a future housekeeping pass.

- **Three.js camera not reconciled to `SOMCamera` mutation state.**
  `SOMCamera` mutations travel over the wire and apply to the glTF-Transform
  backing object, but live changes to `yfov`/`znear`/`zfar` etc. while a
  camera is active are not reflected in the viewport. Part of Phase 2.

- **Stage grid color changed `apps/client`'s appearance — undecided.**
  Session 43 migration: `apps/client` previously used grid colors
  `0x333333`/`0x222222`; `Stage` has no `gridColors` override option, so it
  now renders with the SOM inspector's colors (`0x1e293b`/`0x0f172a`)
  instead. Flagged during Session 43 review, smoke-tested and passed, but
  **the underlying question is still open**: add a `gridColors` option to
  `Stage` to restore `apps/client`'s original look, or accept this as the
  new shared default across all three apps. No decision yet — do not treat
  the smoke-test pass as having resolved this.

- **Stage `resize()` dropped the `setSize(w, h, false)` CSS-suppression
  flag — undecided.** All three apps previously called
  `renderer.setSize(w, h, false)` to prevent Three.js from also writing
  inline `style.width`/`style.height` on the canvas. `Stage.resize()` calls
  `setSize(w, h)` without that flag, per the brief's literal spec. Smoke
  tested and passed with no visible layout conflict, but the underlying
  question is still open. No decision yet.

- **`apps/playground` missing `@atrium/client/AvatarController` import map
  entry.** `Stage` unconditionally constructs `AvatarController` whenever
  `client` is passed — no opt-out exists — which surfaced as a
  module-resolution error in `apps/playground`. Deferred because playground
  works for its actual purpose (pointer events) without fixing this.

- **No wildcard import map coverage for `@atrium/renderer-three/` subpaths
  in `apps/client`.** Two back-to-back near-identical import map gaps
  (Sessions 43, 43b) indicate this should be fixed systemically. Add
  `"@atrium/renderer-three/": "../../packages/renderer-three/src/"` and
  equivalent `@atrium/client/` wildcard across all three apps' import maps.

- **`name` field intentionally omitted from `buildAvatarDescriptor`'s
  returned descriptor — reason unknown.** Predates Session 43/43b; carried
  forward as-is. `extras.displayName` is the active path. Backlog item:
  determine why `name` was disabled.

- **Animation late-joiner time-sync (smoke case 4) and live `loop: false`
  edit mid-play (smoke case 5) not regression-tested.** Deferred to
  full-system QA pass.

- **`buildClipsFromSOM` has no unit coverage.** Extracted Session 37 without
  tests. Clean testable seam at `packages/renderer-three/tests/build-clips.test.js`.

- **Pointer event bubbling not implemented** — leaf-only dispatch.

- **Hit-test resolves to invisible nodes.**

- **Property sheet doesn't update during drag.**

- **Morph-target (`weights`) animation tracks unhandled** by `buildClipsFromSOM`.

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
  the declared scope. Session 43b repeated this: Claude Code flagged the
  missing import-map wildcard rather than silently adding a one-off entry
  or silently changing the import style.
- **Implementation order.** Forces the brief author to sequence work.
- **Risks / watch-outs.** Catches bugs pre-implementation.
- **Acceptance criteria.** Reduces ambiguity about done.

### SOMLight arc lessons (Sessions 38–41)

- **Extension registration is an I/O concern, not just a SOM concern.**
  `KHRLightsPunctual` must be registered on both the server `NodeIO` and
  client `WebIO` read paths or authored data silently disappears.
- **The correct live analog for `getObjectByName`-resolved wire addressing
  is `SOMAnimation`, not `SOMMaterial`.**
- **Qualified alias must be stored on the wrapper at construction time.**
- **Always-on qualification.** The alias is created unconditionally, not
  collision-conditionally.
- **`som:add` does not carry extension data.** Lights and cameras cannot
  arrive via `som:add`; only node descriptors travel that path.

### SOMCamera arc lessons (Session 42)

- **Watch for latent partial wiring in `_attachNodeListeners`.** An old
  camera listener was already present, routing via
  `node: nodeName, field: 'camera.yfov'` — wrong wire address, and would
  have double-dispatched with the new alias-based listener. Removed in
  Session 42.
- **Core glTF types need no extension registration.**
- **`_cameraMap` vs `_cameras`.** Same split as `_lightMap` / `_lights`.

### Stage arc lessons (Session 43)

- **"Design before code" caught a real ambiguity before it became rework.**
- **A copy-pasted code block is sometimes "the same pattern," sometimes
  "the same pattern with a deletion."**
- **A literal-compliance brief detail can hide a behavior change.**
- **"Always construct X" can break an app that wanted a different subset.**

### geometry-utils arc lessons (Session 43b)

- **Splitting a single-use function into generic + specific layers is
  worth doing even with no duplication to resolve.**
- **"Carry forward as-is, don't investigate" is a legitimate brief
  instruction — provided the omission is also turned into a permanent,
  visible artifact.**
- **Two structurally identical import-map gaps surfacing in back-to-back
  sessions is a pattern, not a coincidence.**

### activeCamera arc lessons (Session 44)

- **Phase 1 / Phase 2 staging was the right call.** The VRML Viewpoint
  model clarified that correct handling of animated cameras requires
  `_syncCamera()` to read the live host node transform every tick — not just
  at seed time. Recognizing this mid-session and deliberately staging the
  work (scaffold now, redesign later) was better than either over-engineering
  Phase 1 or shipping a known-wrong model as final.
- **`@gltf-transform/view` v4 has no `CameraSubject`.** Camera-bearing nodes
  get a plain `THREE.Object3D` (via `NodeSubject`) like any other node.
  There is no auto-instantiated `THREE.Camera` in the scene graph. Stage
  constructs and owns the live Three.js camera entirely.
- **Destructured Three.js object references go stale on camera swap.**
  `const { camera } = stage` captures the reference once; after
  `setActiveCamera` swaps `this._camera`, all holders of the old reference
  silently diverge. All consumers of `stage.camera` must read it
  dynamically — either via getter each frame, or re-extract on every
  `camerachange` event. This is the root cause of the Phase 1
  perspective/orthographic cycling bug.
- **`NavigationController` should stay free of Three.js dependencies.**
  World-transform composition (ancestor chain, quaternion decomposition)
  belongs in Stage, which has `sceneGroup`. Nav receives plain number seeds
  (yaw, pitch, orbitTarget components) — it never touches a `THREE.Object3D`.
- **Resist over-designing before the full model is clear.** This session
  spent productive time working through VRML precedent, Model A vs B,
  bind stacks, per-camera drift memory, and world-transform resolution —
  all of which converged on a simpler answer each time. The design
  conversation was worth having even when the conclusion was "simpler than
  we thought."

---

## Backlog (Prioritized)

### Immediate

- **`activeCamera` Phase 2.** Fix the stale-camera-reference bug
  structurally; redesign `_syncCamera()` to read the bound camera's live
  world transform every tick as the base (with nav offset applied on top);
  support animated cameras. This also resolves the `window.atrium`
  namespace consolidation and the `LabelOverlay`/`PointerInputBridge`
  stale-reference issue. Own design session.
- **Fix import map wildcard coverage across all three apps.** Two
  back-to-back near-identical gaps indicate this should be fixed
  systemically. Add `"@atrium/renderer-three/": "../../packages/renderer-three/src/"`
  and the equivalent `@atrium/client/` wildcard to all three apps' import maps.
- **Decide: `Stage` `AvatarController` opt-out.** Should `Stage` make
  `AvatarController` construction conditional? Directly caused the
  `apps/playground` import map crash.
- **Decide: `Stage` grid color.**
- **Decide: `Stage.resize()` `setSize` CSS-suppression flag.**
- **Full-system QA pass.** Validates Session 37 deferrals (smoke cases 4
  and 5: late-joiner time-sync, live `loop: false` mid-play).

### High impact

- **`buildClipsFromSOM` unit tests.**
- **Server test harness batch-mode fix.**
- **Drag UX polish.**
- **Investigate disabled `name` field in `buildAvatarDescriptor`.**

### Larger work

- **Tier A `extras.atrium` hint schema.** Field names for lighting hints and
  `activeCamera` reference. Own design session.
- **`ATRIUM_interactivity` extension.**
- **Pointer event bubbling design + implement.**
- **External reference animations (Phase 6).**
- **Real content stress testing.**

### Deferred

- Touch / pen pointer events; nested external references; dedicated
  `reference:error` event; drag-and-drop "add to scene"; `.atrium.json`
  auto-connect; `ATRIUM_world` glTF extension; dead reckoning; collision /
  physics; viewpoints; `@atrium/som` npm publish; README updates; animation
  blend weights; morph-target tracks; animation grouping; sticky-stop
  semantics; undo/redo; SOM Inspector camera picker UI.

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

# start a world server (camera world — recommended for activeCamera smoke)
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
- `Project_Atrium_2026-06-14.md` — Sessions 1–41 canonical (superseded)
- `Project_Atrium_2026-06-15.md` — Sessions 1–42 canonical (superseded)
- `Project_Atrium_2026-06-17.md` — Sessions 1–43b canonical (superseded by this document)

### Design documents (folded into prior handoffs)
- `DESIGN-Rendering-Independence.md` — three-tier model, SOMLight/SOMCamera/Stage design
- `DESIGN-SOMLight-Naming.md` — aliasing scheme, qualified alias, collision handling

### Stage arc (Session 43)
- `SESSION-43-Stage-brief.md` — design brief
- `SESSION-43-Stage-log.md` — build log
- `SESSION-43-Stage-smoke-test-plan.md` — regression-focused manual smoke test plan
- `SESSION-43-backlog-addendum.md` — folded into this document's Backlog and Known Issues

### geometry-utils arc (Session 43b)
- `SESSION-43b-geometry-utils-brief.md` — design brief
- `SESSION-43b-geometry-utils-log.md` — build log

### SOMCamera arc (Sessions 42, 44)
- `SESSION-42-SOMCamera-brief.md` — implementation brief
- `SESSION-42-SOMCamera-log.md` — build log
- `BRIEF-Session44-activeCamera.md` — design brief
- `Session44-activeCamera-log.md` — build log

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
