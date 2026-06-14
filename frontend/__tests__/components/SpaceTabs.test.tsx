/**
 * Component tests for the redesigned SpaceTabs (QOL-2: pin model).
 *
 * Strategy:
 *   - Test pinned zone rendering: pinned spaces render as tabs with drag props.
 *   - Test transient active tab: non-pinned active space renders after pinned zone.
 *   - Test overflow: non-pinned, non-active spaces go to overflow menu.
 *   - Test context menu: Edit / Pin-Unpin / Delete items.
 *   - useOverflowItems is no longer used; mock removed.
 *
 * Individual SpaceTab and SpaceOverflowMenu behaviours are tested in
 * their own test files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceTabs } from '../../src/components/layout/SpaceTabs';
import { useAppStore } from '../../src/stores/useAppStore';
import { useOverflowItems } from '../../src/hooks/useOverflowItems';

// ---------------------------------------------------------------------------
// Mock API dependencies
// ---------------------------------------------------------------------------
vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  updateSpace:          vi.fn(),
  getAttachmentContent: vi.fn(),
}));

// useOverflowItems does the width measurement (no layout in jsdom). Mock it so we
// can drive the visible/overflow split deterministically. Default: everything fits.
vi.mock('../../src/hooks/useOverflowItems', () => ({
  useOverflowItems: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Both spaces pinned → both render as tabs in the pinned zone. */
const PINNED_SPACES = [
  { id: 'default', name: 'General', pinned: true,  pinnedRank: 0, createdAt: '', updatedAt: '' },
  { id: 'space-2', name: 'Work',    pinned: true,  pinnedRank: 1, createdAt: '', updatedAt: '' },
];

/** General pinned, Work non-pinned → Work in overflow. */
const MIXED_SPACES = [
  { id: 'default', name: 'General', pinned: true,  pinnedRank: 0, createdAt: '', updatedAt: '' },
  { id: 'space-2', name: 'Work',    pinned: false,                createdAt: '', updatedAt: '' },
];

/** No spaces pinned → active space stays a visible tab; the rest may overflow. */
const UNPINNED_SPACES = [
  { id: 'default', name: 'General', pinned: false, createdAt: '', updatedAt: '' },
  { id: 'space-2', name: 'Work',    pinned: false, createdAt: '', updatedAt: '' },
];

/**
 * Build the OverflowResult the mocked useOverflowItems returns. The width math is
 * the hook's own concern (jsdom has no layout); here we drive visible/overflow
 * directly to test how SpaceTabs wires them.
 */
function overflowResult(visible: any[], overflow: any[] = []) {
  return { containerRef: () => {}, setItemRef: () => () => {}, visible, overflow, measuring: false };
}

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  useAppStore.setState({
    spaces:       PINNED_SPACES,
    activeSpaceId: 'default',
    pinSpace:     vi.fn(),
    unpinSpace:   vi.fn(),
    reorderPinnedSpaces: vi.fn(),
  } as any);
  vi.clearAllMocks();
  // Default: all non-pinned spaces fit (no overflow). Overflow tests override this.
  vi.mocked(useOverflowItems).mockImplementation((items: any) => overflowResult(items, []));
});

// ---------------------------------------------------------------------------
// Tab rendering — pinned zone
// ---------------------------------------------------------------------------
describe('SpaceTabs — tab rendering (pinned zone)', () => {
  it('renders a tab for each pinned space', () => {
    render(<SpaceTabs />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('renders add-space button', () => {
    render(<SpaceTabs />);
    expect(screen.getByLabelText('Create new space')).toBeInTheDocument();
  });

  it('renders role="tablist" on the nav', () => {
    render(<SpaceTabs />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('does NOT render the overflow button when all spaces are pinned', () => {
    render(<SpaceTabs />);
    expect(screen.queryByTestId('space-overflow-btn')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ARIA state
// ---------------------------------------------------------------------------
describe('SpaceTabs — ARIA state', () => {
  it('active tab has aria-selected="true"', () => {
    render(<SpaceTabs />);
    const generalTab = screen.getByRole('tab', { name: /general/i });
    expect(generalTab).toHaveAttribute('aria-selected', 'true');
  });

  it('inactive pinned tab has aria-selected="false"', () => {
    render(<SpaceTabs />);
    const workTab = screen.getByRole('tab', { name: /work/i });
    expect(workTab).toHaveAttribute('aria-selected', 'false');
  });

  it('tabs carry data-space-id', () => {
    render(<SpaceTabs />);
    const generalTab = screen.getByRole('tab', { name: /general/i });
    expect(generalTab).toHaveAttribute('data-space-id', 'default');
  });
});

// ---------------------------------------------------------------------------
// Switching spaces (pinned tabs)
// ---------------------------------------------------------------------------
describe('SpaceTabs — switching spaces', () => {
  it('calls setActiveSpace and loadBoard when a non-active pinned tab is clicked', () => {
    const mockSetActive = vi.fn();
    const mockLoadBoard = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      setActiveSpace: mockSetActive,
      loadBoard:      mockLoadBoard,
    } as any);
    render(<SpaceTabs />);

    fireEvent.click(screen.getByRole('tab', { name: /work/i }));

    expect(mockSetActive).toHaveBeenCalledWith('space-2');
    expect(mockLoadBoard).toHaveBeenCalled();
  });

  it('does not call setActiveSpace when the active tab is clicked', () => {
    const mockSetActive = vi.fn();
    useAppStore.setState({ setActiveSpace: mockSetActive } as any);
    render(<SpaceTabs />);

    fireEvent.click(screen.getByRole('tab', { name: /general/i }));

    expect(mockSetActive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Add space
// ---------------------------------------------------------------------------
describe('SpaceTabs — add space', () => {
  it('opens create space modal when the add button is clicked', () => {
    const mockOpenModal = vi.fn();
    useAppStore.setState({ openSpaceModal: mockOpenModal } as any);
    render(<SpaceTabs />);

    fireEvent.click(screen.getByLabelText('Create new space'));

    expect(mockOpenModal).toHaveBeenCalledWith('create');
  });
});

// ---------------------------------------------------------------------------
// Overflow — non-pinned spaces go to overflow menu
// ---------------------------------------------------------------------------
describe('SpaceTabs — overflow (non-pinned spaces)', () => {
  it('renders non-pinned spaces as tabs when they fit (no overflow menu)', () => {
    // Default mock: everything fits.
    useAppStore.setState({ spaces: MIXED_SPACES, activeSpaceId: 'default' });
    render(<SpaceTabs />);
    expect(screen.getByRole('tab', { name: /work/i })).toBeInTheDocument();
    expect(screen.queryByTestId('space-overflow-btn')).not.toBeInTheDocument();
  });

  it('collapses spaces that do not fit into the "More spaces (N)" menu', () => {
    const SPACES = [
      { id: 'default', name: 'General', pinned: false, createdAt: '', updatedAt: '' },
      { id: 'a',       name: 'Alpha',   pinned: false, createdAt: '', updatedAt: '' },
      { id: 'b',       name: 'Beta',    pinned: false, createdAt: '', updatedAt: '' },
    ];
    useAppStore.setState({ spaces: SPACES, activeSpaceId: 'default' });
    // Hook reports: General fits; Alpha + Beta overflow.
    vi.mocked(useOverflowItems).mockReturnValue(overflowResult([SPACES[0]], [SPACES[1], SPACES[2]]));
    render(<SpaceTabs />);
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByTestId('space-overflow-btn')).toBeInTheDocument();
    expect(screen.getByText('More spaces (2)')).toBeInTheDocument();
    // Overflowed spaces are not rendered as tabs.
    expect(screen.queryByRole('tab', { name: /alpha/i })).not.toBeInTheDocument();
  });

  it('no overflow button when all spaces are pinned', () => {
    render(<SpaceTabs />); // PINNED_SPACES in beforeEach
    expect(screen.queryByTestId('space-overflow-btn')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Transient active tab (non-pinned active space)
// ---------------------------------------------------------------------------
describe('SpaceTabs — transient active tab', () => {
  it('renders a transient tab for the active non-pinned space', () => {
    useAppStore.setState({ spaces: UNPINNED_SPACES, activeSpaceId: 'default' });
    render(<SpaceTabs />);
    // General is active and not pinned → rendered as transient tab
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
  });

  it('keeps the active space as a visible tab even when others overflow', () => {
    const SPACES = [
      { id: 'default', name: 'General', pinned: false, createdAt: '', updatedAt: '' },
      { id: 'a',       name: 'Alpha',   pinned: false, createdAt: '', updatedAt: '' },
    ];
    useAppStore.setState({ spaces: SPACES, activeSpaceId: 'default' });
    // Hook keeps the active (General) visible and overflows Alpha.
    vi.mocked(useOverflowItems).mockReturnValue(overflowResult([SPACES[0]], [SPACES[1]]));
    render(<SpaceTabs />);
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByText('More spaces (1)')).toBeInTheDocument();
    // The active space is not among the overflowed (menu) items.
    expect(screen.queryByRole('tab', { name: /alpha/i })).not.toBeInTheDocument();
  });

  it('no transient tab when active space is pinned', () => {
    render(<SpaceTabs />); // PINNED_SPACES — General is pinned and active
    // Only 2 tabs total (both pinned), no transient duplicate
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------
describe('SpaceTabs — divider', () => {
  it('shows a divider between pinned zone and overflow when both exist', () => {
    useAppStore.setState({ spaces: MIXED_SPACES, activeSpaceId: 'default' });
    const { container } = render(<SpaceTabs />);
    // The divider is a w-px h-5 bg-border element
    const divider = container.querySelector('.w-px.h-5.bg-border');
    expect(divider).toBeInTheDocument();
  });

  it('no divider when only pinned spaces (no overflow)', () => {
    const { container } = render(<SpaceTabs />); // PINNED_SPACES
    const divider = container.querySelector('.w-px.h-5.bg-border');
    expect(divider).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Context menu (kebab → Edit / Pin / Delete)
// ---------------------------------------------------------------------------
describe('SpaceTabs — context menu (kebab)', () => {
  it('opens context menu when kebab is clicked', () => {
    render(<SpaceTabs />);
    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    expect(document.body.querySelector('[role="menu"]')).toBeInTheDocument();
  });

  it('calls openSpaceModal with "rename" when Edit is selected from context menu', () => {
    const mockOpenModal = vi.fn();
    useAppStore.setState({ openSpaceModal: mockOpenModal } as any);
    render(<SpaceTabs />);

    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    fireEvent.click(screen.getByText('Edit'));

    expect(mockOpenModal).toHaveBeenCalledWith('rename', PINNED_SPACES[0]);
  });

  it('calls openDeleteSpaceDialog when Delete is selected from context menu', () => {
    const mockOpenDelete = vi.fn();
    useAppStore.setState({ openDeleteSpaceDialog: mockOpenDelete } as any);
    render(<SpaceTabs />);

    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    fireEvent.click(screen.getByText('Delete'));

    expect(mockOpenDelete).toHaveBeenCalledWith('default');
  });

  it('Delete is disabled when there is only one space', () => {
    useAppStore.setState({ spaces: [PINNED_SPACES[0]] });
    render(<SpaceTabs />);

    const kebab = screen.getByTitle('Space options');
    fireEvent.click(kebab);

    const deleteBtn = screen.getByRole('menuitem', { name: /delete/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('shows Unpin in context menu for a pinned space', () => {
    render(<SpaceTabs />); // PINNED_SPACES — both are pinned
    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    expect(screen.getByText('Unpin')).toBeInTheDocument();
  });

  it('shows Pin in context menu for a non-pinned space (via transient tab)', () => {
    useAppStore.setState({ spaces: UNPINNED_SPACES, activeSpaceId: 'default' });
    render(<SpaceTabs />);

    // General (active, non-pinned) is the first non-pinned tab; open its kebab.
    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    expect(screen.getByText('Pin')).toBeInTheDocument();
  });

  it('calls pinSpace when Pin is selected from context menu', () => {
    const mockPinSpace = vi.fn();
    useAppStore.setState({
      spaces:   UNPINNED_SPACES,
      activeSpaceId: 'default',
      pinSpace: mockPinSpace,
    } as any);
    render(<SpaceTabs />);

    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    fireEvent.click(screen.getByText('Pin'));

    expect(mockPinSpace).toHaveBeenCalledWith('default');
  });

  it('calls unpinSpace when Unpin is selected from context menu', () => {
    const mockUnpinSpace = vi.fn();
    useAppStore.setState({ unpinSpace: mockUnpinSpace } as any);
    render(<SpaceTabs />); // PINNED_SPACES

    const kebab = screen.getAllByTitle('Space options')[0];
    fireEvent.click(kebab);
    fireEvent.click(screen.getByText('Unpin'));

    expect(mockUnpinSpace).toHaveBeenCalledWith('default');
  });
});
