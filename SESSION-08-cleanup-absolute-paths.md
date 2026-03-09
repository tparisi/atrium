# Atrium — Session 8 Cleanup: Absolute Import Paths
## Test Client Import Path Fix

---

## Problem

`npx serve` redirects `/client/index.html` to `/client`, which breaks ES
module relative imports in the browser. When the browser lands on `/client`
(a directory URL with no filename), it treats the base URL as `/` — the
root. So a relative import like:

```javascript
import { SOMDocument } from './som/index.js'
```

Resolves to `/som/index.js` instead of `/client/som/index.js`, producing
a 404.

The workaround of navigating via the `npx serve` directory listing is
brittle and will trip up other developers.

---

## Fix

Change all local imports in `tests/client/index.html` from relative paths
to absolute paths from the serve root (`tests/`). Absolute paths don't
depend on base URL at all — they work regardless of how `npx serve`
handles the URL.

This is the right pragmatic fix for the test client. When a real Atrium
browser client is built, the correct approach will be an import map that
maps bare module names (e.g. `@atrium/som`) to CDN URLs — but that is
out of scope for the test client.

---

## Changes Needed

### `tests/client/index.html`

Change any local relative imports from `./` to absolute paths from the
serve root. For example:

```javascript
// Before
import { SOMDocument } from './som/index.js'

// After
import { SOMDocument } from '/client/som/index.js'
```

Check for any other relative imports to local files and apply the same
treatment. Leave all `https://esm.sh/...` imports unchanged.

### `tests/client/som/` — leave alone

Inter-file imports within `tests/client/som/` (e.g. `SOMDocument.js`
importing from `./SOMNode.js`) are fine as relative paths — they resolve
file-to-file, not from a page base URL. Do not change these.

### `packages/som/src/` — do not touch

This fix is only for the test client. The `packages/som` source is
unchanged.

---

## Do Not Change

- Any `https://esm.sh/...` imports — leave as-is
- Anything in `packages/som/src/`
- `packages/server/`
- `packages/protocol/`
- Any config files or serve commands

---

## Definition of Done

1. `pnpm --filter @atrium/som test` — 19 tests pass
2. `pnpm --filter @atrium/server test` — 32 tests pass
3. Start the server:
   ```bash
   WORLD_PATH=tests/fixtures/space.gltf node packages/server/src/index.js
   ```
4. Start the HTTP server:
   ```bash
   npx serve -l 5173 tests/
   ```
5. Navigate **directly** to `http://localhost:5173/client/index.html` —
   no directory listing required
6. No 404s in the npx serve output
7. Scene renders: ground plane, crate, lamp visible
8. Open browser console:
   ```javascript
   som
   // → SOMDocument object, not null
   
   som.getNodeByName('crate-01').translation
   // → [x, y, z] array
   
   som.getNodeByName('crate-01').mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
   // → crate turns green in the viewport
   ```

---

## Background: Why Not Option A (Import Map)?

An import map in the HTML would be the most robust long-term fix:

```html
<script type="importmap">
{
  "imports": {
    "@atrium/som": "/client/som/index.js"
  }
}
</script>
```

This mirrors the production pattern where `@atrium/som` is published to
npm and served via esm.sh. It is the right approach for a real Atrium
browser client.

However it is out of scope for the test client today. Absolute paths
(Option C) are simpler, sufficient, and won't mislead developers about
the intended production import pattern.

---

## Session Log

*(to be filled in during the session)*
