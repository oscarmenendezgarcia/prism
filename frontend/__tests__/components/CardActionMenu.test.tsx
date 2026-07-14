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
// ADR-1 (touch-reorder) — move-up / move-down buttons
// ---------------------------------------------------------------------------

describe('CardActionMenu — move-up / move-down (touch-reorder)', () => {
  it('does not render up/down buttons when callbacks are omitted', () => {
    renderMenu({ column: 'todo' });
    expect(screen.queryByRole('button', { name: /^move up$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^move down$/i })).not.toBeInTheDocument();
  });

  it('renders both ↑ and ↓ when both callbacks are provided', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn() });
    expect(screen.getByRole('button', { name: /^move up$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move down$/i })).toBeInTheDocument();
  });

  it('renders only ↑ when only onMoveUp is provided', () => {
    renderMenu({ onMoveUp: vi.fn() });
    expect(screen.getByRole('button', { name: /^move up$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^move down$/i })).not.toBeInTheDocument();
  });

  it('calls onMoveUp when ↑ is clicked', () => {
    const onMoveUp = vi.fn();
    renderMenu({ onMoveUp, onMoveDown: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /^move up$/i }));
    expect(onMoveUp).toHaveBeenCalledOnce();
  });

  it('calls onMoveDown when ↓ is clicked', () => {
    const onMoveDown = vi.fn();
    renderMenu({ onMoveUp: vi.fn(), onMoveDown });
    fireEvent.click(screen.getByRole('button', { name: /^move down$/i }));
    expect(onMoveDown).toHaveBeenCalledOnce();
  });

  it('disables ↑ when canMoveUp=false (first card)', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: false });
    expect(screen.getByRole('button', { name: /^move up$/i })).toBeDisabled();
  });

  it('disables ↓ when canMoveDown=false (last card)', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveDown: false });
    expect(screen.getByRole('button', { name: /^move down$/i })).toBeDisabled();
  });

  it('disables both ↑ and ↓ while isMutating', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), isMutating: true });
    expect(screen.getByRole('button', { name: /^move up$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^move down$/i })).toBeDisabled();
  });

  it('renders ↑/↓ as native <button type="button">', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn() });
    const up = screen.getByRole('button', { name: /^move up$/i });
    const down = screen.getByRole('button', { name: /^move down$/i });
    expect(up.tagName).toBe('BUTTON');
    expect(down.tagName).toBe('BUTTON');
    expect(up).toHaveAttribute('type', 'button');
    expect(down).toHaveAttribute('type', 'button');
  });

  it('both buttons have title matching aria-label', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn() });
    expect(screen.getByRole('button', { name: /^move up$/i })).toHaveAttribute('title', 'Move up');
    expect(screen.getByRole('button', { name: /^move down$/i })).toHaveAttribute('title', 'Move down');
  });

  it('preserves ARIA toolbar role and shows ↑↓ alongside ←→', () => {
    renderMenu({ column: 'in-progress', onMoveUp: vi.fn(), onMoveDown: vi.fn() });
    const toolbar = screen.getByRole('toolbar', { name: /card actions/i });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move up$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move down$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to todo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to done/i })).toBeInTheDocument();
  });
});
