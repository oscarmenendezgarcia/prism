/**
 * Tests for useRunHistoryPolling hook.
 * ADR-1 (Agent Run History) §2.3: adaptive 1s/3s cadence, isMutating skip guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppStore } from '../../src/stores/useAppStore';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';

vi.mock('../../src/api/client', () => ({
  getAgentRuns:         vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  createAgentRun:       vi.fn().mockResolvedValue({}),
  updateAgentRun:       vi.fn().mockResolvedValue({}),
  getSpaces:            vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  getAttachmentContent: vi.fn(),
}));

import { useRunHistoryPolling } from '../../src/hooks/useRunHistoryPolling';
import * as clientModule from '../../src/api/client';

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ activeRun: null, isMutating: false });
  useRunHistoryStore.setState({ runs: [], filter: 'all', loading: false, historyPanelOpen: true });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRunHistoryPolling — idle cadence (3 s)', () => {
  it('polls loadRuns after 3000ms when no active run', async () => {
    renderHook(() => useRunHistoryPolling());

    vi.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(clientModule.getAgentRuns).toHaveBeenCalledTimes(1);
  });

  it('does not poll before 3000ms when idle', async () => {
    renderHook(() => useRunHistoryPolling());

    vi.advanceTimersByTime(2999);
    await Promise.resolve();

    expect(clientModule.getAgentRuns).not.toHaveBeenCalled();
  });
});

describe('useRunHistoryPolling — active cadence (1 s)', () => {
  it('polls every 1000ms when activeRun is non-null', async () => {
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'default',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    renderHook(() => useRunHistoryPolling());

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(clientModule.getAgentRuns).toHaveBeenCalledTimes(1);
  });

  it('polls twice after 2000ms when active', async () => {
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'default',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    renderHook(() => useRunHistoryPolling());

    vi.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(clientModule.getAgentRuns).toHaveBeenCalledTimes(2);
  });
});

describe('useRunHistoryPolling — isMutating skip guard', () => {
  it('skips the poll when isMutating is true', async () => {
    useAppStore.setState({ isMutating: true });
    renderHook(() => useRunHistoryPolling());

    vi.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(clientModule.getAgentRuns).not.toHaveBeenCalled();
  });

  it('resumes polling when isMutating goes back to false', async () => {
    useAppStore.setState({ isMutating: true });
    renderHook(() => useRunHistoryPolling());

    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(clientModule.getAgentRuns).not.toHaveBeenCalled();

    useAppStore.setState({ isMutating: false });
    vi.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(clientModule.getAgentRuns).toHaveBeenCalledTimes(1);
  });
});
