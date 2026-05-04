# @atrium/interaction

User-interaction policy for Atrium. Pure utilities and conventions for how
user input maps to world mutations and selection state.

## Coherence criterion

This package houses **user-interaction policy**: logic that sits between raw
pointer/keyboard events and SOM mutations. It is the canonical home for
anything that answers "given this input, what does the user mean?"

## In scope

- Selection policies — given a hit leaf, which SOM node is the selection target
- Drag math, axis locks, modifier conventions (future)
- Gesture conventions — single-click vs double-click, modifier semantics (future)
- Multi-selection state and policy (future)
- Visual-feedback *policy* — what should be highlighted, when (future)

## Out of scope

- **No mechanism.** Connection, dispatch, sync live in `@atrium/client`.
  The pointer bridge lives in `@atrium/renderer-three`.
- **No rendering.** Visual-feedback policy may live here; meshes/materials/shaders
  that implement highlight live in renderer-specific packages.
- **No app-shell concerns.** Layout, panels, HUD live in `apps/` and `tools/`.
- **No protocol.** If selection ever becomes shared state, the wire format goes in
  `@atrium/protocol`. `@atrium/interaction` does not grow a network layer.
- **No AtriumClient dependency.** Apps depend on both; the packages do not.

## Dependency rule

```
@atrium/interaction  →  @atrium/som
@atrium/interaction  ✗  @atrium/client
@atrium/client       ✗  @atrium/interaction
```

If a future feature would require AtriumClient to import from
`@atrium/interaction`, that is a signal the design is wrong.

## API

### `nearestNonMeshAncestor(leaf: SOMNode): SOMNode`

Walk up from `leaf` to the nearest ancestor that has no mesh. Returns that
ancestor, or `leaf` itself if no such ancestor exists before the scene root.

This implements the "lamp heuristic": clicking any mesh child of a compound
object (e.g. lamp-shade or lamp-stand) resolves to the group parent (lamp-01).

### `leafOnly(leaf: SOMNode): SOMNode`

Returns `leaf` unchanged. Use as `policy` option when you want direct selection.

### `resolveSelectionRoot(leaf, options?): SOMNode`

```js
resolveSelectionRoot(leaf, {
  policy = nearestNonMeshAncestor,  // selection policy function
  descend = false,                  // if true, return leaf (Alt-click escape)
} = {})
```

Wrapper that applies a policy with a modifier-key escape hatch. Pass
`descend: event.detail.altKey` to give users a way to select individual parts
of a compound object.
