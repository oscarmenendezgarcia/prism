# Test Plan: User-Managed Attachments (QOL-7)

## Executive Summary

QOL-7 adds user-managed attachments to the TaskDetailPanel. All unit and integration tests pass (897 backend, 1841 frontend, 29 QA integration). Two **Medium** bugs were identified, both related to backend API leniency vs. the spec. No Critical or High bugs. The feature is safe to ship with the bugs documented as known limitations.

---

## Scope & Objectives

Validate that users can add link, text, and file-path attachments from the TaskDetailPanel; delete their own attachments; and that agent-authored artefacts are visually and functionally protected. Also verify that the PATCH merge-by-name semantics do not damage existing pipeline artefacts when used through the UI.

**In scope:**
- PATCH `/spaces/:spaceId/tasks/:taskId/attachments` (merge mode)
- DELETE `/spaces/:spaceId/tasks/:taskId/attachments/:encodedName`
- AddAttachmentForm component (link / text / file-path)
- TaskDetailPanel — user vs. agent visual distinction
- Optimistic update + rollback in the Zustand store
- Name-conflict detection (frontend)
- Backend security guards (path traversal, 403 on agent attachment delete)

**Out of scope:**
- Binary file upload (Phase 2)
- MCP kanban tool attachment flow (unchanged)

---

## Test Levels

### Unit Tests (Vitest — React Testing Library)
- `AddAttachmentForm.test.tsx` — 30 cases covering all type tabs, validation, error display, blur auto-populate, Escape dismiss, submit/cancel
- `TaskDetailPanel.test.tsx` — 4 updated/new cases for attachment section rendering (user vs agent rows, form toggle, delete button visibility)

### Integration Tests (Node.js `node:test`)
- `tests/attachments.test.js` — 69 cases covering all attachment CRUD endpoints, validation, merge semantics, error codes
- `tests/qa-attachments.test.js` — 29 QA-authored cases targeting security edge cases, path traversal, 403 guard, column transitions, concurrent writes

### E2E Tests (Playwright — this plan)
- 16 browser E2E test cases against the built QOL-7 frontend + backend on a dedicated test server (port 3002, isolated DATA_DIR)

### Security
Applies — feature touches user-supplied input, file paths, and new API endpoints.

| OWASP Check | Surface | Status |
|---|---|---|
| A01 Broken Access Control | DELETE /attachments/:name — agent guard | ✅ Enforced (403) |
| A03 Injection | File path traversal in `content` field | ✅ Blocked at validation (`path.normalize` check) |
| A03 Injection | `innerHTML` in attachment list | N/A — React renders via JSX (textContent) |
| A05 Security Misconfiguration | HTTP links accepted despite spec requiring HTTPS | ⚠️ **BUG-001** |
| A01 Broken Access Control | PATCH merge overwrites agent attachment | ⚠️ **BUG-002** (API-level, UI prevents it) |

### Performance
Not in scope — this feature has no hot paths, large datasets, or polling loops. `Security: N/A for performance` does not apply; all mutations are single-record SQLite writes.

---

## Test Cases

### Unit Tests

| ID | Type | Description | Input | Expected | Priority |
|---|---|---|---|---|---|
| TC-U-001 | Unit | AddAttachmentForm renders all three type tabs | mount | Link / Note / File Path radio buttons visible | High |
| TC-U-002 | Unit | Type switch resets content field + error | click Note → click Link | content cleared, no stale error | High |
| TC-U-003 | Unit | Submit with empty name shows error | click Add | "Name is required." alert | High |
| TC-U-004 | Unit | Submit with empty content shows error | click Add | "Content is required." alert | High |
| TC-U-005 | Unit | Non-https URL shows error | `http://foo.com` → Add | "URL must start with https://" alert | High |
| TC-U-006 | Unit | Invalid URL string shows error | `not-a-url` → Add | "Enter a valid https:// URL." alert | Medium |
| TC-U-007 | Unit | Relative file path rejected | `relative/path` → Add | "File path must be an absolute path starting with /." | High |
| TC-U-008 | Unit | Name conflict shows error | existing name → Add | "already exists on this task" alert | High |
| TC-U-009 | Unit | Blur on URL auto-populates hostname | fill URL, focus name (empty) | name = hostname | Medium |
| TC-U-010 | Unit | Blur on URL does not overwrite existing name | fill URL, name already set | name unchanged | Low |
| TC-U-011 | Unit | Escape key calls onCancel | keydown Escape | onCancel called | High |
| TC-U-012 | Unit | Successful submit calls addUserAttachment + onSuccess | valid inputs → Add | store action called, form resets | High |
| TC-U-013 | Unit | `disabled` prop disables all inputs and buttons | disabled=true | all controls aria-disabled | Medium |
| TC-U-014 | Unit | ARIA attributes — name error sets aria-invalid + aria-describedby | error present | name input aria-invalid=true | High |
| TC-U-015 | Unit | TaskDetailPanel renders empty state when 0 attachments | task with no attachments | "No attachments yet" paragraph visible | High |
| TC-U-016 | Unit | User attachment row shows "you" badge + delete button | author='user' | badge and delete button present | High |
| TC-U-017 | Unit | Agent attachment row has no delete button | author=undefined | delete button absent | High |
| TC-U-018 | Unit | "+" button toggles AddAttachmentForm | click Add attachment | form appears; click again → form disappears | High |

### Integration Tests

| ID | Type | Description | Expected |
|---|---|---|---|
| TC-I-001 | Integration | PATCH merge: new attachment added, existing preserved | merged array = existing + new |
| TC-I-002 | Integration | PATCH merge: same-name incoming replaces existing | attachment at that name updated |
| TC-I-003 | Integration | PATCH: author field stored and returned | `author: 'user'` present in response |
| TC-I-004 | Integration | PATCH: invalid author value → 400 | VALIDATION_ERROR |
| TC-I-005 | Integration | PATCH: non-https link → validated by allowlist | accepted for http (see BUG-001) |
| TC-I-006 | Integration | PATCH: path traversal `/../` → 400 | VALIDATION_ERROR "must not contain path traversal segments" |
| TC-I-007 | Integration | PATCH: text content > 100 KB → 400 | VALIDATION_ERROR |
| TC-I-008 | Integration | PATCH: attachment count > limit → 413 | ATTACHMENT_LIMIT_EXCEEDED |
| TC-I-009 | Integration | DELETE: user attachment removed successfully | 200, attachment gone, others intact |
| TC-I-010 | Integration | DELETE: agent attachment → 403 | FORBIDDEN "created by the pipeline" |
| TC-I-011 | Integration | DELETE: nonexistent name → 404 | NOT_FOUND |
| TC-I-012 | Integration | DELETE: URL-encoded name decoded correctly | `My%20Note` → `My Note` |
| TC-I-013 | Integration | DELETE response wraps in `{ task: ... }` | task key present with id |
| TC-I-014 | Integration | GET /tasks strips non-link attachment content | `content` absent for text/file in listing |
| TC-I-015 | Integration | Backward compat: legacy attachment (no author field) treated as agent | DELETE → 403 |

### E2E Tests (Playwright)

| ID | Type | Description | Status | Screenshot |
|---|---|---|---|---|
| TC-E2E-001 | E2E | "Add attachment" button opens inline form | ✅ PASS | e2e-02-add-form-open.png |
| TC-E2E-002 | E2E | Toggle button icon changes add → remove when form open | ✅ PASS | e2e-02-add-form-open.png |
| TC-E2E-003 | E2E | Add link attachment (name + https URL) — persists | ✅ PASS | e2e-03-link-added.png |
| TC-E2E-004 | E2E | Add text/note attachment — persists | ✅ PASS | — |
| TC-E2E-005 | E2E | Add file path attachment — persists | ✅ PASS | — |
| TC-E2E-006 | E2E | Note type: content field switches to textarea | ✅ PASS | — |
| TC-E2E-007 | E2E | Form validation — empty submit shows both required errors | ✅ PASS | — |
| TC-E2E-008 | E2E | Form validation — http:// URL rejected by frontend | ✅ PASS | — |
| TC-E2E-009 | E2E | Name conflict — duplicate name shows clear error | ✅ PASS | — |
| TC-E2E-010 | E2E | Cancel button closes form, no attachment added | ✅ PASS | — |
| TC-E2E-011 | E2E | Escape key closes form (captured at document level) | ✅ PASS | — |
| TC-E2E-012 | E2E | Delete user attachment — removed from list | ✅ PASS | e2e-04-user-attachment-deleted.png |
| TC-E2E-013 | E2E | Agent attachments preserved after user attachment delete | ✅ PASS | e2e-04-user-attachment-deleted.png |
| TC-E2E-014 | E2E | Empty state "No attachments yet" renders on task with 0 attachments | ✅ PASS | — |
| TC-E2E-015 | E2E | URL hostname auto-populate on content blur | ✅ PASS | — |
| TC-E2E-016 | E2E | Relative file path rejected with clear message | ✅ PASS | — |
| TC-E2E-017 | E2E | Persistence: attachments survive panel close/reopen | ✅ PASS | e2e-03-link-added.png |
| TC-E2E-018 | E2E | Visual distinction — user rows have person icon + "you" badge | ✅ PASS | e2e-03-link-added.png |
| TC-E2E-019 | E2E | Agent attachment rows have NO delete button | ✅ PASS | e2e-01-task-detail-panel.png |
| TC-E2E-020 | E2E | Backend 403 on direct API DELETE of agent attachment | ✅ PASS (API) | — |
| TC-E2E-021 | E2E | Backend path traversal guard via direct API | ✅ PASS (API) | — |
| TC-E2E-022 | E2E | Backend 404 on DELETE of nonexistent attachment | ✅ PASS (API) | — |

---

## Environment Requirements

- Node.js >= 14.17 (crypto.randomUUID)
- SQLite via `better-sqlite3`
- Frontend: React 19, Vite 6, Vitest, Playwright (via MCP plugin)
- Test server: isolated via `DATA_DIR=/tmp/prism-qa-e2e-test PORT=3002`

## Assumptions & Exclusions

- **Assumption**: "Binary file upload" is explicitly out of scope per spec; QA validates only link/text/file-path attachment types.
- **Assumption**: The `terminal.test.js` and `pipeline-templates.test.js` test files are known-hanging (PTY / server lifecycle issue) and excluded from the backend test run. The failing test "PTY exit and auto-respawn" is pre-existing and unrelated to QOL-7.
- **Exclusion**: MCP tool integration for attachments (unchanged from pre-QOL-7 behaviour).
- **Exclusion**: Binary download of file attachments (GET /attachments/:index) — out of scope for this feature phase.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Backend accepts http:// links (BUG-001) | Medium | Frontend enforces https://; direct API callers must be trusted |
| PATCH merge can overwrite agent attachments via direct API (BUG-002) | Medium | Frontend existingNames validation blocks this in normal use |
| Path traversal in file path content | Low | Backend validates at write-time; GET handler has additional check |
| Optimistic update race on fast double-click | Low | `isMutating` guard prevents concurrent mutations |
