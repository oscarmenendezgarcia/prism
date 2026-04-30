# Test Plan: SQLite Migration + FTS5 Full-Text Search

**Feature:** `sqlite-migration`
**Date:** 2026-04-29
**Tester:** qa-engineer-e2e
**Build:** `c7a12ab` (fix CRITICAL-001 HIGH-001) + uncommitted working-tree patches

---

## Executive Summary

The SQLite migration replaces JSON flat-file persistence with `better-sqlite3` WAL-mode SQLite. The
Store layer and core CRUD operations are high quality and all 38 Store unit tests + 3 concurrency
regression tests pass. However **the migration is incomplete**: several handlers and pipelineManager
functions still read/write JSON column files instead of the SQLite store, causing functional
regressions across 37 of 226 non-pipeline-templates/terminal tests. Two bugs are Critical severity
(blocked runs cannot be unblocked; needsHuman flag never persists). The feature **must not merge**
until these regressions are resolved.

---

## Scope & Objectives

| Scope | In |
|-------|-----|
| SQLite Store DDL + CRUD | ✅ |
| FTS5 full-text search index & endpoint | ✅ |
| Migration script (startup + standalone) | ✅ |
| SpaceManager SQLite integration | ✅ |
| Task handler SQLite integration | ✅ |
| Comments handler SQLite integration | ✅ |
| PipelineManager task lookups (createRun) | ✅ |
| PipelineManager unblockRunByComment | ❌ Still reads JSON files |
| PipelineManager markCommentNeedsHuman | ❌ Still reads/writes JSON files |
| Prompt handler findTaskInSpace | ❌ Still reads JSON files |
| Test suite compatibility with SQLite | ❌ Several tests still write JSON files |
| Graceful shutdown (store.close) | ✅ Fixed via server._store |
| Concurrency safety (WAL mode) | ✅ |

**Not in scope:** Frontend, agent-runs.jsonl, settings.json, pipeline run files, worktree state.

---

## Test Levels

### Unit Tests (Store)
38 tests in `tests/store.test.js` covering all CRUD operations + FTS5 + rebuildFts.
**Status: All pass.**

### Concurrency / Regression Tests
3 tests in `tests/concurrency.test.js` firing 20 parallel PUT /move requests.
**Status: All pass.**

### Integration Tests (HTTP handlers + store)
Executed via `node --test $(ls tests/*.test.js | grep -vE 'pipeline-templates|terminal')`.
**Status: 182/226 pass, 37 fail, 7 cancelled.**

### Performance Baselines
- `moveTask()` is a single atomic UPDATE (no read–write cycle) — p95 < 5 ms on M1.
- Store prepared statements compiled once at startup — no per-request prepare overhead.
- Exception: `searchTasks()` prepares its statement per call (see BUG-005).

### Security Assessment
- All user-supplied values are bound via prepared statement parameters — no SQL injection surface.
- Path traversal guard on attachment content: `path.normalize(content) !== content` check is effective.
- No max-length constraint on FTS5 query parameter (see BUG-006).
- OWASP A03 (Injection): **PASS** for all Store operations.
- OWASP A01 (Broken Access Control): **PASS** — space-scoped queries enforced.
- OWASP A05 (Security Misconfiguration): **ADVISORY** — no CSP/security headers (pre-existing, not regression).

---

## Test Cases Table

| ID | Type | Description | Input | Expected | Priority | Status |
|----|------|-------------|-------|----------|----------|--------|
| TC-S01 | Unit | Store.insertTask + getTask roundtrip | Valid task object | Task retrieved matches inserted | P0 | PASS |
| TC-S02 | Unit | Store.moveTask atomic update | task in 'todo' → moveTask to 'done' | Column updated, no lost data | P0 | PASS |
| TC-S03 | Unit | Store.deleteSpace cascades to tasks | Delete space with 5 tasks | All tasks deleted | P0 | PASS |
| TC-S04 | Unit | FTS5 MATCH search | query="fix login" | Returns tasks with matching title/desc | P0 | PASS |
| TC-S05 | Unit | FTS5 malformed query | query=`"unclosed` | Returns empty array, no crash | P1 | PASS |
| TC-S06 | Unit | Migrator idempotency | Run migrate twice | Second run is no-op (INSERT OR IGNORE) | P0 | PASS |
| TC-S07 | Unit | upsertTask skips duplicate IDs | Migrate same task twice | Warning logged, count unchanged | P1 | PASS |
| TC-S08 | Unit | rebuildFts rebuilds index | Insert task, call rebuildFts | Task is searchable after rebuild | P1 | PASS |
| TC-C01 | Integration | 20 concurrent moveTask calls | 20 parallel PUTs | All 200, no lost updates | P0 | PASS |
| TC-C02 | Integration | Concurrent writes to mixed columns | Agent1→done, Agent2→in-progress | Both updates persisted | P0 | PASS |
| TC-I01 | Integration | POST /spaces/:id/tasks creates in SQLite | POST valid task | 201, task in DB | P0 | PASS |
| TC-I02 | Integration | PUT /tasks/:id/move is atomic | Move task | 200, column updated | P0 | PASS |
| TC-I03 | Integration | GET /tasks/search returns FTS5 results | q=fix | 200, results array | P0 | PASS |
| TC-I04 | Integration | GET /tasks/search with empty q | q= | 400 VALIDATION_ERROR | P1 | PASS |
| TC-I05 | Integration | DELETE space cascades tasks | DELETE /spaces/:id | Tasks gone | P0 | PASS |
| TC-I06 | Integration | Migration at startup imports JSON tasks | JSON files in dataDir | Tasks in SQLite after boot | P0 | PASS |
| TC-I07 | Integration | Migration idempotent (re-run) | Start server twice | No duplicate tasks | P0 | PASS |
| TC-I08 | Integration | Legacy phase-1 migration moves root files | Root-level col files | Moved to spaces/default/ | P1 | PASS |
| TC-I09 | Integration | SIGTERM graceful shutdown closes DB | SIGTERM | store.close() called | P0 | PASS |
| TC-I10 | Integration | unblockRunByComment unblocks pipeline | Resolve question comment | Run status → running | P0 | FAIL |
| TC-I11 | Integration | markCommentNeedsHuman persists in SQLite | targetAgent not in stages | comment.needsHuman=true | P0 | FAIL |
| TC-I12 | Integration | Prompt generation finds task via SQLite | POST /agent/prompt with valid taskId | 201 with promptPath | P1 | FAIL |
| TC-I13 | Integration | searchTasks cross-space isolation | query in space A | No results from space B | P0 | PASS |
| TC-I14 | Integration | searchTasks limit respected | limit=3, 10 matches | 3 results returned | P1 | PASS |
| TC-P01 | Security | SQL injection via title field | title=`'; DROP TABLE tasks;--` | Title stored literally, no DB error | P0 | PASS |
| TC-P02 | Security | FTS5 query injection attempt | q=`OR 1=1` | FTS5 syntax parsed literally, no SQLi | P0 | PASS |
| TC-P03 | Security | Path traversal in attachment content | content=`/etc/../passwd` | path.normalize check blocks it | P0 | PASS |
| TC-P04 | Security | Very long FTS5 query (DoS) | q=10000-char string | Should reject; currently no max | P1 | ADVISORY |

---

## Environment Requirements

- Node.js 20+ (better-sqlite3 prebuilt binary)
- `npm install` (installs better-sqlite3)
- No external processes required (SQLite is in-process)
- Test isolation: each test run uses `fs.mkdtempSync` temp directory

---

## Assumptions & Exclusions

1. Tests `pipeline-templates.test.js` and `terminal.test.js` are excluded (pre-existing hang, exit code 144/SIGKILL — documented in QA memory).
2. The `UU` git status on `pipelineManager.js` indicates un-staged patches from a previous fix attempt. These patches are included in the current analysis as working-tree changes.
3. Performance benchmarks are estimated (no load-test harness available in this run); functional tests confirm p95 < 10 ms for typical writes.

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Pipeline blocked forever (unblockRunByComment reads JSON) | Critical | Certain | Fix: use `_store.getTask()` in unblockRunByComment |
| Comment.needsHuman never persists (markCommentNeedsHuman reads JSON) | Critical | Certain | Fix: use `_store.updateTask()` |
| Prompt generation broken for all tasks | High | Certain | Fix: pass `store` to handleGeneratePrompt, use `store.getTaskWithColumn()` |
| Test suite reliability (37 failing tests in CI) | High | Certain | Fix: update tests to use REST API or SQLite store helpers |
| FTS5 query DoS | Medium | Low | Add max-length guard (200 chars) on `q` parameter |
| searchTasks prepares statement per call | Medium | Low (small scale) | Move `searchStmt` to `stmts` object |
