# Atrium

**A glTF browser with multiplayer.**

Point it at any `.gltf` file and it renders. Point it at one with a world
server behind it and you're in a shared space with other people. The rest
is details.

---

## Why Atrium Exists

The Metaverse has been promised many times. It has also been claimed many
times — by platforms, by corporations, by walled gardens that would happily
own your identity, your content, and your social graph in exchange for a
compelling experience.

Tony Parisi has been building the foundations of the 3D web since
co-creating VRML in the 1990s and co-authoring the glTF standard. In 2021
he wrote [The Seven Rules of the Metaverse](https://medium.com/meta-verses/the-seven-rules-of-the-metaverse-7d4e06fa864c) —
a framework distilled from decades of practice.

Atrium is an attempt to build something that actually follows those rules.

---

## Design Principles

**The browser model.** Atrium should feel like a browser, not a platform.
You navigate to a world, it loads, you're there. No account required to
view. No app to install. Graceful degradation — if the world server is
unreachable, the scene still renders. Static first, multiplayer second.

**Open formats all the way down.** The content format is glTF 2.0 — an
open standard maintained by the Khronos Group, already the lingua franca
of 3D on the web. A world you build in Atrium is a `.gltf` file you own,
readable by any glTF tool, renderable by any glTF viewer. The wire protocol
is documented and schema-validated. Nothing is proprietary.

**glTF on the wire.** The multiplayer protocol carries glTF node descriptors
directly — the same format as the world file. No translation layer, no
impedance mismatch. Every tool in the stack that speaks glTF speaks the
protocol for free. SOM is the live API surface over that glTF document —
serializing the Document serializes the world, avatar nodes and all.

**Validate everything.** Every message in and out is validated against the
SOP JSON schemas. The schema is the contract. Invalid messages never touch
world state. This applies on both ends — the server validates client
messages, the client validates server messages.

**Default to the obvious thing, make the non-obvious thing explicit.**
Protocol fields have sensible defaults. Extensions are opt-in. Future
capability is reserved with escape hatches rather than locked out.

**Renderer-neutral core.** `@atrium/client` has no `window`, no `document`,
no Three.js — portable across browser UI, headless tests, and bot clients.
Renderer-specific glue lives in its own package. The bridge pattern is the
single seam where renderer, DOM, and client meet. Future non-Three
renderers consume the same client API.

**Interaction as policy, not mechanism.** Selection rules, drag conventions,
gestures — these are policy decisions that vary by application. They live
in `@atrium/interaction`, separate from the client and renderer packages,
which expose only mechanism. Apps compose policy over mechanism.

**No throwaway code.** Every line written is tested against the real
implementation. No fake stubs, no mock world state. Tests run against the
actual glTF-Transform Document, the actual WebSocket server, the actual
protocol schemas.

**Incremental correctness.** Each layer is fully working and tested before
the next is built on top of it. Session lifecycle before world state. World
state before presence. Presence before rendering. Mechanism before policy.
You can always run what exists.

---

## How It Works

Atrium has three layers:

**The content layer** is standard glTF 2.0. A world is a `space.gltf` file
with Atrium metadata in `extras.atrium`. Any glTF viewer can render it.
Any glTF tool can edit it. The Atrium client is a glTF browser — it renders
what it finds, whether or not a world server is present.

**The protocol layer** is SOP — the Scene Object Protocol. A lightweight
WebSocket protocol for multiplayer world state. Clients connect, mutate the
shared scene graph via `send`/`add`/`remove`, and receive authoritative
updates as `set` broadcasts. Presence is tracked via `join` and `leave`.
Newly connecting clients receive the full current world via `som-dump`.
The full protocol is defined in JSON Schema in `@atrium/protocol`.

**The runtime layer** is the Atrium server and client, built on top of SOM
— the Scene Object Model. SOM is a DOM-inspired API layer over
glTF-Transform: it wraps the live Document and exposes nodes, meshes,
cameras, materials, and animations through typed accessors, fires mutation
events, and provides a `setPath()` deep-mutation primitive. The server owns
the authoritative scene graph via SOM; the client mirrors it and feeds it
into Three.js through DocumentView. Both sides speak the same API — the
same code that mutates a node on the server mutates a node in the client
renderer. SOM nodes also dispatch pointer events, providing a DOM-like
interaction surface that's renderer-agnostic.

---

## What's in the Repo

```
atrium/
├── packages/
│   ├── protocol/         # SOP message schemas (JSON Schema) + Ajv validator
│   ├── som/              # Scene Object Model — DOM-inspired API over glTF-Transform
│   ├── server/           # WebSocket world server (Node.js + glTF-Transform)
│   ├── client/           # AtriumClient — protocol, SOM sync, pointer dispatch (no UI, no renderer)
│   ├── renderer-three/   # Three.js glue — PointerInputBridge, drag-math, hit-test
│   ├── interaction/      # User interaction policy — selection model, future drag UX & gestures
│   └── gltf-extension/   # ATRIUM_world glTF extension definition [coming]
├── apps/
│   ├── client/           # Browser UI shell — Three.js viewport, navigation, avatars
│   └── playground/       # Pointer-event test bench
├── tools/
│   ├── protocol-inspector/   # Single-file interactive protocol debugger
│   └── som-inspector/        # Live SOM tree, property sheet, animations panel, viewport edit
├── tests/
│   ├── client/           # Legacy protocol-level test client
│   └── fixtures/         # space, atrium, space-ext, space-anim, space-anim-autoplay
└── docs/
    └── sessions/         # Design briefs and session logs — the build history
```

The repo ships with working server, protocol, SOM, client, renderer, and
interaction packages, a suite of test world fixtures, two browser-based
debugging tools, the Atrium browser app, and a pointer-event playground.
Tests cover protocol validation, session lifecycle, world state mutations,
presence, the SOM API and event system, AtriumClient lifecycle, animation
playback, the Three.js bridge, and selection-root resolution.

This is a foundation, not a finished product. Pointer-event bubbling, the
networked interactivity extension, drag-UX polish, the object type
registry, physics, and persistence are all ahead. The architecture is
designed to support them cleanly. We want a thousand flowers to bloom — if
you want to build a client in a different renderer, implement SOP in
another language, or extend the protocol, everything you need to understand
the system is here.

---

## Getting Started

```bash
# clone and install
git clone https://github.com/tparisi/atrium.git
cd atrium
pnpm install

# run package tests
pnpm --filter @atrium/protocol test
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test         # see note below
pnpm --filter @atrium/client test
pnpm --filter @atrium/renderer-three test
pnpm --filter @atrium/interaction test

# start a world server
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# or load a world via .atrium.json manifest
WORLD_PATH=../../tests/fixtures/space-ext.atrium.json node src/index.js

# open the Atrium browser app (static, no build step)
open apps/client/index.html
# → enter a .gltf URL, click Load to render statically
# → enter ws://localhost:3000 and click Connect for multiplayer

# open the SOM inspector — live tree, property sheet, viewport edit
open tools/som-inspector/index.html

# open the protocol inspector — low-level SOP debugger
open tools/protocol-inspector/index.html

# open the pointer playground
open apps/playground/index.html
```

The browser app loads any `.gltf` file and renders it. With a server
running, click Connect to go multiplayer — move around and see other
users' avatars. The SOM Inspector lets you click nodes in the viewport,
edit their properties live, and drag them around — mutations broadcast to
all connected clients.

> **Note on server tests.** Individual server test files run cleanly
> (~38 tests across avatar, presence, world, session, external-refs).
> The batched `pnpm --filter @atrium/server test` currently hangs because
> `session.test.js` doesn't tear down its WebSocket port between files —
> a small harness fix on the to-do list. Run files individually for now.

---

## Status

| Layer | Status |
|---|---|
| Protocol schemas (`@atrium/protocol`) | ✅ Complete |
| Server session lifecycle, presence, world state (`@atrium/server`) | ✅ Complete |
| SOM — Scene Object Model (`@atrium/som`) | ✅ Complete |
| SOM mutation events + DOM-style listener API | ✅ Complete |
| Global SOM namespace (`getObjectByName`) | ✅ Complete |
| SOMAnimation — full playback state machine + `autoStart` | ✅ Complete |
| AtriumClient (`@atrium/client`) — connection, SOM sync, animation lifecycle | ✅ Complete |
| AtriumClient — pointer dispatch + capture + hover state | ✅ Complete |
| External references (`extras.atrium.source`) | ✅ Complete |
| `apps/client` — full UI, navigation, avatars, animation integration | ✅ Complete |
| `apps/playground` — pointer test bench | ✅ Complete |
| SOM Inspector — tree, property sheet, world info, animations panel | ✅ Complete |
| SOM Inspector — click-to-select, drag-to-translate, live cross-client editing | ✅ Complete |
| `@atrium/renderer-three` — PointerInputBridge, drag-math, hit-test | ✅ Complete |
| `@atrium/interaction` — selection model + selection-root resolution | ✅ Complete |
| Pointer event bubbling | 🔜 Session 36+ (design-first) |
| Drag UX polish (camera-relative, axis-locked, visual feedback) | 🔜 Upcoming |
| `ATRIUM_interactivity` — networked declarative interactivity | 🔜 Awaits bubbling |
| `ATRIUM_world` glTF extension formalization | 🔜 Upcoming |
| `ATRIUM_user_object` — User Object Extensions | 🔜 Upcoming (design open) |
| Physics, collision | 🔜 Future |
| Persistence | 🔜 Future |

---

## License

MIT. Copyright © 2026 Tony Parisi / Metatron Studio.
