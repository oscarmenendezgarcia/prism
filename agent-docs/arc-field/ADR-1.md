# ADR-1: `arc` — First-Class Narrative Grouping Field on Tasks

## Status
Accepted

## Context

Prism users have been using title prefixes (e.g. `LOOP-1`, `QOL-2`, `AUTH-3`) to group related tasks
across the board. This practice is fragile: titles are user-visible display strings not designed for
programmatic parsing; prefix-based grouping breaks on renames; filtering requires `LIKE 'LOOP-%'` scans
that won't survive an FTS5 index; and the technique bleeds organizational metadata into display text that
agents read and repeat.

The board needs a first-class grouping signal that:

- is **optional** — existing tasks require no migration, zero breaking changes
- **survives title renames** — stored separately from the title
- is **queryable and indexable** — an ordinary indexed TEXT column
- **aligns with the Folio mental model** — just as Folio organises knowledge into Chapters and Pages,
  tasks belong to a narrative "arc" (a short label like `QOL`, `LOOP`, `AUTH`)
- can be **AI-suggested** — the tagger agent already classifies type and description; extending it to
  propose an arc is zero additional infrastructure

## Decision

Add an optional `arc TEXT` column to the `tasks` SQLite table via an additive migration (guarded by
`PRAGMA table_info`, same pattern as `folio_backend` on `spaces`). Surface `arc` throughout the full
stack: persistence (store.js), API (create/update/list + a new `/arcs` distinct-values endpoint), MCP
tools (`kanban_create_task` + `kanban_update_task`), React frontend (TaskCard chip, autocomplete in
CreateTaskModal and TaskDetailPanel, arc filter/group bar on the Board), and the tagger agent
(AI-suggested arc included in suggestions, reviewable in TaggerReviewModal).

## Rationale

**Why a dedicated column?** A plain TEXT column gives us:
- `SELECT DISTINCT arc FROM tasks WHERE space_id = ?` for autocomplete — no deserialization
- `WHERE arc = ?` for filtering — index-backed exact match
- `GROUP BY arc` for the board grouping view — native SQL, no application-layer parsing
- Correct NULL semantics — `NULL` means "unset", empty string is disallowed at the API layer

**Why plain TEXT and not JSON-encoded?** All other optional fields (`assigned`, `description`) are
JSON-encoded to preserve the `null` vs `undefined` distinction through the serialization round-trip.
`arc` is an exception: it is a short categorical token (like `type`), never contains embedded quotes
or control characters, and benefits from being stored as a raw SQL value for GROUP BY / DISTINCT queries.
An explicit check in `rowToTask` converts SQL `NULL` → `undefined` (no field on the JS object),
maintaining the same JS surface contract. This is consistent with how `type` (also a short TEXT column)
is handled.

**Why a `/arcs` API endpoint?** The autocomplete component needs the full list of arc values across all
columns and all tasks in the space — not just what is currently rendered on the board. A simple
`SELECT DISTINCT arc` query is cheap (O(index scan)) and eliminates the need for the frontend to track
which tasks it may not yet have loaded.

**Why extend the tagger?** The tagger already receives every task's title + description and calls Claude
to infer `type`. Adding `arc` inference to the same call costs zero extra tokens per task (it is a new
field in the same JSON response). Users review suggestions in `TaggerReviewModal` before anything is
written; the change is purely additive.

## Consequences

### Positive
- Grouping and filtering by arc is reliable, performant, and survives title renames
- Existing tasks are unaffected (column nullable; no data migration required)
- The Folio "narrative arc" mental model is coherent with Chapter/Page metaphor
- Tagger auto-populates arc on AI Actions run — eliminates manual prefix management
- Agents creating tasks via MCP can set `arc` from the start, ending the prefix convention

### Negative / Risks
- **Schema migration**: the `ALTER TABLE tasks ADD COLUMN arc TEXT` is irreversible in SQLite
  (columns cannot be dropped). Mitigation: additive-only, nullable, column name is generic enough
  to remain useful.
- **Tagger prompt growth**: adding `arc` to the FORMAT_SYSTEM_PROMPT increases prompt size by ~80 tokens.
  Mitigation: negligible relative to card corpus; haiku model handles it cheaply.
- **Autocomplete latency**: the CreateTaskModal fetches `/arcs` on open. Mitigation: response is a
  small JSON array; cache in component state for the modal lifetime.

## Alternatives Considered

- **Title prefix convention (status quo)**: fragile, breaks on rename, requires `LIKE` scan, pollutes
  display text — discarded.
- **JSON column `metadata: {arc: string}`**: flexible but makes SQL grouping/filtering impossible
  without `json_extract()` — performance regresses and the schema is opaque — discarded.
- **Tags array (multi-value)**: powerful but over-engineered for the single-dimension grouping use case
  described. Tags could be a future V2 layer built on top of this foundation — deferred.
- **Folio chapter reference (foreign key to a Folio chapter)**: semantically rich but couples the task
  schema to the Folio subsystem. Arc is intentionally a lightweight, free-text label — discarded.

## Review
Suggested review date: 2026-12-14
