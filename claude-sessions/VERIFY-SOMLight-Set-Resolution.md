# Project Atrium — Pre-Brief Verification: `set`-Resolution Path for Non-Node Objects

## Task type: Code-reading only. No changes to any file.

This task is the pre-brief verification gate for the `SOMLight` implementation
brief. It confirms (or corrects) the assumption that `set` message routing is a
single uniform `getObjectByName` Map lookup with no special-casing for non-node
SOM types — an assumption the `SOMLight` wire-address design depends on.

One live analog already exists: `SOMMaterial` / avatar `baseColorFactor` is a
non-node SOM object whose properties are wire-mutated today. Tracing that path
end-to-end is the primary verification method.

**Output of this task:** a short findings report (see §5) written as a markdown
file at `docs/sessions/VERIFY-SOMLight-Set-Resolution-findings.md`. No code
changes. No new tests. Read and report only.

---

## 1. Background (read before starting)

The `SOMLight` naming design (`DESIGN-SOMLight-Naming.md`) specifies that a
light named `"Sun"` on a node named `"Sun"` is wire-addressed as `"Sun.light"`:

```json
{ "type": "set", "node": "Sun.light", "field": "intensity", "value": 0.8, "seq": 57 }
```

For this to work, the `node` field must resolve via a single
`getObjectByName("Sun.light")` Map lookup — the same path used today for nodes
(`"Crate"`) and animations (`"WalkCycle"`). The design assumes this path is
genuinely uniform for any named SOM object regardless of type.

That assumption was **not verified against the live code** when the design was
written. This task verifies it. If the path is uniform, the brief proceeds as
designed. If there is non-node special-casing anywhere, the wire design must
mirror what the code actually does instead.

---

## 2. Files to read

Read these files in order. For each, answer the specific questions in §3.

```
packages/protocol/src/           # schema definitions, Ajv validator
packages/server/src/             # server message handler(s)
packages/client/src/AtriumClient.js
packages/som/src/SOMDocument.js  # getObjectByName, _objectsByName
packages/som/src/SOMMaterial.js  # the live non-node analog
```

If the server has a single message-dispatch entry point (e.g. `handleMessage`,
`onMessage`, a `switch` on `msg.type`), locate it first — it is the likely home
of the `set` handler.

---

## 3. Questions to answer

### 3.1 Protocol schema (`packages/protocol/src/`)

1. What is the JSON Schema definition for a `set` message? Specifically: what
   type/constraints does the schema place on the `node` field? Is it `string`
   with no pattern restriction, or does it constrain the value in any way (e.g.
   a pattern, an enum, a `$ref` to a named-node registry)?
2. Would a dotted string like `"Sun.light"` or `"MainCamera.camera"` pass Ajv
   validation under the current schema, or would it be rejected?
3. What does the schema say about the `field` and `value` fields of `set`? Is
   `value` typed (e.g. only accepts certain shapes) or is it open (`{}`)?
   Note any constraints that would need extending to accept light property
   values (color arrays, numbers, null for `range`).

### 3.2 Server `set` handler

4. Locate the server-side handler for inbound `set` messages. Paste the
   relevant code block (the handler itself — not the full file).
5. How does the server resolve the `node` field to a SOM object? Does it call
   `som.getObjectByName(msg.node)` directly, or does it do anything else
   (e.g. `getNodeByName`, a type check, a branch on object type)?
6. After resolution: does the handler apply the mutation differently depending
   on whether the resolved object is a node, an animation, or something else?
   Or does it call a uniform method (e.g. `som.setPath(obj, field, value)`)?
7. What happens when `getObjectByName` returns null (name not found)? Does the
   server send an error, silently drop the message, or something else?

### 3.3 AtriumClient `set` handler

8. Locate the client-side handler for inbound `set` messages (server → client
   broadcast). Paste the relevant code block.
9. Same questions as 3.2 items 5–7 for the client path: resolution method,
   any type-branching after resolution, null handling.
10. Does the client apply the mutation to its own SOM copy via the same
    `getObjectByName` path, or does it have a separate resolution mechanism?

### 3.4 `SOMMaterial` as the live non-node analog

11. Open `packages/som/src/SOMMaterial.js`. Does `SOMMaterial` extend
    `SOMObject`? Does it register itself in `_objectsByName` at construction
    time? If so, how (show the relevant line)?
12. Locate where avatar `baseColorFactor` is mutated in practice — likely in
    `AvatarController.js` or a test. Show how the mutation flows: is it a
    direct `material.baseColorFactor = value` that fires a `mutation` event,
    which AtriumClient picks up and sends as a `set` message with the
    material's registered name in the `node` field?
13. On the receiving end, when that `set` message arrives with the material's
    name in `node`: does `getObjectByName` return the `SOMMaterial` wrapper,
    and does `som.setPath(material, 'baseColorFactor', value)` (or equivalent)
    apply it? Confirm the path is identical to the node/animation path.

### 3.5 `getObjectByName` implementation

14. In `SOMDocument.js`, show the implementation of `getObjectByName`. Is it
    a direct Map lookup (`this._objectsByName.get(name)`)? Any fallback logic?
15. Show how SOM types are registered into `_objectsByName` at construction.
    Which types are currently registered (nodes, animations, materials, meshes,
    others)? Are there any types that are *not* registered?

---

## 4. Specific failure modes to watch for

While reading, flag any of the following if found:

- **Type-gating on `node` resolution:** server or client checks
  `instanceof SOMNode` (or similar) after `getObjectByName`, and rejects or
  routes differently for non-node types.
- **`getNodeByName` used instead of `getObjectByName`:** would silently return
  null for a light or material.
- **Protocol schema pattern restriction on `node`:** a regex or format that
  would reject `"Sun.light"` (dotted) or `"Chair/Body"` (slashed — these
  already work, so if slashed passes, dotted almost certainly will too, but
  confirm).
- **`som.setPath` type-branching:** if `setPath` dispatches differently by
  object type rather than being a uniform property-setter call.
- **SOMMaterial not in `_objectsByName`:** if materials are not registered by
  name, they cannot be the live wire-mutation analog, and the verification
  must find a different existing analog or conclude none exists.

---

## 5. Output: findings report

Write the findings as `docs/sessions/VERIFY-SOMLight-Set-Resolution-findings.md`.

Structure:

```
# SOMLight Pre-Brief Verification — Findings

## Verdict
CONFIRMED / NEEDS AMENDMENT / INCONCLUSIVE
(one line summary)

## 3.1 Protocol schema
...answers to questions 1–3, with relevant schema snippet...

## 3.2 Server set handler
...answers to questions 4–7, with the handler code block...

## 3.3 AtriumClient set handler
...answers to questions 8–10, with the handler code block...

## 3.4 SOMMaterial as live analog
...answers to questions 11–13...

## 3.5 getObjectByName implementation
...answers to questions 14–15...

## Failure modes found
NONE / list any found with file + line reference

## Implications for the SOMLight brief
- If CONFIRMED: "set resolution is uniform for non-node objects; the
  SOMLight wire design proceeds as specified in DESIGN-SOMLight-Naming.md."
- If NEEDS AMENDMENT: describe exactly what the brief must do differently
  and why (cite the specific file + behavior that differs from the assumption).
- If INCONCLUSIVE: describe what could not be determined and what a follow-up
  read would need to find.
```

Keep the report concise — this is a verification artifact, not a design
document. The code blocks for the two handlers (server + client) are the
most important content; do not omit them.

---

## 6. What this task is not

- **No code changes.** Read only.
- **No new tests.** Those belong in the implementation brief.
- **Do not verify late-joiner sync** (whether `som-dump` carries mutated light
  values to a fresh client). That requires a running server and two browser
  windows; it belongs in the implementation session's smoke plan, not here.
- **Do not verify `@atrium/protocol` value-schema completeness** for light
  fields (`range: null`, color arrays, etc.). That is scoped as a
  touched-package call-out in the brief; it does not block the pre-brief read.
- **Do not modify any existing tests or fixtures.**
- **Do not run the server or browser.** Static code reading only.

---

## 7. Definition of done

The task is complete when:

1. All fifteen questions in §3 are answered in the findings report.
2. The "Failure modes found" section explicitly says NONE or lists specific
   instances with file + line references.
3. The "Implications for the SOMLight brief" section states a clear verdict
   and next action.
4. The findings file exists at
   `docs/sessions/VERIFY-SOMLight-Set-Resolution-findings.md`.
5. No files other than the findings report have been created or modified.
