# Project Atrium
## 2026-06-20 · As of Session 46

This document is the canonical project handoff. It supersedes
`Project_Atrium_2026-06-18.md` (Sessions 1–44) **and** fully folds in
`HANDOFF-Session45-45a-addendum.md` (Sessions 45, 45a), which is now
retired — its content lives in this document and it should not be read
alongside this one. This document is self-contained — the next session
does not need any predecessor. Prior handoffs are retained in the repo as
historical record.

**This handoff opens with an active, unresolved bug under investigation.**
See "Known Issues → 🔴 Active Investigation" below before doing anything
else with camera navigation.

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
│   ├── renderer-three/  # Three.js-specific glue (Sessions 34, 37, 43, 43b, 45, 45a)
│   │                    #   PointerInputBridge, drag-math, hit-test,
│   │                    #   AnimationBridge, buildClipsFromSOM,
│   │                    #   initDocumentView, loadBackground,
│   │                    #   Stage (Session 43; activeCamera Phase 2 — Sessions 45, 45a),
│   │                    #   geometry-utils (Session 43b)
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── apps/
│   ├── client/          # Browser UI shell — Three.js viewport, navigation, avatars
│   │   │                #   Default navMode: WALK
│   │   ├── index.html
│   │   └── src/
│   │       ├── app.js
│   │       └── LabelOverlay.js
│   └── playground/      # Pointer-event test bench (Session 34)
├── tools/
│   ├── protocol-inspector/index.html   # Single-file interactive protocol debugger
│   └── som-inspector/                  # SOM Inspector
│       │                # navMode: ORBIT (default). Active-camera switching UI
│       │                #   added Session 46 — toolbar dropdown, PropertySheet
│       │                #   button, status-bar indicator.
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
│   ├── DESIGN-*.md                     # Design documents (rendering independence,
│   │                                   #   SOMLight naming, avatar navigation, etc.)
│   ├── Project_Atrium_*.md             # Historical/canonical handoffs
│   └── sessions/                       # A handful of early smoke-test logs
│                                       #   (Sessions 39–40 only — see note below)
└── claude-sessions/                    # Design briefs + build logs — primary location
                                        #   for session artifacts from ~Session 02 on
```

> **Correction from the prior handoff:** the repository tree previously
> listed session artifacts as living solely under `docs/sessions/`. In
> practice, the vast majority live in `claude-sessions/` at the repo
> root; `docs/sessions/` holds only two early smoke-test logs. Fixed here
> for accuracy — no repo change needed, this was a documentation error.

---

## Test Counts (after Session 46)

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

No new automated tests were added in Sessions 45, 45a, or 46. The
`activeCamera` path (and the SOM Inspector UI built on top of it in
Session 46) requires a live `sceneGroup` populated by
`@gltf-transform/view`'s `DocumentView` — not unit-testable without
DOM/WebGL. Behavior is validated by manual smoke testing against
`space-cameras.gltf`.

> **Action item:** server tests don't run cleanly in batch mode —
> `session.test.js` opens port 3001 and hangs `pnpm --filter
> @atrium/server test`. Individual files run fine. Known intermittent;
> harness fix (teardown issue) is a small hygiene item for a future session.

> **Process note:** build logs have misreported test counts in past
> sessions. Briefs must require full recursive test output, not summary
> numbers, and reconcile the total against the prior baseline. Sessions
> 45, 45a, and 46 all did this correctly — 432/432, reconciled.

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

> **Caution for UI code resolving cameras by name:** because of the
> collision rule above, a global `getObjectByName()` lookup is not safe
> for resolving a *camera specifically* when a node might share its name
> (the deliberate `MainCamera`/`OrthoCamera` collision case in
> `space-cameras.gltf` exists to exercise exactly this). SOM Inspector's
> camera-switcher dropdown (Session 46) resolves by index into
> `som.cameras` instead of by name, sidestepping this entirely. Prefer
> that pattern for any future UI that needs to pick a specific camera.

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
camera.rawCamera         // THREE.Camera | null — renderer-populated slot (Session 45)

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

`rawCamera` is deliberately renderer-neutral in name (not `_threeCamera`) —
see the `activeCamera` section below for what populates it and when.

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

## `activeCamera` (Sessions 44, 45, 45a, 46)

A mechanism for selecting which glTF-authored `SOMCamera` the viewport
renders through, with user navigation continuing relative to that camera.
The design reference throughout has been the VRML Viewpoint model: once a
Viewpoint is bound, all subsequent changes to its coordinate system change
the user's view automatically.

### Design history (context, not current behavior)

Session 44 shipped a **Phase 1 scaffold**: nav state was seeded once, at
switch time, from the camera's authored world transform, then nav ran
freely from there. This worked for static cameras but couldn't support
animated camera host nodes, and shipped with a known bug (perspective ↔
orthographic cycling produced a visibly wrong view) traced to stale
destructured `camera` references in `apps/client`. Both were deliberately
deferred as a Phase 2 redesign rather than patched in place — staging it
this way (working scaffold now, structural fix later) was judged better
than either over-engineering Phase 1 or shipping a known-wrong model as
final, and that judgment held up.

**Phase 2 is now built (Sessions 45, 45a)** and is the current model,
described below. Phase 1's two known issues are both resolved as a
consequence of the redesign, not patched separately.

### Current architecture (Phase 2)

`@gltf-transform/view` v4 has no `CameraSubject` — camera-bearing nodes
get a plain `THREE.Object3D` like any other node; there is no
auto-instantiated `THREE.Camera` in the scene graph. `Stage` constructs
and owns the live Three.js cameras entirely:

- **One real, persistent `THREE.PerspectiveCamera`/`THREE.OrthographicCamera`
  per `SOMCamera`**, constructed in `Stage.setSceneGroup()` and parented
  directly under that camera's host node `Object3D`. This makes
  animated-host-node following automatic via Three.js's normal
  `updateMatrixWorld()` cascade — no bespoke per-tick reconciliation needed
  for that part. The populated camera is stored on `somCamera.rawCamera`.
- **The parented camera's local transform is reserved entirely for nav's
  offset.** Nothing else reads or writes it — glTF's camera/node split
  means transform and lens are different objects, so this is free real
  estate. World transform = host node's `matrixWorld` (animation-driven or
  static) × nav's local offset, composed automatically by Three.js.
- **`Stage._syncCamera()` converts world-space nav state to the bound
  camera's local space every tick** — not just once at bind time — via
  `parent.matrixWorld.invert()` for position and quaternion-inverse-and-
  multiply for orientation. This is what makes Phase 2 correct for
  animated host nodes in principle: the per-tick conversion automatically
  picks up wherever the host node's `matrixWorld` currently is.
- **`NavigationController` stays world-space and Three.js-free.** It never
  touches a `THREE.Object3D`. `Stage` does all world-to-local conversion,
  since it's the layer that has `sceneGroup`.
- **The default Tier-C camera is a persistent object**, not reconstructed
  on `setActiveCamera(null)`, but it is **not** parented — left
  free-standing, positioned directly by nav, same as before Phase 2.
- **Per-camera `mutation` event listeners**, wired in `setSceneGroup`, keep
  the live Three.js lens in sync with `SOMCamera` property changes
  (`yfov`, `znear`, `zfar`, `aspectRatio`, `xmag`, `ymag`) while that camera
  is active or inactive — this resolves the old "Three.js camera not
  reconciled to SOMCamera mutation state" issue.
- **`_viewportAspect` (Session 45a)** is the single shared source of
  viewport aspect, updated on every `resize()` call and consumed at two
  sites: per-camera construction in `setSceneGroup` (so a camera gets the
  correct aspect from the moment it's built, not a hardcoded `1`) and
  `setActiveCamera`'s non-null path (aspect re-pushed at activation,
  guarded by `instanceof THREE.PerspectiveCamera`). This fixed a bug where
  the first-ever switch to a perspective camera in a session rendered
  with a visibly wrong aspect ratio until the next window resize, and
  where any camera inactive during a resize kept a stale aspect
  indefinitely.

**Stale destructured references — now a recognized recurring bug class.**
The Phase 1 cycling bug, the original root cause, was `const { camera } =
stage` capturing a value once; after `setActiveCamera` swaps `this._camera`,
all holders of the old reference silently diverge. Session 45 fixed this
structurally in `apps/client`, `LabelOverlay`, and `PointerInputBridge` via
a live-read getter pattern (`PointerInputBridge` now accepts `camera` as
either a `THREE.Camera` or a getter function, `() => stage.camera`).
**Session 46 found the same bug, independently, in `tools/som-inspector/
src/app.js`** — `const { scene: threeScene, camera } = stage` — latent
since SOM Inspector had no way to call `setActiveCamera()` before Session
46 added one. Fixed the same way. This is the third occurrence of this
exact bug shape; see Working Notes for the lesson.

### SOM Inspector camera-switching UI (Session 46)

Three UI surfaces in `tools/som-inspector`, all routed through one
`applyActiveCamera()` helper in `app.js` so they can't drift out of sync:

- **Toolbar dropdown** (`#camera-switcher`, next to `#mode-switcher`) —
  lists `Default` plus every `som.cameras` entry, rebuilt on every
  `world:loaded`. Resolves by array index, not name (see the namespace
  caution above).
- **Per-camera button** in `PropertySheet`'s Camera section — toggles the
  camera active/inactive. `PropertySheet`'s constructor takes
  `isActiveCamera`/`onSetActiveCamera` callbacks; the button's render
  function is pushed onto the existing `_updaters` mechanism, so it
  updates for free whenever `propSheet.refresh()` runs.
- **Status-bar indicator** — a separate `#camera-indicator` child element
  inside `#status-bar`, independent of `updateStatusBar()`'s existing call
  sites, showing `🎥 <name>`. Kept separate deliberately so unrelated
  status updates (connection state, world name, load errors) can't clobber
  it.

`PropertySheet` also gained `xmag`/`ymag` rows in the Camera section
(Session 46) — these were missing entirely despite `SOMCamera` supporting
them since Session 42. Scope was deliberately additive only: the
pre-existing, separate issue where the `Y-FOV` row still renders
unconditionally for orthographic cameras was found but not fixed, per the
brief's explicit non-goal.

### Known limitation — nested/animated host nodes

The per-tick world-to-local conversion in `_syncCamera()` is written to
generalize to animated parents structurally, but two things remain
genuinely unverified or unresolved, independent of each other:

1. **ORBIT under a moving (animated) parent — design question, not yet
   settled.** Does ORBIT's world-space orbit-target concept even make
   sense while the camera's parent is rotating under it, or should ORBIT
   be disabled/suspended automatically when bound to a camera whose host
   node has an active animation clip? Explicitly out of scope for Sessions
   45, 45a, and 46. Needs its own design conversation before any brief.
2. **The Session 46 fixture built to eventually test (1) has a gap.**
   `AnimatedCameraMount` was given a compound (non-axis-aligned) bind-pose
   rotation specifically to avoid a single-axis rotation masking a math
   bug — but glTF animation channels set *absolute* values, not deltas
   relative to a node's static bind pose. Because `CameraMountRotate`'s
   keyframes mirror `CrateRotate`'s pure-Y-axis pattern, the moment the
   clip plays, the node's rotation snaps to pure-Y and stays pure-Y for
   the whole clip — the compound tilt only exists before Play is ever
   pressed. This doesn't block what Session 46 needed (visual confirmation
   that the camera follows its moving parent at all — confirmed working),
   but it means this fixture, as authored, won't usefully stress-test (1)
   without re-authoring the keyframes to bake the tilt in throughout (e.g.
   `pitch_offset * yaw(t)` per sample), not just at the bind pose. Whoever
   picks up the design question in (1) should decide whether to fix this
   fixture or build a fresh one.

---

## 🔴 `activeCamera` — Active Investigation: Camera Position/Orientation Bug

**Status as of this handoff: hypothesis traced through the code, not yet
verified live, not yet fixed.** Flagged by manual testing after Session
46: camera position and orientation "not at all what I would expect"
when navigating with the sample client, suspected to be a long-standing
bug, not a Session 46 regression. SOM Inspector's own Session 46 testing
(switching, state sync, animation playback, the new fixtures) all checked
out fine — see above — which turns out to be a clue, not a contradiction.

### The hypothesis

**`Stage.setActiveCamera()` seeds orientation but never seeds position for
WALK/FLY mode.** When binding to a `SOMCamera`:

```javascript
const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ')
this._nav.yaw   = euler.y
this._nav.pitch = euler.x

if (this._nav.mode === 'ORBIT') {
  // ... seeds orbitTarget, orbitRadius, orbitAzimuth, orbitElevation ...
}
```

Yaw/pitch are seeded unconditionally. Position is seeded **only inside the
`ORBIT` branch**, via `orbitTarget`. In WALK or FLY mode, nothing in
`setActiveCamera` touches the avatar's position at all.

This matters because of how `_syncCamera()` computes the eye position
every tick:

- **ORBIT mode:** `NavigationController.tick()` recomputes `localNode.translation`
  fresh every frame from `orbitAzimuth`/`Elevation`/`Radius`/`Target` — and
  those values *were* seeded correctly. The spherical-to-Cartesian
  round-trip was independently re-derived by hand in chat and confirmed to
  reproduce the camera's exact authored world position and orientation
  (for non-rolled cameras). **ORBIT is believed correct.**
- **WALK/FLY mode:** position comes from `localNode.translation` directly,
  and `NavigationController.tick()`'s WALK/FLY branch only ever *moves*
  that value in response to WASD input — it never re-derives it from
  anything camera-related. After `setActiveCamera`, the eye position is
  whatever the avatar happened to be standing at before the switch,
  completely disconnected from the bound camera's authored position.
  Orientation matches; position doesn't.

**Why this escaped Session 46's testing:** SOM Inspector defaults to
`navMode: 'ORBIT'`. `apps/client` does not override `navMode` and so
defaults to `Stage`'s default, **WALK** — precisely the mode where this
gap exists. The bug is suspected to be visible (and possibly worse) in
`apps/client`, which is why debugging should start there.

**Predicted concrete symptom:** in `apps/client` (WALK mode), switch to
`MainCamera` (authored at `[0, 2, 8]`) — the view should look in roughly
the right *direction* but sit at wherever the avatar was last standing
(e.g. near spawn), not at `[0, 2, 8]`.

### What has *not* yet been checked

This hypothesis explains one concrete, structural gap, but the person
reporting the bug suspects something has been wrong "from the very
beginning" — meaning there may be more than one issue stacked together.
Not yet audited:

- The **default free camera's** own WALK/FLY math when `activeCamera` is
  `null` (i.e. ordinary first-person/avatar navigation, unrelated to
  `SOMCamera` binding at all).
- The **third-person camera-offset rig** from Session 14
  (`_avatar._cameraOffsetY`/`_cameraOffsetZ`, the `hasOffset` branch in
  `_syncCamera`).
- Whether the same position-seeding gap, or a variant of it, also affects
  **FLY mode** specifically (the hypothesis above covers WALK and FLY
  together, since both fall through the same `else` branch in
  `_syncCamera`, but only WALK has been reasoned through in detail).

### Next steps (for the next session)

1. Verify the hypothesis directly: in `apps/client`, switch to `MainCamera`
   while in WALK mode and confirm whether position matches `[0, 2, 8]` or
   stays near wherever the avatar was standing.
2. If confirmed, continue auditing rather than fixing immediately — there
   may be compounding issues in the default-camera and third-person-offset
   paths noted above.
3. This is a chat-design-conversation-first item, same as every other arc
   in this project — once the audit is complete, it becomes a debugging
   brief for Claude Code, not something to patch ad hoc.

---

## `@atrium/renderer-three` — Stage (Session 43; `activeCamera` Phase 2 — Sessions 45, 45a)

`Stage` is a Tier C tenant of `packages/renderer-three`, alongside
`AnimationBridge` and `PointerInputBridge`. It absorbs the Three.js setup,
resize, and tick logic that was previously copy-pasted across `apps/client`,
`tools/som-inspector`, and `apps/playground`.

### Construction

```javascript
const stage = new Stage(container, options)
```

`options` (all optional): `client`, `cameraOffsetY`/`cameraOffsetZ`, `nav`
(bool, default `true`), `navMode` (default `'WALK'`), `navMouseSensitivity`,
`animCtrl` (bool, default `true`), `animBridge` (bool, default `true`),
`backgroundColor`, `cameraFov`/`cameraNear`/`cameraFar`/`cameraPosition`,
`antialias`, `shadows`, `grid` (bool),
`ambientLightColor`/`ambientLightIntensity`,
`sunColor`/`sunIntensity`/`sunPosition`.

Construction order: `WebGLRenderer` → canvas focusability → `Scene` (bg,
ambient light, directional light, optional `GridHelper`) →
`PerspectiveCamera` (the persistent Tier-C default) → if `client` provided:
`AvatarController` (always, not optional — see Known Issues), then
`NavigationController` (if `nav`), then `AnimationController` (if
`animCtrl`).

`AnimationBridge` cannot be constructed at Stage-construction time — it
needs `sceneGroup` from `initDocumentView`, which only exists after
`world:loaded`. The app must call:

```javascript
stage.setSceneGroup(sceneGroup)
```

from its own `world:loaded` handler, after calling `initDocumentView`
itself. `setSceneGroup` disposes any previous bridge and any previous
per-camera mutation listeners, constructs a new `AnimationBridge`, calls
`init()` + `replayPlayingAnimations()` if `client.som` is already available
(handles reconnect / re-load), then builds the persistent per-`SOMCamera`
`THREE.Camera` objects described in the `activeCamera` section above.

### Public API

```javascript
stage.renderer / stage.scene / stage.camera   // Three.js objects — camera is a live getter
stage.avatar / stage.nav / stage.animCtrl / stage.animBridge  // controllers, nullable
stage.setSceneGroup(sceneGroup)
stage.setActiveCamera(somCamera)    // Sessions 44, 45, 45a — see activeCamera section
stage.tick(dt)        // app calls this every frame from its own rAF loop
stage.resize(width, height)
```

**`stage.camera` is a live getter — never destructure it once and cache
it.** See "Stale destructured references" above; this is now a
three-times-recurred bug class.

`rAF` ownership stays with the app — Stage exposes `tick(dt)`, it does not
run its own loop. This lets apps control ordering (e.g. `apps/client` calls
`labels.update()` immediately after `stage.tick(dt)`, so label projection
uses the post-camera-sync frame position).

`stage.tick(dt)` is fully null-safe: it calls `nav.tick`, `animCtrl.tick`,
`animBridge.update` only if each is present, then runs internal camera sync
(`_syncCamera()` — branches on `nav.mode` for ORBIT vs. WALK/FLY, and on
whether `nav.activeCamera` is set for world-space-direct-write vs.
parent-relative conversion — see the active-investigation section above
for a known gap in this method), then `renderer.render()`.

### Migration status

All three consumers migrated:
- `apps/client` — full controller set, `LabelOverlay` stays app-level,
  default `navMode` (WALK) — **the active-investigation bug above is
  expected to be most visible here.**
- `tools/som-inspector` — `navMode: 'ORBIT'`, `navMouseSensitivity: 0.005`,
  no `LabelOverlay`; gained active-camera switching UI in Session 46 (see
  `activeCamera` section)
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
| `space-cameras.gltf` | Session 42, extended Session 46 — space.gltf geometry + `MainCamera`/`OrthoCamera` (collision-name pattern, unchanged since Session 42) **+ `NestedCameraMount`→`NestedCamera`** (static, compound non-identity parent rotation — exercises ORBIT under a real non-identity ancestor) **+ `AnimatedCameraMount`→`AnimatedCamera`** (animated parent, `CameraMountRotate` clip, not autoplay) — both new cameras perspective. See `activeCamera` section above for the known gap in the animated fixture's keyframe authoring. |

`space-lights.gltf` is generated by `generate-space-lights.js`.
`space-cameras.gltf` is generated by `generate-space-cameras.js` (reads
`space.gltf` via `NodeIO`, adds core-glTF cameras + the Session 46 fixture
chains and animation, writes result — no extension registration required;
new animation accessors reuse the document's existing single buffer).

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
| `apps/client` — full UI | ✅ Complete — **but see active camera-position investigation above** |
| `apps/playground` — pointer test bench | ✅ Complete (Session 34) |
| SOM Inspector — full tool, now incl. active-camera switching | ✅ Complete (Session 46 addition) |
| `@atrium/renderer-three` — PointerInputBridge + AnimationBridge + helpers | ✅ Complete (Sessions 34, 37) |
| `@atrium/interaction` — selection model | ✅ Complete (Session 35) |
| Renderer-coupling audit | ✅ Complete (Session 36) |
| `SOMLight` — KHR_lights_punctual, mutable, networked, late-joiner synced | ✅ Complete (Sessions 38–41) |
| Server `KHRLightsPunctual` IO registration | ✅ Complete (Session 39) |
| `AtriumClient` light mutation listener wiring | ✅ Complete (Session 40) |
| `space-lights.gltf` fixture | ✅ Complete (Session 41) |
| `SOMCamera` — mutable, registered, wire-addressable | ✅ Complete (Session 42) |
| `space-cameras.gltf` fixture | ✅ Complete (Session 42); extended (Session 46) |
| `Stage` — Three.js setup/tick/resize unification across 3 apps | ✅ Complete (Session 43) |
| `geometry-utils` — `threeGeometryToGltfPrimitive` + `buildAvatarDescriptor` | ✅ Complete (Session 43b) |
| `SOMCamera.node` back-reference | ✅ Complete (Session 44) |
| `NavigationController.activeCamera` + `camerachange` event | ✅ Complete (Session 44) |
| `activeCamera` Phase 2 — persistent parented per-camera objects, per-tick world-to-local sync | ✅ Complete (Sessions 45, 45a) |
| Perspective/orthographic cycling bug (Phase 1) | ✅ Fixed (Session 45, structural live-read getter fix) |
| Per-camera aspect-ratio bug (first-switch-ever, stale-while-inactive) | ✅ Fixed (Session 45a) |
| Three.js camera reconciliation to `SOMCamera` mutation state | ✅ Complete (Session 45, per-camera mutation listeners) |
| SOM Inspector active-camera switching UI (dropdown + button + indicator) | ✅ Complete (Session 46) |
| `PropertySheet` orthographic `xmag`/`ymag` rows | ✅ Complete (Session 46) |
| Nested camera fixture (static, non-identity parent) | ✅ Complete + manually verified (Session 46) |
| Animated camera-host-node fixture | ✅ Complete; basic "follows parent" behavior manually verified (Session 46) — **see known gap re: keyframe authoring for future ORBIT-under-motion testing** |
| **Camera position/orientation correct when bound to a `SOMCamera` in WALK/FLY mode** | 🔴 **Suspected broken — active investigation, hypothesis traced, not yet confirmed or fixed** |
| ORBIT under a moving/animated parent | 🔜 Future, own design session |
| Tier A `extras.atrium` hint schema | 🔜 Future |
| Renderer extraction Phase 2 (bootstrap + camera sync) | 🔜 Unbundled, pending camera work |
| External reference animations (Phase 6) | 🔜 Deferred |
| Pointer event bubbling | 🔜 Design-only until concrete use case |
| Networked interactivity (`ATRIUM_interactivity`) | 🔜 Awaits bubbling |
| `ATRIUM_world` glTF extension formalization | 🔜 Upcoming |
| Physics, persistence, permissions | 🔜 Future |

---

## Known Issues

### 🔴 Active Investigation (read this first)

- **Camera position not seeded for WALK/FLY mode in `Stage.setActiveCamera()`.**
  See the dedicated section above. Orientation is seeded correctly in all
  modes; position is only seeded for ORBIT (via `orbitTarget`). In WALK/FLY,
  binding to a `SOMCamera` leaves the eye position wherever the avatar was
  already standing, disconnected from the camera's authored position.
  Hypothesis traced through the code and judged internally consistent by
  hand-checking the math; **not yet verified against a live run, and the
  rest of the WALK/FLY camera pipeline (default free camera, Session 14
  third-person offset rig) has not yet been audited for related issues.**
  Suspected by the reporting user to predate this session. Start any
  investigation in `apps/client` (default `navMode: 'WALK'`), not SOM
  Inspector (defaults to `ORBIT`, where this gap doesn't manifest).

### Active (carry-forward)

- **`window.atrium` namespace consolidation deferred.** `window.stage` and
  `window.atriumClient` are separate globals. `window.atrium = { client, stage }`
  was identified as the right shape but left for a future housekeeping pass.
  Not addressed in Sessions 45, 45a, or 46.

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

- **`_viewportAspect`'s constructor default of `1` is unverified dead code
  (probably).** Safe only if `Stage.resize()` is guaranteed to run at
  least once before any camera construction/activation. An `app.js` init
  snippet was confirmed to call `resize()` synchronously at setup, but
  whether this runs *before* `setSceneGroup`/world-load in each app's
  overall init order was never confirmed. **Still not checked** — carried
  forward from the Session 45/45a addendum unchanged; not addressed in
  Session 46.

- **OrthographicCamera view-volume does not rescale with viewport resize.**
  Confirmed pre-existing, not a regression. `left/right/top/bottom` vs.
  viewport aspect is a separate, larger design question (fixed glTF-authored
  ortho bounds regardless of window size, or rescale?). Needs a decision,
  not just an implementation. Not addressed in Session 46.

- **`PropertySheet`'s `Y-FOV` row still renders unconditionally for
  orthographic cameras.** Found while adding `xmag`/`ymag` rows (Session
  46); explicitly left out of that session's scope as a non-goal. Clean
  improvement, but a UI-restructuring question for its own brief.

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

### Resolved this arc (Sessions 45, 45a, 46)

- ~~**`activeCamera` Phase 1 — perspective/orthographic cycling is buggy.**~~
  Fixed Session 45 — root cause (stale destructured `camera` references)
  structurally removed via live-read getter pattern across `app.js`,
  `LabelOverlay`, `PointerInputBridge`.
- ~~**`activeCamera` Phase 2 redesign needed for animated cameras.**~~ Built,
  Sessions 45/45a. (ORBIT-under-a-*moving*-parent specifically remains its
  own open design question — see above — but the redesign itself, parented
  persistent cameras with per-tick world-to-local sync, is done.)
- ~~**Three.js camera not reconciled to `SOMCamera` mutation state.**~~
  Fixed Session 45 — per-camera `mutation` event listeners wired in
  `setSceneGroup`.
- ~~**First switch to a perspective `SOMCamera` renders with wrong aspect
  ratio; stale aspect while inactive during a resize.**~~ Fixed Session 45a.
- ~~**SOM Inspector has no way to activate a `SOMCamera`.**~~ Built Session
  46 — toolbar dropdown, PropertySheet button, status-bar indicator.
- ~~**No `xmag`/`ymag` editor in PropertySheet's Camera section.**~~ Fixed
  Session 46.
- ~~**Same stale-destructured-reference bug, independently, in SOM
  Inspector's `app.js`.**~~ Found and fixed Session 46.

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
14. **Never cache a live Three.js handle by destructuring it once.** Any
    value that can be swapped at runtime (`stage.camera`, most notably) must
    be read through a getter or a getter-function at the point of use, every
    time. This bug shape has now recurred three times (Sessions 44, 45, 46)
    in three different files — it has graduated from "a bug we fixed" to a
    standing design rule.

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
  or silently changing the import style. Session 46 repeated it again:
  Claude Code found the orthographic Y-FOV display gap while adding
  xmag/ymag, and flagged it in the log rather than fixing it, per the
  brief's explicit scope boundary.
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

### activeCamera Phase 1 arc lessons (Session 44)

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
  See the Key Design Principles entry above — this lesson has since
  recurred twice more.
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

### activeCamera Phase 2 arc lessons (Sessions 45, 45a)

- **Staging paid off a second time.** The Phase 2 design conversation
  surfaced a real divergence from the brief mid-build: the brief
  anticipated a "world-space eye transform" accessor on
  `NavigationController`; Claude Code found the existing `_syncCamera()`
  computation depends on avatar state nav doesn't hold, and correctly
  invoked the brief's stop-and-flag condition rather than restructuring
  nav to accept an avatar reference. The computation stayed inline.
- **A renaming/renumbering convention needs to be explicit, not implicit.**
  `BRIEF-Session46-camera-aspect-fix.md`'s content was renumbered to
  Session 45a (a sub-session of 45) by the user before running, with the
  filename and the log's session number deliberately not matching — the
  log is authoritative. Worth stating outright in any future
  renumbering: which artifact wins.
- **A smoke test's "Step 0" fixture pre-flight can retroactively
  invalidate what a prior step appeared to verify.** The Session 45
  smoke plan's Step 0 confirmed `space-cameras.gltf` only had identity
  parents — meaning the "ORBIT works for a static camera" claim had
  never actually been exercised against a non-identity ancestor, despite
  looking verified. This is exactly why Session 46's new fixture work
  specified a *compound* rotation rather than trusting any rotation to
  be a sufficient test.

### SOM Inspector + nested/animated fixture arc lessons (Session 46)

- **A single-axis 90°-multiple rotation can make a fixture look like it
  tests matrix-inversion math without actually doing so** — the columns
  of an axis-aligned rotation matrix factor too cleanly to reliably catch
  a sign or order bug. Both new mount nodes in `space-cameras.gltf` use
  compound (multi-axis) rotations specifically to avoid this; the
  rotation quaternions were independently hand-derived and verified in
  chat before accepting the build log's numbers.
- **glTF animation channels set absolute values, not deltas relative to a
  node's static bind pose — and a brief's phrasing can smuggle in the
  wrong mental model.** The Session 46 brief described the animated
  fixture's keyframes as "identity-relative-to-bind-pose," which isn't
  achievable in glTF's actual semantics; Claude Code correctly implemented
  the literal, achievable instruction (absolute keyframes matching
  `CrateRotate`'s pattern), which is technically correct but means the
  fixture's compound bind-pose tilt is invisible the moment the animation
  plays. The bug, such as it is, originated in the brief's own framing, not
  in the implementation of it — worth remembering when a brief author
  reviews a build log: literal compliance with a flawed instruction can
  look like success.
- **SOM Inspector and `apps/client` diverge on default `navMode` (ORBIT vs.
  WALK), and that divergence is exactly where a real bug hid.** Camera
  switching, state sync, and animation playback all checked out in SOM
  Inspector's manual testing this session — and that testing was
  legitimate and thorough — but it exercised only ORBIT mode, where (per
  the active investigation above) the position-seeding gap in
  `setActiveCamera` doesn't manifest. A feature "working" in the tool
  built to test it doesn't mean it works in the app it's ultimately meant
  to serve, if the two default to different code paths.

---

## Backlog (Prioritized)

### Immediate

- **🔴 Camera position/orientation debugging arc.** See the dedicated
  Known Issues section above. Start in `apps/client` (WALK mode) to verify
  the position-seeding hypothesis, then audit the default free camera's
  WALK/FLY math and the Session 14 third-person offset rig for related
  issues before writing any fix brief. Suspected by the reporting user to
  be long-standing, not a regression — treat as a chat-design-conversation
  item first, same as every other arc, not something to patch ad hoc.
- **ORBIT under a moving/animated parent — design question.** Does ORBIT's
  world-space orbit target even make sense while the parent is animating,
  or should ORBIT auto-suspend when bound to a camera whose host node has
  an active clip? Needs its own design session (carried forward from the
  Session 45/45a addendum, now joined by the Session 46 finding that the
  fixture meant to support this work needs re-authoring first — see Known
  Issues).
- **Confirm `app.js`'s init order** — does `onResize()` run before or after
  `setSceneGroup`/world-load, in each app? Closes out the
  `_viewportAspect` default-value question. Quick check, not a brief —
  carried forward unaddressed since the Session 45/45a addendum.
- **`PropertySheet` Y-FOV row hidden for orthographic cameras.** Small,
  clean, flagged-not-fixed in Session 46. Candidate for folding into
  whatever session next touches `PropertySheet.js`.

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
- **OrthographicCamera view-volume resize design decision.** Fixed bounds
  regardless of window size, or rescale? Carried forward, unaddressed.

### Deferred

- Touch / pen pointer events; nested external references; dedicated
  `reference:error` event; drag-and-drop "add to scene"; `.atrium.json`
  auto-connect; `ATRIUM_world` glTF extension; dead reckoning; collision /
  physics; viewpoints; `@atrium/som` npm publish; README updates; animation
  blend weights; morph-target tracks; animation grouping; sticky-stop
  semantics; undo/redo; `window.atrium` namespace consolidation;
  `gridColors` / `setSize` CSS-suppression `Stage` decisions.

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

# start a world server (camera world — recommended for activeCamera smoke;
# now 4 cameras + 1 non-autoplay animation as of Session 46)
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
- `Project_Atrium_2026-06-17.md` — Sessions 1–43b canonical (superseded)
- `Project_Atrium_2026-06-18.md` — Sessions 1–44 canonical (superseded by this document)
- `HANDOFF-Session45-45a-addendum.md` — Sessions 45–45a interim addendum
  (fully folded into this document; do not read alongside it going forward)

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

### `activeCamera` Phase 2 + Inspector arc (Sessions 45, 45a, 46)
- `BRIEF-Session45-activeCamera-Phase2.md` — design brief
- `SESSION-45-activeCamera-Phase2-log.md` — build log
- `SESSION-45-activeCamera-Phase2-smoke-test-plan.md` — manual smoke test
  plan (the acceptance gate for that arc; not unit-testable)
- `BRIEF-Session46-camera-aspect-fix.md` — fix brief (content/log
  renumbered to **45a**, a sub-session of 45 — filename intentionally
  doesn't match; the log is authoritative)
- `BRIEF-Session45a-camera-aspect-fix-log.md` — build log
- `BRIEF-Session46-camera-inspector-and-fixtures.md` — design brief (SOM
  Inspector camera-switching UI, `PropertySheet` xmag/ymag rows, nested +
  animated camera fixtures)
- `SESSION-46-camera-inspector-and-fixtures-log.md` — build log

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
