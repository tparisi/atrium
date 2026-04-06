# Session 23 Design Brief
## Project Atrium — Quality-of-Life: Port Config, Drag-and-Drop, .atrium.json Loading

---

## Overview

Three tightly scoped features that improve the developer/demo workflow.
Ordered by dependency: configurable port is independent, drag-and-drop
establishes local file loading, `.atrium.json` parsing extends both the
URL bar and drag-and-drop with config file detection.

---

## Feature 1: Configurable Server Port

### Scope

`packages/server/src/index.js` — read port from `PORT` environment
variable, default to 3000.

### Current code

```javascript
createSessionServer({ port: 3000, world })
console.log('Atrium server listening on ws://localhost:3000')
```

### Target code

```javascript
const port = parseInt(process.env.PORT ?? '3000', 10)

createSessionServer({ port, world })
console.log(`Atrium server listening on ws://localhost:${port}`)
```

### Usage

```bash
# Two worlds on different ports
WORLD_PATH=../../tests/fixtures/space.gltf PORT=3000 node src/index.js
WORLD_PATH=../../tests/fixtures/atrium.gltf PORT=3001 node src/index.js
```

### Tests

No new tests required — this is a two-line change to the startup script.
Existing server tests use `createSessionServer` directly and are unaffected.

---

## Feature 2: Drag-and-Drop glTF Loading

### Scope

Add drag-and-drop support to the 3D viewport in both `apps/client` and
the SOM Inspector (`tools/som-inspector`). Dropping a `.gltf` or `.glb`
file onto the viewport loads it as the current world — equivalent to
pasting a URL and clicking Load.

### Behavior

1. User drags a file from their OS file manager onto the 3D viewport.
2. A visual drop indicator appears (e.g. border highlight or overlay).
3. On drop, the app reads the file and loads it as the world.
4. The URL bar is **not** updated (local file has no URL to display).
   Optionally show the filename in the URL bar or as a status indicator.

### Event handling

Listen on the `<canvas>` element (or its container div, whichever
receives the drop — the canvas container is more reliable for drop
zones):

```javascript
const dropZone = canvasContainer  // or document.getElementById('viewport')

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  dropZone.classList.add('drag-over')  // visual feedback
})

dropZone.addEventListener('dragleave', (e) => {
  dropZone.classList.remove('drag-over')
})

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')

  const file = e.dataTransfer.files[0]
  if (!file) return

  await loadDroppedFile(file)
})
```

### File reading

Determine format from the file extension, then read accordingly:

```javascript
async function loadDroppedFile(file) {
  const name = file.name.toLowerCase()

  if (name.endsWith('.atrium.json') || name.endsWith('.json')) {
    // Feature 3 — config file handling (see below)
    const text = await file.text()
    await loadAtriumConfig(JSON.parse(text), null)  // null baseUrl for local
    return
  }

  if (name.endsWith('.glb')) {
    const buffer = await file.arrayBuffer()
    await loadWorldFromBuffer(buffer, file.name)
    return
  }

  if (name.endsWith('.gltf')) {
    const text = await file.text()
    await loadWorldFromText(text, file.name)
    return
  }

  console.warn(`Unsupported file type: ${file.name}`)
}
```

### Loading path

Currently, `client.loadWorld(url)` fetches a URL and parses it. We need
a variant that accepts already-read data. Two options:

**Option A — Add `loadWorldFromData` to AtriumClient.**

```javascript
// In AtriumClient.js
async loadWorldFromData(data, name) {
  // data is either a string (glTF JSON) or ArrayBuffer (GLB)
  // Parse with glTF-Transform io.readJSON / io.readBinary
  // Same SOM initialization as loadWorld
}
```

This is the cleaner approach — keeps the loading logic in one place.

**Option B — Create an object URL and call `loadWorld`.**

```javascript
const blob = new Blob([buffer], { type: 'model/gltf-binary' })
const objectUrl = URL.createObjectURL(blob)
await client.loadWorld(objectUrl)
URL.revokeObjectURL(objectUrl)
```

Simpler but creates a throwaway URL. May cause issues if loadWorld
tries to resolve relative paths from the URL.

**Recommendation:** Option A. Add `loadWorldFromData(data, name)` to
AtriumClient. The `name` parameter is for logging/display only. The
app-level code calls this instead of `loadWorld` for dropped files.
Claude Code should examine the existing `loadWorld` implementation and
factor out the shared SOM initialization into a common internal method
that both `loadWorld` and `loadWorldFromData` call.

### Visual drop indicator

Minimal CSS feedback:

```css
.drag-over {
  outline: 3px dashed #4a9eff;
  outline-offset: -3px;
}
```

Or a semi-transparent overlay div that appears during drag. Keep it
simple — this is a dev tool, not a consumer product.

### Deferred

- **Relative URL resolution for dropped files.** Dropped `.gltf` files
  with external buffer/texture references (non-embedded) will fail to
  resolve those paths. Embedded/base64 assets work fine. Punted — most
  test fixtures are self-contained.
- **Drop while connected.** Inherits the same issue as Load-while-connected:
  the client will show the dropped file's scene while still connected to
  a server broadcasting a different world. See Known Issues in the
  handoff doc. Will be fixed holistically later.
- **Add-to-scene behavior.** In a future editing mode, drop might add
  the file as a child node instead of replacing the world. Application-
  and mode-dependent — deferred.

### Tests

**AtriumClient:** One or two unit tests for `loadWorldFromData`:
- Load from glTF JSON string → SOM is populated, `world:loaded` fires
- Load from GLB ArrayBuffer → SOM is populated, `world:loaded` fires

**UI-level drag-and-drop:** No automated tests (DOM event simulation for
drag-and-drop is fragile). Manual testing only.

---

## Feature 3: `.atrium.json` Consumption in URL Bar

### Scope

When the user loads a URL (via the URL bar + Load button, or via
drag-and-drop), detect `.atrium.json` config files and handle them:
parse the config, resolve and load the referenced `.gltf` world, and
populate the server/Connect field with the server address.

Applies to both `apps/client` and the SOM Inspector.

### Detection

Two entry points:

1. **URL bar + Load button:** If the URL ends in `.json`, fetch it and
   attempt to parse as `.atrium.json`. If the fetch response has
   `Content-Type: application/json`, also treat it as config.
2. **Drag-and-drop:** If the dropped filename ends in `.json` or
   `.atrium.json`, read as text and parse as config.

### Config file format (existing)

```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./atrium.gltf",
    "server": "ws://localhost:3000"
  }
}
```

### Resolution and loading

```javascript
async function loadAtriumConfig(config, baseUrl) {
  // 1. Resolve the glTF path relative to the config file's URL
  const gltfUrl = baseUrl
    ? new URL(config.world.gltf, baseUrl).href
    : null  // dropped file — can't resolve relative path

  // 2. Load the world
  if (gltfUrl) {
    await client.loadWorld(gltfUrl)
    // Update the URL bar to show the resolved glTF URL
    urlInput.value = gltfUrl
  } else {
    // Dropped .atrium.json without a base URL — we can only
    // populate the server field. The glTF must be loaded separately.
    console.warn('.atrium.json dropped locally — cannot resolve relative glTF path')
    console.warn('Load the .gltf file directly, or use the URL bar with a served config.')
  }

  // 3. Populate the server field (regardless of load success)
  if (config.world.server) {
    serverInput.value = config.world.server
  }
}
```

### Behavior: populate server field only, do NOT auto-connect

Loading an `.atrium.json` populates the Connect field with
`config.world.server` but does **not** auto-connect. The user clicks
Connect manually. This keeps behavior predictable for the demo/dev stage
and avoids interacting with the load-while-connected issue.

### Edge cases

- **Missing `world.gltf`:** Warn in console, still populate server field
  if present.
- **Missing `world.server`:** Load the glTF normally, leave server field
  unchanged.
- **Invalid JSON:** Warn in console, do nothing.
- **Dropped `.atrium.json` with relative glTF path:** Cannot resolve
  without a base URL. Warn the user. Populate server field only.
- **Dropped `.atrium.json` with absolute glTF URL:** Works — fetch and
  load the glTF.

### URL bar display

After loading via `.atrium.json`, the URL bar shows the resolved `.gltf`
URL (not the config file URL). This is consistent with "the URL bar
shows what's loaded."

### Tests

**Unit tests (if `loadAtriumConfig` is factored into a testable function):**
- Config with both `gltf` and `server` → loads world, returns server URL
- Config with only `gltf` → loads world, no server URL
- Config with only `server` → no world load, returns server URL
- Invalid/empty config → no crash, appropriate warning

**Integration:** Manual testing — load `atrium.atrium.json` via URL bar,
verify world loads and server field populates.

---

## Implementation Order

1. **Configurable port** — standalone, two-line change, merge immediately
2. **`loadWorldFromData` in AtriumClient** — prerequisite for drag-and-drop,
   factor out shared init from `loadWorld`
3. **Drag-and-drop in `apps/client`** — add event listeners, call
   `loadWorldFromData`, visual drop indicator
4. **Drag-and-drop in SOM Inspector** — same pattern, share the
   `loadDroppedFile` logic if possible (or duplicate — both apps have
   independent `app.js` files)
5. **`.atrium.json` parsing** — `loadAtriumConfig` function, integrate
   into both the URL bar Load handler and `loadDroppedFile`
6. **Tests** — `loadWorldFromData` unit tests, `loadAtriumConfig` unit
   tests

---

## Files Touched

| File | Changes |
|------|---------|
| `packages/server/src/index.js` | `PORT` env var |
| `packages/client/src/AtriumClient.js` | Add `loadWorldFromData`, refactor `loadWorld` internals |
| `packages/client/tests/AtriumClient.test.js` | Tests for `loadWorldFromData` |
| `apps/client/src/app.js` | Drag-and-drop listeners, `loadDroppedFile`, `loadAtriumConfig`, integrate into Load handler |
| `apps/client/index.html` | Drop zone CSS (`.drag-over` class) |
| `tools/som-inspector/src/app.js` | Same drag-and-drop + config handling |
| `tools/som-inspector/index.html` | Drop zone CSS |

---

## Handoff Doc Updates (after implementation)

Add to **Known Issues:**
- **Load while connected** — Loading a new `.gltf` (via URL bar or
  drag-and-drop) while connected to a server does not disconnect. The
  client ends up with a local SOM that doesn't match the server's world,
  but SOM mutations still flow over the WebSocket. Should auto-disconnect
  (or prompt) before loading a different world. Deferred.

Move from Backlog to Status table:
- Configurable server port → ✅ Complete (Session 23)
- Drag-and-drop glTF loading → ✅ Complete (Session 23)
- `.atrium.json` consumption in URL bar → ✅ Complete (Session 23)

Update Backlog:
- Remove completed items
- Note that drag-and-drop "add to scene" and auto-connect are deferred
