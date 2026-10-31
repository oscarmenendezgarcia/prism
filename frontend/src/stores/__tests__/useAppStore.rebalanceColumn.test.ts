/**
 * useAppStore.rebalanceColumn: a card with no room where it was dropped. Only the server sees
 * the whole column, so all it gets is where the card goes, in one request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task } from '@/types';

vi.mock('@/api/client', () => ({
  rebalanceColumn: vi.fn(),
  reorderTask: vi.fn(),
  getBoard: vi.fn().mockResolvedValue(null),
  getSpaces: vi.fn().mockResolvedValue([]),
}));

import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';

const mkTask = (id: string, rank: number): Task => (
  { id, title: id, type: 'chore', rank, createdAt: '2026-01-01', updatedAt: '2026-01-01' } as Task
);
const order = () => useAppStore.getState().tasks.todo.map((t) => t.id);

describe('useAppStore.rebalanceColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setActiveSpace('space-1');
    useAppStore.setState({
      activeSpaceId: 'space-1',
      isMutating: false,
      mutatingTaskIds: new Set<string>(),
      showToast: vi.fn(),
      tasks: { todo: [mkTask('a', 1000), mkTask('b', 1000.0002), mkTask('c', 1000.0004)], done: [] },
    });
    vi.mocked(api.getBoard).mockResolvedValue(null);
  });

  it('asks the server once, shows the card there at once, and reloads', async () => {
    let finish: (v: unknown) => void = () => {};
    vi.mocked(api.rebalanceColumn).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    const pending = useAppStore.getState().rebalanceColumn('todo', 'c', 'a', false);
    expect(order()).toEqual(['a', 'c', 'b']);
    expect(api.rebalanceColumn).toHaveBeenCalledWith('space-1', { id: 'c', overId: 'a', insertBefore: false });
    finish({});
    await pending;
    expect(api.rebalanceColumn).toHaveBeenCalledTimes(1);
    expect(api.reorderTask).not.toHaveBeenCalled();
    expect(api.getBoard).toHaveBeenCalled();
    expect(useAppStore.getState().includedIds).toContain('c');
  });

  it('puts the column back, and asks without a version, if the request fails', async () => {
    vi.mocked(api.rebalanceColumn).mockRejectedValueOnce(new Error('network blip'));
    await useAppStore.getState().rebalanceColumn('todo', 'c', 'a', false);
    expect(order()).toEqual(['a', 'b', 'c']);
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith('network blip', 'error');
    await useAppStore.getState().loadBoard();
    expect(vi.mocked(api.getBoard).mock.lastCall?.[1]?.etag).toBeNull();
  });

  it('does not touch another space if it fails after changing to it', async () => {
    let fail: (err: Error) => void = () => {};
    vi.mocked(api.rebalanceColumn).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }) as never);
    const pending = useAppStore.getState().rebalanceColumn('todo', 'c', 'a', false);
    useAppStore.getState().setActiveSpace('space-2');
    useAppStore.setState({ tasks: { todo: [mkTask('other', 1)] } });
    fail(new Error('No'));
    await pending;
    expect(order()).toEqual(['other']);
  });

  it('marks the card in flight while it is pending, and clears it whatever happens', async () => {
    vi.mocked(api.rebalanceColumn).mockRejectedValueOnce(new Error('network blip'));
    const pending = useAppStore.getState().rebalanceColumn('todo', 'a', 'b', false);
    expect(useAppStore.getState().isMutating).toBe(true);
    expect(useAppStore.getState().mutatingTaskIds.has('a')).toBe(true);
    await pending;
    expect(useAppStore.getState().isMutating).toBe(false);
    expect(useAppStore.getState().mutatingTaskIds.size).toBe(0);
  });

  it('ignores a poll that left before it', async () => {
    let answer: (v: unknown) => void = () => {};
    vi.mocked(api.getBoard).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }) as never);
    const poll = useAppStore.getState().loadBoard();
    vi.mocked(api.rebalanceColumn).mockResolvedValueOnce({} as never);
    await useAppStore.getState().rebalanceColumn('todo', 'c', 'a', false);
    answer({ data: { columns: { todo: { tasks: [mkTask('stale', 1)], total: 1 } }, epics: [] }, etag: null });
    await poll;
    expect(order()).toEqual(['a', 'c', 'b']);
  });
});
