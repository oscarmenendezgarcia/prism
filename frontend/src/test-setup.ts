import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Global browser API stubs for jsdom
// ---------------------------------------------------------------------------

// window.matchMedia is not implemented in jsdom.
// useMediaQuery falls back to false when matchMedia is unavailable, but this
// stub lets tests mock specific breakpoints via Object.defineProperty overrides.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// ResizeObserver is not implemented in jsdom.
// CardGrid and any other component that creates a ResizeObserver will use this.
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

// scrollIntoView is not implemented in jsdom.
// GlobalSearchModal uses it to keep the selected result visible.
Element.prototype.scrollIntoView = () => {};

// document.fonts.ready resolves asynchronously in jsdom and re-triggers the
// layout-measuring pass in useOverflowItems outside React's act(), which can
// leave a component stuck in its hidden "measuring" render. Neutralise it so the
// measurement settles once and stays deterministic (font re-measure is browser-only).
Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });

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
