---
title: ResizeObserver Hook: Container in State, Not Ref
author: agent
pinned: false
created: 2026-06-03T10:09:49.026Z
updated: 2026-06-03T10:09:49.026Z
---

## ResizeObserver Hook: Container in State, Not Ref

When implementing a DOM-measurement hook (e.g. `useOverflowItems`) that sets up a `ResizeObserver` on a container element, the container must be stored in **React state** — not just a ref callback.

### Why

A ref mutation (`ref.current = node`) does not trigger a re-render. If the setup `useEffect` depends on `ref.current`, it only runs on the initial render (when the container is still `null`) and never again when the DOM node is attached. The observer is never registered, and the hook silently does nothing.

Storing the container in state (`const [container, setContainer] = useState(null)`) ensures the effect re-runs when the node is assigned, because state updates schedule a render.

### Pattern

```ts
const [container, setContainer] = useState<HTMLElement | null>(null);

useEffect(() => {
  if (!container) return;
  const ro = new ResizeObserver(() => measure(container));
  ro.observe(container);
  return () => ro.disconnect();
}, [container]);

return { containerRef: setContainer, visibleCount, overflowItems };
```

The consumer passes `containerRef` as a callback ref (`<nav ref={containerRef}>`) — the API is identical to a ref, but the hook is wired correctly.

### Overflow reserved-space calculation

When computing a `reservedTrailingPx` constant (space to reserve for trailing UI: overflow button, add button, gaps), **include the container's own horizontal padding**.

Missing the nav's `px-4` (32 px) caused the add-button to be clipped past the `overflow-hidden` boundary at every viewport width (BUG-001, space-tabs-overflow, 2026-06-03).

Formula: `overflowBtnWidth + addBtnWidth + gaps + containerHorizontalPadding + safetyMargin`

Example: `42 + 28 + 8 + 32 + 2 = 112 px`
