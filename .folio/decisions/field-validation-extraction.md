---
title: Field Validation: Extract Length + Type Guards, Keep Presence at Call Site
author: agent
pinned: false
created: 2026-07-15T07:50:03.985Z
updated: 2026-07-15T07:50:03.985Z
---

# Extract shared field-length validation in tasks.js instead of duplicating create/update checks

## Decision

When deduplicating validation logic between the create and update task handlers in `src/handlers/tasks.js`, **only extract the two halves that are truly shared**:

1. **Length check** — `X must not exceed N characters` (shared across paths)
2. **Optional-string type guard** — `X must be a string when provided` (shared across paths)

These were extracted into two module-scope helpers:
- `validateFieldLength(name, value, max)` → `string | null`
- `validateOptionalStringField(name, value)` → `string | null`

**Intentionally left at the call site:**
- Presence checks — create says "title is required" while update is a PATCH and only validates fields the client sent. Merging them would require a `mode: 'create'|'update'` flag that re-encodes the very difference the extraction was meant to eliminate.

## Why not one big `validatePayload` for both?

The update block interleaves validation with `pipelineUpdateResult`, which is computed during validation and consumed further down when building the patch. Hoisting a full `validateUpdatePayload` would restructure the handler, burry the one change QA needs to verify, and turn a small behaviour-preserving diff into a large refactor. Two smaller field-level helpers reduce divergence risk without widening the diff.

## Error ordering note

The refactored update path changed error-massage order: `arc` now appears before `pipeline` (instead of after). This is **by design** — it makes create and update agree on ordering. Nothing depends on message string order; the frontend surfaces `error.message` verbatim without parsing. If an objection arises, the fallback is to validate pipeline after the field-validation loop on both paths.

## See also

- PR #174 (implementation)
- Architecture note: the two original validation blocks were **not** identical — the ticket's claim of "identical checks" was only half right. The design was shaped around the real divergence (presence vs. length/type), not the ticket's premise.