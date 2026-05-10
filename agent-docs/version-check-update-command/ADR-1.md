# ADR-1: Version Check and Update Command Architecture

## Status
Accepted

## Context

Prism is distributed via `npm install -g prism-kanban`. Users have no native feedback mechanism when a new version is published. They only discover updates by chance (running `npm outdated -g` manually) or when something breaks. The desired UX matches well-known CLIs (npm, gh, brew) that display a non-blocking upgrade notice at the bottom of command output and expose an explicit upgrade subcommand.

Two distinct capabilities are required:
1. A **startup version check** that compares the installed version against the npm registry and prints a non-blocking notice when behind.
2. A **`prism update` subcommand** that wraps `npm install -g prism-kanban@latest` with user confirmation.

Key constraints that shape the design:
- The check must never block CLI startup. Commands like `prism start` must start the server in normal latency. Even a 500 ms DNS hit is unacceptable on hot paths.
- The check must be cheap at scale: querying npm on every invocation wastes resources and produces noise. Cache TTL of 24 h is required.
- Offline and CI environments must be respected: timeout < 3 s, fail silently, `--no-update-check` flag to suppress entirely.
- No new runtime dependencies may be added to the main package. The fetch call must use Node 20's built-in `globalThis.fetch` (already used in `bin/init.js`).
- The cache must be stored outside the project's `data/` directory (which is env-driven and might not exist) and instead in a user-global location that survives reinstalls.

## Decision

Implement version checking as a standalone utility module `bin/update-check.js` that:
- Reads the installed version from `package.json`.
- Stores a JSON cache file at `~/.local/share/prism/update-cache.json` (or `$XDG_DATA_HOME/prism/update-cache.json`), mirroring the existing data-dir resolution logic but always using the user-global path (never the dev `.git` branch).
- Fires an async check in the background using `Promise.race` against a 2.5 s timeout; never `await`s the result on the hot path.
- Prints the notice to `stderr` only (not stdout) so it does not pollute piped output.
- Exposes a `scheduleUpdateCheck(flags)` function that callers invoke before their main work without `await`.

The `prism update` subcommand is implemented in `bin/update.js` and integrated into `bin/cli.js`:
- Prints installed vs. latest version.
- Asks for confirmation (y/N) using stdin in TTY mode; auto-confirms in non-TTY (CI-safe).
- Calls `npm install -g prism-kanban@latest` via `child_process.spawnSync` with inherited stdio so progress is visible.
- Exits 0 on success, 1 on failure.

## Rationale

**Why a separate `bin/update-check.js` module rather than inlining into `cli.js`?**
Single Responsibility Principle. `cli.js` is already responsible for argument parsing and dispatch. Extracting the check makes it independently testable and keeps the argparser under 200 lines.

**Why `~/.local/share/prism/update-cache.json` for the cache?**
The `dataDir.js` utility deliberately skips the home/XDG path when `.git` is detected (dev mode). The cache must persist globally regardless of whether the user is developing Prism locally. Using a fixed XDG/home path decouples the cache lifecycle from the data directory mode. The path is consistent with XDG conventions already adopted by `dataDir.js`.

**Why `Promise.race` with a 2.5 s timeout instead of `setTimeout` + `unref()`?**
`unref()` on a timer keeps the process alive until the event loop drains naturally, which is fine for `prism start` (long-lived) but would silently extend the lifetime of short commands like `prism --version`. `Promise.race` lets us print the notice before the main command completes if the network responds quickly, and cancel cleanly if it doesn't — with no process lifetime side effects.

**Why print to stderr, not stdout?**
Version notices are advisory metadata, not command output. Printing to stderr prevents breakage in scripts that capture `prism start` stdout or pipe it to log processors.

**Why TTY detection for the `prism update` confirmation prompt?**
In CI (non-TTY), blocking for user input would hang the process indefinitely. Auto-confirming in non-TTY is the convention used by npm, brew, and gh.

**Why `spawnSync` for the npm install step?**
`prism update` is an explicit user action that should display live progress (npm's download bar). `spawnSync` with `stdio: 'inherit'` achieves this with minimal code. The synchronous nature is intentional: the command has no other work to do while npm runs.

## Consequences

**Positive**:
- Users get timely, unobtrusive upgrade notifications matching industry-standard CLI UX.
- The `prism update` command reduces friction: one command, confirmed, done.
- Zero new runtime dependencies — uses Node 20 built-ins only.
- Cache prevents rate-limiting and avoids redundant network calls.
- Offline and CI environments see no degradation.
- Fully testable: cache path, fetch, TTY flag, and npm invocation are all injectable.

**Negative / Risks**:
- The cache file at `~/.local/share/prism/update-cache.json` is a new persistent artifact outside the project. Risk: users with read-only home directories silently skip the cache (acceptable — check still runs, just every time). Mitigation: wrap cache writes in try/catch; cache miss is never fatal.
- `npm install -g` in `prism update` requires npm to be in PATH and the user to have global install permissions. Risk: sudo-required installs may fail. Mitigation: clear error message directing user to run with elevated permissions or use `sudo`.
- Adding `prism update` to the dispatch table slightly increases binary size and test surface. Negligible.

## Alternatives Considered

- **`update-notifier` npm package**: Widely used but adds a runtime dependency, uses a background child process that can leave zombie entries, and has known issues with pnpm/yarn global installs. Rejected: zero-dependency constraint.
- **Storing cache in `data/` (the configured data dir)**: Path is environment-driven and may not exist without running `prism init`. Rejected: cache must be available before init and across data-dir changes.
- **Blocking check before command execution**: Simple but violates the non-blocking requirement. Any network hiccup adds latency to `prism start`. Rejected.
- **Check only on `prism start`**: More targeted but users running only `prism init` or `prism update` would never see notices. Rejected: check should fire on all subcommands.

## Review
Suggested review date: 2026-11-10
