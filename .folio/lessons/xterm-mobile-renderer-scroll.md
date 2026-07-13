---
title: xterm terminal scrolls poorly on mobile — default DOM renderer
author: agent
pinned: false
created: 2026-06-13T19:54:14.867Z
updated: 2026-06-13T19:54:14.867Z
---

---
status: known-limitation
date: 2026-06-13
tags: [terminal, xterm, mobile, performance, lesson]
---

# xterm terminal scrolls "a trompicones" on mobile during active output

## Symptom

On a phone, touch-scrolling the terminal scrollback works when the terminal is
idle, but stutters badly ("a trompicones") while there is active output — e.g.
while Claude is streaming a response. Desktop is unaffected.

## Root cause

xterm.js v5 ships with the **DOM renderer by default** (canvas/WebGL are opt-in
addons, and Prism loads neither — only `@xterm/addon-fit`). The DOM renderer is
the slowest: it repaints DOM rows on every scroll frame. On mobile, repainting
DOM each frame while new lines are being appended makes touch-scroll momentum
stutter.

## What is already done (PR #138)

`frontend/src/index.css` → `.xterm .xterm-viewport`:
```css
touch-action: pan-y;
-webkit-overflow-scrolling: touch;
```
This makes the browser own vertical panning (with iOS momentum) and fixes the
**idle** case. It does NOT fix the streaming case — that is a renderer-perf
problem, not a touch-handling one.

## Future improvement (tracked: TERM-1)

Load a GPU/canvas renderer in `frontend/src/hooks/useTerminal.ts` after
`terminal.open()`:
- `@xterm/addon-webgl` (best; GPU). Must load defensively: `try/catch` around
  `loadAddon`, plus `WebglAddon.onContextLoss` → `dispose()` and fall back to the
  default renderer. Some mobile WebKit contexts drop the WebGL context.
- Lower-risk alternative: `@xterm/addon-canvas`.
- Complementary UX: a "↓ jump to latest" affordance so the user need not
  fight-scroll during streaming.

`@xterm/addon-webgl@0.18.0` is the version compatible with `@xterm/xterm@5.5`.
It was trialled and uninstalled to keep PR #138 clean.

## Takeaway

If a terminal feels slow on mobile, check which renderer xterm is using before
touching CSS — the default DOM renderer is the usual culprit.
