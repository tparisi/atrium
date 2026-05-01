# Session 32 — Update: Extended Event Detail Fields

**Status:** Amendment to the original Session 32 brief, post-implementation.
**Date:** 2026-04-30
**Scope:** Additive only. No existing fields change. No existing behavior
changes.

---

## Why this update

After Session 32 landed, a use-case review for Session 33 (Inspector
selection + drag) surfaced that drag handlers need local-space hit
coordinates to compute grab offsets that are invariant to node rotation.
Adding the field now — rather than amending mid-arc — keeps the API
shape coherent and avoids a "first, extend the event detail" preamble
in the Session 33 brief.

While extending, four renderer-neutral fields are added together as a
coherent set: world/local point and normal pairs, ray distance, and UV
coordinates. All are derived from data Three.js's `intersectObject`
already returns; none introduce a new renderer dependency.

**Explicitly considered and rejected:** exposing the raw `intersectObject`
result as a `detail.raw` passthrough, or adding fields like `face`,
`faceIndex`, `object`, or `instanceId`. These leak Three.js structure
into the SOM event detail in ways that violate the
renderer-agnostic contract on `packages/client` and would constrain
future renderer choices. Handlers that genuinely need renderer internals
should do their own raycasting outside the SOM event channel.

---

## Updated event detail shape

```javascript
{
  pointerId,         // number — DOM pointer ID (always 1 for primary mouse in Session 32)
  button,            // number — DOM button code (0=primary, 1=middle, 2=secondary)
  buttons,           // number — DOM buttons bitmask

  // World-space coordinates (defaults — most common case)
  point,             // [x, y, z] — world-space hit point
  normal,            // [x, y, z] — world-space surface normal at hit point

  // Local-space coordinates (relative to hit node)
  localPoint,        // [x, y, z] — hit point in the SOM node's local frame
  localNormal,       // [x, y, z] — surface normal in the SOM node's local frame

  // Ray + distance
  ray: {
    origin,          // [x, y, z] — ray origin (world space, camera position)
    direction        // [x, y, z] — ray direction (world space, unit vector)
  },
  distance,          // number — distance from ray origin to hit point

  // Surface parametrics (glTF-native, renderer-neutral)
  uv,                // [u, v] | null — texture coordinates at hit, null if geometry has no UVs

  // Modifier keys
  shiftKey,          // bool
  ctrlKey,           // bool
  altKey,            // bool
  metaKey,           // bool

  // Propagation
  stopPropagation()  // no-op in Session 32; reserved for when bubbling lands
}
```

**Net additions over the original Session 32 spec:**

- `localPoint` (new)
- `localNormal` (new)
- `distance` (new)
- `uv` (new)

**Unchanged:** all other fields keep the same shape and semantics.

---

## Implementation notes for `apps/client/src/app.js`

`buildDetail(domEvent, hitResult)` is the only place that needs to
change. The hit result already carries the Three.js intersection
object; new fields are derived from it.

```javascript
function buildDetail(domEvent, hitResult) {
  const detail = {
    pointerId: 1,
    button: domEvent.button,
    buttons: domEvent.buttons,
    ray: {
      origin:    raycaster.ray.origin.toArray(),
      direction: raycaster.ray.direction.toArray()
    },
    shiftKey: domEvent.shiftKey,
    ctrlKey:  domEvent.ctrlKey,
    altKey:   domEvent.altKey,
    metaKey:  domEvent.metaKey,
    // stopPropagation injected by AtriumClient before dispatch
  }

  if (hitResult) {
    const { hit } = hitResult

    // World-space point (from Three.js, already world-space)
    detail.point = hit.point.toArray()

    // Local-space point (worldToLocal mutates; clone first)
    const localPointVec = hit.object.worldToLocal(hit.point.clone())
    detail.localPoint = localPointVec.toArray()

    // Distance along ray
    detail.distance = hit.distance

    // Normals: face.normal is mesh-local; transform to world for `normal`.
    // Geometry without face data (e.g., points or lines) → both null.
    if (hit.face) {
      const localNormal = hit.face.normal
      detail.localNormal = localNormal.toArray()
      detail.normal = localNormal.clone()
        .transformDirection(hit.object.matrixWorld)
        .toArray()
    } else {
      detail.localNormal = null
      detail.normal = null
    }

    // UV at hit point — Three.js interpolates this when uv attribute exists
    detail.uv = hit.uv ? hit.uv.toArray() : null
  } else {
    // Off-geometry events (e.g., pointermove with no hit). Position fields
    // null; ray + modifier keys still meaningful.
    detail.point = null
    detail.localPoint = null
    detail.normal = null
    detail.localNormal = null
    detail.distance = null
    detail.uv = null
  }

  return detail
}
```

**Coordinate-space contract (worth restating clearly):**

- `hit.point` from Three.js is **world-space** — pass through unchanged.
- `hit.face.normal` from Three.js is **mesh-local** — needs
  `transformDirection(matrixWorld)` for world-space.
- `worldToLocal` mutates its argument. Always clone first.
- The asymmetry — `point` post-transform but `face.normal` pre-transform
  — is a Three.js historical quirk. Worth a comment in `buildDetail`
  so future readers don't re-discover it.

---

## Test plan additions

### Unit tests — `packages/client/tests/pointer-events.test.js`

Two new tests, additive to the existing 15:

**Test 16 — All detail fields populated on hit.**
Construct a synthetic detail object representing a hit on a node, dispatch
`pointerdown`, capture the event in a handler, verify `event.detail` has
all expected fields populated and of correct type/shape (arrays of length
3 for points and normals, number for distance, array of length 2 or null
for uv, etc.).

**Test 17 — Detail fields null on off-geometry event.**
Dispatch `pointermove` with `somNode === null`. The detail object should
have `point`, `localPoint`, `normal`, `localNormal`, `distance`, and `uv`
all null. Modifier keys and `ray` still populated. (This test exercises
the off-geometry path that the renderer takes when the cursor leaves all
geometry while no capture is active.)

These tests do not require Three.js — `dispatchPointerEvent` accepts the
detail object as input; the unit test constructs it directly, the same
way the existing 15 tests do.

### Smoke test additions — `SESSION-32-smoke-test-plan.md`

**Test 3 update — extend to verify the new fields.**

When clicking the crate, the existing test verifies world-space `point`.
Extend it to also log and verify:

- `localPoint`: should reflect the click position relative to the crate's
  own origin. For a click on the top center of a 1×1×1 crate translated
  to `[2, 0.5, 0]`, the local point should be approximately `[0, 0.5, 0]`
  (or whatever local frame the crate's geometry uses — the key check is
  that it's *different* from `point` and reflects the local frame, not
  the world frame).
- `localNormal`: for a click on the top face, should be approximately
  `[0, 1, 0]` regardless of the crate's world rotation.
- `normal`: for a click on the top face of an axis-aligned crate, should
  also be approximately `[0, 1, 0]`. If the crate is rotated, `normal`
  changes but `localNormal` stays `[0, 1, 0]` — this is the rotation
  invariance check that motivated adding local-space fields.
- `distance`: should be a positive number, roughly the distance from
  camera to clicked surface.
- `uv`: depends on the crate's UV mapping. For `space.gltf`, the crate
  has UVs (it's a cube with materials), so this should be a 2-element
  array. If the fixture's geometry happens to lack UVs on the hit
  primitive, `null` is acceptable — note in the smoke test results.

**New Test 3b — Rotation invariance of `localNormal`.**

If feasible without modifying the fixture, manually rotate the crate via
the Inspector (or temporarily author a non-axis-aligned rotation in the
fixture). Click the top face. Verify:

- `normal` reflects the rotated world-space orientation
- `localNormal` is still `[0, 1, 0]`

This is the test that makes the local-space addition pay off — it's the
property a Session 33 drag handler will rely on. If it doesn't hold, the
local-space transform is wrong somewhere.

If rotating the crate is impractical for the smoke test, skip Test 3b
and rely on the unit test framework once Session 33 is building real
drag handlers — a failure there will surface immediately.

---

## Out of scope (explicit non-additions)

The following Three.js `intersectObject` fields are deliberately **not**
exposed:

- `face` — Three.js-specific BufferGeometry vertex indices, leaks
  renderer structure
- `faceIndex` — same problem
- `object` — a Three.js `Object3D` reference; the handler already has
  `event.target` as the SOM node, which is the renderer-neutral
  equivalent
- `instanceId` — specific to `InstancedMesh`; defer until SOM grows an
  instancing concept of its own
- `uv1` — second UV channel; defer until a use case demands it

A `detail.raw` passthrough was also considered and rejected. Handlers
that need renderer internals should do their own raycasting outside the
SOM event channel.

---

## Files expected to change

- `apps/client/src/app.js` — extend `buildDetail` (one function, ~15 lines added)
- `packages/client/tests/pointer-events.test.js` — two new tests (16 and 17)
- `SESSION-32-smoke-test-plan.md` — Test 3 extended, Test 3b added (documentation only)

No changes to `packages/client/src/AtriumClient.js` — the dispatch path
is unchanged; the detail object is opaque to AtriumClient.

No changes to `packages/som`, `packages/protocol`, or `packages/server`.

---

## Acceptance

- All 15 existing pointer event tests still pass unchanged.
- Two new unit tests pass.
- Smoke test Test 3 confirms the new fields are populated correctly on a
  real click.
- Build log notes whether Test 3b (rotation invariance) was performed,
  and the result if so.
