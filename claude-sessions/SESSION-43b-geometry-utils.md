# SESSION-43b · Geometry Utilities — Design Brief

## Goal

Extract `buildAvatarDescriptor` out of `apps/client/src/app.js` into a new
shared utility file in `packages/renderer-three`, splitting it into a
generic Three.js-geometry-to-glTF-primitive converter plus a thin
avatar-specific wrapper on top.

This is a **small, focused cleanup** discovered during Session 43 review —
not a redesign. `buildAvatarDescriptor` is currently used in exactly one
place (`apps/client`, to build the local avatar's glTF node descriptor sent
over the wire via `client.connect()`). There is no duplication to resolve;
the motivation is purely that Three.js-specific code doesn't belong inline
in `apps/client/src/app.js` — it belongs in `@atrium/renderer-three`,
alongside `Stage`, `AnimationBridge`, `PointerInputBridge`, etc.

---

## Non-goals (explicit)

- No change to avatar appearance, color generation, or capsule dimensions.
- No change to how `apps/client` calls `client.connect()` or constructs the
  avatar descriptor at the call site beyond updating the import.
- No investigation of the commented-out `name` field — carry it over as-is
  with a clarifying comment (see below). Do not attempt to re-enable it or
  determine why it was disabled; that's out of scope for this session.
- No generalization beyond capsule geometry — the low-level helper should
  be generic to any `THREE.BufferGeometry`, but do not add support for
  multi-primitive meshes, UVs, tangents, skinning, or other attributes not
  present in the current function. Extract what exists; don't expand it.
- No changes to `tools/som-inspector` or `apps/playground` — neither uses
  this function.

---

## Current Code (for reference — do not change behavior)

```javascript
function buildAvatarDescriptor(name) {
  const geo       = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const positions = Array.from(geo.attributes.position.array)
  const normals   = Array.from(geo.attributes.normal.array)
  const indices   = Array.from(geo.index.array)
  geo.dispose()

  const color = [Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, 1]

  return {
//    name,
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: {
      primitives: [{
        attributes: { POSITION: positions, NORMAL: normals },
        indices,
        material: {
          pbrMetallicRoughness: {
            baseColorFactor: color,
            metallicFactor:  0.0,
            roughnessFactor: 0.7,
          },
        },
      }],
    },
  }
}
```

Currently lives inline in `apps/client/src/app.js`, called once per local
client connection to build the descriptor passed to `client.connect()`.

---

## Target Design

### New file: `packages/renderer-three/src/geometry-utils.js`

Two exported functions:

#### 1. `threeGeometryToGltfPrimitive(geometry, material)`

Generic low-level converter. Extracts position/normal/index data from any
`THREE.BufferGeometry` and packages it into a glTF primitive descriptor
shape (matching the SOM/protocol's plain-object glTF descriptor format —
the same shape used elsewhere for `add` messages and node descriptors).

```javascript
/**
 * Convert a THREE.BufferGeometry into a glTF primitive descriptor
 * (plain JS object, wire-format shape — POSITION/NORMAL attributes +
 * indices + material). Disposes the input geometry after extracting
 * its attribute data, since only the extracted arrays are retained.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} material - glTF material descriptor
 *   (e.g. { pbrMetallicRoughness: { baseColorFactor, metallicFactor,
 *   roughnessFactor } })
 * @returns {object} glTF primitive descriptor:
 *   { attributes: { POSITION, NORMAL }, indices, material }
 */
export function threeGeometryToGltfPrimitive(geometry, material) {
  const positions = Array.from(geometry.attributes.position.array)
  const normals   = Array.from(geometry.attributes.normal.array)
  const indices   = Array.from(geometry.index.array)
  geometry.dispose()  // only the extracted arrays are retained — the
                       // THREE.BufferGeometry itself is not needed past
                       // this point

  return {
    attributes: { POSITION: positions, NORMAL: normals },
    indices,
    material,
  }
}
```

#### 2. `buildAvatarDescriptor(name)`

Avatar-specific wrapper. Builds the capsule geometry, the random color
material, and the full node descriptor (translation, extras, mesh), calling
`threeGeometryToGltfPrimitive` for the geometry→primitive step.

```javascript
/**
 * Build a glTF node descriptor for a procedurally-generated capsule
 * avatar, suitable for passing to AtriumClient.connect(). Random pastel
 * color per call.
 *
 * @param {string} name - display name for the avatar
 * @returns {object} glTF node descriptor
 */
export function buildAvatarDescriptor(name) {
  const geo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)

  const color = [
    Math.random() * 0.5 + 0.5,
    Math.random() * 0.5 + 0.5,
    Math.random() * 0.5 + 0.5,
    1,
  ]

  const primitive = threeGeometryToGltfPrimitive(geo, {
    pbrMetallicRoughness: {
      baseColorFactor: color,
      metallicFactor:  0.0,
      roughnessFactor: 0.7,
    },
  })

  return {
    // name intentionally omitted here — left disabled in the original
    // app.js implementation; carried over as-is, not investigated this
    // session (see SESSION-43b backlog note)
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: { primitives: [primitive] },
  }
}
```

> **Note on the `name` field:** the original code has it commented out
> (`//    name,`) inside the returned object. This brief does not
> investigate why. Carry the omission forward exactly as-is — do not
> re-enable it, and do not delete the historical context. Add a one-line
> comment (as above) so the next person doesn't mistake it for an
> oversight. Flag in the build log that this remains an open question, to
> be added to the backlog for future investigation (separate from this
> session's scope).

---

## `apps/client/src/app.js` Changes

- Remove the inline `buildAvatarDescriptor` function definition.
- Add import:
  ```javascript
  import { buildAvatarDescriptor } from '@atrium/renderer-three/geometry-utils'
  ```
  — confirm against the actual export path/style used by other
  `@atrium/renderer-three` imports in `apps/client` (e.g. how `Stage` is
  currently imported) and match that pattern exactly. **If `apps/client`
  uses an import map** (per Session 43's `Stage` migration and the
  playground import-map issue discovered afterward), add the
  `geometry-utils` path to that import map if it isn't covered by an
  existing wildcard/prefix entry — check this explicitly, don't assume it's
  covered.
- Call site (`buildAvatarDescriptor(name)`) is otherwise unchanged.

---

## Files Expected to Change

| File | Change |
|------|--------|
| `packages/renderer-three/src/geometry-utils.js` | **New** |
| `packages/renderer-three/src/index.js` | Export `threeGeometryToGltfPrimitive`, `buildAvatarDescriptor` |
| `apps/client/src/app.js` | Remove inline function, add import |
| `apps/client/index.html` | Update import map if needed (see above) |
| `packages/renderer-three/tests/geometry-utils.test.js` | **New** |

## Files That Must Not Change

- `tools/som-inspector/`, `apps/playground/` — neither uses this function.
- `packages/protocol/`, `packages/som/`, `packages/server/`,
  `packages/client/`, `packages/interaction/`.
- `Stage.js` and `stage.test.js` from Session 43 — unrelated, do not touch.

---

## Tests (`packages/renderer-three/tests/geometry-utils.test.js`)

`node --test`, same lightweight-stub approach as `stage.test.js` — check
that file's pattern for how `THREE` is made available in Node (real THREE
classes like `BufferGeometry`/`CapsuleGeometry` should work directly in
Node without a renderer, same as `Stage`'s use of `Scene`/`Camera`/`Vector3`
does).

Cover:

1. **`threeGeometryToGltfPrimitive` extracts position/normal/index arrays**
   correctly from a known simple geometry (e.g. `THREE.BoxGeometry` or
   `THREE.PlaneGeometry` — pick whichever has a small, easily-asserted
   vertex count for a clean test fixture).
2. **`threeGeometryToGltfPrimitive` disposes the input geometry** — spy on
   `geometry.dispose` and confirm it's called exactly once.
3. **`threeGeometryToGltfPrimitive` passes the material through unchanged**
   — confirm `result.material === material` (or deep-equal, if a copy is
   made — copying isn't required by this brief, but flag if Claude Code's
   implementation differs from the reference code above).
4. **`buildAvatarDescriptor` returns the expected shape** — `translation`,
   `extras.displayName`, `mesh.primitives[0]` with `attributes.POSITION`,
   `attributes.NORMAL`, `indices`, and `material.pbrMetallicRoughness`
   fields present and correctly typed (arrays, not typed arrays — confirm
   `Array.isArray()`).
5. **`buildAvatarDescriptor` produces a random color each call** — call
   twice, confirm `baseColorFactor` differs between calls (extremely low
   collision probability; acceptable flakiness for this kind of check).
6. **`buildAvatarDescriptor` color channels are in range** — each of
   `baseColorFactor[0..2]` is in `[0.5, 1.0]`; `baseColorFactor[3] === 1`.
7. **`buildAvatarDescriptor` does not include a `name` field** at the
   top level of the returned descriptor (confirms the intentional omission
   survived the extraction — `result.name` should be `undefined`).

---

## Implementation Order

1. Read `packages/renderer-three/tests/stage.test.js` to confirm the
   Node/THREE test pattern before writing new tests.
2. Write `geometry-utils.js`.
3. Export both functions from `index.js`.
4. Write `geometry-utils.test.js` — all tests passing.
5. Update `apps/client/src/app.js` (remove inline function, add import).
6. Check `apps/client/index.html` import map coverage for the new path.
7. Run full test suite — confirm count is ≥ 425 + new geometry-utils tests
   (target 7, per the list above).
8. Manual smoke test: load `apps/client`, confirm avatar still renders as a
   capsule with a random pastel color, confirm a second connected client
   sees the first avatar correctly (exercises the wire descriptor end to
   end, not just local construction).

---

## Stop-and-Flag Conditions

- If `apps/client`'s avatar descriptor call site has any logic beyond
  calling `buildAvatarDescriptor(name)` directly (e.g. additional
  post-processing not shown in the reference snippet) — flag rather than
  silently dropping it.
- If the import map for `apps/client` does not already cover
  `@atrium/renderer-three` subpaths generically (i.e. if `Stage` required
  its own explicit entry rather than a wildcard), flag this as the same
  category of issue noted for `apps/playground` in the Session 43 backlog
  — don't silently add a one-off entry without noting the pattern.

---

## Acceptance Criteria

- `geometry-utils.js` exists in `packages/renderer-three`, exports both
  functions, exported from index.
- All geometry-utils tests pass (target: 7).
- Total test count ≥ 432 (425 + 7).
- `apps/client/src/app.js` no longer contains an inline
  `buildAvatarDescriptor` definition.
- `apps/client` avatar rendering and multi-client avatar visibility are
  unchanged from pre-43b behavior (regression check, not new functionality).
- No regressions in any other package test suite.
