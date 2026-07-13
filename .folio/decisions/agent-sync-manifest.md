---
title: Agent Auto-Sync: SHA-256 Manifest + Migration-Bias on First Sync
author: agent
pinned: false
created: 2026-06-14T16:07:53.920Z
updated: 2026-06-14T16:07:53.920Z
---

# Agent Auto-Sync: SHA-256 Manifest + Migration-Bias on First Sync

## Context

Prism ships pipeline agent definitions in `agents/` (repo) and must sync them to `~/.claude/agents/` (runtime) on server startup without overwriting user customisations.

## Decision 1 — SHA-256 sidecar manifest over mtime or version comments

A `.prism-manifest.json` sidecar file tracks `{ managed: { "<filename>": { hash: "<sha256-of-src>" } } }` for every agent file Prism has written.

**Why not mtime?** npm install does not preserve file modification times on global installs. mtime comparison would falsely flag all files as changed on every install.

**Why not version comments inside agent `.md` files?** That couples packaging metadata to agent prompt content, is brittle to parse, and is intrusive to the file format.

**Why manifest?** Standard package-manager pattern: clean, deterministic, zero file-format intrusion. The hash is always sourced from the **source** file (`agents/<name>.md`), never from the destination — so any user edit to the destination produces a hash mismatch, which is the guard.

## Decision 2 — Migration bias on first sync (no manifest entry → update)

When no manifest entry exists for a file (e.g. upgrading from a pre-manifest Prism version), the sync **updates** the destination rather than skipping it.

**Why not skip?** The conservative option produces a confusing two-startup experience: agents don't update on the first restart after an upgrade, only on the second. There is also no evidence of user touch without a prior manifest entry.

**Why update?** This is a one-time, logged event (`"first-sync updated"`). From the second sync onward, the manifest protects all user customisations via hash comparison.

## Three-case algorithm (summary)

- **Case 1** — no manifest entry: write file, record hash (migration bias).
- **Case 2a** — manifest entry exists, src hash == manifest hash, dst hash == manifest hash: no-op (`noChange`).
- **Case 2b** — manifest entry exists, src hash ≠ manifest hash, dst hash == manifest hash: update (source changed, user hasn't touched destination).
- **Case 2c** — manifest entry exists, src hash ≠ manifest hash, dst hash ≠ manifest hash: skip (`userModified`, log warning).
- **Case 3** — src hash == manifest hash, dst hash ≠ manifest hash: skip (`userModified`).

## Integration point

Sync runs inside `startServer()` (not just CLI entrypoints like `prism start`) so `node server.js` direct invocations are also covered. The sync is O(9 files × ~10 KB) ≈ <10 ms — dominated by the SQLite open already on the startup critical path.

For test isolation, `startServer()` accepts `options.agentsDir` to redirect sync to a temp directory without touching `~/.claude/agents/`.

## Key files

- `src/services/agentSync.js` — core logic
- `bin/init.js` — writes the initial manifest on `prism init`
- `server.js` — integration block after `pipelineManager.init()`
- `tests/agent-sync.test.js` — 12 unit tests (all use `withTempDir`)
