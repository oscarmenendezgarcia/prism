# Wireframes Stitch: Auto-task Button

## Stitch Project

- **Project ID:** `15790477920468951127`
- **Project URL:** https://stitch.withgoogle.com/projects/15790477920468951127

## Generation Status

Stitch `generate_screen_from_text` timed out consistently during this session.
This is a known infrastructure issue documented in agent MEMORY.md (first observed March 2026).

**Fallback in effect:** ASCII wireframes in `wireframes.md` are the authoritative design
reference. The developer agent must use those wireframes plus the design tokens below to
implement the component.

## Design Tokens to Use in Implementation

```
Dark theme (default):
  --color-background:      #0D0D0F
  --color-surface:         rgba(30, 30, 35, 0.72)
  --color-surface-elevated: rgba(44, 44, 49, 0.80)
  --color-primary:         #0A84FF
  --color-text-primary:    #F5F5F7
  --color-text-secondary:  rgba(245, 245, 247, 0.55)
  --color-border:          rgba(255, 255, 255, 0.08)

Border radius:
  pill (FAB):    9999px
  modal:         20px
  button:        8px
  card:          14px

Shadows:
  --shadow-modal: 0 24px 80px rgba(0, 0, 0, 0.60), 0 0 0 1px rgba(255, 255, 255, 0.08)
  FAB glow:       0 0 20px rgba(124, 58, 237, 0.20), 0 0 40px rgba(6, 182, 212, 0.08)

FAB gradient border colors:
  Stop 0%:   #7C3AED  (purple)
  Stop 33%:  #2563EB  (blue)
  Stop 66%:  #06B6D4  (cyan)
  Stop 100%: #7C3AED  (purple — loops)

Animation:
  Rotation: 4s linear infinite (keyframe: conic-gradient rotates 360deg)
  Hover speed: 2s
  Reduced-motion: animation-play-state: paused

Glass utilities (already in index.css):
  .glass-surface  → blur(20px) saturate(180%)
  .glass-heavy    → blur(40px) saturate(200%)
```

## Screens to Implement

### S-01: Auto-task FAB Resting State
- Board view, all three columns visible
- FAB fixed bottom-right (right: 24px, bottom: .bottom-safe-6)
- Pill shape, gradient border rotating, subtle glow
- Label "Auto-task" + sparkle icon visible on desktop, icon-only on mobile

### S-02: Auto-task FAB Modal Open
- Board dimmed by scrim rgba(0,0,0,0.50)
- Centered glass-heavy modal, max-width 520px
- Textarea, Space/Column selectors, Generate button
- FAB still visible behind scrim

## Retry Instructions

If Stitch becomes available in a future session, generate screens with:

```
mcp__stitch__generate_screen_from_text({
  projectId: "15790477920468951127",
  prompt: "...",  // see wireframes.md for detailed descriptions
  deviceType: "DESKTOP",
  modelId: "GEMINI_3_FLASH"
})
```

Save HTML from `htmlCode.downloadUrl` to:
- `agent-docs/auto-task-button/stitch-screens/auto-task-button-resting.html`
- `agent-docs/auto-task-button/stitch-screens/auto-task-button-modal.html`
