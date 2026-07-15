/**
 * useAppStore.reorderTasks — batched rank rebalance.
 *
 * BUG fix: Board.tsx previously called reorderTask() N times in a loop; if any
 * mid-batch PATCH failed, the column ended up in a mixed old/new rank state.
 * The new store action sends one atomic request; on failure it must roll back
 * the ENTIRE column snapshot, not just the tasks whose write succeeded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task } from '@/types';

vi.mock('@/api/client', () => ({
  reorderTasks: vi.fn(),
  reorderTask:  vi.fn(),
  getTasks:     vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces:    vi.fn().mockResolvedValue([]),
  listRuns:     vi.fn().mockResolvedValue([]),
  getAgents:    vi.fn().mockResolvedValue([]),
  getConfigFiles: vi.fn().mockResolvedValue([]),
  getSystemInfo: vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  moveTask:     vi.fn().mockResolvedValue({}),
  createTask:   vi.fn().mockResolvedValue({}),
  deleteTask:   vi.fn().mockResolvedValue(undefined),
}));

import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';

function mkTask(id: string, rank: number, createdAt = '2026-01-01T00:00:00.000Z'): Task {
  return {
    id,
    title: id,
    type: 'chore',
    rank,
    createdAt,
    updatedAt: createdAt,
  } as unknown as Task;
}

describe('useAppStore.reorderTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeSpaceId: 'space-1',
      tasks: {
        todo: [mkTask('a', 1000, '2026-01-01T00:00:00.000Z'),
               mkTask('b', 2000, '2026-01-01T00:01:00.000Z'),
               mkTask('c', 3000, '2026-01-01T00:02:00.000Z')],
        'in-progress': [],
        done: [],
      },
    });
  });

  it('applies all rank updates optimistically and calls api.reorderTasks once', async () => {
    (api.reorderTasks as any).mockResolvedValueOnce({ tasks: [] });

    const updates = [
      { id: 'a', rank: 3000 },
      { id: 'b', rank: 1000 },
      { id: 'c', rank: 2000 },
    ];
    await useAppStore.getState().reorderTasks('todo', updates);

    expect(api.reorderTasks).toHaveBeenCalledTimes(1);
    expect(api.reorderTasks).toHaveBeenCalledWith('space-1', updates);

    const order = useAppStore.getState().tasks.todo.map((t) => t.id);
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('rolls back the ENTIRE column snapshot when the batch request fails', async () => {
    (api.reorderTasks as any).mockRejectedValueOnce(new Error('network blip'));

    const before = useAppStore.getState().tasks.todo.map((t) => ({ id: t.id, rank: t.rank }));

    await useAppStore.getState().reorderTasks('todo', [
      { id: 'a', rank: 9000 },
      { id: 'b', rank: 9500 },
      { id: 'c', rank: 9999 },
    ]);

    const after = useAppStore.getState().tasks.todo.map((t) => ({ id: t.id, rank: t.rank }));
    // No mixed state — every rank restored to the pre-batch snapshot.
    expect(after).toEqual(before);
  });

  it('is a no-op when updates is empty (no request fired)', async () => {
    await useAppStore.getState().reorderTasks('todo', []);
    expect(api.reorderTasks).not.toHaveBeenCalled();
  });
});
