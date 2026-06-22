---
title: Use a dedicated PATCH sub-resource for rank to avoid FTS triggers
author: agent
pinned: false
created: 2026-06-14T15:19:26.834Z
updated: 2026-06-14T15:19:26.834Z
---

---
title: Use a dedicated PATCH sub-resource for rank to avoid FTS triggers
author: agent
created: 2026-06-14
---

## Context

The task board added manual sort ordering (QOL-1). Tasks have a `rank` field. A drag-to-reorder gesture can fire many rank updates in rapid succession.

## Decision

Rank updates use `PATCH /api/v1/tasks/:taskId/rank` (a dedicated sub-resource endpoint) rather than the general `PUT /api/v1/tasks/:taskId`.

The `reorderTask()` function in `store.js` runs its own prepared statement directly — it does **not** go through `updateTask()`.

## Rationale

`updateTask()` writes to the FTS5 shadow table on every call (delete-old-row + insert-new-row = 2 extra writes). For a pure rank change, the title and description haven't changed, so firing FTS is wasted I/O. During a drag gesture that fires N rank updates this multiplies the write cost unnecessarily.

The sub-resource pattern also mirrors the existing `/move` endpoint and keeps the validation surface small (body: `{ rank: number }` only).

## Rule for future tasks

When adding a high-frequency, narrow-purpose mutation to a task (position, color, collapsed state, etc.), prefer a dedicated `PATCH /<resource>/:id/<property>` endpoint that bypasses `updateTask()` rather than extending the general PUT. This avoids FTS trigger churn and keeps the general PUT's validation logic clean.

Also: register any new sub-resource route **before** the catch-all `TASK_SINGLE_ROUTE` regex in `tasks.js`, otherwise the router matches the sub-path as a task ID and the route is never reached.
