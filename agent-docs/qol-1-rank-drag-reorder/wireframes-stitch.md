# Wireframes — Stitch Screens: QOL-1 Rank + Drag-to-Reorder

## Project

**Stitch Project**: Prism  
**Project ID**: `12795983416046485305`  
**Project URL**: `https://stitch.withgoogle.com/projects/12795983416046485305`

---

## Screens

### Screen 1: Kanban Column — Interaction States

**Screen ID**: `690f90ed304c464584dc146da47dba18`  
**Screen URL**: `https://stitch.withgoogle.com/projects/12795983416046485305/screens/690f90ed304c464584dc146da47dba18`  
**HTML File**: `stitch-screens/kanban-column-interaction-states.html`  
**Screenshot**: `https://lh3.googleusercontent.com/aida/AP1WRLtUXX2QFNzcP35hHwV70G6wRWoTxcAVW3quOPAMMSm1kaoMWVRojch5Ei5cgPULfWdfIBlyX44BYELO4KjMWCfiSzglozPT_3HADWWFpAwn_M3HzQmOMBtyAElTjWGZm3liDEfdURHSveOmly3z-KkcHK9V23yyXfB-lyrV7uZwCgFFBZRGb7fAGX9uTgHQtbttVoRsmqTBCLis_4N1AT2BVp9aJKEnSQG0v5aW4tqbpKdHmectRg5bcIjo`

**Design System Used**: Proton Syntax (auto-generated from design tokens)  
**Design System ID**: `assets/16ad9cef446c4c69b8440c82f45f77a5`

#### What this screen shows

A 280px-wide "Todo" Kanban column showing all 4 TaskCard interaction states side-by-side for developer reference:

| Card # | State | Key Visual Changes |
|---|---|---|
| 1 | **Default** | Standard card, no affordances visible |
| 2 | **Hover** | `drag_indicator` icon at left edge (opacity-40), purple glow shadow, action pill menu top-right |
| 3 | **Being dragged** | Rotate 1°, scale 0.97, shadow-xl, ring-1 ring-primary/40, opacity 80% |
| 4 | **Drop target (insert above)** | `border-t-2 border-t-primary` (#7C6DFA) — 2px purple line at card top |

Below card 4: dashed `border-primary/30` empty slot placeholder (h-16) for tail drop zone.

---

## Design Token Summary (applied to all screens)

| Token | Dark Mode Value | Tailwind Class |
|---|---|---|
| Background | `#0A0A0F` | `bg-background` |
| Card surface | `#111118` | `bg-surface` |
| Card elevated | `#1A1A24` | `bg-surface-elevated` |
| Primary accent | `#7C6DFA` | `text-primary`, `border-primary`, `bg-primary` |
| Text primary | `rgba(245,245,250,0.96)` | `text-text-primary` |
| Text secondary | `rgba(245,245,250,0.60)` | `text-text-secondary` |
| Text disabled | `rgba(245,245,250,0.30)` | `text-text-disabled` |
| Border | `rgba(255,255,255,0.08)` | `border-border` |
| Card radius | `12px` | `rounded-xl` |
| Font | Inter | `font-sans` |

---

## Implementation Notes for Developer Agent

### Drag handle placement
```tsx
{/* Drag handle — absolute left edge, hover-only */}
<div
  className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 [@media(pointer:coarse)]:opacity-30 transition-opacity duration-fast text-text-disabled cursor-grab active:cursor-grabbing"
  aria-hidden="true"
>
  <span className="material-symbols-outlined text-base leading-none">drag_indicator</span>
</div>
```

Card `article` needs `pl-6` (not `pl-4`) to make room for the handle.

### Drop indicator classes (conditional on drag store state)
```tsx
isDragOverThis && insertBeforeThis  ? 'border-t-2 border-t-primary ring-0' : '',
isDragOverThis && !insertBeforeThis ? 'border-b-2 border-b-primary ring-0' : '',
```

### Drag state (being dragged)
```tsx
isDragging ? 'rotate-1 scale-[0.97] shadow-xl ring-1 ring-primary/40 opacity-80' : '',
```
This class was already in the existing implementation from the card redesign — confirm it's already there before adding it.
