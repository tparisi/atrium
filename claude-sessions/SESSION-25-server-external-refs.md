# Session 25 Design Brief — Server-Side External Reference Resolution

## Problem

External references (Session 24) are resolved client-side only. The
server's SOM contains only the base world file — it has no knowledge of
nodes created by `ingestExternalScene`. This causes three failures:

1. **Cross-client editing broken.** Editing a property on an
   externally-loaded node (e.g. `Crate/Crate`) sends a `set` message
   with the prefixed name. The server cannot find it, returns
   `NODE_NOT_FOUND`, and never broadcasts the mutation.

2. **`som-dump` incomplete.** Late joiners receive a dump missing all
   externally-loaded nodes, so any mutations applied to external content
   by earlier clients are lost.

3. **Server validation impossible.** The server cannot distinguish a
   legitimate `set` targeting `Crate/Crate` from a malformed message
   targeting a nonexistent node.

Console evidence from `apps/client`:
```
[app] client error: Error: NODE_NOT_FOUND: NODE_NOT_FOUND: Crate/Crate
    at dispatch (AtriumClient.js:173:30)
```

## Design

### Core change

The server resolves external references into its own SOM at startup,
using the same `ingestExternalScene` codepath the clients use. This
gives the server the full node graph — container nodes and their
externally-loaded children — so it can validate `set` messages and
maintain authoritative state for all nodes.

### `som-dump` filtering

The server **does not** include externally-loaded child nodes in
`som-dump`. It includes only the authored world content — which includes
the container nodes with their `extras.atrium.source` fields.

Every client — early joiner and late joiner — always resolves external
references locally. This keeps client behavior uniform: load world →
resolve external references. No conditional "skip if already populated"
logic.

**Filter rule:** The server tracks which nodes were created by
`ingestExternalScene` (a `Set` of node names, or a flag on the nodes).
When serializing for `som-dump`, these nodes are excluded.

### Late-joiner mutation gap (accepted)

If Client A edits `Crate/Crate`'s material color and Client B joins
later, Client B resolves the external reference locally and gets the
original color, not Client A's edit. The server *has* the mutated state
in its SOM but doesn't serialize it into `som-dump` (because external
nodes are filtered out).

This is the same gap noted in the Session 24 handoff doc. Closing it
properly requires either:
- Replaying mutation history for external nodes after the client
  resolves them
- Including external nodes in `som-dump` with dedup logic on the client

Both are deferred. The immediate goal is to fix cross-client editing
(the `NODE_NOT_FOUND` error) and keep the architecture sound.

### No `add` broadcasts for server-side ingestion

The server resolves external references at startup before any clients
connect — or at minimum, suppresses `add` broadcasts during ingestion
(same `_applyingRemote`-style guard the client uses). Clients must not
receive `add` messages for externally-loaded nodes, because they will
create those nodes themselves via local resolution.

### Server fetch capability

The server is Node.js. Modern Node (18+) has global `fetch`. The server
needs a base URL derived from `WORLD_PATH` to resolve relative paths in
`extras.atrium.source`.

**`_worldBaseUrl` derivation:**
```javascript
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const absPath = resolve(process.env.WORLD_PATH);
const worldBaseUrl = pathToFileURL(absPath).href;
// e.g. "file:///home/user/atrium/tests/fixtures/space-ext.gltf"
```

Relative source paths then resolve via `new URL(source, worldBaseUrl)`.

For `file://` URLs, `fetch` in Node 18+ supports `file://` protocol
natively (via undici). If this proves problematic, fall back to
`fs.readFile` for `file://` URLs and `fetch` for `http(s)://` URLs.

### Error handling

Match client behavior: per-reference errors are caught and warned, not
fatal. If `models/chair.glb` fails to load, the server logs a warning
and continues. The container node remains in the SOM without children.

### Resolution timing

External references are resolved **after** the server loads the world
file and builds the SOM, but **before** the server begins accepting
WebSocket connections (or at minimum, before the first `som-dump` is
sent). This ensures the SOM is complete before any client interacts
with it.

If resolution is async (fetch over network), server startup should
await all resolutions before opening the WebSocket listener.

---

## Implementation Plan

### 1. Server: resolve external references at startup

**File:** `packages/server/src/index.js` (or wherever the server
initializes the world SOM)

- After loading the world `.gltf` and constructing the `SOMDocument`,
  walk all nodes for `extras.atrium.source`
- Derive `_worldBaseUrl` from `WORLD_PATH` using `pathToFileURL`
- For each source node, resolve the URL, fetch the file, parse it as
  glTF (using glTF-Transform `io.readJSON` or `io.readBinary`), and
  call `som.ingestExternalScene(containerName, externalDocument)`
- Track ingested node names in a `Set` (e.g. `this._externalNodeNames`)
- Wrap in try/catch per reference — warn and continue on failure
- Await all resolutions before opening the WebSocket listener

**`file://` fetch strategy:** Use `node:fs` for local files
(`file://` URLs or paths), `fetch` for remote URLs. This avoids
Node version-dependent `file://` fetch support.

### 2. Server: filter `som-dump` to exclude external nodes

**File:** `packages/server/src/` (wherever `som-dump` is serialized)

- When building the `som-dump` payload, skip any node whose name is in
  `_externalNodeNames`
- Container nodes (the ones with `extras.atrium.source`) are **included**
  — they're part of the authored world
- Only the children created by `ingestExternalScene` (prefixed names)
  are excluded

### 3. Server: suppress `add` broadcasts during ingestion

- Use the same pattern as the client's `_applyingRemote` guard
- During `ingestExternalScene`, the server must not broadcast `add`
  messages for newly created nodes
- After ingestion completes, normal broadcast behavior resumes

### 4. SOM Inspector: display `extras.atrium.source` in PropertySheet

**File:** `tools/som-inspector/src/PropertySheet.js`

When the selected node has `extras.atrium.source`, display a new
section in the property sheet:

**Section: "External Reference"**
- **Source** — read-only text field showing the `extras.atrium.source`
  URL value

This is read-only for now. Future collaborative authoring (entering a
new URL into the source field to trigger resolution) is a separate
design that needs its own protocol consideration — it implies a runtime
`add` flow plus re-resolution across all clients.

Position this section after the Node section and before the Material
section, since it describes the node's content origin.

---

## Test Plan

### Server tests (`packages/server`)

- **Server resolves external references at startup** — start a server
  with `space-ext.gltf` (which references `crate.gltf` and
  `lamp.gltf`). Verify the server's SOM contains nodes with prefixed
  names (`Crate/Crate`, `Lamp/Lamp`, etc.)

- **`som-dump` excludes external nodes** — connect a client, receive
  `som-dump`. Verify it contains the container nodes (`Crate`, `Lamp`)
  but not their externally-loaded children (`Crate/Crate`,
  `Lamp/Lamp`, etc.)

- **`set` on external node succeeds** — connect a client, send a `set`
  message targeting `Crate/Crate` with a valid property path. Verify
  the server accepts it (no `NODE_NOT_FOUND` error) and broadcasts it
  to other connected clients.

- **Cross-client editing works end-to-end** — connect two clients.
  Client A sends `set` for `Crate/Crate`'s material color. Verify
  Client B receives the broadcast `set`.

- **Failed external reference is non-fatal** — start a server with a
  world file referencing a nonexistent URL. Verify the server starts
  successfully, logs a warning, and the container node exists in the
  SOM without children.

- **Container node mutations still work** — send a `set` targeting the
  container node itself (e.g. `Crate` translation). Verify it validates
  and broadcasts normally.

### SOM Inspector (manual verification)

- Load `space-ext.gltf`, select a container node (`Crate`). Verify
  the "External Reference" section appears with the source URL.
- Select a non-reference node. Verify no "External Reference" section.
- Select an externally-loaded child node (`Crate/Crate`). Verify no
  "External Reference" section (only the container has the source
  field).

---

## Design Principles Check

| Principle | Status |
|---|---|
| #1 Design before code | This document |
| #5 Server is policy-free on geometry | ✅ Server ingests glTF nodes into SOM — same as it does for the base world. Never constructs or interprets mesh geometry. |
| #7 SOM is the source of truth | ✅ Server SOM now contains full node graph. Mutations validate and broadcast correctly. |
| #8 Static first, multiplayer second | ✅ Client-side resolution unchanged. Works without server. |
| #9 glTF is world state | ✅ External references are standard glTF composed into the document. |

---

## Design Rationale: Client-Side vs Server-Authoritative Resolution

We considered an alternative where the server is the sole resolver of
external references and distributes the full scene graph (including
externally-loaded children) via `som-dump`. Clients connecting via
`som-dump` would not resolve external references at all — they'd
receive the complete node graph from the server.

**Advantages of server-authoritative distribution:**
- Single point of resolution — every client guaranteed the same scene
  graph
- No risk of one client failing to fetch an asset (CORS, proxy,
  transient network error) and ending up with a different graph than
  peers

**Disadvantages:**
- **`som-dump` size** — external models with detailed geometry could
  add megabytes of serialized glTF to the `som-dump` payload. Every
  late joiner pays this cost over the WebSocket before rendering.
  Client-side resolution allows parallel CDN fetches closer to the
  user.
- **Server outbound coupling** — the server needs outbound HTTP access
  to arbitrary asset domains. Acceptable for local dev, potentially
  problematic in production deployments.
- **Duplicated codepath regardless** — clients still need external
  reference resolution for static browsing (principle #8). The
  server-authoritative approach adds a second codepath (suppress
  resolution on `som-dump` connect) without removing the first.

**Decision:** Keep client-side resolution. The server resolves
external references into its own SOM for validation and mutation state,
but does not distribute them. Every client resolves independently.
The reliability edge cases (one client failing to fetch) are real but
affect static browsing equally today and are better addressed by a
future reconciliation mechanism (see below).

---

## Future: External Reference Reconciliation Check

After a client resolves external references locally, it may have a
different set of nodes than the server expects — due to fetch failures,
CORS issues, or transient network errors. A lightweight reconciliation
step could detect and surface this:

- The server includes a list of expected external node prefixes (e.g.
  `["Crate", "Lamp"]`) in `hello` or `som-dump` metadata
- After local resolution, the client compares its resolved prefixes
  against the expected set
- Mismatches trigger a warning (console + optional UI indicator) and
  potentially a retry

This is not required for Session 25 — the immediate fix is
cross-client editing. Reconciliation is a hardening step for
production reliability.

---

## Out of Scope

- **Late-joiner mutation replay** — deferred, noted as accepted gap
- **Collaborative source field editing** — future feature; needs its
  own protocol design (runtime `add` + re-resolution)
- **Nested external references** — already deferred in backlog
- **External reference reconciliation** — future hardening; see
  rationale section above
- **`file://` fetch in browser clients** — not relevant; clients
  resolve via HTTP, server resolves via filesystem
- **World base URL in `hello`/`som-dump`** — separate backlog item,
  not required for this change (clients already have `_worldBaseUrl`
  from their own `loadWorld` call)
