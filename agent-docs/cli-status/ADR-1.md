# ADR-1: `prism status` — server-state CLI subcommand

## Status
Accepted

## Context
The Prism CLI (`bin/cli.js`) can `start`, `stop`, `init`, `update`, and `doctor`, but there is no
scriptable way to answer "is the server up, on what PID/port/version, and how many pipeline runs are
active?". Operators and shell scripts need a single command with a reliable exit code to gate other
actions (e.g. "only `prism stop` if `prism status` says running"). The task asks for a `prism status`
subcommand reporting server running/stopped, PID, port, version, active pipeline-run count, and the
SQLite path, with a human summary, a `--json` mode, and exit `0`=up / `1`=down.

Two facts constrain the design: (1) `prism.pid` stores **only** the PID — the port is not persisted
anywhere on disk (`bin/init.js:122`, `server.js:51`); (2) the live `GET /api/v1/runs` handler returns
the **full** run array and does **not** support a `?status=` filter (`src/handlers/pipeline.js:160`),
and the pipeline forbids restarting the running server, so a new server-side filter could not take
effect for this command anyway.

## Decision
Add a dedicated `bin/status.js` (mirroring `bin/stop.js`) that treats the **PID file + `process.kill(pid,0)`**
as the source of truth for "running", enriches with a best-effort, time-boxed `GET /api/v1/runs?status=running`
whose result is **counted client-side**, resolves the port as `--port ▸ PORT ▸ 3000`, and reports the
SQLite path as `<dataDir>/prism.db`. It exits `0` when the PID is alive, `1` otherwise, and degrades every
I/O failure to a defined state instead of a stack trace.

## Rationale
- **PID-as-truth** keeps `status` consistent with `stop`/`doctor` and correct while the server is booting
  or momentarily busy; the HTTP probe only adds the run count and an `api` reachability flag.
- **Client-side counting** works against *any* running server version with no restart and no new server
  surface; the `?status=running` query string is still sent so the wire call matches the spec and any
  future server-side filter is transparently compatible.
- **`bin/status.js` + DI seam** matches the codebase's one-file-per-subcommand, pure-helper, injectable
  pattern, making the mock-PID-file + mock-HTTP unit tests trivial and dependency-free.

## Consequences
- **Positive**: zero new dependencies; no server change; scriptable exit code; graceful when the server
  is down or wedged (1.5 s abort budget); reuses `readPidFile`/`isPidAlive` from `stop.js` (DRY).
- **Negative / Risks**:
  - *Port not persisted* → if the server was started on a non-default port and the `status` invocation
    doesn't pass `--port`/`PORT`, the HTTP probe fails and `activeRuns` reports `unknown` (server still
    correctly shown as running). **Mitigation**: document `--port`; PID-based "running" stays correct.
  - *Full run list transferred* → negligible for a local single-user tool.
  - *`status` field assumption* on run summaries. **Mitigation**: count defensively (`r.status === 'running'`),
    treat a missing field as not-running.

## Alternatives Considered
- **Add `?status=` filter to `handleListRuns`** — discarded: needs a server restart to take effect on the
  live pipeline host (forbidden), and adds server surface for a single consumer.
- **HTTP probe as the sole source of truth for "running"** — discarded: false "stopped" during boot / wrong
  port; inconsistent with `stop`/`doctor`.
- **Inline the handler in `cli.js`** — discarded: breaks the one-file-per-subcommand pattern and hurts testability.

## Review
Suggested review date: 2027-01-06 (+6 months)
