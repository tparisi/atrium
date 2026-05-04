# Canonical doc updates for Session 35

These are the changes to apply to `Project_Atrium_2026-05-03.md` after
Session 35 lands. Apply them as the final step of the session, after
all code and tests are green.

The changes fall in five places: repo structure, test counts, status
table, design principles, and backlog.

---

## 1. Repo structure — add `packages/interaction/`

In the **Repository Structure** section, add `packages/interaction/`
to the package list. The intended final ordering is alphabetical
within `packages/`, with the existing comment style preserved.

**Replace:**

```
├── packages/
│   ├── protocol/        # SOP message schemas (JSON Schema) + Ajv validator
│   ├── som/             # Scene Object Model — DOM-inspired API over glTF-Transform
│   ├── server/          # WebSocket world server
│   ├── client/          # AtriumClient, AvatarController, NavigationController,
│   │                    #   AnimationController, pointer dispatch + capture
│   ├── renderer-three/  # Three.js-specific glue (Session 34)
│   │                    #   PointerInputBridge, drag-math, hit-test
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
```

**With:**

```
├── packages/
│   ├── protocol/        # SOP message schemas (JSON Schema) + Ajv validator
│   ├── som/             # Scene Object Model — DOM-inspired API over glTF-Transform
│   ├── server/          # WebSocket world server
│   ├── client/          # AtriumClient, AvatarController, NavigationController,
│   │                    #   AnimationController, pointer dispatch + capture
│   ├── interaction/     # User interaction policy (Session 35)
│   │                    #   selection model; future: drag UX, gestures, multi-select
│   ├── renderer-three/  # Three.js-specific glue (Session 34)
│   │                    #   PointerInputBridge, drag-math, hit-test
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
```

---

## 2. Test counts — add `@atrium/interaction` row

In the **Test Counts (after Session 34)** section, retitle and add the
new package row. Use the actual final test count from the build log
(brief targets 9+).

**Replace the heading:**

```
## Test Counts (after Session 34)
```

**With:**

```
## Test Counts (after Session 35)
```

**Replace the table:**

```
| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 46 |
| `@atrium/som` | 109 |
| `@atrium/server` | 32 (per April 17; **needs re-verification**) |
| `@atrium/client` | 96 |
| `@atrium/renderer-three` | 19 |
| **Total** | **302** |
```

**With** (filling in `<N>` and `<TOTAL>` from the actual session results):

```
| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 46 |
| `@atrium/som` | 109 |
| `@atrium/server` | 32 (per April 17; **needs re-verification**) |
| `@atrium/client` | 96 |
| `@atrium/renderer-three` | 19 |
| `@atrium/interaction` | <N> |
| **Total** | **<TOTAL>** |
```

The `needs re-verification` note for server stays — Session 35 doesn't
touch the server.

---

## 3. Status table — three new rows

In the **What's Been Built (Status)** section, add three rows for the
Session 35 work. Group them with the existing pointer-event /
renderer-three rows for narrative coherence; place after the existing
`packages/renderer-three/` row (which is currently the bold row near
the bottom of that section).

**Add these three rows after the existing `packages/renderer-three/`
bold row:**

```
| **`@atrium/interaction` package launch** | **✅ Complete (Session 35)** |
| **`@atrium/interaction` — selection model (`nearestNonMeshAncestor`, `leafOnly`, `resolveSelectionRoot`)** | **✅ Complete (Session 35)** |
| **SOM Inspector + playground — selection-root resolution (Pattern C: heuristic + Alt-descend)** | **✅ Complete (Session 35)** |
```

The bold formatting on these rows matches the convention used for
Sessions 32–34 additions; once Session 36 lands, these can be
de-bolded as part of that session's canonical-doc update.

---

## 4. Design Principles — add Principle 13

In the **Key Design Principles (never violate these)** section, append
the new principle after Principle 12. The numbered list is currently
1–12; this becomes 1–13.

**Add after the Principle 12 entry:**

```
13. **User interaction policy lives in `@atrium/interaction`.**
    AtriumClient, SOM, and renderer packages do not encode interaction
    conventions; they expose mechanism that interaction policies
    compose over. Apps consume `@atrium/interaction` directly, not via
    AtriumClient. (Session 35.)
```

The phrasing matches the brief verbatim; the parenthetical session
attribution matches the convention of Principles 11 and 12.

---

## 5. Backlog — close items, add followups

In the **Backlog (Prioritized)** section, two changes.

### 5a. Close the selection-model item

The "Highest impact" section currently has a single bubbling-focused
item. Selection model wasn't called out separately because we hadn't
yet realized it was distinct from bubbling. After Session 35, the
bubbling item should be re-scoped to reflect that selection is
handled, and bubbling is now the genuine remaining work.

**Replace the existing "Highest impact" entry:**

```
### Highest impact

- **Pointer event bubbling — DESIGN + IMPLEMENT.** First concrete need
  surfaced (lamp parent). Open design questions:
  `pointerover`/`pointerout` bubbling semantics, `target` vs
  `currentTarget` shape, propagation order, whether to inherit DOM's
  capture-phase (recommend: not), how `localPoint`/`localNormal` behave
  for ancestors. Recommended split: design-only session, then
  implementation session. Bubbling is also a probable prerequisite for
  `ATRIUM_interactivity`.
```

**With:**

```
### Highest impact

- **Pointer event bubbling — DESIGN + IMPLEMENT.** The lamp-style
  compound-object UX is now handled at the selection layer (Session
  35), so bubbling is no longer needed for that case. Bubbling remains
  the right answer for genuine event-handler hierarchy — e.g., a
  parent node that wants to react to clicks on any descendant
  (highlight, sound, broadcast). Open design questions:
  `pointerover`/`pointerout` bubbling semantics, `target` vs
  `currentTarget` shape, propagation order, whether to inherit DOM's
  capture-phase (recommend: not), how `localPoint`/`localNormal` behave
  for ancestors. Recommended split: design-only session, then
  implementation session. Bubbling is also a probable prerequisite for
  `ATRIUM_interactivity`.
```

### 5b. Drag UX as the next interaction-package tenant

The existing "Drag UX" section is fine in content but should be
updated to reflect that it's now the natural next tenant of
`@atrium/interaction`.

**Replace the heading and lead-in of the "Drag UX" section:**

```
### Drag UX

- **Camera-relative drag.** Current world-space drag feels wrong when
  camera is rotated. Capture camera right/forward at mousedown,
  transform screen-space cursor delta → world axes.
```

**With:**

```
### Drag UX (next `@atrium/interaction` tenant candidate)

- **Camera-relative drag.** Current world-space drag feels wrong when
  camera is rotated. Capture camera right/forward at mousedown,
  transform screen-space cursor delta → world axes. Renderer-neutral
  portion of drag math is a candidate for migration from
  `@atrium/renderer-three` into `@atrium/interaction` during this
  work.
```

The remaining drag UX bullets (axis-locked, visual feedback,
rotation/scale gestures, two-step UX) stay as-is.

---

## 6. Suggested Session 36 framings — replace existing Session 35 section

The current **Suggested Session 35 framings** section is now stale
(Session 35 happened). Replace the whole section with Session 36
framings.

**Replace:**

```
## Suggested Session 35 framings

A few options for what Session 35 could actually be:

- **"Bubbling design" (small).** ...
- **"Pointer events polish" (small-medium).** ...
- **"Drag UX polish" (medium).** ...
- **"Hit-test invisibility investigation" (small).** ...
- **"Bubbling design + implementation" (medium-large).** ...

Bubbling is the highest-impact item but also the riskiest if rushed. A
polish session before bubbling would land small wins and surface
anything else that's been bothering us. Either order is defensible.
```

**With:**

```
## Suggested Session 36 framings

Now that the lamp UX is solved at the selection layer, the urgency
profile of the remaining backlog has shifted. Bubbling is no longer
chasing a concrete UX gap — it's chasing a real but more abstract
need (parent handlers for hierarchical reactions, prerequisite for
`ATRIUM_interactivity`).

A few options for Session 36:

- **"Drag UX polish" (medium).** Camera-relative drag, axis-locked
  drag, visual selection feedback. Natural next `@atrium/interaction`
  tenant; extends the package along its coherence criterion. Closes
  out drag rough edges. *Recommended — high user-visible payoff,
  validates the package's growth path.*
- **"Pointer events polish" (small-medium).** Property sheet
  reactivity during drag, fixture paths, debug flag for diagnostic
  handlers, click-to-deselect. Solid cleanup. *Recommended if drag
  UX feels too ambitious for one session.*
- **"Bubbling design" (small).** Just the design brief, no code.
  Settle the open questions, hand off the brief to a Session 37
  implementation. *Recommended once a concrete bubbling use case
  surfaces — currently the use case is `ATRIUM_interactivity`, which
  is itself unstarted.*
- **"Hit-test invisibility investigation" (small).** Run the
  diagnostic from the May 2 backlog, decide on fix shape, implement.
  Could pair with polish. *Low effort, decent payoff for hygiene.*

Drag UX is the strongest candidate — it has direct user-visible
payoff, it validates `@atrium/interaction`'s growth, and it's properly
scoped after a small breather session like Session 35.
```

---

## Final-step verification

Before considering Session 35 complete:

- [ ] All five sections of `Project_Atrium_2026-05-03.md` updated
  per the above
- [ ] Test counts reflect actual session results, not brief targets
- [ ] Status table rows correctly bolded for the Session 35 additions
- [ ] Principle 13 numbering and parenthetical attribution match
  Principles 11 and 12 in style
- [ ] Backlog Session 35 framings replaced with Session 36 framings
- [ ] Repo structure shows `packages/interaction/` with the inline
  comment matching the established style

If the build log surfaces unexpected divergences from the brief
(e.g., test count is much higher or lower than 9+, or the package
ended up structured differently), pause and confirm with chat before
applying canonical-doc updates — the doc is the durable record and
should reflect what actually happened, not what was planned.
