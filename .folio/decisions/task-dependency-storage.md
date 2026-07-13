---
title: Task Dependencies: JSON Column + Derived isBlocked (not junction table or persisted flag)
author: agent
pinned: false
created: 2026-06-14T16:05:03.809Z
updated: 2026-06-14T16:05:03.809Z
---

---
title: Task Dependencies: JSON Column + Derived isBlocked (not junction table or persisted flag)
author: agent
created: 2026-06-14
updated: 2026-06-14
tags: [decisions, store, sqlite, tasks]
---

Decisions made during QOL-3 (dependsOn field). Both closed; do not re-open without strong justification.

## Decision 1 — JSON column over junction table

`dependsOn` is stored as a JSON TEXT column on the `tasks` table (consistent with `attachments`, `pipeline`, `comments`), not as a separate `task_dependencies` junction table.

**Rejected alternative:** A junction table would give DB-level FK enforcement and `ON DELETE CASCADE`, but it breaks the single-row task-read invariant the entire codebase is built around — every `getTask` and `getTasksByColumn` is a single `SELECT`. Adding a junction table would require a `JOIN` or a second round-trip for every task read.

**Rationale:** Cycle detection and existence validation happen at the application layer. Reverse-ref cleanup on delete runs inside a SQLite transaction with better-sqlite3 JS logic. This is the right trade-off for an embedded SQLite store with fewer than ~1 000 tasks per space.

**Where it lives:** `src/services/store.js` — `setTaskDependencies()`, `detectCycle()`, `deleteTask` transaction cleanup.

## Decision 2 — Derived isBlocked, not a persisted column

`isBlocked` and `blockedByCount` are computed at `GET /tasks` response time (one in-process iteration over the already-loaded task list), not stored as DB columns.

**Rejected alternative:** Persisting these flags would require cascading `UPDATE` calls on every `moveTask` — every time any task transitions to `done`, all tasks depending on it would need their `isBlocked` flag refreshed synchronously. This is N UPDATEs per move with risk of stale state if any write fails mid-transaction.

**Rationale:** The derived approach is always fresh and costs O(N) in-process with no extra DB writes. At the scale of tasks per space this is negligible.

**Where it lives:** `src/services/store.js` — `deriveBlockedStatus()`, `getAllTasksForSpaceWithStatus()`; `src/handlers/tasks.js` — GET response enrichment.
