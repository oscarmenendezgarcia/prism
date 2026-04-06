/**
 * Tests for ThemeToggle component.
 * ADR-003 §4A.5: cycles system -> light -> dark -> system, correct icons,
 * accessible aria-label, pure UI component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '../../src/components/layout/ThemeToggle';

// ── matchMedia mock ───────────────────────────────────────────────────────────

function mockMatchMedia(matches = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ThemeToggle', () => {
  it('renders a button', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows brightness_auto icon when theme is system (default)', () => {
    render(<ThemeToggle />);
    expect(screen.getByText('brightness_auto')).toBeInTheDocument();
  });

  it('has accessible aria-label for system mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to light mode');
  });

  it('cycles from system to light on first click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('light_mode')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to dark mode');
  });

  it('cycles from light to dark on second click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button')); // system -> light
    fireEvent.click(screen.getByRole('button')); // light -> dark
    expect(screen.getByText('dark_mode')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to system mode');
  });

  it('cycles from dark back to system on third click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button')); // system -> light
    fireEvent.click(screen.getByRole('button')); // light -> dark
    fireEvent.click(screen.getByRole('button')); // dark -> system
    expect(screen.getByText('brightness_auto')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to light mode');
  });

  it('persists theme to localStorage on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button')); // system -> light
    expect(localStorage.getItem('prism-theme')).toBe('light');
  });

  it('applies dark class to html element when cycling to dark', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button')); // system -> light
    fireEvent.click(screen.getByRole('button')); // light -> dark
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class from html element when cycling to light', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('prism-theme', 'dark');
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button')); // dark -> system (light OS)
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
