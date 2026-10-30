import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskRunFooter } from '../TaskRunFooter';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { Task, TaskRunView } from '@/types';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  startTaskRun: vi.fn().mockResolvedValue({}),
  resumeRun: vi.fn().mockResolvedValue({}),
  getTaskRuns: vi.fn().mockResolvedValue({}),
}));

const task: Task = {
  id: 't1', title: 'A task', type: 'feature', createdAt: '', updatedAt: '',
} as Task;

const view = (over: Partial<TaskRunView>): TaskRunView => ({
  runId: 'r1', taskId: 't1', status: 'working', cliTool: 'claude', model: 'sonnet', iteration: 1, stageIndex: 0,
  createdAt: '', updatedAt: '', closedAt: null, result: null, hook: null, failure: null, ...over,
});

const result = { branch: 'pipeline/run-1', baseBranch: 'main', ref: null, fileCount: 2, additions: 10, deletions: 3, saveError: null };

function renderFooter(column: 'todo' | 'in-progress' | 'done', over?: Partial<TaskRunView>, t: Task = task) {
  useTaskRunStore.setState({ views: over ? { t1: view(over) } : {}, busyTaskIds: new Set(), choice: { cliTool: 'claude' }, harnesses: null });
  return render(<TaskRunFooter task={t} column={column} spaceId="s1" />);
}

describe('TaskRunFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeSpaceId: 's1', loadBoard: vi.fn().mockResolvedValue(undefined), showToast: vi.fn() } as never);
  });

  it('offers Run with the chosen agent on a card in To do', async () => {
    renderFooter('todo');
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(api.startTaskRun).toHaveBeenCalledWith('s1', 't1', { cliTool: 'claude' });
  });

  it('shows nothing on a card in progress that has never run', () => {
    const { container } = renderFooter('in-progress');
    expect(container).toBeEmptyDOMElement();
  });

  it('does not run a blocked task', () => {
    renderFooter('todo', undefined, { ...task, isBlocked: true } as Task);
    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
  });

  it('does not run a harness without a provider/model', () => {
    useTaskRunStore.setState({ views: {}, busyTaskIds: new Set(), choice: { cliTool: 'opencode' }, harnesses: null });
    render(<TaskRunFooter task={task} column="todo" spaceId="s1" />);
    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
  });

  it('shows the hook being checked', () => {
    renderFooter('in-progress', { status: 'checking', hook: { name: 'Tests', command: 'x', status: 'running' } });
    expect(screen.getByTestId('run-status')).toHaveTextContent('Checking: Tests');
  });

  it('shows the result of a finished run', () => {
    renderFooter('done', { status: 'done', result });
    expect(screen.getByTestId('run-result')).toHaveTextContent('2 files');
    expect(screen.getByTestId('run-result')).toHaveTextContent('+10');
    expect(screen.getByTestId('run-result')).toHaveTextContent('−3');
    expect(screen.getByTestId('run-result')).toHaveTextContent('pipeline/run-1');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('explains a failed hook and retries it, with the result still visible', async () => {
    renderFooter('in-progress', {
      status: 'failed',
      result,
      hook: { name: 'Tests', command: 'x', status: 'failed', exitCode: 2 },
      failure: { kind: 'hook', exitCode: 2, timedOut: false },
    });
    expect(screen.getByText(/"Tests" failed with exit code 2/)).toBeInTheDocument();
    expect(screen.getByTestId('run-result')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(api.resumeRun).toHaveBeenCalledWith('r1');
  });

  it('lets a card whose harness is missing start again on another one', async () => {
    renderFooter('in-progress', { status: 'failed', failure: { kind: 'agent', exitCode: -1, reason: 'binary_missing' } });
    expect(screen.getByText(/not installed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(api.startTaskRun).toHaveBeenCalled();
  });

  it('does not run a harness known not to be installed', () => {
    useTaskRunStore.setState({
      views: {}, busyTaskIds: new Set(), choice: { cliTool: 'claude' },
      harnesses: [{ cliTool: 'claude', available: false, path: null, modelFormat: 'preset', installUrl: '' }],
    });
    render(<TaskRunFooter task={task} column="todo" spaceId="s1" />);
    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
  });

  it('warns when work could not be saved', () => {
    renderFooter('done', { status: 'done', result: { ...result, saveError: 'Nested repository' } });
    expect(screen.getByTestId('save-error')).toBeInTheDocument();
  });

  it('shows an open question with the way to answer it', () => {
    renderFooter('in-progress', { status: 'question' }, {
      ...task,
      comments: [{ id: 'c', author: 'a', text: 'Which one?', type: 'question', resolved: false, createdAt: '' }],
    } as Task);
    expect(screen.getByText('Which one?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
  });
});
