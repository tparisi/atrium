# Project Atrium — Rendering-Independence Design

## Design session · Design-only · No code

This document is the output of the rendering-independence
design session. It is design-only (Principle 1: design before code). It
produces no repo changes and no implementation brief. It settles what
"rendering independence" means as a project goal, defines the model that
governs where camera/lighting/setup concerns live, and fully designs two
new SOM types (`SOMLight`, `SOMCamera`). It explicitly unbundles several
adjacent threads.

It supersedes nothing. It is drafted from `Project_Atrium_2026-05-14.md`
(Session 37 handoff) and the resolved April-era background decision
(Session ~21).

---

## 1. Why this session exists

The presenting problem, in the project owner's words: there is
replicated code across the three rendering consumers — `apps/client`,
`tools/som-inspector`, `apps/playground` — and app creation is becoming
a copy-and-paste exercise. The goal is to stop that *without* building a
meta-rendering abstraction layer that wraps Three.js / Babylon / etc.
The SOM already provides a good abstraction; the work is to (a) close
SOM gaps for things an app legitimately manipulates at runtime, and (b)
factor genuinely app-side setup into shared, parameterized helper code.

The May-14 handoff framed this as "Phase 2: bootstrap + camera-sync
extraction," with the open question being how ambitious to be. **This
session deliberately reframes away from that.** This is not the
unbundled Phase 2. It is a different and narrower cut: sort every
replicated concern by *what kind of thing it is*, then design the small
set of SOM additions and the single app-side helper concept that the
sort produces.

---

## 2. Goals

1. State what "rendering independence" means as a project goal —
   precisely enough that future sessions can tell whether a proposed
   change serves it.
2. Define the **three-tier model** that classifies every
   camera/lighting/setup concern, and the **precedence resolution
   chain** that says how the tiers compose at runtime. This is the
   spine of the document; everything else hangs off it.
3. Fully design `SOMLight` as first-class, mutable, networked world
   state (Tier B).
4. Fully design `SOMCamera` completeness — closing the gap between the
   existing thin wrapper and a first-class switchable scene-graph
   camera object (Tier B).
5. Define the `Stage` concept (Tier C) — the single app-side helper
   that absorbs the replicated setup machinery — at the level of
   responsibilities and boundaries, not implementation.

### Non-goals

- **No meta-renderer.** This design never proposes an abstraction that
  hides Three.js behind a renderer-neutral rendering API. The seam
  between renderer-neutral and renderer-specific stays exactly where
  Principle 12 puts it: `@atrium/renderer-three`.
- **No NavigationController refactor.** The per-frame
  input→camera→`view`-message loop is untouched by this design. See
  §7 (Fences).
- **No Tier A schema.** The world-metadata hint tier is named and its
  slot in the precedence chain is specified, but its concrete
  `extras.atrium` schema is future work. See §7.
- **No implementation brief, no audit artifact, no code.** Design-only.
  An implementation brief for `SOMLight`/`SOMCamera`/`Stage` is a
  separate future session drafted from this document.
- **Background is not reopened.** Its placement was settled April-era
  design. See §6.

---

## 3. What "rendering independence" means (and does not)

Rendering independence is **not** "zero Three.js in apps." Some
Three.js is legitimately app-specific and will always live in app code:
per-app bootstrap configuration, `buildAvatarDescriptor` geometry, the
choice of renderer parameters. The May-14 handoff is explicit on this
and this design affirms it.

Rendering independence **is** three concrete properties:

1. **`packages/client` never imports a renderer** (Principle 12,
   unchanged). Already true; this design must not erode it.
2. **World state that an app or a peer can manipulate is expressed in
   the SOM, not in renderer code.** A light's color, a camera's fov, a
   choice of active camera — these are world state. If they live only
   in Three.js objects, they cannot be networked, serialized, or
   inspected, and every app must re-implement them. Closing these gaps
   is the SOM-side half of rendering independence.
3. **App-side setup that has no SOM analog is written once, shared, and
   parameterized — not copy-pasted per app.** This is the `Stage`-side
   half.

That is the whole goal. It is deliberately bounded. "Rendering
independence" does not mean a renderer-portability layer; it means the
SOM is complete enough and the app-side helper is shared enough that a
new app is *configuration*, not *copy-paste*.

---

## 4. The three-tier model (the spine)

Every camera/lighting/setup concern in Atrium belongs to exactly one of
three tiers. The same *conceptual* thing (e.g. "ambient light") can have
a representative in more than one tier simultaneously; the tiers are
distinguished by **ownership and authority**, not by subject matter.

### Tier A — World-metadata hints

- **What:** advisory configuration authored into the world, living in
  `extras.atrium` at the glTF root (the same home as `navigation` and
  `background`). E.g. "this world would like an ambient light at ~0.3"
  or "default framing is this camera."
- **Ownership:** the world author. Round-trips with the glTF. Is world
  state.
- **Authority:** advisory only. A hint is what the world prefers when
  nothing more specific overrides it. It is *not* a scene-graph object
  and is *not* binding.
- **Status in this session:** named and fenced. The precedence chain
  below references Tier A as a tier with defined authority, but the
  concrete `extras.atrium` hint schema is future work (§7). The model
  is complete; one tier's schema is deferred.

### Tier B — Scene-graph lights and cameras (`SOMLight`, `SOMCamera`)

- **What:** real glTF lights (`KHR_lights_punctual`) and glTF cameras
  that exist *in the scene graph* as first-class SOM objects.
- **Ownership:** the SOM. Mutable, broadcast on edit, late-joiner
  synced, inspectable.
- **Authority:** authoritative. If a world ships real scene-graph
  lights/cameras, those *are* the lighting/cameras; nothing injects
  defaults over them.
- **Status in this session:** fully designed. See §5.

### Tier C — App-side setup (`Stage`)

- **What:** the per-app machinery with no SOM analog: renderer
  instantiation, the frame loop, canvas/resize/devicePixelRatio
  handling, and the *fallback* default light + default camera that keep
  a bare `.gltf` viewable. Lives in `@atrium/renderer-three` as a new
  tenant alongside `PointerInputBridge` and `AnimationBridge`.
- **Ownership:** the app, via shared parameterized helper code. Not
  world state — the SOM Inspector wanting flat neutral lighting is a
  property of *the inspector*, not of any world it loads.
- **Authority:** lowest, for fallbacks (a fallback only applies when
  nothing above it does). **Separately**, Tier C also hosts explicit
  app-specific *overrides* (e.g. inspector forces flat lighting) —
  these are opt-in and deliberately *outside* the fallback chain so
  they cannot silently beat authored world state.
- **Status in this session:** designed at concept/responsibility level.
  See §5.4. No implementation.

### 4.1 The precedence resolution chain

This is the load-bearing rule. For lighting and for camera,
independently, the app resolves what to render as follows:

> **1. Tier B wins if present.** If the SOM contains ≥1 `SOMLight`
> (resp. ≥1 `SOMCamera`), the app uses the scene-graph objects and
> injects **no** fallback. World-author intent is authoritative.
>
> **2. Else Tier A applies.** If no scene-graph object exists but the
> world supplies a Tier A hint, the app honors the hint. *(Hint schema
> deferred — see §7. The chain slot is defined now so future Tier A
> work has a specified contract: "applies only when Tier B absent.")*
>
> **3. Else Tier C fallback.** With neither a scene-graph object nor a
> hint, the app injects its built-in default (a default light so the
> world is not pitch-black; a default camera so there is a viewpoint).
> A bare `.gltf` is always viewable.
>
> **Orthogonally: Tier C app-specific overrides** (inspector-flat-
> lighting and similar) are an explicit, opt-in path that an app
> chooses deliberately. They are **not** a step in this chain. An
> override that silently beat authored world lights would violate
> "world-author intent wins" and is therefore structurally excluded
> from the fallback resolution; an app that wants override behavior
> asks for it by name.

This chain — not "a list of helpers" — is what actually prevents the
copy-paste problem. It is the rule a future app author follows to know
where any given concern belongs.

### 4.2 Runtime tier transitions (multiplayer wrinkle — design question, recommended answer)

The chain above reads cleanly for a static load. Multiplayer breaks the
static assumption: because `SOMLight` is mutable networked state, a
world can *start* with no scene-graph lights (chain resolves to Tier
A/C) and then a peer **adds** a `SOMLight` at runtime via `som:add`.
Lighting is now mid-flight between tiers.

This is structurally the animation-arc reconciliation problem
(Principle 11: renderers reconcile to current state; they cannot assume
event ordering relative to their own initialization). It must be named
here, not discovered by Claude Code later.

**Recommended answer (for the implementation brief to ratify):** the
Tier C fallback is *suppressed whenever ≥1 `SOMLight` exists in the
SOM*, and this predicate is re-evaluated on `som:add` / `som:remove`,
exactly mirroring the `replayPlayingAnimations` reconcile discipline.
On the first real `SOMLight` arriving, the fallback default light is
torn down; on the last `SOMLight` being removed, the fallback is
re-injected. The renderer walks current SOM state when ready rather
than assuming the load-time resolution still holds. Same rule for
`SOMCamera` and the fallback camera. The implementation session should
treat this as the primary reconcile-correctness case, analogous to how
Session 30–31 treated animation replay.

---

## 5. SOM additions (Tier B) — full design

`SOMLight` and `SOMCamera` are designed in parallel structure: glTF
backing, SOM type surface, mutable properties, mutation/event behavior,
shared late-joiner sync note (§5.3), switchable-instance semantics.

### 5.1 `SOMLight`

**glTF backing.** `KHR_lights_punctual`. glTF-Transform supports the
extension. A `SOMLight` wraps a glTF-Transform light property. This is
the first Atrium SOM type backed by a glTF *extension* rather than core
glTF — note for the implementation brief: the SOM construction pass
(`SOMDocument` builds the graph bottom-up at construction, all wrappers
cached) must register `KHR_lights_punctual` lights into
`_objectsByName` like any other named object so `getObjectByName` /
protocol `set` routing works uniformly (Principle: single uniform
resolution path, Session 27).

**Type surface (new `SOMLight` row for the SOM Object Model table):**

| Class | Wraps | Key mutable properties |
|-------|-------|------------------------|
| `SOMLight` | glTF-Transform `Light` (`KHR_lights_punctual`) | `color`, `intensity`, `type` (`directional`/`point`/`spot`), `range`, `innerConeAngle`, `outerConeAngle`, `name`, `extras` |

- A light is attached to a node (glTF puts the light on a node;
  position/direction come from the node transform). `SOMLight` exposes
  its own intrinsic properties; spatial placement remains the host
  `SOMNode`'s `translation`/`rotation` — *do not duplicate transform
  state onto `SOMLight`*. This keeps one source of truth for spatial
  data and matches how `SOMCamera`/`SOMMesh` already relate to their
  host node.
- `color` is linear RGB `[r,g,b]`, consistent with glTF.
- Spot-only properties (`innerConeAngle`, `outerConeAngle`) are present
  but inert on non-spot types — mirrors how `SOMCamera` carries both
  perspective and orthographic fields (`yfov` vs `xmag`/`ymag`).

**Mutation / events.** Every setter fires a `mutation` event after
updating the underlying glTF-Transform object, allocating a `SOMEvent`
only if listeners are present — identical to every other SOM type. No
new event mechanism. A light-color edit becomes one `mutation` → one
`set` message → broadcast → reconcile, the established path. No compound
property is needed (lights have no equivalent of animation's atomic
playback-state transition); individual property setters are correct
here. *If* a future use case needs atomic multi-field light transitions,
that is a compound-property amendment, not a v2 (the "amendments, not
v2s" discipline) — out of scope now.

**Wire format.** Uniform with all other `set` messages:
`{ "type": "set", "node": "<lightName>", "field": "intensity", "value": 0.8, "seq": N }`,
resolved server- and client-side via `getObjectByName`. No protocol
schema *structure* change — but `@atrium/protocol`'s `set` value
validation must accept the new fields; flag for the implementation
brief as a protocol-package touch (Ajv schema addition, +tests).

**glTF storage / persistence.** Light state lives in the glTF Document
(the `KHR_lights_punctual` light definition + node reference). It
serializes with the Document and round-trips through `som-dump`
naturally, exactly as node/material state does.

### 5.2 `SOMCamera` completeness

`SOMCamera` already exists as a thin wrapper (`type`, `yfov`, `znear`,
`zfar`, `aspectRatio`, `xmag`, `ymag` — all read in the May-14 type
table). The gap is not "create the type"; it is **make it a first-class,
mutable, switchable scene-graph object** rather than a passive property
bag.

**Completeness gap analysis:**

1. **Mutability + events.** Confirm/ensure every property
   (`yfov`, `znear`, `zfar`, `xmag`, `ymag`, `type`, `aspectRatio`)
   has a setter that fires `mutation` like every other SOM type, so a
   peer editing fov broadcasts and reconciles. If the existing wrapper
   is read-mostly, this is the core of the work.
2. **Active-camera selection.** A world may author multiple cameras.
   "Which camera is active" is itself world state an app/peer may
   switch. **Recommended representation:** active-camera selection is a
   world-metadata concern (`extras.atrium`, e.g. an `activeCamera` name
   reference), *not* a boolean smeared across camera objects — one
   authoritative pointer, no multi-writer ambiguity. This is the one
   place `SOMCamera` design touches Tier A's territory; because Tier A
   schema is fenced (§7), this document **specifies the requirement and
   the recommended shape but defers the concrete field** to the Tier A
   session. The `SOMCamera` type design itself does not block on it.
3. **Switchable-instance semantics.** Switching active camera is a
   state change that must reconcile like everything else: the renderer,
   on the relevant mutation/`som:set`, rebinds which camera it renders
   from — it does not assume ordering (Principle 11). Same discipline
   as §4.2.

**Type surface:** unchanged columns from the existing table; the design
delta is "all properties mutable + mutation-firing" plus the
active-selection requirement (deferred field). No new wrapped glTF
concept — glTF cameras are core, not an extension (contrast `SOMLight`).

**Explicit boundary:** none of this is the NavigationController /
per-frame view-sync loop. A `SOMCamera` being mutable and switchable is
independent of what drives the *local user's* viewpoint each tick. That
loop is fenced (§7) and untouched. The navigation controller continues
to behave exactly as today.

### 5.3 Shared late-joiner sync note (both types) — flagged, not asserted

Both new types raise the same correctness question: when peer A mutates
a light/camera (or switches active camera), does a later-joining peer C
see the mutated state?

**Reasoning (design-recommended):** `som-dump` is "the full current
glTF (world state + all avatar nodes)" sent to a new client right after
`hello`. Lights and cameras authored in the world glTF live in the
Document and are **not** filtered out of `som-dump` — unlike external-ref
nodes, which are broken for late joiners *specifically because the
server filters external nodes from `som-dump`* (a known issue). Since
light/camera state is in the Document and unfiltered, a mutated value
should serialize into `som-dump` and reach C correctly. The external-ref
late-joiner gap does **not** apply here, by that filtering distinction.

**Posture: design-recommended, flag for implementation-time
verification** — *not* asserted as settled. This follows the project's
established hedge discipline (the Session 37 animation late-joiner
deferrals; the Working-Notes caution against rationalizing
reasoned-but-unverified conclusions into a green checkmark). The
implementation/QA session must verify `som-dump` serialization actually
carries a mutated `KHR_lights_punctual` value and a switched active-
camera selection to a fresh client, with a known-good baseline, before
this is checked off. Reasoned-correct, test-pending.

### 5.4 `Stage` (Tier C) — concept and responsibilities only

`Stage` is the new `@atrium/renderer-three` tenant that absorbs the
replicated per-app setup. It is **not** designed to implementation here;
this section fixes its concept, responsibilities, and boundaries so a
future brief can be drafted against a settled shape.

**Package shape.** Follows the established `renderer-three` pattern: one
stateful class + pure/plain helpers per concern (as
`PointerInputBridge` + `drag-math`/`hit-test`, and `AnimationBridge` +
`build-clips`/`document-view`/`load-background`). `Stage` is the
stateful class; any pure helpers (e.g. resize math) sit beside it.
Same package — not a new one.

**Responsibilities (the replicated machinery it owns):**

- Renderer instantiation (the WebGLRenderer + parameters), with
  per-app parameterization (the *what* an app passes in; the *how* is
  shared).
- The frame loop scaffold (rAF, dt, calling the existing
  `animBridge.update(dt)` etc. — Stage owns the loop, not the
  animation logic).
- Canvas wiring, resize, and devicePixelRatio handling.
- **Tier C fallback injection:** default light when the precedence
  chain (§4.1) resolves to Tier C; default camera likewise. Includes
  the §4.2 reconcile behavior (suppress/restore fallback as `SOMLight`/
  `SOMCamera` membership changes).
- **Opt-in app-specific override hook:** the explicit, named path by
  which an app (the Inspector) requests non-default setup (flat
  lighting). Structurally separate from the fallback chain.

**Boundaries:**

- Stage is renderer-coupled by definition — it is Tier C, it lives in
  `@atrium/renderer-three`, it touches Three.js. That is correct and
  not a Principle-12 violation: Principle 12 forbids `packages/client`
  importing a renderer, not `renderer-three` containing renderer code.
- Stage does **not** own scene-graph state. Lights/cameras that are
  real SOM objects are Tier B and flow through the SOM/DocumentView
  path; Stage only injects *fallbacks* and only when the chain says so.
- Stage does **not** subsume `AnimationBridge`, `PointerInputBridge`,
  or `initDocumentView`. It composes with them (it likely *constructs*
  them in a defined order, the way the current `apps/client`
  `world:loaded` flow does — Stage formalizes that ordering as shared
  code instead of three hand-copied flows).
- The three-consumer replication this targets is genuinely three:
  `apps/client`, `tools/som-inspector`, `apps/playground`.
  `tools/protocol-inspector` (no Three.js scene) and legacy
  `tests/client` (protocol scratch pad) do not instantiate a
  renderer/scene and are out of scope — stated here so a future
  session does not rediscover the question.

---

## 6. Background — adjacent, already resolved, not reopened

`extras.atrium.background` placement was settled April-era design
(Session ~21): the skybox is **world metadata, not a scene-graph
object** — an environment setting, deliberately *not* given a node or a
SOM type, decided over the explicit Option A/B/C debate. `loadBackground`
was already extracted into `@atrium/renderer-three` in Session 37.

This is noted only to fence it: **no `SOMBackground`/`SOMEnvironment`
type is proposed, the placement is not reopened, and "environment" is
not reused as a name** (it was explicitly renamed away from in April for
overloading — IBL vs scene settings vs runtime; the same reason it is
not the Tier C package name). Background is an already-handled adjacent
case; it does not need the three-tier treatment because its data is
Tier-A-like (resolved) and its application is already a shared helper.
Move on.

---

## 7. Fences (deliberate, named — not omissions)

Each item below is consciously excluded with a reason. Naming them is
the "unbundle, don't postpone" discipline: these are unbundled from
this design, reassessed later from facts, not contractually chained to
it.

- **Tier A `extras.atrium` hint schema.** The tier and its precedence
  authority are defined (§4); the concrete schema (field names, shape
  of a lighting hint, the `activeCamera` reference field §5.2 needs) is
  a future session. The model is complete without it; only one tier's
  serialization is deferred.
- **NavigationController refactor / per-frame nav-camera-sync loop.**
  The input→camera→`view` loop is untouched. `SOMCamera` mutability and
  switching are independent of it (§5.2). This is the harder, separate
  arc the May-14 doc flagged; it stays unbundled, reassessed from a
  concrete friction signal, not auto-chained.
- **Implementation brief.** A `SOMLight`/`SOMCamera`/`Stage`
  implementation brief is a separate future session, drafted *from*
  this document, with explicit non-goals / files-expected-to-change /
  implementation-order / acceptance-criteria per the briefs-that-worked
  pattern.
- **Bin 1 divergence audit artifact.** Considered and explicitly
  dropped this session by owner decision. The `Stage` responsibilities
  in §5.4 are inventoried from the handoff directly rather than via a
  formal consumer-divergence audit. (Recorded so the absence reads as a
  decision, not an oversight — the audit-before-extraction discipline
  is acknowledged and consciously traded for lower process weight here;
  the implementation brief author should still cross-check the three
  setup paths before extracting, even without a formal audit doc.)
- **Background.** §6.
- **Any code.** Design-only (Principle 1).

---

## 8. Open questions carried forward (with recommended answers)

These are the design questions this session surfaces but does not
finally settle. Each has a recommended answer for the implementation
brief / QA session to ratify or amend, in the project's
reasoned-but-flag-to-verify posture.

1. **Late-joiner sync for `SOMLight`/`SOMCamera`/active-camera (§5.3).**
   Recommended: works via unfiltered `som-dump`; the external-ref gap
   does not apply. *Flag: verify against actual `som-dump`
   serialization with a known-good baseline before checking off.*
2. **Runtime tier transition / fallback reconcile (§4.2).**
   Recommended: fallback suppressed whenever ≥1 Tier B object exists;
   predicate re-evaluated on `som:add`/`som:remove`; renderer walks
   current SOM state when ready (Principle 11), mirroring
   `replayPlayingAnimations`. *Primary reconcile-correctness case for
   the implementation session.*
3. **Active-camera representation (§5.2).** Recommended: a single
   authoritative name reference in world metadata (Tier A), not a
   per-camera boolean. *Concrete field deferred to the Tier A session;
   `SOMCamera` type work does not block on it.*
4. **`KHR_lights_punctual` namespace registration (§5.1).**
   Recommended: extension-backed lights register into `_objectsByName`
   identically to core objects so `getObjectByName` / protocol `set`
   routing stays a single uniform path (Session 27 principle). *Flag
   for the implementation brief as the first extension-backed SOM type
   — confirm glTF-Transform's extension API exposes a stable name and
   that the construction-time bottom-up graph build picks it up.*
5. **`@atrium/protocol` `set`-value validation (§5.1).** Adding light
   fields touches the Ajv schema + protocol tests even though message
   *structure* is unchanged. *Named so the brief scopes the protocol
   package as a touched package, not just SOM + renderer-three.*

---

## 9. Naming decisions (recorded)

- **Tier C helper concept: `Stage`.** Chosen over `BootstrapHelpers`
  (carries declined-Phase-2 baggage), "environment setup" (the
  poisoned word — overloaded IBL/scene/runtime, explicitly renamed away
  from in April), and "scene setup" (collides with `SOMScene` /
  `scene.background`; implies it sets up the scene graph, which it must
  not). `Stage` carries the lights/camera connotation natively, has
  zero codebase collision, reads correctly to a future app author
  ("put this SOM world on a Stage"), and pairs with the existing
  `*Bridge` tenant vocabulary in `@atrium/renderer-three`.
- **Tier names: A/B/C** are exposition-only labels for this document
  and the precedence chain; they are not proposed as identifiers in
  code.

---

## 10. Session 38 framing (suggested, not committed)

Per "lifecycle arcs take more sessions than briefs predict," do not
expect one implementation session to land all of `SOMLight` +
`SOMCamera` + `Stage`. Likely ordering, easy-and-safe first so a hard
question cannot block safe wins (the Session 37 sequencing lesson):

- **`SOMLight` first** — highest value (deletes replicated lighting
  setup *and* makes lighting networked state), self-contained, the
  cleaner of the two Tier B designs.
- **`SOMCamera` completeness** — second; smaller surface but entangled
  with the deferred active-camera field, so it benefits from `SOMLight`
  having established the mutable-extension-backed pattern first.
- **`Stage`** — likely its own session or paired with whichever Tier B
  type lands first as its initial real consumer, so the abstraction
  shape is validated against actual use rather than designed in the
  abstract (the three-call-sites lesson; Stage starts with the three
  known consumers).
- **The §4.2 reconcile behavior** rides with whichever session first
  makes a Tier B type mutable at runtime; treat it as that session's
  primary correctness case, not a follow-up.

Independent of the above, the **full-system QA pass** (the other live
thread, owning the Session 37 smoke deferrals) remains
unblocked by and independent of this design and can run in any order
relative to the implementation sessions.
