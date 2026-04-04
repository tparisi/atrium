# Session 22 — World Info Panel
## Design Brief for Claude Code

---

## Goal

Add a collapsible **World Info** panel to the SOM Inspector that displays
and allows live editing of all `extras.atrium` fields from the glTF
document root. This requires new SOM infrastructure (`SOMDocument.extras`
mutation support) and a new UI component in the inspector.

Two deliverables:

1. **`@atrium/som`** — `SOMDocument` extras getter/setter with mutation events
2. **`tools/som-inspector`** — `WorldInfoPanel` UI component + background hot-reload

---

## Deliverable 1: SOMDocument extras support

### What exists today

`SOMDocument` wraps a glTF-Transform `Document`. It provides factories
(`createNode`, `createMesh`, etc.), resolve helpers (`_resolveNode`, etc.),
and lookup maps (`getNodeByName`, `_nodesByName`). It does **not** expose
or mutate `extras` on the document root.

The glTF-Transform `Document` stores root-level extras via:
```javascript
doc.getRoot().getExtras()   // → object
doc.getRoot().setExtras(obj) // replaces the entire extras object
```

Individual SOM types (e.g. `SOMNode`) already have `extras` get/set with
mutation events. `SOMDocument` needs the same pattern, adapted for the
root.

### What to build

Add to `SOMDocument`:

```javascript
// Getter — returns the full extras object (by reference, same as SOMNode)
get extras() {
  return this._root.getExtras();
}

// Setter — replaces entire extras, fires mutation event
set extras(value) {
  this._root.setExtras(value);
  if (this._hasListeners('mutation')) {
    this._dispatchEvent({
      target: this,
      property: 'extras',
      value
    });
  }
}
```

Where `this._root` is `this._document.getRoot()` (the glTF-Transform
Root object). Store this reference in the constructor:

```javascript
this._root = this._document.getRoot();
```

`SOMDocument` already extends `SOMObject`, so `_hasListeners`,
`_dispatchEvent`, `addEventListener`, and `removeEventListener` are
inherited and ready to use.

### Convenience: `setExtrasAtrium(path, value)`

Editing a single field inside `extras.atrium` (e.g. changing
`background.texture`) currently requires reading the full extras object,
deep-cloning, mutating, and writing back. Provide a helper:

```javascript
setExtrasAtrium(path, value) {
  const extras = structuredClone(this.extras || {});
  const atrium = extras.atrium || (extras.atrium = {});

  // path is dot-delimited: 'background.texture', 'navigation.speed.default'
  const segments = path.split('.');
  let target = atrium;
  for (let i = 0; i < segments.length - 1; i++) {
    if (target[segments[i]] === undefined || target[segments[i]] === null) {
      target[segments[i]] = {};
    }
    target = target[segments[i]];
  }
  target[segments[segments.length - 1]] = value;

  this.extras = { ...extras, atrium };
  // The setter handles the mutation event
}
```

This keeps the panel code clean — each input calls
`som.setExtrasAtrium('background.texture', newValue)` instead of
doing the clone-mutate-write dance inline.

### Tests

Add to `packages/som/tests/`:

| Test | Assertion |
|------|-----------|
| `SOMDocument.extras getter returns root extras` | Reading extras returns the object from `getRoot().getExtras()` |
| `SOMDocument.extras setter updates root extras` | Setting extras updates `getRoot().getExtras()` |
| `SOMDocument.extras setter fires mutation event` | Listener receives `{ target: somDoc, property: 'extras', value }` |
| `SOMDocument.extras setter skips event when no listeners` | No error, no allocation when no listeners attached |
| `setExtrasAtrium sets top-level field` | `som.setExtrasAtrium('name', 'X')` → `extras.atrium.name === 'X'` |
| `setExtrasAtrium sets nested field` | `som.setExtrasAtrium('background.texture', 'sky.png')` → correct nesting |
| `setExtrasAtrium creates intermediate objects` | `som.setExtrasAtrium('foo.bar.baz', 1)` → creates `foo.bar` if absent |
| `setExtrasAtrium fires mutation event` | Event fires with full extras object as value |
| `setExtrasAtrium preserves existing fields` | Setting one field doesn't clobber siblings |

### SOM sync copy reminder

After changing `packages/som/src/`, sync the manual copy:
```bash
cp packages/som/src/*.js tests/client/som/
```

---

## Deliverable 2: WorldInfoPanel component

### File

`tools/som-inspector/src/WorldInfoPanel.js`

### Architecture

A new ES module class following the same patterns as `TreeView.js` and
`PropertySheet.js`:

- Constructor receives a container DOM element
- `show(som)` reads `som.extras?.atrium` and builds the form
- `refresh()` re-reads SOM values into existing inputs (same updater
  pattern as PropertySheet — store closures, no DOM reconstruction,
  no focus loss)
- `clear()` empties the container

### Integration in `app.js`

Import `WorldInfoPanel` and instantiate it alongside `TreeView` and
`PropertySheet`. Wire it to AtriumClient events:

| Event | Action |
|---|---|
| `world:loaded` | `worldInfo.show(client.som)` |
| `som:set` | If the mutation targets document-root extras, call `worldInfo.refresh()` |
| disconnect / reload | `worldInfo.clear()` |

**Note on `som:set` for document extras:** Today `som:set` fires for node
property changes with `{ nodeName, path, value }`. Document-root extras
mutations don't have a node name. The `som:set` event for document extras
should use a sentinel like `nodeName: null` or `nodeName: '__document__'`
— check what AtriumClient currently emits for mutations on the
`SOMDocument` itself, and adapt if needed. If AtriumClient's mutation
listener isn't wired to `SOMDocument` yet (it currently listens on
individual nodes), it will need to be — see Integration Notes below.

### Layout

The panel sits above the tree view in the left column. Add a new
container div in `index.html`:

```
┌─────────────────────┐
│ ▸ World Info         │  ← collapsed (default)
├─────────────────────┤
│                     │
│   Tree view         │
│   (fills remaining  │
│    height)          │
│                     │
├─────────────────────┤
│   Property sheet    │
└─────────────────────┘
```

Expanded:

```
┌─────────────────────┐
│ ▾ World Info         │
│                     │
│  Name: [The Atrium] │
│  Desc: [A circular… │
│  Author: [Project…] │
│                     │
│  Background         │
│  Type: [equirect ▾] │
│  Texture: [skybox…] │
│                     │
│  Navigation         │
│  Modes: WALK, FLY,  │
│    ORBIT, TELEPORT  │
│  Speed              │
│    Default: [1.4]   │
│    Min: [0.5]       │
│    Max: [5.0]       │
│  Terrain: [✓]       │
│  Collision: [ ]     │
│  Update Rate        │
│    Position: [1000] │
│    Max View: [20]   │
│                     │
├─────────────────────┤
│                     │
│   Tree view         │
│   (fills remaining) │
│                     │
├─────────────────────┤
│   Property sheet    │
└─────────────────────┘
```

### Collapse behavior

- Header bar: `▸ World Info` / `▾ World Info`
- Click anywhere on the header bar to toggle
- **Collapsed by default** on load. `show(som)` populates the form but
  does not auto-expand.
- State is purely CSS — toggle a class on the container, content div
  has `display: none` when collapsed.

### Field types and inputs

**Identity section (no sub-header needed — these are at the top):**

| Field | `extras.atrium` path | Input type |
|-------|---------------------|------------|
| Name | `name` | text input |
| Description | `description` | text input (or textarea if long) |
| Author | `author` | text input |

**Background section (sub-header: "Background"):**

| Field | Path | Input type |
|-------|------|------------|
| Type | `background.type` | dropdown: `equirectangular`, `cubemap` |
| Texture | `background.texture` | text input (file path) |

**Navigation section (sub-header: "Navigation"):**

| Field | Path | Input type |
|-------|------|------------|
| Modes | `navigation.mode` | read-only display (comma-separated list). Editing an array of mode strings is complex UI — defer to a future session. |
| Default Speed | `navigation.speed.default` | number input |
| Min Speed | `navigation.speed.min` | number input |
| Max Speed | `navigation.speed.max` | number input |
| Terrain Following | `navigation.terrainFollowing` | checkbox |
| Collision Enabled | `navigation.collision.enabled` | checkbox |
| Position Interval | `navigation.updateRate.positionInterval` | number input (ms) |
| Max View Rate | `navigation.updateRate.maxViewRate` | number input (msg/s) |

### Input → SOM mutation wiring

Each editable input calls `som.setExtrasAtrium(path, value)` on change.
Use the `change` event for text inputs and dropdowns, `change` for
checkboxes. Parse number inputs with `parseFloat`; reject `NaN` (revert
to previous value).

Example:
```javascript
nameInput.addEventListener('change', () => {
  som.setExtrasAtrium('name', nameInput.value);
});
```

### Styling

Match the existing inspector aesthetic — same font, same label/input
sizing as PropertySheet. The header bar should be visually distinct
(slightly different background shade, cursor: pointer) to signal
clickability.

The content area should have the same padding and spacing as
PropertySheet sections. Sub-headers ("Background", "Navigation") use
the same styling as PropertySheet section headers ("Node", "Material",
"Camera").

---

## Integration Notes for AtriumClient

### Problem

AtriumClient currently attaches mutation listeners to individual SOM
nodes (in `_installMutationListeners`). It does **not** listen for
mutations on the `SOMDocument` itself. When the WorldInfoPanel edits
`som.extras` via `setExtrasAtrium`, the mutation event fires on the
`SOMDocument` — but nothing picks it up and sends it to the server.

### Solution

After the SOM is initialized (in the `som-dump` handler or wherever
mutation listeners are installed), add a mutation listener on the
`SOMDocument`:

```javascript
som.addEventListener('mutation', (event) => {
  if (this._applyingRemote) return;  // loopback guard
  if (event.property === 'extras') {
    this._send({
      type: 'set',
      seq: this._nextSeq(),
      name: '__document__',
      path: 'extras',
      value: event.value
    });
  }
});
```

On the receiving side, when a `set` message arrives with
`name === '__document__'`:

```javascript
if (msg.name === '__document__' && msg.path === 'extras') {
  this._applyingRemote = true;
  this.som.extras = msg.value;
  this._applyingRemote = false;
  this.emit('som:set', { nodeName: '__document__', path: 'extras', value: msg.value });
  return;
}
```

The server doesn't need changes — it already forwards `set` messages
as-is. The `name: '__document__'` is just a convention at the protocol
level; the server treats it as an opaque string.

### Protocol schema note

Verify that `@atrium/protocol`'s `set` schema allows `name` to be
`'__document__'`. Since `name` is just a string field it should pass
validation, but confirm. If the schema has a pattern constraint (e.g.
must not start with `__`), relax it or use a different sentinel.

---

## Server-side: `set` handling for `__document__`

The server needs to apply `__document__` set messages to the world
state's root extras (via `som.extras = value`) so that late joiners
receive the updated world metadata in their `som-dump`. Without this,
edits made via the inspector are broadcast to connected peers but lost
for anyone who joins later.

Check how the server currently handles `set` — it likely does
`som.setPath(node, path, value)` which expects a node name. Add a
branch:

```javascript
if (msg.name === '__document__') {
  if (msg.path === 'extras') {
    som.extras = msg.value;
  }
  // broadcast as usual
} else {
  // existing node-level setPath logic
}
```

---

## Background hot-reload

### What exists today

Both `apps/client/src/app.js` and `tools/som-inspector/src/app.js`
already load the skybox after `world:loaded` fires. The pattern is:

1. Read `extras.atrium.background` from the SOM
2. Resolve `texture` path relative to the world file URL
3. Load via Three.js `TextureLoader`
4. Set `EquirectangularReflectionMapping` + `SRGBColorSpace`
5. Assign to both `scene.background` and `scene.environment`

On disconnect/reload, `scene.background` and `scene.environment` are
cleared before loading the next world.

### What to build

Extract the skybox loading logic in `tools/som-inspector/src/app.js`
into a reusable function (e.g. `loadBackground(background, baseUrl)`)
that can be called both from the initial `world:loaded` handler and
on background field edits.

**Trigger:** The WorldInfoPanel needs a way to notify `app.js` that
a background field changed. Two clean options:

**Option A — callback:** WorldInfoPanel constructor accepts an
`onBackgroundChange` callback. When the `background.type` or
`background.texture` input fires `change`, the panel calls
`som.setExtrasAtrium(...)` as before, then calls
`onBackgroundChange(som.extras?.atrium?.background)`. The app wires
this in initialization:

```javascript
const worldInfo = new WorldInfoPanel(container, {
  onBackgroundChange: (bg) => loadBackground(bg, worldBaseUrl)
});
```

**Option B — listen for `som:set`:** The app's existing `som:set`
handler checks whether the mutation is a `__document__` extras change
and, if so, re-reads background and calls `loadBackground`. This is
more decoupled but means the app has to parse the extras to detect
background-specific changes.

**Recommendation: Option A.** It's explicit, avoids parsing, and keeps
the WorldInfoPanel in control of when the reload fires. The callback
only fires for background field changes, not for every extras edit.

### Behavior

- Changing `background.texture` to a new path triggers an immediate
  load attempt. On success, the skybox updates live. On failure, warn
  to console — don't clear the existing skybox (the old one stays
  visible, which is better than a black void).
- Changing `background.type` also triggers a reload, since the mapping
  type affects how Three.js interprets the texture.
- Clearing the texture path (empty string) clears the skybox:
  `scene.background = null; scene.environment = null`.

### Scope

Hot-reload is implemented in the SOM Inspector only. `apps/client` is
not modified in this session — it continues to load the background once
on `world:loaded`. If we want it there later, the same
`loadBackground` extraction can be applied.

---

## What NOT to build in this session

- **Mode array editing UI.** The navigation `mode` array is displayed
  read-only. Editing an ordered set of mode strings needs a multi-select
  or tag-style input — defer.
- **Undo/redo.** Not in scope.
- **Validation.** No schema validation on extras field values. The user
  can type whatever they want; garbage values are the user's problem for
  now.

---

## Test plan summary

| Area | New tests |
|------|-----------|
| `@atrium/som` — `SOMDocument.extras` | ~9 tests (see Deliverable 1) |
| `@atrium/client` — document extras sync | ~3 tests: local mutation sends `set` with `__document__`, inbound `set` with `__document__` applies to SOM, loopback prevention |
| `@atrium/server` — `__document__` set handling | ~2 tests: applies to world state, included in `som-dump` for late joiners |

Estimated total: ~14 new tests.

---

## Files to modify

| File | Change |
|------|--------|
| `packages/som/src/SOMDocument.js` | Add `extras` getter/setter, `setExtrasAtrium()` |
| `packages/som/tests/*.test.js` | New tests for document extras |
| `packages/client/src/AtriumClient.js` | Document mutation listener, `__document__` receive handler |
| `packages/client/tests/*.test.js` | New tests for document extras sync |
| `packages/server/src/session.js` (or equivalent) | `__document__` branch in set handler |
| `packages/server/tests/*.test.js` | New tests for document set |
| `tools/som-inspector/index.html` | Add `#world-info` container div above tree view |
| `tools/som-inspector/src/WorldInfoPanel.js` | New file — full component |
| `tools/som-inspector/src/app.js` | Import and wire WorldInfoPanel |
| `tests/client/som/` | Re-sync from `packages/som/src/` |

---

## Acceptance criteria

1. Load a world in the SOM Inspector. The collapsed "World Info" header
   appears above the tree view.
2. Click to expand. All `extras.atrium` fields are displayed with correct
   current values.
3. Edit a field (e.g. change `name` from "The Atrium" to "My World").
   The SOM is updated immediately.
4. With two inspector instances connected to the same server: edit a
   field in one, see it update in the other.
5. A late-joining client receives the edited values in its `som-dump`.
6. All existing tests still pass. New tests pass.
7. Collapsing and expanding the panel preserves field values and does
   not cause flicker or DOM reconstruction.
8. In the SOM Inspector, change the `background.texture` path to a
   different equirectangular image. The skybox updates live without
   reloading the world.
9. Clear the `background.texture` field. The skybox is removed
   (scene background becomes default).
