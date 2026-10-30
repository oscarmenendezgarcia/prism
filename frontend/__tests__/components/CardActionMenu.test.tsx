/**
 * Unit tests for CardActionMenu.
 * T-006: renders the buttons for the statuses on each side, disabled states, aria-labels.
 */

import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CardActionMenu } from '../../src/components/board/CardActionMenu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMenu(overrides: Partial<React.ComponentProps<typeof CardActionMenu>> = {}) {
  const defaults: React.ComponentProps<typeof CardActionMenu> = {
    leftLabel: 'Todo',
    rightLabel: 'Done',
    isMutating: false,
    onMoveLeft: vi.fn(),
    onMoveRight: vi.fn(),
    onDelete: vi.fn(),
  };
  return render(<CardActionMenu {...defaults} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Move-left button tests
// ---------------------------------------------------------------------------

describe('CardActionMenu — move-left button', () => {
  it('is absent when there is no status to the left', () => {
    renderMenu({ leftLabel: undefined, rightLabel: 'In Progress' });
    expect(screen.getAllByRole('button', { name: /^move to /i }).map((b) => b.getAttribute('aria-label'))).toEqual(['Move to In Progress']);
  });

  it('is present when there is a status to the left, with its name', () => {
    renderMenu({ leftLabel: 'Todo', rightLabel: undefined });
    expect(screen.getByRole('button', { name: 'Move to Todo' })).toBeInTheDocument();
  });

  it('names whatever the status is called', () => {
    renderMenu({ leftLabel: 'In review', rightLabel: undefined });
    expect(screen.getByRole('button', { name: 'Move to In review' })).toBeInTheDocument();
  });

  it('calls onMoveLeft when clicked', () => {
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();
    renderMenu({ onMoveLeft, onMoveRight });
    fireEvent.click(screen.getByRole('button', { name: /move to todo/i }));
    expect(onMoveLeft).toHaveBeenCalledOnce();
    expect(onMoveRight).not.toHaveBeenCalled();
  });

  it('is disabled when isMutating is true', () => {
    renderMenu({ isMutating: true });
    expect(screen.getByRole('button', { name: /move to todo/i })).toBeDisabled();
  });

  it('has an aria-label', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /move to todo/i })).toHaveAttribute('aria-label', 'Move to Todo');
  });
});

// ---------------------------------------------------------------------------
// Move-right button tests
// ---------------------------------------------------------------------------

describe('CardActionMenu — move-right button', () => {
  it('is absent when there is no status to the right', () => {
    renderMenu({ leftLabel: 'In Progress', rightLabel: undefined });
    expect(screen.getAllByRole('button', { name: /^move to /i }).map((b) => b.getAttribute('aria-label'))).toEqual(['Move to In Progress']);
  });

  it('is present when there is a status to the right, with its name', () => {
    renderMenu({ leftLabel: undefined, rightLabel: 'In Progress' });
    expect(screen.getByRole('button', { name: 'Move to In Progress' })).toBeInTheDocument();
  });

  it('calls onMoveRight when clicked', () => {
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();
    renderMenu({ onMoveLeft, onMoveRight });
    fireEvent.click(screen.getByRole('button', { name: /move to done/i }));
    expect(onMoveRight).toHaveBeenCalledOnce();
    expect(onMoveLeft).not.toHaveBeenCalled();
  });

  it('is disabled when isMutating is true', () => {
    renderMenu({ isMutating: true });
    expect(screen.getByRole('button', { name: /move to done/i })).toBeDisabled();
  });

  it('has an aria-label', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /move to done/i })).toHaveAttribute('aria-label', 'Move to Done');
  });
});

// ---------------------------------------------------------------------------
// Delete button tests
// ---------------------------------------------------------------------------

describe('CardActionMenu — delete button', () => {
  it('is always rendered', () => {
    renderMenu({ leftLabel: undefined, rightLabel: undefined });
    expect(screen.getByRole('button', { name: 'Delete issue' })).toBeInTheDocument();
  });

  it('is disabled when isMutating is true', () => {
    renderMenu({ isMutating: true });
    expect(screen.getByRole('button', { name: 'Delete issue' })).toBeDisabled();
  });

  it('is enabled when isMutating is false', () => {
    renderMenu({ isMutating: false });
    expect(screen.getByRole('button', { name: 'Delete issue' })).not.toBeDisabled();
  });

  it('calls onDelete when clicked', () => {
    const onDelete = vi.fn();
    renderMenu({ onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete issue' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('has an aria-label', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Delete issue' })).toHaveAttribute('aria-label', 'Delete issue');
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

  it('renders ↑/↓ as native <button type="button">', () => {
    renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true });
    const up = screen.getByRole('button', { name: 'Move up' });
    const down = screen.getByRole('button', { name: 'Move down' });
    expect(up.tagName).toBe('BUTTON');
    expect(down.tagName).toBe('BUTTON');
    expect(up).toHaveAttribute('type', 'button');
    expect(down).toHaveAttribute('type', 'button');
  });

  it('preserves ARIA toolbar role and shows ↑↓ alongside ←→, with a divider between the groups', () => {
    const { container } = renderMenu({ onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true });
    const toolbar = screen.getByRole('toolbar', { name: /card actions/i });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to todo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to done/i })).toBeInTheDocument();
    expect(container.querySelector('[role="toolbar"] > .w-px')).toBeInTheDocument();
  });

  it('has no divider when no horizontal group follows', () => {
    const { container } = renderMenu({ leftLabel: undefined, rightLabel: undefined, onMoveUp: vi.fn(), onMoveDown: vi.fn(), canMoveUp: true, canMoveDown: true });
    expect(container.querySelector('[role="toolbar"] > .w-px')).toBeNull();
  });
});
