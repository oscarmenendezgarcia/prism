/**
 * T-013: TaskCard blocked badge rendering tests.
 *
 * Tests that the "blocked by N" badge appears/disappears based on
 * task.isBlocked and the current column.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskCard } from '../TaskCard';
import { useAppStore } from '@/stores/useAppStore';
import type { Task } from '@/types';

// ── API client mock ───────────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents: vi.fn(),
  getAgent: vi.fn(),
  generatePrompt: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  createAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun: vi.fn().mockResolvedValue({}),
  getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  listRuns: vi.fn(),
  getRun: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:        overrides.id        ?? 'task-1',
    title:     overrides.title     ?? 'Test task',
    type:      overrides.type      ?? 'feature',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useAppStore.setState({
    spaces: [],
    activeSpaceId: 'space-1',
    tasks: { todo: [], 'in-progress': [], done: [] },
    detailTask: null,
    isMutating: false,
  });
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TaskCard — blocked badge', () => {
  it('should_render_blocked_badge_when_isBlocked_true_in_todo', () => {
    const task = makeTask({ isBlocked: true, blockedByCount: 2 });
    render(<TaskCard task={task} column="todo" />);
    const badge = screen.getByTestId('blocked-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('blocked by 2');
  });

  it('should_render_blocked_badge_when_isBlocked_true_in_progress', () => {
    const task = makeTask({ isBlocked: true, blockedByCount: 1 });
    render(<TaskCard task={task} column="in-progress" />);
    const badge = screen.getByTestId('blocked-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('blocked by 1');
  });

  it('should_NOT_render_blocked_badge_when_isBlocked_false', () => {
    const task = makeTask({ isBlocked: false, blockedByCount: 0 });
    render(<TaskCard task={task} column="todo" />);
    expect(screen.queryByTestId('blocked-badge')).toBeNull();
  });

  it('should_NOT_render_blocked_badge_when_isBlocked_undefined', () => {
    const task = makeTask({ dependsOn: ['some-id'] });
    render(<TaskCard task={task} column="todo" />);
    expect(screen.queryByTestId('blocked-badge')).toBeNull();
  });

  it('should_NOT_render_blocked_badge_in_done_column_even_if_isBlocked_true', () => {
    const task = makeTask({ isBlocked: true, blockedByCount: 1 });
    render(<TaskCard task={task} column="done" />);
    expect(screen.queryByTestId('blocked-badge')).toBeNull();
  });

  it('should_show_correct_singular_aria_label_for_1_blocker', () => {
    const task = makeTask({ isBlocked: true, blockedByCount: 1 });
    render(<TaskCard task={task} column="todo" />);
    const badge = screen.getByTestId('blocked-badge');
    expect(badge.getAttribute('aria-label')).toBe('Blocked by 1 task');
  });

  it('should_show_correct_plural_aria_label_for_multiple_blockers', () => {
    const task = makeTask({ isBlocked: true, blockedByCount: 3 });
    render(<TaskCard task={task} column="todo" />);
    const badge = screen.getByTestId('blocked-badge');
    expect(badge.getAttribute('aria-label')).toBe('Blocked by 3 tasks');
  });

  it('should_render_lock_icon_inside_badge', () => {
    const task = makeTask({ isBlocked: true, blockedByCount: 1 });
    render(<TaskCard task={task} column="todo" />);
    const badge = screen.getByTestId('blocked-badge');
    const icon = badge.querySelector('.material-symbols-outlined');
    expect(icon?.textContent).toBe('lock');
  });
});
