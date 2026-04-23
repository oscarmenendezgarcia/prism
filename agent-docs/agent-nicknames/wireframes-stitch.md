# Wireframes Stitch: Agent Nicknames

## Stitch Project

**Project ID:** `15790477920468951127` (kanban-local — shared project for all Prism features)

## Generation Status

Stitch screen generation was attempted for both planned screens (S-01 SpaceModal and S-02 RunIndicator) using models `GEMINI_3_1_PRO` and `GEMINI_3_FLASH`. Both calls timed out — consistent with the known Stitch timeout issue documented in agent MEMORY.md (observed across multiple features since March 2026).

**Fallback:** Full ASCII wireframes with detailed state specifications are provided in `wireframes.md`. These are sufficient for implementation — the SpaceModal design closely follows the existing structure (same inputClass, ModalBody/ModalFooter pattern, collapsible section analogous to the Pipeline Stages section), and the RunIndicator change is a transparent label substitution with no layout change.

## Planned Screens (not generated due to timeout)

| Screen ID | Description | Device |
|-----------|-------------|--------|
| S-01 | SpaceModal — rename mode, Agent Nicknames section expanded, "El Jefe" filled | Desktop |
| S-02 | RunIndicator — single-agent mode showing "El Jefe" instead of "Senior Architect" | Desktop |

## Design Reference

All visual decisions follow the Prism dark theme (Trend A):

| Token | Value |
|-------|-------|
| bg-surface | #111118 |
| bg-surface-elevated | #1A1A24 |
| primary | #7C6DFA |
| text-primary | rgba(245,245,250,0.96) |
| text-secondary | rgba(245,245,250,0.60) |
| text-disabled | rgba(245,245,250,0.30) |
| border | rgba(255,255,255,0.08) |
| border-focus | #7C6DFA |
| radius-modal | 16px |
| radius-sm | 8px (inputs, buttons) |
| radius-xs | 6px (agent ID chips) |
| font | Inter |

### Key Component Patterns for Developer Reference

**Nickname input (filled state):**
- bg: `rgba(124,109,250,0.06)` (primary-container at low opacity)
- border: `rgba(124,109,250,0.30)` (primary at 30% — matches focus style but always visible)
- Same `inputClass` as all other SpaceModal inputs for ring/focus behavior

**Nickname input (empty state):**
- Same as other SpaceModal inputs: `bg-surface border-border rounded-lg px-4 py-3`
- Placeholder: text-disabled

**Agent ID chip:**
- Font: `font-mono text-xs text-text-secondary`
- bg: `bg-surface-sunken` (#07070B) or `bg-[rgba(255,255,255,0.03)]`
- Padding: `px-2 py-1`
- Border-radius: `rounded-xs` (6px)
- Not interactive — purely informational

**Section toggle row:**
- Full-row clickable button, `flex items-center gap-2`
- Chevron: Material Symbol "expand_more" / "chevron_right", rotates on expand (CSS transition)
- Label: `text-sm font-medium text-text-primary`
- `aria-expanded`, `aria-controls` required

**Section container (expanded):**
- bg: `bg-[rgba(255,255,255,0.02)]` (very subtle lift)
- border: `border border-border-subtle rounded-xl p-3`
- Divider between header and rows: `border-t border-[rgba(255,255,255,0.06)]`

**"Clear all nicknames" link:**
- `text-xs text-text-disabled hover:text-text-secondary underline`
- `type="button"`, `min-h-[44px]` for mobile touch target via padding

## Stitch HTML Files

No HTML files were saved to `stitch-screens/` — Stitch generation timed out before returning `htmlCode.downloadUrl`.

If Stitch becomes available, re-generate using the prompts below and save:
- `stitch-screens/space-modal-nicknames-expanded.html`
- `stitch-screens/run-indicator-with-nickname.html`

### Prompt for S-01 (SpaceModal)

> Dark theme modal dialog — Space Settings (rename mode) for a kanban/pipeline tool called Prism. Design tokens: bg #111118 (surface), #1A1A24 (elevated), #7C6DFA (primary violet), border rgba(255,255,255,0.08), text-primary rgba(245,245,250,0.96), text-secondary rgba(245,245,250,0.60), text-disabled rgba(245,245,250,0.30). Font: Inter. Border-radius: modal 16px, inputs 8px, buttons 8px. Modal 520px wide. Show collapsible "Agent Nicknames (optional)" section in expanded state. 4 rows — each shows agent ID chip (monospace, bg #0A0A0F, rounded 6px) left and nickname input right. First row (senior-architect) has value "El Jefe" with violet-tinted bg rgba(124,109,250,0.06) and border rgba(124,109,250,0.30). Other rows show placeholder text. "Clear all nicknames" text link at bottom. Footer: Cancel (ghost) + Save (primary violet) buttons.

### Prompt for S-02 (RunIndicator)

> Dark theme — RunIndicator widget for Prism pipeline tool. bg #1A1A24, primary #7C6DFA, text-primary rgba(245,245,250,0.96), text-secondary rgba(245,245,250,0.60), border rgba(255,255,255,0.08). Compact horizontal bar ~48px tall, rounded 12px, border 1px. Left: green pulse dot + "Running" label. Center: 4 step dots connected by lines — 2 completed (filled violet), 1 active (pulsing ring), 1 pending (empty). Below active dot: label "El Jefe" 11px text-primary (nickname for senior-architect). Right: "02:34" elapsed time + × abort button.
