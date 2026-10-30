import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  createTaskPullRequest: vi.fn().mockResolvedValue({}),
  getTaskRuns: vi.fn().mockResolvedValue({}),
}));

const task: Task = {
  id: 't1', title: 'A task', type: 'feature', createdAt: '', updatedAt: '',
} as Task;

const view = (over: Partial<TaskRunView>): TaskRunView => ({
  runId: 'r1', taskId: 't1', status: 'working', cliTool: 'claude', model: 'sonnet', iteration: 1,
  createdAt: '', updatedAt: '', closedAt: null, result: null, hook: null, failure: null, ...over,
});

const result = { branch: 'prism/run-1', baseBranch: 'main', ref: null, fileCount: 2, additions: 10, deletions: 3, saveError: null };

function renderFooter(column: 'todo' | 'in-progress' | 'done', over?: Partial<TaskRunView>, t: Task = task) {
  useTaskRunStore.setState({ views: over ? { t1: view(over) } : {}, busyTaskIds: new Set(), choice: { cliTool: 'claude' }, harnesses: null });
  return render(<TaskRunFooter task={t} column={column} spaceId="s1" />);
}

describe('TaskRunFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeSpaceId: 's1', loadBoard: vi.fn().mockResolvedValue(undefined), showToast: vi.fn() } as never);
  });

  it('offers to create a PR on a finished card', async () => {
    renderFooter('done', { status: 'done', result: { ...result, head: 'abc', pr: null } });
    await userEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    expect(api.createTaskPullRequest).toHaveBeenCalledWith('s1', 't1');
  });

  it('links the PR, and offers to push only what is new', () => {
    const pr = { url: 'https://example.test/pull/7', number: 7, pushedHead: 'abc' };
    const { unmount } = renderFooter('done', { status: 'done', result: { ...result, head: 'abc', pr } });
    expect(screen.getByRole('link', { name: /PR #7/ })).toHaveAttribute('href', pr.url);
    expect(screen.queryByRole('button', { name: 'Push changes' })).toBeNull();
    unmount();
    renderFooter('done', { status: 'done', result: { ...result, head: 'def', pr } });
    expect(screen.getByRole('button', { name: 'Push changes' })).toBeInTheDocument();
  });

  it('says when a check ran out of time', () => {
    renderFooter('in-progress', {
      status: 'failed', hook: { type: 'command', name: 'Check', status: 'failed' },
      failure: { kind: 'check', exitCode: null, timedOut: true },
    });
    expect(screen.getByText('"Check" took too long and was stopped.')).toBeInTheDocument();
  });

  it('says when the pull request could not be opened', () => {
    renderFooter('in-progress', {
      status: 'failed', hook: { type: 'pr', name: 'Pull request', status: 'failed' },
      failure: { kind: 'pr', exitCode: null, timedOut: false },
    });
    expect(screen.getByText('The pull request could not be opened.')).toBeInTheDocument();
    expect(screen.getByText('Failed: Pull request')).toBeInTheDocument();
  });

  it('offers Run with the chosen agent on a card in To do', async () => {
    renderFooter('todo');
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(api.startTaskRun).toHaveBeenCalledWith('s1', 't1', { cliTool: 'claude' });
  });

  it('offers to run a card moved to In progress by hand', () => {
    renderFooter('in-progress');
    expect(screen.getByRole('button', { name: /run/i })).toBeEnabled();
  });

  it('offers to run a Done card moved back to In progress', () => {
    renderFooter('in-progress', view({ status: 'done' }));
    expect(screen.getByRole('button', { name: /run/i })).toBeEnabled();
  });

  describe('with a finish status', () => {
    const SPACE = { id: 's1', name: 'S', workingDirectory: '/repo', finishStatusId: 'in-review', createdAt: '', updatedAt: '' };

    beforeEach(() => { useAppStore.setState({ spaces: [SPACE] }); });
    afterEach(() => { useAppStore.setState({ spaces: [] }); });

    it('offers no Run on a card awaiting review, and shows its result instead', () => {
      renderFooter('in-progress', { status: 'done', result }, { ...task, statusId: 'in-review' });
      expect(screen.queryByRole('button', { name: /run/i })).toBeNull();
      expect(screen.getByTestId('run-result')).toHaveTextContent('2 files');
    });

    it('offers Run on a finished card moved back by hand', async () => {
      renderFooter('in-progress', { status: 'done', result }, { ...task, statusId: 'in-progress' });
      expect(screen.queryByTestId('run-result')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /run/i }));
      expect(api.startTaskRun).toHaveBeenCalledWith('s1', 't1', { cliTool: 'claude' });
    });

    it('offers no Run on a card still running in the finish status', () => {
      renderFooter('in-progress', { status: 'working' }, { ...task, statusId: 'in-review' });
      expect(screen.queryByRole('button', { name: /run/i })).toBeNull();
    });
  });

  it('asks for a repository before offering to run', () => {
    const openSpaceModal = vi.fn();
    const space = { id: 's1', name: 'S', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaces: [space], openSpaceModal });
    renderFooter('todo');
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /set a repository/i }));
    expect(openSpaceModal).toHaveBeenCalledWith('rename', space);
    useAppStore.setState({ spaces: [] });
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
    renderFooter('in-progress', { status: 'checking', hook: { type: 'command', name: 'Tests', command: 'x', status: 'running' } });
    expect(screen.getByTestId('run-status')).toHaveTextContent('Checking: Tests');
  });

  it('shows the result of a finished run', () => {
    renderFooter('done', { status: 'done', result });
    expect(screen.getByTestId('run-result')).toHaveTextContent('2 files');
    expect(screen.getByTestId('run-result')).toHaveTextContent('+10');
    expect(screen.getByTestId('run-result')).toHaveTextContent('−3');
    expect(screen.getByTestId('run-result')).toHaveTextContent('prism/run-1');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('explains a failed check and retries it, with the result still visible', async () => {
    renderFooter('in-progress', {
      status: 'failed',
      result,
      hook: { type: 'command', name: 'Tests', command: 'x', status: 'failed', exitCode: 2 },
      failure: { kind: 'check', exitCode: 2, timedOut: false },
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

  it('offers no restart on a card moved to Done with a missing harness', () => {
    renderFooter('done', { status: 'failed', failure: { kind: 'agent', exitCode: -1, reason: 'binary_missing' } });
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
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
