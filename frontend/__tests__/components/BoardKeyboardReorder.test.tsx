/**
 * ADR-1 keyboard-card-reorder — end-to-end tests for the Board handler
 * (T-002, T-005), the TaskCard Alt+Arrow keydown wiring (T-003), and the
 * shared aria-live announcer.
 *
 * Covers:
 *   - Alt+ArrowUp/Down on a focused card calls reorderTask with the correct
 *     rank; plain arrows / Tab / Enter are NOT swallowed.
 *   - Announcer text after a successful move.
 *   - Column-boundary and arc-group-boundary spoken no-ops.
 *   - Arc filter narrows the visible-neighbor list.
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
import type { Task, Column } from '../../src/types';

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

function mkTask(id: string, rank: number, arc?: string): Task {
  return {
    id,
    title: `Task ${id}`,
    type: 'feature',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rank,
    arc,
  };
}

const TASKS_TODO = [mkTask('a', 1000), mkTask('b', 2000), mkTask('c', 3000)];

function setBoard(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    tasks: { todo: TASKS_TODO, 'in-progress': [], done: [] },
    activeSpaceId: 'space-1',
    spaces: [{ id: 'space-1', name: 'Test', createdAt: '', updatedAt: '' }],
    isMutating: false,
    arcFilter: null,
    arcGrouping: false,
    availableAgents: [],
    activeRun: null,
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
    const r = resolveKeyboardNeighbor(col, 'b', null, false, 'up');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('a');
  });

  it('returns the next card for down', () => {
    const r = resolveKeyboardNeighbor(col, 'b', null, false, 'down');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('c');
  });

  it('boundary=column when pressing up on the first card', () => {
    const r = resolveKeyboardNeighbor(col, 'a', null, false, 'up');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('column');
  });

  it('boundary=column when pressing down on the last card', () => {
    const r = resolveKeyboardNeighbor(col, 'c', null, false, 'down');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('column');
  });

  it('arc filter narrows visible neighbors', () => {
    const withArcs = [mkTask('a', 1000, 'X'), mkTask('b', 2000, 'Y'), mkTask('c', 3000, 'X')];
    const r = resolveKeyboardNeighbor(withArcs, 'a', 'X', false, 'down');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('c'); // 'b' filtered out
  });

  it('arc grouping: within-group neighbor works', () => {
    const grouped = [mkTask('a', 1000, 'X'), mkTask('b', 2000, 'X'), mkTask('c', 3000, 'Y')];
    const r = resolveKeyboardNeighbor(grouped, 'a', null, true, 'down');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.neighborId).toBe('b');
  });

  it('arc grouping: cross-group press is a group boundary', () => {
    const grouped = [mkTask('a', 1000, 'X'), mkTask('b', 2000, 'X'), mkTask('c', 3000, 'Y')];
    const r = resolveKeyboardNeighbor(grouped, 'b', null, true, 'down');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('group');
      expect(r.arcLabel).toBe('X');
    }
  });

  it('arc grouping: press up from ungrouped bucket into a group is a group boundary', () => {
    const grouped = [mkTask('a', 1000, 'X'), mkTask('b', 2000)];
    const r = resolveKeyboardNeighbor(grouped, 'b', null, true, 'up');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('group');
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

  it('arc-group boundary announces the group name', () => {
    const reorderTask = vi.fn();
    setBoard({
      tasks: {
        todo: [
          mkTask('a', 1000, 'Alpha'),
          mkTask('b', 2000, 'Alpha'),
          mkTask('c', 3000, 'Beta'),
        ],
        'in-progress': [], done: [],
      },
      arcGrouping: true,
      reorderTask,
    });
    render(<Board />);
    // b is last in group 'Alpha', pressing down should hit group boundary
    fireEvent.keyDown(findCard('b'), { key: 'ArrowDown', altKey: true });
    expect(reorderTask).not.toHaveBeenCalled();
    expect(useAnnouncer.getState().message).toBe(
      'Task "Task b" is already at the bottom of the "Alpha" group in Todo.'
    );
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

  it('BUG-001 regression: a rebalance-triggering move calls the atomic reorderTasks batch, not N reorderTask loop calls', () => {
    // Ranks packed tight enough (gap < 0.001) that inserting 'a' between
    // 'b' and 'c' forces computeDropRank's rebalance branch. Before the
    // fix, handleKeyboardReorder looped reorderTask() once per task here —
    // reintroducing the partial-rebalance-corruption bug already fixed for
    // drag-and-drop (see .folio/lessons/partial-rebalance-corruption.md).
    const reorderTask = vi.fn();
    const reorderTasks = vi.fn();
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
      reorderTasks,
    } as never);
    render(<Board />);

    fireEvent.keyDown(findCard('a'), { key: 'ArrowDown', altKey: true });

    // Single atomic batch call — never the per-task loop.
    expect(reorderTasks).toHaveBeenCalledOnce();
    expect(reorderTask).not.toHaveBeenCalled();

    const [column, updates] = reorderTasks.mock.calls[0];
    expect(column).toBe('todo');
    expect(updates).toEqual([
      { id: 'b', rank: 1000 },
      { id: 'a', rank: 2000 },
      { id: 'c', rank: 3000 },
    ]);
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
