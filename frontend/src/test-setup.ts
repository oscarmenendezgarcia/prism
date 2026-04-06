import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Global browser API stubs for jsdom
// ---------------------------------------------------------------------------

// ResizeObserver is not implemented in jsdom.
// CardGrid and any other component that creates a ResizeObserver will use this.
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

// IntersectionObserver is not implemented in jsdom.
// useLazyImage and CardImage rely on this.
(globalThis as typeof globalThis & { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
    takeRecords(): IntersectionObserverEntry[] { return []; }
  } as unknown as typeof IntersectionObserver;
