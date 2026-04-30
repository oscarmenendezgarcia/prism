# Bug Report: SQLite Migration + FTS5

**Date:** 2026-04-29 — Updated: 2026-04-30
**QA Agent:** qa-engineer-e2e (initial) + direct QA verification
**Build:** `0e8733f` (all bugs resolved)

---

## BUG-001: unblockRunByComment reads JSON files — blocked pipeline runs never unblock

- **Severity:** Critical
- **Type:** Functional
- **Component:** `src/services/pipelineManager.js` — `unblockRunByComment()`, `readTaskFromSpace()`

### Reproduction Steps
1. Start server with a fresh data directory.
2. Create a task and start a pipeline run.
3. POST a question comment (`type: "question"`) → run transitions to `status: "blocked"`.
4. PATCH the comment with `resolved: true`.
5. GET the run status.

**Expected:** Run status transitions back to `"running"` and next stage executes.
**Actual:** Run status remains `"blocked"` indefinitely.

### Root Cause Analysis

`unblockRunByComment()` at line 1980:
```javascript
const spacesDir = path.join(dataDir, 'spaces');
const task = readTaskFromSpace(spacesDir, run.spaceId, taskId);
if (!task) return;  // ← silently exits here
```

`readTaskFromSpace()` (line 1514) reads from JSON column files:
```javascript
const filePath = path.join(spaceDir, `${column}.json`);
const tasks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
```

After the SQLite migration, tasks are stored only in `prism.db`. The JSON column files
no longer exist (they were renamed to `.migrated` during migration). `readTaskFromSpace`
always returns `null`. The early exit at `if (!task) return` means the run is never
unblocked, the pipeline stalls, and any waiting agent processes hang indefinitely.

**Failing tests:** `mcp-comment-pipeline.test.js` TC-011, TC-016; all 5 tests in
`multiple-questions.test.js`; most tests in `pipeline-blocked.test.js`.

### Proposed Fix

`pipelineManager.init(dataDir, store)` already receives the Store instance via the
uncommitted working-tree change (stored in module-level `_store`). Refactor
`unblockRunByComment` to use `_store` when available:

```javascript
function unblockRunByComment(dataDir, taskId, commentId) {
  const run = findActiveRunByTaskId(dataDir, taskId);
  if (!run) return;
  if (run.status !== 'blocked') return;

  let task;
  if (_store) {
    task = _store.getTask(run.spaceId, taskId);
  } else {
    const spacesDir = path.join(dataDir, 'spaces');
    task = readTaskFromSpace(spacesDir, run.spaceId, taskId);
  }
  if (!task) return;
  // ... rest unchanged
}
```

---

## BUG-002: markCommentNeedsHuman reads/writes JSON files — needsHuman never persists

- **Severity:** Critical
- **Type:** Functional
- **Component:** `src/services/pipelineManager.js` — `markCommentNeedsHuman()`

### Reproduction Steps
1. Start a pipeline run with a stage that has a `targetAgent` not present in `run.stages`.
2. POST a question comment with that `targetAgent`.
3. The pipeline manager attempts to mark the comment `needsHuman: true`.
4. GET the task and inspect `comments`.

**Expected:** The comment has `needsHuman: true` after the invalid targetAgent is detected.
**Actual:** `needsHuman` remains `false`; no warning is logged to indicate the update failed.

### Root Cause Analysis

`markCommentNeedsHuman()` at line 1541:
```javascript
const filePath = path.join(spaceDir, `${col}.json`);
if (!fs.existsSync(filePath)) continue;
let tasks;
try {
  tasks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch { continue; }
```

No JSON files exist after migration → `fs.existsSync(filePath)` returns `false` for
all three columns → the function silently falls through without updating anything.
The warning at the end is never reached because the early `continue` statements prevent it.

**Failing tests:** `mcp-comment-pipeline.test.js` TC-033.

### Proposed Fix

Use `_store` when available:
```javascript
function markCommentNeedsHuman(dataDir, spaceId, taskId, commentId) {
  if (_store) {
    const task = _store.getTask(spaceId, taskId);
    if (!task) {
      console.warn(`[pipelineManager] WARN: markCommentNeedsHuman — task ${taskId} not found`);
      return;
    }
    const comments = Array.isArray(task.comments) ? task.comments : [];
    const cIdx = comments.findIndex((c) => c.id === commentId);
    if (cIdx === -1) {
      console.warn(`[pipelineManager] WARN: markCommentNeedsHuman — comment ${commentId} not found`);
      return;
    }
    const now = new Date().toISOString();
    comments[cIdx] = { ...comments[cIdx], needsHuman: true, updatedAt: now };
    _store.updateTask(spaceId, taskId, { comments, updatedAt: now });
    pipelineLog('comment.needs_human', { taskId, commentId, spaceId, reason: 'resolver_failed' });
    return;
  }
  // fallback: original JSON path code ...
}
```

---

## BUG-003: prompt.js findTaskInSpace reads JSON files — POST /agent/prompt always returns 404

- **Severity:** High
- **Type:** Functional
- **Component:** `src/handlers/prompt.js` — `findTaskInSpace()`

### Reproduction Steps
1. Start server. Create a task via `POST /api/v1/spaces/default/tasks` (returns 201).
2. POST `{ agentId: "senior-architect", taskId: "<created-task-id>", spaceId: "default" }`
   to `POST /api/v1/agent/prompt`.

**Expected:** 201 with `promptPath` and `cliCommand`.
**Actual:** `404 TASK_NOT_FOUND` — "Task '...' was not found in space 'default'".

### Root Cause Analysis

`findTaskInSpace()` at line 129:
```javascript
function findTaskInSpace(spaceId, taskId, dataDir) {
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  for (const column of COLUMNS) {
    const filePath = path.join(spaceDir, `${column}.json`);
    if (!fs.existsSync(filePath)) continue;  // ← always skipped after migration
    ...
  }
  return null;
}
```

Tasks created via the API are stored only in SQLite; no JSON files are written.
`findTaskInSpace` never finds any task.

**Failing tests:** All `POST /api/v1/agent/prompt` tests in `tests/agent-launcher.test.js`
(5 failures).

### Proposed Fix

The `handleGeneratePrompt` function currently has signature
`handleGeneratePrompt(req, res, dataDir, spaceManager)`. Add a `store` parameter:

```javascript
async function handleGeneratePrompt(req, res, dataDir, spaceManager, store) {
  // ...
  let taskResult;
  if (store) {
    taskResult = store.getTaskWithColumn(spaceId, taskId);
  } else {
    taskResult = findTaskInSpace(spaceId, taskId, dataDir);
  }
  if (!taskResult) {
    return sendError(res, 404, 'TASK_NOT_FOUND', ...);
  }
  // ...
}
```

Also update `src/routes/index.js` to pass `store` when calling `handleGeneratePrompt`.

---

## BUG-004: Test files not updated for SQLite — 7 test files still use JSON file seeding

- **Severity:** High
- **Type:** Test Infrastructure
- **Component:** Multiple test files

### Affected Tests

| Test File | Issue | Failing Tests |
|-----------|-------|---------------|
| `tests/pipeline.test.js` | `setupSpace()` reads/writes `todo.json` | 10 REST integration tests |
| `tests/pipeline-field.test.js` | Calls `createApp(spaceDir)` with old 1-arg signature | 8 handler integration tests |
| `tests/pipeline-workingdir.test.js` | Writes tasks to JSON files; server reads SQLite | 3 tests |
| `tests/pipeline-blocked.test.js` | Writes tasks to JSON files | 9 tests |
| `tests/multiple-questions.test.js` | Writes tasks to JSON files | 5 tests |
| `tests/tagger.test.js` | `seedTasks()` writes JSON files after server starts | 5 tests |
| `tests/prompt-improvements.test.js` | `setupSpaceViaManager()` reads `todo.json` | Multiple tests |

### Root Cause Analysis

All these tests were written before the SQLite migration. They follow one of two patterns:

**Pattern A — Direct JSON file writes:**
```javascript
const todoPath = path.join(dataDir, 'spaces', spaceId, 'todo.json');
const tasks = JSON.parse(fs.readFileSync(todoPath, 'utf8'));  // ENOENT after migration
tasks.push(task);
fs.writeFileSync(todoPath, JSON.stringify(tasks));
```

After migration, `todo.json` no longer exists (renamed to `.migrated` or never created
for new spaces), so `readFileSync` throws `ENOENT`.

**Pattern B — Old `createApp(spaceDir)` signature:**
```javascript
const { router } = createApp(spaceDir);  // Old: createApp(dataDir)
// Now createApp(spaceId, store) — store is undefined → TypeError on insertTask
```

### Proposed Fix

Update each test file to use one of these approaches:
1. **REST API** — Create tasks via `POST /api/v1/spaces/:spaceId/tasks` instead of writing JSON.
2. **Store injection** — Pass the store to a test helper that calls `store.insertTask()` directly.
3. **Shared helper** — Use `tests/helpers/server.js` `startTestServer()` which correctly uses the full server with SQLite.

For `pipeline-field.test.js`, update the embedded `startServer()` to call `startServer()` from `server.js` (which already wires store correctly) instead of manually constructing with old APIs.

---

## BUG-005: searchTasks prepares SQL statement per call — performance regression

- **Severity:** Medium
- **Type:** Performance
- **Component:** `src/services/store.js` — `searchTasks()`

### Description

All other Store operations use statements compiled once at startup in the `stmts` object:
```javascript
const stmts = {
  listSpaces: db.prepare('SELECT * FROM spaces ORDER BY created_at ASC'),
  // ... all others
};
```

But `searchTasks()` compiles a new prepared statement on every invocation:
```javascript
function searchTasks(spaceId, query, { limit = 20 } = {}) {
  // ...
  const searchStmt = db.prepare(`SELECT t.* FROM tasks_fts JOIN tasks t ...`);  // per-call!
  const rows = searchStmt.all(trimmedQuery, spaceId, limit);
}
```

better-sqlite3's `db.prepare()` compiles SQLite bytecode. Doing this on every search request
adds ~0.5–2 ms of overhead per call and prevents the query planner cache from being reused.

### Proposed Fix

Move `searchStmt` into the `stmts` object:
```javascript
const stmts = {
  // ...existing statements...
  searchTasks: db.prepare(`
    SELECT t.*
      FROM tasks_fts
      JOIN tasks t ON t.rowid = tasks_fts.rowid
     WHERE tasks_fts MATCH ?
       AND t.space_id = ?
     ORDER BY rank
     LIMIT ?
  `),
};
```

Note: The `try/catch` for FTS5 errors in `searchTasks()` should be kept.

---

## BUG-006: No max-length constraint on FTS5 search query parameter

- **Severity:** Medium
- **Type:** Security / DoS
- **Component:** `src/handlers/tasks.js` — `handleSearchTasks()`
- **OWASP Reference:** A04:2021 Insecure Design

### Description

The search endpoint accepts unbounded query strings:
```javascript
const query = qs.get('q');
if (!query || query.trim().length === 0) {
  return sendError(res, 400, 'VALIDATION_ERROR', ...);
}
// No max-length check!
const results = store.searchTasks(spaceId, query, { limit });
```

An attacker or buggy client can send a pathologically long or complex FTS5 query
(e.g., thousands of `AND/OR` clauses) that causes high CPU usage. The review report
explicitly flagged this risk.

### Proposed Fix

Add a max-length check (200 chars, as suggested by the review report):
```javascript
const MAX_QUERY_LEN = 200;
if (query.trim().length > MAX_QUERY_LEN) {
  return sendError(res, 400, 'VALIDATION_ERROR',
    `Query must not exceed ${MAX_QUERY_LEN} characters`);
}
```

---

## Summary

| ID | Severity | Status | Fixed in | Component |
|----|----------|--------|----------|-----------|
| BUG-001 | Critical | **Resolved** | `21e44d1` | `pipelineManager.unblockRunByComment` |
| BUG-002 | Critical | **Resolved** | `21e44d1` | `pipelineManager.markCommentNeedsHuman` |
| BUG-003 | High | **Resolved** | `1727603` | `prompt.findTaskInSpace` |
| BUG-004 | High | **Resolved** | `e6d52cf` `413cb5c` `80b0c4f` | 7 test files using JSON file seeding |
| BUG-005 | Medium | **Resolved** | `d58354c` | `store.searchTasks` statement per-call |
| BUG-006 | Medium | **Resolved** | `6756061` | No max-length on FTS5 query param |
| BUG-007 | High | **Resolved** | `0e8733f` | PIPELINE_RUNS_DIR shell env contamination in tests |
| BUG-008 | High | **Resolved** | `0e8733f` | Missing GET /tasks/:id handler |
| BUG-009 | High | **Resolved** | `0e8733f` | handleCreateRun reads task.pipeline from JSON (not SQLite) |
| BUG-010 | High | **Resolved** | `0e8733f` | pipeline-field.test.js missing pipelineManager.init() call |

**Merge gate status: CLEAR.** 0 Critical, 0 High unresolved bugs.

### Test results (final verification — 2026-04-30)

| Test file | Tests | Pass | Fail |
|-----------|-------|------|------|
| `pipeline.test.js` | 60 | 60 | 0 |
| `pipeline-field.test.js` | 33 | 33 | 0 |
| `pipeline-workingdir.test.js` | 4 | 4 | 0 |
| `pipeline-run-history-bridge.test.js` | 8 | 8 | 0 |
| `pipeline-parallel-worktrees.test.js` | 33 | 33 | 0 |
| `pipeline-blocked.test.js` | 38 | 38 | 0 |
| `multiple-questions.test.js` | 11 | 11 | 0 |
| **Total** | **187** | **187** | **0** |
