/**
 * QA unit tests for EffortSegmented.
 *
 * Covers:
 *   - All three effort buttons render
 *   - All buttons are disabled (Phase 1 read-only)
 *   - Active segment highlights the matching effort level
 *   - undefined value → no segment highlighted
 *   - Invalid/out-of-range value → no segment highlighted
 *   - aria-disabled and aria-pressed semantics
 *   - role="group" with accessible label
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EffortSegmented } from '../../src/components/config/EffortSegmented';

describe('EffortSegmented — renders all segments', () => {
  it('renders low, medium, and high buttons', () => {
    render(<EffortSegmented value="medium" />);
    expect(screen.getByRole('button', { name: 'low', hidden: true })).toBeDefined();
    expect(screen.getByRole('button', { name: 'medium', hidden: true })).toBeDefined();
    expect(screen.getByRole('button', { name: 'high', hidden: true })).toBeDefined();
  });

  it('renders the group container with role="group"', () => {
    render(<EffortSegmented value="low" />);
    expect(screen.getByRole('group', { name: /effort level/i })).toBeDefined();
  });
});

describe('EffortSegmented — read-only (Phase 1)', () => {
  it('all three buttons are disabled', () => {
    render(<EffortSegmented value="high" />);
    const buttons = screen.getAllByRole('button', { hidden: true });
    const effortBtns = buttons.filter((b) =>
      ['low', 'medium', 'high'].includes(b.textContent?.trim() ?? '')
    );
    expect(effortBtns).toHaveLength(3);
    effortBtns.forEach((btn) => {
      expect(btn.hasAttribute('disabled')).toBe(true);
      expect(btn.getAttribute('aria-disabled')).toBe('true');
    });
  });
});

describe('EffortSegmented — active segment (aria-pressed)', () => {
  it('marks the "low" button as pressed when value="low"', () => {
    render(<EffortSegmented value="low" />);
    const btn = screen.getByRole('button', { name: 'low', hidden: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the "medium" button as pressed when value="medium"', () => {
    render(<EffortSegmented value="medium" />);
    const btn = screen.getByRole('button', { name: 'medium', hidden: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the "high" button as pressed when value="high"', () => {
    render(<EffortSegmented value="high" />);
    const btn = screen.getByRole('button', { name: 'high', hidden: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('no button is pressed when value is undefined', () => {
    render(<EffortSegmented />);
    const buttons = screen.getAllByRole('button', { hidden: true });
    const effortBtns = buttons.filter((b) =>
      ['low', 'medium', 'high'].includes(b.textContent?.trim() ?? '')
    );
    effortBtns.forEach((btn) => {
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('no button is pressed when value is an unknown string', () => {
    render(<EffortSegmented value="ultra" />);
    const buttons = screen.getAllByRole('button', { hidden: true });
    const effortBtns = buttons.filter((b) =>
      ['low', 'medium', 'high'].includes(b.textContent?.trim() ?? '')
    );
    effortBtns.forEach((btn) => {
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('non-active segments have aria-pressed=false', () => {
    render(<EffortSegmented value="high" />);
    const low = screen.getByRole('button', { name: 'low', hidden: true });
    const medium = screen.getByRole('button', { name: 'medium', hidden: true });
    expect(low.getAttribute('aria-pressed')).toBe('false');
    expect(medium.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('EffortSegmented — active styling', () => {
  it('active button has bg-primary-container class', () => {
    render(<EffortSegmented value="medium" />);
    const medBtn = screen.getByRole('button', { name: 'medium', hidden: true });
    expect(medBtn.className).toContain('bg-primary-container');
  });

  it('inactive buttons do not have bg-primary-container class', () => {
    render(<EffortSegmented value="medium" />);
    const lowBtn = screen.getByRole('button', { name: 'low', hidden: true });
    expect(lowBtn.className).not.toContain('bg-primary-container');
  });
});
