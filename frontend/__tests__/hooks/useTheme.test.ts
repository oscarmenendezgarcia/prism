/**
 * Tests for useTheme hook.
 * ADR-003 §4A.3: theme infrastructure — localStorage persistence, system preference,
 * html.dark class management, listener cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../../src/hooks/useTheme';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mq: MediaQueryList = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener as (e: MediaQueryListEvent) => void);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as (e: MediaQueryListEvent) => void);
    }),
    dispatchEvent: vi.fn((event: Event) => {
      listeners.forEach((l) => l(event as MediaQueryListEvent));
      return true;
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => mq),
  });
  return { mq, listeners };
}

// ── Setup/Teardown ────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false); // default: system prefers light
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useTheme', () => {
  it('defaults to system theme when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });

  it('resolves system theme to light when OS prefers light', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves system theme to dark when OS prefers dark', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('reads stored dark preference from localStorage', () => {
    localStorage.setItem('prism-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('reads stored light preference from localStorage', () => {
    localStorage.setItem('prism-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('setTheme("dark") adds dark class to html element', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setTheme("light") removes dark class from html element', () => {
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('setTheme("dark") persists to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));
    expect(localStorage.getItem('prism-theme')).toBe('dark');
  });

  it('setTheme("light") persists to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(localStorage.getItem('prism-theme')).toBe('light');
  });

  it('setTheme("system") removes prism-theme from localStorage', () => {
    localStorage.setItem('prism-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('system'));
    expect(localStorage.getItem('prism-theme')).toBeNull();
    expect(result.current.theme).toBe('system');
  });

  it('setTheme("dark") sets resolved theme to dark regardless of OS preference', () => {
    mockMatchMedia(false); // OS is light
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('setTheme("light") sets resolved theme to light regardless of OS preference', () => {
    mockMatchMedia(true); // OS is dark
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes matchMedia event listener on unmount', () => {
    const { mq } = mockMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());
    unmount();
    expect(mq.removeEventListener).toHaveBeenCalled();
  });
});
