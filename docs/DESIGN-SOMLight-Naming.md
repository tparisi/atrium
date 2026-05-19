# Project Atrium — `SOMLight` / `SOMCamera` Naming Scheme Design

## Design session · Design-only · No code

This document is the output of a design-pass conversation on the
`SOMLight` naming scheme. It is design-only (Principle 1: design before
code). It produces no repo changes and no implementation brief.

It **complements**, and does not supersede, the two documents this
session started from:

- `Project_Atrium_2026-05-14.md` — the Session 37 canonical handoff.
- `DESIGN-Rendering-Independence.md` — the rendering-independence
  design session output, which fully designed `SOMLight`/`SOMCamera`
  as Tier B and left five open questions (its §8).

This document settles the naming/identity portion of that work
— specifically the design doc's **open question #4**
(`KHR_lights_punctual` namespace registration) and the unstated
collision assumption inside its §5.1 wire-format example. It is the
input a future `SOMLight` implementation brief should be drafted
*from*, alongside the two documents above.

---

## 1. Why this document exists

`DESIGN-Rendering-Independence.md` §5.1 specified the `SOMLight` wire
format as `{ "type": "set", "node": "<lightName>", "field": "intensity",
... }` and flagged (open question #4) that `KHR_lights_punctual` lights
must register into `_objectsByName` so `getObjectByName` / protocol
`set` routing stays a single uniform path (the Session 27 principle).

That §5.1 example contains an **unstated assumption**: that a light's
name does not collide with its host node's name. In practice it almost
always does — Blender's glTF exporter names a light and its host node
the same string by default (a "Sun" node carrying a "Sun" light), so
the collision is the norm on real lit assets, not an edge case. Under
the existing flat-namespace rule (handoff: names unique across types;
on collision the node wins `_objectsByName`; the loser is reachable
only via a typed accessor; warning logged), this means **protocol
`set` has no uniform-path address for the light** whenever the names
collide — i.e. on essentially every real lit asset.

This document settles a naming scheme that closes that gap without
changing the protocol or the resolution mechanism.

---

## 2. Background facts established this session

These were verified against the `KHR_lights_punctual` Khronos
specification and the glTF-Transform `Light` / `KHRLightsPunctual`
API. They are recorded here so the implementation brief does not
re-derive them.

### 2.1 glTF lighting model

- Core glTF 2.0 has no lighting. Lighting is the ratified Khronos
  extension `KHR_lights_punctual` (directional / point / spot).
- Lights live in a **document-level dictionary**
  (`glTF.extensions.KHR_lights_punctual.lights`), and are **attached
  to a node** via `node.extensions.KHR_lights_punctual.light = <index>`.
- The light definition carries **only intrinsic properties**: `type`
  (mandatory), `color` (linear RGB), `intensity`, optional `name`,
  optional `range` (point/spot only), and nested
  `spot.{innerConeAngle, outerConeAngle}` for spot lights.
- A light has **no position and no direction of its own**. Both come
  entirely from the host node's transform:
  - **Position** = host node's world location (point/spot).
  - **Direction** = host node's local **−Z** axis after rotation
    (spot/directional), the same forward convention glTF cameras use.
  - **Point lights** are omnidirectional — no direction at all.
- Changing a light's aim is therefore a **host-node rotation
  mutation** (`SOMNode.rotation`, a quaternion), flowing through the
  existing node-mutation/reconcile path. It is **not** a `SOMLight`
  operation and adds no new machinery.

### 2.2 glTF-Transform support

- `@gltf-transform/extensions` exports `KHRLightsPunctual`, `Light`,
  `LightType`. The extension is first-class and stable.
- The extension must be **explicitly registered** on the Document
  (`document.createExtension(KHRLightsPunctual)`) or authored lights
  **do not parse at all**. This is an **I/O concern on both the
  server and client read paths**, not merely a namespace concern.
  (This is the deeper half of design-doc open question #4.)
- The `Light` property surface is flat — `get/setType`,
  `get/setColor`, `get/setIntensity`, `get/setRange`,
  `get/setInnerConeAngle`, `get/setOuterConeAngle`, `get/setName`,
  `get/setExtras`. The spec's nested `spot` sub-object is **flattened
  by glTF-Transform** to top-level cone-angle getters/setters, so the
  flat `SOMLight` surface maps 1:1 with no translation logic.
- `Light` extends `ExtensionProperty → Property → GraphNode`, the
  same base chain every other wrapped glTF-Transform property has.
  The established SOM wrapper pattern (cache wrapper, fire `mutation`
  after the underlying setter) applies unchanged. No new event
  mechanism.
- `range` is `number | null` (null = infinite). The wrapper, the
  protocol Ajv `set`-value schema, and any inspector display must
  permit null (display `—` for null, mirroring `pauseTime`).
- The raw glTF JSON shape (nested `spot`) differs from the SOM
  surface (flat). Documentation note for fixture authors / raw-glTF
  debugging only; no logic impact (glTF-Transform flattens it).

> **Verification still owed (flagged, not closed):** the exact
> `set`-resolution path for non-node objects (material, mesh,
> external-ref) was reasoned from the uniform mechanism but **not
> confirmed against the actual `@atrium/protocol` schema and
> server/`AtriumClient` resolution code**. Material is the closest
> analog to `SOMLight` (a non-node object whose own intrinsics are
> genuinely wire-mutated, e.g. avatar `baseColorFactor`) and is the
> right precedent to verify before the implementation brief is
> finalized. See §6.

---

## 3. The settled naming scheme

### 3.1 SOM side

`SOMLight` and `SOMCamera` are **first-class SOM types**, registered
exactly like `SOMMesh`, `SOMAnimation`, and every other type — by
their own glTF `name`. The SOM mirrors glTF's shape; lights and
cameras are **not** special citizens.

`SOMNode` exposes `.light` and `.camera` accessors, consistent with
the existing `.mesh` / `.camera` pattern (this is "Model C": a
contained object reachable both through its host node and by name,
the same dual-access mesh and camera already have).

### 3.2 Wire side

The protocol is **unchanged**: `{ type, node, field, value, seq }`,
`node` is a string, resolution is a single `getObjectByName` Map
lookup. The resolver **never parses** the string — the **literal-key
invariant** holds: separators are characters in a key, never
traversal operators. This is the truest form of the Session 27
"single uniform path" principle: one resolution mechanism, names are
opaque keys.

### 3.3 The one new concept: aliasing

A single wrapper may be registered in `_objectsByName` under **more
than one literal key**:

- its **bare glTF name**, and
- a **host-qualified alias** for collision-prone contained types.

Both keys are literal, both resolve in one lookup, both point at the
**same cached wrapper**. This is strictly **additive** to the Session
27 mechanism, not a change to it. It has precedent-shaped logic:
typed accessors (`getAnimationByName`) already let one object be
reachable two ways; aliasing makes the second way a first-class Map
key instead of a separate accessor.

### 3.4 Key convention

| Type | Key(s) in `_objectsByName` |
|---|---|
| Node | bare name — `Sun` |
| Animation | bare name — `WalkCycle` |
| Material | bare name |
| Mesh | bare name (often unnamed → no key) |
| **Light** | bare name **+ qualified alias** — `Sun.light` |
| **Camera** | bare name **+ qualified alias** — `MainCamera.camera` |

- Qualified alias = `<hostNodeName>.<type>`, **always created** (not
  collision-conditional), so the alias is a **stable wire identity**
  regardless of whether the bare name actually collides. (Always-on
  qualification is the multiplayer-safety choice: an object's
  addressable identity must not depend on current global state —
  Principle 11 / §4.2 hazard class.)
- `.` (dot) marks an **intrinsic contained child** (a light/camera of
  a node).
- `/` (slash) remains **reserved for external-ref ingested nodes**
  (`Chair/Body`) — a distinct, pre-existing convention. The two
  conventions are visually and semantically distinct: `.` =
  intrinsic child of this node; `/` = node ingested under a
  container.

### 3.5 Wire examples

Light intrinsic change:
```json
{ "type": "set", "node": "Sun.light", "field": "intensity", "value": 0.8, "seq": 57 }
```

Camera intrinsic change:
```json
{ "type": "set", "node": "MainCamera.camera", "field": "yfov", "value": 0.9, "seq": 58 }
```

Re-aiming a light (a **node-rotation** change, not a light change):
```json
{ "type": "set", "node": "Sun", "field": "rotation", "value": [0, 0, 0, 1], "seq": 59 }
```

Animation (unchanged from today):
```json
{ "type": "set", "node": "WalkCycle", "field": "playback", "value": { }, "seq": 42 }
```

---

## 4. What this resolves

- **Collisions.** Lights/cameras always carry a collision-free
  qualified alias for the wire; the Blender "Sun node + Sun light"
  default no longer breaks `set` routing.
- **SOM consistency.** Preserved — lights/cameras mirror glTF like
  every other SOM type; no synthetic-key special-citizen problem.
  (This was the decisive objection that moved the design from a
  single-qualified-key scheme to the aliasing scheme.)
- **Protocol / mechanism.** Unchanged — same message shape, same
  single-lookup resolution, same literal-key invariant. Aliasing is
  strictly additive.
- **Animations / materials.** Unchanged; bare names still work. If a
  real collision ever forces it, they can gain a qualified alias
  **additively, per-type, when justified** — no protocol change, no
  flag-day.
- **Open question #4 (design doc §8).** Answered in two parts:
  (a) `KHRLightsPunctual` must be registered on the Document on both
  server and client **read** paths or lights don't parse; (b) parsed
  lights register into `_objectsByName` under bare name + qualified
  alias via the node-walk construction pass (§5).

---

## 5. Enumeration / construction mechanism

- Lights are discovered by the **node-walk** the SOM construction
  pass already performs to build `SOMNode` wrappers and wire up
  `.mesh` / `.camera`. For each node, check
  `node.getExtension('KHR_lights_punctual')`; if present, wrap the
  light, register it under **both** keys (bare name + `<host>.light`
  alias), and set `node.light`.
- Node-walk is the **authoritative** SOM enumeration.
  `KHRLightsPunctual.listProperties()` is **not** used for SOM graph
  construction. The brief must state this, because `listProperties()`
  would additionally surface **detached** lights (a light in the
  document dictionary referenced by no node), causing the two
  enumeration paths to disagree.
- **Detached lights are not registered.** A node-walk cannot discover
  a light with no host node. This is consistent, not a special case:
  a detached punctual light has no transform, renders nothing, and
  per this scheme has no SOM presence. Recorded as a **deliberate
  fence** (§7), not an oversight. If a use case for pre-created
  detached lights ever appears, it is an amendment, not a v2.

---

## 6. Verification owed before / during the implementation brief

These follow the project's "reasoned-but-flag-to-verify" discipline.
They are **not** asserted as settled.

1. **Non-node `set`-resolution path.** Confirm against the actual
   `@atrium/protocol` schema + server + `AtriumClient` resolution
   code that `set` `node` resolves materials/meshes/external-ref
   nodes by the registered name via the single `getObjectByName`
   lookup, and that material sharing is handled by per-object-material
   convention (the avatar-color pattern). `SOMLight`'s wire path is
   "the material pattern + a qualified alias key"; if the real
   protocol does something else for non-node objects, the `SOMLight`
   wire design must mirror *that* instead. **This is the single most
   important pre-brief verification.**
2. **Late-joiner sync.** Per design doc §8.1: lights are **native**
   document objects (in the world glTF, not externally ingested), so
   they are **not** filtered from `som-dump` the way external-ref
   nodes are — therefore the external-ref late-joiner gap
   structurally does **not** apply. Borrow the *naming mechanism*
   shape from external refs; do **not** borrow *sync-correctness*
   expectations from them (external-ref sync is a known-broken path).
   Verify a mutated `KHR_lights_punctual` value actually serializes
   into `som-dump` and reaches a fresh client, with a known-good
   baseline, before checking off.
3. **`@atrium/protocol` `set`-value validation.** Adding light
   fields touches the Ajv `set`-value schema + protocol tests even
   though message *structure* is unchanged (incl. `range: null`).
   The brief must scope `@atrium/protocol` as a **touched package**,
   not just SOM + renderer-three.

---

## 7. Fences (deliberate, named — not omissions)

- **Detached (unattached) lights are not registered.** §5. Node-walk
  cannot find them; a detached punctual light is inert. Amendment,
  not v2, if ever needed.
- **Residual bare-name collision among node / animation / material**
  is **pre-existing**, governed by the existing Session 27 rule
  (node wins `_objectsByName`; typed accessor reaches the loser;
  warning logged). It is **out of scope** for this work and is
  **neither introduced nor worsened** by it. The aliasing mechanism
  is type-agnostic, so these types *can* adopt a qualified alias
  later if a real collision rate ever justifies it — additively, per
  type. The qualified scheme does **not** retroactively fix these;
  do not read it as having done so.
- **"Node/animation/material collisions are rare" is unverified
  authoring-convention inference**, not a confirmed fact. It is
  explicitly **not this work's job** to verify it. Recorded so the
  scope boundary reads as a decision.
- **glTF-Transform `Light.getName()` vs SOM alias.** A Blender light
  authored as `"Sun"` keeps `light.getName() === "Sun"` while its
  SOM qualified alias is `"Sun.light"`. This divergence is
  **intended** (the alias is a SOM construct, like external-ref
  prefixed names). The implementation must **not** attempt to keep
  `light.getName()` and the SOM alias in sync, nor be confused when
  `light.getName() !== somAliasKey`. This is the `SOMLight`-specific
  instance of the name/key divergence external refs already
  established.
- **Renderer-side −Z convention.** Whichever session builds light
  *rendering* must honor "host node local −Z = spot/directional
  emission direction" if it ever constructs lights **outside** the
  `DocumentView` path. Inside `DocumentView`, the glTF→Three loader
  handles it. This is a **renderer-bridge correctness watch-out**
  (analogous to the animation `clampWhenFinished` / `action.time`
  gotchas), not a `SOMLight`-type-design concern — flagged here so
  it lands in the correct session's risk list rather than surfacing
  as a "why are all my spotlights aimed at the floor" smoke-test
  bug.
- **No protocol redesign.** This scheme is a `node`-field **naming
  convention** plus an **additive aliasing** capability in
  `_objectsByName`. Message shape, resolution mechanism, and the
  literal-key invariant are untouched. A wire-addressing redesign
  was considered and explicitly rejected as out of scope and
  unnecessary.
- **Active-camera selection / Tier A schema.** Untouched here —
  remains design-doc-fenced Tier A / `SOMCamera`-session work.
- **Any code.** Design-only (Principle 1).

---

## 8. `.mesh` asymmetry — required brief framing

Lights and cameras get qualified aliases; meshes and materials do
not (by default). The implementation brief **must state why in one
place**, or a future reader sees an inconsistent type model and
reopens it:

> Lights (and cameras) are always host-qualified because they collide
> with host-node names **by default in the dominant authoring
> toolchain** (Blender's glTF exporter names a light and its host
> node identically). This is a **collision-domain remedy**, not a
> statement that lights are structurally different from meshes.
> Meshes are not qualified because (a) they are frequently exported
> unnamed (no key, no possible collision) and (b) mesh/node name
> collision is *believed* rare — flagged as unverified
> authoring-convention inference. Materials' own state is, in
> practice, rarely the wire-addressed thing (transform lives on the
> node, appearance often via per-object materials), so collision
> consequence is additionally low. The aliasing mechanism is
> type-agnostic; mesh / animation / material may adopt a qualified
> alias later, additively and per type, **only if a real collision
> rate justifies it**. Camera is qualified from the start (not
> latent) precisely so that domino is pre-handled rather than
> rediscovered when `SOMCamera` completeness work lands.

---

## 9. Status of design-doc §8 open questions after this session

| # | Design-doc open question | Status after this document |
|---|---|---|
| 1 | Late-joiner sync for `SOMLight`/`SOMCamera`/active-camera | Reasoning unchanged (native → unfiltered `som-dump` → external-ref gap does not apply). Still **flag-to-verify** (§6.2). |
| 2 | Runtime tier transition / fallback reconcile (§4.2) | **Untouched here.** Remains the implementation session's primary reconcile-correctness case. |
| 3 | Active-camera representation | **Untouched here.** Remains Tier A / `SOMCamera`-session work. |
| 4 | `KHR_lights_punctual` namespace registration | **Answered** (§3, §5): register extension on both read paths *and* register parsed lights under bare-name + qualified-alias via node-walk. |
| 5 | `@atrium/protocol` `set`-value validation | **Confirmed in scope** (§6.3): Ajv schema + tests, incl. `range: null`. Protocol is a touched package. |

---

## 10. Recommended next steps (suggested, not committed)

- This document + `DESIGN-Rendering-Independence.md` +
  `Project_Atrium_2026-05-14.md` are the three inputs for a future
  **`SOMLight` implementation brief**, drafted per the
  briefs-that-worked pattern (explicit non-goals / files-expected-to-
  change / no-changes-expected-in / implementation-order / risks /
  acceptance-criteria).
- **Pre-brief blocker:** the §6.1 non-node `set`-resolution
  verification should be done against the live repo *before* the
  brief is finalized, so the wire path is designed on verified
  ground rather than stacked inference.
- Per the design doc's §10 ordering: `SOMLight` first (highest value,
  cleanest, self-contained), `SOMCamera` second (reuses this scheme's
  qualified-alias pattern), `Stage` as its own / paired session.
- The full-system QA pass (the other live thread, owning the Session
  37 smoke deferrals) remains independent and unblocked by this work.
