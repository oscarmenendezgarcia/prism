/**
 * Unit tests for CliToolSelector — the Claude / opencode segmented control.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CliToolSelector } from '../../src/components/config/CliToolSelector';

describe('CliToolSelector', () => {
  it('renders Claude and opencode options', () => {
    render(<CliToolSelector value="claude" onChange={vi.fn()} agentLabel="Architect" />);
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'opencode' })).toBeDefined();
  });

  it('marks the active tool with aria-checked', () => {
    render(<CliToolSelector value="opencode" onChange={vi.fn()} agentLabel="Architect" />);
    expect(screen.getByRole('radio', { name: 'opencode' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Claude' }).getAttribute('aria-checked')).toBe('false');
  });

  it('calls onChange with the selected tool', () => {
    const onChange = vi.fn();
    render(<CliToolSelector value="claude" onChange={onChange} agentLabel="Architect" />);
    fireEvent.click(screen.getByRole('radio', { name: 'opencode' }));
    expect(onChange).toHaveBeenCalledWith('opencode');
  });

  it('labels the radiogroup with the agent name', () => {
    render(<CliToolSelector value="claude" onChange={vi.fn()} agentLabel="Architect" />);
    expect(screen.getByRole('radiogroup', { name: /CLI tool for Architect/i })).toBeDefined();
  });
});
