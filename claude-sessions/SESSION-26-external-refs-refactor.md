# Session 26 Design Brief
## AtriumClient Base URL Refactor + Server `.atrium.json` Consumption

---

## Problem Statement

Two related issues:

1. **Browser coupling in AtriumClient.** `loadWorld()` uses
   `new URL(url, window.location.href)` to absolutize relative URLs.
   `packages/client` is supposed to have zero DOM dependency ("portable
   across browser UI, headless tests, and future bot clients"). This
   violates that contract.

2. **Connect-only external ref gap.** When a client connects to a server
   without first loading the world via the URL bar, `_worldBaseUrl` is
   `null` and `resolveExternalReferences()` cannot resolve relative
   `extras.atrium.source` paths. The Session 25 fix attempt (sending
   `worldBaseUrl` in server `hello`) was reverted because the server
   derived a `file://` URL that browsers can't fetch.

3. **Server has no config file.** The server takes `WORLD_PATH` and
   `PORT` as env vars. It cannot read `.atrium.json`, which means the
   server can't derive an HTTP base URL for its own external reference
   resolution when assets are served over HTTP.

---

## Design

### Part 1: Move URL absolutization to the app layer

**Principle:** `AtriumClient` never references `window`, `document`, or
any browser global. The caller is responsible for providing absolute URLs.

#### AtriumClient changes

- **`loadWorld(url)`** — remove the `new URL(url, window.location.href)`
  call. Expect `url` to already be absolute. Derive `_worldBaseUrl` by
  stripping the filename:
  ```javascript
  this._worldBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);
  ```
  If `url` has no `/`, set `_worldBaseUrl = ''` (edge case, shouldn't
  happen with absolute URLs).

- **Add `set worldBaseUrl(url)` setter** (and matching getter) on
  AtriumClient. Allows the app layer to set the base URL in flows where
  `loadWorld()` isn't called — specifically the connect-only flow, or any
  future scenario where the world data arrives by a path other than
  `loadWorld`.

- **`loadWorldFromData(data, name)`** — continues to set
  `_worldBaseUrl = null` as before. Drag-and-drop of local files still
  cannot resolve relative external references (unchanged known limitation).

- **`resolveExternalReferences()`** — no changes. Already uses
  `_worldBaseUrl` to resolve relative `source` paths via
  `new URL(source, this._worldBaseUrl)`. Works correctly when
  `_worldBaseUrl` is an absolute HTTP URL.

#### App layer changes (`apps/client/src/app.js`)

Where the Load button handler currently calls:
```javascript
client.loadWorld(url)
```

Change to absolutize first:
```javascript
const absoluteUrl = new URL(url, window.location.href).href;
client.loadWorld(absoluteUrl);
```

Same pattern in the `.atrium.json` loading path — the glTF URL resolved
from the config file must be absolutized before passing to `loadWorld()`.

Same pattern in the connect-only flow — if the app knows the world URL
(from the URL bar, from config, etc.), absolutize it and set
`client.worldBaseUrl` so external references resolve after `som-dump`.

#### App layer changes (`tools/som-inspector/src/app.js`)

Same changes as `apps/client` — absolutize before calling `loadWorld()`.

#### Test implications

- Existing `packages/client` tests that call `loadWorld()` with relative
  URLs may need adjustment. Since tests run under Node.js (no
  `window.location`), they should already be passing absolute URLs or
  using a mock. Verify — if any test relied on the browser absolutization,
  it needs to pass an absolute URL explicitly.
- No new tests needed for the setter itself (trivial property). The
  existing external reference resolution tests cover the downstream
  behavior.

---

### Part 2: Server `.atrium.json` consumption

**Goal:** If `WORLD_PATH` points to a `.json` file, the server reads it
as an `.atrium.json` config file and extracts the glTF path, port, and
(optionally) an HTTP base URL for its own external reference resolution.

#### `.atrium.json` format (updated)

```json
{
  "version": "0.1.0",
  "world": {
    "gltf": "./atrium.gltf",
    "server": "ws://localhost:3000",
    "baseUrl": "http://localhost:8080/tests/fixtures/"
  }
}
```

| Field | Used by | Purpose |
|-------|---------|---------|
| `world.gltf` | Server | Filesystem path to the glTF, resolved relative to the config file's directory |
| `world.server` | Client (existing), Server (new: port extraction) | WebSocket URL. Server parses the port from this. |
| `world.baseUrl` | Server only | HTTP URL prefix for resolving external references server-side. Not sent to clients. Optional — if absent, server falls back to `pathToFileURL` behavior for local file resolution. |

#### Server startup logic

In `packages/server/src/index.js` (or wherever world loading is
initiated):

```
1. Read WORLD_PATH env var
2. If WORLD_PATH ends with '.json':
   a. Read and parse the file as .atrium.json
   b. Resolve world.gltf relative to the config file's directory
      → absolute filesystem path to the glTF
   c. Extract port:
      - Parse world.server URL → extract port number
      - Fall back to PORT env var
      - Fall back to 3000
   d. If world.baseUrl is present, store it as the server's
      base URL for external reference resolution
   e. If world.baseUrl is absent, derive base URL from the
      resolved glTF filesystem path via pathToFileURL (existing behavior)
3. If WORLD_PATH ends with '.gltf' or '.glb':
   - Existing behavior unchanged
   - PORT env var or default 3000
   - Base URL derived via pathToFileURL from resolved WORLD_PATH
```

#### Port extraction from `world.server`

```javascript
function extractPort(wsUrl) {
  try {
    const parsed = new URL(wsUrl);
    return parseInt(parsed.port, 10) || 3000;
  } catch {
    return 3000;
  }
}
```

`new URL('ws://localhost:3000')` → `parsed.port === '3000'`. If the URL
has no explicit port (e.g. `ws://example.com`), `parsed.port` is `''`,
so fall back to 3000.

#### Server external reference resolution

The server's `resolveExternalReferences()` (or equivalent) currently
uses `pathToFileURL(resolve(gltfPath))` to derive a base URL. With
`.atrium.json`, if `world.baseUrl` is present, the server uses that
instead — allowing external reference resolution via HTTP when assets
are served by an HTTP server rather than read from the local filesystem.

If `baseUrl` is absent, the existing `pathToFileURL` behavior is
preserved (local file reads via `fs.readFile`).

#### Backward compatibility

- `WORLD_PATH=path/to/space.gltf` — works exactly as before.
- `PORT=3001` — still honored; overrides the port from `.atrium.json`
  if both are present (env var wins, standard convention).
- No changes to the `hello` message or any protocol schema.

---

### Part 3: Updated `.atrium.json` test fixtures

Update existing `.atrium.json` fixtures to include `baseUrl` where
appropriate:

- `tests/fixtures/space.atrium.json` — add `baseUrl` pointing to the
  HTTP-served fixtures directory (or leave absent for local-only testing)
- `tests/fixtures/atrium.atrium.json` — same
- `tests/fixtures/space-ext.atrium.json` — this one benefits most from
  `baseUrl` since it has external references

---

## Scope Summary

| Change | Package/Location |
|--------|-----------------|
| Remove `window.location.href` from `loadWorld()` | `packages/client` |
| Add `worldBaseUrl` getter/setter | `packages/client` |
| Absolutize URLs before `loadWorld()` | `apps/client`, `tools/som-inspector` |
| Set `worldBaseUrl` in connect-only flow | `apps/client`, `tools/som-inspector` |
| Read `.atrium.json` when `WORLD_PATH` is `.json` | `packages/server` |
| Extract port from `world.server` URL | `packages/server` |
| Use `world.baseUrl` for server-side external ref resolution | `packages/server` |
| Update test fixtures | `tests/fixtures/` |

## What Does NOT Change

- No protocol schema changes (no `worldBaseUrl` in `hello`)
- `resolveExternalReferences()` internals unchanged
- `loadWorldFromData()` behavior unchanged
- Client-side external ref resolution logic unchanged
- `som-dump` filtering unchanged

---

## Implementation Order

1. **AtriumClient base URL refactor** (Part 1) — smallest surface area,
   fixes the browser coupling. Test first.
2. **App layer absolutization** (Part 1 continued) — update both apps to
   absolutize before calling `loadWorld()`.
3. **Server `.atrium.json` consumption** (Part 2) — new server feature,
   independent of Part 1.
4. **Test fixture updates** (Part 3) — after server changes are working.

Parts 1 and 2 can be implemented and tested independently from Part 3.
