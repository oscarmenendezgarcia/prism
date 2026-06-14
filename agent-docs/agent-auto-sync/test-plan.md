# Test Plan: Agent Auto-Sync on Server Startup (QOL-6)

**Feature:** Auto-sync of Prism agent files from `agents/*.md` → `PIPELINE_AGENTS_DIR` on every server startup, with safe-sync (skip user-modified files) via SHA-256 manifest.

**Date:** 2026-06-14
**QA Agent:** qa-engineer-e2e
**PR:** [#145](https://github.com/oscarmenendezgarcia/prism/pull/145)

---

## Executive Summary

The implementation is correct and complete. All acceptance criteria are met:

- ✅ Agents sync automatically on server startup without `prism init`
- ✅ User-customised files are never overwritten (manifest-divergence detection)
- ✅ Idempotent — second startup with no source changes is a pure no-op (no disk writes)
- ✅ `prism init` writes the manifest baseline so auto-sync immediately has protection on first startup

Two **Low** severity issues identified:
- Unused `const os = require('os')` import in `agentSync.js` (dead code)
- Missing "nothing to do" summary log in `server.js` for the steady-state case (blueprint §11 deviation)

Neither blocks merge. Zero Critical or High bugs.

**Security:** N/A — no user-supplied input, no HTTP endpoints, file operations limited to trusted Prism package directory (`agents/*.md`). No path traversal surface.

---

## Scope & Objectives

| Scope Item | Included |
|-----------|----------|
| `src/services/agentSync.js` — 3-case sync algorithm | ✓ |
| `server.js` — startup integration (lines 125–160) | ✓ |
| `bin/init.js` — `installAgents()` manifest write | ✓ |
| Full lifecycle: install → user edit → Prism upgrade → skip | ✓ |
| Edge cases: empty dir, malformed manifest, I/O errors | ✓ |
| Non-.md file exclusion | ✓ |
| Atomic manifest write | ✓ |
| `options.agentsDir` injection for test isolation | ✓ |
| Frontend / UI | N/A — backend-only feature |
| Performance tests | N/A — O(9 files × 10KB) < 10ms startup delta, non-sensitive path |

---

## Test Levels

### Unit Tests (existing — `tests/agent-sync.test.js`)
12 tests written by developer-agent, covering all algorithm cases and integration points.

### QA-added Tests (inline execution)
7 targeted scenarios executed directly via `node -e` to cover gaps not in the developer suite.

---

## Test Cases

| ID | Type | Description | Input | Expected Output | Priority | Result |
|----|------|-------------|-------|----------------|----------|--------|
| TC-001 | Unit | Empty agentsDir → all installed, manifest created | 2 agents, empty dest | synced=2, manifest written | Critical | PASS |
| TC-002 | Unit | Idempotent second call → noChange, no disk writes | Same src+dest | noChange=1, no mtime change | Critical | PASS |
| TC-003 | Unit | Source updated → file and manifest updated | Src v2 vs manifest v1 | synced=1, manifest hash=v2 | Critical | PASS |
| TC-004 | Unit | User edits dest → skipped on subsequent sync | dest≠manifest | skipped=1, dest unchanged | Critical | PASS |
| TC-005 | Unit | No manifest, src==dest → noChange, manifest baselined | No manifest, identical | noChange=1, manifest created | High | PASS |
| TC-006 | Unit | No manifest, src!=dest → migration-bias update | No manifest, different | synced=1, manifest created | High | PASS |
| TC-007 | Unit | Missing `agents/` source dir → empty result, no throw | src dir absent | all empty, no exception | High | PASS |
| TC-008 | Unit | Malformed manifest JSON → treated as empty, sync proceeds | Corrupt JSON | WARNING logged, synced=1 | High | PASS |
| TC-009 | Unit | Per-file I/O error → errors[], others processed | EISDIR on one file | errors=['a.md'], b.md processed | High | PASS |
| TC-010 | Unit | `prism init` installAgents → manifest with correct hashes | Fresh install | installed=2, manifest hashes match src | High | PASS |
| TC-011 | Unit | `prism init` idempotent → manifest consistent after two runs | Second init | skipped=1, manifest unchanged | Medium | PASS |
| TC-012 | Integration | `startServer options.agentsDir` → sync targets injected dir | custom agentsDir | manifest in custom dir, not ~/.claude | Critical | PASS |
| TC-013 | Unit | Non-.md files in agents/ not synced | .txt, .json alongside .md | only .md copied | Medium | PASS |
| TC-014 | Unit | `agentsDir` does not exist → auto-created | Non-existent dest path | dir created, agents installed | High | PASS |
| TC-015 | Unit | Zero-byte source agent file → handled normally | Empty .md | synced, hash=e3b0c4... | Low | PASS |
| TC-016 | Unit | Atomic manifest write — no .tmp left behind | writeManifest call | .tmp absent, real file present | High | PASS |
| TC-017 | E2E | Full lifecycle: install → user edit → Prism upgrade → skip | Full scenario | User content preserved exactly | Critical | PASS |
| TC-018 | Unit | Error logging still active in silent mode | errors.length>0 + silent | errors emitted to stderr regardless | Medium | PASS |
| TC-019 | Unit | Manifest preserved across partial syncs (removed src file) | Remove one src agent | Dest file + manifest entry preserved | Medium | PASS |
| TC-020 | Unit | Unused `os` import in agentSync.js | Static analysis | `os` imported but never used | Low | FAIL |
| TC-021 | Unit | "nothing to do" log absent for all-noChange case | Idempotent run | No summary line emitted (blueprint §11 deviation) | Low | FAIL |

---

## Environment Requirements

- Node.js ≥ 14.17 (crypto.randomUUID used elsewhere; SHA-256 available since v0.x)
- No new npm dependencies — uses `fs`, `path`, `crypto` (built-in)
- Server must be started with `options.agentsDir` pointing to isolated temp dir in tests

---

## Assumptions & Exclusions

- TC-009 uses EISDIR trick (file replaced by directory) to simulate read error; actual disk errors are not testable in CI without privilege escalation.
- The manifest is not tested against concurrent writes (two servers starting simultaneously) — this is documented as out-of-scope in the ADR.
- Non-.md files in `agents/` are excluded by the `filter(f => f.endsWith('.md'))` — no test covers a `.md` file that is actually a directory (OS-level weirdness); marked advisory.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| User-modified file overwritten | Low | Critical | manifest divergence check (confirmed working TC-004, TC-017) |
| Manifest corruption crash | Very Low | High | JSON parse guarded with try/catch (TC-008) |
| Sync failure crashes server | Very Low | Critical | entire sync block in try/catch in server.js |
| Migration-bias overwrites user file on first sync | Medium | High | only fires Case 3b (no manifest), which means Prism hasn't tracked the file before — acceptable one-time cost per ADR |
