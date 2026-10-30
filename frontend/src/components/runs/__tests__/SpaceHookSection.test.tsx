import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceHookSection } from '../SpaceHookSection';
import type { SpaceHook } from '@/types';

const tests: SpaceHook = { id: 'a', name: 'Tests', type: 'command', command: 'npm test', onFail: 'retry', approval: false, maxRetries: 2 };
const deploy: SpaceHook = { id: 'b', name: 'Deploy', type: 'command', command: './deploy.sh', onFail: 'stop', approval: true, maxRetries: 2 };

function setup(value: SpaceHook[] = []) {
  const onChange = vi.fn();
  const onEditingChange = vi.fn();
  render(<SpaceHookSection value={value} onChange={onChange} onEditingChange={onEditingChange} />);
  return { onChange, onEditingChange };
}

describe('SpaceHookSection', () => {
  it('says what happens without hooks', () => {
    setup();
    expect(screen.getByText(/goes to Done as soon as the agent finishes/)).toBeInTheDocument();
  });

  it('adds a command hook', () => {
    const { onChange, onEditingChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add hook' }));
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Tests ' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: ' npm test ' } });
    fireEvent.change(screen.getByLabelText('If it fails'), { target: { value: 'retry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hook' }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'Tests', type: 'command', command: 'npm test', onFail: 'retry' })]);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('adds an agent review, and does not keep the fields of another type', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add hook' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'left behind' } });
    fireEvent.click(screen.getByRole('button', { name: 'An agent reviews it' }));
    fireEvent.change(screen.getByLabelText('What it must check'), { target: { value: 'Bugs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hook' }));
    const [[saved]] = onChange.mock.calls[0];
    expect(saved).toMatchObject({ type: 'agent', prompt: 'Bugs', agent: { cliTool: 'claude', model: 'sonnet' } });
    expect(saved.command).toBeUndefined();
  });

  it('a PR hook cannot ask the agent to fix it', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add hook' }));
    fireEvent.change(screen.getByLabelText('If it fails'), { target: { value: 'retry' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'PR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opens a PR' }));
    expect(screen.queryByLabelText('If it fails')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hook' }));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ type: 'pr', onFail: 'stop' });
  });

  it('says what is missing and keeps the form open', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add hook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hook' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the hook a name.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks for a provider/model for other harnesses', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add hook' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'An agent reviews it' }));
    fireEvent.change(screen.getByLabelText('What it must check'), { target: { value: 'Bugs' } });
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'opencode' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hook' }));
    expect(screen.getByRole('alert')).toHaveTextContent('provider/model');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the id when editing, which is how a run finds its hook', () => {
    const { onChange } = setup([tests]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tests' }));
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm run ci' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hook' }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'a', command: 'npm run ci' })]);
  });

  it('moves and removes hooks, and shows which ask for approval', () => {
    const { onChange } = setup([tests, deploy]);
    expect(screen.getByText('Asks for approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Tests up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Deploy up' }));
    expect(onChange).toHaveBeenLastCalledWith([deploy, tests]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tests' }));
    expect(onChange).toHaveBeenLastCalledWith([deploy]);
  });
});
