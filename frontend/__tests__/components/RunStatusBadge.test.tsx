/**
 * Tests for RunStatusBadge component.
 * ADR-1 (Agent Run History) T-014.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunStatusBadge } from '../../src/components/agent-run-history/RunStatusBadge';

describe('RunStatusBadge', () => {
  it('renders "Running" label for running status', () => {
    render(<RunStatusBadge status="running" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders "Completed" label for completed status', () => {
    render(<RunStatusBadge status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders "Cancelled" label for cancelled status', () => {
    render(<RunStatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders "Failed" label for failed status', () => {
    render(<RunStatusBadge status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('has role="status" for accessibility', () => {
    render(<RunStatusBadge status="running" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-label containing the status', () => {
    render(<RunStatusBadge status="completed" />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toContain('Completed');
  });

  it('shows a pulsing dot for running status', () => {
    const { container } = render(<RunStatusBadge status="running" />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('does NOT show a pulsing dot for completed status', () => {
    const { container } = render(<RunStatusBadge status="completed" />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeInTheDocument();
  });

  it('applies primary colour class for running', () => {
    render(<RunStatusBadge status="running" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-primary');
  });

  it('applies success colour class for completed', () => {
    render(<RunStatusBadge status="completed" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-success');
  });

  it('applies warning colour class for cancelled', () => {
    render(<RunStatusBadge status="cancelled" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-warning');
  });

  it('applies error colour class for failed', () => {
    render(<RunStatusBadge status="failed" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-error');
  });
});
