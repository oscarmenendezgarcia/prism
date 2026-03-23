/**
 * Unit tests for usePanelResize hook.
 * Covers: initial width, clamping of out-of-bound stored values, drag sequence,
 * localStorage persistence, listener cleanup on unmount and mouseup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelResize } from '../../src/hooks/usePanelResize';

const DEFAULT_OPTIONS = {
  storageKey:   'prism:panel-width:test',
  defaultWidth: 480,
  minWidth:     320,
  maxWidth:     800,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fire a synthetic MouseEvent on window.
 * We dispatch on window so the hook's window.addEventListener picks it up.
 */
function fireWindowEvent(type: 'mousemove' | 'mouseup', clientX: number) {
  const event = new MouseEvent(type, { clientX, bubbles: true });
  window.dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Initial width
// ---------------------------------------------------------------------------

describe('usePanelResize — initial width', () => {
  it('returns defaultWidth when localStorage is empty', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.width).toBe(480);
  });

  it('returns the stored width when localStorage has a valid value', () => {
    localStorage.setItem(DEFAULT_OPTIONS.storageKey, JSON.stringify(600));
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.width).toBe(600);
  });

  it('returns minWidth when stored value is below minimum', () => {
    localStorage.setItem(DEFAULT_OPTIONS.storageKey, JSON.stringify(100));
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.width).toBe(DEFAULT_OPTIONS.minWidth);
  });

  it('returns maxWidth when stored value is above maximum', () => {
    localStorage.setItem(DEFAULT_OPTIONS.storageKey, JSON.stringify(9999));
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.width).toBe(DEFAULT_OPTIONS.maxWidth);
  });

  it('returns exact minWidth when stored value equals minWidth', () => {
    localStorage.setItem(DEFAULT_OPTIONS.storageKey, JSON.stringify(320));
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.width).toBe(320);
  });

  it('returns exact maxWidth when stored value equals maxWidth', () => {
    localStorage.setItem(DEFAULT_OPTIONS.storageKey, JSON.stringify(800));
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.width).toBe(800);
  });

  it('forwards minWidth and maxWidth in the return value', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
    expect(result.current.minWidth).toBe(DEFAULT_OPTIONS.minWidth);
    expect(result.current.maxWidth).toBe(DEFAULT_OPTIONS.maxWidth);
  });
});

// ---------------------------------------------------------------------------
// Drag sequence — mousemove updates width
// ---------------------------------------------------------------------------

describe('usePanelResize — drag sequence', () => {
  it('dragging left (negative clientX delta) increases width', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    // mousedown at clientX 500, startWidth = 480
    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    // move to clientX 400 → delta = 500 - 400 = 100 → newWidth = 480 + 100 = 580
    act(() => {
      fireWindowEvent('mousemove', 400);
    });

    expect(result.current.width).toBe(580);
  });

  it('dragging right (positive clientX delta) decreases width', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    // move to clientX 600 → delta = 500 - 600 = -100 → newWidth = 480 - 100 = 380
    act(() => {
      fireWindowEvent('mousemove', 600);
    });

    expect(result.current.width).toBe(380);
  });

  it('width does not go below minWidth during drag', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    // delta = 500 - 1000 = -500 → unclamped = -20, clamped to minWidth 320
    act(() => {
      fireWindowEvent('mousemove', 1000);
    });

    expect(result.current.width).toBe(DEFAULT_OPTIONS.minWidth);
  });

  it('width does not exceed maxWidth during drag', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    // delta = 500 - 0 = 500 → unclamped = 980, clamped to maxWidth 800
    act(() => {
      fireWindowEvent('mousemove', 0);
    });

    expect(result.current.width).toBe(DEFAULT_OPTIONS.maxWidth);
  });

  it('multiple mousemove events accumulate correctly from startWidth', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    act(() => { fireWindowEvent('mousemove', 450); }); // delta=50, width=530
    act(() => { fireWindowEvent('mousemove', 420); }); // delta=80, width=560

    expect(result.current.width).toBe(560);
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe('usePanelResize — localStorage persistence', () => {
  it('writes new width to localStorage on each mousemove', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    act(() => { fireWindowEvent('mousemove', 400); }); // width → 580

    const stored = JSON.parse(localStorage.getItem(DEFAULT_OPTIONS.storageKey)!);
    expect(stored).toBe(580);
  });

  it('width survives a re-render after being stored', () => {
    const { result, rerender } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });
    act(() => { fireWindowEvent('mousemove', 400); }); // stored = 580

    rerender();
    expect(result.current.width).toBe(580);
  });
});

// ---------------------------------------------------------------------------
// mouseup removes listeners
// ---------------------------------------------------------------------------

describe('usePanelResize — mouseup removes listeners', () => {
  it('mousemove after mouseup does not change width', () => {
    const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    act(() => { fireWindowEvent('mousemove', 400); }); // width = 580
    act(() => { fireWindowEvent('mouseup', 400); });   // drag ends

    const widthAfterDrag = result.current.width;

    act(() => { fireWindowEvent('mousemove', 300); }); // should be ignored

    expect(result.current.width).toBe(widthAfterDrag);
  });
});

// ---------------------------------------------------------------------------
// Unmount during active drag — listener cleanup
// ---------------------------------------------------------------------------

describe('usePanelResize — unmount during active drag', () => {
  it('does not throw when component unmounts mid-drag', () => {
    const { result, unmount } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    // Unmount while drag is still active — should not throw
    expect(() => unmount()).not.toThrow();
  });

  it('removes window listeners on unmount so subsequent mousemove is ignored', () => {
    const addSpy    = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { result, unmount } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault: vi.fn() } as any);
    });

    // Two listeners were added (mousemove + mouseup)
    const addedListeners = addSpy.mock.calls.map((c) => c[0]);
    expect(addedListeners).toContain('mousemove');
    expect(addedListeners).toContain('mouseup');

    unmount();

    // Both listeners were removed
    const removedListeners = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedListeners).toContain('mousemove');
    expect(removedListeners).toContain('mouseup');
  });
});
