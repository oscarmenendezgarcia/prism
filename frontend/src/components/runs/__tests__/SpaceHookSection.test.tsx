import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readSpaceHooks, SpaceHookSection } from '../SpaceHookSection';

describe('SpaceHookSection', () => {
  it('shows the saved command and toggle', () => {
    render(<SpaceHookSection hooks={{ checkCommand: 'npm test', autoPr: true }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Check command/)).toHaveValue('npm test');
    expect(screen.getByLabelText('Open a pull request automatically')).toBeChecked();
  });

  it('changes the command and keeps the toggle', () => {
    const onChange = vi.fn();
    render(<SpaceHookSection hooks={{ checkCommand: null, autoPr: true }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Check command/), { target: { value: 'make check' } });
    expect(onChange).toHaveBeenCalledWith({ checkCommand: 'make check', autoPr: true });
  });

  it('changes the toggle and keeps the command', () => {
    const onChange = vi.fn();
    render(<SpaceHookSection hooks={{ checkCommand: 'npm test', autoPr: false }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Open a pull request automatically'));
    expect(onChange).toHaveBeenCalledWith({ checkCommand: 'npm test', autoPr: true });
  });
});

describe('readSpaceHooks', () => {
  it('reads the saved settings', () => {
    expect(readSpaceHooks({ checkCommand: 'x', autoPr: true })).toEqual({ checkCommand: 'x', autoPr: true });
  });

  it('counts an older list of hooks as empty', () => {
    expect(readSpaceHooks([{ name: 'Tests', command: 'x' }])).toEqual({ checkCommand: null, autoPr: false });
  });

  it('counts nothing, or wrong types, as empty', () => {
    expect(readSpaceHooks(undefined)).toEqual({ checkCommand: null, autoPr: false });
    expect(readSpaceHooks({ checkCommand: 3, autoPr: 'yes' })).toEqual({ checkCommand: null, autoPr: false });
  });
});
