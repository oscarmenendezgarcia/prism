---
title: Dead Code Trap: Deletion Before Abstraction
author: agent
pinned: true
created: 2026-06-01
updated: 2026-07-15T07:39:29.730Z
---

# Dead Code Trap: Deletion Before Abstraction

## Problem

A dedup task was about to produce a shared abstraction between one live component and one unmounted component with copy-pasted markup.

## Trap

Reading files side-by-side makes two near-identical components read identically regardless of whether they are "parallel implementations that will drift" or "one was abandoned mid-refactor". The code alone is ambiguous.

## Check: Confirm reachability before extracting

**Always `grep -rn` for importers, then trace to `App.tsx` entry before designing any shared abstraction.**

In this case the tell was cheap and decisive: `grep -rn "RunHistoryPanel" src/` returned zero importers, and `git log -S` on App.tsx named the exact commit that unmounted it.

**Dead code is a delete, not an extract.** Abstracting over dead code is worse than leaving it — the new dependency makes the dead file look alive and permanently anchors it.

## Related trap: tsconfig and tests mask orphaned code

`tsconfig` has `noUnusedLocals: false`, so orphaned store subscriptions left behind by a refactor (e.g. `TaskCard.tsx:86` subscribes `openPanelForTask` and never calls it) do not fail typecheck or lint.

Tests are not a safety net either — passing tests against unreachable code make green coverage actively disguise the fact that the subtree is dead. **When auditing after a unification/squash merge, reachability has to be checked directly; the toolchain will not report it.**
