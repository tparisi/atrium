# Atrium — Session 12 Brief
## Protocol: add `seq` to `view` message schema

---

## Background

During manual testing of `apps/client`, outgoing `view` messages were being
rejected by Ajv validation. The `view` message schema was missing the `seq`
property. All other message types define `seq` — it was an oversight when
the `view` schema was originally written.

The fix was confirmed by hand: removing `seq` from the outgoing `view`
message in `AtriumClient` stopped the validation errors. The correct fix is
to add `seq` to the schema so `AtriumClient` can send it as designed.

---

## Change Required

In `packages/protocol`, add `seq` to the `view` message schema with the same
definition and required status as all other message types.

No other packages change.

---

## Tests

Add tests to `packages/protocol` covering the `view` message schema:

- A valid `view` message **with** `seq` passes validation
- A `view` message **without** `seq` fails validation

Follow the existing test patterns in `packages/protocol/tests/`.

---

## Acceptance Criteria

- `view` messages with `seq` pass Ajv validation
- All 104 existing tests still pass
- New test count: 104 + 2 = 106 (minimum — more is fine if additional
  `view` message cases are worth covering)

---

## Note

Manual fixes already applied to `apps/client` and `packages/som` during
this testing session — do not touch those:

- `document` getter added to `SOMDocument`
- Spurious `docView.render()` call removed from `apps/client`
- `docView.view()` corrected to pass `somDocument.document.getRoot().listScenes()[0]`

These are intentional and correct. Do not revert or modify them.
