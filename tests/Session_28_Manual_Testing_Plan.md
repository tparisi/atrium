# Session 28 Manual Testing Plan
## 2026-04-15

---

## Prerequisites

```bash
cd atrium
pnpm install

# Automated tests first — if these fail, stop and fix before manual testing
pnpm --filter @atrium/protocol test    # expect 43 pass
pnpm --filter @atrium/som test         # expect 103 pass
pnpm --filter @atrium/server test      # expect 32 pass
pnpm --filter @atrium/client test      # expect 65 pass
# Total: 243 pass, 0 fail
```

You'll need two browser tabs, two terminal windows, and a local HTTP
server. If you don't already have one:

```bash
# From the repo root
npx http-server . -p 8080 -c-1
```

---

## Part 1: Regression — Static Browsing (no server)

These tests verify that the `getObjectByName` refactor and animation
wiring didn't break the baseline experience.

### 1.1 Load `space.gltf` (no animations)

1. Open `http://localhost:8080/apps/client/index.html`
2. Enter `http://localhost:8080/tests/fixtures/space.gltf` in URL bar
3. Click Load

**Verify:**
- Scene renders (ground plane, crate, light)
- HUD shows world name
- WASD movement works (click canvas first for focus)
- Drag-to-look works
- M key toggles pointer lock
- Mode dropdown: switch to Orbit → drag orbits, scroll zooms
- Switch back to Walk → avatar on ground, movement works
- No console errors

### 1.2 Load `atrium.gltf` (no animations)

1. Enter `http://localhost:8080/tests/fixtures/atrium.gltf`
2. Click Load

**Verify:**
- Atrium scene renders (columns, fountain, furniture)
- Skybox loads (equirectangular background)
- Navigation works in Walk and Orbit modes

### 1.3 Load `space-anim.gltf` (with animations, static)

1. Enter `http://localhost:8080/tests/fixtures/space-anim.gltf`
2. Click Load

**Verify:**
- Scene renders (same geometry as space.gltf)
- Crate is static (animations start stopped — no `extras.atrium.playback` authored)
- No console errors about animations
- Navigation works normally

### 1.4 Drag-and-drop loading

1. Drag `tests/fixtures/space.gltf` onto the viewport
2. Verify scene loads

**Verify:**
- Scene renders correctly
- No console errors

### 1.5 `.atrium.json` loading

1. Enter `http://localhost:8080/tests/fixtures/space-ext.atrium.json`
2. Click Load

**Verify:**
- World loads with external references (crate, lamp)
- Server field populated but not auto-connected
- No console errors about external ref resolution

---

## Part 2: Regression — Multiplayer (server connected)

These tests verify the `getObjectByName` refactor didn't break the
core multiplayer pipeline, especially the `__document__` path that
was changed to go through `setField` uniformly.

### 2.1 Basic multiplayer

Terminal 1:
```bash
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js
```

1. Open `apps/client/index.html` in Tab A
2. Load `http://localhost:8080/tests/fixtures/space.gltf`
3. Click Connect (ws://localhost:3000)
4. Open `apps/client/index.html` in Tab B
5. Load same world, Connect

**Verify:**
- Both tabs show each other's avatars (capsules)
- Movement in Tab A reflects in Tab B and vice versa
- Peer labels appear above avatars
- HUD shows correct peer count
- V key toggles first/third person in each tab

### 2.2 Disconnect and reconnect

1. In Tab A, click Disconnect
2. Verify Tab A returns to static browsing (scene reloads, avatar gone)
3. Verify Tab B shows peer left (peer count drops)
4. Reconnect Tab A
5. Verify Tab B sees the new peer

### 2.3 SOM Inspector cross-client editing (regression for __document__ refactor)

Terminal 1 (if not already running):
```bash
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js
```

1. Open `apps/client/index.html` in Tab A, Load + Connect
2. Open `tools/som-inspector/index.html` in Tab B, Load + Connect

**Verify node property editing:**
3. In Tab B (Inspector), select the Crate node in the tree
4. Change a material property (e.g., baseColorFactor — change a
   color channel)
5. Verify Tab A (Client) shows the crate color change in real time

**Verify document extras editing (critical — this path was refactored):**
6. In Tab B, expand World Info panel
7. Change the world Name field
8. Verify Tab A's HUD updates with the new world name
9. Change the Description field
10. Verify no errors in either console

**Verify background editing (uses __document__ path):**
11. In Tab B World Info, clear the Background Texture field
12. Verify Tab A's skybox disappears
13. Type `skyboxtest1.png` back in the Texture field
14. Verify Tab A's skybox reappears

This is the most important regression test — the `__document__`
special case was removed from `session.js` and `AtriumClient.js`,
replaced with uniform `getObjectByName` + `setField` routing.

---

## Part 3: Animation — Static (no server)

### 3.1 Console-driven animation test

1. Load `http://localhost:8080/tests/fixtures/space-anim.gltf`
   in `apps/client`
2. Open browser console

```javascript
// Check animations exist in SOM
const som = window.atriumClient.som
console.log('Animations:', som.animations.length)
// Expect: 2

const rotate = som.getAnimationByName('CrateRotate')
const bob = som.getAnimationByName('CrateBob')
console.log('CrateRotate duration:', rotate.duration)
// Expect: 4
console.log('CrateBob duration:', bob.duration)
// Expect: 2

// Verify global namespace
console.log('getObjectByName CrateRotate:', som.getObjectByName('CrateRotate') === rotate)
// Expect: true
console.log('getObjectByName crate-01:', som.getObjectByName('crate-01')?.constructor.name)
// Expect: SOMNode
```

### 3.2 Play animation from console

```javascript
// Play rotation
rotate.play({ loop: true })

// Verify state
console.log('playing:', rotate.playing)       // true
console.log('loop:', rotate.loop)             // true
console.log('currentTime:', rotate.currentTime) // small positive number
```

**Verify visually:** Crate rotates smoothly around Y axis.

### 3.3 Pause and resume

```javascript
rotate.pause()
console.log('paused:', rotate.paused)         // true
console.log('pauseTime:', rotate.pauseTime)   // positive number
```

**Verify visually:** Crate stops mid-rotation.

```javascript
// Resume from pause
rotate.play({
  startTime: rotate.pauseTime,
  loop: true,
  timeScale: rotate.timeScale
})
```

**Verify visually:** Crate resumes from where it paused.

### 3.4 Stop

```javascript
rotate.stop()
console.log('playing:', rotate.playing)   // false
console.log('paused:', rotate.paused)     // false
```

**Verify visually:** Crate returns to original orientation.

### 3.5 Play second animation

```javascript
bob.play({ loop: true })
```

**Verify visually:** Crate bobs up and down.

### 3.6 Both animations simultaneously

```javascript
rotate.play({ loop: true })
bob.play({ loop: true })
```

**Verify visually:** Crate rotates AND bobs at the same time.
(Both animations target different properties on the same node —
rotation vs translation — so they should compose.)

### 3.7 TimeScale

```javascript
rotate.stop()
bob.stop()
rotate.play({ loop: true, timeScale: 3.0 })
```

**Verify visually:** Crate rotates 3x faster.

---

## Part 4: Animation — Multiplayer

### 4.1 Cross-client animation sync

Terminal 1:
```bash
cd packages/server
WORLD_PATH=../../tests/fixtures/space-anim.gltf node src/index.js
```

1. Open `apps/client/index.html` in Tab A, Load + Connect
2. Open `apps/client/index.html` in Tab B, Load + Connect

In Tab A console:
```javascript
const anim = window.atriumClient.som.getAnimationByName('CrateRotate')
anim.play({ loop: true })
```

**Verify:**
- Tab A: crate rotates
- Tab B: crate also rotates (received via `set` message)
- Both crates are approximately in sync (small latency ok)

### 4.2 Pause propagation

In Tab A console:
```javascript
window.atriumClient.som.getAnimationByName('CrateRotate').pause()
```

**Verify:**
- Tab A: crate stops
- Tab B: crate also stops at approximately the same position

### 4.3 Stop propagation

In Tab A console:
```javascript
window.atriumClient.som.getAnimationByName('CrateRotate').stop()
```

**Verify:**
- Both tabs: crate resets to original orientation

### 4.4 Late-joiner sync

1. In Tab A console:
```javascript
window.atriumClient.som.getAnimationByName('CrateRotate').play({ loop: true })
```
2. Wait 2-3 seconds (let it run)
3. Open Tab C, load same world, Connect

**Verify:**
- Tab C joins and crate is already rotating
- Tab C's crate is approximately in sync with Tab A and Tab B
  (computed from `startWallClock` — may be slightly off due to
  client clock differences, this is expected for v1)

### 4.5 SOM Inspector animation controls

1. Keep server running with `space-anim.gltf`
2. Open `tools/som-inspector/index.html` in a new tab
3. Load `http://localhost:8080/tests/fixtures/space-anim.gltf`
4. Connect

**Verify Animations panel:**
- Panel shows two animations: CrateRotate, CrateBob
- Duration displayed for each (4.00s and 2.00s)
- Play/Pause/Stop buttons visible

**Test controls:**
5. Click Play on CrateRotate
6. Verify: crate rotates in Inspector viewport AND in any connected
   `apps/client` tabs
7. Verify: current time display updates live
8. Click Pause → crate stops, time display freezes
9. Click Play again → crate resumes
10. Click Stop → crate resets

**Test cross-client control:**
11. In an `apps/client` tab console, play CrateBob:
```javascript
window.atriumClient.som.getAnimationByName('CrateBob').play({ loop: true })
```
12. Verify: Inspector shows CrateBob playing (button states update,
    time display advances)

---

## Part 5: Edge Cases

### 5.1 Load world without animations while animation is playing

1. Start with `space-anim.gltf` loaded, CrateRotate playing
2. Load `space.gltf` (no animations) via URL bar

**Verify:**
- Scene switches cleanly to space.gltf
- No console errors about missing animations or null mixer
- AnimationController teardown works (Fix 2)

### 5.2 World reload while connected

1. Connect to server running `space-anim.gltf`
2. Play an animation
3. Click Disconnect

**Verify:**
- Scene reloads in static mode
- Animation state is clean (not playing)
- No console errors

### 5.3 Load non-animated world then switch to animated

1. Load `space.gltf` (no animations)
2. Then load `space-anim.gltf`

**Verify:**
- Animations available in second world
- Console: `som.animations.length` is 2
- Play works normally

---

## Part 6: External References with Animation World

### 6.1 External refs still work

Terminal:
```bash
cd packages/server
WORLD_PATH=../../tests/fixtures/space-ext.atrium.json node src/index.js
```

1. Open `apps/client`, load
   `http://localhost:8080/tests/fixtures/space-ext.atrium.json`
2. Connect

**Verify:**
- External references resolve (crate, lamp visible)
- Multiplayer works
- No regressions from `getObjectByName` change in server `setField`

---

## Checklist Summary

| # | Test | Result |
|---|------|--------|
| 1.1 | Static load space.gltf | |
| 1.2 | Static load atrium.gltf | |
| 1.3 | Static load space-anim.gltf | |
| 1.4 | Drag-and-drop load | |
| 1.5 | .atrium.json load | |
| 2.1 | Basic multiplayer | |
| 2.2 | Disconnect/reconnect | |
| 2.3 | Inspector cross-client node editing | |
| 2.3 | Inspector __document__ extras editing | |
| 2.3 | Inspector background hot-reload | |
| 3.1 | SOM animation objects exist | |
| 3.2 | Play from console | |
| 3.3 | Pause and resume | |
| 3.4 | Stop | |
| 3.5 | Second animation | |
| 3.6 | Both animations simultaneously | |
| 3.7 | TimeScale | |
| 4.1 | Cross-client animation sync | |
| 4.2 | Pause propagation | |
| 4.3 | Stop propagation | |
| 4.4 | Late-joiner sync | |
| 4.5 | Inspector animation controls | |
| 5.1 | Switch from animated to non-animated world | |
| 5.2 | Disconnect during animation | |
| 5.3 | Switch from non-animated to animated world | |
| 6.1 | External refs still work | |
