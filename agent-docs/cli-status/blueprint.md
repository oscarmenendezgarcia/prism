# Blueprint — `prism status` CLI subcommand

## 1. Requirements Summary

### Functional
- New CLI subcommand `prism status` that reports the state of the local Prism server.
- Human-readable summary to **stdout** by default.
- Machine-readable JSON with `--json`.
- Reported fields: server running/stopped, PID, port, version, active pipeline runs count, dataDir, SQLite path, API reachability.
- Exit code contract: **0 = server running**, **1 = server stopped** (scriptable).
- Must work with **no running server** (graceful "not running" message, no stack trace).
- Unit tests covering the logic with a mocked PID file and mocked HTTP response.

### Non-Functional
- **Zero new dependencies** — Node stdlib + existing `src/utils/dataDir.js` only (matches `stop.js`, `doctor.js`).
- **Fast**: a single HTTP request, short timeout (~1.5 s) so `status` never hangs on a wedged server.
- **Testable**: pure helpers + dependency-injection `run(flags, deps)` seam, exactly like `bin/stop.js`.
- **Consistent** with existing CLI UX (flag names, `--data-dir`, `--json`, exit-code semantics, `resolveDataDir`).

### Constraints discovered in the codebase
| Fact | Source | Impact on design |
|------|--------|------------------|
| `prism.pid` contains **only** the PID (`String(pid)+'\n'`) | `bin/init.js:122` | Port is **not** persisted → must be resolved from flag/env/default. |
| Port = `--port` ▸ `PORT` env ▸ `3000` | `server.js:51`, `bin/cli.js` parser | Reuse the same resolution order for `status`. |
| `GET /api/v1/runs` returns a **full array**; **no** `?status=` filter server-side | `src/handlers/pipeline.js:160` `handleListRuns` → `pipelineManager.listRuns` | Count `running` **client-side**; do not add a server route (would need a server restart the pipeline forbids). |
| Each run summary has a `status` field (`running`/`completed`/`interrupted`/…) | `pipelineManager.listRuns` / folio `run-history-zombie` lesson | `activeRuns = runs.filter(r => r.status === 'running').length`. |
| SQLite path = `<dataDir>/prism.db` | `src/services/store.js:222` | `sqlitePath = path.join(dataDir, 'prism.db')`. |
| Liveness = `process.kill(pid, 0)` | `bin/stop.js:59` `isPidAlive` | Reuse the same primitive as source-of-truth for "running". |
| `resolveDataDir({env,packageRoot,homedir})` → `{path,mode}` | `src/utils/dataDir.js` | Reuse verbatim; honour `--data-dir` override first. |

## 2. Trade-offs

### T1 — Running-count source: server-side `?status=running` filter vs client-side count
- **Option A — add `?status=` filter to `handleListRuns`.** Pro: matches the task's literal URL; smaller payload. Con: the change only takes effect after a **server restart**, and the pipeline explicitly forbids restarting the running server; `status` would query a live server that predates the filter and silently get *all* runs, breaking the count. Adds server surface + a test for a filter no client but this one needs.
- **Option B — fetch `GET /api/v1/runs`, count `status==='running'` in the CLI.** Pro: works against **any** running server version (no restart, no coupling to server deploy); keeps the change contained to `bin/`. Con: transfers the full run list (small, local, single-user tool — negligible).
- **Recommendation: B.** Correctness against the *currently running* server outweighs payload size. The `?status=running` query string is still appended to the request (harmlessly ignored by the current handler) so the wire call matches the task description and a future server-side filter is transparently compatible. **Deviation noted** on the Kanban task.

### T2 — Liveness detection: PID+signal-0 vs HTTP probe
- **Option A — HTTP probe is the source of truth.** Pro: proves the API actually serves. Con: a booting or momentarily-busy server (or wrong port) reads as "stopped" → false negatives; inconsistent with `stop`/`doctor`.
- **Option B — PID file + `process.kill(pid,0)` is the source of truth; HTTP probe is best-effort enrichment for the runs count + API reachability flag.**
- **Recommendation: B.** "Running" == the process exists (authoritative, matches `stop.js`/`doctor.js`). If the PID is alive but the API is unreachable (booting / wrong port / wedged), report **running** with `activeRuns: null` and `api: "unreachable"` rather than lying about the process. Exit code still 0.

### T3 — File layout: inline in `cli.js` vs dedicated `bin/status.js`
- **Option A — inline handler in `cli.js`.** Pro: fewer files. Con: breaks the established one-file-per-subcommand pattern (`stop.js`, `doctor.js`, `init.js`, `update.js`), harder to unit-test in isolation.
- **Option B — `bin/status.js` exporting `run(flags, deps)` + pure helpers, wired into `cli.js`.**
- **Recommendation: B.** Mirror `bin/stop.js` exactly: pure exported helpers (`readPidFile`, `isPidAlive`, `resolvePort`, `fetchActiveRunCount`, `buildStatus`, `formatText`, `formatJson`) and a DI seam so tests inject a fake PID file and a fake fetch with no real process/socket.

## 3. Architecture

### 3.1 Components
| Component | Responsibility | Tech | Notes |
|-----------|----------------|------|-------|
| `bin/status.js` | Orchestrate the status command | Node stdlib | New file; mirrors `bin/stop.js` structure. |
| `readPidFile(dataDir)` | Read+parse `prism.pid` → `number\|null` | fs | **Reuse** logic identical to `stop.js`; may import from `stop.js` to avoid duplication (see 3.4). |
| `isPidAlive(pid)` | `process.kill(pid,0)` liveness | os | Same — reuse from `stop.js`. |
| `resolvePort(flags, env)` | `--port` ▸ `PORT` ▸ `3000` → number | — | Pure. |
| `fetchActiveRunCount(port, deps)` | `GET /api/v1/runs?status=running`, count `status==='running'` | `globalThis.fetch` + `AbortController` | Timeout ~1.5 s; returns `{count:number}` or `{count:null, reason}` on any failure. |
| `buildStatus(inputs)` | Pure assembler → the status object (single source for text+JSON+exit) | — | No I/O; 100 % unit-testable. |
| `formatText(status)` / `formatJson(status)` | Render | — | `formatJson` = `JSON.stringify(status)`; text = aligned key/value block, optional ANSI + `NO_COLOR`/TTY guard like `doctor.js`. |
| `run(flags, deps)` | Wire it together, choose exit code | — | DI seam: `_readPidFile,_isPidAlive,_fetchActiveRunCount,_exit,_stdout,_stderr`. |
| `bin/cli.js` | Register `status` in parser/switch/USAGE | — | ~6-line edit; `--json`/`--port`/`--data-dir` already parsed. |

### 3.2 Main flow

```mermaid
sequenceDiagram
    actor U as User / script
    participant CLI as bin/cli.js
    participant S as bin/status.js
    participant FS as prism.pid
    participant API as Prism HTTP :port

    U->>CLI: prism status [--json] [--port n] [--data-dir p]
    CLI->>S: run(flags)
    S->>S: resolveDataDir() / flags.dataDir
    S->>FS: readPidFile(dataDir)
    alt no pid file OR pid not alive
        S-->>U: "prism is not running" (text) / {running:false} (json)
        S-->>U: exit 1
    else pid alive
        S->>API: GET /api/v1/runs?status=running (timeout 1.5s)
        alt API reachable
            API-->>S: [ {status:'running'}, ... ]
            S->>S: activeRuns = count(status==='running'); api='reachable'
        else API unreachable / timeout / non-200
            S->>S: activeRuns = null; api='unreachable'
        end
        S-->>U: readable summary / JSON object
        S-->>U: exit 0
    end
```

### 3.3 Interfaces / Contracts

**CLI**
```
prism status [--json] [--port <n>] [--data-dir <path>]
```
- `--json`   machine-readable output
- `--port`   port to probe (default: PORT env or 3000)
- `--data-dir` override data directory (env: DATA_DIR)

**Outbound HTTP:** `GET http://127.0.0.1:<port>/api/v1/runs?status=running` — Accept `application/json`, 1.5 s abort budget. Any error/timeout/non-200 ⇒ `activeRuns: null`, `api:"unreachable"` (never throws to the user).

**JSON output schema** (`--json`, always a single line + trailing `\n`):
```json
{
  "running":    true,
  "pid":        12345,
  "port":       3000,
  "version":    "1.2.0",
  "activeRuns": 2,
  "dataDir":    "/Users/x/.local/share/prism",
  "sqlitePath": "/Users/x/.local/share/prism/prism.db",
  "api":        "reachable"
}
```
Stopped case:
```json
{ "running": false, "pid": null, "port": 3000, "version": "1.2.0",
  "activeRuns": null, "dataDir": "...", "sqlitePath": ".../prism.db", "api": "unreachable" }
```
`activeRuns` is `null` (unknown) when running-but-API-unreachable, a non-negative integer when reachable, `null` when stopped.

**Text output (running):**
```
prism status

  Server       running (pid 12345)
  Port         3000
  Version      1.2.0
  Active runs  2
  Data dir     /Users/x/.local/share/prism
  SQLite       /Users/x/.local/share/prism/prism.db
```
**Text output (stopped):**
```
prism status

  Server   not running
  Version  1.2.0
  Data dir /Users/x/.local/share/prism
  SQLite   /Users/x/.local/share/prism/prism.db
```
Running-but-API-unreachable adds: `Active runs  unknown (API not responding on port 3000)`.

**Exit codes:** `0` running · `1` stopped. (Usage errors are caught earlier by `cli.js` → exit 2.)

### 3.4 Reuse decision (DRY)
`readPidFile` and `isPidAlive` already exist and are exported from `bin/stop.js`. **Import them** into `status.js` (`const { readPidFile, isPidAlive } = require('./stop.js')`) rather than re-implementing — single source of truth for PID semantics. `status.js` still re-exports them for its own tests + accepts DI overrides so tests never touch the real filesystem/process table.

### 3.5 Observability & failure handling
- No server-side change → no new metrics. CLI writes only to stdout/stderr.
- **Fail-safe, never fail-hard**: every I/O (`readPidFile`, `fetch`) is guarded; a malformed `prism.pid`, ENOENT, connection-refused, DNS, or timeout each degrade to a defined state, never a stack trace on stdout. Fatal-guard wrapper on direct invocation prints to **stderr** and exits 1 (matches `doctor.js`/`stop.js`).
- HTTP uses `AbortController` with a 1.5 s deadline so `status` is bounded even against a hung server.

### 3.6 Security
- Probes `127.0.0.1` only (loopback), read-only `GET`. No auth surface, no writes, no new endpoints. Least-privilege preserved.

## 4. Testing strategy
New file `tests/cli.status.test.js` (Node `node:test`, mirrors `tests/cli.stop.test.js`):
- **PID mocking** via injected `_readPidFile` / `_isPidAlive` (no real fs/process).
- **HTTP mocking** via injected `_fetchActiveRunCount` returning canned `{count}` / `{count:null}` — no real socket.
- Assert on captured `_stdout`/`_stderr` writes and the `_exit` code.
- Cases: (1) no pid file → stopped, exit 1, text + `{running:false}`; (2) stale pid (not alive) → stopped, exit 1; (3) alive + API ok → running, exit 0, `activeRuns=N`, JSON shape; (4) alive + API unreachable → running, exit 0, `activeRuns=null`, `api:"unreachable"`; (5) `--json` shape/keys for running & stopped; (6) `resolvePort` precedence (flag>env>default); (7) `buildStatus` pure-function table; (8) malformed pid file → treated as stopped.
- Target > 90 % coverage of `bin/status.js` (pure helpers make this trivial).

## 5. Deployment
- Pure additive change to a shipped npm bin. No migration, no data change, no server restart. Ships in the next `prism` release; picked up by `npx`/global install automatically.
