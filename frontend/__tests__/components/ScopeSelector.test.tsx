/**
 * QA unit tests for ScopeSelector.
 *
 * Covers:
 *   - Role and label structure (radiogroup)
 *   - Global option always enabled and selectable
 *   - Space option disabled when no spaceName provided
 *   - Space option enabled and shows space name when spaceName provided
 *   - Callback fired on valid option click
 *   - Callback NOT fired when clicking a disabled option
 *   - Visual aria-checked state matches active scope
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopeSelector } from '../../src/components/config/ScopeSelector';

function renderScope(overrides: Partial<{
  scope: 'global' | 'space';
  spaceName: string | undefined;
  onChange: (s: 'global' | 'space') => void;
}> = {}) {
  const defaults = {
    scope: 'global' as const,
    spaceName: undefined as string | undefined,
    onChange: vi.fn(),
  };
  return render(<ScopeSelector {...defaults} {...overrides} />);
}

describe('ScopeSelector — structure', () => {
  it('renders a radiogroup with accessible label', () => {
    renderScope();
    expect(screen.getByRole('radiogroup', { name: /model routing scope/i })).toBeDefined();
  });

  it('renders Global and Space radio buttons', () => {
    renderScope();
    expect(screen.getByRole('radio', { name: /global/i })).toBeDefined();
    expect(screen.getByRole('radio', { name: /space/i })).toBeDefined();
  });
});

describe('ScopeSelector — global scope active', () => {
  it('Global has aria-checked=true when scope=global', () => {
    renderScope({ scope: 'global' });
    expect(screen.getByRole('radio', { name: /global/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('Space has aria-checked=false when scope=global', () => {
    renderScope({ scope: 'global', spaceName: 'Prism' });
    expect(screen.getByRole('radio', { name: /space · prism/i }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('ScopeSelector — space scope active', () => {
  it('Space has aria-checked=true when scope=space and spaceName is provided', () => {
    renderScope({ scope: 'space', spaceName: 'Prism' });
    expect(screen.getByRole('radio', { name: /space · prism/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('Global has aria-checked=false when scope=space', () => {
    renderScope({ scope: 'space', spaceName: 'Prism' });
    expect(screen.getByRole('radio', { name: /global/i }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('ScopeSelector — Space disabled when no space', () => {
  it('Space button is disabled when spaceName is undefined', () => {
    renderScope({ spaceName: undefined });
    const spaceBtn = screen.getByRole('radio', { name: /space/i });
    expect(spaceBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Space button has aria-disabled=true when no spaceName', () => {
    renderScope({ spaceName: undefined });
    expect(screen.getByRole('radio', { name: /space/i }).getAttribute('aria-disabled')).toBe('true');
  });

  it('onChange is NOT called when disabled Space button is clicked', () => {
    const onChange = vi.fn();
    renderScope({ spaceName: undefined, onChange });
    // disabled button ignores click natively
    fireEvent.click(screen.getByRole('radio', { name: /space/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ScopeSelector — Space enabled when space is present', () => {
  it('Space button is NOT disabled when spaceName is provided', () => {
    renderScope({ spaceName: 'My Space' });
    const spaceBtn = screen.getByRole('radio', { name: /space · my space/i });
    expect(spaceBtn.hasAttribute('disabled')).toBe(false);
  });

  it('label includes space name: "Space · <name>"', () => {
    renderScope({ spaceName: 'Prism' });
    expect(screen.getByText('Space · Prism')).toBeDefined();
  });
});

describe('ScopeSelector — callbacks', () => {
  it('calls onChange("global") when Global is clicked', () => {
    const onChange = vi.fn();
    renderScope({ scope: 'space', spaceName: 'Prism', onChange });
    fireEvent.click(screen.getByRole('radio', { name: /global/i }));
    expect(onChange).toHaveBeenCalledWith('global');
  });

  it('calls onChange("space") when Space is clicked and enabled', () => {
    const onChange = vi.fn();
    renderScope({ scope: 'global', spaceName: 'Prism', onChange });
    fireEvent.click(screen.getByRole('radio', { name: /space · prism/i }));
    expect(onChange).toHaveBeenCalledWith('space');
  });

  it('clicking Global when already global does NOT suppress the call', () => {
    // ScopeSelector does not guard same-scope clicks (that's AgentRoutingView's job)
    const onChange = vi.fn();
    renderScope({ scope: 'global', spaceName: 'Prism', onChange });
    fireEvent.click(screen.getByRole('radio', { name: /global/i }));
    expect(onChange).toHaveBeenCalledWith('global');
  });
});
