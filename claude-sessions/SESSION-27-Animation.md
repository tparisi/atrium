# Atrium Animation Support — Design Spec
## Session 27 · 2026-04-14

---

## Overview

Animation support for Atrium, covering the SOM object model, playback
state and synchronization, protocol changes, and the global SOM
namespace refactor required to support targeting non-node objects.

---

## 1. SOMAnimation Object

`SOMAnimation` wraps a glTF-Transform `Animation`. Like all SOM types,
it inherits from `SOMObject` (getting `addEventListener`,
`removeEventListener`, `_hasListeners`, `_dispatchEvent`).

### 1.1 Intrinsic Properties (read-only, from glTF content)

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Animation name from glTF |
| `duration` | number | Max keyframe time across all samplers (seconds) |
| `channels` | object[] | Read-only channel descriptors (see §1.2) |
| `samplers` | object[] | Read-only sampler descriptors (see §1.3) |

These are authored content — not editable at runtime (v1).

### 1.2 Channel Descriptors

Each entry in `channels` is a plain object (not a SOM-wrapped type):

```javascript
{
  targetNode: 'Armature/Leg_L',   // name of the targeted SOMNode
  targetProperty: 'rotation',     // 'translation' | 'rotation' | 'scale' | 'weights'
  samplerIndex: 0                 // index into this.samplers
}
```

Provides enough information for the inspector and app layer to display
"this animation targets these nodes and properties" without exposing
the full glTF-Transform channel internals.

### 1.3 Sampler Descriptors

Each entry in `samplers` is a plain object:

```javascript
{
  interpolation: 'LINEAR',   // 'LINEAR' | 'STEP' | 'CUBICSPLINE'
  inputCount: 30,            // number of keyframes (time values)
  outputCount: 30            // number of output values
}
```

Keyframe data itself is not exposed — it lives in the glTF-Transform
accessors. The descriptor gives metadata for display and debugging.

---

## 2. Playback State

### 2.1 The `playback` Compound Property

All playback state is stored as a single compound property on
`SOMAnimation`. This is the **only mutable property** on
`SOMAnimation`. Writing to `playback` fires a single mutation event,
which produces a single `set` message on the wire.

```javascript
{
  playing: false,          // true after play(), false after stop()/pause()
  paused: false,           // true after pause(), false after play()/stop()
  loop: false,             // loop playback
  timeScale: 1.0,          // playback speed multiplier
  startTime: 0,            // animation-local time where playback began (seconds)
  startWallClock: null,     // wall-clock timestamp (ms) when play() was invoked
  pauseTime: null           // animation-local time where pause() froze (seconds)
}
```

Default state (returned by `stop()` and used at construction):

```javascript
{
  playing: false,
  paused: false,
  loop: false,
  timeScale: 1.0,
  startTime: 0,
  startWallClock: null,
  pauseTime: null
}
```

### 2.2 Convenience Accessors (read-only)

Top-level getters that read from the internal `_playback` object.
No setters — the only way to change playback state is through the
`playback` setter or the `play()`/`pause()`/`stop()` methods.

```javascript
get playing()        { return this._playback.playing; }
get paused()         { return this._playback.paused; }
get loop()           { return this._playback.loop; }
get timeScale()      { return this._playback.timeScale; }
get startTime()      { return this._playback.startTime; }
get startWallClock() { return this._playback.startWallClock; }
get pauseTime()      { return this._playback.pauseTime; }
```

### 2.3 Computed Property: `currentTime`

`currentTime` is **not stored and not sent over the wire**. It is
derived live from the stored playback state every time it is read.

```javascript
get currentTime() {
  if (!this._playback.playing) {
    return this._playback.paused
      ? this._playback.pauseTime
      : 0;
  }
  const elapsed = (Date.now() - this._playback.startWallClock) / 1000
                  * this._playback.timeScale;
  const t = this._playback.startTime + elapsed;
  return this._playback.loop
    ? t % this.duration
    : Math.min(t, this.duration);
}
```

### 2.4 Methods

These are convenience methods that compute the correct `playback`
state object and write it through the `playback` setter atomically.
Each method results in exactly one mutation event and one `set`
message.

#### `play({ startTime, loop, timeScale })`

```javascript
play({ startTime = 0, loop = false, timeScale = 1.0 } = {}) {
  this.playback = {
    playing: true,
    paused: false,
    loop,
    timeScale,
    startTime,
    startWallClock: Date.now(),
    pauseTime: null
  };
}
```

#### `pause()`

```javascript
pause() {
  if (!this._playback.playing) return;   // no-op if not playing
  const elapsed = (Date.now() - this._playback.startWallClock) / 1000
                  * this._playback.timeScale;
  this.playback = {
    ...this._playback,
    playing: false,
    paused: true,
    pauseTime: this._playback.startTime + elapsed
  };
}
```

#### `stop()`

```javascript
stop() {
  this.playback = {
    playing: false,
    paused: false,
    loop: false,
    timeScale: 1.0,
    startTime: 0,
    startWallClock: null,
    pauseTime: null
  };
}
```

#### Resume from pause

Not a separate method. Call `play()` with `startTime` set to the
current `pauseTime`:

```javascript
anim.play({
  startTime: anim.pauseTime,
  loop: anim.loop,
  timeScale: anim.timeScale
});
```

### 2.5 Mutation Event

The `playback` setter fires one mutation event:

```javascript
{
  target: somAnimation,
  property: 'playback',
  value: {
    playing: true,
    paused: false,
    loop: true,
    timeScale: 1.5,
    startTime: 0,
    startWallClock: 1713100800000,
    pauseTime: null
  }
}
```

AtriumClient's mutation listener sends one `set` message containing
the entire compound value.

### 2.6 `timeupdate` Event (Local Only)

`currentTime` is a computed property that changes continuously while
an animation is playing. Rather than requiring the app layer to poll
it, `SOMAnimation` provides a `timeupdate` event — the same name
the DOM uses for `<video>` and `<audio>` elements.

**This is a local-only event.** AtriumClient does not listen for
`timeupdate` and does not send it over the protocol. No wire traffic
is generated. Only application-level listeners (renderer, inspector
UI) consume it.

#### `tick()` Method

`SOMAnimation` is a passive data object — it has no frame loop.
The app layer drives `timeupdate` by calling `tick()` from its
existing frame loop:

```javascript
// In app's frame loop (apps/client, som-inspector)
for (const anim of som.animations) {
  if (anim.playing) {
    anim.tick();
  }
}
```

Implementation:

```javascript
tick() {
  if (!this._playback.playing || !this._hasListeners('timeupdate')) return;
  this._dispatchEvent({
    type: 'timeupdate',
    target: this,
    currentTime: this.currentTime   // computed from wall clock
  });
}
```

#### Design details

- **Zero cost when unused.** The `_hasListeners` check (inherited
  from `SOMObject`) skips event object allocation when nobody is
  listening. Calling `tick()` on animations with no `timeupdate`
  listeners is essentially free.
- **AtriumClient never listens for `timeupdate`.** It only listens
  for `mutation` events. `tick()` does not fire mutation events.
  No protocol traffic, no loopback concerns.
- **Inspector use case:** the property sheet can listen for
  `timeupdate` to drive a live "Current Time: 2.34s" display
  without polling.
- **Renderer use case:** the renderer can listen for `timeupdate`
  to drive `mixer.update()`, or it can read `anim.currentTime`
  directly in its own frame loop — both patterns work. The event
  is there for consumers who prefer a reactive style.

#### Event shape

```javascript
{
  type: 'timeupdate',
  target: somAnimation,
  currentTime: 2.34          // seconds
}
```

---

## 3. Protocol

### 3.1 Wire Format

Animation playback mutations use the existing `set` message. No new
message types are needed.

```json
{
  "type": "set",
  "name": "WalkCycle",
  "field": "playback",
  "value": {
    "playing": true,
    "paused": false,
    "loop": true,
    "timeScale": 1.5,
    "startTime": 0,
    "startWallClock": 1713100800000,
    "pauseTime": null
  },
  "seq": 42
}
```

The `name` field carries the animation name. The server and client
resolve it via `som.getObjectByName(name)`, which returns the
`SOMAnimation` instance. The `field` is `"playback"`, and the `value`
is the full compound playback state.

### 3.2 No New Message Types

We considered an `invoke` message type for method calls (`play`,
`pause`, `stop`). This was rejected. The methods are convenience
wrappers that produce a property mutation. The existing `set` message
carries the result. Remote clients react to the state change, not the
method invocation.

### 3.3 Remote Client Behavior

When a remote client receives a `set` for an animation's `playback`
property:

1. AtriumClient applies the value to the local SOM via the `playback`
   setter (under `_applyingRemote` guard, same as node mutations).
2. The SOM fires a mutation event.
3. AnimationController (see §6) hears the mutation, emits a semantic
   event (`animation:play`, `animation:pause`, or `animation:stop`).
4. The app-layer renderer listens to AnimationController events and
   translates to Three.js `AnimationMixer` / `AnimationAction` calls.

### 3.4 Wall Clock: Client-Stamped (v1)

The originating client stamps `startWallClock` with its own
`Date.now()`. The server does not modify `set` values in transit —
it passes them through, consistent with the server being policy-free
on content (principle #5).

**Future consideration:** For tighter synchronization (e.g.,
music-synced experiences or competitive multiplayer), the server
could stamp `startWallClock` at broadcast time. This would require
the server to inspect and modify `set` values for animation
playback — a targeted exception to the pass-through rule. Deferred.

---

## 4. Global SOM Namespace

### 4.1 Motivation

The existing protocol targets SOM objects by name via the `name` field
in `set`, `add`, `remove` messages. Currently, `name` resolves only
against nodes (via `som.getNodeByName()`), with `__document__` as a
sentinel for document-root extras.

Animations are document-level objects, not nodes. Rather than adding
type prefixes to names or new message fields, we adopt a single flat
namespace for all named SOM objects — following the DOM's `id` model
where every element shares one namespace regardless of tag type.

### 4.2 Design

**One shared `Map` on `SOMDocument`:** `_objectsByName`

Every named SOM object registers in `_objectsByName` at construction
time. Names must be unique across all SOM types — a node and an
animation cannot share a name.

**Typed maps are retained** for convenience lookups:
- `_nodesByName` (existing)
- `_animationsByName` (new)

**Registration with collision detection:**

```javascript
_registerObject(name, somObject) {
  if (this._objectsByName.has(name)) {
    const existing = this._objectsByName.get(name);
    console.warn(
      `SOM: duplicate name "${name}" — ` +
      `${existing.constructor.name} already registered, ` +
      `${somObject.constructor.name} will not be addressable by name`
    );
    return false;
  }
  this._objectsByName.set(name, somObject);
  return true;
}
```

**Lookup API:**

```javascript
som.getObjectByName('WalkCycle')   // → SOMAnimation (or any SOM type)
som.getObjectByName('Crate')      // → SOMNode
som.getObjectByName('__document__') // → SOMDocument

som.getNodeByName('Crate')         // existing, nodes only
som.getAnimationByName('WalkCycle') // new, animations only
```

### 4.3 Name Uniqueness

glTF 2.0 stores nodes and animations in separate arrays with
independent name namespaces. The spec does not prevent a node and an
animation from sharing a name.

Atrium enforces a stricter rule: **all names are unique across all SOM
types.** This follows the DOM's `id` uniqueness model. If a glTF file
contains a name collision across types:

- The first object registered (during bottom-up SOM construction) wins.
- The colliding object is not registered in `_objectsByName`.
- A warning is logged.
- The colliding object is still accessible via the typed lookup
  (e.g., `getAnimationByName`) but not via `getObjectByName` or the
  protocol.

In practice, name collisions across types are rare in authored glTF
content.

### 4.4 `__document__` Unification

`SOMDocument` registers itself in `_objectsByName` under the name
`__document__`. The existing sentinel-based branching in AtriumClient
and the server's `set` handler can be replaced with the uniform
`getObjectByName` path:

```javascript
// Before (special case):
if (msg.name === '__document__') {
  som.extras = msg.value;
} else {
  const node = som.getNodeByName(msg.name);
  som.setPath(node, msg.field, msg.value);
}

// After (uniform):
const target = som.getObjectByName(msg.name);
som.setPath(target, msg.field, msg.value);
```

This requires `setPath` to work on `SOMDocument` (for `extras`) and
`SOMAnimation` (for `playback`), not just `SOMNode`. Since `setPath`
walks property accessors, and these are standard JavaScript
getter/setter pairs, this should work without modification.

### 4.5 Protocol Impact

**None.** The `name` field in `set` messages is unchanged. The only
difference is on the resolution side — `getObjectByName` replaces
`getNodeByName` as the primary lookup. The schema does not change.

### 4.6 Construction Order

During `SOMDocument` construction, objects are registered in bottom-up
order:

1. `SOMDocument` registers as `__document__`
2. Materials, meshes, cameras, skins, textures (existing — not
   currently name-registered; could be added later if protocol
   targeting is needed)
3. Nodes → registered in both `_nodesByName` and `_objectsByName`
4. Animations → registered in both `_animationsByName` and
   `_objectsByName`, with collision check against `_objectsByName`

### 4.7 Dynamic Registration

When new objects are created at runtime (e.g., `som.ingestNode`,
`som.ingestExternalScene`, avatar nodes), they must also register in
`_objectsByName`. The external reference prefix scheme
(`ContainerName/OriginalName`) applies to animations inside external
references as well: `Chair-NorthWall/WalkCycle`.

When objects are removed (`som:remove`), they must be unregistered
from both `_objectsByName` and the typed map.

---

## 5. glTF Storage and `som-dump`

### 5.1 Storage Location

Playback state is stored in `extras.atrium.playback` on the glTF
Animation object:

```json
{
  "animations": [{
    "name": "WalkCycle",
    "channels": [...],
    "samplers": [...],
    "extras": {
      "atrium": {
        "playback": {
          "playing": true,
          "paused": false,
          "loop": true,
          "timeScale": 1.5,
          "startTime": 0,
          "startWallClock": 1713100800000,
          "pauseTime": null
        }
      }
    }
  }]
}
```

### 5.2 `som-dump` — No Special Handling

The server's SOM holds the current playback state (updated by `set`
messages). When serializing for `som-dump`, the glTF Document is
serialized as usual — animation extras round-trip naturally.

A late-joining client receives the full glTF Document, constructs its
SOM, reads `extras.atrium.playback` on each animation, and:

- If `playing: true`: computes elapsed time from `startWallClock`,
  seeks to the correct playhead position, starts playback.
- If `paused: true`: seeks to `pauseTime`, does not advance.
- If stopped (both false): no action.

No special `som-dump` handling, no replay, no new message types.
The existing serialization machinery carries animation state.

### 5.3 Static Browsing

When viewing a glTF file without a server (principle #8), animations
can still be played locally. The `SOMAnimation.play()` method works
the same — it just doesn't get broadcast since there's no connection.

If the glTF file has `extras.atrium.playback` with `playing: true`
baked in, the client could auto-start the animation on load. This is
an authoring choice, not something Atrium enforces.

---

## 6. AnimationController (`packages/client`)

### 6.1 Role

`AnimationController` manages the SOM-level animation lifecycle, the
same way `AvatarController` manages avatar lifecycle and
`NavigationController` manages input-to-SOM translation. It lives in
`packages/client` — headless, no Three.js, no DOM dependency.

The app layer creates it, wires it up, and calls `tick(dt)` once per
frame. AnimationController handles the rest: tracking animations,
listening for playback state changes, driving `timeupdate` events,
and emitting semantic events for the renderer.

### 6.2 Constructor

```javascript
const animController = new AnimationController(client);
```

Takes an `AtriumClient` instance. Listens to client events to track
animation lifecycle.

### 6.3 Lifecycle

**On `world:loaded`:** Scans `client.som.animations`. For each
animation:
- Registers a `mutation` listener on the `SOMAnimation` for
  `playback` changes
- Adds to internal tracking set
- If the animation has `playing: true` in its loaded state
  (late-joiner or authored auto-play), emits `animation:play`

**On `som:add`:** Checks if the added object is an animation (via
`som.getAnimationByName`). If so, sets up tracking and mutation
listener. Emits `animation:added`.

**On `som:remove`:** If the removed object was a tracked animation,
tears down listener, removes from tracking. Emits `animation:removed`.

**On `SOMAnimation` `mutation` event (property: `playback`):**
Inspects the new playback state and emits the appropriate semantic
event:
- `playing: true` → emits `animation:play`
- `playing: false, paused: true` → emits `animation:pause`
- `playing: false, paused: false` → emits `animation:stop`

### 6.4 `tick(dt)`

Called once per frame by the app layer. Iterates all tracked
animations that are currently playing and calls `anim.tick()` on
each, which fires `timeupdate` events (if listeners exist).

```javascript
tick(dt) {
  for (const anim of this._playing) {
    anim.tick();
  }
}
```

`_playing` is a `Set` of `SOMAnimation` instances updated when
playback state changes. Only playing animations are iterated — paused
and stopped animations are not in the set.

### 6.5 Events

```javascript
animController.on('animation:added',   ({ animation }) => {})
animController.on('animation:removed', ({ animation }) => {})
animController.on('animation:play',    ({ animation }) => {})
animController.on('animation:pause',   ({ animation }) => {})
animController.on('animation:stop',    ({ animation }) => {})
```

| Event | Fired when |
|-------|------------|
| `animation:added` | New animation appears in SOM (external ref, dynamic) |
| `animation:removed` | Animation removed from SOM |
| `animation:play` | `playback.playing` becomes `true` (local or remote) |
| `animation:pause` | `playback.paused` becomes `true` |
| `animation:stop` | `playback.playing` and `playback.paused` both `false` |

All events include the `SOMAnimation` instance. The app-layer
renderer uses these to create/destroy/control Three.js
`AnimationAction` objects without ever inspecting raw SOM mutation
events.

### 6.6 App Layer Wiring

```javascript
// In apps/client/src/app.js (or som-inspector/src/app.js)

const client = new AtriumClient();
const avatar = new AvatarController(client);
const nav = new NavigationController(avatar);
const anim = new AnimationController(client);   // new

// Frame loop
function tick(dt) {
  nav.tick(dt);
  anim.tick(dt);           // drives timeupdate events
  mixer.update(dt);        // Three.js animation mixer
  renderer.render(scene, camera);
}

// Renderer reacts to AnimationController events
anim.on('animation:play', ({ animation }) => {
  const clip = findClip(animation.name);
  const action = mixer.clipAction(clip);
  action.loop = animation.loop ? THREE.LoopRepeat : THREE.LoopOnce;
  action.clampWhenFinished = !animation.loop;
  action.timeScale = animation.timeScale;
  action.reset().play();
  action.time = animation.currentTime;   // seek to computed position
});

anim.on('animation:pause', ({ animation }) => {
  const action = mixer.existingAction(findClip(animation.name));
  if (action) action.paused = true;
});

anim.on('animation:stop', ({ animation }) => {
  const action = mixer.existingAction(findClip(animation.name));
  if (action) action.stop();
});
```

### 6.7 Design Rationale

Why a separate controller rather than putting this logic in
AtriumClient or the app layer directly?

- **Consistency:** Matches AvatarController and NavigationController
  pattern. Each controller owns one concern.
- **Headless:** Lives in `packages/client`, no browser dependency.
  Bot clients and test harnesses can use it.
- **Encapsulation:** The app layer's frame loop stays clean — one
  `anim.tick(dt)` call instead of iterating animations and checking
  playback state.
- **Separation of concerns:** AtriumClient handles protocol ↔ SOM
  sync. AnimationController handles SOM → renderer translation. The
  app layer wires them together.

---

## 7. Renderer Integration (App Layer)

### 7.1 Responsibilities

The renderer (in `apps/client` and `tools/som-inspector`) is
responsible for:

- Creating a Three.js `AnimationMixer` on `world:loaded`
- Listening to `AnimationController` events (not raw SOM mutations)
- Translating events into `AnimationMixer` / `AnimationAction` calls
- Calling `mixer.update(dt)` in the frame loop

### 7.2 Mapping to Three.js AnimationMixer

| AnimationController event | Three.js action |
|----|-----|
| `animation:play` | `action.reset().play()`, seek to computed `currentTime` |
| `animation:pause` | `action.paused = true` |
| `animation:stop` | `action.stop()` |
| `animation.loop === true` | `action.loop = THREE.LoopRepeat` |
| `animation.loop === false` | `action.loop = THREE.LoopOnce; action.clampWhenFinished = true` |
| `animation.timeScale` | `action.timeScale = value` |

### 7.3 Late-Joiner Sync

On `world:loaded`, AnimationController scans all animations and emits
`animation:play` for any that have `playing: true`. The renderer
receives these events and starts each animation at the correct
computed playhead position via `animation.currentTime`.

---

## 8. SOM Inspector Support

### 8.1 Tree View

Animations appear in the tree under a top-level "Animations" group
(after the Scene tree), similar to how the DOM inspector separates
elements from other document-level objects. Each animation shows its
name.

### 8.2 Property Sheet

When an animation is selected in the tree:

**Animation section:**
- Name (read-only text)
- Duration (read-only, formatted as seconds)
- Channels (read-only list: "targetNode → targetProperty")

**Playback section:**
- Playing (read-only indicator)
- Paused (read-only indicator)
- Loop (read-only)
- Time Scale (read-only)
- Current Time (read-only, live-updating)
- Play / Pause / Stop buttons (invoke the methods)

Playback controls trigger `anim.play()`, `anim.pause()`,
`anim.stop()` — which mutate the SOM, fire events, and propagate
via the normal AtriumClient pipeline. Remote clients see the
animation start/stop.

---

## 9. Full SOMAnimation API Summary

```javascript
// Intrinsic (read-only, from glTF content)
anim.name             // string
anim.duration         // number (seconds)
anim.channels         // object[] — channel descriptors
anim.samplers         // object[] — sampler descriptors

// Playback state (read-only convenience accessors)
anim.playing          // bool
anim.paused           // bool
anim.loop             // bool
anim.timeScale        // number
anim.startTime        // number (seconds)
anim.startWallClock   // number (ms) or null
anim.pauseTime        // number (seconds) or null

// Computed (read-only, derived live)
anim.currentTime      // number (seconds) — computed from wall clock

// Mutable compound property (fires single mutation event)
anim.playback         // getter/setter — full playback state object

// Methods (write playback atomically)
anim.play({ startTime, loop, timeScale })
anim.pause()
anim.stop()

// Local event driver (called by app frame loop)
anim.tick()               // fires 'timeupdate' if playing and listeners exist

// Events
'mutation'                // fired by playback setter — consumed by AtriumClient
'timeupdate'              // fired by tick() — local only, never on the wire
```

---

## 10. Implementation Sequence

Recommended order for Claude Code:

### Phase 1: Global namespace refactor
1. Add `_objectsByName` Map to `SOMDocument`
2. Add `_registerObject(name, somObject)` with collision warning
3. Register nodes in `_objectsByName` during construction
4. Register `SOMDocument` as `__document__` in `_objectsByName`
5. Add `getObjectByName(name)` method
6. Update server `set` handler to use `getObjectByName`
7. Update AtriumClient `set` handler to use `getObjectByName`
8. Remove `__document__` special-case branching
9. Verify `setPath` works on `SOMDocument` (for extras)
10. Tests: collision detection, `getObjectByName` routing, protocol
    round-trip through the unified lookup

### Phase 2: SOMAnimation core
1. Implement `SOMAnimation` wrapping glTF-Transform `Animation`
2. Read-only `channels` and `samplers` descriptor properties
3. Computed `duration` property
4. `_playback` internal state with default values
5. `playback` getter/setter with mutation event
6. Read-only convenience accessors (`playing`, `paused`, etc.)
7. Computed `currentTime` getter
8. `play()`, `pause()`, `stop()` methods
9. Register animations in `_animationsByName` and `_objectsByName`
10. Add `getAnimationByName(name)` to `SOMDocument`
11. `som.animations` collection accessor
12. `tick()` method with `_hasListeners` guard
13. `timeupdate` event (local only, not consumed by AtriumClient)
14. Tests: playback state transitions, mutation events, currentTime
    computation, name registration, tick/timeupdate firing

### Phase 3: Protocol integration
1. Verify `set` messages with animation names route correctly via
   `getObjectByName`
2. Verify `setPath` works on `SOMAnimation` for `playback` field
3. AtriumClient mutation listener handles `SOMAnimation` mutations
   (sends `set` with animation name)
4. AtriumClient inbound `set` applies `playback` to local SOM
   animation (with `_applyingRemote` guard)
5. Server-side: `set` for animation names updates server SOM
6. `som-dump` serialization includes animation `extras.atrium.playback`
7. Late-joiner reconstruction from `som-dump` animation state
8. Tests: cross-client playback sync, late-joiner catchup, round-trip

### Phase 4: AnimationController
1. Create `AnimationController.js` in `packages/client/src/`
2. Constructor takes `AtriumClient`, listens for `world:loaded`,
   `som:add`, `som:remove`
3. On `world:loaded`: scan `som.animations`, register mutation
   listeners, build `_playing` set
4. Mutation listener on `SOMAnimation` `playback` → emit semantic
   events (`animation:play`, `animation:pause`, `animation:stop`)
5. `tick(dt)`: iterate `_playing` set, call `anim.tick()` on each
6. Late-joiner: emit `animation:play` for animations with
   `playing: true` on initial scan
7. `animation:added` / `animation:removed` events for dynamic
   animations (external refs)
8. Tests: event emission on playback changes, tick drives timeupdate,
   late-joiner auto-play detection, add/remove lifecycle
9. Add import map entry for `@atrium/client/AnimationController`

### Phase 5: Renderer integration
1. `apps/client`: create `AnimationMixer` on `world:loaded`
2. Create `AnimationController`, wire up in frame loop
3. Listen to AnimationController events (`animation:play`, etc.)
4. Map events to Three.js `AnimationAction` calls
5. Late-joiner seek via `animation.currentTime`
6. `mixer.update(dt)` in frame loop
7. SOM Inspector: animation tree entries, property sheet, playback
   controls, live `currentTime` display via `timeupdate` listener

### Phase 6: External reference animations
1. `ingestExternalScene` handles animations from external documents
2. Prefix animation names: `ContainerName/AnimationName`
3. Register external animations in both maps
4. AnimationController picks up new animations via `som:add`
5. Dynamic registration/unregistration

---

## 11. Design Notes and Future Considerations

- **Client wall clock (v1):** `startWallClock` is stamped by the
  originating client's `Date.now()`. Acceptable for v1 — typical
  client-to-client clock skew is tens of milliseconds. For tighter
  sync, the server could stamp `startWallClock` at broadcast time.
  This would be a targeted exception to the server's pass-through
  rule (principle #5). Deferred.

- **Animation end event:** When a non-looping animation reaches
  `duration`, the renderer should fire an event. Whether this
  propagates through the protocol (so all clients know) or is purely
  local is a future design question.

- **Blend weights / animation blending:** Not in scope for v1.
  Multiple animations targeting the same node (e.g., walk + wave)
  would need blending support in the SOM and renderer.

- **Animation grouping / playlists:** Not in scope. Sequential or
  layered animation playback is a future feature.

- **Authored auto-play:** If a glTF file ships with
  `extras.atrium.playback.playing: true`, the client could auto-start
  on load. Behavior TBD — may want an explicit opt-in.

---

## Key Design Principles Applied

1. **SOM is the source of truth** (#7) — playback state lives in the
   SOM, not in the renderer.
2. **glTF is world state** (#9) — playback state serializes to glTF
   `extras`, round-trips through `som-dump`.
3. **Server is policy-free on geometry** (#5) — server passes `set`
   values through without interpreting playback semantics.
4. **Static first, multiplayer second** (#8) — animations play locally
   without a server connection.
5. **`packages/client` is headless** (#10) — no Three.js or browser
   dependency in the playback state model.
6. **Design before code** (#1) — this spec.
