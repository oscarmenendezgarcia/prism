# Blueprint: Agent Auto-Sync on Server Startup (QOL-6)

## 1. Problem Statement

`prism init` copies `agents/*.md` → `~/.claude/agents/` once and never again. After
`npm install -g prism-kanban@latest`, the runtime agent files stay at the previous version
until the user runs `prism init` manually — friction demonstrated by the MERGE-1 rollout
where `developer-agent.md` had to be copied by hand.

Goal: propagate new and updated agent definitions automatically on every server startup,
without overwriting files the user has customised.

---

## 2. Core Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `agentSync` | `src/services/agentSync.js` | Checksum-based safe sync; reads/writes manifest |
| `startServer` | `server.js` | Calls `syncAgents()` after PIPELINE_AGENTS_DIR resolved |
| `installAgents` | `bin/init.js` | Extended to write manifest after copying files |

No new npm dependencies. SHA-256 via Node.js `crypto` built-in. JSON manifest for
persistence.

---

## 3. Manifest Format

**File:** `<agentsDir>/.prism-manifest.json`

```json
{
  "version": "1.0",
  "managed": {
    "senior-architect.md": {
      "hash": "e3b0c44298fc1c149afb...",
      "prismVersion": "1.1.0",
      "syncedAt": "2026-06-14T10:00:00.000Z"
    },
    "developer-agent.md": {
      "hash": "a48bcf2e98ea...",
      "prismVersion": "1.1.0",
      "syncedAt": "2026-06-14T10:00:00.000Z"
    }
  }
}
```

- `hash` — SHA-256 hex of the file content **as written by Prism** (not the user's current
  version). If the destination file's current SHA-256 matches this hash, Prism's last write
  is still intact (user has not edited the file).
- `prismVersion` — the Prism package version that performed the last write. Diagnostic only.
- `syncedAt` — ISO timestamp of the last write. Diagnostic only.

Written atomically: `<path>.tmp` → `rename`.

---

## 4. `syncAgents()` API

```js
// src/services/agentSync.js

/**
 * Sync Prism-managed agent files from packageRoot/agents/ to agentsDir.
 *
 * @param {object} opts
 * @param {string} opts.packageRoot    — absolute path to Prism package root
 * @param {string} opts.agentsDir      — destination directory (PIPELINE_AGENTS_DIR)
 * @param {string} [opts.prismVersion] — current Prism version (from package.json)
 * @param {Function} [opts.log]        — logger, signature (msg: string) => void
 * @returns {{ synced: string[], skipped: string[], noChange: string[], errors: string[] }}
 */
function syncAgents({ packageRoot, agentsDir, prismVersion, log }) { ... }
```

Returns a result object so callers can log and test the outcome without relying on side
effects.

---

## 5. Sync Algorithm (per agent file)

```
For each *.md file F in <packageRoot>/agents/:

  srcHash  = sha256(read(src/F))
  destPath = <agentsDir>/F
  manifest = readManifest(<agentsDir>)  [cached; read once per call]

  CASE 1 — dest does not exist:
    copy src → dest
    manifest.managed[F] = { hash: srcHash, ... }
    result.synced.push(F)
    log("[agent-sync] installed: F")

  CASE 2 — dest exists, manifest entry exists:
    destHash     = sha256(read(dest))
    manifestHash = manifest.managed[F].hash

    IF destHash == manifestHash:           // user has NOT changed the file
      IF srcHash == destHash:              // source is also identical → no-op
        result.noChange.push(F)
      ELSE:                                // Prism has a newer version
        copy src → dest
        manifest.managed[F] = { hash: srcHash, ... }
        result.synced.push(F)
        log("[agent-sync] updated: F (prism v<old> → v<current>)")

    ELSE:                                  // user has customised dest
      result.skipped.push(F)
      log("[agent-sync] skipped (user-modified): F")

  CASE 3 — dest exists, NO manifest entry (migration / first run):
    srcHash  = sha256(read(src))
    destHash = sha256(read(dest))

    IF srcHash == destHash:                // already identical
      manifest.managed[F] = { hash: srcHash, ... }
      result.noChange.push(F)
    ELSE:                                  // migration bias: update once, baseline manifest
      copy src → dest
      manifest.managed[F] = { hash: srcHash, ... }
      result.synced.push(F)
      log("[agent-sync] first-sync updated: F (no prior baseline)")

Write manifest atomically (only if any entry changed)
```

---

## 6. Integration in `server.js` `startServer()`

Insert after the `PIPELINE_AGENTS_DIR` resolution block (lines ~80–86 of current
`server.js`), before `server.listen()`:

```js
// ── Agent auto-sync ────────────────────────────────────────────────────────
const { syncAgents } = require('./src/services/agentSync');
const _agentsDir = options.agentsDir
  || process.env.PIPELINE_AGENTS_DIR
  || path.join(os.homedir(), '.claude', 'agents');

const { version: _prismVersion } = require('./package.json');
const _syncResult = syncAgents({
  packageRoot: __dirname,
  agentsDir:   _agentsDir,
  prismVersion: _prismVersion,
  log: options.silent ? () => {} : (msg) => console.log(msg),
});

if (!options.silent && (_syncResult.synced.length > 0 || _syncResult.skipped.length > 0)) {
  const parts = [];
  if (_syncResult.synced.length)   parts.push(`synced ${_syncResult.synced.length}`);
  if (_syncResult.skipped.length)  parts.push(`skipped (user-modified) ${_syncResult.skipped.length}`);
  if (_syncResult.errors.length)   parts.push(`errors ${_syncResult.errors.length}`);
  console.log(`[agent-sync] ${parts.join(', ')}`);
}
// ──────────────────────────────────────────────────────────────────────────
```

`options.agentsDir` is a new optional field on `startServer(options)` — allows tests and
callers to inject an isolated directory without touching environment variables.

---

## 7. `bin/init.js` — `installAgents()` Extended

The existing `installAgents` copies files with skip-existing semantics and returns
`{ installed, skipped }`. After this feature:

1. After copying each file, compute `srcHash` and write a manifest entry.
2. For files that were skipped (already existed), still write a manifest entry using the
   **source hash** (not the dest hash). Rationale: `prism init` is idempotent by design;
   if the file is already there, we assume it's Prism's last write (init just re-confirms
   the baseline). If the user has edited it, the manifest entry will be "wrong" and the
   next auto-sync will detect the divergence and skip — correct behaviour.

**Note:** `installAgents` in init.js does NOT update existing files (that remains the
responsibility of auto-sync). Its semantics remain: copy if absent, skip if present.
The manifest write is additive.

Updated signature remains compatible: still returns `{ installed, skipped }`.

---

## 8. Data Flow Sequence

```
prism start
  │
  └─► startServer()
        │
        ├─ createStore()
        ├─ spaceManager.ensureAllSpaces()
        ├─ pipelineManager.init()
        ├─ resolve PIPELINE_AGENTS_DIR  ← from env or settings.json
        │
        ├─ syncAgents()                 ← NEW
        │     │
        │     ├─ read <agentsDir>/.prism-manifest.json
        │     ├─ for each agents/*.md:
        │     │     sha256(src) vs sha256(dest) vs manifest
        │     │     copy if safe, skip if user-modified
        │     └─ atomic write manifest (if changed)
        │
        ├─ createRouter()
        └─ server.listen(port)
```

---

## 9. File Layout

```
src/
  services/
    agentSync.js          ← NEW: sync logic + manifest read/write
server.js                 ← MODIFIED: call syncAgents() on startup
bin/
  init.js                 ← MODIFIED: installAgents writes manifest
tests/
  agent-sync.test.js      ← NEW: unit tests for agentSync.js
```

---

## 10. Key Invariants

| Invariant | Where enforced |
|-----------|---------------|
| Never writes to dest if user has modified it (manifest hash diverged) | `syncAgents()` CASE 2 else-branch |
| Manifest written atomically | `.tmp → rename` in `writeManifest()` |
| Sync is a no-op when source and dest are identical | CASE 2 IF inner-IF |
| Missing agents/ directory is tolerated (tolerate missing package dir) | early return in `syncAgents()` |
| Errors per-file do not abort remaining files | try/catch per file, push to `errors[]` |
| `options.agentsDir` injectable for test isolation | `startServer(options)` new field |

---

## 11. Observability

All log lines share the `[agent-sync]` prefix for easy `grep`:

```
[agent-sync] installed: developer-agent.md
[agent-sync] updated: senior-architect.md (prism v1.0.0 → v1.1.0)
[agent-sync] skipped (user-modified): ux-api-designer.md
[agent-sync] first-sync updated: qa-engineer-e2e.md (no prior baseline)
[agent-sync] synced 3, skipped (user-modified) 1
[agent-sync] nothing to do (9 agents up to date)
```

On `--silent` startup, all sync logs are suppressed.

---

## 12. Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `agents/` directory does not exist in package | return empty result, no-op |
| `agentsDir` does not exist | create it with `mkdirSync({ recursive: true })` |
| manifest exists but is malformed JSON | treat as empty manifest, log warning, proceed |
| file I/O error on a single agent | push to `errors[]`, continue with remaining files |
| src file is empty (0 bytes) | valid SHA-256 (`e3b0c4...`), copy normally |
| user deletes manifest | all existing files treated as no-baseline → migration-bias update |
| Prism version unchanged, agent unchanged | CASE 2 inner-IF → `noChange`, no disk write |
