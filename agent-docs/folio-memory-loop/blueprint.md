# Blueprint — folio-memory-loop

## 1. Overview

This feature closes two gaps in the Folio memory loop:

- **Gap 1 — topic_key**: a stable situational identifier on pages that enables
  cluster expansion in `buildContext` — BM25 threshold hits pull their sibling
  pages into context even when those siblings have no lexical overlap with the
  query.
- **Gap 2 — contradiction-judge**: a pluggable reconcile function that prevents
  contradictory lessons from co-existing in the folio, using a LLM-provided
  judge injected at call time, gated behind `FOLIO_RECONCILE=1`.

### Sacred invariants respected (from `.folio/state/current.md`)

1. `src/services/folio/` imports nothing outside its own directory.
2. The core has no knowledge of `space_id`.
3. The core does NOT call an LLM.
4. Schema migrations are idempotent (`ALTER TABLE … ADD COLUMN` with guard).
5. `FOLIO_RECONCILE` off → v1.1 behaviour byte-for-byte (no regression to
   existing 77/77 write-back tests and 55/55 core tests).

---

## 2. Schema Delta

### 2.1 Core schema (`src/services/folio/db.js`)

Two new nullable columns on `pages` and one new index:

```sql
-- Idempotent guard: SQLite silently fails ALTER TABLE if column already exists
-- via a BEGIN/COMMIT transaction with a pragma check.
-- Implementation pattern (mirrors existing folio schema migrations):

ALTER TABLE pages ADD COLUMN topic_key TEXT;
-- [a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*){0,2}
-- Grammar: kebab segments separated by "/", max 3 segments total.
-- Example valid keys: "mcp-zod-schema", "sqlite-write-contention",
--   "folio/injection/budget", "zod/strict-object"

ALTER TABLE pages ADD COLUMN superseded_by TEXT;
-- NULL = page is live. Non-NULL = page.id that replaced this one.
-- Injection engine filters WHERE superseded_by IS NULL.

CREATE INDEX IF NOT EXISTS idx_pages_topic ON pages(folio_id, topic_key);
-- Serves listPagesByTopics(folioId, topicKeys[]) — the cluster-expansion query.
```

`applySchema(db)` in `db.js` must be extended with a migration block that
applies these two `ALTER TABLE` statements idempotently. Since `ALTER TABLE ...
ADD COLUMN` throws if the column already exists, the implementation wraps them
in a helper that checks `PRAGMA table_info(pages)` first (or uses a
try/catch). The existing pattern in the codebase (see `folio_bootstrap` binding
DDL) uses `CREATE TABLE IF NOT EXISTS`; for `ALTER TABLE` the safe pattern is:

```js
// In applySchema(db) — after the CREATE TABLE block:
const PAGES_MIGRATION_V2 = [
  { column: 'topic_key',    ddl: 'ALTER TABLE pages ADD COLUMN topic_key TEXT' },
  { column: 'superseded_by', ddl: 'ALTER TABLE pages ADD COLUMN superseded_by TEXT' },
];
const existingCols = db.prepare("PRAGMA table_info(pages)").all().map(r => r.name);
for (const { column, ddl } of PAGES_MIGRATION_V2) {
  if (!existingCols.includes(column)) {
    db.exec(ddl);
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_pages_topic ON pages(folio_id, topic_key)');
```

### 2.2 Row mapper delta (`store.js`)

`rowToPage` gains two new fields:

```js
function rowToPage(row) {
  // ... existing fields ...
  topicKey:    row.topic_key    ?? null,
  supersededBy: row.superseded_by ?? null,
}
```

---

## 3. Core Store — new method

### 3.1 `listPagesByTopics(folioId, topicKeys[])`

**File:** `src/services/folio/store.js`

**Purpose:** Retrieve all live pages that belong to a given set of `topic_key`
values in a single query. Used exclusively by the cluster-expansion path in
`injection.js`.

**Signature:**
```typescript
listPagesByTopics(
  folioId:   string,
  topicKeys: string[]   // non-empty; caller validates
): Page[]
```

**Returns:** Pages where `folio_id = folioId AND topic_key IN (...topicKeys)
AND superseded_by IS NULL`, ordered by `created_at ASC`.

**Implementation notes:**
- Build the IN-clause dynamically from `topicKeys.length` placeholders.
- Use a prepared statement cache keyed on list length, or use an unprepared
  `db.prepare(...)` call inline (acceptable here since this path is only
  reached during injection assembly, not in a hot loop).
- Empty `topicKeys` array → return `[]` immediately (no SQL).
- Called with `opts.prebuilt` semantics; does not pass through FTS.

**SQL:**
```sql
SELECT * FROM pages
 WHERE folio_id = ?
   AND topic_key IN (/* N placeholders */)
   AND superseded_by IS NULL
 ORDER BY created_at ASC
```

---

## 4. Injection Engine — cluster expansion

**File:** `src/services/folio/injection.js`

### 4.1 Modified flow in `buildContext`

Current flow (v1.1):
```
searchPages(query) → thresholdHits → inline assembly → referenced
```

New flow (v1.2):
```
searchPages(query) → thresholdHits
                        ↓
                   collect topic_keys from thresholdHits
                        ↓
                   listPagesByTopics(folioId, topic_keys) → siblings
                        ↓
                   deduplicate (siblings \ thresholdHits already in hitMap)
                        ↓
                   add siblings to hitMap at rel = inheritedRel
                        ↓
                   inline assembly (unchanged logic) → referenced
```

### 4.2 New constant

```js
/**
 * Normalised rel score assigned to cluster-expansion siblings.
 * Set just below DEFAULTS.scoreThreshold so siblings qualify for inline
 * if budget allows, but are demoted to reference tier otherwise.
 * The operator is ">= scoreThreshold" so (scoreThreshold - 0.01) → reference.
 */
const CLUSTER_INHERITED_REL = DEFAULTS.scoreThreshold - 0.01;  // 1.99 with default threshold
```

Rationale: siblings that did NOT match the BM25 query directly are less
certain to be needed. Setting their `rel` just below the inline threshold
means they will be listed as "Relevant (fetch if useful)" references unless
the budget has room and the inline-page cap (`maxInlinePages`) is not yet
reached. The operator is `>=` for inline inclusion, so `1.99 < 2.0` = reference
tier by default.

Operators can tune via `opts.clusterInheritedRel` (new optional override).

### 4.3 Code delta (pseudocode, not implementation)

```js
// After thresholdHits is computed:

// Collect topic_keys from threshold hits (skip null/undefined keys)
const clusterKeys = [...new Set(
  thresholdHits
    .map(p => p.topicKey)
    .filter(Boolean)
)];

// Fetch siblings if any keys were found
if (clusterKeys.length > 0) {
  const siblings = store.listPagesByTopics(folioId, clusterKeys);
  const inheritedRel = cfg.clusterInheritedRel ?? CLUSTER_INHERITED_REL;

  for (const page of siblings) {
    if (!hitMap.has(page.id)) {
      // Only add if not already present from BM25 (preserve BM25 score if higher)
      hitMap.set(page.id, { page, rel: inheritedRel });
    }
  }
}

// thresholdHits re-filter: only pages already in hitMap with rel >= threshold
// (unchanged — the inline assembly loop already works off hitMap)
```

### 4.4 New opts field

`buildContext(store, folioId, query, opts)` gains one optional field:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clusterInheritedRel` | `number` | `scoreThreshold - 0.01` | rel score assigned to cluster siblings not in the BM25 result |

### 4.5 Worked example

Task: "add `priority` field to kanban_update_task schema".

- BM25 query: `"priority" OR "kanban" OR "update" OR "task" OR "schema"`.
- BM25 threshold hit: page `lessons/zod-schema-migrations` with
  `topic_key = "mcp-zod-schema"` (score 3.1 ≥ 2.0).
- Cluster expansion: `listPagesByTopics(folioId, ["mcp-zod-schema"])` returns
  also page `lessons/strict-object-union` (same key, body discusses
  `z.strictObject()` trap — no overlap with the query terms).
- Result: `strict-object-union` enters `hitMap` at rel 1.99 → appears in the
  "Relevant (fetch if useful)" reference list → developer reads it before
  writing the Zod schema → does not hit the trap.

---

## 5. Reconcile Module

**File:** `src/services/folio/reconcile.js` (new file)

### 5.1 Public interface

```typescript
/**
 * Verdict returned by the judgeFn.
 * The core understands the shape but does NOT act on CONTRADICT beyond
 * returning it in the result object. The consumer (Prism) handles side effects.
 */
type Verdict = 'DUPLICATE' | 'REFINE' | 'SUPERSEDE' | 'CONTRADICT' | 'UNRELATED';

/**
 * Draft page passed to reconcilePage and to the judgeFn.
 */
type PageDraft = {
  slug:      string;   // "chapter/page"
  title?:    string;
  content:   string;   // markdown
  topicKey?: string;   // may be absent; reconcile skips collision gate if so
  author?:   'user' | 'agent';
};

/**
 * The pluggable judge function.
 * Called ONLY when a live page with the same topic_key exists.
 * Must be synchronous or return a Promise<Verdict>.
 * The caller (reconcilePage) awaits it.
 *
 * Stub for tests:
 *   const alwaysUnrelated = async (_draft, _candidates) => 'UNRELATED';
 */
type JudgeFn = (
  draft:      PageDraft,
  candidates: Page[]    // live pages with same topic_key
) => Verdict | Promise<Verdict>;

/**
 * Result of reconcilePage.
 */
type ReconcileResult = {
  verdict:  Verdict | 'SKIPPED';  // SKIPPED when reconcile is off or no topic_key
  page?:    Page;                  // the written/updated page (absent on DUPLICATE)
  conflict?: {                     // only present on CONTRADICT
    draftSlug:      string;
    conflictingIds: string[];      // page.id of conflicting pages
    topicKey:       string;
  };
};

/**
 * Write a page through the reconcile gate.
 *
 * When FOLIO_RECONCILE env var is not "1" OR draft.topicKey is absent:
 *   → delegates directly to store.createPage / upsertPageFromAgent (v1.1 path).
 *
 * When FOLIO_RECONCILE=1 AND draft.topicKey is set:
 *   Phase 1 — cheap pre-filter:
 *     candidates = store.listPagesByTopics(folioId, [draft.topicKey])
 *     if candidates is empty → createPage directly (no judgeFn call)
 *   Phase 2 — judge:
 *     verdict = await judgeFn(draft, candidates)
 *   Phase 3 — apply verdict policy:
 *     DUPLICATE   → update only updated_at (touch); return { verdict, page }
 *     REFINE      → updatePage(merge content); return { verdict, page }
 *     SUPERSEDE   → updatePage(merge) + set superseded_by on replaced pages;
 *                   return { verdict, page }
 *     CONTRADICT  → createPage (writes the new page, does NOT overwrite);
 *                   return { verdict, page, conflict: { ... } }
 *                   NOTE: the consumer creates the board card; the core does not.
 *     UNRELATED   → createPage normally; return { verdict, page }
 *
 * @param store      - FolioStore instance
 * @param folioId    - Target folio
 * @param draft      - Draft page to write
 * @param judgeFn    - Pluggable judge (injected by consumer)
 * @returns ReconcileResult
 */
async function reconcilePage(
  store:    FolioStore,
  folioId:  string,
  draft:    PageDraft,
  judgeFn:  JudgeFn
): Promise<ReconcileResult>
```

### 5.2 Verdict policy detail

| Verdict | Core action | Prism action |
|---------|-------------|--------------|
| `DUPLICATE` | `updatePage(pageId, { updatedAt: now })` — touch only, no content overwrite | none |
| `REFINE` | `updatePage(existing.id, { content: merged })` where merged = new content replaces old | none |
| `SUPERSEDE` | `updatePage(existing.id, { content: merged })` + `updatePage(existing.id, { supersededBy: newPage.id })` after inserting new page | none |
| `CONTRADICT` | `createPage(draft)` — the NEW page is written; the old page is NOT overwritten; `superseded_by` stays null on both | Create a `folio-conflict` task in the board (see §7) |
| `UNRELATED` | `createPage(draft)` | none |

### 5.3 DUPLICATE touch behaviour

A DUPLICATE verdict means the consolidator produced content equivalent to an
existing page. In this case the core does NOT rewrite content (avoids the
"no re-write identical content" MCP perf invariant) but bumps `updated_at`.
This ensures the "last seen" timestamp reflects that the knowledge was
confirmed, not just created once and forgotten.

### 5.4 SUPERSEDE merge strategy (v1 — simple replace)

In v1 the merge for REFINE and SUPERSEDE is a simple content replacement: the
`draft.content` replaces `existing.content` wholesale. A diff-aware merge is
deferred to a future iteration when real usage shows what kind of merges are
needed.

---

## 6. MCP Tool — `folio_suggest_topic_key`

**File:** `mcp/folio-tools.js`

### 6.1 Purpose

The consolidator agent calls this tool before writing a new page to reuse an
existing `topic_key` instead of minting a near-duplicate. Example call:
`folio_suggest_topic_key({ folioId, draftText: "avoid strictObject in Zod union members" })`
→ returns `{ existing: ["mcp-zod-schema"], suggestion: "mcp-zod-schema" }`.

### 6.2 Registration signature

```typescript
folio_suggest_topic_key({
  folioId:   string,         // target folio
  draftText: string,         // free text describing the lesson
  folioRoot?: string         // multi-folio selector (inherited from existing tools)
}): {
  existing:   string[],      // all topic_key values currently in use in this folio
  suggestion: string | null  // the key from `existing` with highest FTS overlap,
                             // or a new kebab key derived from draftText if none match
}
```

### 6.3 Implementation (no LLM)

1. Query `SELECT DISTINCT topic_key FROM pages WHERE folio_id = ? AND topic_key IS NOT NULL`.
2. Run `store.searchPages(folioId, sanitizeFtsQuery(draftText), { limit: 5 })`.
3. From the top result, take `topicKey` if it matches any existing key.
4. If no match, derive a suggestion: take the first 2–3 significant terms from
   `sanitizeFtsQuery(draftText)` and join with `-` (max 3 kebab segments).
5. Return `{ existing, suggestion }`.

This is entirely FTS-based; no LLM is called.

### 6.4 New store method: `listDistinctTopicKeys(folioId)`

**File:** `src/services/folio/store.js`

```typescript
listDistinctTopicKeys(folioId: string): string[]
// SELECT DISTINCT topic_key FROM pages WHERE folio_id = ? AND topic_key IS NOT NULL
// ORDER BY topic_key ASC
```

---

## 7. Prism Binding Integration — conflict card

**File:** `src/services/folioBinding.js`  
**Integration point:** `upsertPageFromAgent` (guarded write-back path)

### 7.1 When reconciliation is on

When `FOLIO_RECONCILE=1`, the guarded write path `upsertPageFromAgent` is
replaced by a call to `reconcilePage` from the core, wrapped with the
Prism-supplied `judgeFn`. The `judgeFn` in production calls the Claude API
(single-turn, cheap `haiku` or `sonnet-instant`-equivalent model) with the
diff of draft vs candidates.

```js
// folioBinding.js — modified upsertPageFromAgent when FOLIO_RECONCILE=1
const result = await reconcilePage(core, folioId, draft, prismJudgeFn);

if (result.verdict === 'CONTRADICT' && result.conflict) {
  await createConflictTask(store, spaceId, result.conflict);
}
return result.page ?? null;
```

### 7.2 `createConflictTask(store, spaceId, conflict)`

**File:** `src/services/folioBinding.js` (private helper)

Creates a new task in the Prism board (column `todo`, space `spaceId`) with:

```json
{
  "title": "Folio conflict: {topicKey}",
  "type": "tech-debt",
  "description": "Two pages in the knowledge base have contradictory lessons for topic '{topicKey}'.\n\nNew page: {draftSlug}\nConflicting: {conflictingIds.join(', ')}\n\nReview both and update/delete the stale one.",
  "column": "todo"
}
```

**Dedup guard:** before creating the card, check `store.getTasks(spaceId)`
for an open task whose title starts with `"Folio conflict: {topicKey}"`. If
one exists, add a comment to the existing task instead of creating a
duplicate.

**Note:** This is the only point in `folioBinding.js` that reaches into the
Prism task store. The folio CORE (`src/services/folio/`) is not involved.

### 7.3 Integration point in `pipelineManager.js`

`applyConsolidation` already calls `_store.folio.binding.upsertPageFromAgent`.
When `FOLIO_RECONCILE=1`, this call becomes async (since `reconcilePage` is
async). The `applyConsolidation` function is already `async`; the only change
is awaiting the binding method:

```js
// pipelineManager.js — applyConsolidation (FOLIO_RECONCILE=1 path only)
const result = await _store.folio.binding.upsertPageFromAgent(
  run.spaceId, page.slug, page.content, { title: page.title, topicKey: page.topicKey }
);
```

The `consolidation.json` signal format is extended to accept an optional
`topicKey` field per page entry (backward-compatible: absent = null).

---

## 8. `folio_create_page` / `folio_update_page` MCP tool updates

**File:** `mcp/folio-tools.js`

Both existing tools gain an optional `topic_key` field in their Zod input
schema:

```typescript
// Added to folio_create_page schema:
topic_key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*){0,2}$/).optional()

// Added to folio_update_page schema:
topic_key: z.string().regex(...).optional()
```

When `topic_key` is provided to `folio_update_page`, it is passed as an
additional update field to `store.updatePage`.

`store.updatePage` must be extended to accept `topic_key` in the `updates`
object:

```sql
-- Updated updatePage prepared statement:
UPDATE pages
   SET content    = COALESCE(?, content),
       title      = COALESCE(?, title),
       pinned     = COALESCE(?, pinned),
       topic_key  = COALESCE(?, topic_key),   -- new
       updated_at = ?
 WHERE folio_id = ? AND id = ?
```

---

## 9. `markdown.js` — round-trip support

**File:** `src/services/folio/markdown.js`

The file-backend round-trips page fields through YAML frontmatter. Two new
fields must be added to `renderPage` (write) and `parsePage` (read):

```yaml
---
title: Avoid z.strictObject in union members
topic_key: mcp-zod-schema
superseded_by: null          # or a page UUID when superseded
# ... existing fields ...
---
```

`parsePage` reads `topic_key` and `superseded_by` from frontmatter and passes
them through to `loadPage`. `superseded_by: null` is written as the literal
`null` in YAML (or simply omitted when null; `parsePage` must tolerate absence
and default to null).

---

## 10. Data flow diagrams

### 10.1 Cluster expansion in `buildContext`

```
buildContext(store, folioId, query, opts)
  │
  ├─ store.searchPages(folioId, sanitizedQuery, { limit }) → BM25 hits
  │    Each hit: { page, score } → normalised rel
  │
  ├─ Collect topic_keys from BM25 threshold hits (rel ≥ scoreThreshold)
  │    clusterKeys = unique non-null topicKey values
  │
  ├─ [if clusterKeys.length > 0]
  │    store.listPagesByTopics(folioId, clusterKeys)
  │       ↓
  │    For each sibling NOT already in hitMap:
  │      hitMap.set(page.id, { page, rel: clusterInheritedRel })
  │
  ├─ Inline assembly (unchanged): constraint pages + thresholdHits (sorted by rel)
  │    Siblings enter inline if rel ≥ scoreThreshold AND budget/cap allows
  │    (at clusterInheritedRel = 1.99 they are just below threshold → reference tier)
  │
  └─ Reference tier: all hitMap entries not inlined → "Relevant (fetch if useful)"
```

### 10.2 `reconcilePage` write flow

```
reconcilePage(store, folioId, draft, judgeFn)
  │
  ├─ [FOLIO_RECONCILE != "1" OR draft.topicKey is null]
  │    → store.createPage / updatePage (v1.1 path, sync)
  │    verdict = 'SKIPPED'
  │
  └─ [FOLIO_RECONCILE = "1" AND draft.topicKey is set]
       │
       ├─ Phase 1: store.listPagesByTopics(folioId, [draft.topicKey])
       │    → candidates (live pages with same topicKey)
       │
       ├─ [candidates is empty]
       │    → store.createPage(draft)
       │    verdict = 'UNRELATED' (no collision)
       │
       └─ [candidates non-empty]
            │
            ├─ Phase 2: verdict = await judgeFn(draft, candidates)
            │
            ├─ DUPLICATE   → touch updated_at; return { verdict, page: existing }
            ├─ REFINE      → updatePage(existing.id, { content: draft.content })
            ├─ SUPERSEDE   → createPage(draft) + set superseded_by on existing
            ├─ CONTRADICT  → createPage(draft) [old page stays; BOTH live]
            │                return { verdict, page: newPage, conflict: {...} }
            └─ UNRELATED   → createPage(draft)
```

### 10.3 Conflict card creation in the Prism layer

```
applyConsolidation (pipelineManager.js)
  │
  └─ for each valid page in consolidation.json:
       │
       └─ binding.upsertPageFromAgent(spaceId, slug, content, { topicKey })
            │
            ├─ [FOLIO_RECONCILE != "1"]
            │    → existing v1.1 upsert
            │
            └─ [FOLIO_RECONCILE = "1"]
                 │
                 └─ reconcilePage(core, folioId, draft, prismJudgeFn)
                      │
                      ├─ verdict != CONTRADICT → log, return page
                      │
                      └─ verdict = CONTRADICT
                           │
                           └─ createConflictTask(store, spaceId, conflict)
                                │
                                ├─ Dedup: existing open "Folio conflict: {topicKey}"?
                                │    YES → addComment to existing task
                                │    NO  → insertTask(spaceId, 'todo', ...)
                                │
                                └─ log conflict.draftSlug, conflict.conflictingIds
```

---

## 11. Open Questions / Limitations (out of scope for this iteration)

- **Gap 2 — utility signal.** The question "did this lesson prevent a bug
  downstream?" is not addressed here. `topic_key` is the join key that a future
  evaluation substrate would use (join lesson pages to pipeline outcomes via
  `topic_key`), but no collection mechanism is designed yet.

- **Consolidator prompt update.** The consolidator agent's system prompt must
  be updated to: (a) call `folio_suggest_topic_key` before writing each page,
  (b) include `topic_key` in the `consolidation.json` signal. This is an
  agent-configuration change, not a code change, and is deferred to task
  FML-009.

- **`prismJudgeFn` latency.** In production, calling Claude adds 1–3 s per
  conflict detected. If many conflicts occur in a single consolidation run,
  the total latency could be significant. Mitigation: the FTS pre-filter limits
  calls to genuine collisions; a per-run timeout already governs consolidation.

- **File-backend `superseded_by` GC.** Dead pages (superseded_by IS NOT NULL)
  accumulate in the markdown directory as `.md` files with `superseded_by:`
  set in frontmatter. A purge command (`folio_gc_superseded`) is possible but
  not designed here.

- **`topic_key` grammar enforcement.** The regex is validated at the MCP tool
  layer (Zod) and at `reconcilePage` entry, but not in the core
  `createPage` / `updatePage` (which accept any TEXT). This is intentional:
  the core is permissive; validation lives at the API boundary. A future
  `CHECK` constraint on the column can be added via another migration.
