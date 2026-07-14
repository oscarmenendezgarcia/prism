# ADR-1: Single source of truth for kanban column labels and order

## Status
Accepted

## Context
The kanban column identity map — `{ 'todo': 'Todo', 'in-progress': 'In Progress', 'done': 'Done' }` — and the ordered column list `['todo', 'in-progress', 'done']` are independently re-declared across the frontend:

| File | What it declares |
|------|------------------|
| `frontend/src/stores/useAppStore.ts` | `COLUMNS: Column[]` + `COLUMN_LABELS: Record<Column, string>` |
| `frontend/src/components/AutoTaskModal.tsx` | `COLUMNS: Column[]` + `COLUMN_LABELS: Record<Column, string>` |
| `frontend/src/components/board/TaskDetailPanel.tsx` | `COLUMN_LABELS: Record<Column, string>` + a local `columns: Column[]` literal |
| `frontend/src/components/modals/GlobalSearchModal.tsx` | `COLUMN_LABELS: Record<string, string>` (with `?? column` fallback) |
| `frontend/src/components/board/Column.tsx` | `COLUMN_META` (the `label` field duplicates the map; `accentClass`/`colIndex` are presentation-only) |
| `frontend/src/components/board/ColumnTabBar.tsx` | `TABS: { column, label }[]` (label duplicates the map) |
| `frontend/src/components/board/CardActionMenu.tsx` | `LEFT_LABEL` / `RIGHT_LABEL` — directional labels **derivable** from label map + order |

All copies currently agree, but nothing enforces that. A rename ("Done" → "Complete"), a reorder, or an i18n pass has to touch 6+ files and *will* drift. This is latent correctness debt, not a styling concern.

The `Column` string-literal type already lives in `frontend/src/types/index.ts` (`export type Column = 'todo' | 'in-progress' | 'done'`) and is the one authoritative type. There is no matching authoritative *value* module — no `frontend/src/constants/` directory exists yet.

## Decision
Create a new module `frontend/src/constants/columns.ts` that exports the single source of truth — `COLUMNS` (ordered array) and `COLUMN_LABELS` (id → display label) plus a small `adjacentColumnLabel()` helper — and replace every local re-declaration across the seven files with an import from it.

## Rationale
- **DRY / single reason to change** (SOLID): a label rename or i18n pass changes exactly one file; the type-checker guarantees `Record<Column, string>` stays exhaustive.
- **Constants belong in a value module, not the types file.** `types/index.ts` declares types (erased at build); runtime values (`COLUMNS`, `COLUMN_LABELS`) are a separate concern. A dedicated `constants/` directory keeps the separation clean and gives future shared constants a home.
- **Derive, don't duplicate.** `CardActionMenu`'s `LEFT_LABEL`/`RIGHT_LABEL` and `ColumnTabBar`'s `TABS` are projections of `(COLUMNS, COLUMN_LABELS)`. Deriving them removes the *hidden* fourth and fifth copies the task title didn't count.
- **Scope discipline.** Presentation-only data — `Column.tsx`'s `accentClass`/`colIndex`, `GlobalSearchModal.tsx`'s `COLUMN_COLORS` — is *not* an identity concern and stays local. Only the `label` field of `COLUMN_META` is deduped.

## Consequences
- **Positive**
  - One edit point for labels and order; drift becomes impossible for the identity map.
  - `Record<Column, string>` typing makes an incomplete map a compile error.
  - Establishes the `frontend/src/constants/` convention for future shared constants.
- **Negative / Risks**
  - Seven files gain an import (mechanical churn). *Mitigation:* one commit per file group, tests run after each.
  - `GlobalSearchModal` indexes with a raw `string` (`column` from an untyped `SearchResult`). *Mitigation:* keep the `?? column` fallback and index as `COLUMN_LABELS[column as Column] ?? column` — behavior identical.
  - `COLUMN_META` in `Column.tsx` must keep `accentClass`/`colIndex` while sourcing `label` from the shared map. *Mitigation:* build `COLUMN_META` by referencing `COLUMN_LABELS[col].label` — see blueprint §3.3.

## Alternatives Considered
- **Add the constants to `types/index.ts`** — discarded: mixes runtime values into the type-declaration file; that file is imported by nearly everything and should stay side-effect / value free.
- **Leave `CardActionMenu` / `ColumnTabBar` / `Column.tsx` labels as-is** (dedupe only the four literal `COLUMN_LABELS` copies) — discarded: leaves three latent copies of the same label strings; the point of the task is to make drift *impossible*, not merely rarer.
- **A runtime i18n library (react-intl / i18next)** — discarded: out of scope, no current localization requirement; this ADR deliberately leaves the labels as inline English strings in one place, which is exactly the seam an i18n pass would later replace.

## Review
Suggested review date: 2027-01-14 (+6 months), or sooner if an i18n requirement lands.
