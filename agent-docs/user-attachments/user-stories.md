# User Stories: QOL-7 — User-Managed Attachments

## Personas

### P-1: Oscar (the Task Owner)
A developer/PM who creates and manages tasks in Prism. He reviews pipeline artefacts and wants to annotate tasks with context: a PR link, a meeting note, or a path to his local design file. He is comfortable with keyboard shortcuts and expects fast, safe interactions. His biggest fear: accidentally deleting a pipeline artefact.

### P-2: Pipeline Agent (non-human)
The senior-architect / ux-api-designer / developer-agent agents that write artefacts (ADR, blueprint, PR link) via `kanban_update_task`. These are not human users but their writes must be protected from P-1's deletes.

---

## Epics

### Epic 1 — Add user attachments

#### Story 1.1: Add a link attachment
**As Oscar**, I want to attach an external URL (https link) to a task so that I can reference a GitHub PR, design doc, or ticket without leaving the task panel.

**Acceptance Criteria:**
1. The Attachments section is always visible in the TaskDetailPanel (even when 0 attachments).
2. Clicking "+" opens an inline form with a type selector defaulting to "Link".
3. I can enter a URL (https only) and a name; the name auto-populates from the URL hostname on blur if I left it empty.
4. Clicking "Add" calls `PATCH /attachments` with `{ name, type:'link', content, author:'user' }` and the new row appears immediately (optimistic).
5. A "Attachment added" success toast appears.
6. Non-https URLs show a validation error below the URL field before any API call.

**Definition of Done:**
- `AddAttachmentForm` component passes all unit tests (validation, auto-populate, submit).
- `TaskDetailPanel` renders the new row with the "you" chip.
- Backend returns 200 with the attachment including `author:'user'`.
- No regressions in existing attachment tests.

**Priority:** Must  
**Story Points:** 3

---

#### Story 1.2: Add a text note attachment
**As Oscar**, I want to save a freeform inline note on a task so that I can record context (e.g. a meeting decision) that doesn't fit in the description.

**Acceptance Criteria:**
1. Selecting "Note" type in the form changes the content field label to "Content" and renders a textarea.
2. Submitting a non-empty name + content creates the attachment with `type:'text'` and `author:'user'`.
3. The note row in the list shows a `visibility` icon and the "you" chip.
4. Clicking the row opens the existing text-content modal (AttachmentModal).

**Priority:** Must  
**Story Points:** 2

---

#### Story 1.3: Add a local file path attachment
**As Oscar**, I want to record a local file path on a task so that I can reference a file that lives on my machine (design mock, screenshot) without uploading it.

**Acceptance Criteria:**
1. Selecting "File Path" type changes the content field label to "Path" and the placeholder to `/absolute/path/to/file`.
2. Submitting a path that doesn't start with `/` shows: "Path must start with / (absolute path)."
3. Stored as `type:'file'` with `author:'user'`.
4. Row shows `folder_open` icon and "you" chip. No server-side fetch on click (open-locally label).

**Priority:** Must  
**Story Points:** 2

---

### Epic 2 — View and distinguish attachments

#### Story 2.1: See which attachments I added vs. the pipeline
**As Oscar**, I want to visually distinguish my own attachments from pipeline artefacts so that I know which ones I can safely delete.

**Acceptance Criteria:**
1. Agent attachments (author missing or 'agent') render with: type-based icon (primary color), neutral bg, no delete button.
2. User attachments (author === 'user') render with: person icon, violet-tinted bg (`bg-primary/[0.04]`), violet border (`border-primary/15`), "you" chip.
3. At least 3 channels differ (color + icon + chip text) — no color-only distinction.
4. The section always renders; empty state reads "No attachments yet".

**Priority:** Must  
**Story Points:** 1

---

#### Story 2.2: See attachments even when none exist yet
**As Oscar**, I want the Attachments section to always be visible so that I remember I can add my own, even on a fresh task.

**Acceptance Criteria:**
1. The section renders even when `detailTask.attachments` is empty or undefined.
2. Empty state shows: icon + "No attachments yet" in text-disabled.
3. The "+" button is visible and interactive (unless isReadOnly).

**Priority:** Must  
**Story Points:** 0.5

---

### Epic 3 — Delete user attachments

#### Story 3.1: Delete one of my attachments
**As Oscar**, I want to remove a link or note I added to a task so that I can clean up stale context without affecting the pipeline's artefacts.

**Acceptance Criteria:**
1. A "×" delete button appears on hover on user attachment rows only.
2. Clicking "×" removes the row immediately (optimistic) and calls `DELETE /attachments/:name`.
3. A "Attachment removed" toast appears on success.
4. On API error: the row reappears and an error toast explains what happened.
5. No confirmation dialog is shown (the action is lightweight and re-addable).

**Definition of Done:**
- `TaskDetailPanel` renders "×" on hover for user rows, absent for agent rows.
- `deleteUserAttachment` store action passes all unit tests (optimistic + rollback).
- Backend `DELETE` endpoint is covered by integration tests: 200 (user), 403 (agent), 404 (not found).

**Priority:** Must  
**Story Points:** 2

---

#### Story 3.2: Not be able to delete pipeline artefacts
**As Oscar**, I want to be certain I cannot accidentally delete a pipeline artefact so that ADRs, blueprints, and PR links remain safe.

**Acceptance Criteria:**
1. Agent attachment rows have no delete button (not hidden — not rendered).
2. Even if a caller hits `DELETE /attachments/:name` directly (bypassing the UI), the backend returns `403 FORBIDDEN` with message: "This attachment was created by the pipeline and cannot be deleted here."
3. The 403 error message names the attachment and explains why it cannot be deleted.

**Priority:** Must  
**Story Points:** 0.5 (covered by T-002 backend + T-006 frontend)

---

### Epic 4 — Validation and error handling

#### Story 4.1: Understand validation errors in the add form
**As Oscar**, I want clear, actionable error messages when I fill the form incorrectly so that I can fix the problem without guessing.

**Acceptance Criteria:**
1. Each error appears directly below the offending field (not at the top of the form).
2. Error copy states what's wrong AND how to fix it:
   - URL: "Must start with https:// — e.g. https://github.com/org/repo"
   - Path: "Must start with / (absolute path) — e.g. /Users/oscar/designs/spec.png"
   - Name conflict: "'ADR-1.md' already exists on this task. Choose a different name."
   - Name too long: "Name must be 100 characters or fewer."
3. Errors use `role="alert"` for screen reader announcement.
4. The "Add" button is disabled while any validation error is present.
5. No API call is made while the form has errors.

**Priority:** Must  
**Story Points:** 1

---

#### Story 4.2: Recover gracefully when the API fails
**As Oscar**, I want the UI to roll back and explain what happened if the server rejects my attachment so that I don't lose the task context or wonder if it worked.

**Acceptance Criteria:**
1. On PATCH failure: the optimistic row is removed, and a toast reads "Failed to add attachment — [reason]".
2. On DELETE failure: the optimistic removal is undone, and a toast reads "Could not remove attachment — [reason]".
3. The form re-opens with my previous input on add-failure so I don't have to retype.

**Priority:** Should  
**Story Points:** 1

---

## MoSCoW Summary

| Priority | Stories |
|----------|---------|
| **Must** | 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1 |
| **Should** | 4.2 |
| **Could** | Attachment rename (edit flow) |
| **Won't (Phase 2)** | Binary file upload, attachment count badge on TaskCard, attachment search/filter |

## Total Story Points: 13
