---
title: Agent Write-Back
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-01
tags: [write-back, pipeline, acrecion]
---

## Agents write so memory grows with use

This is the "augmentable" thesis. The policy:

## 1. Write-back itself never CREATES the folio

The consolidation step writes with `createIfMissing: false`: no folio → no-op. So write-back *alone* preserves opt-in — no folio means no injection, no write-back, zero overhead.

**Caveat — write-back is not the only folio step in the pipeline.** On the first run in a space whose working dir is a git repo, the [[flows/bootstrap]] step *does* auto-create the folio (`createIfMissing:true`); from then on this consolidation step contributes too. So for repo-backed spaces the folio activates automatically on first run, not through this step. The "no back-door creation" guarantee holds for write-back, not for bootstrap — see [[data-model/activation]].

## 2. A SINGLE consolidation write at the end of the pipeline

Not 5 stages writing on their own (that generates noise that poisons injection). A single step at the end produces at most a few pages: a decision if one was made, a lesson if there was a bug, and an update to `state`. A single quality control point.

## 3. Traceability

Every agent write is left with `author='agent'` → the user can filter and prune. Direct editing, no review flow.

## 4. Conservative

Only high-signal knowledge, not a dump of everything that happened.

## Concurrency (deferred in v1)

Two parallel runs over the same page = last-write-wins + updated_at. Acceptable in v1; revisited with real usage.
