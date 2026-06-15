/**
 * Unit tests for SpaceOverflowMenu component.
 *
 * Covers: trigger button (data attrs, +N count), dropdown open/close,
 * filter input appearance past threshold, real-time filtering,
 * item selection, keyboard navigation (arrows, Enter, Escape),
 * close on outside click.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaceOverflowMenu } from '../../src/components/layout/SpaceOverflowMenu';
import type { Space } from '../../src/types';

function makeSpace(id: string, name: string): Space {
  return { id, name, createdAt: '', updatedAt: '' };
}

const THREE_SPACES = [
  makeSpace('s1', 'research-archive'),
  makeSpace('s2', 'related-tags-motive'),
  makeSpace('s3', 'ltr-empathyai'),
];

const SEVEN_SPACES = [
  makeSpace('s1', 'research-archive'),
  makeSpace('s2', 'related-tags-motive'),
  makeSpace('s3', 'ltr-empathyai'),
  makeSpace('s4', 'mobile-auth'),
  makeSpace('s5', 'payment-flow'),
  makeSpace('s6', 'analytics'),
  makeSpace('s7', 'backend-api'),
];

beforeEach(() => {
  vi.clearAllMocks();
  // Clear localStorage so overflow-open state doesn't leak between tests (QOL-2).
  localStorage.removeItem('prism:space-overflow-open');
});

// ---------------------------------------------------------------------------
// Trigger button
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — trigger button', () => {
  it('renders the overflow count next to the chevron', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('has data-testid="space-overflow-btn"', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('space-overflow-btn')).toBeInTheDocument();
  });

  it('has data-overflow-count matching spaces length', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('space-overflow-btn')).toHaveAttribute('data-overflow-count', '3');
  });

  it('has aria-expanded="false" when closed', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('space-overflow-btn')).toHaveAttribute('aria-expanded', 'false');
  });

  it('has aria-expanded="true" when open', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.getByTestId('space-overflow-btn')).toHaveAttribute('aria-expanded', 'true');
  });
});

// ---------------------------------------------------------------------------
// Dropdown open / close
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — dropdown open/close', () => {
  it('dropdown is not visible initially', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    // The dropdown items should not be in the DOM
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens dropdown when trigger is clicked', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    // The menu should now be in the portal (document.body)
    expect(document.body.querySelector('[role="menu"]')).toBeInTheDocument();
  });

  it('lists all overflow spaces in the dropdown', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.getByText('research-archive')).toBeInTheDocument();
    expect(screen.getByText('related-tags-motive')).toBeInTheDocument();
    expect(screen.getByText('ltr-empathyai')).toBeInTheDocument();
  });

  it('toggles closed when the trigger is clicked again', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    const btn = screen.getByTestId('space-overflow-btn');
    fireEvent.click(btn);
    expect(document.body.querySelector('[role="menu"]')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(document.body.querySelector('[role="menu"]')).not.toBeInTheDocument();
  });

  it('closes dropdown on Escape key', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(document.body.querySelector('[role="menu"]')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.querySelector('[role="menu"]')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Filter input visibility
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — filter input', () => {
  it('does NOT show filter input when spaces count is at or below threshold (6)', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.queryByPlaceholderText('Search spaces...')).not.toBeInTheDocument();
  });

  it('shows filter input when spaces count exceeds threshold', () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.getByPlaceholderText('Search spaces...')).toBeInTheDocument();
  });

  it('shows filter input with a custom threshold', () => {
    const twoSpaces = THREE_SPACES.slice(0, 2);
    render(
      <SpaceOverflowMenu
        spaces={twoSpaces}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={1} // threshold of 1 → 2 items → show filter
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.getByPlaceholderText('Search spaces...')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Filtering behavior
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — filtering', () => {
  it('filters spaces by name as user types', () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    const input = screen.getByPlaceholderText('Search spaces...');

    fireEvent.change(input, { target: { value: 'mobile' } });

    expect(screen.getByText('mobile-auth')).toBeInTheDocument();
    expect(screen.queryByText('research-archive')).not.toBeInTheDocument();
    expect(screen.queryByText('analytics')).not.toBeInTheDocument();
  });

  it('filter is case-insensitive', () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    const input = screen.getByPlaceholderText('Search spaces...');

    fireEvent.change(input, { target: { value: 'ANALYTICS' } });

    expect(screen.getByText('analytics')).toBeInTheDocument();
  });

  it('shows "No spaces found" when filter matches nothing', () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    const input = screen.getByPlaceholderText('Search spaces...');

    fireEvent.change(input, { target: { value: 'xyznotfound123' } });

    expect(screen.getByText('No spaces found')).toBeInTheDocument();
  });

  it('shows clear button when filter text is entered', () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    const input = screen.getByPlaceholderText('Search spaces...');
    fireEvent.change(input, { target: { value: 'mobile' } });

    expect(screen.getByLabelText('Clear filter')).toBeInTheDocument();
  });

  it('clicking clear button resets the filter', () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    const input = screen.getByPlaceholderText('Search spaces...');
    fireEvent.change(input, { target: { value: 'mobile' } });

    // Only 1 item visible
    expect(screen.queryByText('analytics')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear filter'));

    // All items visible again
    expect(screen.getByText('analytics')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — selection', () => {
  it('calls onSelect with the space id when an item is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    fireEvent.click(screen.getByText('related-tags-motive'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('closes the dropdown after selection', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    fireEvent.click(screen.getByText('related-tags-motive'));
    expect(document.body.querySelector('[role="menu"]')).not.toBeInTheDocument();
  });

  it('active space item has aria-checked="true"', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s2"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));

    const menu = document.body.querySelector('[role="menu"]')!;
    const items = menu.querySelectorAll('[role="menuitemradio"]');
    // Find the item for s2
    const s2Item = [...items].find((o) => o.textContent?.includes('related-tags-motive'));
    expect(s2Item).toHaveAttribute('aria-checked', 'true');
  });

  it('non-active space items have aria-checked="false"', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));

    const menu = document.body.querySelector('[role="menu"]')!;
    const items = menu.querySelectorAll('[role="menuitemradio"]');
    const nonActive = [...items].filter((o) => !o.textContent?.includes('research-archive'));
    nonActive.forEach((o) => expect(o).toHaveAttribute('aria-checked', 'false'));
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — keyboard navigation', () => {
  it('ArrowDown on filter input moves focus to first item', async () => {
    render(
      <SpaceOverflowMenu
        spaces={SEVEN_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
        filterThreshold={6}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    const input = screen.getByPlaceholderText('Search spaces...');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // The first item button should now have focus
    await waitFor(() => {
      const menu = document.body.querySelector('[role="menu"]')!;
      const firstButton = menu.querySelector('button') as HTMLElement;
      expect(document.activeElement).toBe(firstButton);
    });
  });

  it('Escape within the dropdown closes it', () => {
    render(
      <SpaceOverflowMenu
        spaces={THREE_SPACES}
        activeSpaceId="s1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(document.body.querySelector('[role="menu"]')).toBeInTheDocument();

    // Escape on document
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.querySelector('[role="menu"]')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Unpin from the dropdown (pinned spaces can collapse into overflow)
// ---------------------------------------------------------------------------
describe('SpaceOverflowMenu — unpin from dropdown', () => {
  const MIXED_SPACES: Space[] = [
    { ...makeSpace('s1', 'research-archive'), pinned: true, pinnedRank: 0 },
    makeSpace('s2', 'related-tags-motive'),
  ];

  it('renders an Unpin button only for pinned spaces', () => {
    render(
      <SpaceOverflowMenu
        spaces={MIXED_SPACES}
        activeSpaceId="s2"
        onSelect={vi.fn()}
        onUnpin={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.getByLabelText('Unpin research-archive')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unpin related-tags-motive')).not.toBeInTheDocument();
  });

  it('calls onUnpin (and not onSelect) when the Unpin button is clicked', () => {
    const onUnpin = vi.fn();
    const onSelect = vi.fn();
    render(
      <SpaceOverflowMenu
        spaces={MIXED_SPACES}
        activeSpaceId="s2"
        onSelect={onSelect}
        onUnpin={onUnpin}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    fireEvent.click(screen.getByLabelText('Unpin research-archive'));
    expect(onUnpin).toHaveBeenCalledWith('s1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not render Unpin buttons when onUnpin is not provided', () => {
    render(
      <SpaceOverflowMenu
        spaces={MIXED_SPACES}
        activeSpaceId="s2"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('space-overflow-btn'));
    expect(screen.queryByLabelText('Unpin research-archive')).not.toBeInTheDocument();
  });
});
