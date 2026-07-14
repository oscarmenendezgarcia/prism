/**
 * Unit tests for CardActionMenu.
 * T-006: renders correct buttons per column, disabled states, aria-labels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CardActionMenu } from '../../src/components/board/CardActionMenu';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentRun } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
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
  listRuns: vi.fn(),
  getRun: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_RUN: AgentRun = {
  taskId: 'task-1',
  agentId: 'developer-agent',
  spaceId: 'space-1',
  startedAt: '2026-03-26T00:00:00.000Z',
  cliCommand: 'claude --agent developer-agent',
  promptPath: '/tmp/prompt.md',
};

function renderMenu(overrides: Partial<React.ComponentProps<typeof CardActionMenu>> = {}) {
  const defaults: React.ComponentProps<typeof CardActionMenu> = {
    taskId: 'task-1',
    column: 'in-progress',
    spaceId: 'space-1',
    isMutating: false,
    activeRun: null,
    onMoveLeft: vi.fn(),
    onMoveRight: vi.fn(),
    onDelete: vi.fn(),
  };
  return render(<CardActionMenu {...defaults} {...overrides} />);
}

beforeEach(() => {
  useAppStore.setState({
    activeSpaceId: 'space-1',
    spaces: [{ id: 'space-1', name: 'Test Space', createdAt: '', updatedAt: '' }],
    availableAgents: [],
    activeRun: null,
    isMutating: false,
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Move-left button tests
// ---------------------------------------------------------------------------

describe('CardActionMenu — move-left button', () => {
  it('is absent on the todo column', () => {
    renderMenu({ column: 'todo' });
    expect(screen.queryByRole('button', { name: /move to todo/i })).not.toBeInTheDocument();
  });

  it('is present on the in-progress column', () => {
    renderMenu({ column: 'in-progress' });
    expect(screen.getByRole('button', { name: /move to todo/i })).toBeInTheDocument();
  });

  it('is present on the done column', () => {
    renderMenu({ column: 'done' });
    expect(screen.getByRole('button', { name: /move to in progress/i })).toBeInTheDocument();
  });

  it('calls onMoveLeft when clicked', () => {
    const onMoveLeft = vi.fn();
    renderMenu({ column: 'in-progress', onMoveLeft });
    fireEvent.click(screen.getByRole('button', { name: /move to todo/i }));
    expect(onMoveLeft).toHaveBeenCalledOnce();
  });

  it('has an aria-label', () => {
    renderMenu({ column: 'in-progress' });
    const btn = screen.getByRole('button', { name: /move to todo/i });
    expect(btn).toHaveAttribute('aria-label');
  });
});

// ---------------------------------------------------------------------------
// Move-right button tests
// ---------------------------------------------------------------------------

describe('CardActionMenu — move-right button', () => {
  it('is absent on the done column', () => {
    renderMenu({ column: 'done' });
    expect(screen.queryByRole('button', { name: /move to done/i })).not.toBeInTheDocument();
  });

  it('is present on the todo column', () => {
    renderMenu({ column: 'todo' });
    expect(screen.getByRole('button', { name: /move to in progress/i })).toBeInTheDocument();
  });

  it('is present on the in-progress column', () => {
    renderMenu({ column: 'in-progress' });
    expect(screen.getByRole('button', { name: /move to done/i })).toBeInTheDocument();
  });

  it('calls onMoveRight when clicked', () => {
    const onMoveRight = vi.fn();
    renderMenu({ column: 'in-progress', onMoveRight });
    fireEvent.click(screen.getByRole('button', { name: /move to done/i }));
    expect(onMoveRight).toHaveBeenCalledOnce();
  });

  it('has an aria-label', () => {
    renderMenu({ column: 'in-progress' });
    const btn = screen.getByRole('button', { name: /move to done/i });
    expect(btn).toHaveAttribute('aria-label');
  });
});

// ---------------------------------------------------------------------------
// Delete button tests
// ---------------------------------------------------------------------------

describe('CardActionMenu — delete button', () => {
  it('is always rendered', () => {
    renderMenu({ column: 'todo' });
    expect(screen.getByRole('button', { name: /delete task/i })).toBeInTheDocument();
  });

  it('is disabled when isMutating is true', () => {
    renderMenu({ isMutating: true });
    expect(screen.getByRole('button', { name: /delete task/i })).toBeDisabled();
  });

  it('is disabled when activeRun is non-null', () => {
    renderMenu({ activeRun: SAMPLE_RUN });
    expect(screen.getByRole('button', { name: /delete task/i })).toBeDisabled();
  });

  it('is enabled when isMutating is false and activeRun is null', () => {
    renderMenu({ isMutating: false, activeRun: null });
    expect(screen.getByRole('button', { name: /delete task/i })).not.toBeDisabled();
  });

  it('calls onDelete when clicked', () => {
    const onDelete = vi.fn();
    renderMenu({ onDelete });
    fireEvent.click(screen.getByRole('button', { name: /delete task/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('has an aria-label', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /delete task/i })).toHaveAttribute('aria-label');
  });
});

// ---------------------------------------------------------------------------
// AgentLauncherMenu (run-agent) — only on todo column
// ---------------------------------------------------------------------------

describe('CardActionMenu — run-agent (AgentLauncherMenu)', () => {
  it('run agent button is present when column is todo', () => {
    renderMenu({ column: 'todo' });
    // AgentLauncherMenu renders a button with aria-label "Run agent"
    expect(screen.getByRole('button', { name: /run agent/i })).toBeInTheDocument();
  });

  it('run agent button is absent when column is in-progress', () => {
    renderMenu({ column: 'in-progress' });
    expect(screen.queryByRole('button', { name: /run agent/i })).not.toBeInTheDocument();
  });

  it('run agent button is absent when column is done', () => {
    renderMenu({ column: 'done' });
    expect(screen.queryByRole('button', { name: /run agent/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Move-up / Move-down buttons (ADR-1 keyboard-card-reorder, T-004)
// ---------------------------------------------------------------------------

describe('CardActionMenu — move-up / move-down buttons', () => {
  it('are absent when neither vertical prop is provided (feature off)', () => {
    renderMenu({ onMoveUp: undefined, onMoveDown: undefined, canMoveUp: false, canMoveDown: false });
    expect(screen.queryByRole('button', { name: 'Move up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move down' })).not.toBeInTheDocument();
  });

  it('render when canMoveUp/Down are provided', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true });
    expect(screen.getByRole('button', { name: 'Move up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeInTheDocument();
  });

  it('render leftmost (before the move-left / move-right pair)', () => {
    const { container } = renderMenu({
      column: 'in-progress',
      onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true,
    });
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(buttons.slice(0, 2)).toEqual(['Move up', 'Move down']);
  });

  it('call onMoveUp / onMoveDown when clicked', () => {
    const onMoveUp = vi.fn(), onMoveDown = vi.fn();
    renderMenu({ onMoveUp, onMoveDown, canMoveUp: true, canMoveDown: true });
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
  });

  it('move-up disabled when canMoveUp is false (first-in-list boundary)', () => {
    renderMenu({ onMoveUp: undefined, onMoveDown: vi.fn(), canMoveUp: false, canMoveDown: true });
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).not.toBeDisabled();
  });

  it('move-down disabled when canMoveDown is false (last-in-list boundary)', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: undefined, canMoveUp: true, canMoveDown: false });
    expect(screen.getByRole('button', { name: 'Move up' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('both disabled while isMutating, even at non-boundary positions', () => {
    renderMenu({
      isMutating: true,
      onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true,
    });
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('tooltips include the shortcut hint', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true });
    expect(screen.getByRole('button', { name: 'Move up' })).toHaveAttribute('title', 'Move up (Alt+↑)');
    expect(screen.getByRole('button', { name: 'Move down' })).toHaveAttribute('title', 'Move down (Alt+↓)');
  });

  it('aria-label stays stable at the boundary — does not switch to "Already at top" text', () => {
    renderMenu({ canMoveUp: false, canMoveDown: true, onMoveDown: vi.fn() });
    const btn = screen.getByRole('button', { name: 'Move up' });
    expect(btn).toHaveAttribute('aria-label', 'Move up');
    expect(btn.getAttribute('aria-label')).not.toMatch(/already/i);
  });
});
