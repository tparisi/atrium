# Session 25 Rollback — Revert `worldBaseUrl` in `hello` Addendum

## Context

The addendum added `worldBaseUrl` to the server→client `hello` message.
The server derived this from `WORLD_PATH` via `pathToFileURL`, which
produces a `file://` URL. Browsers cannot fetch `file://` URLs, so the
value is useless to clients — external reference resolution still fails
on Connect-only flows.

The correct solution requires the server to know the HTTP URL where the
world assets are served, which will come from `.atrium.json` consumption
by the server (a separate, future design). Reverting the addendum
changes cleanly until that design is ready.

## What to Revert

Roll back all changes from the addendum log. Specifically:

### `packages/protocol/src/schemas/hello.server.json`
- Remove the `worldBaseUrl` field

### `packages/server/src/world.js`
- Remove `worldBaseUrl` from the return object (the internal
  `worldBaseUrl` variable used by the server's own
  `resolveExternalReferences` should remain — the server still needs
  it for its own `file://` fetches)

### `packages/server/src/session.js`
- Remove `worldBaseUrl` from the `hello` response

### `packages/client/src/AtriumClient.js`
- Remove the `worldBaseUrl` handling from `_onServerHello`

### Tests to remove
- `packages/protocol/test/hello-server.test.js` — remove the 2
  `worldBaseUrl` schema tests
- `packages/client/tests/AtriumClient.test.js` — remove the 3
  `_worldBaseUrl` tests added in the addendum
- `packages/server/tests/external-refs.test.js` — remove the 1
  server hello `worldBaseUrl` test

## After Rollback

Run full test suite across all packages. All tests from the main
Session 25 work (server-side external reference resolution, `som-dump`
filtering, PropertySheet external reference section) should still pass.
Only the 6 addendum tests should be gone.

## Known Issue Remains Open

"External refs via `som-dump` (connect-only) have no base URL" stays
in the known issues list. The fix will come via `.atrium.json`
consumption by the server, which provides the HTTP URL context that
clients need.
