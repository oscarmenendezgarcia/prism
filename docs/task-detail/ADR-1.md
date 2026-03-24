# ADR-1: Task Detail Side Panel (Drawer)

## Status
Accepted

## Context
Task cards on the Kanban board currently expose title, description, type badge, assigned agent,
timestamps, and attachments in a compact, read-only format. There is no way to edit a task's
fields without deleting and recreating it.

The requirement is to let users click a card to open an expanded view where they can edit the
four mutable fields — title, description, type, and assigned — and save changes back to the
server. No new fields are to be introduced.

The existing backend endpoint `PUT /api/v1/spaces/:spaceId/tasks/:taskId` already accepts all
four fields and validates them. The frontend `handleUpdateTask` in `server.js` already implements
partial update semantics: only provided fields are patched.

A decision must be made on the UI container pattern: inline card expansion vs. a centred
`<Modal>` vs. a side-panel drawer (slide-in from the right).

## Decision
Implement the task detail view as a **right-side drawer** (off-canvas panel) that slides in when
a user clicks the card body. The drawer renders above the board content on a dedicated z-layer,
leaves the board partially visible behind a semi-transparent backdrop, and is dismissed by
pressing Escape, clicking the backdrop, or clicking the close button.

## Rationale
1. **Preserves spatial context**: unlike a centred modal, a side drawer keeps the Kanban board
   partially visible, so the user never loses their place on the board.
2. **Space for content**: the drawer provides adequate vertical height for a description textarea
   (which can be multi-line) without cropping, unlike an inline card expansion.
3. **Consistent interaction pattern**: the existing `<Modal>` component already handles Escape,
   backdrop click, and focus trap — the drawer reuses the same keyboard and accessibility
   semantics, extending `<Modal>` or mirroring its pattern for a `position: fixed` right-panel.
4. **No conflict with card actions**: card footer buttons (move arrows, run agent, delete) remain
   functional and visually distinct from the "open detail" click area — the click target for the
   drawer is the card header (title + badge zone), not the whole card.
5. **Minimal backend changes**: the `PUT /api/v1/spaces/:spaceId/tasks/:taskId` endpoint is
   sufficient. Only a new typed client wrapper `updateTask` needs to be added to `api/client.ts`.

## Consequences

### Positive
- Full-width right panel gives ample room for the description textarea.
- Board remains partially visible — spatial orientation is preserved.
- Escape / backdrop close aligns with existing UX conventions (Modal, AttachmentModal, etc.).
- Backend requires zero schema or routing changes.
- Store action `updateTask` is additive — no existing actions change signature.

### Negative / Risks
- Drawer adds one more z-layer above the board; must confirm it does not overlap the terminal
  panel or pipeline progress bar. **Mitigation**: assign `z-40` to the drawer (below the
  terminal `z-50` layer and toasts `z-60`).
- Clicking the card header must not also trigger drag-start. **Mitigation**: call
  `e.stopPropagation()` on the header click handler and do NOT call `onDragStart` there.
- Optimistic UI is not used — save is async. The save button shows a loading state and the
  drawer stays open until the server responds. **Mitigation**: on success close drawer + toast
  "Task updated"; on error toast "Failed to save" and keep the drawer open.
- Auto-save (debounced) is explicitly out of scope; explicit Save / Cancel buttons are used.

## Alternatives Considered
- **Inline card expansion**: expands the card in place, pushing other cards down. Discarded
  because it breaks column scroll position and is visually noisy when multiple descriptions
  are long.
- **Centred modal (reusing `<Modal>`)**: the existing Modal component is centred and covers the
  full viewport. Discarded because it fully obscures the board and doesn't give the user any
  spatial reference to which column the task lives in.
- **Inline-edit in place**: double-click on a field to edit it directly on the card. Discarded
  because it is error-prone on mobile/touch and does not allow editing description comfortably
  without a taller area.

## Review
Suggested review date: 2026-09-24
