/**
 * ADR-1 keyboard-card-reorder — end-to-end tests for the Board handler
 * (T-002, T-005), the TaskCard Alt+Arrow keydown wiring (T-003), and the
 * shared aria-live announcer.
 *
 * Covers:
 *   - Alt+ArrowUp/Down on a focused card calls reorderTask with the correct
 *     rank; plain arrows / Tab / Enter are NOT swallowed.
 *   - Announcer text after a successful move.
 *   - Column-boundary spoken no-ops.
 *   - The epic filter narrows the visible-neighbor list.
 *   - isMutating suppresses the reorder.
 *   - Focus retention after reorder.
 *   - Neighbor resolver (resolveKeyboardNeighbor) unit cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Board, resolveKeyboardNeighbor } from '../../src/components/board/Board';
import { useAppStore } from '../../src/stores/useAppStore';
import { useDragStore } from '../../src/stores/useDragStore';
import { useAnnouncer } from '../../src/stores/useAnnouncer';
import type { Task } from '../../src/types';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  reorderTask: vi.fn().mockResolvedValue(undefined),
  getAttachmentContent: vi.fn(),
  getAgents: vi.fn(), getAgent: vi.fn(), generatePrompt: vi.fn(),
  getSettings: vi.fn(), saveSettings: vi.fn(),
  createAgentRun: vi.fn(), updateAgentRun: vi.fn(),
  getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  listRuns: vi.fn(), getRun: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkTask(id: string, rank: number, parentId?: string, type: Task['type'] = 'feature'): Task {
  return {
    id,
    title: `Task ${id}`,
    type,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rank,
    parentId,
  };
}

const TASKS_TODO = [mkTask('a', 1000), mkTask('b', 2000), mkTask('c', 3000)];

function setBoard(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    tasks: { todo: TASKS_TODO, 'in-progress': [], done: [] },
    activeSpaceId: 'space-1',
    spaces: [{
      id: 'space-1', name: 'Test', createdAt: '', updatedAt: '',
      statuses: [
        { id: 'todo', name: 'Todo', category: 'todo' },
        { id: 'in-progress', name: 'In Progress', category: 'in-progress' },
        { id: 'done', name: 'Done', category: 'done' },
      ],
    }],
    isMutating: false,
    filters: {},
    reorderTask: vi.fn(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  setBoard();
  useDragStore.getState().resetDrag();
  useAnnouncer.setState({ message: '', nonce: 0 });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// resolveKeyboardNeighbor — pure-function unit cases (T-002 + T-005)
// ---------------------------------------------------------------------------

describe('resolveKeyboardNeighbor', () => {
  const col: Task[] = [mkTask('a', 1000), mkTask('b', 2000), mkTask('c', 3000)];

  it('returns the previous card for up', () => {
    const r = resolveKeyboardNeighbor(col, 'b', 'up');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('a');
  });

  it('returns the next card for down', () => {
    const r = resolveKeyboardNeighbor(col, 'b', 'down');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('c');
  });

  it('reports the position of the card and how many are visible', () => {
    expect(resolveKeyboardNeighbor(col, 'b', 'down')).toEqual({ ok: true, neighborId: 'c', visibleIndex: 1, visibleCount: 3 });
  });

  it('has no neighbor when pressing up on the first card', () => {
    expect(resolveKeyboardNeighbor(col, 'a', 'up')).toEqual({ ok: false, visibleIndex: 0, visibleCount: 3 });
  });

  it('has no neighbor when pressing down on the last card', () => {
    expect(resolveKeyboardNeighbor(col, 'c', 'down')).toEqual({ ok: false, visibleIndex: 2, visibleCount: 3 });
  });

  it('has no neighbor for a card that is not visible', () => {
    expect(resolveKeyboardNeighbor(col, 'zzz', 'down')).toEqual({ ok: false, visibleIndex: -1, visibleCount: 3 });
  });

  it('only looks at the cards it is given, which is how a filter narrows neighbors', () => {
    const filtered = [mkTask('a', 1000), mkTask('c', 3000)];
    const r = resolveKeyboardNeighbor(filtered, 'a', 'down');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// End-to-end Board handler behaviour via keyboard on TaskCard
// ---------------------------------------------------------------------------

describe('Board — keyboard reorder', () => {
  function findCard(id: string): HTMLElement {
    const el = document.querySelector(`[data-testid="task-card"][data-id="${id}"]`);
    if (!el) throw new Error(`card ${id} not found`);
    return el as HTMLElement;
  }

  it('Alt+ArrowDown on card A calls reorderTask with a rank between A and B (moves A after B)', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });
    expect(reorderTask).toHaveBeenCalledOnce();
    const [id, column, rank] = reorderTask.mock.calls[0];
    expect(id).toBe('a');
    expect(column).toBe('todo');
    // insertBefore=false, overId=b → rank between b (2000) and c (3000) = 2500
    expect(rank).toBe(2500);
  });

  it('Alt+ArrowUp on card B calls reorderTask with a rank placing B before A', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('b'), { key: 'ArrowUp', altKey: true });
    expect(reorderTask).toHaveBeenCalledOnce();
    const [id, column, rank] = reorderTask.mock.calls[0];
    expect(id).toBe('b');
    expect(column).toBe('todo');
    // insertBefore=true, overId=a → rank between 0 and 1000 = 500
    expect(rank).toBe(500);
  });

  it('announces the new position on success', () => {
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });
    expect(useAnnouncer.getState().message).toBe(
      'Task "Task a" moved to position 2 of 3 in Todo.'
    );
  });

  it('boundary press (Alt+ArrowUp on top card) does not call reorderTask and announces', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowUp', altKey: true });
    expect(reorderTask).not.toHaveBeenCalled();
    expect(useAnnouncer.getState().message).toBe(
      'Task "Task a" is already at the top of Todo.'
    );
  });

  it('boundary press (Alt+ArrowDown on last card) announces "bottom"', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('c'), { key: 'ArrowDown', altKey: true });
    expect(reorderTask).not.toHaveBeenCalled();
    expect(useAnnouncer.getState().message).toBe(
      'Task "Task c" is already at the bottom of Todo.'
    );
  });

  it('the epic filter narrows the neighbor: a card outside it, not loaded, is jumped over', () => {
    const reorderTask = vi.fn();
    setBoard({
      // Between ranks 1000 and 3000 there is a card of another epic, which the server did not send.
      tasks: {
        todo: [mkTask('a', 1000, 'e1'), mkTask('c', 3000, 'e1')],
        'in-progress': [], done: [mkTask('e1', 1000, undefined, 'epic')],
      },
      filters: { epic: ['e1'] },
      reorderTask,
    });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });
    expect(reorderTask).toHaveBeenCalledWith('a', 'todo', 4000);
    expect(useAnnouncer.getState().message).toBe('Task "Task a" moved to position 2 of 2 in Todo.');
  });

  it('the last card the epic filter shows is at the bottom', () => {
    const reorderTask = vi.fn();
    setBoard({
      tasks: {
        todo: [mkTask('a', 1000, 'e1')],
        'in-progress': [], done: [mkTask('e1', 1000, undefined, 'epic')],
      },
      filters: { epic: ['e1'] },
      reorderTask,
    });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });
    expect(reorderTask).not.toHaveBeenCalled();
    expect(useAnnouncer.getState().message).toBe('Task "Task a" is already at the bottom of Todo.');
  });

  it('isMutating suppresses reorder AND announcement (silent no-op)', () => {
    const reorderTask = vi.fn();
    setBoard({ isMutating: true, reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });
    expect(reorderTask).not.toHaveBeenCalled();
    expect(useAnnouncer.getState().message).toBe('');
  });

  it('plain ArrowDown (no Alt) does NOT call reorderTask (must not swallow)', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: false });
    expect(reorderTask).not.toHaveBeenCalled();
    expect(useAnnouncer.getState().message).toBe('');
  });

  it('Tab does not trigger reorder', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'Tab', altKey: false });
    expect(reorderTask).not.toHaveBeenCalled();
  });

  it('Enter does not trigger reorder', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    fireEvent.keyDown(findCard('a'), { key: 'Enter', altKey: false });
    expect(reorderTask).not.toHaveBeenCalled();
  });

  it('a move with no room for it is left to the server, which sees the whole column, and never writes ranks from the cards loaded', () => {
    // Ranks packed tight enough (gap < 0.001) that inserting 'a' between 'b' and 'c' has no
    // room. Rewriting ranks from what is loaded would scramble a column partly loaded or
    // filtered, among the cards it cannot see.
    const reorderTask = vi.fn();
    const rebalanceColumn = vi.fn();
    setBoard({
      tasks: {
        todo: [
          mkTask('a', 1000),
          mkTask('b', 1000.0004),
          mkTask('c', 1000.0008),
        ],
        'in-progress': [], done: [],
      },
      reorderTask,
      rebalanceColumn,
    } as never);
    render(<Board />);

    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });

    expect(rebalanceColumn).toHaveBeenCalledOnce();
    expect(rebalanceColumn).toHaveBeenCalledWith('todo', 'a', 'b', false);
    expect(reorderTask).not.toHaveBeenCalled();
  });

  it('cards are tabIndex=0 (focusable)', () => {
    render(<Board />);
    expect(findCard('a').tabIndex).toBe(0);
  });

  it('cards expose aria-keyshortcuts', () => {
    render(<Board />);
    expect(findCard('a').getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
  });

  it('focus is retained on the moved card after reorder (same node, keyed by id)', () => {
    // The Board keeps DOM nodes stable via `key={task.id}`, so React moves the
    // node rather than remounting it. Focusing the card and firing a reorder
    // must keep document.activeElement pointing at the same element.
    render(<Board />);
    const card = findCard('a');
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: 'ArrowDown', altKey: true });
    expect(document.activeElement).toBe(card);
  });

  it('renders the shared aria-live Announcer (mounted once on Board)', () => {
    render(<Board />);
    const announcers = document.querySelectorAll('[data-testid="announcer"]');
    expect(announcers.length).toBe(1);
    const el = announcers[0] as HTMLElement;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });
});

// ---------------------------------------------------------------------------
// TaskCard vertical buttons — column and boundary matrix (T-004 + T-005)
// ---------------------------------------------------------------------------

describe('Board — CardActionMenu vertical buttons wired end-to-end', () => {
  it('first card in column has move-up disabled and move-down enabled', () => {
    render(<Board />);
    const first = document.querySelector('[data-testid="task-card"][data-id="a"]')!;
    const up = first.querySelector('[data-testid="move-up-button"]') as HTMLButtonElement;
    const down = first.querySelector('[data-testid="move-down-button"]') as HTMLButtonElement;
    expect(up).toBeTruthy();
    expect(down).toBeTruthy();
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(false);
  });

  it('last card in column has move-down disabled and move-up enabled', () => {
    render(<Board />);
    const last = document.querySelector('[data-testid="task-card"][data-id="c"]')!;
    const up = last.querySelector('[data-testid="move-up-button"]') as HTMLButtonElement;
    const down = last.querySelector('[data-testid="move-down-button"]') as HTMLButtonElement;
    expect(up.disabled).toBe(false);
    expect(down.disabled).toBe(true);
  });

  it('clicking move-down does the same reorder as Alt+ArrowDown', () => {
    const reorderTask = vi.fn();
    setBoard({ reorderTask });
    render(<Board />);
    const first = document.querySelector('[data-testid="task-card"][data-id="a"]')!;
    const down = first.querySelector('[data-testid="move-down-button"]') as HTMLButtonElement;
    fireEvent.click(down);
    expect(reorderTask).toHaveBeenCalledOnce();
    const [id, column, rank] = reorderTask.mock.calls[0];
    expect(id).toBe('a');
    expect(column).toBe('todo');
    expect(rank).toBe(2500);
  });
});
