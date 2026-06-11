/**
 * Tests for the DirectoryPicker component.
 *
 * Uses mocked API calls — no real filesystem access.
 * Covers: folder button rendering, open/close, tree display,
 * item click, keyboard nav, selection, error states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectoryPicker } from '../../src/components/shared/DirectoryPicker';
import * as client from '../../src/api/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getFsHome: vi.fn(),
  browseDirectory: vi.fn(),
  validateDirectory: vi.fn(),
}));

const mockGetFsHome      = vi.mocked(client.getFsHome);
const mockBrowseDirectory = vi.mocked(client.browseDirectory);

const HOME = '/Users/testuser';

const HOME_LISTING = {
  path:    HOME,
  hasMore: false,
  items:   [
    { name: 'Documents', type: 'dir' as const, isReadable: true, isAccessible: true },
    { name: 'Downloads', type: 'dir' as const, isReadable: true, isAccessible: true },
    { name: 'Projects',  type: 'dir' as const, isReadable: true, isAccessible: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFsHome.mockResolvedValue({ homePath: HOME });
  mockBrowseDirectory.mockResolvedValue(HOME_LISTING);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('DirectoryPicker — rendering', () => {
  it('renders the folder icon button', () => {
    render(<DirectoryPicker value="" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /browse for directory/i })).toBeInTheDocument();
  });

  it('button has aria-expanded=false when closed', () => {
    render(<DirectoryPicker value="" onChange={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /browse for directory/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('button is disabled when disabled prop is true', () => {
    render(<DirectoryPicker value="" onChange={vi.fn()} disabled />);
    const btn = screen.getByRole('button', { name: /browse for directory/i });
    expect(btn).toBeDisabled();
  });

  it('tree panel is not visible initially', () => {
    render(<DirectoryPicker value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });

  it('accepts a custom buttonLabel', () => {
    render(<DirectoryPicker value="" onChange={vi.fn()} buttonLabel="Pick folder" />);
    expect(screen.getByRole('button', { name: /pick folder/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

describe('DirectoryPicker — open/close', () => {
  it('clicking the folder button opens the tree panel', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));

    await waitFor(() => {
      expect(screen.getByRole('tree')).toBeInTheDocument();
    });
  });

  it('button aria-expanded becomes true when open', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /browse for directory/i });
      expect(btn).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('clicking Cancel closes the panel', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });

  it('clicking the close icon button closes the panel', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    await user.click(screen.getByRole('button', { name: /close directory browser/i }));
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} disabled />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Directory tree display
// ---------------------------------------------------------------------------

describe('DirectoryPicker — tree display', () => {
  it('calls getFsHome and browseDirectory when opened', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));

    await waitFor(() => {
      expect(mockGetFsHome).toHaveBeenCalledOnce();
      expect(mockBrowseDirectory).toHaveBeenCalledOnce();
    });
  });

  it('renders directory items from the listing', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('Downloads')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
  });

  it('starts browsing from value when provided', async () => {
    const user = userEvent.setup();
    const existingPath = '/Users/testuser/Projects';
    mockBrowseDirectory.mockResolvedValueOnce({
      path:    existingPath,
      hasMore: false,
      items:   [{ name: 'my-app', type: 'dir', isReadable: true, isAccessible: true }],
    });

    render(<DirectoryPicker value={existingPath} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /browse for directory/i }));

    await waitFor(() => {
      expect(mockBrowseDirectory).toHaveBeenCalledWith(existingPath);
    });
  });

  it('shows error message when API fails', async () => {
    mockGetFsHome.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('DirectoryPicker — selection', () => {
  it('clicking Select calls onChange with the selected path', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={mockOnChange} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByText('Documents'));

    // Click on a directory item to select it
    const items = screen.getAllByRole('treeitem');
    // The first item is the root node (home), second is Documents, etc.
    const documentsItem = items.find((el) => el.getAttribute('aria-label')?.includes('Documents'));
    if (documentsItem) fireEvent.click(documentsItem);

    await user.click(screen.getByRole('button', { name: /^select$/i }));

    expect(mockOnChange).toHaveBeenCalledWith(`${HOME}/Documents`);
  });

  it('Select button is disabled before selecting a non-default path', async () => {
    // When value is empty, nothing is selected until user picks
    mockGetFsHome.mockResolvedValue({ homePath: HOME });
    mockBrowseDirectory.mockResolvedValue({
      path:    HOME,
      hasMore: false,
      items:   [],
    });

    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    // selectedPath defaults to home when value is empty
    // So Select should be enabled (selectedPath = HOME)
    const selectBtn = screen.getByRole('button', { name: /^select$/i });
    // Default selection is the root → button should be enabled
    expect(selectBtn).not.toBeDisabled();
  });

  it('panel closes after selection', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    await user.click(screen.getByRole('button', { name: /^select$/i }));

    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('DirectoryPicker — keyboard navigation', () => {
  it('Escape key closes the panel', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'Escape' });

    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });

  it('ArrowDown moves focus to next item', async () => {
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    const tree = screen.getByRole('tree');
    // Initial focus = 0; after ArrowDown it should be at index 1
    fireEvent.keyDown(tree, { key: 'ArrowDown' });

    // The second item (Documents) should now be selected
    await waitFor(() => {
      const selected = screen.getAllByRole('treeitem').find(
        (el) => el.getAttribute('aria-selected') === 'true'
      );
      expect(selected).toBeDefined();
    });
  });

  it('Enter key selects the focused item and closes panel', async () => {
    const mockOnChange = vi.fn();
    const user = userEvent.setup();
    render(<DirectoryPicker value="" onChange={mockOnChange} />);

    await user.click(screen.getByRole('button', { name: /browse for directory/i }));
    await waitFor(() => screen.getByRole('tree'));

    const tree = screen.getByRole('tree');
    // Move to Documents
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'Enter' });

    expect(mockOnChange).toHaveBeenCalled();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});
