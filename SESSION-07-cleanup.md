# Atrium — Claude Code Session 7
## Cleanup: World Manifest, Load Sequence, Walk Default

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
This is a pnpm monorepo. The following has already been built and tested:

**`packages/protocol`** — SOP message schemas and Ajv validator
- 14 message types including `view` (client + server schemas)
- 33+ passing tests

**`packages/server`** — SOP server with session lifecycle, world state, presence
- Handles hello/ping/tick/send/set/add/remove/join/leave/view
- Presence registry stores latest client position for bootstrap
- 26+ passing tests

**`tools/protocol-inspector/index.html`** — single-file protocol debugger
- Type dropdown: hello, ping, send, add, remove, view (6 client-sendable types)

**`tests/fixtures/space.gltf`** — world fixture with real geometry
- ground-plane, crate-01, lamp-01 (lamp-stand + lamp-shade)
- `extras.atrium` world metadata including server connection info (to be removed)

**`tests/client/index.html`** — single-file world client
- Walk camera (WASD + mouse drag) and Orbit camera modes
- Avatar capsule rendering for peers
- `view` message broadcasting in Walk mode
- Currently: waits for server `hello` before loading `space.gltf` — backwards
- Currently: defaults to Orbit camera mode — should default to Walk

All packages use ES modules. No TypeScript. No build step. Node.js v20.
Test runner: `node --test`.

---

## Goal

Three focused cleanups this session:

1. **Introduce `atrium.json` world manifest** — the sidecar file that is the
   entry point for a fully configured Atrium world. Contains the glTF URL and
   server URL. Separates deployment configuration from content.

2. **Fix the load sequence** — the client should load the glTF immediately on
   page load, not wait for the server handshake. The server connection happens
   in the background. Static first, multiplayer second.

3. **Default to Walk camera** — Walk mode is the primary experience now that
   avatar embodiment is working. Orbit is the secondary inspection tool.

**Definition of done:** Open the test client, scene renders immediately without
clicking Connect. Click Connect — server connects in the background, peers
appear as capsules. Default camera is Walk.

---

## Coding Conventions

Same as all previous sessions:
- ES modules throughout, SPDX license header in every `.js` file
- No TypeScript, no build step
- Single-file HTML — all JS and CSS inline

---

## Design Notes

### The `atrium.json` world manifest

`atrium.json` is the entry point for a fully deployed Atrium world. It is a
sidecar file that lives alongside (or points to) the world's glTF file.

**Separation of concerns:**
- The glTF file is **content** — geometry, materials, scene graph, world
  metadata that is intrinsic to the content (covered below)
- `atrium.json` is **deployment configuration** — where to find the content,
  where the server is, and any other infrastructure-level settings

Server connection info does NOT belong in the glTF. A glTF file is a portable
content artifact. Embedding a server URL in it couples content to deployment
topology — every time your server address changes you'd have to edit your
content file. That's the wrong separation.

**`extras.atrium` in the glTF is NOT going away.** It is the right place for
world metadata that is intrinsic to the content — things like `maxUsers`,
`navigation`, `capabilities`. These are content-level rules about the world
itself, not deployment configuration. The server URL is the one thing being
moved out. The rest of `extras.atrium` stays exactly as it is.

**Minimal `atrium.json` schema for v0.1:**
```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./space.gltf",
    "server": "ws://localhost:3000"
  }
}
```

- `version` — manifest format version
- `world.gltf` — URL or relative path to the world glTF file
- `world.server` — WebSocket server URL (optional — omit for static-only worlds)

Both `world.gltf` and `world.server` are optional individually, but at least
one should be present. A manifest with neither is valid but useless.

### The Atrium browser load sequence

The correct load sequence for the Atrium browser model:

1. User navigates to a URL
2. Client looks for `atrium.json` at that URL
3. **If `atrium.json` found:** read `world.gltf` for the content URL and
   `world.server` for the WebSocket URL
4. **If `atrium.json` not found:** look for `space.gltf` at the same base URL
5. **Immediately fetch and render the glTF** — no server connection required
6. **In the background:** if a server URL is known (from manifest or from the
   UI field), connect to the WebSocket server
7. When server `hello` completes, sync world state on top of the already-
   rendered scene

The glTF renders whether or not a server is reachable. The server connection
is layered on top. This is the "browser model" principle — static first,
multiplayer second.

For the test client specifically, the manifest lookup and glTF load happen
on page load — before the user clicks Connect. The Connect button initiates
(or re-initiates) the WebSocket connection only.

---

## Part 1 — `tests/fixtures/space.atrium.json`

Create this file alongside `space.gltf`:

```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./space.gltf",
    "server": "ws://localhost:3000"
  }
}
```

---

## Part 2 — `tests/fixtures/space.gltf` — remove server URL

Remove the server connection URL from `extras.atrium` if it is present.
The `extras.atrium` world metadata (name, maxUsers, navigation, capabilities,
etc.) must be preserved exactly. Only server connection info is removed.

Check the current fixture — if `extras.atrium.world` contains a `server` or
`url` field, remove it. If it doesn't have one, no change needed.

---

## Part 3 — `tests/client/index.html` — load sequence + manifest

### Manifest loading

Add a constant at the top of the script:

```javascript
const MANIFEST_PATH = '../fixtures/space.atrium.json'
const FALLBACK_GLTF_PATH = '../fixtures/space.gltf'
```

On page load, attempt to fetch the manifest:

```javascript
async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_PATH)
    if (res.ok) return await res.json()
  } catch {}
  return null
}
```

If the manifest is found, use `manifest.world.gltf` as the glTF path and
`manifest.world.server` as the default WebSocket URL (pre-fill the server
URL field in the UI). If the manifest is not found, fall back to
`FALLBACK_GLTF_PATH`.

### Load sequence fix

On page load (not on Connect):

```javascript
async function init() {
  const manifest = await loadManifest()
  const gltfPath = manifest?.world?.gltf ?? FALLBACK_GLTF_PATH
  const serverUrl = manifest?.world?.server ?? 'ws://localhost:3000'

  // Pre-fill server URL field from manifest
  serverUrlInput.value = serverUrl

  // Load and render the glTF immediately — no server needed
  await loadScene(gltfPath)
}
```

`loadScene()` is the existing glTF load + DocumentView setup. It should be
callable independently of the WebSocket connection. Move it out of
`onServerHello()` if it is currently called there.

The Connect button now only manages the WebSocket connection. It does NOT
trigger scene loading. If the scene is already loaded when Connect is clicked,
connecting to the server simply layers multiplayer on top.

### Scene reload on reconnect

If the user disconnects and reconnects, do not reload the glTF — reuse the
existing Document and DocumentView. Only re-send the `hello` handshake and
re-establish avatar state.

### Status indicator

Update the status indicator to reflect the new two-phase state:
- Scene loading: neutral/grey — "Loading..."
- Scene loaded, not connected: grey — "Offline"
- Scene loaded, connecting: yellow — "Connecting..."
- Scene loaded, connected: green — "Connected"

---

## Part 4 — `tests/client/index.html` — default to Walk camera

Change the initial camera mode from Orbit to Walk:
- Set the combo box default value to `Walk`
- Initialize the Walk controller on page load instead of OrbitControls
- Camera starts at `[0, 1.7, 3]` facing the origin

Orbit mode remains available via the combo box for scene inspection.

---

## What NOT to Touch This Session

- `packages/protocol` — no changes needed
- `packages/server` — no changes needed
- `tools/protocol-inspector/index.html` — no changes needed
- All existing tests — must continue to pass
- `extras.atrium` world metadata in the glTF (maxUsers, navigation, etc.) —
  preserve exactly, only remove server connection info if present
- Flaky disconnect test — noted in TODO.md, not this session
- `tests/TESTING.md` — deferred
- README update — deferred

---

## When Done

1. Run `pnpm test` from `packages/protocol` — all tests pass
2. Run `pnpm test` from `packages/server` — all tests pass
3. Start the server:
   ```bash
   WORLD_PATH=tests/fixtures/space.gltf node packages/server/src/index.js
   ```
4. Serve the test client:
   ```bash
   npx serve -l 5173 tests/
   ```
5. Open `http://localhost:5173/client/index.html` — **without clicking Connect**
   - Scene renders immediately: ground plane, crate, lamp visible
   - Camera is in Walk mode by default
   - Server URL field is pre-filled from `space.atrium.json`
   - Status shows "Offline"
6. Click Connect — status goes green, server connects in background
7. Open a second tab, connect it — peer capsule appears in Tab 1
8. Walk around in Tab 1 — capsule moves in Tab 2
9. Disconnect Tab 1 — scene stays rendered, status shows "Offline"
10. Report any issues

---

## Session Log

**Completed:** 2026-03-06

### Part 1 — `tests/fixtures/space.atrium.json`
Created. Contains `version`, `world.gltf` (`./space.gltf`), and `world.server` (`ws://localhost:3000`).

### Part 2 — `tests/fixtures/space.gltf`
No change needed. `extras.atrium.world` already contained only content metadata (name, maxUsers, navigation, capabilities) — no server URL was present.

### Part 3 — `tests/client/index.html` — load sequence + manifest
- Replaced `WORLD_GLTF_PATH` with `MANIFEST_PATH` + `FALLBACK_GLTF_PATH` constants
- Added `loadManifest()` — fetches `space.atrium.json`, returns null on failure
- Added `init()` — loads manifest, resolves glTF path and server URL, pre-fills `urlInput`, calls `loadScene(gltfPath)`
- Consolidated `loadScene()` + `tryStaticLoad()` into a single `loadScene(gltfPath)` with path parameter
- `loadScene` sets status to "Offline" after load (success or failure)
- `onServerHello` no longer calls `loadScene` — scene is already loaded at that point
- Close handler now shows "Offline" instead of "Disconnected"
- Bottom wiring changed from `tryStaticLoad()` to `init()`

### Part 4 — `tests/client/index.html` — default to Walk camera
- Camera select: Walk option listed first (HTML default)
- `cameraMode` state initialized to `'walk'`
- `switchToWalk()` called immediately after OrbitControls setup — camera starts at `[0, 1.7, 3]` facing origin, orbit controls disabled

### Tests
- `packages/protocol`: 41 pass, 0 fail
- `packages/server`: 32 pass, 0 fail (including the known flaky disconnect test — passed this run)
