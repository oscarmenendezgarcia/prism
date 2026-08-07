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
    expect(screen.getByRole('radio', { name: 'claude' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'opencode' })).toBeDefined();
  });

  it('marks the active tool with aria-checked', () => {
    render(<CliToolSelector value="opencode" onChange={vi.fn()} agentLabel="Architect" />);
    expect(screen.getByRole('radio', { name: 'opencode' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'claude' }).getAttribute('aria-checked')).toBe('false');
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

describe('CliToolSelector — unavailable harnesses', () => {
  const harnesses = {
    claude:   { cliTool: 'claude',   available: true,  path: '/bin/claude',   modelFormat: 'preset',         installUrl: 'https://claude.example' },
    opencode: { cliTool: 'opencode', available: false, path: null,            modelFormat: 'provider/model', installUrl: 'https://opencode.example' },
    pi:       { cliTool: 'pi',       available: true,  path: '/bin/pi',       modelFormat: 'provider/model', installUrl: 'https://pi.example' },
    hermes:   { cliTool: 'hermes',   available: false, path: null,            modelFormat: 'provider/model', installUrl: 'https://hermes.example' },
  } as const;

  it('renders an unavailable harness as an install link and an available one as a radio', () => {
    render(<CliToolSelector value="claude" onChange={vi.fn()} agentLabel="Architect" harnesses={harnesses} />);
    // Uninstalled harnesses are external-link affordances, not dead radios.
    expect(screen.getByRole('link', { name: 'opencode' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'hermes' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'pi' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('does not select an unavailable harness on click', () => {
    const onChange = vi.fn();
    render(<CliToolSelector value="claude" onChange={onChange} agentLabel="Architect" harnesses={harnesses} />);
    fireEvent.click(screen.getByRole('link', { name: 'opencode' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens the install link when an unavailable harness is clicked', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<CliToolSelector value="claude" onChange={vi.fn()} agentLabel="Architect" harnesses={harnesses} />);
    fireEvent.click(screen.getByRole('link', { name: 'opencode' }));
    expect(open).toHaveBeenCalledWith('https://opencode.example', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
