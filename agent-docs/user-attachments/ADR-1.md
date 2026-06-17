# ADR-1: User-Managed Attachments on Tasks

## Status
Accepted

## Context

Currently, task attachments are exclusively created by the pipeline — agents attach
artefacts (ADR, blueprint, PR links) via the MCP `kanban_update_task` tool. The
attachment model (`name`, `type`, `content`) stores the data but carries no provenance
information. Users have no way to annotate a task with their own links, notes, or
file paths from the TaskDetailPanel.

The goal is to let users add/remove their own `link`, `text`, and `file` (local path)
attachments from the task panel, while guaranteeing that user actions can never
silently overwrite agent-produced artefacts.

The binary upload case (storing file content on the server) is explicitly deferred to
a future Phase 2. This decision record covers only Phase 1: link / text / path
attachments, which require no server-side file storage.

## Decision

Extend the attachment schema with an optional `author` field (`'user' | 'agent'`), add
a `DELETE /spaces/:spaceId/tasks/:taskId/attachments/:encodedName` endpoint, and expose
an inline "Add attachment" form in the TaskDetailPanel that uses the existing PATCH
(merge) endpoint to create attachments and the new DELETE endpoint to remove them.

## Rationale

**Author field as provenance signal.** No naming convention can reliably distinguish
user-added from agent-added attachments — agent names are arbitrary (e.g. "ADR-1.md",
"PR #141"). A first-class `author` field is unambiguous, survives renaming, and follows
the existing pattern on `comments` (which also carry `author`).

**Backward compatibility.** The field is optional; existing agent attachments that lack
it are treated as `author: 'agent'` by the frontend. No migration is required.

**PATCH (merge) for add.** Adding a user attachment is a upsert-by-name on top of the
existing array. Reusing the existing `PATCH /attachments` endpoint (merge mode) gives
this for free. The only addition is passing `author: 'user'` in the new item.

**DELETE by name, not by index.** The existing `GET /attachments/:index` route uses a
numeric index. Deleting by index is fragile — concurrent writes can shift indices.
Deleting by name matches the merge semantics and is stable. A new route is cleaner
than repurposing the existing GET path with a special method.

**Backend author guard on DELETE.** The DELETE endpoint rejects requests where the
target attachment does not have `author: 'user'`. This is a defense-in-depth rule:
agent artefacts carry no author field, so they can never be deleted through this
endpoint even if a caller bypasses the UI. The existing PATCH/PUT routes are unchanged
and remain accessible to agents via MCP.

**Inline form, not a modal.** The TaskDetailPanel right sidebar already contains
inline editors (assigned field, pipeline editor). Adding a modal for three input fields
would be disproportionate and add z-index complexity. An inline expand/collapse form
matches the existing UX patterns in the panel.

**No changes to the PUT `/tasks/:taskId` endpoint.** The core task PUT only handles
title/type/description/assigned/pipeline. Attachments go through the sub-route, which
has dedicated merge/replace semantics. Mixing them would couple two different update
strategies in one endpoint.

## Consequences

**Positive:**
- Users can annotate tasks with links, notes, and file paths without affecting agent
  artefacts.
- The merge-by-name invariant is preserved: agent artefacts can never be overwritten
  by a user attachment unless they share the same name (prevented by client-side
  name-conflict validation).
- No new storage mechanism required for Phase 1.
- Backend guard prevents accidental or programmatic deletion of agent artefacts.
- The `author` field enables future features (e.g. filtering, attribution UI).

**Negative / Risks:**
- An attachment name chosen by a user that happens to match an agent artefact name
  would be rejected client-side. If the user bypasses the UI (e.g. direct API call
  without `author: 'user'`), the PATCH merge would silently update the agent attachment.
  Mitigation: name-conflict detection is also surfaced in error form on submit, and the
  backend guard on DELETE ensures agent data can't be removed via user flows.
- Attachments with `author: 'user'` and `type: 'file'` store a local path, not the
  file content. The path may not be accessible from another machine. Mitigation: UI
  renders file-path attachments with an "Open locally" label and no server fetch.
- The `author` field is not validated on writes today — any caller can pass
  `author: 'agent'` on a user-submitted attachment to bypass the DELETE guard. This
  will be tightened in a follow-up that authenticates requests (out of scope for this
  feature).

## Alternatives Considered

- **Naming convention prefix (e.g. `user:My Link`):** discarded — arbitrary, breaks
  display names, hard to enforce across callers.
- **Separate user-attachments table / endpoint:** discarded — splits conceptually
  identical data into two storage locations, complicates the read path.
- **Modal "Add attachment" dialog:** discarded — adds z-index complexity and is
  disproportionate for a 3-field form.
- **DELETE by index:** discarded — fragile under concurrent writes; diverges from the
  merge-by-name semantics used everywhere else.

## Review
Suggested review date: 2026-12-14
