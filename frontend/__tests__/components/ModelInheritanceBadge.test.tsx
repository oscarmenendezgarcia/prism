/**
 * QA unit tests for ModelInheritanceBadge.
 *
 * Covers:
 *   - All four source values render the correct label text
 *   - aria-label matches the source
 *   - Token class presence for each source variant
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelInheritanceBadge } from '../../src/components/config/ModelInheritanceBadge';
import type { ModelSource } from '../../src/utils/modelRouting';

const SOURCES: ModelSource[] = ['default', 'global', 'space', 'task'];

describe('ModelInheritanceBadge — label rendering', () => {
  SOURCES.forEach((source) => {
    it(`renders the label "${source}" for source=${source}`, () => {
      render(<ModelInheritanceBadge source={source} />);
      expect(screen.getByText(source)).toBeDefined();
    });
  });
});

describe('ModelInheritanceBadge — aria-label', () => {
  SOURCES.forEach((source) => {
    it(`has correct aria-label for source=${source}`, () => {
      render(<ModelInheritanceBadge source={source} />);
      const el = screen.getByLabelText(new RegExp(`model source: ${source}`, 'i'));
      expect(el).toBeDefined();
    });
  });
});

describe('ModelInheritanceBadge — visual token classes', () => {
  it('default source: uses text-text-secondary (neutral styling)', () => {
    const { container } = render(<ModelInheritanceBadge source="default" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-text-secondary');
  });

  it('global source: uses text-primary styling', () => {
    const { container } = render(<ModelInheritanceBadge source="global" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-primary');
  });

  it('space source: uses text-info styling', () => {
    const { container } = render(<ModelInheritanceBadge source="space" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-info');
  });

  it('task source: uses text-warning styling', () => {
    const { container } = render(<ModelInheritanceBadge source="task" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-warning');
  });
});

describe('ModelInheritanceBadge — structural', () => {
  it('renders as an inline-flex span element', () => {
    const { container } = render(<ModelInheritanceBadge source="global" />);
    const badge = container.querySelector('span');
    expect(badge?.tagName).toBe('SPAN');
    expect(badge?.className).toContain('inline-flex');
  });

  it('has no interactive role (is purely informational)', () => {
    const { container } = render(<ModelInheritanceBadge source="space" />);
    const badge = container.querySelector('span');
    expect(badge?.getAttribute('role')).toBeNull();
  });
});
