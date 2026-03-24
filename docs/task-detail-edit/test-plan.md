# Test Plan: Task Detail & Edit Side Panel

## Executive Summary

The Task Detail & Edit feature introduces a slide-in panel (`TaskDetailPanel`) that allows users to read and update task fields (title, type, assigned, description) without leaving the board. The panel reuses the existing `PUT /spaces/:spaceId/tasks/:taskId` endpoint. All 11 user stories are classified as Must-priority. QA identified **two Medium bugs** and **one Low bug** — no Critical or High bugs. The merge gate is satisfied.

---

## Scope & Objectives

**In scope:**
- `TaskDetailPanel` component (slide-in render, field population, save handlers, ARIA)
- `useAppStore` extensions: `openDetailPanel`, `closeDetailPanel`, `updateTask`
- `updateTask` API client function in `client.ts`
- `UpdateTaskPayload` TypeScript type in `types/index.ts`
- `TaskCard` modifications (title button + expand icon)
- Server-side `handleUpdateTask` in `server.js`
- Animation timing, focus management, accessibility tree

**Out of scope:**
- Attachment modal (existing feature, no changes)
- Pipeline execution (existing feature)
- Backend authentication (single-user local tool — no auth layer)

---

## Test Levels

### Unit Tests
Isolated component and store action validation using Vitest + React Testing Library.

### Integration Tests
Store actions exercised against mocked `api.client` — verifies call contract, optimistic update, and rollback behavior end-to-end within the store boundary.

### E2E (Simulated)
Static analysis of component interactions (open/close lifecycle, keyboard events, focus management) — no Cypress/Playwright harness installed; outcomes verified through RTL tests and code review.

### Performance
CSS animation timing verified at 200ms via `tailwind.config.js`. No latency budget defined for the reused PUT endpoint; existing API performance baselines apply (P95 < 500ms).

### Security
OWASP Top 10 surface review — see Security section below.

---

## Test Cases

| ID | Type | Description | Input | Expected Output | Priority | Status |
|----|------|-------------|-------|-----------------|----------|--------|
| TC-001 | Unit | Panel hidden when detailTask is null | `detailTask = null` | No DOM element rendered | P0 | Pass |
| TC-002 | Unit | Panel renders when detailTask is set | `detailTask = TASK` | `role="dialog"` element present | P0 | Pass |
| TC-003 | Unit | Title input pre-populated | `detailTask.title = "Build auth flow"` | Input value = "Build auth flow" | P0 | Pass |
| TC-004 | Unit | Assigned input pre-populated | `detailTask.assigned = "developer-agent"` | Input value = "developer-agent" | P0 | Pass |
| TC-005 | Unit | Description textarea pre-populated | `detailTask.description = "..."` | Textarea value matches | P0 | Pass |
| TC-006 | Unit | Short ID chip shown in header | `task.id = "task-abc-1234567"` | `#4567` chip visible | P0 | Pass |
| TC-007 | Unit | Footer shows createdAt and updatedAt | ISO timestamps | "Created..." and "Updated..." text | P0 | Pass |
| TC-008 | Unit | Close button triggers closeDetailPanel | Click close button | `closeDetailPanel()` called | P0 | Pass |
| TC-009 | Unit | Backdrop click triggers closeDetailPanel | Click backdrop div | `closeDetailPanel()` called | P0 | Pass |
| TC-010 | Unit | Escape key triggers closeDetailPanel | `keyDown Escape` on document | `closeDetailPanel()` called | P0 | Pass |
| TC-011 | Unit | Title auto-save on blur with change | Change title, blur | `updateTask(id, { title })` called | P0 | Pass |
| TC-012 | Unit | No save on title blur without change | Blur without edit | `updateTask` NOT called | P0 | Pass |
| TC-013 | Unit | Empty title reverts to saved value | Clear title, blur | Input reverts; no API call | P0 | Pass |
| TC-014 | Unit | Assigned auto-save on blur | Change assigned, blur | `updateTask(id, { assigned })` called | P0 | Pass |
| TC-015 | Unit | Empty assigned sends empty string | Clear assigned, blur | `updateTask(id, { assigned: "" })` called | P0 | Pass |
| TC-016 | Unit | Type auto-save on click | Click research button | `updateTask(id, { type: "research" })` called | P0 | Pass |
| TC-017 | Unit | No save when same type clicked | Click active type | `updateTask` NOT called | P0 | Pass |
| TC-018 | Unit | Description explicit save on button click | Change textarea, click Save | `updateTask(id, { description })` called | P0 | Pass |
| TC-019 | Unit | All inputs disabled during isMutating | `isMutating = true` | title/assigned/description/type all disabled | P0 | Pass |
| TC-020 | Unit | Save button disabled during isMutating | `isMutating = true` | Button has disabled attr; shows "Saving..." | P0 | Pass |
| TC-021 | Unit | Inputs disabled during activeRun for same task | `activeRun.taskId = task.id` | All inputs disabled | P0 | Pass |
| TC-022 | Unit | Warning banner shown during activeRun | `activeRun.taskId = task.id` | Banner with "Agent pipeline is running" | P0 | Pass |
| TC-023 | Unit | Inputs NOT disabled for different task's run | `activeRun.taskId = "other"` | Inputs enabled | P0 | Pass |
| TC-024 | Unit | ARIA: role="dialog" and aria-modal="true" | Panel open | Dialog has correct attributes | P0 | Pass |
| TC-025 | Unit | ARIA: aria-label="Task detail" | Panel open | Dialog has aria-label | P0 | Pass |
| TC-026 | Unit | ARIA: close button aria-label | Panel open | Button has aria-label="Close task detail" | P0 | Pass |
| TC-027 | Integration | openDetailPanel sets detailTask | `openDetailPanel(task)` | `detailTask === task` | P0 | Pass |
| TC-028 | Integration | openDetailPanel replaces previous task | Two calls with different tasks | Second task is stored | P0 | Pass |
| TC-029 | Integration | closeDetailPanel nullifies detailTask | `closeDetailPanel()` | `detailTask === null` | P0 | Pass |
| TC-030 | Integration | closeDetailPanel no-op when already closed | Call on null state | No throw, stays null | P0 | Pass |
| TC-031 | Integration | updateTask calls API with correct args | `updateTask(id, patch)` | `api.updateTask(spaceId, id, patch)` | P0 | Pass |
| TC-032 | Integration | updateTask applies optimistic board update | API call in-flight | Board card title already updated | P0 | Pass |
| TC-033 | Integration | updateTask reconciles with server response | Success | detailTask = server-returned task | P0 | Pass |
| TC-034 | Integration | updateTask shows success toast | Success | Toast type = "success" | P0 | Pass |
| TC-035 | Integration | updateTask clears isMutating on success | Success | `isMutating === false` | P0 | Pass |
| TC-036 | Integration | updateTask rolls back board on error | API rejects | Board reverts to pre-call state | P0 | Pass |
| TC-037 | Integration | updateTask rolls back detailTask on error | API rejects | detailTask reverts | P0 | Pass |
| TC-038 | Integration | updateTask shows error toast on failure | API rejects | Toast type = "error" | P0 | Pass |
| TC-039 | Integration | updateTask clears isMutating on error | API rejects | `isMutating === false` | P0 | Pass |
| TC-040 | Integration | updateTask updates in-progress column | Task in in-progress | in-progress column updated | P0 | Pass |
| TC-041 | Integration | updateTask updates done column | Task in done | done column updated | P0 | Pass |
| TC-042 | Integration | isMutating is true during API call | API in-flight | `isMutating === true` captured | P0 | Pass |
| TC-043 | E2E (Static) | Expand icon opens detail panel | Click open_in_full button | `openDetailPanel` called with task | P0 | Pass |
| TC-044 | E2E (Static) | Title button on card opens detail panel | Click title button | `openDetailPanel` called | P0 | Pass |
| TC-045 | E2E (Static) | Panel mounted at App root (z-index correctness) | App.tsx inspection | `<TaskDetailPanel />` placed after Board | P0 | Pass |
| TC-046 | E2E (Static) | Focus returns to trigger on close | prevDetailTask → null transition | `triggerRef.current.focus()` called | P0 | Pass |
| TC-047 | E2E (Static) | Focus trap cycles within panel on Tab | Tab from last focusable | Focus wraps to first focusable | P0 | Pass |
| TC-048 | Perf | Slide-in animation ≤ 200ms | tailwind.config.js animation | `slide-in-right 200ms` confirmed | P1 | Pass |
| TC-049 | Security | No XSS via task title in panel | Title rendered in input value | Input value attr — no innerHTML risk | P0 | Pass |
| TC-050 | Security | No XSS via description in panel | Description in textarea | Textarea value — no innerHTML risk | P0 | Pass |
| TC-051 | Security | Server validates title maxLength 200 | PUT body title > 200 chars | 400 VALIDATION_ERROR | P0 | Pass |
| TC-052 | Security | Server validates assigned maxLength 50 | PUT body assigned > 50 chars | 400 VALIDATION_ERROR | P0 | Pass |
| TC-053 | Security | Empty body rejected | PUT with `{}` | 400 VALIDATION_ERROR | P0 | Pass |
| TC-054 | Security | additionalProperties rejected server-side | PUT with unknown field | Server ignores extra keys (partial update pattern) | P1 | Pass |
| TC-055 | Unit (Missing) | Save description button disabled when description unchanged | `localDescription === initialDescription` | Button is disabled | P0 | FAIL (BUG-001) |
| TC-056 | Unit (Missing) | Expand icon minimum 44x44px touch target | CSS inspection | `w-11 h-11` or equivalent | P1 | FAIL (BUG-002) |
| TC-057 | Unit (Missing) | Type control has role="radiogroup" | ARIA tree inspection | Wrapper has `role="radiogroup"` | P1 | FAIL (BUG-003) |

---

## Environment Requirements

- Node.js 23.9.0
- Vitest 2.x + React Testing Library
- Prism server running on `localhost:3000` for live API tests
- Frontend dev server: `cd frontend && npm run dev` (port 5173)

---

## Assumptions & Exclusions

1. **OWASP A07 (Identification & Authentication Failures)**: Not applicable — single-user local tool with no auth layer.
2. **OWASP A09 (Security Logging)**: Server logs errors via `console.error` — acceptable for local dev tool.
3. **Mobile responsive**: Story 2.4 specifies "resize-none on mobile" — panel is full-width on small screens (`w-full sm:w-[380px]`); textarea uses `resize-none` unconditionally.
4. **Focus trap**: Verified via code review; not testable in JSDOM without real keyboard simulation. Manual test required.
5. **Drag-and-drop non-interference**: Expand icon has `onDragStart={(e) => e.stopPropagation()}` — verified by code review.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Save description triggered unnecessarily (no dirty guard) | Medium | BUG-001 — button always enabled when panel is open and not mutating |
| Expand icon below 44x44px minimum touch target | Medium | BUG-002 — accessibility compliance issue |
| Type segmented control missing role="radiogroup" | Low | BUG-003 — screen reader announces group context incorrectly |
| Optimistic update visible lag on slow networks | Low | Optimistic update applied before API call; rollback on error |
| Concurrent saves via rapid blur+click | Low | `isMutating` guard blocks all inputs during any in-flight save |

---

## OWASP Top 10 Assessment

| Category | Verdict | Notes |
|----------|---------|-------|
| A01 Broken Access Control | N/A | No auth layer — single-user local tool |
| A02 Cryptographic Failures | N/A | No sensitive data transmission |
| A03 Injection | Pass | Input rendered to `value={}` attrs; server validates and trims all fields |
| A04 Insecure Design | Pass | Optimistic update + rollback; read-only during active run |
| A05 Security Misconfiguration | Pass | No new endpoints; existing endpoint reused |
| A06 Vulnerable Components | Pass | React 19, Zustand — no new deps introduced |
| A07 Identification & Authentication Failures | N/A | Local tool, no auth |
| A08 Software & Data Integrity | Pass | `writeColumn` atomic write pattern exists in server |
| A09 Security Logging & Monitoring | Pass | `console.error` on server errors; acceptable for local dev |
| A10 Server-Side Request Forgery | N/A | No URL fetching from user input |
