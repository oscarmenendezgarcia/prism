# ADR-1: Folio Memory Loop — topic_key Clustering + Pluggable Contradiction Judge

## Status

Accepted

---

## Context

Folio v1.1 stores knowledge as pages with BM25 relevance lookup. Two weaknesses
remain unaddressed in the current design:

**Gap 1 — Situational recovery.** BM25 is purely lexical: a task phrased as
"add `priority` field to kanban_update_task Zod schema" only retrieves the
lesson "always use `z.object()`, never `z.strictObject()` in union members"
if the page content happens to contain the literal words "priority" or
"kanban_update_task". The lesson is universally relevant to ANY Zod schema
change — but lexical overlap is accidental. The symptom: the developer hits the
same Zod trap for the third time because BM25 did not surface the lesson.

**Gap 2 — Write consistency.** The consolidator produces one page per
run. After many runs, the folio drifts: two pages covering the same topic
with contradictory conclusions, both `author='agent'`, both alive. The
injection engine will surface whichever one BM25 happens to rank higher,
giving the developer non-deterministic guidance. The symptom: lessons
cancel each other out silently.

Both problems share a root: pages lack a stable situational identity. BM25
scores content overlap; it does not know that two pages speak to the same
coding situation.

This ADR records the decisions that address both gaps.

---

## Decision

1. Add a `topic_key TEXT` column and a `superseded_by TEXT` column to `pages`
   (core schema migration, idempotent). `topic_key` encodes the *coding
   situation* a page applies to, not its title. `superseded_by` records which
   page replaced a given page; the injection engine filters `superseded_by IS
   NULL` (live pages only).

2. Expand `buildContext` in `injection.js` with **cluster expansion**: after
   computing BM25 `thresholdHits`, collect their `topic_key` values and pull
   sibling pages that share a `topic_key` but did not rank above the threshold
   themselves. Siblings enter the `hitMap` at a capped inherited score.

3. Add `listPagesByTopics(folioId, topicKeys[])` to the core store as the
   single new query primitive required by cluster expansion. This method
   replaces the N-query pattern the injection engine would otherwise need.

4. Add `reconcilePage(store, folioId, draft, judgeFn)` to a new file
   `src/services/folio/reconcile.js`. This function implements a
   two-phase gate: a cheap FTS pre-filter (no LLM), then an optional call to
   the injected `judgeFn` only when a same-`topic_key` collision is found.
   The core does NOT call an LLM; `judgeFn` is supplied by the consumer.

5. Add `folio_suggest_topic_key(folioId, draftText)` as a new MCP tool.
   It performs FTS over existing `topic_key` values in the folio and returns
   existing keys plus a suggestion, allowing the consolidator to reuse keys
   instead of minting near-duplicates. No LLM required; pure FTS + string
   matching.

6. Gate the entire reconciliation path behind the environment variable
   `FOLIO_RECONCILE=1`. When the flag is absent (default), the write path
   is byte-for-byte identical to v1.1 (`upsertPageFromAgent` unchanged).

7. The conflict card for `CONTRADICT` verdicts is created at the **Prism
   binding layer** (`folioBinding.js` / `pipelineManager.js`), not in the
   core. The core only signals the `CONTRADICT` verdict in the return value
   of `reconcilePage`; Prism decides what to do with it (create a task,
   send a notification, etc.).

---

## Rationale

### Why topic_key clustering instead of vector embeddings?

Vector embeddings offer richer semantic similarity but require an external
model call on every write and a vector index (pgvector, FAISS, or a custom
SQLite extension). All three options violate the core extractability
invariant: the core cannot call an LLM (decision 7 in the closed decisions
log) and adding a native extension dependency to a pure SQLite module would
break portability. By contrast, `topic_key` is a human/agent-assigned string
stored in a TEXT column — no new dependency, no LLM at index time, and the
index is a plain B-tree over a TEXT column (`idx_pages_topic`). The
clustering mechanism (`listPagesByTopics`) is a standard IN query.

The trade-off is lower recall: two pages covering the same situation must
explicitly share the same `topic_key` to be co-retrieved. In practice this
is acceptable because (a) the consolidator can use `folio_suggest_topic_key`
to reuse existing keys, and (b) BM25 still handles the lexical recall path
independently. Both mechanisms are complementary, not exclusive.

### Why a pluggable judgeFn instead of embedding the judge in the core?

The core invariant (closed decision 7) states the core may not call an LLM.
An accurate contradiction judge requires a language model or at minimum a
rich heuristic that has awareness of the embedding or semantic similarity
score — neither belongs in an extractable module. Making `judgeFn` a
callback injected at call time allows Prism (or any future consumer) to
supply a Claude-backed judge in production while the test suite supplies a
deterministic stub. This is the same pattern used today for `opts.countTokens`
in `injection.js` and for backend injection in the pluggable backend design.

### Why a cheap FTS pre-filter before calling judgeFn?

The LLM (or any expensive judge) should only be invoked when there is an
actual candidate for contradiction. The FTS pre-filter limits candidate
selection to pages with the same `topic_key` as the draft, which is an O(log
n) index scan. No judge is called when: (a) the draft has no `topic_key`,
(b) no live page shares the same key, or (c) `FOLIO_RECONCILE` is off.
This keeps the cost of write-back consistent with v1.1 for the common case.

### Why a flag (FOLIO_RECONCILE) instead of always-on?

The existing `upsertPageFromAgent` path has 77 passing tests against a fixed
interface. Gating behind an environment variable preserves v1.1 behaviour
for all current callers and makes adoption incremental. The flag follows the
pattern of `PRISM_FOLIO_WRITEBACK` already present in `pipelineManager.js`.

### Why not temporal decay (marking old pages stale after N days)?

Decay requires a background sweeper and introduces time-based
non-determinism in injection results (the same folio produces different
context on different calendar days). The contradiction-judge approach is
event-driven: a page is marked superseded only when a newer page with the
same `topic_key` produces a `SUPERSEDE` or `REFINE` verdict. This is
strictly more correct than time-based decay for coding lessons, where
validity depends on whether the codebase changed, not on wall time.

---

## Consequences

### Positive

- Situational recall improves without any model call at read time: a single
  B-tree lookup on `topic_key` expands context for the most critical
  situation-specific lessons.
- Contradiction in the folio becomes observable (the board card) and
  resolvable (user picks the authoritative page) instead of silently
  poisoning injection.
- The DUPLICATE verdict in `reconcilePage` fixes the "do not re-write
  identical content" invariant identified in `folio_mcp_perf.md` without
  requiring the caller to check first.
- The `superseded_by` chain provides a future audit trail for how a lesson
  evolved over time — the join key that the eventual utility-signal substrate
  (gap 2, out of scope here) will need.
- All changes are strictly additive to existing schema and interfaces: the
  new TEXT columns default to NULL; existing tests pass unchanged.

### Negative / Risks

| Risk | Mitigation |
|------|------------|
| `topic_key` namespace drift: two nearly identical keys mint over time | `folio_suggest_topic_key` provides a reuse nudge; the consolidator prompt must be updated to call it before writing |
| `judgeFn` is slow (calls Claude): write-back latency increases under reconciliation | (a) The FTS pre-filter avoids calling `judgeFn` when there is no collision. (b) The `FOLIO_RECONCILE` flag allows opt-in per deployment. |
| CONTRADICT verdict creates noisy board cards if many conflicts accumulate | Limit to one card per `(spaceId, topic_key)` pair; dedup guard in the Prism integration layer |
| `superseded_by` is never GC'd in v1: dead page rows accumulate | Acceptable in v1 (pages are small text rows); a `DELETE WHERE superseded_by IS NOT NULL AND updated_at < X` maintenance query can be added later |
| File-backend does not persist `topic_key` and `superseded_by` in YAML frontmatter | The markdown.js layer must be updated to round-trip both fields; `folio-archive.test.js` baseline must be extended |

---

## Alternatives Considered

- **Vector embeddings (pgvector / sqlite-vss):** Richer semantic similarity but requires a native SQLite extension or an external service, both violating the extractability invariant and adding a hard dependency on an embedding model. Discarded.

- **Stage→chapters routing table:** A table mapping pipeline stage names to relevant chapter slugs. Discarded in the original design (closed decision 8) because it couples the engine to Prism's stage vocabulary and rots as chapters change. Still discarded; cluster expansion is domain-agnostic.

- **Temporal decay / TTL on agent pages:** Automatic staleness based on wall time. Discarded: event-driven supersession is strictly more correct for coding lessons and avoids background sweeper complexity.

- **In-core LLM judge (synchronous API call from reconcile.js):** Would make the core non-extractable and untestable without a live LLM. Discarded; the pluggable `judgeFn` pattern achieves the same outcome while preserving invariants.

- **Always-on reconciliation (no flag):** Would break the 77 existing write-back tests and force all consumers to handle the new verdict shape. Discarded in favour of the `FOLIO_RECONCILE` opt-in flag.

---

## Review

Suggested review date: 2026-12-08

Revisit at that date: whether `topic_key` namespace drift is occurring in
practice and whether an automated key-normalization step is warranted.
