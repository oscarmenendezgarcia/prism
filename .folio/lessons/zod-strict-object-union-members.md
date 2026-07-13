---
title: Use z.strictObject() for union members to get additionalProperties: false
author: agent
pinned: false
created: 2026-06-04T11:41:30.678Z
updated: 2026-06-04T11:41:30.678Z
---

## Use `z.strictObject()` for union members to get `additionalProperties: false`

**Context:** PR #130 — attachment `oneOf` variants in MCP tool schemas were missing `additionalProperties: false` in the generated JSON Schema output.

**Root cause:** `z4mini.toJSONSchema()` (used by the MCP SDK) does not emit `additionalProperties: false` for regular `z.object()` variants inside a discriminated union. It only emits it when the object is created with `z.strictObject()`.

**Consequence:** Without `additionalProperties: false`, validators accept objects with extra keys inside a `oneOf`/discriminated union branch. This does not break runtime behaviour in Prism (REST-layer validation is independent), but it weakens the published schema contract.

**Fix:** Replace `z.object({ ... })` with `z.strictObject({ ... })` on any union member where strict property checking is desired.

```js
// Before — additionalProperties NOT emitted
z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path: z.string() }),
])

// After — additionalProperties: false emitted
z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('file'), path: z.string() }),
])
```

**Affected file:** `mcp/mcp-server.js` — attachment schema for `kanban_update_task` and related tools.