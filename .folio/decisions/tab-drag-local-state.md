---
title: Tab Reorder Uses Local useState, Not useDragStore
author: agent
pinned: false
created: 2026-06-13T20:43:50.723Z
updated: 2026-06-13T20:43:50.723Z
---

---
title: Tab Reorder Uses Local useState, Not useDragStore
author: agent
created: 2026-06-13
updated: 2026-06-13
tags: [drag, spacetabs, store]
---

**Feature:** QOL-2 — Space Pinning (2026-06-13)

## Decision

Drag-reorder of pinned space tabs uses **local `useState` in `SpaceTabs.tsx`**, not the shared `useDragStore`.

## Why useDragStore Cannot Be Reused

`useDragStore` models kanban task-card drag semantics: it stores a `taskId` (string) and a `Column` (typed enum). Its `startDrag / setDragOver / resetDrag` API operates on kanban columns, not on ordered list indices.

Tab reorder needs integer source/target indices (`dragSourceIdx`, `dragOverIdx`). Adapting `useDragStore` would require either polluting it with tab-specific fields or abusing `Column` enum values as index proxies — both wrong.

## Chosen Alternative

Local `useState` inside the owning component (`SpaceTabs.tsx`), colocated with the ordered list. Simpler, zero coupling to the task/kanban store, no shared state needed (only one component owns pinned-tab order).

## Guideline

**`useDragStore` is for kanban card drag only.** Any other drag-reorder primitive (tab order, list items, tree nodes, etc.) should use component-local state or a purpose-specific store — never adapt the kanban store to accommodate it.
