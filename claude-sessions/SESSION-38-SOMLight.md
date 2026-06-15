# Project Atrium — `SOMLight` Implementation Brief

## Session type: Implementation

This brief implements `SOMLight` — a first-class, mutable, networked SOM
type wrapping `KHR_lights_punctual` lights. It is drafted from three
input documents:

- `Project_Atrium_2026-05-14.md` — Session 37 canonical handoff
- `DESIGN-Rendering-Independence.md` — three-tier model, full `SOMLight` design
- `DESIGN-SOMLight-Naming.md` — naming scheme, aliasing, registration mechanism
- `VERIFY-SOMLight-Set-Resolution-findings.md` — pre-brief verification (CONFIRMED)

**Read all four before writing any code.**

The verification confirmed: `set`-resolution is uniform; no server, client, or
protocol message-structure changes are needed; `SOMAnimation` (not `SOMMaterial`)
is the correct live analog for registration and wire-addressing. `SOMMaterial`
is not in `_objectsByName` and is reached via parent-node path traversal, not by
name — do not use it as a model.

---

## Non-goals / what is NOT in this brief

- **No `SOMCamera` completeness work.** That is a follow-on session.
- **No `Stage` (Tier C).** That is a follow-on session.
- **No Tier A `extras.atrium` hint schema.** Named and fenced.
- **No active-camera selection.** Fenced to the Tier A / `SOMCamera` session.
- **No `NavigationController` refactor.** Untouched.
- **No `buildClipsFromSOM` unit tests.** Pre-existing gap; separate session.
- **No server test harness batch-mode fix.** Pre-existing; separate session.
- **No new `apps/client`, `tools/som-inspector`, or `apps/playground`
  changes beyond consuming the new `SOMLight` type where it already
  surfaces through `DocumentView`.** Three.js renders `KHR_lights_punctual`
  lights automatically via `DocumentView`; no renderer-side bridge work is
  needed in this session.
- **No `Stage` reconcile behavior (`§4.2` runtime tier transitions).** That
  is the implementation session's primary correctness case for Stage, not
  this session. The reconcile behavior requires Stage to exist first.
- **No late-joiner sync verification.** Flagged as design-recommended /
  test-pending; verified in the smoke plan (§9), not via code changes.
- **No `@gltf-transform/extensions` version pinning changes.** Use whatever
  version the workspace currently resolves.

---

## What this session delivers

1. **`SOMLight` class** in `packages/som/src/SOMLight.js`
2. **`SOMDocument` integration** — `KHRLightsPunctual` extension registration,
   node-walk enumeration, dual-key registration in `_objectsByName`
3. **`SOMNode.light` accessor** — consistent with existing `.mesh` and `.camera`
4. **`@atrium/protocol` Ajv `set`-value schema** — accept light property fields
5. **Test fixture** — `space-lights.gltf` with one directional and one point light
6. **`@atrium/som` tests** — full coverage of `SOMLight` properties, events,
   registration, aliasing
7. **`@atrium/protocol` tests** — valid and invalid `set` messages for light fields
8. **Sync of `tests/client/som/`** — required after every `packages/som` change

Test baseline before starting: 324 tests total (46 protocol, 109 som, 32 server,
96 client, 32 renderer-three, 9 interaction). All must still pass after this
session; the new tests are additive.

---

## Files expected to change

```
packages/som/src/SOMLight.js              # NEW
packages/som/src/SOMDocument.js           # register KHRLightsPunctual, enumeration, dual-key
packages/som/src/SOMNode.js               # add .light accessor
packages/som/src/index.js                 # export SOMLight
packages/som/tests/som-light.test.js      # NEW — full SOMLight test suite
packages/protocol/src/set.json            # extend value schema for light fields
packages/protocol/tests/set.test.js       # extend with light field cases
tests/fixtures/space-lights.gltf          # NEW — test fixture
tests/client/som/                         # sync from packages/som/src/ (cp *.js)
```

## No changes expected in

```
packages/server/                          # set-resolution confirmed uniform; no changes
packages/client/                          # _onSet confirmed uniform; no changes
packages/renderer-three/                  # DocumentView renders KHR_lights_punctual
                                          #   automatically; no bridge work needed
packages/interaction/                     # untouched
apps/                                     # untouched
tools/                                    # untouched
```

If Claude Code finds it necessary to modify any file in the "no changes"
list, **stop and flag** rather than proceeding. The pre-brief verification
confirmed these should not require changes; a deviation signals either a
misunderstanding of the brief or a genuine design gap that needs resolution
in chat before implementation continues.

---

## Background: the naming / aliasing scheme

This is the load-bearing new concept in `SOMDocument`. Read carefully.

A `SOMLight` is registered in `_objectsByName` under **two literal keys**:

1. Its **bare glTF name** (e.g. `"Sun"`) — so it is addressable by its
   natural name if no collision exists.
2. A **qualified alias** `<hostNodeName>.light` (e.g. `"Sun.light"`) —
   always created unconditionally, so it is a stable wire identity
   regardless of whether a collision with the host node name exists.

Both keys point to the **same cached `SOMLight` wrapper** — there is one
object, two map entries. This is strictly additive to the Session 27
mechanism; the existing `_registerObject` call pattern is extended, not
replaced.

**Why always-on qualification?** Because a bare-name collision is the
norm, not the edge case — Blender's glTF exporter names a light and its
host node the same string by default (`"Sun"` node + `"Sun"` light).
Under the existing flat-namespace rule, the node wins `_objectsByName`
when names collide (registered first), so the bare `"Sun"` key points
to the node after a collision. The qualified `"Sun.light"` key always
points to the light, collision or not. Protocol `set` messages targeting
light intrinsics must use the qualified key to guarantee routing.

**Why unconditional?** An object's wire identity must not depend on
current global state (whether a collision happens to exist right now).
Principle 11 / §4.2 hazard class: the same name resolves differently
depending on what else is in the scene. The alias is always created so
authors and tooling can rely on `"Sun.light"` without knowing the global
namespace state.

**Separator convention:**
- `.` = intrinsic contained child (`"Sun.light"`, `"MainCamera.camera"`)
- `/` = external-ref ingested node (`"Chair/Body"`) — pre-existing, distinct

**`SOMCamera` note:** the same aliasing scheme applies to cameras
(`"MainCamera.camera"`). `SOMCamera` is not registered today
(confirmed by verification). This brief does NOT implement `SOMCamera`
registration; it establishes the pattern that the `SOMCamera` brief
will follow.

---

## Implementation order

Follow this order. Each step is independently testable. Do not proceed to
the next step if tests from the current step are failing.

### Step 1 — `SOMLight` class

Create `packages/som/src/SOMLight.js`.

```javascript
// SPDX-License-Identifier: MIT
import { SOMObject } from './SOMObject.js'

export class SOMLight extends SOMObject {
  constructor(light) {
    super()
    this._light = light
  }

  // --- Intrinsic read-only ---

  get name() { return this._light.getName() ?? null }

  // --- Mutable properties (each setter fires mutation event) ---

  get color()          { return this._light.getColor() }
  set color(v)         { this._light.setColor(v); this._fireMutation('color', v) }

  get intensity()      { return this._light.getIntensity() }
  set intensity(v)     { this._light.setIntensity(v); this._fireMutation('intensity', v) }

  get type()           { return this._light.getType() }
  set type(v)          { this._light.setType(v); this._fireMutation('type', v) }

  get range()          { return this._light.getRange() }   // number | null
  set range(v)         { this._light.setRange(v); this._fireMutation('range', v) }

  get innerConeAngle() { return this._light.getInnerConeAngle() }
  set innerConeAngle(v){ this._light.setInnerConeAngle(v); this._fireMutation('innerConeAngle', v) }

  get outerConeAngle() { return this._light.getOuterConeAngle() }
  set outerConeAngle(v){ this._light.setOuterConeAngle(v); this._fireMutation('outerConeAngle', v) }

  get extras()         { return this._light.getExtras() }
  set extras(v)        { this._light.setExtras(v); this._fireMutation('extras', v) }
}
```

`_fireMutation` is a helper that should fire the `mutation` event only if
listeners are present — consistent with every other SOM type. Check how
`SOMNode` or `SOMAnimation` implements this pattern and follow it exactly.
Do not add new event machinery.

Verify the exact glTF-Transform `Light` getter/setter names against
`@gltf-transform/extensions` before writing the accessors — the names above
are specified from the design doc but confirm against the actual API.
`getColor` / `setColor` may return/accept a `vec3` array; check the type
and document it in a comment if it differs from `[r,g,b]`.

### Step 2 — Export from `@atrium/som`

Add `SOMLight` to `packages/som/src/index.js`. Follow the existing export
pattern.

### Step 3 — `SOMNode.light` accessor

Add a `.light` getter to `SOMNode` that returns the `SOMLight` attached to
this node (or `null` if none). Follow the existing `.mesh` and `.camera`
accessors as the exact model — the pattern should be parallel.

The accessor should return the cached wrapper, not create a new one on each
call. The wrapper will be created during graph construction (Step 4) and
stored on the `SOMNode` (e.g. `this._light = null`, set in
`_buildObjectGraph`).

### Step 4 — `SOMDocument` integration

This is the most complex step. Make the following changes to
`SOMDocument.js`:

#### 4a — Register the extension on read paths

`KHRLightsPunctual` must be registered on the glTF-Transform `Document`
before parsing or authored lights will not parse at all. This is an I/O
concern — it must happen on **both** the server and client read paths.

Check where `SOMDocument` (or the code that creates it) calls into
glTF-Transform's I/O APIs. The registration call is:

```javascript
import { KHRLightsPunctual } from '@gltf-transform/extensions'
// ...
document.createExtension(KHRLightsPunctual)
```

This must be called before any `read`/`readBinary`/`fromJSON` operation
that might encounter `KHR_lights_punctual` data. Locate the right
call site (likely in `SOMDocument` constructor or factory, or in the
server/client glTF read path) and add the registration there. If
the registration point is inside `packages/som`, add the import. If it
must live outside `packages/som` (e.g. in the server or client read path),
note this clearly and add it there — but do not modify server or client
files without flagging it, since those are in the "no changes expected"
list.

#### 4b — Node-walk enumeration

In `_buildObjectGraph` (the method that constructs all SOM wrappers
bottom-up), add a pass that discovers lights via the **node-walk**, not
via `KHRLightsPunctual.listProperties()`.

For each `SOMNode` being wrapped:
1. Call `node.getExtension('KHR_lights_punctual')` (or the equivalent
   glTF-Transform API — confirm the exact call).
2. If a light is present, create a `SOMLight` wrapper for it and cache it.
3. Set `somNode._light = somLight` (so `somNode.light` returns it).
4. Register the light under **both** keys in `_objectsByName`:
   - Bare name: `somLight.name` (if non-null and non-empty)
   - Qualified alias: `${somNode.name}.light` (always, even if bare name
     would not collide)

**Do not** use `KHRLightsPunctual.listProperties()` for SOM graph
construction. That method surfaces detached lights (lights in the document
dictionary not attached to any node), which node-walk cannot discover,
causing the two paths to disagree. Node-walk is authoritative.

**Detached lights are not registered.** A light with no host node has no
transform, renders nothing, and has no SOM presence. This is a deliberate
fence.

**Bare-name collision:** if the bare name already exists in `_objectsByName`
(e.g. the host node `"Sun"` was registered first), the node wins — this is
the existing Session 27 rule, unchanged. The qualified alias `"Sun.light"`
is still registered and always resolves to the light. Log a warning (match
the existing collision-warning pattern).

#### 4c — Enumerate `som.lights`

Add a `get lights()` accessor to `SOMDocument` that returns an array of all
registered `SOMLight` wrappers. Follow the pattern of `som.animations`,
`som.nodes`, etc. The implementation may iterate `_objectsByName` values
filtering by type, or maintain a parallel `_lights` array during graph
construction — whichever matches the existing pattern.

### Step 5 — Protocol schema

In `packages/protocol/src/set.json`, confirm `value` is `{}` (open schema,
confirmed by verification). No structural change is needed to the `set`
message schema — `node` already accepts any non-empty string, `value` is
already open.

However, if the protocol package has a separate **value validation** schema
or per-field validator for `set` targets, extend it to accept light property
fields:

| Field | Type | Constraint |
|---|---|---|
| `color` | array of 3 numbers | each in [0, ∞) |
| `intensity` | number | ≥ 0 |
| `type` | string | `"directional"` \| `"point"` \| `"spot"` |
| `range` | number \| null | if number, > 0 |
| `innerConeAngle` | number | 0 to π/2 |
| `outerConeAngle` | number | 0 to π/2 |
| `extras` | object | any |

If no per-field value validation exists today, do not introduce it for
lights only — that would make lights special-citizens. In that case, note
in the test comments that value-range enforcement is a future protocol
enhancement.

### Step 6 — Test fixture: `space-lights.gltf`

Create `tests/fixtures/space-lights.gltf`. This is a fork of `space.gltf`
(the canonical gray-box world) with `KHR_lights_punctual` lights added. It
must be a valid glTF 2.0 file with the extension declared in
`extensionsUsed` and `extensionsRequired`.

Include exactly two lights:

**Light 1 — directional (the "sun"):**
- Name: `"Sun"`
- Host node name: `"Sun"` (deliberately identical — this is the collision
  case the naming scheme exists to handle)
- Type: `"directional"`
- Color: `[1.0, 0.98, 0.95]` (warm white)
- Intensity: `3.0`
- No range (directional lights have no range)

**Light 2 — point (the "lamp glow"):**
- Name: `"LampGlow"`
- Host node name: `"LampGlow"` (same collision pattern)
- Type: `"point"`
- Color: `[1.0, 0.9, 0.7]` (warm amber)
- Intensity: `10.0`
- Range: `5.0`
- Position: near the existing lamp object in space.gltf (translate the host
  node appropriately)

The fixture is minimal — it does not need skybox, animations, or any extras
beyond the lights. The existing `space.gltf` geometry (ground plane, crate,
lamp) can be included or stripped down to just the geometry needed to make
the fixture recognizable. Keep it small.

The fixture generator should be a script at
`tests/fixtures/generate-space-lights.js`, following the pattern of
`generate-space-anim.js`. The generator produces the `.gltf` file; commit
both the generator and the generated file.

If generating a valid `KHR_lights_punctual` glTF programmatically proves
difficult, a hand-authored minimal JSON glTF is acceptable. The minimum
required structure is:

```json
{
  "asset": { "version": "2.0" },
  "extensionsUsed": ["KHR_lights_punctual"],
  "extensionsRequired": ["KHR_lights_punctual"],
  "extensions": {
    "KHR_lights_punctual": {
      "lights": [
        {
          "name": "Sun",
          "type": "directional",
          "color": [1.0, 0.98, 0.95],
          "intensity": 3.0
        },
        {
          "name": "LampGlow",
          "type": "point",
          "color": [1.0, 0.9, 0.7],
          "intensity": 10.0,
          "range": 5.0
        }
      ]
    }
  },
  "nodes": [
    {
      "name": "Sun",
      "extensions": { "KHR_lights_punctual": { "light": 0 } }
    },
    {
      "name": "LampGlow",
      "translation": [0.0, 1.5, 0.0],
      "extensions": { "KHR_lights_punctual": { "light": 1 } }
    }
  ],
  "scenes": [{ "nodes": [0, 1] }],
  "scene": 0
}
```

### Step 7 — Tests: `packages/som/tests/som-light.test.js`

Write the full `SOMLight` test suite. Use `node --test` (no external
framework). Follow the style and structure of `som-animation.test.js` as
the primary model — it covers a non-node SOM type with mutable properties
and mutation events, which is exactly the pattern here.

**Required test cases:**

```
SOMLight construction
  - wraps a KHR_lights_punctual Light property
  - name getter returns the light's glTF name
  - extends SOMObject

SOMLight mutable properties
  - color getter returns current value
  - color setter updates the underlying Light and fires mutation event
  - intensity getter returns current value
  - intensity setter updates and fires mutation
  - type getter returns current value ('directional' | 'point' | 'spot')
  - type setter updates and fires mutation
  - range getter returns number or null
  - range setter accepts a number and fires mutation
  - range setter accepts null (infinite range) and fires mutation
  - innerConeAngle getter and setter
  - outerConeAngle getter and setter
  - extras getter and setter fires mutation

SOMLight mutation events
  - mutation event detail includes property name and new value
  - no SOMEvent allocated when no listeners present (zero-cost check)

SOMDocument light registration
  - som.lights returns all SOMLight wrappers
  - lights are registered in _objectsByName under bare name
  - lights are registered under qualified alias <nodeName>.light
  - both keys return the same cached wrapper instance
  - SOMNode.light returns the SOMLight for its host node
  - SOMNode.light returns null for nodes with no light

SOMDocument collision handling
  - when host node and light share a name, node wins bare-name slot
  - qualified alias still resolves to the light
  - collision warning is logged

SOMDocument enumeration
  - node-walk finds lights on all nodes
  - detached lights (not on any node) are not registered

wire-address path (integration)
  - getObjectByName('Sun.light') returns the SOMLight
  - setPath(somLight, 'intensity', 0.5) updates the light
  - setPath(somLight, 'color', [1, 0, 0]) updates the light
  - setPath(somLight, 'range', null) sets range to null
```

Load `space-lights.gltf` (the new fixture) for the registration and
wire-address tests. For the property and mutation tests, a minimal
in-memory `SOMLight` wrapping a test double is fine, following the
pattern in the animation tests.

**Test count target:** aim for ≥ 25 new tests. The exact number matters
less than coverage; do not pad with trivial duplicates.

### Step 8 — Tests: `packages/protocol/tests/set.test.js`

Extend the existing set-message test file. **Do not replace existing
tests — add to them.**

Add a section `set message — light fields` with cases:

```
valid set — light intensity (number)
valid set — light color (3-element array)
valid set — light type ('directional')
valid set — light type ('point')
valid set — light type ('spot')
valid set — light range (positive number)
valid set — light range (null)
valid set — node field is dotted name 'Sun.light'
valid set — node field is dotted name 'MainCamera.camera' (forward-compat)
```

If the protocol schema has no value-range enforcement (likely, per Step 5),
note this in a comment and do not add invalid-value tests that the schema
would not catch — that would test behavior the schema doesn't have.

### Step 9 — Sync `tests/client/som/`

After all `packages/som` changes are complete:

```bash
cp packages/som/src/*.js tests/client/som/
```

This is required after every `packages/som` change. Do not skip it.

---

## Risks / watch-outs

1. **`KHRLightsPunctual` registration location.** The extension must be
   registered on the glTF-Transform `Document` before I/O. If `SOMDocument`
   creates the `Document` internally, the registration goes in the constructor.
   If the `Document` is created by the server or client read path and then
   passed to `SOMDocument`, the registration must happen in that calling code
   — which would put it in a "no changes expected" file. **Flag before
   proceeding if this is the case.** Do not modify server or client read paths
   without a clear signal from the brief.

2. **`Light.getColor()` return type.** glTF-Transform may return color as
   a `Float32Array` rather than a plain `[r,g,b]` array. If so, the
   `SOMLight.color` getter should convert to a plain array for consistency
   with the rest of the SOM API (e.g. `SOMNode.rotation` returns a plain
   array, not a typed array). Check and handle this.

3. **`Light.getRange()` null semantics.** The spec defines `range: null` as
   infinite range. glTF-Transform may return `0`, `undefined`, or `null` for
   an unset range — confirm which and ensure the getter always returns a
   number or `null` (never `undefined` or `0`-meaning-infinite).

4. **Node-walk ordering relative to light registration.** Lights must be
   registered *after* their host `SOMNode` is registered (so the qualified
   alias `somNode.name + ".light"` uses the already-registered node name).
   Verify that the node-walk order in `_buildObjectGraph` guarantees the
   node wrapper exists before the light wrapper is created.

5. **`_registerObject` with null name.** A light with no `name` field in
   glTF has a null or empty name. Do not register it under the bare-name
   key (skip it); still register it under the qualified alias (which uses
   the host node's name, which is always set for registered nodes). Add a
   guard and a test for this case.

6. **`som.lights` and duplicate-free enumeration.** If `_objectsByName`
   stores the same wrapper under two keys (bare + alias), iterating the Map
   values would yield the same wrapper twice. `som.lights` must deduplicate.
   A separate `_lights` array maintained during graph construction is the
   cleanest approach.

7. **`tests/client/som/` sync.** The manual copy step (Step 9) is required
   every time `packages/som/src/` changes. Skipping it causes
   `tests/client/` to silently use stale SOM code. Do not skip it.

8. **Test count reconciliation.** Before finishing, run all packages and
   confirm the total is ≥ 349 (324 baseline + ≥ 25 new som-light tests +
   new protocol tests). Report the full per-package breakdown, not a
   summary number, so it can be reconciled against the baseline.

---

## Acceptance criteria

The session is complete when all of the following are true:

- [ ] `packages/som/src/SOMLight.js` exists and exports `SOMLight`
- [ ] `SOMLight` extends `SOMObject`, wraps `KHR_lights_punctual` `Light`
- [ ] All mutable properties fire `mutation` events with correct detail
- [ ] `SOMDocument._buildObjectGraph` registers lights under both bare-name
      and qualified-alias keys in `_objectsByName`
- [ ] `SOMNode.light` returns the `SOMLight` for its host node (or `null`)
- [ ] `som.lights` returns all `SOMLight` wrappers without duplicates
- [ ] `getObjectByName('Sun.light')` resolves the light in `space-lights.gltf`
- [ ] `getObjectByName('Sun')` (collision case) resolves the node, not the
      light — and a warning was logged
- [ ] `tests/fixtures/space-lights.gltf` exists with two lights (directional
      + point) using the collision-name pattern
- [ ] `packages/som/tests/som-light.test.js` passes with ≥ 25 tests
- [ ] `packages/protocol/tests/set.test.js` additions pass; existing tests
      still pass
- [ ] All 324 baseline tests still pass (no regressions)
- [ ] `tests/client/som/` is synced
- [ ] Full per-package test count reported and reconciled against baseline

---

## Suggested commit message

```
feat(som): add SOMLight — KHR_lights_punctual wrapper with aliased registration

- SOMLight wraps glTF-Transform Light; all properties mutable + mutation-firing
- SOMDocument registers lights under bare name + <node>.light qualified alias
- SOMNode.light accessor; som.lights enumeration
- space-lights.gltf fixture (directional + point, collision-name pattern)
- 25+ new @atrium/som tests; @atrium/protocol set-field tests extended
- tests/client/som/ synced
```
