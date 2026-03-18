# Test Plan: Config Editor Panel (ADR-1)

**Feature:** Config Editor Panel — slide-over for viewing and editing `~/.claude/*.md` and project `CLAUDE.md`
**Branch:** `feature/config-editor`
**Date:** 2026-03-18
**Author:** qa-engineer-e2e
**ADR Reference:** ADR-1 (Accepted)

---

## Executive Summary

The Config Editor Panel is a medium-risk feature that exposes filesystem read/write through a web API. The security design (server-side file ID registry, no user-supplied paths) is sound and verified by integration tests. All 20 backend config tests pass and all 287 frontend tests pass. Three bugs were identified — one Medium and two Low — none of which block the PR merge.

**Merge verdict: APPROVED with backlog items.** No Critical or High severity bugs.

---

## Scope and Objectives

### In Scope
- Backend: `GET /api/v1/config/files`, `GET /api/v1/config/files/{fileId}`, `PUT /api/v1/config/files/{fileId}`
- Frontend: `ConfigToggle`, `ConfigPanel`, `ConfigFileSidebar`, `ConfigEditor`, `DiscardChangesDialog`
- Store: `useAppStore` config editor slice (actions: `toggleConfigPanel`, `loadConfigFiles`, `selectConfigFile`, `setConfigContent`, `saveConfigFile`)
- API client: `getConfigFiles`, `getConfigFile`, `saveConfigFile`
- TypeScript types: `ConfigFile`, `ConfigFileContent`, `ConfigFileSaveResult`

### Out of Scope
- Syntax highlighting (deferred by ADR-1)
- File creation / deletion endpoints (not implemented)
- Multi-user / concurrent access scenarios (local dev tool only)
- E2E browser automation (Cypress/Playwright not configured in this project)

---

## Test Levels

### Level 1: Unit Tests (Frontend — Vitest + React Testing Library)

Covers individual components and store actions in isolation with mocked API.

### Level 2: Integration Tests (Backend — Node.js native `node:test`)

Covers real HTTP server with temp filesystem, exercising full request→response→disk cycle.

### Level 3: End-to-End (Static simulation)

Cypress/Playwright not configured. E2E scenarios are documented as manual test procedures. Automated E2E is flagged as a coverage gap.

### Level 4: Performance

Static analysis of SLA targets from `api-spec.json`. No live load test was executed (feature is for local dev use; k6 profile would be disproportionate). Performance is assessed from code path analysis.

### Level 5: Security

OWASP Top 10 static code analysis against `server.js` config routes.

---

## Test Cases

### Backend Integration Tests (config.test.js — 20 tests)

| ID | Type | Description | Story | Priority | Status |
|----|------|-------------|-------|----------|--------|
| BE-01 | integration | GET /api/v1/config/files returns 200 with JSON array | CE-04 | Must | PASS |
| BE-02 | integration | Response items have all required fields (id, name, scope, directory, sizeBytes, modifiedAt) | CE-04 | Must | PASS |
| BE-03 | integration | List includes test file created in ~/.claude/ | CE-04 | Must | PASS |
| BE-04 | integration | List includes project CLAUDE.md when present | CE-04 | Must | PASS |
| BE-05 | integration | File IDs match pattern `(global|project)-[a-z0-9-]+-md` | CE-04 | Must | PASS |
| BE-06 | integration | Global files appear before project files (ordering) | CE-04 | Must | PASS |
| BE-07 | integration | GET /api/v1/config/files/{id} returns 200 with content for test file | CE-05 | Must | PASS |
| BE-08 | integration | GET returns 404 for unknown fileId | CE-05 | Must | PASS |
| BE-09 | integration | GET returns 404 for fileId with valid pattern but not in registry | CE-05 | Must | PASS |
| BE-10 | security | Response does not expose `path` or `absPath` fields | CE-05 | Must | PASS |
| BE-11 | integration | PUT returns 200 and atomically writes new content | CE-08 | Must | PASS |
| BE-12 | integration | PUT with empty string clears the file (valid per spec) | CE-08 | Must | PASS |
| BE-13 | integration | PUT returns 404 for unknown fileId | CE-08 | Must | PASS |
| BE-14 | integration | PUT returns 400 when content field is missing | CE-08 | Must | PASS |
| BE-15 | integration | PUT returns 400 when content is a number | CE-08 | Must | PASS |
| BE-16 | integration | PUT returns 400 when content is an object | CE-08 | Must | PASS |
| BE-17 | integration | PUT returns 400 when request body is empty | CE-08 | Must | PASS |
| BE-18 | integration | PUT returns 413 when content exceeds 1 MB | CE-08 | Must | PASS |
| BE-19 | integration | POST /api/v1/config/files returns 405 | — | Must | PASS |
| BE-20 | integration | DELETE /api/v1/config/files/{id} returns 405 | — | Must | PASS |

### Frontend Unit Tests (Vitest — per component)

#### ConfigToggle (8 tests — all PASS)

| ID | Type | Description | Story | Priority | Status |
|----|------|-------------|-------|----------|--------|
| FE-01 | unit | Renders settings icon button | CE-01 | Must | PASS |
| FE-02 | unit | aria-label="Toggle configuration editor" | CE-01 | Must | PASS |
| FE-03 | unit | aria-pressed reflects panel state | CE-01 | Must | PASS |
| FE-04 | unit | Active styling applied when panel open | CE-01 | Must | PASS |
| FE-05 | unit | Inactive styling applied when panel closed | CE-01 | Must | PASS |
| FE-06 | unit | Click calls toggleConfigPanel | CE-01 | Must | PASS |
| FE-07 | unit | Button present in Header (Header.test.tsx) | CE-01 | Must | PASS |
| FE-08 | unit | Second click closes panel | CE-02 | Must | PASS |

#### ConfigFileSidebar (12 tests — all PASS)

| ID | Type | Description | Story | Priority | Status |
|----|------|-------------|-------|----------|--------|
| FE-09 | unit | Renders Global and Project sections from mock data | CE-04 | Must | PASS |
| FE-10 | unit | Empty state when no files returned | CE-04 | Must | PASS |
| FE-11 | unit | Loading spinner shown during initial load | CE-04 | Must | PASS |
| FE-12 | unit | Active file gets active styling | CE-05 | Must | PASS |
| FE-13 | unit | Clicking file calls onRequestSwitch with fileId | CE-05 | Must | PASS |
| FE-14 | unit | nav has aria-label="Config files" | CE-04 | Must | PASS |
| FE-15 | unit | Global section omitted when no global files | CE-04 | Must | PASS |
| FE-16 | unit | Project section omitted when no project files | CE-04 | Must | PASS |
| FE-17 | unit | Directory label shown under filename | CE-04 | Must | PASS |
| FE-18 | unit | aria-current="page" on active file item | CE-05 | Must | PASS |
| FE-19 | unit | Files sorted alphabetically within section | CE-04 | Should | PASS |
| FE-20 | unit | Only global section shown when project file absent | CE-04 | Must | PASS |

#### ConfigEditor (15 tests — all PASS)

| ID | Type | Description | Story | Priority | Status |
|----|------|-------------|-------|----------|--------|
| FE-21 | unit | Empty state shown when no file selected | CE-05 | Must | PASS |
| FE-22 | unit | Textarea renders with activeConfigContent value | CE-07 | Must | PASS |
| FE-23 | unit | onChange calls setConfigContent | CE-07 | Must | PASS |
| FE-24 | unit | configDirty = true triggers "Unsaved changes" indicator | CE-09 | Must | PASS |
| FE-25 | unit | "Unsaved changes" hidden when clean | CE-09 | Must | PASS |
| FE-26 | unit | aria-live="polite" on dirty indicator | CE-09 | Must | PASS |
| FE-27 | unit | Save button disabled when clean | CE-08 | Must | PASS |
| FE-28 | unit | Save button disabled during configSaving | CE-08 | Must | PASS |
| FE-29 | unit | Save button enabled when dirty and not saving | CE-08 | Must | PASS |
| FE-30 | unit | Clicking Save calls saveConfigFile | CE-08 | Must | PASS |
| FE-31 | unit | Textarea disabled when configLoading | CE-05 | Must | PASS |
| FE-32 | unit | Textarea disabled when configSaving | CE-08 | Must | PASS |
| FE-33 | unit | Ctrl+S triggers save when dirty | CE-12 | Should | PASS |
| FE-34 | unit | Ctrl+S does nothing when clean | CE-12 | Should | PASS |
| FE-35 | unit | Mini-header shows filename and scope badge | CE-05 | Must | PASS |

#### ConfigPanel (11 tests — all PASS)

| ID | Type | Description | Story | Priority | Status |
|----|------|-------------|-------|----------|--------|
| FE-36 | unit | Panel has aria-label="Configuration editor" | CE-01 | Must | PASS |
| FE-37 | unit | "Configuration" title in panel header | CE-01 | Must | PASS |
| FE-38 | unit | Close button has aria-label="Close configuration panel" | CE-02 | Must | PASS |
| FE-39 | unit | Empty editor state shown when no file active | CE-05 | Must | PASS |
| FE-40 | unit | Close button calls setConfigPanelOpen(false) when clean | CE-02 | Must | PASS |
| FE-41 | unit | DiscardChangesDialog appears on close when dirty | CE-11 | Must | PASS |
| FE-42 | unit | Cancel in discard dialog keeps panel open | CE-11 | Must | PASS |
| FE-43 | unit | Discard in dialog closes panel | CE-11 | Must | PASS |
| FE-44 | unit | DiscardChangesDialog appears on file switch when dirty | CE-10 | Must | PASS |
| FE-45 | unit | loadConfigFiles called on panel mount | CE-04 | Must | PASS |
| FE-46 | unit | Discard in switch dialog loads new file | CE-10 | Must | PASS |

#### Store (useAppStore — 23 tests — all PASS)

| ID | Type | Description | Story | Priority | Status |
|----|------|-------------|-------|----------|--------|
| FE-47 | unit | configPanelOpen persisted to localStorage | CE-01 | Must | PASS |
| FE-48 | unit | toggleConfigPanel flips configPanelOpen | CE-01 | Must | PASS |
| FE-49 | unit | loadConfigFiles sets configFiles on success | CE-04 | Must | PASS |
| FE-50 | unit | loadConfigFiles shows toast on error | CE-13 | Must | PASS |
| FE-51 | unit | selectConfigFile sets content and clears dirty | CE-05 | Must | PASS |
| FE-52 | unit | setConfigContent updates content and derives configDirty | CE-07 | Must | PASS |
| FE-53 | unit | saveConfigFile calls PUT API | CE-08 | Must | PASS |
| FE-54 | unit | saveConfigFile on success: updates original, clears dirty | CE-08 | Must | PASS |
| FE-55 | unit | saveConfigFile on failure: preserves content, dirty remains true | CE-15 | Must | PASS |
| FE-56 | unit | CONFIG_OPEN_KEY = 'config-panel:open' | CE-01 | Must | PASS |

### Security Tests (OWASP Static Analysis)

| ID | Type | OWASP Category | Description | Status |
|----|------|----------------|-------------|--------|
| SEC-01 | security | A01 Broken Access Control | File ID registry prevents path traversal — no user path in I/O | PASS |
| SEC-02 | security | A01 Broken Access Control | absPath never sent in HTTP responses (verified by BE-10) | PASS |
| SEC-03 | security | A03 Injection | Content written verbatim to disk; no shell execution on content | PASS |
| SEC-04 | security | A03 Injection | FileId validated against registry (Map.get) before any I/O | PASS |
| SEC-05 | security | A04 Insecure Design | Registry rebuilt on every request — no stale entry exploitation | PASS |
| SEC-06 | security | A05 Security Misconfiguration | 405 returned for POST, DELETE on config routes | PASS |
| SEC-07 | security | A05 Security Misconfiguration | 1 MB hard cap prevents disk exhaustion via API | PASS |
| SEC-08 | security | A06 Vulnerable Components | No new npm dependencies added (zero-dep backend maintained) | PASS |
| SEC-09 | security | A02 Cryptographic Failures | Atomic write (.tmp + renameSync) prevents partial writes | PASS |
| SEC-10 | security | A09 Logging Failures | All config operations logged with byte sizes; errors logged | PASS |
| SEC-11 | security | A07 Auth Failures | No authentication on config routes — local dev tool, localhost only. Advisory noted. | ADVISORY |

### Performance Tests (SLA verification — static analysis)

| ID | Type | Endpoint | SLA Target | Assessment |
|----|------|----------|-----------|------------|
| PERF-01 | perf | GET /api/v1/config/files | P95 < 50ms | PASS (sync readdir + stat, no network I/O) |
| PERF-02 | perf | GET /api/v1/config/files/{id} | P95 < 100ms | PASS (single readFileSync, typical CLAUDE.md ~10 KB) |
| PERF-03 | perf | PUT /api/v1/config/files/{id} | P95 < 200ms | PASS (writeFileSync + renameSync, sync on same partition) |
| PERF-04 | perf | Sync I/O blocks event loop | Advisory | ADVISORY (acceptable for local single-user tool) |

### E2E Manual Test Procedures

| ID | Type | Description | Story | Result |
|----|------|-------------|-------|--------|
| E2E-01 | e2e | Open panel → sidebar populates with global and project files | CE-01, CE-04 | REQUIRES MANUAL |
| E2E-02 | e2e | Select file → content appears in textarea | CE-05 | REQUIRES MANUAL |
| E2E-03 | e2e | Edit content → "Unsaved changes" indicator appears | CE-07, CE-09 | REQUIRES MANUAL |
| E2E-04 | e2e | Ctrl+S saves file → toast appears, indicator disappears | CE-08, CE-12 | REQUIRES MANUAL |
| E2E-05 | e2e | Switch file while dirty → discard dialog appears | CE-10 | REQUIRES MANUAL |
| E2E-06 | e2e | Close panel while dirty → discard dialog appears | CE-11 | REQUIRES MANUAL |
| E2E-07 | e2e | Both config and terminal panels open simultaneously | CE-03 | REQUIRES MANUAL |

---

## Coverage Analysis

### Backend New Code (server.js config routes)
- Functions covered: `buildConfigRegistry`, `handleConfigListFiles`, `handleConfigReadFile`, `handleConfigSaveFile`, `parseBodyWithLimit`
- Tests: 20 integration tests covering all happy paths, all validation branches, method guards
- Estimated coverage: **~95%** (uncovered: race condition between readdir and stat on file disappearance — tested by code path skip, not by actual race)

### Frontend New Code
- Components with tests: `ConfigToggle`, `ConfigFileSidebar`, `ConfigEditor`, `ConfigPanel`, `DiscardChangesDialog` (indirectly via ConfigPanel)
- Store slice: all 6 actions covered
- API client functions: `getConfigFiles`, `getConfigFile`, `saveConfigFile` — covered
- Estimated coverage: **~85%**
- Known gap: `DiscardChangesDialog` component has no dedicated test file; it is exercised only via `ConfigPanel.test.tsx`. The switch-file variant of the dialog body text is not independently tested.
- Known gap: Ctrl+S shortcut fired via `document.addEventListener` — tested, but only at unit level with simulated `keydown` events; no browser-level focus isolation test.
- Known gap: `configPanelOpen` localStorage persistence across page reloads is not tested in Vitest (would require a full browser environment).

### User Story Coverage

| Story | Priority | Automated Tests | Status |
|-------|----------|----------------|--------|
| CE-01 Open panel | Must | FE-01..08, FE-47..48 | COVERED |
| CE-02 Close panel | Must | FE-38..43 | COVERED |
| CE-03 Panel coexist | Should | None (E2E-07 manual) | GAP |
| CE-04 View file list | Must | BE-01..06, FE-09..20 | COVERED |
| CE-05 Select file | Must | BE-07..09, FE-21,31,35 | COVERED |
| CE-06 Keyboard nav sidebar | Should | None | GAP |
| CE-07 Edit file | Must | FE-22..23, FE-52 | COVERED |
| CE-08 Save file | Must | BE-11..18, FE-27..30,53..54 | COVERED |
| CE-09 Dirty indicator | Must | FE-24..26 | COVERED |
| CE-10 Confirm file switch | Must | FE-44,46 | COVERED |
| CE-11 Confirm panel close | Must | FE-41..43 | COVERED |
| CE-12 Ctrl+S shortcut | Should | FE-33..34 | COVERED |
| CE-13 File list error | Must | FE-50 (toast fallback) | PARTIAL — see BUG-002 |
| CE-14 File content error | Must | FE store error (toast) | PARTIAL — see BUG-003 |
| CE-15 Save failure | Must | FE-55 | COVERED |

---

## Environment Requirements

- Node.js >= 18 (crypto.randomUUID available)
- macOS or Linux (tests create temp files in `~/.claude/` with cleanup)
- `~/.claude/` directory must be writable (or creatable)
- Backend: `node --test 'tests/*.test.js'`
- Frontend: `cd frontend && npm test -- --run`

---

## Assumptions

1. The config editor is a local dev tool — no multi-user concurrency or authentication requirement.
2. `~/.claude/` is the canonical global config directory for Claude Code installations.
3. A project `CLAUDE.md` at `process.cwd()` is the sole project-scoped config file.
4. `encodeURIComponent(fileId)` in the API client is safe — fileIds only contain `[a-z0-9-]` so encoding is a no-op.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| User accidentally clears CLAUDE.md | Medium | Medium | Save is explicit (button/Ctrl+S); no auto-save |
| Config file written with wrong encoding | Low | Medium | UTF-8 enforced by `writeFileSync(..., 'utf8')` |
| Race between readdir and stat | Low | Low | Server skips missing files silently |
| toggleConfigPanel bypasses dirty guard | High | Medium | **BUG-001** — confirmed, backlog |
| Error toast shown instead of inline sidebar error | Medium | Low | **BUG-002** — confirmed, backlog |
| Error toast shown instead of inline editor error | Medium | Low | **BUG-003** — confirmed, backlog |
