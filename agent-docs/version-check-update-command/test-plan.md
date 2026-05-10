# Test Plan: Version Check + `prism update` Command

## Executive Summary

This is a CLI-only feature — no web UI, no Playwright needed. The test strategy focuses on unit and integration tests for three modules: `bin/update-check.js`, `bin/update.js`, and the `bin/cli.js` integration layer. One Medium and one Low bug were identified during static code review.

**Merge gate status: NOT MET** — one Medium unresolved bug (downgrade offered when dev build installed).

---

## Scope & Objectives

| In scope | Out of scope |
|----------|-------------|
| `bin/update-check.js` — cache, fetch, notice | Real npm registry calls |
| `bin/update.js` — TTY/non-TTY flow, exit codes | UI / Playwright testing |
| `bin/cli.js` — flag parsing, env var, subcommand dispatch | Performance testing |
| Exit code correctness (0/1/2) | Security scanning |

---

## Test Levels

### Unit Tests (Node.js `node:test`)

Tests are in `tests/update-check.test.js`, `tests/update.test.js`, and `tests/cli.test.js`.

### Integration Tests

`tests/cli.test.js` spawns `bin/cli.js` via `spawnSync` to validate real process behavior.

### E2E Tests

Not applicable — CLI-only feature, no browser.

### Performance Tests

Not applicable — async check is fire-and-forget with 2.5s timeout by design.

### Security Tests

Not applicable for this feature scope (no HTTP endpoints, no user data persistence, no auth).

---

## Test Cases

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-001 | unit | isCacheValid: null returns false | null | false | High |
| TC-002 | unit | isCacheValid: missing checkedAt returns false | {latestVersion: '1.0.0'} | false | High |
| TC-003 | unit | isCacheValid: missing latestVersion returns false | {checkedAt: now} | false | High |
| TC-004 | unit | isCacheValid: non-string latestVersion returns false | {checkedAt: now, latestVersion: 123} | false | Medium |
| TC-005 | unit | isCacheValid: fresh cache returns true | {checkedAt: now, latestVersion: '1.0.0'} | true | High |
| TC-006 | unit | isCacheValid: cache older than 24h returns false | {checkedAt: now-25h, ...} | false | High |
| TC-007 | unit | isCacheValid: cache just under 24h returns true | {checkedAt: now-23.99h, ...} | true | High |
| TC-008 | unit | isNewer: equal versions returns false | '1.0.0', '1.0.0' | false | High |
| TC-009 | unit | isNewer: patch bump returns true | '0.6.0', '0.6.1' | true | High |
| TC-010 | unit | isNewer: patch downgrade returns false | '0.6.1', '0.6.0' | false | High |
| TC-011 | unit | isNewer: minor bump returns true | '0.6.0', '0.7.0' | true | High |
| TC-012 | unit | isNewer: minor downgrade returns false | '0.7.0', '0.6.0' | false | High |
| TC-013 | unit | isNewer: major bump returns true | '0.9.9', '1.0.0' | true | High |
| TC-014 | unit | isNewer: major downgrade returns false | '1.0.0', '0.9.9' | false | High |
| TC-015 | unit | isNewer: minor differs, patch smaller | '1.1.9', '1.2.0' | true | Medium |
| TC-016 | unit | getCachePath: respects PRISM_UPDATE_CACHE env | env set | custom path | High |
| TC-017 | unit | getCachePath: uses XDG_DATA_HOME when set | env set | XDG path | High |
| TC-018 | unit | getCachePath: falls back to ~/.local/share | env unset | default path | High |
| TC-019 | unit | readCache: returns null for non-existent file | missing path | null | High |
| TC-020 | unit | readCache: returns null for malformed JSON | corrupt file | null | High |
| TC-021 | unit | writeCache: creates dirs and writes valid JSON | version string | file on disk | High |
| TC-022 | unit | writeCache: does not throw on read-only path | /proc/... path | no exception | High |
| TC-023 | unit | readCache: reads back what writeCache wrote | round-trip | same version | High |
| TC-024 | unit | fetchLatestVersion: returns version from mock response | mock fetch | '1.5.0' | High |
| TC-025 | unit | fetchLatestVersion: rejects on network failure | fail fetch | rejected | High |
| TC-026 | unit | fetchLatestVersion: rejects on timeout | slow fetch 200ms, timeout 50ms | rejected | High |
| TC-027 | unit | fetchLatestVersion: rejects on missing version field | bad response | rejected | High |
| TC-028 | unit | scheduleUpdateCheck: no-op when noUpdateCheck=true | flags.noUpdateCheck=true | no fetch, no stderr | High |
| TC-029 | unit | scheduleUpdateCheck: no-op when silent=true | flags.silent=true | no fetch, no stderr | High |
| TC-030 | unit | scheduleUpdateCheck: prints notice to stderr on update | mock 99.9.9 | notice in stderr | High |
| TC-031 | unit | scheduleUpdateCheck: writes cache file after fetch | mock 99.9.9 | cache file exists | High |
| TC-032 | unit | scheduleUpdateCheck: no output when version equals installed | mock installed ver | empty stderr | High |
| TC-033 | unit | scheduleUpdateCheck: no output on network failure | fail fetch | empty stderr | High |
| TC-034 | unit | scheduleUpdateCheck: skips fetch when cache valid | fresh cache | fetch not called | High |
| TC-035 | unit | scheduleUpdateCheck: fetches when cache stale | 25h-old cache | fetch called | High |
| TC-036 | unit | printUpdateNotice: writes to stderr not stdout | call fn | stderr has versions | High |
| TC-037 | unit | printUpdateNotice: correct format with ✦ symbol | '0.6.0', '0.7.0' | correct string | High |
| TC-038 | unit | update.js: already up to date → exit 0, message | installed ver = latest | stdout has message | High |
| TC-039 | unit | update.js: user confirms with 'y' → spawnSync called | TTY + 'y' input | npm install spawned | High |
| TC-040 | unit | update.js: user confirms with 'yes' → spawnSync called | TTY + 'yes' | npm install spawned | High |
| TC-041 | unit | update.js: user confirms with 'Y' → spawnSync called | TTY + 'Y' | npm install spawned | High |
| TC-042 | unit | update.js: user declines with 'n' → Cancelled., exit 0 | TTY + 'n' | "Cancelled." | High |
| TC-043 | unit | update.js: Enter (empty) → Cancelled., exit 0 | TTY + '' | "Cancelled." | High |
| TC-044 | unit | update.js: non-TTY auto-confirms → spawnSync called | isTTY=false | npm install spawned | High |
| TC-045 | unit | update.js: success message after npm exit 0 | mockSpawn(0) | "✓ Updated to v..." | High |
| TC-046 | unit | update.js: npm exit 1 → stderr error, exit 1 | mockSpawn(1) | error in stderr | High |
| TC-047 | unit | update.js: npm exit 127 → shows code 127 | mockSpawn(127) | 127 in stderr | High |
| TC-048 | unit | update.js: fetch failure → error message, exit 1 | failFetch | error in stderr | High |
| TC-049 | unit | update.js: prompt shows installed and latest version | TTY + 'n' | versions in stdout | High |
| TC-050 | integration | cli.js: --version exits 0 with package version | --version | version string | High |
| TC-051 | integration | cli.js: -v exits 0 with package version | -v | version string | High |
| TC-052 | integration | cli.js: --help exits 0 with usage | --help | usage text | High |
| TC-053 | integration | cli.js: -h exits 0 | -h | usage text | High |
| TC-054 | integration | cli.js: no subcommand exits 0 | (none) | usage text | High |
| TC-055 | integration | cli.js: unknown subcommand exits 2 | bogus | exit 2 | High |
| TC-056 | integration | cli.js: 'deploy' exits 2 | deploy | exit 2 | High |
| TC-057 | integration | cli.js: init with --data-dir exits 0 | init + temp dir | exit 0, settings.json | High |
| TC-058 | integration | cli.js: init is idempotent | init twice | settings.json mtime unchanged | Medium |
| TC-059 | integration | cli.js: init --force overwrites settings.json | init --force | pipeline key present | Medium |
| TC-060 | integration | cli.js: --no-update-check no unknown-flag warning | --no-update-check --version | no warning | High |
| TC-061 | integration | cli.js: --help includes 'update' | --help | 'update' in stdout | High |
| TC-062 | integration | cli.js: --help includes '--no-update-check' | --help | flag in stdout | High |
| TC-063 | integration | cli.js: PRISM_NO_UPDATE_CHECK=1 works | env var set | exit 0 | High |
| TC-064 | integration | cli.js: 'prism update' is recognized (not exit 2) | update subcommand | exit != 2 | High |
| TC-MM-01 | manual | PRISM_NO_UPDATE_CHECK=0 should NOT suppress check | env=0 | check still runs | High |
| TC-MM-02 | manual | Installed > latest (dev build): no downgrade offered | installed > npm | "already latest" message | Medium |

---

## Environment Requirements

- Node.js >= 18.0.0 (for `globalThis.fetch`)
- No npm registry network access required (all tests use mocks)
- OS: macOS / Linux (tests use `/tmp` for temp dirs)
- `PRISM_UPDATE_CACHE` env var used to redirect cache to temp dirs during tests

---

## Assumptions & Exclusions

1. **Assumption**: `--silent` flag suppression of the version check is intentional (mirrors `noUpdateCheck` behavior). This is not explicitly in the user stories but is in the implementation.
2. **Assumption**: The `prism update` command does not call `scheduleUpdateCheck` before updating — this is correct behavior since update.js fetches version directly.
3. **Exclusion**: Real npm registry connectivity not tested.
4. **Exclusion**: `pipeline-templates.test.js` and `terminal.test.js` excluded from runs (known hangers per agent memory).

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| PRISM_NO_UPDATE_CHECK=0 treated as truthy (suppresses check) | Medium | Fix: use explicit check `!== '' && !== '0'` |
| Installed > latest triggers downgrade prompt in prism update | Medium | Fix: use isNewer() from update-check.js |
| Node.js < 18 lacks globalThis.fetch | Low | Add engines field to package.json |
| Cache dir creation race in concurrent invocations | Low | mkdirSync with {recursive: true} is safe |
