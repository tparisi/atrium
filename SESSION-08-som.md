# Atrium — Claude Code Session 8
## SOM: Implementation, Server Retrofit, Client Retrofit

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
This is a pnpm monorepo. The following has already been built and tested:

**`packages/protocol`** — SOP message schemas and Ajv validator
- 14 message types including `view`
- 41 passing tests

**`packages/server`** — SOP server with session lifecycle, world state, presence
- Currently uses glTF-Transform directly for scene graph manipulation
- Handles hello/ping/tick/send/set/add/remove/join/leave/view
- 32 passing tests

**`tests/fixtures/space.gltf`** — world fixture with real geometry
- ground-plane, crate-01, lamp-01 (lamp-stand + lamp-shade)
- `extras.atrium` world metadata

**`tests/fixtures/space.atrium.json`** — world manifest
- Points to `space.gltf` and `ws://localhost:3000`

**`tests/client/index.html`** — single-file world client
- Currently uses glTF-Transform directly via DocumentView
- Walk camera default, peer avatar capsules, static-first load sequence

All packages use ES modules. No TypeScript. No build step. Node.js v20.
Test runner: `node --test`.

---

## Goal

Implement the Scene Object Model (`packages/som`) and retrofit the server
and test client to use it. The SOM is the programmatic API layer that sits
above glTF-Transform, giving all Atrium runtimes a consistent, DOM-inspired
interface to the scene graph.

Three parts this session:

1. **`packages/som`** — implement all SOM wrapper classes
2. **`packages/server`** — retrofit to use SOM; implement dot-bracket path
   resolver for `send`/`set` messages
3. **`tests/client/index.html`** — retrofit to use `som` for all scene
   mutations instead of glTF-Transform directly

**Deferred to Session 9:** avatars as SOM nodes, material color picker UI.

---

## Design Reference

The full SOM API is specified in `DESIGN-som.md`. Key points:

- `SOMDocument` wraps a glTF-Transform `Document` — the global `som` is a
  pre-instantiated singleton, analogous to the browser's `document`
- DOM-inspired: simple values are properties, not getter/setter methods;
  collections are properties returning arrays
- Implemented via JavaScript `get`/`set` accessors delegating to
  glTF-Transform's getter/setter methods
- The SOM is symmetric — server and client both maintain a `SOMDocument`
  instance; the API is identical on both sides

### Path syntax for `send`/`set`

`field` in `send`/`set` messages is now a dot-bracket path relative to the
named node anchor:

```
"translation"
"mesh.primitives[0].material.baseColorFactor"
"camera.yfov"
"animation.loop"
```

`.` separates property traversal steps. `[n]` is an array index into a
collection property. All segment names match SOM property names exactly.

The server resolves a path by walking the SOM from the anchor node:

```javascript
const node = som.getNodeByName(msg.node)
// walk msg.field → assign msg.value
// e.g. "mesh.primitives[0].material.baseColorFactor"
// → node.mesh.primitives[0].material.baseColorFactor = msg.value
```

---

## Coding Conventions

Same as all previous sessions:
- ES modules throughout, SPDX license header in every `.js` file
- No TypeScript, no build step
- Single-file HTML — all JS and CSS inline

---

## Part 1 — `packages/som`

### Package structure

```
packages/som/
  package.json
  src/
    index.js          # named exports for all SOM classes
    SOMDocument.js
    SOMScene.js
    SOMNode.js
    SOMMesh.js
    SOMPrimitive.js
    SOMMaterial.js
    SOMCamera.js
    SOMAnimation.js
    SOMTexture.js
    SOMSkin.js
    path-resolver.js  # dot-bracket path parser and walker
  test/
    som.test.js
```

### `package.json`

```json
{
  "name": "@atrium/som",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "dependencies": {
    "@gltf-transform/core": "^4.3.0"
  }
}
```

### Implementation pattern

Every SOM class wraps a glTF-Transform object via composition:

```javascript
// SPDX-License-Identifier: MIT
export class SOMNode {
  constructor(node) {
    this._node = node
  }

  get name()          { return this._node.getName() }
  set name(v)         { this._node.setName(v) }

  get translation()   { return this._node.getTranslation() }
  set translation(v)  { this._node.setTranslation(v) }

  get rotation()      { return this._node.getRotation() }
  set rotation(v)     { this._node.setRotation(v) }

  get scale()         { return this._node.getScale() }
  set scale(v)        { this._node.setScale(v) }

  get extras()        { return this._node.getExtras() }
  set extras(v)       { this._node.setExtras(v) }

  get mesh()          {
    const m = this._node.getMesh()
    return m ? new SOMMesh(m) : null
  }
  set mesh(v)         { this._node.setMesh(v ? v._mesh : null) }

  get camera()        {
    const c = this._node.getCamera()
    return c ? new SOMCamera(c) : null
  }
  set camera(v)       { this._node.setCamera(v ? v._camera : null) }

  get skin()          {
    const s = this._node.getSkin()
    return s ? new SOMSkin(s) : null
  }

  get children()      { return this._node.listChildren().map(n => new SOMNode(n)) }
  get parent()        {
    const p = this._node.getParentNode()
    return p ? new SOMNode(p) : null
  }

  addChild(node)      { this._node.addChild(node._node) }
  removeChild(node)   { this._node.removeChild(node._node) }

  clone()             { return new SOMNode(this._node.clone()) }

  getExtension(name)  { return this._node.getExtension(name) }
  setExtension(name, value) { this._node.setExtension(name, value) }
}
```

Note: `node.visible` is NOT a native glTF-Transform property. Store it in
`extras` under a reserved key (`__atrium_visible`) so it persists in the
Document and can be relayed via `set` messages. Default `true`.

```javascript
get visible() {
  return this._node.getExtras().__atrium_visible ?? true
}
set visible(v) {
  this._node.setExtras({ ...this._node.getExtras(), __atrium_visible: v })
}
```

### `SOMDocument`

```javascript
export class SOMDocument {
  constructor(document) {
    this._document = document
    this._root = document.getRoot()
  }

  get scene() {
    return new SOMScene(this._root.listScenes()[0])
  }

  getNodeByName(name) {
    const node = this._root.listNodes().find(n => n.getName() === name)
    return node ? new SOMNode(node) : null
  }

  get nodes()      { return this._root.listNodes().map(n => new SOMNode(n)) }
  get meshes()     { return this._root.listMeshes().map(m => new SOMMesh(m)) }
  get materials()  { return this._root.listMaterials().map(m => new SOMMaterial(m)) }
  get cameras()    { return this._root.listCameras().map(c => new SOMCamera(c)) }
  get animations() { return this._root.listAnimations().map(a => new SOMAnimation(a)) }
  get textures()   { return this._root.listTextures().map(t => new SOMTexture(t)) }
  get skins()      { return this._root.listSkins().map(s => new SOMSkin(s)) }

  createNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)
    return new SOMNode(node)
  }

  createMesh(descriptor = {}) { ... }
  createMaterial(descriptor = {}) { ... }
  createCamera(descriptor = {}) { ... }
  createPrimitive(descriptor = {}) { ... }
  // createAnimation, createTexture, createSkin — stubs for v0.1

  async createNodeFromGLTF(gltf, nodeName) {
    // Load external glTF into a new Document
    // Merge into this._document using glTF-Transform merge utilities
    // Return SOMNode for the named root node (or scene root if omitted)
  }
}
```

### `path-resolver.js`

The path resolver parses a dot-bracket path string and walks the SOM to
get or set a value. Used by both server (`send`/`set` handler) and client
(`set` message handler).

```javascript
// SPDX-License-Identifier: MIT

/**
 * Parse a dot-bracket path string into segments.
 * "mesh.primitives[0].material.baseColorFactor"
 * → ['mesh', 'primitives', 0, 'material', 'baseColorFactor']
 */
export function parsePath(path) { ... }

/**
 * Walk a SOM object using parsed path segments, return the target object
 * and the final property name as { target, key }.
 * Throws if any segment fails to resolve.
 */
export function resolvePath(somNode, segments) { ... }

/**
 * Get a value at a path on a SOM node.
 */
export function getPath(somNode, path) {
  const segments = parsePath(path)
  const { target, key } = resolvePath(somNode, segments)
  return target[key]
}

/**
 * Set a value at a path on a SOM node.
 */
export function setPath(somNode, path, value) {
  const segments = parsePath(path)
  const { target, key } = resolvePath(somNode, segments)
  target[key] = value
}
```

### Tests — `som.test.js`

Use `space.gltf` as the test fixture. Load it with `WebIO`, wrap in
`SOMDocument`, verify the full API surface:

```javascript
// Load fixture
const io = new WebIO()
const document = await io.readFile('../../tests/fixtures/space.gltf')
const som = new SOMDocument(document)

// Scene
assert.ok(som.scene)
assert.ok(som.scene.children.length > 0)

// Node lookup
const crate = som.getNodeByName('crate-01')
assert.ok(crate)
assert.strictEqual(crate.name, 'crate-01')

// Properties
assert.deepEqual(crate.translation, [...])
crate.translation = [1, 2, 3]
assert.deepEqual(crate.translation, [1, 2, 3])

// Visibility
assert.strictEqual(crate.visible, true)
crate.visible = false
assert.strictEqual(crate.visible, false)

// Material via path
assert.ok(crate.mesh)
assert.ok(crate.mesh.primitives[0])
assert.ok(crate.mesh.primitives[0].material)
const mat = crate.mesh.primitives[0].material
mat.baseColorFactor = [0, 1, 0, 1]
assert.deepEqual(mat.baseColorFactor, [0, 1, 0, 1])

// Path resolver
setPath(crate, 'mesh.primitives[0].material.baseColorFactor', [1, 0, 0, 1])
assert.deepEqual(getPath(crate, 'mesh.primitives[0].material.baseColorFactor'), [1, 0, 0, 1])

// Factory
const newNode = som.createNode({ name: 'test-node', translation: [5, 0, 0] })
assert.strictEqual(newNode.name, 'test-node')
assert.deepEqual(newNode.translation, [5, 0, 0])
```

---

## Part 2 — `packages/server` retrofit

### Add `@atrium/som` dependency

```json
{
  "dependencies": {
    "@atrium/protocol": "workspace:*",
    "@atrium/som": "workspace:*",
    "@gltf-transform/core": "^4.3.0"
  }
}
```

### Wrap the server's Document in a SOMDocument

The server already loads a glTF-Transform Document from `WORLD_PATH`. Wrap
it in a `SOMDocument` immediately after loading:

```javascript
import { SOMDocument } from '@atrium/som'

const document = await io.readFile(WORLD_PATH)
const som = new SOMDocument(document)
```

The server's `som` instance is the authoritative world SOM. All scene
mutations go through it.

### Retrofit `send` handler

The current `send` handler looks up a node and applies a field mutation
directly via glTF-Transform. Replace with SOM path resolution:

```javascript
import { setPath } from '@atrium/som'

// handle 'send' message
const node = som.getNodeByName(msg.node)
if (!node) {
  // send NODE_NOT_FOUND error
  return
}
try {
  setPath(node, msg.field, msg.value)
} catch (err) {
  // send INVALID_FIELD error
  return
}
// broadcast 'set' to all clients
```

### Retrofit `add` handler

```javascript
// handle 'add' message
const node = som.createNode(msg.node)
som.scene.addChild(node)
// broadcast 'add' to all clients
```

### Retrofit `remove` handler

```javascript
// handle 'remove' message
const node = som.getNodeByName(msg.node)
if (!node) { /* NODE_NOT_FOUND */ return }
node.parent.removeChild(node)
// broadcast 'remove' to all clients
```

### Existing tests

All 32 existing server tests must continue to pass. The retrofit is
internal — the wire protocol does not change for this session, except
that `field` in `send`/`set` now supports dot-bracket paths in addition
to simple field names. Simple field names (`"translation"`) are valid
paths and must continue to work.

---

## Part 3 — `tests/client/index.html` retrofit

The client uses glTF-Transform directly in several places. Retrofit to
use `som` instead.

### Instantiate SOMDocument after glTF load

```javascript
import { SOMDocument } from 'https://esm.sh/@atrium/som'
// Note: may need to bundle or inline som for the browser — see below

// After WebIO loads the document:
const som = new SOMDocument(gltfDocument)
```

**Browser import note:** `@atrium/som` is a local workspace package, not
on npm. For the single-file test client, inline the SOM classes directly
or use a relative import path via the HTTP server. The simplest approach
for v0.1: copy the SOM source into `tests/client/som/` and import
relatively. Document this as a known dev-only limitation.

### Retrofit scene access

Replace direct glTF-Transform calls with SOM equivalents:

```javascript
// Before
const nodes = document.getRoot().listNodes()

// After
const nodes = som.nodes
```

### Retrofit `set` message handler

When the client receives a `set` message from the server:

```javascript
import { setPath } from './som/path-resolver.js'

case 'set': {
  const node = som.getNodeByName(msg.node)
  if (node) setPath(node, msg.field, msg.value)
  break
}
```

DocumentView continues to handle Document → Three.js sync automatically.
The client does not need to touch Three.js directly for scene mutations.

### Walk camera — use SOM for position

The walk camera currently reads/writes position directly. It can now use
the SOM if there is a camera node in the scene. For v0.1 the walk camera
position is still managed by Three.js directly — this is fine. Full
camera-as-SOM-node is deferred to the avatar session.

---

## Protocol Schema Update

The `send` message schema in `packages/protocol` needs a minor update:
`field` was previously a simple string with no format constraint. It
remains a string — no type change — but add a note in the schema
description that it now supports dot-bracket path syntax.

No breaking change. Existing simple field names are valid paths.

---

## What NOT to Touch This Session

- `packages/protocol` schemas — no structural changes, only the `field`
  description note
- `tools/protocol-inspector/index.html` — no changes needed
- `tests/fixtures/` — no changes needed
- Flaky disconnect test — noted in TODO.md, not this session
- Avatar rendering — deferred to Session 9
- Material color picker UI — deferred to Session 9
- `node.visible` server persistence — implement the `__atrium_visible`
  extras approach for now, revisit in a future session
- Animation playback on the server — `SOMAnimation` is implemented but
  `play()`/`stop()` are stubs on the server side (no AnimationMixer).
  Document this clearly.

---

## Definition of Done

1. `pnpm --filter @atrium/som test` — all SOM tests pass
2. `pnpm --filter @atrium/server test` — all 32 existing tests pass
3. `pnpm --filter @atrium/protocol test` — all 41 tests pass
4. Start the server:
   ```bash
   WORLD_PATH=tests/fixtures/space.gltf node packages/server/src/index.js
   ```
5. Serve the test client:
   ```bash
   npx serve -l 5173 tests/
   ```
6. Open `http://localhost:5173/client/index.html`
   - Scene renders: ground plane, crate, lamp visible
   - Walk camera default, status shows "Offline"
7. Click Connect — server connects, status goes green
8. Open browser console — verify no glTF-Transform calls outside SOM
9. Open a second tab — connect it, peer capsule appears
10. From the browser console, manually test a path mutation:
    ```javascript
    // In browser console
    const node = som.getNodeByName('crate-01')
    node.mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
    ```
    Crate turns green in the viewport — DocumentView picks up the change.
11. Send a `send` message via the protocol inspector with a dot-bracket
    path — verify the server applies it and broadcasts `set` to all clients.

---

## Session Log

**Completed:** 2026-03-09

### Part 1 — `packages/som`

Created full package from scratch:

- `package.json` — `@atrium/som` v0.1.0, depends on `@gltf-transform/core ^4.3.0`
- `src/SOMDocument.js` — wraps glTF-Transform Document; `scene`, `getNodeByName`, collection getters, `createNode/Mesh/Material/Camera/Primitive/Animation` factories
- `src/SOMScene.js` — wraps Scene; `children`, `addChild`, `removeChild`
- `src/SOMNode.js` — wraps Node; transform, `visible` (stored in `extras.__atrium_visible`), `mesh/camera/skin` attachments, `children/parent`, `addChild/removeChild/clone/dispose`
- `src/SOMMesh.js` — wraps Mesh; `primitives`, `addPrimitive/removePrimitive`
- `src/SOMPrimitive.js` — wraps Primitive; `material`, `mode`
- `src/SOMMaterial.js` — wraps Material; full PBR metallic-roughness + surface + rendering properties
- `src/SOMCamera.js` — wraps Camera; perspective and orthographic properties
- `src/SOMAnimation.js` — wraps Animation; `loop/timeScale` state, `play/stop/getState` stubs (no AnimationMixer on server)
- `src/SOMTexture.js` — read-only; `name`, `mimeType`, `getImage()`
- `src/SOMSkin.js` — read-only; `joints`, `skeleton`
- `src/path-resolver.js` — `parsePath` (dot-bracket → segments), `resolvePath`, `getPath`, `setPath`; `setPath` throws on unknown final property (`key in target` check)
- `src/index.js` — named exports for all classes + path resolver functions
- `test/som.test.js` — 21 tests covering all the above

**21/21 tests pass.**

### Part 2 — `packages/server` retrofit

- `package.json` — added `@atrium/som: workspace:*` dependency
- `src/world.js` — replaced glTF-Transform direct calls with SOM:
  - `SOMDocument` wraps the loaded Document
  - `setField` uses `setPath` (supports simple names and dot-bracket paths); catches path errors → `INVALID_FIELD`
  - `addNode` uses `som.createNode` + `som.scene.addChild`
  - `removeNode` uses `som.getNodeByName` + `node.dispose()`
  - `getNodeTranslation` uses `node.translation`
  - `listNodeNames` uses `som.nodes`
  - Exposed `som` on the returned world object
- External interface unchanged — all existing tests pass without modification

**32/32 server tests pass.**

### Part 3 — `tests/client/index.html` retrofit

- `tests/client/som/` — SOM source copied verbatim from `packages/som/src/` (dev-only workaround; local workspace packages aren't on npm)
- Client imports: added `SOMDocument` from `./som/index.js` and `setPath` from `./som/path-resolver.js`
- Added `som` state variable (`let som = null`)
- `loadScene`: wraps `gltfDoc` with `new SOMDocument(gltfDoc)` immediately after load; exposes as `window.som` for browser console access
- `applySet`: replaced switch on known fields with `setPath(node, msg.field, msg.value)` — supports full dot-bracket paths
- `applyAdd`: replaced direct glTF-Transform calls with `som.createNode(msg.node)` + `som.scene.addChild`
- `applyRemove`: replaced with `som.getNodeByName(msg.node)` + `node.dispose()`

### Tests

- `packages/protocol`: 41 pass, 0 fail
- `packages/som`: 21 pass, 0 fail
- `packages/server`: 32 pass, 0 fail
