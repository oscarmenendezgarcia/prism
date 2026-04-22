/**
 * Component tests for SortableStageItem.
 *
 * useSortable is mocked so we can test the component's rendering and event
 * callbacks without needing a real DnD environment (which requires layout
 * measurements not available in jsdom).
 *
 * T-005: add SortableStageItem component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSortable } from '@dnd-kit/sortable';
import { SortableStageItem } from '../../src/components/modals/SortableStageItem';
import type { PipelineStage } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock @dnd-kit/sortable so tests run without a real DnD context
// ---------------------------------------------------------------------------

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn((_opts: { id: string }) => ({
    attributes:  { 'aria-roledescription': 'sortable', tabIndex: 0 },
    listeners:   { onKeyDown: vi.fn() },
    setNodeRef:  vi.fn(),
    transform:   null,
    transition:  null,
    isDragging:  false,
  })),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: { toString: (_: unknown) => undefined },
  },
}));

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultProps = {
  id:                'row-key-1',
  index:             1,
  stage:             'senior-architect' as PipelineStage,
  displayName:       'Senior Architect',
  checkpointActive:  false,
  showCheckpoint:    true,
  onRemove:          vi.fn(),
  onToggleCheckpoint: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('SortableStageItem — rendering', () => {
  it('renders the agent display name', () => {
    render(<SortableStageItem {...defaultProps} />);
    expect(screen.getByText('Senior Architect')).toBeInTheDocument();
  });

  it('renders the 1-based position index', () => {
    render(<SortableStageItem {...defaultProps} index={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the drag handle button with correct aria-label', () => {
    render(<SortableStageItem {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /drag to reorder senior architect/i }),
    ).toBeInTheDocument();
  });

  it('drag handle has the data-dnd-handle-key attribute', () => {
    render(<SortableStageItem {...defaultProps} id="my-row-key" />);
    const handle = screen.getByRole('button', { name: /drag to reorder/i });
    expect(handle).toHaveAttribute('data-dnd-handle-key', 'my-row-key');
  });

  it('renders the remove button', () => {
    render(<SortableStageItem {...defaultProps} />);
    expect(screen.getByRole('button', { name: /remove stage/i })).toBeInTheDocument();
  });

  it('renders the checkpoint checkbox when showCheckpoint is true', () => {
    render(<SortableStageItem {...defaultProps} showCheckpoint />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides the checkpoint checkbox when showCheckpoint is false', () => {
    render(<SortableStageItem {...defaultProps} showCheckpoint={false} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('checkbox is checked when checkpointActive is true', () => {
    render(<SortableStageItem {...defaultProps} checkpointActive />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('checkbox is unchecked when checkpointActive is false', () => {
    render(<SortableStageItem {...defaultProps} checkpointActive={false} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('shows pause icon when checkpoint is active', () => {
    render(<SortableStageItem {...defaultProps} checkpointActive />);
    expect(document.querySelector('[title="Pipeline will pause"]')).toBeTruthy();
  });

  it('does not show pause icon when checkpoint is inactive', () => {
    render(<SortableStageItem {...defaultProps} checkpointActive={false} />);
    expect(document.querySelector('[title="Pipeline will pause"]')).toBeNull();
  });

  it('applies opacity-50 class on the li when isDragging', () => {
    vi.mocked(useSortable).mockReturnValueOnce({
      attributes:  {} as any,
      listeners:   {} as any,
      setNodeRef:  vi.fn(),
      transform:   null,
      transition:  null,
      isDragging:  true,
      active:      null,
      over:        null,
      newIndex:    0,
      index:       0,
      isSorting:   false,
      overIndex:   0,
      isOver:      false,
      rect:        { current: null } as any,
      node:        { current: null } as any,
    });
    render(<SortableStageItem {...defaultProps} />);
    const li = screen.getByRole('listitem');
    expect(li.className).toContain('opacity-50');
  });

  it('remove button is disabled when isDragging', () => {
    vi.mocked(useSortable).mockReturnValueOnce({
      attributes:  {} as any,
      listeners:   {} as any,
      setNodeRef:  vi.fn(),
      transform:   null,
      transition:  null,
      isDragging:  true,
      active:      null,
      over:        null,
      newIndex:    0,
      index:       0,
      isSorting:   false,
      overIndex:   0,
      isOver:      false,
      rect:        { current: null } as any,
      node:        { current: null } as any,
    });
    render(<SortableStageItem {...defaultProps} />);
    expect(screen.getByRole('button', { name: /remove stage/i })).toBeDisabled();
  });

  it('renders ux-api-designer variant with correct display name', () => {
    render(
      <SortableStageItem
        {...defaultProps}
        stage="ux-api-designer"
        displayName="UX / API Designer"
      />,
    );
    expect(screen.getByText('UX / API Designer')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Event callbacks
// ---------------------------------------------------------------------------

describe('SortableStageItem — callbacks', () => {
  it('calls onRemove when the remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<SortableStageItem {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove stage/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('calls onToggleCheckpoint when the checkbox is changed', () => {
    const onToggleCheckpoint = vi.fn();
    render(<SortableStageItem {...defaultProps} onToggleCheckpoint={onToggleCheckpoint} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleCheckpoint).toHaveBeenCalledOnce();
  });

  it('does not call onRemove when remove button is disabled (isDragging)', () => {
    vi.mocked(useSortable).mockReturnValueOnce({
      attributes:  {} as any,
      listeners:   {} as any,
      setNodeRef:  vi.fn(),
      transform:   null,
      transition:  null,
      isDragging:  true,
      active:      null,
      over:        null,
      newIndex:    0,
      index:       0,
      isSorting:   false,
      overIndex:   0,
      isOver:      false,
      rect:        { current: null } as any,
      node:        { current: null } as any,
    });
    const onRemove = vi.fn();
    render(<SortableStageItem {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove stage/i }));
    expect(onRemove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('SortableStageItem — accessibility', () => {
  it('drag handle button is focusable (tabIndex not -1 in non-drag state)', () => {
    render(<SortableStageItem {...defaultProps} />);
    const handle = screen.getByRole('button', { name: /drag to reorder/i });
    // The button itself should be keyboard-focusable (tabIndex ≥ 0 or unset).
    const tabIndex = handle.getAttribute('tabindex');
    expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);
  });

  it('checkbox aria-label contains both index and display name', () => {
    render(<SortableStageItem {...defaultProps} index={2} displayName="Developer Agent" stage="developer-agent" />);
    expect(screen.getByLabelText(/pause before stage 2: developer agent/i)).toBeInTheDocument();
  });
});
