import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskRunPanel } from '../TaskRunPanel';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { Task, TaskRunView } from '@/types';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  getRunLog: vi.fn().mockResolvedValue('first output'),
  getRunFiles: vi.fn().mockResolvedValue({ files: [] }),
  stopRun: vi.fn().mockResolvedValue({}),
  getTaskRuns: vi.fn().mockResolvedValue({}),
}));

const task = { id: 't1', title: 'A task', type: 'feature', createdAt: '', updatedAt: '' } as Task;

const view = (over: Partial<TaskRunView>): TaskRunView => ({
  runId: 'r1', taskId: 't1', status: 'working', cliTool: 'claude', model: 'sonnet', iteration: 1,
  createdAt: '', updatedAt: '', closedAt: null, result: null, hook: null, failure: null, ...over,
});

function renderPanel(over: Partial<TaskRunView>, column: 'in-progress' | 'done' = 'in-progress') {
  useTaskRunStore.setState({ views: { t1: view(over) }, busyTaskIds: new Set(), choice: { cliTool: 'claude' }, harnesses: null });
  return render(<TaskRunPanel task={task} column={column} spaceId="s1" />);
}

function openLog() {
  const details = screen.getByTestId('run-log') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('TaskRunPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getRunLog).mockResolvedValue('first output');
    useAppStore.setState({ activeSpaceId: 's1', loadBoard: vi.fn().mockResolvedValue(undefined), showToast: vi.fn() } as never);
  });

  it('does not load the log until it is opened', () => {
    renderPanel({});
    expect(api.getRunLog).not.toHaveBeenCalled();
  });

  it('shows the log of the run when it is opened', async () => {
    renderPanel({ status: 'done' }, 'done');
    openLog();
    expect(await screen.findByText('first output')).toBeInTheDocument();
    expect(api.getRunLog).toHaveBeenCalledWith('r1');
  });

  it('refreshes the log while the run works', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPanel({ status: 'working' });
      openLog();
      await screen.findByText('first output');
      vi.mocked(api.getRunLog).mockResolvedValue('more output');
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      await waitFor(() => expect(screen.getByText('more output')).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refresh the log of a run that ended', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPanel({ status: 'done' }, 'done');
      openLog();
      await screen.findByText('first output');
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(api.getRunLog).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the output of a failed check and of a failed pull request', () => {
    const { unmount } = renderPanel({
      status: 'failed', hook: { type: 'command', name: 'Check', status: 'failed', outputTail: 'tests failed' },
      failure: { kind: 'check', exitCode: 1, timedOut: false },
    });
    expect(screen.getByTestId('hook-output')).toHaveTextContent('tests failed');
    unmount();
    renderPanel({
      status: 'failed', hook: { type: 'pr', name: 'Pull request', status: 'failed', outputTail: 'no remote' },
      failure: { kind: 'pr', exitCode: null, timedOut: false },
    });
    expect(screen.getByTestId('hook-output')).toHaveTextContent('no remote');
  });

  it('does not show old check output when the agent itself failed', () => {
    renderPanel({
      status: 'failed', hook: { type: 'command', name: 'Check', status: 'failed', outputTail: 'old' },
      failure: { kind: 'agent', exitCode: 1, reason: null },
    });
    expect(screen.queryByTestId('hook-output')).toBeNull();
  });

  it('can stop an agent waiting for an answer', async () => {
    renderPanel({ status: 'question' });
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(api.stopRun).toHaveBeenCalledWith('r1'));
  });
});
