# Fix: `space.gltf` Extras Schema Alignment
## 2026-04-15

---

## Problem

Two places read `extras.atrium` world metadata using different path
conventions, causing one or the other to fail depending on which
fixture is loaded.

### Problem A: Legacy fixture schema

`space.gltf` uses a legacy `extras.atrium` schema with an extra
`world` nesting level and obsolete fields. The SOM Inspector's
WorldInfoPanel reads from the current schema (`extras.atrium.name`,
`extras.atrium.navigation`, etc.) and shows blank/incorrect data
for `space.gltf`.

### Current `space.gltf` (wrong)
```json
{
  "extras": {
    "atrium": {
      "version": "0.1.0",
      "world": {
        "name": "Test World",
        "maxUsers": 10,
        "navigation": { ... },
        "capabilities": { ... }
      }
    }
  }
}
```

### Expected (matches `atrium.gltf`)
```json
{
  "extras": {
    "atrium": {
      "name": "Space",
      "description": "A minimal gray-box test world.",
      "author": "Project Atrium",
      "navigation": {
        "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
        "terrainFollowing": true,
        "speed": { "default": 1.4, "min": 0.5, "max": 5.0 },
        "collision": { "enabled": false },
        "updateRate": { "positionInterval": 1000, "maxViewRate": 20 }
      }
    }
  }
}
```

### Problem B: AtriumClient console log reads old schema

AtriumClient logs the world name to the console on `world:loaded`
using the **old** path — likely `extras.atrium.world.name`. This
means it works for the legacy `space.gltf` but prints `(unnamed)`
for `atrium.gltf` which uses the current `extras.atrium.name` path.

The fix: update the world name read in AtriumClient to use
`extras.atrium.name` (the current schema). After the fixture
generators are also updated, both paths will be consistent.

Find the relevant code — search for `(unnamed)` or `world.name`
in `packages/client/src/AtriumClient.js` and update to read from
`extras.atrium.name`.

Also check `apps/client/src/app.js` — the HUD world name display
may have the same issue.

## Changes Required

### 1. `packages/client/src/AtriumClient.js`

Find the world name extraction (likely in the `world:loaded` event
emission or associated logging). Change from
`extras.atrium.world.name` to `extras.atrium.name`. Same for
`description` and `author` if they are read.

### 2. `apps/client/src/app.js`

Check the HUD world name display. If it reads from AtriumClient's
emitted event data, the fix in step 1 may be sufficient. If it
reads extras directly, update the path.

### 3. `tests/fixtures/generate-space.js`

Update the extras block to use the current schema. Remove `version`,
`world` nesting, `maxUsers`, `capabilities`. Promote `name` and
`navigation` to `extras.atrium` level. Add `description` and `author`.

### 2. Regenerate `tests/fixtures/space.gltf`

```bash
node tests/fixtures/generate-space.js
```

### 3. `tests/fixtures/generate-space.js`

Update the extras block to use the current schema. Remove `version`,
`world` nesting, `maxUsers`, `capabilities`. Promote `name` and
`navigation` to `extras.atrium` level. Add `description` and `author`.

### 4. Regenerate `tests/fixtures/space.gltf`

```bash
node tests/fixtures/generate-space.js
```

### 5. Check `space-anim.gltf`

`generate-space-anim.js` was forked from `generate-space.js` — it
likely has the same legacy schema. Apply the same fix and regenerate:

```bash
node tests/fixtures/generate-space-anim.js
```

### 6. Check `space-ext.gltf`

Same check for `generate-space-ext.js`.

### 7. Run tests

```bash
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test
pnpm --filter @atrium/client test
```

Some tests may reference the old schema paths (e.g., reading
`extras.atrium.world.name` from the space fixture). Update any
test assertions that check fixture extras.

### 8. Verify in browser

- Load `space.gltf` in SOM Inspector → WorldInfoPanel shows
  "Space", description, author, navigation fields
- Load `atrium.gltf` in SOM Inspector → still works (was already
  correct)
- Load `space.gltf` in `apps/client` → console logs world name
  correctly (not `(unnamed)`)
- Load `atrium.gltf` in `apps/client` → console logs "The Atrium"
  (not `(unnamed)`)
- HUD shows correct world name for both
