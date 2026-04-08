# Session 24 Design Brief — External References

## Goal

Implement `extras.atrium.source` resolution so that world `.gltf` files
can reference external glTF assets that are fetched, loaded, and composed
into the scene at runtime.

---

## Context

The design for external references was established in Session 21 and is
documented in the handoff. This brief covers the implementation plan for
Claude Code.

### Core rule

An external reference **must be a complete, valid glTF 2.0 file** — its
own `asset` block, scenes, nodes, meshes, materials, accessors, buffers,
everything. Any glTF viewer can open it independently. Atrium composes
standard files; it does not invent a fragment format.

### What was already decided (Session 21)

- A container node has no mesh and carries `extras.atrium.source`
- Relative paths resolve against the referencing `.gltf` file's URL
- Absolute URLs also supported
- AtriumClient resolves references — the server never loads external assets
- Path-prefix naming: children get `ContainerName/ChildName` names
- `getNodeByName` uses the full prefixed path
- Protocol messages carry the full prefixed name
- The external file's document-root `extras.atrium` is discarded — only
  its scene graph (nodes, meshes, materials, geometry) is consumed

---

## Implementation Plan

### 1. SOM layer — `SOMDocument.ingestExternalScene()`

**File:** `packages/som/src/SOMDocument.js`

Add a new method:

```javascript
ingestExternalScene(containerName, externalDocument)
```

**Behavior:**

- `externalDocument` is a glTF-Transform `Document` (the parsed external file)
- Walk the default scene of `externalDocument`
- For each root-level node in the external scene, recursively ingest
  into the world SOM as children of the container node named `containerName`
- **Path-prefix naming:** Every ingested node's SOM name becomes
  `containerName/originalName`. Nested nodes follow naturally:
  `containerName/Parent/Child`
- Meshes, materials, textures, and accessors from the external document
  must be merged into the world document. Use glTF-Transform's
  `document.merge(externalDocument)` to pull all resources in, then
  reparent the top-level nodes under the container
- After merge, register all new wrappers in the SOM caches
  (`_nodesByName`, etc.) with their prefixed names
- The external document's root `extras` (including `extras.atrium`) are
  **not** copied to the world document
- Fire `mutation` events (childList additions) on the container node
- Return an array of the newly created top-level `SOMNode` instances

**Important:** `document.merge()` brings in *all* resources from the
external document. The nodes need to be reparented under the container
and renamed with path prefixes. The merge operation handles buffer,
accessor, and material deduplication automatically.

**Tests** (add to `packages/som/tests/`):

- Ingest a minimal external document (one node + mesh) under a container
  — verify prefixed name, parent–child relationship, mesh/material present
- Ingest an external document with a multi-level hierarchy — verify all
  names are recursively prefixed
- Ingest two different external documents under different containers —
  verify no name collisions
- Verify container node's `extras.atrium.source` is preserved, external
  document's `extras.atrium` is discarded
- Verify mutation events fire for childList additions on the container
- Verify `getNodeByName` returns the prefixed nodes

### 2. Client layer — `AtriumClient.resolveExternalReferences()`

**File:** `packages/client/src/AtriumClient.js`

Add a new method:

```javascript
async resolveExternalReferences()
```

**Behavior:**

- Called internally after the SOM is built and after the base
  `world:loaded` has already fired
- Walk all nodes in the SOM looking for `extras.atrium.source`
- For each reference found:
  - Resolve the path relative to the world file's URL (same convention
    as glTF buffer/image URIs). Use `new URL(source, worldBaseUrl)`
  - Fetch the external file (`fetch()`)
  - Parse via glTF-Transform `io.readJSON()` (for `.gltf`) or
    `io.readBinary()` (for `.glb`), determined by file extension
  - Call `this.som.ingestExternalScene(containerName, externalDocument)`
  - Emit `world:loaded` with additional fields (see below)
- References are resolved in parallel (`Promise.all`) — order doesn't
  matter since each targets a different container node
- Errors on individual references are caught and logged (warning), not
  fatal — a missing chair model shouldn't prevent the world from loading

**Event design — single event, two shapes:**

`world:loaded` fires once for the base world (unchanged from today),
then once per successfully resolved external reference:

```javascript
// Base world — fires immediately after SOM init (same as today)
client.on('world:loaded', ({ name, description, author }) => { ... })

// External reference — same event, additional fields present
client.on('world:loaded', ({ name, description, author, source, containerName }) => { ... })
```

When `source` and `containerName` are present, it's an external
reference. When absent, it's the base world. This follows the same
pattern as `som:set` using `nodeName: '__document__'` to distinguish
document-level mutations from node mutations.

Listeners that don't care about the distinction (e.g. the HUD) just
ignore the extra fields. Listeners that need to react to new content
(e.g. DocumentView, the SOM Inspector tree) check for `source`.

The base world is usable immediately — avatar placement, navigation,
and UI all proceed without waiting. External references are progressive
enrichment.

**Tests** (add to `packages/client/tests/`):

- Mock fetch to return a valid external glTF — verify `world:loaded`
  fires twice: once for base world (no `source`), once for the
  reference (with `source` and `containerName`)
- Mock fetch to return 404 — verify base `world:loaded` fires, no
  reference `world:loaded`, warning logged, rest of scene intact
- World with two external references — verify three `world:loaded`
  events total (base + two references), both prefixed correctly
- Verify base `world:loaded` fires before any reference `world:loaded`

### 3. Multiplayer considerations

**No protocol changes needed.** External references are client-side only.
Every client independently resolves the same `source` fields from the
shared world file.

If a client mutates a node inside an externally-loaded model (e.g. via
the SOM Inspector), the `set` message carries the full prefixed name.
Other clients find the same node because they all loaded the same
external reference. This is a timing dependency — if a `set` arrives
before a client has finished resolving references, the target node won't
exist yet. **For now, accept this as a known limitation.** Log a warning
when a `set` targets an unknown node name.

### 4. Server considerations

**No server changes.** The server never loads external assets. It stores
and broadcasts `set` messages with whatever node names clients send,
including prefixed names. The `som-dump` for late joiners will only
contain the world skeleton (container nodes without children) plus
avatar nodes — each late joiner resolves external references
independently after receiving the dump.

**Important implication:** If Client A mutates a node inside an external
reference and Client B joins later, Client B's `som-dump` will not
include that mutation because the externally-loaded nodes aren't in the
server's SOM. This is acceptable for now — external reference content is
treated as deterministic (every client loads the same file and gets the
same result). Persistence of mutations to external content is a future
concern.

### 5. Test fixtures

**New file:** `tests/fixtures/generate-space-ext.js`

Generates four files:

| File | Contents |
|------|----------|
| `tests/fixtures/space-ext.gltf` | World with floor geometry inline + two container nodes (`Crate` with `extras.atrium.source: "./crate.gltf"`, `Light` with `extras.atrium.source: "./lamp.gltf"`). Same world metadata as `space.gltf`. |
| `tests/fixtures/crate.gltf` | Complete self-contained glTF with just the crate (box mesh + green material). Single node named `Crate`. |
| `tests/fixtures/lamp.gltf` | Complete self-contained glTF with just the lamp (geometry + emissive material). Single node named `Lamp`. |
| `tests/fixtures/space-ext.atrium.json` | `{ "version": "0.1.0", "world": { "gltf": "./space-ext.gltf", "server": "ws://localhost:3000" } }` |

**Generator approach:**

- Factor the crate and lamp geometry builders out of `generate-space.js`
  into importable helper functions (or duplicate them — `generate-space.js`
  must remain untouched and working)
- `generate-space-ext.js` calls these builders independently to produce
  standalone files, then builds the world file with only the floor +
  container nodes
- Run: `node tests/fixtures/generate-space-ext.js`
- Verify: each of the three `.gltf` files opens independently in any
  glTF viewer

**Expected SOM after loading `space-ext.gltf` with references resolved:**

```
Scene
├── Floor          (inline — world geometry)
├── Crate          (container node, extras.atrium.source = "./crate.gltf")
│   └── Crate/Crate   (ingested from crate.gltf)
└── Light          (container node, extras.atrium.source = "./lamp.gltf")
    └── Light/Lamp     (ingested from lamp.gltf)
```

### 6. SOM Inspector display updates

**File:** `tools/som-inspector/src/TreeView.js`

- When rendering a node name that contains `/`, display only the last
  segment (e.g. `Crate` not `Crate/Crate`, `Lamp` not `Light/Lamp`)
- The hierarchy already provides context for the container relationship

**File:** `tools/som-inspector/src/PropertySheet.js`

- When displaying the selected node title, show the full prefixed path
  for unambiguous identification (e.g. `Light/Lamp`)

No other inspector changes needed — property editing, tree expand/collapse,
and ephemeral indicators all work on SOM nodes regardless of how they
were ingested.

---

## Scope — What Is NOT in This Session

- Dedicated error event for failed references (failures are logged only)
- Server-side awareness of external references
- Persistence of mutations to externally-referenced content
- Nested external references (a referenced file containing its own
  `extras.atrium.source` nodes) — single level only for now
- User Object Extensions (`ATRIUM_user_object`) — separate design
- `apps/client` visual changes (DocumentView handles new nodes
  automatically via existing SOM → Three.js sync)

---

## Build Order

1. **Test fixtures first.** `generate-space-ext.js` → produce all four
   files. Verify each `.gltf` opens standalone.
2. **SOM layer.** `ingestExternalScene()` + tests. All tests pass before
   moving on.
3. **Client layer.** `resolveExternalReferences()` + tests. Verify
   `world:loaded` timing.
4. **Inspector display.** TreeView short names + PropertySheet full paths.
5. **Manual integration test.** Start server with `space-ext.gltf`, open
   `apps/client` and SOM Inspector, confirm external references load and
   render. Open a second client to confirm multiplayer still works (peers
   see the same composed scene).
6. **Sync test client SOM copy:**
   ```bash
   cp packages/som/src/*.js tests/client/som/
   ```

---

## Design Principles Check

| Principle | Satisfied |
|-----------|-----------|
| Design before code | ✅ This brief |
| No throwaway code | ✅ All changes are to the real packages |
| Incremental correctness | ✅ Build order: fixtures → SOM → client → inspector |
| glTF on the wire | ✅ External files are standard glTF |
| Server is policy-free on geometry | ✅ Server doesn't know about external refs |
| AtriumClient is geometry-agnostic | ✅ Delegates to SOM for ingestion |
| SOM is the source of truth | ✅ All external content ingested into SOM |
| Static first, multiplayer second | ✅ References resolve without a server |
| glTF is world state | ✅ External files are complete glTF documents |
