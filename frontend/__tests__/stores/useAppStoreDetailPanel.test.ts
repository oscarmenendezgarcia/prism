/**
 * Unit tests for useAppStore detail panel actions.
 * T-007: covers openDetailPanel, closeDetailPanel, and updateTask.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Task } from '../../src/types';

// Mock the API client before importing the store.
vi.mock('../../src/api/client', () => ({
  getSpaces:         vi.fn(),
  getTasks:          vi.fn(),
  createTask:        vi.fn(),
  moveTask:          vi.fn(),
  deleteTask:        vi.fn(),
  createSpace:       vi.fn(),
  renameSpace:       vi.fn(),
  deleteSpace:       vi.fn(),
  getAttachmentContent: vi.fn(),
  updateTask:        vi.fn(),
  getAgents:         vi.fn(),
  generatePrompt:    vi.fn(),
  getSettings:       vi.fn().mockResolvedValue({}),
  saveSettings:      vi.fn(),
  createAgentRun:    vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun:    vi.fn().mockResolvedValue({ id: 'run_mock', status: 'completed' }),
  getAgentRuns:      vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  startRun:          vi.fn(),
  getBackendRun:     vi.fn(),
  deleteRun:         vi.fn(),
}));

import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_TASK: Task = {
  id: 'task-001',
  title: 'Implement auth',
  type: 'task',
  description: 'JWT-based authentication',
  assigned: 'developer-agent',
  createdAt: '2026-03-09T14:00:00.000Z',
  updatedAt: '2026-03-24T12:00:00.000Z',
};

const UPDATED_TASK: Task = {
  ...BASE_TASK,
  title: 'Implement auth flow',
  updatedAt: '2026-03-24T13:00:00.000Z',
};

function resetStore() {
  useAppStore.setState({
    spaces:         [],
    activeSpaceId:  'space-1',
    tasks:          { todo: [BASE_TASK], 'in-progress': [], done: [] },
    isMutating:     false,
    detailTask:     null,
    toast:          null,
  } as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('openDetailPanel', () => {
  it('sets detailTask to the given task', () => {
    useAppStore.getState().openDetailPanel(BASE_TASK);
    expect(useAppStore.getState().detailTask).toEqual(BASE_TASK);
  });

  it('replaces an already-open task when called again', () => {
    const OTHER_TASK: Task = { ...BASE_TASK, id: 'task-002', title: 'Another task' };
    useAppStore.getState().openDetailPanel(BASE_TASK);
    useAppStore.getState().openDetailPanel(OTHER_TASK);
    expect(useAppStore.getState().detailTask?.id).toBe('task-002');
  });
});

describe('closeDetailPanel', () => {
  it('sets detailTask to null', () => {
    useAppStore.setState({ detailTask: BASE_TASK } as any);
    useAppStore.getState().closeDetailPanel();
    expect(useAppStore.getState().detailTask).toBeNull();
  });

  it('is a no-op when panel is already closed', () => {
    useAppStore.setState({ detailTask: null } as any);
    expect(() => useAppStore.getState().closeDetailPanel()).not.toThrow();
    expect(useAppStore.getState().detailTask).toBeNull();
  });
});

describe('updateTask — success path', () => {
  beforeEach(() => {
    vi.mocked(api.updateTask).mockResolvedValue(UPDATED_TASK);
    useAppStore.setState({ detailTask: BASE_TASK } as any);
  });

  it('calls api.updateTask with the active spaceId, taskId, and patch', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Implement auth flow' });
    expect(api.updateTask).toHaveBeenCalledWith('space-1', BASE_TASK.id, { title: 'Implement auth flow' });
  });

  it('updates the task in the correct board column after success', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Implement auth flow' });
    const todo = useAppStore.getState().tasks['todo'];
    expect(todo[0].title).toBe('Implement auth flow');
  });

  it('refreshes detailTask to the server-returned task after success', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Implement auth flow' });
    expect(useAppStore.getState().detailTask).toEqual(UPDATED_TASK);
  });

  it('shows a success toast after a successful update', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Implement auth flow' });
    expect(useAppStore.getState().toast?.type).toBe('success');
  });

  it('sets isMutating to false after success', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Implement auth flow' });
    expect(useAppStore.getState().isMutating).toBe(false);
  });

  it('applies optimistic update before API resolves', async () => {
    let optimisticTitle: string | undefined;

    vi.mocked(api.updateTask).mockImplementation(() => {
      // Capture state mid-flight (after optimistic set, before resolution).
      optimisticTitle = useAppStore.getState().tasks['todo'][0]?.title;
      return Promise.resolve(UPDATED_TASK);
    });

    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Implement auth flow' });

    // The optimistic value should have been 'Implement auth flow' during the call.
    expect(optimisticTitle).toBe('Implement auth flow');
  });

  it('updates task in in-progress column when task is there', async () => {
    const taskInProgress: Task = { ...BASE_TASK, id: 'task-ip' };
    vi.mocked(api.updateTask).mockResolvedValue({ ...taskInProgress, title: 'Updated' });
    useAppStore.setState({
      tasks: { todo: [], 'in-progress': [taskInProgress], done: [] },
      detailTask: taskInProgress,
    } as any);

    await useAppStore.getState().updateTask(taskInProgress.id, { title: 'Updated' });

    expect(useAppStore.getState().tasks['in-progress'][0].title).toBe('Updated');
  });

  it('updates task in done column when task is there', async () => {
    const taskDone: Task = { ...BASE_TASK, id: 'task-done' };
    vi.mocked(api.updateTask).mockResolvedValue({ ...taskDone, title: 'Done updated' });
    useAppStore.setState({
      tasks: { todo: [], 'in-progress': [], done: [taskDone] },
      detailTask: taskDone,
    } as any);

    await useAppStore.getState().updateTask(taskDone.id, { title: 'Done updated' });

    expect(useAppStore.getState().tasks['done'][0].title).toBe('Done updated');
  });
});

describe('updateTask — error path', () => {
  beforeEach(() => {
    vi.mocked(api.updateTask).mockRejectedValue(new Error('Save failed'));
    useAppStore.setState({ detailTask: BASE_TASK } as any);
  });

  it('rolls back the board tasks to pre-call state on error', async () => {
    const originalTasks = useAppStore.getState().tasks;
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Will fail' });
    expect(useAppStore.getState().tasks).toEqual(originalTasks);
  });

  it('rolls back detailTask to pre-call state on error', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Will fail' });
    expect(useAppStore.getState().detailTask).toEqual(BASE_TASK);
  });

  it('shows an error toast on failure', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Will fail' });
    expect(useAppStore.getState().toast?.type).toBe('error');
    expect(useAppStore.getState().toast?.message).toMatch(/failed to save/i);
  });

  it('sets isMutating to false after error', async () => {
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'Will fail' });
    expect(useAppStore.getState().isMutating).toBe(false);
  });
});

describe('updateTask — isMutating flag', () => {
  it('is true while the API call is in-flight', async () => {
    let wasMutatingDuringCall = false;

    vi.mocked(api.updateTask).mockImplementation(() => {
      wasMutatingDuringCall = useAppStore.getState().isMutating;
      return Promise.resolve(UPDATED_TASK);
    });

    useAppStore.setState({ detailTask: BASE_TASK } as any);
    await useAppStore.getState().updateTask(BASE_TASK.id, { title: 'T' });

    expect(wasMutatingDuringCall).toBe(true);
    expect(useAppStore.getState().isMutating).toBe(false);
  });
});
