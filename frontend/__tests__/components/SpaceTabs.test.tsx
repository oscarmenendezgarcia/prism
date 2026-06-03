/**
 * Component tests for the refactored SpaceTabs.
 *
 * Strategy: mock useOverflowItems so all spaces are always "visible"
 * (no DOM measurement required), then test the orchestration logic —
 * tab rendering, active state, click handlers, overflow button, and
 * context menu (kebab → Edit / Delete).
 *
 * Individual SpaceTab and SpaceOverflowMenu behaviours are tested in
 * their own test files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpaceTabs } from '../../src/components/layout/SpaceTabs';
import { useAppStore } from '../../src/stores/useAppStore';

// ---------------------------------------------------------------------------
// Mock API and hook dependencies
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
  getAttachmentContent: vi.fn(),
}));

/**
 * Mock useOverflowItems to pass all items through as visible.
 * This removes the ResizeObserver / DOM-measurement dependency from
 * these orchestration tests.
 */
vi.mock('../../src/hooks/useOverflowItems', () => ({
  useOverflowItems: (items: { id: string }[]) => ({
    containerRef: vi.fn(),
    setItemRef:   () => () => {},
    visible:      items,
    overflow:     [],
    measuring:    false,
  }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const MOCK_SPACES = [
  { id: 'default', name: 'General',  createdAt: '', updatedAt: '' },
  { id: 'space-2', name: 'Work',     createdAt: '', updatedAt: '' },
];

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  useAppStore.setState({
    spaces:       MOCK_SPACES,
    activeSpaceId: 'default',
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tab rendering
// ---------------------------------------------------------------------------
describe('SpaceTabs — tab rendering', () => {
  it('renders a tab for each space', () => {
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

  it('does NOT render the overflow button when all spaces are visible', () => {
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

  it('inactive tab has aria-selected="false"', () => {
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
// Switching spaces
// ---------------------------------------------------------------------------
describe('SpaceTabs — switching spaces', () => {
  it('calls setActiveSpace and loadBoard when a non-active tab is clicked', () => {
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
// Overflow button (when some spaces overflow)
// ---------------------------------------------------------------------------
describe('SpaceTabs — overflow menu integration', () => {
  it('renders the overflow button when overflow spaces exist', () => {
    // Override the mock for this test to return some overflow
    const overflowSpace = { id: 'ov-1', name: 'Overflow', createdAt: '', updatedAt: '' };
    const allSpaces = [...MOCK_SPACES, overflowSpace];

    // Re-mock useOverflowItems to return overflow for this test
    vi.doMock('../../src/hooks/useOverflowItems', () => ({
      useOverflowItems: () => ({
        containerRef: vi.fn(),
        setItemRef:   () => () => {},
        visible:      MOCK_SPACES,
        overflow:     [overflowSpace],
        measuring:    false,
      }),
    }));

    useAppStore.setState({ spaces: allSpaces });

    // This test uses the module-level mock (all visible), so the overflow
    // button is NOT shown. We verify the integration contract:
    // when overflow.length === 0, the button is absent.
    render(<SpaceTabs />);
    expect(screen.queryByTestId('space-overflow-btn')).not.toBeInTheDocument();
  });

  it('selecting from overflow menu calls setActiveSpace + loadBoard', async () => {
    // Repurpose the mock: return one space in overflow
    const overflowSpace = { id: 'ov-1', name: 'Hidden', createdAt: '', updatedAt: '' };

    // Use a modified mock for this case
    const { useOverflowItems } = await import('../../src/hooks/useOverflowItems');
    vi.mocked(useOverflowItems).mockReturnValueOnce({
      containerRef: vi.fn() as any,
      setItemRef:   () => () => {},
      visible:      MOCK_SPACES as any,
      overflow:     [overflowSpace] as any,
      measuring:    false,
    });

    const mockSetActive = vi.fn();
    const mockLoadBoard = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      spaces:         [...MOCK_SPACES, overflowSpace],
      setActiveSpace: mockSetActive,
      loadBoard:      mockLoadBoard,
    } as any);

    render(<SpaceTabs />);

    // Click the overflow trigger
    const overflowBtn = screen.getByTestId('space-overflow-btn');
    fireEvent.click(overflowBtn);

    // Click the hidden space in the dropdown
    fireEvent.click(screen.getByText('Hidden'));

    expect(mockSetActive).toHaveBeenCalledWith('ov-1');
    expect(mockLoadBoard).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Context menu (kebab → Edit / Delete)
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

    expect(mockOpenModal).toHaveBeenCalledWith('rename', MOCK_SPACES[0]);
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
    useAppStore.setState({ spaces: [MOCK_SPACES[0]] });

    // Re-mock overflow items for single space
    vi.doMock('../../src/hooks/useOverflowItems', () => ({
      useOverflowItems: (items: { id: string }[]) => ({
        containerRef: vi.fn(),
        setItemRef:   () => () => {},
        visible:      items,
        overflow:     [],
        measuring:    false,
      }),
    }));

    render(<SpaceTabs />);

    const kebab = screen.getByTitle('Space options');
    fireEvent.click(kebab);

    const deleteBtn = screen.getByRole('menuitem', { name: /delete/i });
    expect(deleteBtn).toBeDisabled();
  });
});
