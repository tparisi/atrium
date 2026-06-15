# SESSION-42-SOMCamera-brief.md
## SOMCamera Completeness — Mutable Properties, Registration, Wire Dispatch

**Session:** 42
**Date:** 2026-06-15
**Status:** Ready for implementation
**Prerequisite:** Session 41 complete (SOMLight arc finished, 373 tests passing)

---

## Objective

Make `SOMCamera` a first-class mutable, wire-addressable SOM type — following
the identical pattern established by `SOMLight` in Sessions 38–41. This session
does **not** touch the Three.js camera or active-camera selection. A peer can
mutate camera intrinsics; those mutations travel over the wire and are applied
to the `SOMCamera` wrapper and its glTF-Transform backing object on the
receiving end. The viewport does not change. That is correct and intentional.

---

## Background

`SOMCamera` already exists as a thin wrapper exposing `type`, `yfov`, `znear`,
`zfar`, `aspectRatio`, `xmag`, and `ymag` — all currently **read-only**. It is
**not registered** in `_objectsByName`. Protocol `set` messages targeting camera
intrinsics currently fail with `NODE_NOT_FOUND`. The gaps:

1. All properties need setters that fire `mutation` events.
2. `SOMCamera` must be registered in `_objectsByName` under bare name +
   `.camera` qualified alias (unconditional), following the `SOMLight` pattern.
3. `AtriumClient` needs `_attachCameraListeners` wired into
   `_attachMutationListeners`.
4. A new test fixture `space-cameras.gltf` is needed; no existing fixture
   contains a glTF camera.

---

## Key Design Decisions (settled — do not re-open)

- **Option B for renderer reconciliation.** Three.js camera is app-managed;
  DocumentView has no camera reconciliation path. SOMCamera mutations reach the
  glTF-Transform backing object and stop there for now. Renderer reconciliation
  is a `Stage` (Tier C) concern in a subsequent session.

- **`aspectRatio` is mutable in the SOM** for spec completeness. The renderer
  may ignore incoming `aspectRatio` mutations in favor of the canvas aspect
  ratio. That is a renderer concern, not a SOMCamera concern.

- **Active-camera selection is out of scope.** "Which camera is active" will be
  represented as `extras.atrium.activeCamera` (Tier A) in a future session.
  `SOMCamera` type work does not block on it.

- **Naming follows `SOMLight` exactly:**
  - Bare glTF name registered if non-null and non-colliding; node wins on
    collision (Session 27 rule).
  - Qualified alias `<hostNodeName>.camera` registered unconditionally.
  - Separator convention: `.` = intrinsic contained child.

- **Re-aiming a camera** is a `SOMNode.rotation` mutation on the host node —
  not a SOMCamera mutation. Same principle as lights.

---

## Scope

### In scope

- `tests/fixtures/generate-space-cameras.js` + `tests/fixtures/space-cameras.gltf`
- `packages/som` — SOMCamera setters, registration, `som.cameras` enumeration
- `packages/client` — `_attachCameraListeners`, wired from `_attachMutationListeners`
- `packages/protocol` — verify `set` schema accepts `.camera` qualified names
  (expected: no change needed)
- New tests in `packages/som` and `packages/client`

### Not in scope (stop and flag if tempted)

- Three.js camera object — do not touch
- Active-camera selection / `extras.atrium.activeCamera`
- `@atrium/renderer-three` — no changes
- `apps/client/src/app.js` — no changes
- `Stage` — out of scope for this session

---

## Test Fixture

### `tests/fixtures/generate-space-cameras.js`

Write a Node.js script that:

1. Reads `tests/fixtures/space.gltf` via `NodeIO` (no extension registration
   needed; cameras are core glTF).
2. Adds two cameras:

   **`MainCamera`** (perspective)
   - Host node named `MainCamera`, positioned to see the scene
     (e.g. translation `[0, 2, 8]`)
   - Camera: `type: "perspective"`, `yfov: 0.8`, `znear: 0.1`, `zfar: 100`,
     `aspectRatio: 1.777` (16:9 hint)
   - Name `MainCamera` will collide with host node name — exercises the
     qualified alias path (`MainCamera.camera`)

   **`OrthoCamera`** (orthographic)
   - Host node named `OrthoCamera`, positioned to the side
     (e.g. translation `[10, 2, 0]`, rotated to face the scene)
   - Camera: `type: "orthographic"`, `xmag: 5`, `ymag: 3`, `znear: 0.1`,
     `zfar: 100`
   - Name `OrthoCamera` will also collide with host node — exercises the same
     alias path (`OrthoCamera.camera`)

3. Attaches each camera to its host node.
4. Writes `tests/fixtures/space-cameras.gltf` via `NodeIO`.

Run the generator to produce the fixture before writing any SOM tests.

```bash
node tests/fixtures/generate-space-cameras.js
```

---

## Implementation

### 1. `packages/som` — SOMCamera

**Setters (fire `mutation` after writing through to glTF-Transform):**

```javascript
set type(v)         { this._camera.setType(v);        this._fireMutation('type', v); }
set yfov(v)         { this._camera.setYFov(v);         this._fireMutation('yfov', v); }
set znear(v)        { this._camera.setZNear(v);        this._fireMutation('znear', v); }
set zfar(v)         { this._camera.setZFar(v);         this._fireMutation('zfar', v); }
set aspectRatio(v)  { this._camera.setAspectRatio(v);  this._fireMutation('aspectRatio', v); }
set xmag(v)         { this._camera.setXMag(v);         this._fireMutation('xmag', v); }
set ymag(v)         { this._camera.setYMag(v);         this._fireMutation('ymag', v); }
```

Use the same `_fireMutation` helper pattern as `SOMLight`. Event detail:
`{ target: somCamera, property: '<name>', value: <v> }`.

**`SOMNode.camera` accessor:**

Verify the existing accessor returns a `SOMCamera` wrapper (not the raw
glTF-Transform `Camera`). If it returns the raw object, fix it to return the
cached `SOMCamera` wrapper — consistent with `.mesh` and `.light`.

**`SOMDocument._buildObjectGraph` — registration:**

Follow `SOMLight` exactly:

```javascript
// For each camera attached to a node in the scene graph:
const hostNodeName = somNode.name;           // e.g. 'MainCamera'
const qualifiedAlias = `${hostNodeName}.camera`;

// Bare name — register if non-null and slot is available; node wins on collision
if (camera.name && !this._objectsByName.has(camera.name)) {
  this._objectsByName.set(camera.name, somCamera);
} else if (camera.name) {
  console.warn(`SOM: duplicate name "${camera.name}" — SOMNode wins bare-name slot; use "${qualifiedAlias}" to address this camera`);
}

// Qualified alias — always, unconditionally
somCamera.qualifiedName = qualifiedAlias;
this._objectsByName.set(qualifiedAlias, somCamera);
```

**`SOMDocument.cameras` enumeration:**

```javascript
get cameras() { return [...this._cameras]; }
```

Maintain `this._cameras` as a deduplicated array, populated during
`_buildObjectGraph`, parallel to `this._lights`.

**Detached cameras** (in the document dictionary but not attached to any node)
are not registered — same rule as detached lights.

---

### 2. `packages/client` — AtriumClient

**`_attachCameraListeners(somCamera)`:**

```javascript
_attachCameraListeners(somCamera) {
  somCamera.addEventListener('mutation', (event) => {
    if (this._applyingRemote) return;
    const { property, value } = event.detail;
    this._send({
      type: 'send',
      node: somCamera.qualifiedName,
      field: property,
      value,
    });
  });
}
```

**Wire into `_attachMutationListeners`:**

```javascript
for (const somCamera of this._som.cameras) {
  this._attachCameraListeners(somCamera);
}
```

Called on `world:loaded`, alongside the existing light, animation, and node
listener wiring.

**`_onSet` routing:**

No change needed. `_onSet` already resolves targets via
`this._som.getObjectByName(msg.node)` — once `SOMCamera` is registered, the
routing works automatically. Confirm in tests.

**`_applyingRemote` guard** already in place — no new plumbing needed.

---

### 3. `packages/protocol`

Verify the `set` message schema accepts `node` values like `"MainCamera.camera"`.
The schema currently accepts any non-empty string for `node`; no change is
expected. Confirm and note in the build log. No schema change unless the
verification reveals a gap.

---

## Implementation Order

1. Run `generate-space-cameras.js` → produce `space-cameras.gltf`
2. `packages/som` — add setters + `_fireMutation`
3. `packages/som` — `_buildObjectGraph` registration + `som.cameras`
4. `packages/som` — verify `SOMNode.camera` returns wrapper
5. `packages/som` tests
6. `packages/client` — `_attachCameraListeners` + wire into `_attachMutationListeners`
7. `packages/client` tests
8. `packages/protocol` — verify `set` schema (no change expected)
9. Full test run — reconcile counts against baseline

---

## Tests

### `packages/som` (new tests — add to existing test file)

- `SOMCamera` setters update underlying glTF-Transform `Camera` property
- Each setter fires a `mutation` event with correct `property` and `value`
- `MainCamera.camera` resolves via `som.getObjectByName('MainCamera.camera')`
- `OrthoCamera.camera` resolves via `som.getObjectByName('OrthoCamera.camera')`
- Collision warning logged when bare name slot is taken by host node
- `som.cameras` returns both cameras
- Detached camera (not attached to any node) is not registered

### `packages/client` (new tests)

- `_attachCameraListeners` dispatches `send` message when `somCamera.yfov` is
  mutated locally
- `_applyingRemote` guard suppresses outbound dispatch during inbound `_onSet`
- `_onSet` with `node: 'MainCamera.camera'` resolves to the `SOMCamera` and
  applies the mutation

---

## Files Expected to Change

| File | Change |
|---|---|
| `tests/fixtures/generate-space-cameras.js` | **New** — fixture generator |
| `tests/fixtures/space-cameras.gltf` | **New** — generated fixture |
| `packages/som/src/SOMCamera.js` | Setters + `_fireMutation` + `qualifiedName` property |
| `packages/som/src/SOMDocument.js` | `_buildObjectGraph` registration + `_cameras` array + `cameras` getter |
| `packages/som/src/SOMNode.js` | Verify `.camera` returns wrapper (fix if needed) |
| `packages/som/tests/som-camera.test.js` | **New** (or appended to existing camera tests) |
| `packages/client/src/AtriumClient.js` | `_attachCameraListeners` + wire in `_attachMutationListeners` |
| `packages/client/tests/atrium-client-camera.test.js` | **New** (or appended to existing client tests) |

## Files Expected NOT to Change

- `packages/renderer-three/**` — no renderer changes this session
- `apps/client/src/app.js` — no app changes this session
- `packages/server/**` — no server changes (cameras are core glTF; no extension
  registration needed, unlike `KHR_lights_punctual`)
- `packages/protocol/src/**` — schema change not expected; verify only
- `tests/client/som/` — sync required if `packages/som/src` changes:
  ```bash
  cp packages/som/src/*.js tests/client/som/
  ```

---

## Risks / Watch-outs

- **`SOMNode.camera` may return raw glTF-Transform object, not wrapper.** Check
  before writing tests that depend on it. Fix if needed; it is in scope.

- **No extension registration needed for cameras.** Cameras are core glTF —
  unlike `KHR_lights_punctual` lights, no `registerExtensions` call is required
  on `NodeIO` or `WebIO`. Do not add one.

- **Detached cameras.** The glTF-Transform document dictionary may contain
  camera objects not attached to any node. Do not register these — same rule as
  detached lights. The `_buildObjectGraph` traversal should walk nodes, not the
  raw camera dictionary.

- **`zfar` is optional for perspective cameras.** glTF permits omitting `zfar`
  for an infinite projection. The getter may return `null` or `undefined`; the
  setter should accept `null`. Handle gracefully.

- **`aspectRatio` is advisory.** The renderer may ignore it. Do not add any
  enforcement or warning in the SOM layer.

- **Test count baseline.** Current baseline is 373 tests total. Require full
  recursive test output in the build log — not summary numbers — and reconcile
  the new total explicitly.

---

## Acceptance Criteria

- `som.getObjectByName('MainCamera.camera')` returns the `SOMCamera` for
  `MainCamera` (perspective)
- `som.getObjectByName('OrthoCamera.camera')` returns the `SOMCamera` for
  `OrthoCamera` (orthographic)
- Collision warning is logged for both (bare name slot taken by host node)
- `som.cameras.length === 2`
- Mutating `somCamera.yfov` fires a `mutation` event
- That mutation dispatches a `send` message with `node: 'MainCamera.camera'`,
  `field: 'yfov'`
- A `set` message with `node: 'MainCamera.camera'` routes correctly via
  `_onSet` and applies the value to the `SOMCamera`
- `NODE_NOT_FOUND` is no longer returned for camera intrinsic targets
- All prior tests continue to pass; new total reconciled and reported

---

## Smoke Test Plan (manual, after implementation)

1. Start world server with `space-cameras.gltf`:
   ```bash
   cd packages/server
   WORLD_PATH=../../tests/fixtures/space-cameras.gltf node src/index.js
   ```

2. Serve and open the SOM Inspector:
   ```bash
   npx serve . --listen 8080
   # open http://localhost:8080/tools/som-inspector/index.html
   ```

3. Connect to the world. Verify in the SOM tree:
   - `MainCamera` node visible
   - `MainCamera.camera` resolvable (check via console: `som.getObjectByName('MainCamera.camera')`)
   - `OrthoCamera` node visible
   - `OrthoCamera.camera` resolvable
   - `som.cameras.length === 2`

4. Open the Protocol Inspector alongside. In the browser console:
   ```javascript
   const cam = som.getObjectByName('MainCamera.camera');
   cam.yfov = 1.2;
   ```
   Verify: mutation event fires; `send` message appears in Protocol Inspector
   with `node: "MainCamera.camera"`, `field: "yfov"`, `value: 1.2`.

5. Open a second browser tab, connect to the same world. Perform step 4 in
   tab 1. Verify tab 2 receives a `set` message and `som.getObjectByName('MainCamera.camera').yfov === 1.2`.

6. Repeat steps 4–5 for `OrthoCamera.camera` with `xmag`.

---

## Notes for Claude Code

- Follow the `SOMLight` arc (Sessions 38–41) as the canonical reference for
  this pattern. The brief for Session 38 (`SESSION-38-SOMLight-log.md`) and
  the naming design (`DESIGN-SOMLight-Naming.md`, folded into the handoff) are
  the closest analogs.
- No pre-brief verification step is required — the `SOMLight` arc confirmed
  the mechanism works; `SOMCamera` uses the same path.
- Report the full recursive test output, not summary counts. Reconcile the
  new total against the 373 baseline explicitly in the build log.
- If anything outside the declared scope needs to change to make this work,
  **stop and flag** rather than patching silently.
