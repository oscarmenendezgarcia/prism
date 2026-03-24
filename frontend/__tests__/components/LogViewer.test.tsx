/**
 * Unit tests for LogViewer component.
 * ADR-1 (log-viewer) T-010: auto-scroll, empty states, error state, scroll-to-bottom button.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LogViewer } from '../../src/components/pipeline-log/LogViewer';

// Silence console.log from the component internals during tests.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const defaultProps = {
  content:   '',
  isPending: false,
  isRunning: false,
  isLoading: false,
  error:     null,
};

describe('LogViewer — error state', () => {
  it('renders error message when error is non-null', () => {
    render(<LogViewer {...defaultProps} error="HTTP 500 server error" />);
    expect(screen.getByText('HTTP 500 server error')).toBeInTheDocument();
  });

  it('shows error icon when error is non-null', () => {
    render(<LogViewer {...defaultProps} error="something failed" />);
    // The error icon is a material symbol with text 'error'
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('does not render pre element when error is set', () => {
    render(<LogViewer {...defaultProps} error="fail" />);
    expect(screen.queryByRole('log')).toBeNull();
    expect(document.querySelector('pre')).toBeNull();
  });
});

describe('LogViewer — pending empty state', () => {
  it('shows "Stage not started yet." when isPending and content is empty', () => {
    render(<LogViewer {...defaultProps} isPending content="" />);
    expect(screen.getByText('Stage not started yet.')).toBeInTheDocument();
  });

  it('shows hourglass_empty icon in pending state', () => {
    render(<LogViewer {...defaultProps} isPending content="" />);
    expect(screen.getByText('hourglass_empty')).toBeInTheDocument();
  });
});

describe('LogViewer — running/loading empty state', () => {
  it('shows "Waiting for output..." when isRunning and content is empty', () => {
    render(<LogViewer {...defaultProps} isRunning content="" />);
    expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
  });

  it('shows "Waiting for output..." when isLoading and content is empty', () => {
    render(<LogViewer {...defaultProps} isLoading content="" />);
    expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
  });

  it('shows spinner icon in running state', () => {
    render(<LogViewer {...defaultProps} isRunning content="" />);
    expect(screen.getByText('progress_activity')).toBeInTheDocument();
  });
});

describe('LogViewer — no-output empty state (completed, no content)', () => {
  it('shows "No output for this stage." when not pending, not running, empty content', () => {
    render(<LogViewer {...defaultProps} content="" />);
    expect(screen.getByText('No output for this stage.')).toBeInTheDocument();
  });
});

describe('LogViewer — log content rendering', () => {
  it('renders content inside a pre element', () => {
    render(<LogViewer {...defaultProps} content="line1\nline2\nline3" />);
    const pre = document.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('line1');
    expect(pre?.textContent).toContain('line3');
  });

  it('applies font-mono class to pre element', () => {
    render(<LogViewer {...defaultProps} content="some log" />);
    const pre = document.querySelector('pre');
    expect(pre?.className).toContain('font-mono');
  });

  it('applies text-xs class to pre element', () => {
    render(<LogViewer {...defaultProps} content="some log" />);
    const pre = document.querySelector('pre');
    expect(pre?.className).toContain('text-xs');
  });
});

describe('LogViewer — auto-scroll behaviour', () => {
  it('auto-scrolls to bottom when content changes and isAtBottom is true', async () => {
    const { rerender } = render(<LogViewer {...defaultProps} content="line 1" />);
    const pre = document.querySelector('pre') as HTMLPreElement;

    // Simulate that the container has scrollable content.
    Object.defineProperty(pre, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 200, configurable: true });
    pre.scrollTop = 800; // near bottom

    await act(async () => {
      rerender(<LogViewer {...defaultProps} content="line 1\nline 2" />);
    });

    // Auto-scroll should set scrollTop to scrollHeight.
    expect(pre.scrollTop).toBe(1000);
  });

  it('does NOT auto-scroll when user has scrolled up', async () => {
    render(<LogViewer {...defaultProps} content="line 1" />);
    const pre = document.querySelector('pre') as HTMLPreElement;

    Object.defineProperty(pre, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 200, configurable: true });
    // User scrolled to top → not at bottom
    pre.scrollTop = 0;
    fireEvent.scroll(pre);

    const scrollTopBeforeUpdate = pre.scrollTop;

    await act(async () => {
      // Trigger re-render with new content — auto-scroll should not fire.
    });

    expect(pre.scrollTop).toBe(scrollTopBeforeUpdate);
  });
});

describe('LogViewer — scroll-to-bottom button', () => {
  it('does not show "Scroll to bottom" button initially (isAtBottom=true)', () => {
    render(<LogViewer {...defaultProps} content="some log" />);
    expect(screen.queryByRole('button', { name: /scroll to bottom/i })).toBeNull();
  });

  it('shows "Scroll to bottom" button when user scrolls up', () => {
    render(<LogViewer {...defaultProps} content="some log" />);
    const pre = document.querySelector('pre') as HTMLPreElement;

    // Simulate scroll away from bottom.
    Object.defineProperty(pre, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 200, configurable: true });
    pre.scrollTop = 0;
    fireEvent.scroll(pre);

    expect(screen.getByRole('button', { name: /scroll to bottom/i })).toBeInTheDocument();
  });

  it('scrolls to bottom and hides button when "Scroll to bottom" is clicked', () => {
    render(<LogViewer {...defaultProps} content="some log" />);
    const pre = document.querySelector('pre') as HTMLPreElement;

    Object.defineProperty(pre, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(pre, 'clientHeight', { value: 200, configurable: true });
    pre.scrollTop = 0;
    fireEvent.scroll(pre);

    const btn = screen.getByRole('button', { name: /scroll to bottom/i });
    fireEvent.click(btn);

    // After clicking, scrollTop should equal scrollHeight.
    expect(pre.scrollTop).toBe(1000);
    // Button should be gone again.
    expect(screen.queryByRole('button', { name: /scroll to bottom/i })).toBeNull();
  });
});
