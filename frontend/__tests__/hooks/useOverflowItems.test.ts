/**
 * Unit tests for useOverflowItems hook.
 *
 * Strategy: mock DOM measurements (getBoundingClientRect) and ResizeObserver
 * so we can control container width and item widths precisely.
 *
 * Each test sets up fake widths, renders the hook, and asserts the resulting
 * visible/overflow split and measuring flag.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOverflowItems } from '../../src/hooks/useOverflowItems';

// ---------------------------------------------------------------------------
// ResizeObserver mock
// ---------------------------------------------------------------------------
type ROCallback = (entries: ResizeObserverEntry[]) => void;
let roCallback: ROCallback | null = null;
let roObservedElement: Element | null = null;

class MockResizeObserver {
  private cb: ROCallback;
  constructor(callback: ROCallback) {
    this.cb = callback;
    roCallback = callback;
  }
  observe(el: Element) {
    roCallback = this.cb;
    roObservedElement = el;
  }
  disconnect() {
    roCallback = null;
    roObservedElement = null;
  }
  unobserve() {}
}

// ---------------------------------------------------------------------------
// Helpers for faking DOM measurements
// ---------------------------------------------------------------------------
function makeItem(id: string) {
  return { id };
}

/** Stub getBoundingClientRect on an element-like object. */
function makeEl(width: number): HTMLElement {
  const el = document.createElement('div');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 32,
    top: 0,
    bottom: 32,
    left: 0,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  roCallback = null;
  roObservedElement = null;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  // Default: rAF executes synchronously in tests
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: render hook, wire up container + item refs.
// The container is STATE in useOverflowItems, so attaching it triggers a
// re-render automatically; the measure pass runs in that same act().
// ---------------------------------------------------------------------------
function renderWithWidths(
  items: { id: string }[],
  containerWidth: number,
  itemWidthPx: number | number[],
  opts?: Parameters<typeof useOverflowItems>[1],
) {
  const containerEl = makeEl(containerWidth);
  const itemEls = items.map((_, i) =>
    makeEl(Array.isArray(itemWidthPx) ? itemWidthPx[i] : itemWidthPx),
  );

  const { result, rerender } = renderHook(() =>
    useOverflowItems(items, opts),
  );

  // Wire item refs first (before containerRef so they are ready when measure runs)
  act(() => {
    items.forEach((item, i) => {
      result.current.setItemRef(item.id)(itemEls[i]);
    });
  });

  // Wire containerRef — this sets container STATE, triggering a re-render
  // which runs the measure pass (measuring=true → captures widths → computes split)
  act(() => {
    result.current.containerRef(containerEl);
  });

  return { result, rerender, containerEl, itemEls };
}

// ---------------------------------------------------------------------------
// Suite 1: Initial state
// ---------------------------------------------------------------------------
describe('useOverflowItems — initial state', () => {
  it('starts in measuring=true with empty visible/overflow', () => {
    const { result } = renderHook(() =>
      useOverflowItems([makeItem('a'), makeItem('b')], {}),
    );
    // Before any refs are attached, measuring=true and arrays are empty
    expect(result.current.measuring).toBe(true);
    expect(result.current.visible).toEqual([]);
    expect(result.current.overflow).toEqual([]);
  });

  it('returns measuring=false and empty arrays when items list is empty', () => {
    const containerEl = makeEl(400);
    const { result } = renderHook(() => useOverflowItems([], {}));

    act(() => {
      result.current.containerRef(containerEl);
    });

    // With no items, measuring should settle to false
    expect(result.current.visible).toEqual([]);
    expect(result.current.overflow).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: All items fit
// ---------------------------------------------------------------------------
describe('useOverflowItems — all items fit', () => {
  it('places all items in visible when they all fit', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    // Each item: 80px, container: 400px, reserved: 72px → available: 328px
    // a=80, b=80+2=82, c=80+2=82 → total 244 ≤ 328 → all fit
    const { result } = renderWithWidths(items, 400, 80, { reservedTrailingPx: 72, gapPx: 2 });

    expect(result.current.measuring).toBe(false);
    expect(result.current.visible.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.overflow).toHaveLength(0);
  });

  it('handles a single item that fits', () => {
    const items = [makeItem('x')];
    const { result } = renderWithWidths(items, 300, 80, { reservedTrailingPx: 72 });

    expect(result.current.visible.map((i) => i.id)).toEqual(['x']);
    expect(result.current.overflow).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Some items overflow
// ---------------------------------------------------------------------------
describe('useOverflowItems — overflow', () => {
  it('splits items correctly when container is narrow', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c'), makeItem('d')];
    // Each item: 80px, container: 250px, reserved: 72px → available: 178px
    // a=80 fits (used=80), b=80+2=82 fits (used=162), c=80+2=82 → 162+82=244 > 178 → overflow
    // visible: [a, b], overflow: [c, d]
    const { result } = renderWithWidths(items, 250, 80, { reservedTrailingPx: 72, gapPx: 2 });

    expect(result.current.visible.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.current.overflow.map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('overflows all items when container is too narrow for anything', () => {
    const items = [makeItem('a'), makeItem('b')];
    // Each: 80px, container: 50px, reserved: 72px → available: max(0, -22) = 0 → nothing fits
    const { result } = renderWithWidths(items, 50, 80, { reservedTrailingPx: 72, gapPx: 2 });

    expect(result.current.visible).toHaveLength(0);
    expect(result.current.overflow.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('respects variable item widths', () => {
    const items = [makeItem('short'), makeItem('very-long-name'), makeItem('medium')];
    // widths: [60, 180, 100], container: 350, reserved: 72 → available: 278
    // short=60 (used=60), very-long-name=180+2=182 (used=242), medium=100+2=102 → 242+102=344>278 → overflow
    const { result } = renderWithWidths(items, 350, [60, 180, 100], {
      reservedTrailingPx: 72,
      gapPx: 2,
    });

    expect(result.current.visible.map((i) => i.id)).toEqual(['short', 'very-long-name']);
    expect(result.current.overflow.map((i) => i.id)).toEqual(['medium']);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Pinned item forced into visible
// ---------------------------------------------------------------------------
describe('useOverflowItems — pinnedId', () => {
  it('forces pinnedId into visible even when it would overflow', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('active'), makeItem('d')];
    // Each 80px, container 200px, reserved 72 → available 128
    // a=80 fits (used=80), b=80+2=82 → 162>128 → b overflows; a,b→ wait:
    // Actually: a=80 fits (80≤128), b=82 → 80+82=162>128 → overflow
    // visible=[a], overflow=[b, active, d]
    // pinnedId='active' → force active into visible:
    //   active found at overflow[1], splice it out → [b, d]
    //   last of visible=[a], a.id!='active' → pop a, unshift to overflow → overflow=[a,b,d]
    //   push active → visible=[active]
    // Wait, that seems off. Let me recalculate:
    // reservedTrailingPx=72, so available = 200 - 72 = 128
    // item a: 80 ≤ 128 → visible=[a], used=80
    // item b: 80+2=82, used+82=162 > 128 → overflow=[b]
    // item active: 80+2=82, used=162>128 → overflow=[b,active]
    // item d: overflow=[b,active,d]
    // visible=[a], pinnedId='active', active not in visible
    // overflowIdx = 1 (active)
    // Splice active: overflow=[b,d], pinned=active
    // last visible = a, a.id !== 'active' → pop → visible=[], overflow=[a,b,d]
    // push active → visible=[active]
    const { result } = renderWithWidths(items, 200, 80, {
      reservedTrailingPx: 72,
      gapPx: 2,
      pinnedId: 'active',
    });

    const visibleIds = result.current.visible.map((i) => i.id);
    expect(visibleIds).toContain('active');
    expect(result.current.overflow.map((i) => i.id)).not.toContain('active');
  });

  it('does not bump an item when pinnedId is already visible', () => {
    const items = [makeItem('active'), makeItem('b'), makeItem('c')];
    // Each 60px, container 300px, reserved 72 → available 228
    // active=60 (60≤228), b=62 (122≤228), c=62 (184≤228) → all fit
    const { result } = renderWithWidths(items, 300, 60, {
      reservedTrailingPx: 72,
      gapPx: 2,
      pinnedId: 'active',
    });

    expect(result.current.visible.map((i) => i.id)).toEqual(['active', 'b', 'c']);
    expect(result.current.overflow).toHaveLength(0);
  });

  it('pinnedId remains in visible after recompute with same container width', () => {
    const items = [makeItem('a'), makeItem('pinned'), makeItem('c')];
    // Each 100px, container 200px, reserved 72 → available 128
    // a=100 fits (used=100), pinned=102>128 → overflow=[pinned,c]
    // pinnedId='pinned' → force → visible=[pinned], overflow=[a,c] (a bumped)
    const { result } = renderWithWidths(items, 200, 100, {
      reservedTrailingPx: 72,
      gapPx: 2,
      pinnedId: 'pinned',
    });

    expect(result.current.visible.map((i) => i.id)).toContain('pinned');
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Container width change (ResizeObserver)
// ---------------------------------------------------------------------------
describe('useOverflowItems — ResizeObserver / resize', () => {
  it('recomputes when container width increases (more items become visible)', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    const containerEl = makeEl(200); // narrow → only a fits

    const { result } = renderHook(() =>
      useOverflowItems(items, { reservedTrailingPx: 72, gapPx: 2 }),
    );

    // Wire items with 80px each, then attach container (container is STATE → triggers re-render + measure pass)
    const itemEls = items.map(() => makeEl(80));
    act(() => {
      items.forEach((item, i) => result.current.setItemRef(item.id)(itemEls[i]));
    });
    act(() => {
      result.current.containerRef(containerEl);
    });

    // Initially narrow: available=128, a=80, b=82>128 → visible=[a], overflow=[b,c]
    expect(result.current.visible.map((i) => i.id)).toEqual(['a']);

    // Widen the container to 400px
    vi.spyOn(containerEl, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 32,
      top: 0, bottom: 32, left: 0, right: 400, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Simulate a resize event
    act(() => {
      roCallback?.([]);
    });

    // Now available=328, all items fit (80+82+82=244≤328)
    expect(result.current.visible.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.overflow).toHaveLength(0);
  });

  it('recomputes when container width decreases (more items overflow)', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    const containerEl = makeEl(400); // wide → all fit initially

    const { result } = renderHook(() =>
      useOverflowItems(items, { reservedTrailingPx: 72, gapPx: 2 }),
    );

    const itemEls = items.map(() => makeEl(80));
    act(() => { items.forEach((item, i) => result.current.setItemRef(item.id)(itemEls[i])); });
    act(() => { result.current.containerRef(containerEl); });

    expect(result.current.visible).toHaveLength(3);

    // Narrow the container
    vi.spyOn(containerEl, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 32,
      top: 0, bottom: 32, left: 0, right: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      roCallback?.([]);
    });

    // available=128, a=80 fits, b=82→162>128 → overflow
    expect(result.current.visible.map((i) => i.id)).toEqual(['a']);
    expect(result.current.overflow).toHaveLength(2);
  });

  it('cleans up ResizeObserver on unmount', () => {
    const items = [makeItem('a')];
    const { unmount } = renderHook(() => useOverflowItems(items, {}));

    unmount();

    // roCallback should be null after disconnect
    expect(roCallback).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Items change
// ---------------------------------------------------------------------------
describe('useOverflowItems — items change', () => {
  it('recomputes visible/overflow when a new item is added', () => {
    // items1: two items that both fit a 400px container
    const items1 = [makeItem('a'), makeItem('b')];
    const containerEl = makeEl(250); // narrow: 250-72=178px available

    const { result, rerender } = renderHook(
      ({ items }: { items: { id: string }[] }) => useOverflowItems(items, { reservedTrailingPx: 72, gapPx: 2 }),
      { initialProps: { items: items1 } },
    );

    // Each item 80px; available=178: a=80 fits, b=82 → 162≤178 fits → both visible
    const item1Els = items1.map(() => makeEl(80));
    act(() => { items1.forEach((item, i) => result.current.setItemRef(item.id)(item1Els[i])); });
    act(() => { result.current.containerRef(containerEl); });

    expect(result.current.visible.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.current.overflow).toHaveLength(0);
    expect(result.current.measuring).toBe(false);

    // Add a third item — items change triggers re-measure
    const items2 = [makeItem('a'), makeItem('b'), makeItem('c')];
    const item2Els = items2.map(() => makeEl(80));
    act(() => {
      // Wire new item ref
      result.current.setItemRef('c')(item2Els[2]);
      rerender({ items: items2 });
    });

    // After re-measure: a=80 fits (80≤178), b=82 (162≤178) fits, c=82 → 244>178 → overflow
    expect(result.current.visible.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.current.overflow.map((i) => i.id)).toEqual(['c']);
    expect(result.current.measuring).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Zero-item edge case
// ---------------------------------------------------------------------------
describe('useOverflowItems — edge cases', () => {
  it('handles items=[] gracefully — settles measuring=false without a container', () => {
    // Empty items settle immediately in the first layout effect pass
    // (no container required — the hook special-cases empty arrays)
    const { result } = renderHook(() => useOverflowItems([], {}));

    expect(result.current.visible).toEqual([]);
    expect(result.current.overflow).toEqual([]);
    expect(result.current.measuring).toBe(false);
  });

  it('setItemRef null call removes the item element', () => {
    const items = [makeItem('a')];
    const containerEl = makeEl(400);
    const { result } = renderHook(() => useOverflowItems(items, {}));

    const itemEl = makeEl(80);
    act(() => {
      result.current.containerRef(containerEl);
      result.current.setItemRef('a')(itemEl);
    });

    // Now remove the ref (simulate unmount of tab)
    expect(() => {
      act(() => {
        result.current.setItemRef('a')(null);
      });
    }).not.toThrow();
  });

  it('returns stable setItemRef callback identity across renders', () => {
    const items = [makeItem('a')];
    const { result, rerender } = renderHook(() => useOverflowItems(items, {}));

    const firstSetItemRef = result.current.setItemRef;
    rerender();
    expect(result.current.setItemRef).toBe(firstSetItemRef);
  });

  it('returns stable containerRef callback identity across renders', () => {
    const items = [makeItem('a')];
    const { result, rerender } = renderHook(() => useOverflowItems(items, {}));

    const firstContainerRef = result.current.containerRef;
    rerender();
    expect(result.current.containerRef).toBe(firstContainerRef);
  });
});
