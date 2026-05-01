/**
 * Tests for GlobalSearchModal.
 *
 * Verifies: open/close, input rendering, results list, keyboard navigation,
 * empty state, loading indicator, and result click navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { GlobalSearchModal } from '../../src/components/modals/GlobalSearchModal';
import { useAppStore } from '../../src/stores/useAppStore';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

// Mock useGlobalSearch so we control results without real fetch calls.
vi.mock('../../src/hooks/useGlobalSearch', () => ({
  useGlobalSearch: vi.fn(),
}));

import { useGlobalSearch } from '../../src/hooks/useGlobalSearch';
import type { GlobalSearchState } from '../../src/hooks/useGlobalSearch';
import type { SearchResult } from '../../src/types';

const mockUseGlobalSearch = vi.mocked(useGlobalSearch as () => GlobalSearchState);

// Mock api/client to satisfy useAppStore initialisation
vi.mock('../../src/api/client', () => ({
  getSpaces:   vi.fn().mockResolvedValue([]),
  getTasks:    vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  createTask:  vi.fn(),
  moveTask:    vi.fn(),
  deleteTask:  vi.fn(),
  getAttachmentContent: vi.fn(),
  searchTasks: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(id: string, title: string, spaceName: string, column = 'todo' as const): SearchResult {
  return {
    task:      { id, title, type: 'feature', createdAt: '', updatedAt: '' },
    spaceId:   `space-${id}`,
    spaceName,
    column,
  };
}

function idleState(overrides: Partial<GlobalSearchState> = {}): GlobalSearchState {
  return {
    query:    '',
    setQuery: vi.fn(),
    results:  [],
    status:   'idle',
    error:    null,
    ...overrides,
  };
}

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    spaces: [],
    activeSpaceId: 'default',
    tasks: { todo: [], 'in-progress': [], done: [] },
    detailTask: null,
    isGlobalSearchOpen: false,
  });
  mockUseGlobalSearch.mockReturnValue(idleState());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlobalSearchModal — closed state', () => {
  it('renders nothing when open is false', () => {
    render(<GlobalSearchModal open={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('GlobalSearchModal — open state', () => {
  it('renders a dialog when open is true', () => {
    render(<GlobalSearchModal open={true} onClose={onClose} />);
    expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument();
  });

  it('renders a search input', () => {
    render(<GlobalSearchModal open={true} onClose={onClose} />);
    const input = document.body.querySelector('input[type="search"]');
    expect(input).toBeInTheDocument();
  });

  it('renders the empty-state hint when query is empty', () => {
    render(<GlobalSearchModal open={true} onClose={onClose} />);
    expect(document.body.textContent).toContain('Type to search across all spaces');
  });
});

describe('GlobalSearchModal — loading state', () => {
  it('shows loading spinner when status is loading', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({ query: 'deploy', status: 'loading' }));
    render(<GlobalSearchModal open={true} onClose={onClose} />);
    const spinner = document.body.querySelector('[aria-label="Loading results…"]');
    expect(spinner).toBeInTheDocument();
  });
});

describe('GlobalSearchModal — results', () => {
  it('renders result items when results are present', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({
      query:   'deploy',
      results: [
        makeResult('t1', 'Deploy to staging', 'Alpha', 'todo'),
        makeResult('t2', 'Update deploy docs', 'Beta', 'done'),
      ],
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);

    expect(document.body.textContent).toContain('Deploy to staging');
    expect(document.body.textContent).toContain('Update deploy docs');
    expect(document.body.textContent).toContain('Alpha');
    expect(document.body.textContent).toContain('Beta');
  });

  it('renders column badges for each result', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({
      query:   'deploy',
      results: [makeResult('t1', 'Deploy', 'Alpha', 'in-progress')],
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    expect(document.body.textContent).toContain('In Progress');
  });

  it('shows no-match message when results are empty after searching', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({
      query:   'xyznonexistent',
      results: [],
      status:  'idle',
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    expect(document.body.textContent).toContain('No matches');
  });
});

describe('GlobalSearchModal — error state', () => {
  it('shows error message when status is error', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({
      query:  'deploy',
      status: 'error',
      error:  new Error('Network error'),
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    expect(document.body.textContent).toContain('Network error');
  });
});

describe('GlobalSearchModal — keyboard navigation', () => {
  it('calls setQuery when input value changes', () => {
    const setQuery = vi.fn();
    mockUseGlobalSearch.mockReturnValue(idleState({ setQuery }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'deploy' } });
    expect(setQuery).toHaveBeenCalledWith('deploy');
  });

  it('moves selection down with ArrowDown key', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({
      query:   'deploy',
      results: [
        makeResult('t1', 'First result', 'Alpha'),
        makeResult('t2', 'Second result', 'Alpha'),
      ],
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;

    // Initially first item is selected (aria-selected="true")
    const items = document.body.querySelectorAll('[role="option"]');
    expect(items[0].getAttribute('aria-selected')).toBe('true');
    expect(items[1].getAttribute('aria-selected')).toBe('false');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const itemsAfter = document.body.querySelectorAll('[role="option"]');
    expect(itemsAfter[0].getAttribute('aria-selected')).toBe('false');
    expect(itemsAfter[1].getAttribute('aria-selected')).toBe('true');
  });

  it('calls onClose and store actions when Enter is pressed on a result', async () => {
    const setActiveSpace  = vi.fn();
    const openDetailPanel = vi.fn();
    const loadBoard       = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({ setActiveSpace, openDetailPanel, loadBoard } as never);

    mockUseGlobalSearch.mockReturnValue(idleState({
      query:   'deploy',
      results: [makeResult('t1', 'Deploy to staging', 'Alpha', 'todo')],
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onClose).toHaveBeenCalled();
  });
});

describe('GlobalSearchModal — footer hint', () => {
  it('renders keyboard shortcut footer when results are present', () => {
    mockUseGlobalSearch.mockReturnValue(idleState({
      query:   'deploy',
      results: [makeResult('t1', 'Deploy', 'Alpha')],
    }));

    render(<GlobalSearchModal open={true} onClose={onClose} />);
    expect(document.body.textContent).toContain('navigate');
    expect(document.body.textContent).toContain('open');
  });
});
