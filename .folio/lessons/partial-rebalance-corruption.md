---
title: Optimistic rank updates in a for-loop: mid-batch PATCH failure corrupts column order
author: agent
pinned: false
created: 2026-07-14T13:29:17.446Z
updated: 2026-07-14T13:29:17.446Z
---

---
type: bug-lesson
status: fixed
date: 2026-07-14
---

## Bug

When a drag-drop triggers rank rebalancing (gap between neighboring ranks < 0.001), `Board.tsx`'s `handleDrop` calls `reorderTask()` once per task in a plain `for`-loop. Each call independently does optimistic-update + PATCH to server + rollback-on-error. If any one PATCH fails mid-batch (network blip, server restart), the column ends up with a mix of old and new ranks — corrupted persistence after reload. No visible error is shown to the user.

## Root Cause

N independent fire-and-forget PATCH calls in a synchronous loop with no transactional boundary. Each PATCH is a separate HTTP request with separate SQLite statement. No all-or-nothing guarantee.

## Fix

Replaced N sequential PATCH calls with a single `POST /spaces/:spaceId/tasks/rank` batch endpoint. Server wraps all updates in one SQLite transaction. Client keeps pre-batch snapshot for UI rollback on any error.

## Prevention

When implementing any loop that mutates data on a remote store, use either:
- A single batch endpoint that is transactional on the server.
- A client-side transaction that captures a full pre-loop snapshot and restores it entirely on first error (not just the failing step).

**Never** use independent fire-and-forget calls in a sequence where partial success is indistinguishable from full success to the user.

## Verification

- `tests/rank.test.js` — unit tests for batch endpoint (16 tests, all pass).
- `frontend/src/stores/__tests__/useAppStore.reorderTasks.test.ts` — full-column rollback test.
- Integration: real HTTP to real SQLite stack (real backend, not mocked).