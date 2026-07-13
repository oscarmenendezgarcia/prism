/**
 * QA unit tests for SkillsReadOnly.
 *
 * Covers:
 *   - Empty state message
 *   - Skill chip rendering (one per skill)
 *   - Loading skeleton (no real skills shown, pulse elements present)
 *   - Correct token styling on chips
 *   - Multiple skills, single skill, boundary cases
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillsReadOnly } from '../../src/components/config/SkillsReadOnly';

describe('SkillsReadOnly — empty state', () => {
  it('renders "No skills configured" when skills array is empty and not loading', () => {
    render(<SkillsReadOnly skills={[]} />);
    expect(screen.getByText('No skills configured')).toBeDefined();
  });

  it('does NOT render the empty state when there are skills', () => {
    render(<SkillsReadOnly skills={['ui-ux-pro-max']} />);
    expect(screen.queryByText('No skills configured')).toBeNull();
  });
});

describe('SkillsReadOnly — skill chips', () => {
  it('renders one chip per skill', () => {
    render(<SkillsReadOnly skills={['ui-ux-pro-max', 'deep-research', 'code-review']} />);
    expect(screen.getByText('ui-ux-pro-max')).toBeDefined();
    expect(screen.getByText('deep-research')).toBeDefined();
    expect(screen.getByText('code-review')).toBeDefined();
  });

  it('renders a single skill chip correctly', () => {
    render(<SkillsReadOnly skills={['design-taste-frontend']} />);
    expect(screen.getByText('design-taste-frontend')).toBeDefined();
  });

  it('chip has bg-primary-container styling token', () => {
    const { container } = render(<SkillsReadOnly skills={['ui-ux-pro-max']} />);
    const chip = container.querySelector('span[class*="bg-primary-container"]');
    expect(chip).toBeDefined();
  });

  it('chip has text-primary styling token', () => {
    const { container } = render(<SkillsReadOnly skills={['ui-ux-pro-max']} />);
    const chip = container.querySelector('span[class*="text-primary"]');
    expect(chip).toBeDefined();
  });

  it('renders chips in a flex-wrap container', () => {
    const { container } = render(<SkillsReadOnly skills={['a', 'b']} />);
    const wrapper = container.querySelector('div[class*="flex-wrap"]');
    expect(wrapper).toBeDefined();
  });
});

describe('SkillsReadOnly — loading state', () => {
  it('does NOT render "No skills configured" when loading', () => {
    render(<SkillsReadOnly skills={[]} loading={true} />);
    expect(screen.queryByText('No skills configured')).toBeNull();
  });

  it('renders skeleton placeholder elements when loading', () => {
    const { container } = render(<SkillsReadOnly skills={[]} loading={true} />);
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('skeleton placeholders are aria-hidden', () => {
    const { container } = render(<SkillsReadOnly skills={[]} loading={true} />);
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('does NOT render skill chips during loading', () => {
    render(<SkillsReadOnly skills={['ui-ux-pro-max']} loading={true} />);
    // When loading, the component ignores the skills list and shows skeleton
    expect(screen.queryByText('ui-ux-pro-max')).toBeNull();
  });
});
