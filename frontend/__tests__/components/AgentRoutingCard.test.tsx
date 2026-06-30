/**
 * Unit tests for AgentRoutingCard.
 *
 * Tests:
 *   - collapsed renders dot, name, role, model pill, skill count
 *   - expand/collapse via toggle
 *   - model preset selection calls onChange
 *   - custom input calls onChange
 *   - clear button visibility (hasOverride guard)
 *   - effort segmented is disabled (aria-disabled)
 *   - skills are rendered in expanded view
 *   - keyboard accessibility (aria-expanded, aria-controls)
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentRoutingCard } from '../../src/components/config/AgentRoutingCard';
import type { AgentMetadataEntry } from '../../src/hooks/useAgentMetadata';

const DEFAULT_META: AgentMetadataEntry = {
  model:   'claude-sonnet-4-5',
  effort:  'medium',
  skills:  ['ui-ux-pro-max', 'deep-research'],
  loading: false,
};

const LOADING_META: AgentMetadataEntry = {
  skills:  [],
  loading: true,
};

function renderCard(overrides: Partial<Parameters<typeof AgentRoutingCard>[0]> = {}) {
  const defaults = {
    agentId:        'ux-api-designer',
    displayName:    'UX / API Designer',
    roleSubtitle:   'UX + API spec',
    effectiveModel: 'claude-sonnet-4-5',
    source:         'default' as const,
    localModel:     '',
    metadata:       DEFAULT_META,
    open:           false,
    onToggle:       vi.fn(),
    onChange:       vi.fn(),
    onClear:        vi.fn(),
    hasOverride:    false,
  };
  return render(<AgentRoutingCard {...defaults} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Collapsed state
// ---------------------------------------------------------------------------

describe('AgentRoutingCard — collapsed state', () => {
  it('renders the agent display name', () => {
    renderCard();
    expect(screen.getByText('UX / API Designer')).toBeDefined();
  });

  it('renders the role subtitle', () => {
    renderCard();
    expect(screen.getByText('UX + API spec')).toBeDefined();
  });

  it('renders the mini model pill', () => {
    renderCard({ effectiveModel: 'claude-sonnet-4-5' });
    // The mini-pill is rendered as a span with the model name
    const pills = screen.getAllByText('claude-sonnet-4-5');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('renders skill count', () => {
    renderCard({ metadata: { ...DEFAULT_META, skills: ['a', 'b', 'c'] } });
    expect(screen.getByText('3')).toBeDefined();
  });

  it('renders "…" skill count when loading', () => {
    renderCard({ metadata: LOADING_META });
    expect(screen.getByText('…')).toBeDefined();
  });

  it('does NOT show the expanded detail section when closed', () => {
    renderCard({ open: false });
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('header button has aria-expanded=false when collapsed', () => {
    renderCard({ open: false });
    const card = document.querySelector('[data-testid="agent-card-ux-api-designer"]')!;
    const toggleBtn = card.querySelector('button[aria-expanded]') as HTMLElement;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders ModelInheritanceBadge in collapsed row when source is overridden', () => {
    renderCard({ open: false, source: 'space' });
    // Badge text should appear in the collapsed header button
    expect(screen.getByText('space')).toBeDefined();
  });

  it('renders ModelInheritanceBadge with "default" source in collapsed row', () => {
    renderCard({ open: false, source: 'default' });
    expect(screen.getByText('default')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Toggle (onToggle callback)
// ---------------------------------------------------------------------------

describe('AgentRoutingCard — expand/collapse toggle', () => {
  it('calls onToggle when header button is clicked', () => {
    const onToggle = vi.fn();
    renderCard({ onToggle });
    const card = document.querySelector('[data-testid="agent-card-ux-api-designer"]')!;
    const toggleBtn = card.querySelector('button[aria-expanded]') as HTMLElement;
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('header button has aria-expanded=true when open', () => {
    renderCard({ open: true });
    // The card article contains multiple buttons when open — query the one with aria-expanded
    const card = document.querySelector('[data-testid="agent-card-ux-api-designer"]')!;
    const toggleBtn = card.querySelector('button[aria-expanded]') as HTMLElement;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Expanded state
// ---------------------------------------------------------------------------

describe('AgentRoutingCard — expanded state', () => {
  it('renders the ModelInheritanceBadge', () => {
    renderCard({ open: true, source: 'global' });
    expect(screen.getByText('global')).toBeDefined();
  });

  it('renders preset chips', () => {
    renderCard({ open: true });
    expect(screen.getByRole('radiogroup')).toBeDefined();
    expect(screen.getByText('opus-4-5')).toBeDefined();
    expect(screen.getByText('sonnet-4-5')).toBeDefined();
    expect(screen.getByText('haiku-4-5')).toBeDefined();
  });

  it('calls onChange when a preset chip is clicked', () => {
    const onChange = vi.fn();
    renderCard({ open: true, onChange });
    fireEvent.click(screen.getByText('opus-4-5'));
    expect(onChange).toHaveBeenCalledWith('ux-api-designer', 'claude-opus-4-5');
  });

  it('calls onChange when custom input changes', () => {
    const onChange = vi.fn();
    renderCard({ open: true, onChange, localModel: '' });
    const input = screen.getByRole('textbox', { name: /custom model/i });
    fireEvent.change(input, { target: { value: 'my-custom-model' } });
    expect(onChange).toHaveBeenCalledWith('ux-api-designer', 'my-custom-model');
  });

  it('shows Clear button when hasOverride=true', () => {
    renderCard({ open: true, hasOverride: true });
    expect(screen.getByRole('button', { name: /clear model override/i })).toBeDefined();
  });

  it('does NOT show Clear button when hasOverride=false', () => {
    renderCard({ open: true, hasOverride: false });
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('calls onClear when Clear button is clicked', () => {
    const onClear = vi.fn();
    renderCard({ open: true, hasOverride: true, onClear });
    fireEvent.click(screen.getByRole('button', { name: /clear model override/i }));
    expect(onClear).toHaveBeenCalledWith('ux-api-designer');
  });

  it('renders EffortSegmented as disabled', () => {
    renderCard({ open: true, metadata: { ...DEFAULT_META, effort: 'medium' } });
    const buttons = screen.getAllByRole('button');
    // The effort buttons are inside the expanded detail area and are disabled
    const effortButtons = buttons.filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''));
    expect(effortButtons.length).toBe(3);
    effortButtons.forEach((b) => {
      expect(b.hasAttribute('disabled')).toBe(true);
    });
  });

  it('renders skill chips in expanded view', () => {
    renderCard({ open: true, metadata: { ...DEFAULT_META, skills: ['ui-ux-pro-max'] } });
    expect(screen.getByText('ui-ux-pro-max')).toBeDefined();
  });

  it('renders "No skills configured" when skills is empty', () => {
    renderCard({ open: true, metadata: { ...DEFAULT_META, skills: [] } });
    expect(screen.getByText('No skills configured')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// aria-controls connection
// ---------------------------------------------------------------------------

describe('AgentRoutingCard — accessibility', () => {
  it('button aria-controls points to the detail panel id', () => {
    renderCard({ open: true });
    const btn = screen.getByRole('button', { name: /ux \/ api designer/i, hidden: true });
    const controlId = btn.getAttribute('aria-controls');
    expect(controlId).toBeTruthy();
    expect(document.getElementById(controlId!)).toBeDefined();
  });
});
