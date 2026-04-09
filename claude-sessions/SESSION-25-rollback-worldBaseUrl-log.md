# Session 25 Rollback Log — Revert `worldBaseUrl` in `hello`
**Date:** 2026-04-08

---

## Why Reverted

The addendum sent `worldBaseUrl` (a `file://` URL derived from `WORLD_PATH`) to clients in the server `hello` message. Browsers cannot fetch `file://` URLs, making the value useless for client-side external reference resolution. The Connect-only flow problem remains open. The correct fix requires the server to know the HTTP URL where world assets are served — which will come from server-side `.atrium.json` consumption in a future design.

---

## Changes Reverted

| File | What was removed |
|------|-----------------|
| `packages/protocol/src/schemas/hello.server.json` | `"worldBaseUrl": { "type": "string" }` field |
| `packages/server/src/world.js` | `worldBaseUrl` from the return object (internal variable retained — server still uses it for its own `file://` fetches in `resolveExternalReferences`) |
| `packages/server/src/session.js` | `worldBaseUrl` spread from `hello` response |
| `packages/client/src/AtriumClient.js` | `worldBaseUrl` handling in `_onServerHello`; parameter renamed back to `_msg` |
| `packages/protocol/test/hello-server.test.js` | Entire file deleted (2 schema tests) |
| `packages/client/tests/AtriumClient.test.js` | 3 `_worldBaseUrl` tests removed |
| `packages/server/tests/external-refs.test.js` | 1 server hello `worldBaseUrl` test removed |

---

## Test Results After Rollback

```
packages/client/tests/*.test.js
packages/som/tests/*.test.js
packages/server/tests/*.test.js
→ 81 tests, 81 pass, 0 fail
```

All Session 25 core tests (server-side external reference resolution, `som-dump` filtering, PropertySheet external reference section) still pass. The 6 addendum tests are gone.

---

## Known Issue Remains Open

"External refs via `som-dump` (connect-only) have no base URL — when a client connects to a server without first loading the world via the URL bar, `_worldBaseUrl` is null and external references cannot resolve."

Fix deferred to server-side `.atrium.json` consumption, which will provide the HTTP URL context clients need.
