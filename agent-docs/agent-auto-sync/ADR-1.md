# ADR-1: Agent Auto-Sync on Server Startup

## Status
Accepted

## Context

When Prism is updated via `npm install -g prism-kanban@latest`, the agent definition
files shipped in `agents/` do not reach the runtime directory (`~/.claude/agents/`) unless
the user explicitly runs `prism init` or copies the files by hand. This creates real
friction: activating WORKTREE-1 required manually copying `developer-agent.md` because the
auto-update flow (`prism update`) installs the new package but does not propagate new or
changed agent definitions to the runtime directory.

The `prism init` command performs an `installAgents` step that copies `agents/*.md` →
`~/.claude/agents/`, but only runs once (or when explicitly invoked). There is no
equivalent hook on every startup.

A safe auto-sync must distinguish between:
1. Agent files that Prism last installed (safe to overwrite with a newer version).
2. Agent files the user has customised (must not be overwritten).

Without tracking what Prism last wrote, these two cases are indistinguishable.

## Decision

Introduce a **SHA-256 manifest** (`<agentsDir>/.prism-manifest.json`) that records the
checksum of every agent file the last time Prism wrote it. On each server startup,
`syncAgents()` compares source hashes (from `agents/`) against destination hashes and the
manifest to decide whether to update each file.

The sync runs synchronously inside `startServer()` in `server.js`, after
`PIPELINE_AGENTS_DIR` is resolved from settings/env but before the HTTP server binds.
Results are logged at `[agent-sync]` level.

`prism init` is updated to write the same manifest after copying files, so the manifest
is bootstrapped on fresh installs and the two code paths share state from day one.

## Rationale

**Manifest over mtime**: `npm install` does not preserve file modification times reliably,
making mtime an unreliable proxy for "was this written by Prism?". A content hash stored
in the manifest is deterministic and portable.

**SHA-256 over version tags**: Embedding a version comment inside agent `.md` files would
couple the file format to the packaging system. The manifest is an out-of-band sidecar
that keeps agent files clean and readable without format intrusion.

**Sync at `startServer()` over CLI-only entrypoints**: The server can be launched via
`node server.js` (direct) or `prism start` (CLI). Hooking into `startServer()` covers
both paths with a single code change. The sync is idempotent and fast (<100 ms for 9
small files), so running it on every startup has no meaningful cost.

**Update-on-first-sync (migration bias)**: When no manifest entry exists for a file that
already lives in the destination (i.e., installed by a pre-manifest `prism init`), but
the source and destination hashes differ, the file is updated and the new hash is recorded
in the manifest. Rationale: pipeline agent files are system-provided definitions, not
user-authored content; the practical risk of overwriting a user customisation on the
one-time migration pass is low, and the benefit (agents up-to-date after upgrade without
any manual step) is high. A clear log message is emitted for each file updated this way.

**No new dependencies**: SHA-256 is provided by Node.js built-in `crypto`. The manifest
is plain JSON written atomically via `.tmp → rename`.

## Consequences

### Positive
- Agent definitions propagate to the runtime directory automatically on every server
  start, eliminating the need for `prism init` after an update.
- Idempotent: multiple startups with the same Prism version and unmodified agents
  produce no file writes after the first pass.
- Protects user customisations from the second sync onward (manifest hash diverges from
  destination hash the moment the user edits a file).
- `prism init` + auto-sync share state via the same manifest format — no duplicate logic.
- Zero new npm dependencies.

### Negative / Risks
- **One-time migration write**: On the first server startup after the feature is deployed,
  any agent file whose source differs from the installed destination is overwritten (even
  if the user had customised it). Mitigation: log line per file makes this visible; users
  who do customise agents can re-apply their edits — the manifest will then protect them
  on all future upgrades.
- **Startup I/O**: Reads and SHA-256-hashes 9 small files on every server start. At
  ~10 KB each, this adds <10 ms and is dominated by the SQLite open already on the critical
  path. Not a concern.
- **Manifest drift**: If a user deletes `.prism-manifest.json`, all existing agent files
  are treated as "no baseline" and updated on the next startup. This is the correct
  fallback (same as migration case).
- **Test isolation**: Tests that call `startServer()` with a custom `dataDir` will
  also trigger agent sync against the resolved `agentsDir` (default: `~/.claude/agents/`).
  This is harmless (idempotent) but writes to the developer's real agent directory. Tests
  that need full isolation can set `PIPELINE_AGENTS_DIR` to a temp dir or pass
  `options.agentsDir` to `startServer`.

## Alternatives Considered

- **Version comment inside agent files** (`<!-- prism-version: 1.1.0 -->`): discarded —
  intrusive file format change, brittle to parse, conflicts with the agent system prompt
  content.
- **Sync only on `prism update` or `prism init`**: discarded — the user pain point is
  that they forget to run these commands; that is the exact problem being solved.
- **Skip update when no manifest entry** (conservative migration): discarded — produces
  a confusing "two-startup" experience where agents are not updated on the first restart
  after an upgrade; requires a second restart to take effect.

## Review
Suggested review date: 2026-12-14
