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

**No throwaway code.** Every line written is tested against the real
implementation. No fake stubs, no mock world state. Tests run against the
actual glTF-Transform Document, the actual WebSocket server, the actual
protocol schemas.

**Incremental correctness.** Each layer is fully working and tested before
the next is built on top of it. Session lifecycle before world state. World
state before presence. Presence before rendering. You can always run what
exists.

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
The full protocol is defined in JSON Schema in `@atrium/protocol`.

**The runtime layer** is the Atrium server and client, built on top of SOM
— the Scene Object Model. SOM is a DOM-inspired API layer over
glTF-Transform: it wraps the live Document and exposes nodes, meshes,
cameras, materials, and animations through typed accessors and a
`setPath()` deep-mutation primitive. The server owns the authoritative
scene graph via SOM; the client mirrors it and feeds it into Three.js
through DocumentView. Both sides speak the same API — the same code that
mutates a node on the server mutates a node in the client renderer.

---

## What's in the Repo

```
atrium/
├── packages/
│   ├── protocol/        # SOP message schemas (JSON Schema) and Ajv validator
│   ├── som/             # Scene Object Model — DOM-inspired API over glTF-Transform
│   ├── server/          # WebSocket world server (Node.js + glTF-Transform)
│   ├── client/          # Browser client (Three.js + DocumentView) [coming]
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── tools/
│   └── protocol-inspector/   # Single-file interactive protocol debugger
├── tests/
│   └── fixtures/
│       └── space.gltf   # Minimal world fixture used by server tests
└── docs/
    └── sessions/        # Claude Code session briefs — the build history
```

The repo ships with working server, protocol, and SOM packages, a test world
fixture, and a browser-based protocol inspector that lets you connect to
a running server, send any SOP message, and watch the exchange in real time.
There are 92 passing tests covering protocol validation, session lifecycle,
world state mutations, presence, and the SOM API.

This is a foundation, not a finished product. The client renderer, the
object type registry, avatar embodiment, physics, and persistence are all
ahead. The architecture is designed to support them cleanly. We want a
thousand flowers to bloom — if you want to build a client in a different
renderer, implement SOP in another language, or extend the protocol,
everything you need to understand the system is here.

---

## Getting Started

```bash
# clone and install
git clone https://github.com/tparisi/atrium.git
cd atrium
pnpm install

# run the tests
pnpm --filter @atrium/protocol test
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test

# start a world server
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# open the protocol inspector (from repo root)
open tools/protocol-inspector/index.html
```

Connect the inspector to `ws://localhost:3000`, send a `hello`, and watch
the world come alive.

---

## Status

| Layer | Status |
|---|---|
| Protocol schemas (`@atrium/protocol`) | ✅ Complete |
| Server session lifecycle (`@atrium/server`) | ✅ Complete |
| World state — glTF-Transform + send/set/add/remove | ✅ Complete |
| Presence — join/leave | ✅ Complete |
| SOM — Scene Object Model (`@atrium/som`) | ✅ Complete |
| Avatar nodes — SOM lifecycle, connect/disconnect | ✅ Complete |
| NavigationInfo — mode, speed, updateRate | ✅ Complete |
| Client renderer — Three.js | 🔄 In progress |
| glTF extension (`@atrium/gltf-extension`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming |
| Physics | 🔜 Upcoming |
| Persistence | 🔜 Upcoming |

---

## License

MIT. Copyright © 2026 Tony Parisi / Metatron Studio.
