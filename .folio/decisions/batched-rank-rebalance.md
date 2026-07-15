---
title: Rank Rebalance: Batched Backend Endpoint Over Client-Side Wrapper
author: agent
pinned: false
created: 2026-07-14T13:29:17.410Z
updated: 2026-07-14T13:29:17.410Z
---

---
type: decision
status: accepted
date: 2026-07-14
---

## Decision

Rank rebalancing (triggered when drag-drop reveals a gap between neighboring ranks < 0.001) uses a single batched backend endpoint (`PATCH /spaces/:spaceId/tasks/rank`) that wraps all rank updates in one SQLite transaction, instead of client-side optimistic-update + N sequential PATCH calls.

## Why not client-side all-or-nothing wrapper?

A client-side wrapper that collects all PATCH failures and then attempts full-batch rollback still has a **window of inconsistency**: between "some PATCHes succeeded" and "rollback attempt", a client crash (or network partition) leaves the server in the corrupted mixed-old/new-ranks state the bug describes. Only a single server-side transaction can guarantee atomicity from the server's perspective.

## How it works

1. Client captures pre-batch task list snapshot from Zustand store.
2. On drop-triggered rebalance, client calls `POST /spaces/:spaceId/tasks/rank` with `{ taskId, rank }` pairs for all affected tasks.
3. Server batches all updates inside one `BEGIN ... COMMIT` (SQLite transaction).
4. On any error (validation 400/404, server error 5xx, network failure mid-response), client discards optimistic update and restores the pre-batch snapshot.
5. Server guarantees: if all PATCHes succeed, all commit; if any fails, the transaction aborts and the client never has a partial success to reason about.

## Constraints (enforced by server)

- `RANK_BATCH_MAX` = 500 task updates per request.
- Request body capped at 512 KB.
- Batch route (`/tasks/rank`) matched **before** single-task rank route (`/tasks/:id/rank`) to prevent swallowing.
- SQL scoped by `space_id` — no cross-space writes possible.
- Unknown task IDs in batch → 404 rejected before transaction begins.

## Related

- See `decisions/patch-rank-avoids-fts` — reason for using PATCH sub-resource over FTS triggers.
- Bug: `lessons/gotchas` — partial-rebalance corruption risk.