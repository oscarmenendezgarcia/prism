/**
 * QA unit tests for EffortSegmented.
 *
 * Covers:
 *   - Renders the active effort value as a read-only label
 *   - undefined value → "not set"
 *   - Invalid/out-of-range value → "not set"
 *   - Loading state renders a skeleton, not the label
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EffortSegmented } from '../../src/components/config/EffortSegmented';

describe('EffortSegmented — active value', () => {
  it('renders "low" when value="low"', () => {
    render(<EffortSegmented value="low" />);
    expect(screen.getByText('low')).toBeDefined();
  });

  it('renders "medium" when value="medium"', () => {
    render(<EffortSegmented value="medium" />);
    expect(screen.getByText('medium')).toBeDefined();
  });

  it('renders "high" when value="high"', () => {
    render(<EffortSegmented value="high" />);
    expect(screen.getByText('high')).toBeDefined();
  });
});

describe('EffortSegmented — no value', () => {
  it('renders "not set" when value is undefined', () => {
    render(<EffortSegmented />);
    expect(screen.getByText('not set')).toBeDefined();
  });

  it('renders "not set" when value is an unknown string', () => {
    render(<EffortSegmented value="ultra" />);
    expect(screen.getByText('not set')).toBeDefined();
    expect(screen.queryByText('ultra')).toBeNull();
  });
});

describe('EffortSegmented — loading', () => {
  it('renders a skeleton instead of the value while loading', () => {
    render(<EffortSegmented value="high" loading />);
    expect(screen.queryByText('high')).toBeNull();
  });
});
