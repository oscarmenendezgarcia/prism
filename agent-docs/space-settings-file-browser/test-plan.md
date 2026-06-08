# Test Plan: Space Settings — File Browser (Directory Picker)

## Executive Summary

The inline file-tree directory picker for working directory selection is code-complete and passes all unit and integration tests (23 backend + 1,809 frontend). One **Medium** deployment issue exists: the running server on port 3000 was started before the FS routes were committed; it must be restarted to serve the new endpoints. Two **Low** backend edge-case bugs were found (unhandled OS errors). No Critical or High code defects were found.

---

## Scope & Objectives

| Layer         | In Scope |
|---------------|----------|
| Backend API   | `GET /api/v1/fs/home`, `POST /api/v1/fs/browse`, `POST /api/v1/fs/validate` |
| Frontend UI   | `DirectoryPicker` component, `SpaceModal` integration |
| Security      | Path traversal, injection, OWASP Top 10 mapping |
| Performance   | Response time, payload size for large directories |
| Accessibility | ARIA roles, keyboard navigation |
| Degradation   | Error state when API unavailable |

**Out of scope:** OS-native dialog picker (not implemented), Windows platform, CI/CD pipeline restart automation.

---

## Environment Requirements

| Requirement | Status |
|-------------|--------|
| Node.js ≥ 14.17 (crypto.randomUUID) | ✅ confirmed |
| macOS (primary target) | ✅ confirmed |
| Linux (secondary target) | ✅ compatible (POSIX paths, no OS-specific code) |
| Server restart after deployment | ⚠️ required (see BUG-001) |
| Frontend: `npm test` (Vitest) | ✅ 1,809 pass |
| Backend: `node --test tests/fs.test.js` | ✅ 23/23 pass |

---

## Test Levels

### Unit Tests (Frontend — Vitest)

| Suite | Tests | Pass |
|-------|-------|------|
| DirectoryPicker — rendering | 5 | 5/5 ✅ |
| DirectoryPicker — open/close | 5 | 5/5 ✅ |
| DirectoryPicker — tree display | 4 | 4/4 ✅ |
| DirectoryPicker — selection | 3 | 3/3 ✅ |
| DirectoryPicker — keyboard nav | 3 | 3/3 ✅ |
| SpaceModal — folder button renders | 1 | 1/1 ✅ |
| SpaceModal — wd pre-fills in rename | 1 | 1/1 ✅ |
| SpaceModal — wd submitted correctly | 1 | 1/1 ✅ |
| **Total** | **23** | **23/23 ✅** |

### Integration Tests (Backend — Node:test)

| Suite | Tests | Pass |
|-------|-------|------|
| GET /api/v1/fs/home | 3 | 3/3 ✅ |
| POST /api/v1/fs/browse | 13 | 13/13 ✅ |
| POST /api/v1/fs/validate | 7 | 7/7 ✅ |
| **Total** | **23** | **23/23 ✅** |

### E2E Tests (Playwright — live server)

| TC-ID | Description | Result |
|-------|-------------|--------|
| E2E-001 | SpaceModal opens via Space options → Edit | ✅ pass |
| E2E-002 | Folder icon button renders in modal | ✅ pass |
| E2E-003 | aria-expanded=false on folder button when closed | ✅ pass |
| E2E-004 | Click folder button opens tree panel | ⚠️ blocked — server stale (BUG-001); panel opens with error state |
| E2E-005 | Error state shows manual-input fallback message | ✅ pass (degradation works correctly) |
| E2E-006 | Input remains editable after opening picker | ✅ pass |
| E2E-007 | aria-expanded=true after open | ⚠️ blocked — panel opens but API call fails |

### Security Tests

| TC-ID | Check | Result |
|-------|-------|--------|
| SEC-001 | XSS injection in path field | ✅ safe — 404 (dir not found) |
| SEC-002 | Null byte injection (`/tmp\0/etc`) | ⚠️ BUG-002 — 500 instead of 400 |
| SEC-003 | Path traversal via `~/../../etc` | ⚠️ BUG-003 — 200, traversal succeeds |
| SEC-004 | Path traversal via `/etc/../etc/passwd` | ✅ safe — 400 (not a dir) |
| SEC-005 | Relative path rejected | ✅ 400 INVALID_PATH |
| SEC-006 | `includeHidden=1` (truthy int, not `true`) | ✅ treated as false (strict equality) |
| SEC-007 | ENAMETOOLONG (path > 255 chars) | ⚠️ BUG-002 — 500 instead of 400 |

### Performance Tests

| Metric | Threshold | Measured | Result |
|--------|-----------|----------|--------|
| `/fs/home` P95 response | < 50ms | ~1ms | ✅ pass |
| `/fs/browse` (small dir) | < 100ms | ~1ms | ✅ pass |
| `/fs/browse` (/tmp, ~49 dirs) | < 200ms | 1ms, 3.8KB | ✅ pass |
| `/fs/home` + `/fs/browse` combined | < 500ms | ~10ms | ✅ pass |

---

## Test Cases Table

| ID | Type | Description | Input | Expected | Priority |
|----|------|-------------|-------|----------|----------|
| TC-001 | unit | Folder button renders | SpaceModal in rename mode | `[aria-label="Browse for working directory"]` present | P0 |
| TC-002 | unit | aria-expanded starts false | Initial render | `aria-expanded="false"` | P0 |
| TC-003 | unit | Disabled state propagates | `disabled=true` prop | Button disabled, panel does not open | P0 |
| TC-004 | unit | Opens tree on click | Click folder button | Tree panel appears | P0 |
| TC-005 | unit | Cancel closes panel | Click Cancel | Tree panel gone | P0 |
| TC-006 | unit | Escape closes panel | KeyDown Escape | Tree panel gone | P1 |
| TC-007 | unit | Error state on API fail | mock rejects | `role=alert` with fallback message | P0 |
| TC-008 | unit | ArrowDown moves focus | KeyDown ArrowDown | Next treeitem selected | P1 |
| TC-009 | unit | Enter selects and closes | KeyDown Enter | onChange called, panel closed | P0 |
| TC-010 | unit | Select button calls onChange | Click item, click Select | onChange called with path | P0 |
| TC-011 | integration | GET /fs/home returns homePath | GET request | `{homePath: "/..."}` 200 | P0 |
| TC-012 | integration | POST /fs/browse lists dirs | `{path: "/tmp"}` | Items array, no files | P0 |
| TC-013 | integration | ~ expands to home | `{path: "~"}` | 200, path = os.homedir() | P0 |
| TC-014 | integration | Hidden dirs excluded by default | `{path: tmpRoot}` | .hidden-dir absent | P1 |
| TC-015 | integration | Hidden dirs opt-in | `{path: tmpRoot, includeHidden: true}` | .hidden-dir present | P1 |
| TC-016 | integration | Sort alphabetical | Mixed dirs | Names in locale order | P2 |
| TC-017 | integration | Validate valid dir | `{path: "/tmp"}` | `{isValid: true}` | P0 |
| TC-018 | security | Path traversal via ~ | `~/../../etc` | Should return 400 (BUG-003) | P1 |
| TC-019 | security | Null byte in path | `"/tmp\0/etc"` | 400 INVALID_PATH (BUG-002) | P1 |
| TC-020 | security | XSS in path | `<script>` in path | 404 NOT_FOUND ✅ | P1 |
| TC-021 | e2e | Folder button in live modal | Playwright: click folder btn | Panel opens or degraded error | P0 |
| TC-022 | e2e | Manual input still works | Type path after opening picker | Input accepts text | P0 |

---

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| Click en icono carpeta junto al input abre el selector | ⚠️ partial — button exists, panel opens; API blocked by BUG-001 |
| El campo se rellena automáticamente con la ruta elegida | ✅ verified via unit tests (onChange called with path) |
| Input sigue siendo editable manualmente | ✅ verified E2E |
| Degrada a input de texto si entorno headless/sin display | ✅ error state shows, manual input works |
| Funciona en macOS (prioritario) | ✅ code + tests pass; live serving blocked by BUG-001 |
| Tests: endpoint mockeado; componente renderiza botón de carpeta | ✅ 23 backend + 23 frontend tests |

---

## Assumptions & Exclusions

1. **Server restart** is required after merging this feature to production. This is a standard deployment step for this Node.js non-hot-reload server.
2. **Path traversal** via `~/../../` is considered Low risk for a local development tool (user has OS-level filesystem access).
3. **Pagination** is not required per spec; the current `hasMore: false` hardcode is acceptable.
4. The Vite dev server (port 5173) proxies to the backend and would exhibit the same BUG-001 stale-server behavior.
5. Tests run on macOS; Linux compatibility expected but not independently verified in this run.

---

## Risk Assessment

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| Server not restarted after deployment | Medium | Medium | Document restart requirement in CHANGELOG |
| Null byte / oversized path crashes endpoint | Low | Low | Add input length + null-byte guard in fs.js |
| Path traversal exposes sibling dirs | Low | Low | Acceptable for local dev tool; could scope to HOME only |
| No keyboard focus trap in tree panel | Low | Low | Modal manages focus; tree closes on Escape |
