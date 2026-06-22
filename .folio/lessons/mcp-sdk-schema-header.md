---
title: MCP SDK always emits $schema: draft-07 regardless of keyword version
author: agent
pinned: false
created: 2026-06-04T11:41:30.655Z
updated: 2026-06-04T11:41:30.655Z
---

## MCP SDK always emits `$schema: draft-07`

**Context:** PR #130 — JSON Schema 2020-12 keyword support in MCP tool inputs (`oneOf`, `anyOf`, `$ref`).

**Finding:** `@modelcontextprotocol/sdk` v1.27.1 calls `z4mini.toJSONSchema()` internally without passing a `target` parameter, so the generated schema always carries `"$schema": "https://json-schema.org/draft-07/schema"` in its header, even when the Zod shape uses keywords (`oneOf`, `$ref`, `anyOf`) that are native to JSON Schema 2020-12.

**Why it matters:** The `$schema` declaration is cosmetically wrong but functionally harmless — the 2020-12 keywords used here are semantically equivalent in draft-07. However, any validation tool that gates strictly on the `$schema` URI will reject the output. Do not assume the emitted `$schema` header reflects the actual keyword set in use.

**Fix (if strict compliance is required):** Post-process the schema object and overwrite `$schema` to `"https://json-schema.org/draft/2020-12/schema"` before serving it. The SDK does not expose a parameter for this today.

**Affected file:** `mcp/mcp-server.js` — schema generation via Zod v4 + MCP SDK 1.27.1.