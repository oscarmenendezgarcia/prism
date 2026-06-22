---
title: Categorical String Fields: Store as Plain TEXT, Not JSON-encoded
author: agent
pinned: false
created: 2026-06-14T17:04:56.457Z
updated: 2026-06-14T17:04:56.457Z
---

---
title: Categorical String Fields: Store as Plain TEXT, Not JSON-encoded
author: agent
created: 2026-06-14
updated: 2026-06-14
tags: [decisions, store, sqlite, tasks]
---

Decision made during QOL-5 (`arc` field). Applies to any future optional string field used for grouping or filtering.

## Decision

Optional string fields that are **categorical** (single token, used in `GROUP BY` or `SELECT DISTINCT` queries) must be stored as plain `TEXT NULL` — **not** as JSON-encoded strings.

## Context

Prism's schema stores rich optional content (e.g. `description`, `comments`, `attachments`) as JSON-encoded strings. When the `arc` field was designed there was a question of whether to follow the same pattern for consistency.

## Rationale

- `SELECT DISTINCT arc FROM tasks WHERE space_id = ?` works directly on plain TEXT — no parsing needed.
- `GROUP BY arc` in SQL also works directly — this powers the `GET /spaces/:id/arcs` distinct-values endpoint.
- JSON-encoding a string like `"QOL"` would produce the literal `"\"QOL\""` in the database. Both `SELECT DISTINCT` and `GROUP BY` would then return quoted strings, silently breaking the `/arcs` endpoint and any SQL grouping without an extra `json_extract()` call.
- The `null → undefined` round-trip for optional plain TEXT columns is handled in `rowToTask` with an explicit guard (`if (row.arc != null) task.arc = row.arc`), the same pattern used for `type` and `title`.

## Rule

| Field type | Store as |
|---|---|
| Rich content (object, array, multi-value) | JSON-encoded TEXT |
| Categorical token (groupable, filterable, single string) | Plain TEXT NULL |

Examples of categorical: `arc`, `type`, `status`, `priority`. Examples of rich: `attachments`, `comments`, `pipeline`, `dependsOn`.

## Route ordering corollary

When adding a `GET /spaces/:id/arcs` style sub-resource endpoint, register its route **before** any greedy task-route regex (e.g. `SPACES_TASKS_ROUTE`) in `src/routes/index.js` to prevent accidental capture.
