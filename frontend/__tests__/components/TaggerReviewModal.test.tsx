import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaggerReviewModal } from '../../src/components/modals/TaggerReviewModal';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { TaggerSuggestion } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock API client (no real fetch)
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:    vi.fn(),
  getTasks:     vi.fn(),
  createTask:   vi.fn(),
  moveTask:     vi.fn(),
  deleteTask:   vi.fn(),
  updateTask:   vi.fn(),
  createSpace:  vi.fn(),
  renameSpace:  vi.fn(),
  deleteSpace:  vi.fn(),
  runTagger:    vi.fn(),
  getAttachmentContent: vi.fn(),
}));

const mockUpdateTask = vi.mocked(api.updateTask);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HIGH_BUG: TaggerSuggestion = {
  id:           'task-1',
  title:        'Fix login redirect loop',
  currentType:  'chore',
  inferredType: 'bug',
  confidence:   'high',
};

const HIGH_FEATURE: TaggerSuggestion = {
  id:           'task-2',
  title:        'Add dark mode toggle',
  currentType:  'chore',
  inferredType: 'feature',
  confidence:   'high',
};

const LOW_DEBT: TaggerSuggestion = {
  id:           'task-3',
  title:        'Update README',
  currentType:  'chore',
  inferredType: 'tech-debt',
  confidence:   'low',
};

const WITH_DESCRIPTION: TaggerSuggestion = {
  id:           'task-4',
  title:        'Refactor DB layer',
  currentType:  'chore',
  inferredType: 'tech-debt',
  confidence:   'medium',
  description:  'Migrate queries to async/await and add connection pooling.',
};

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function openModal(suggestions: TaggerSuggestion[]) {
  useAppStore.setState({
    taggerLoading:     false,
    taggerSuggestions: suggestions,
    taggerModalOpen:   true,
    taggerError:       null,
    activeSpaceId:     'space-1',
    // Minimal board state required by loadBoard (not called in these tests)
    tasks:             { todo: [], 'in-progress': [], done: [] },
  } as Partial<ReturnType<typeof useAppStore.getState>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    taggerLoading:     false,
    taggerSuggestions: [],
    taggerModalOpen:   false,
    taggerError:       null,
  } as Partial<ReturnType<typeof useAppStore.getState>>);
});

// ---------------------------------------------------------------------------
// T-011-1: renders all suggestions
// ---------------------------------------------------------------------------

describe('TaggerReviewModal — renders suggestions', () => {
  it('does not render when modal is closed', () => {
    render(<TaggerReviewModal />);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders all suggestion rows when modal is open', () => {
    openModal([HIGH_BUG, HIGH_FEATURE, LOW_DEBT]);
    render(<TaggerReviewModal />);

    expect(document.body).toHaveTextContent('Fix login redirect loop');
    expect(document.body).toHaveTextContent('Add dark mode toggle');
    expect(document.body).toHaveTextContent('Update README');
  });

  it('shows current type and inferred type badges for each row', () => {
    openModal([HIGH_BUG]);
    render(<TaggerReviewModal />);

    // Both 'chore' (current) and 'bug' (inferred) should appear
    const badges = document.body.querySelectorAll('span.rounded-full');
    const texts = Array.from(badges).map((b) => b.textContent?.trim());
    expect(texts).toContain('chore');
    expect(texts).toContain('bug');
  });

  it('shows description diff when description is present', () => {
    openModal([WITH_DESCRIPTION]);
    render(<TaggerReviewModal />);
    expect(document.body).toHaveTextContent('Migrate queries to async/await');
  });

  it('shows empty state when suggestions array is empty', () => {
    openModal([]);
    render(<TaggerReviewModal />);
    expect(document.body).toHaveTextContent('No suggestions');
  });
});

// ---------------------------------------------------------------------------
// T-011-2: accept/reject toggle
// ---------------------------------------------------------------------------

describe('TaggerReviewModal — accept/reject toggle', () => {
  it('starts HIGH confidence rows as accepted (toggle on)', () => {
    openModal([HIGH_BUG]);
    render(<TaggerReviewModal />);

    const toggle = document.body.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-checked')).toBe('true');
  });

  it('starts LOW confidence rows as rejected (toggle off)', () => {
    openModal([LOW_DEBT]);
    render(<TaggerReviewModal />);

    const toggle = document.body.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles acceptance state when switch is clicked', () => {
    openModal([HIGH_BUG]);
    render(<TaggerReviewModal />);

    const toggle = document.body.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// T-011-3: Apply button count updates when rows are toggled
// ---------------------------------------------------------------------------

describe('TaggerReviewModal — Apply count updates', () => {
  it('shows "Apply selected (2)" with two HIGH rows', () => {
    openModal([HIGH_BUG, HIGH_FEATURE]);
    render(<TaggerReviewModal />);
    expect(document.body).toHaveTextContent('Apply selected (2)');
  });

  it('decrements count when a row is rejected', () => {
    openModal([HIGH_BUG, HIGH_FEATURE]);
    render(<TaggerReviewModal />);

    const toggles = document.body.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    fireEvent.click(toggles[0]); // reject first row

    expect(document.body).toHaveTextContent('Apply selected (1)');
  });

  it('shows "Apply selected (0)" when all rows are rejected', () => {
    openModal([HIGH_BUG]);
    render(<TaggerReviewModal />);

    const toggle = document.body.querySelector<HTMLButtonElement>('[role="switch"]')!;
    fireEvent.click(toggle);

    expect(document.body).toHaveTextContent('Apply selected (0)');
  });

  it('does not count LOW confidence row (starts rejected)', () => {
    openModal([HIGH_BUG, LOW_DEBT]);
    render(<TaggerReviewModal />);
    // Only HIGH_BUG starts accepted → count = 1
    expect(document.body).toHaveTextContent('Apply selected (1)');
  });
});

// ---------------------------------------------------------------------------
// T-011-4: Apply calls updateTask for each accepted row
// ---------------------------------------------------------------------------

describe('TaggerReviewModal — Apply calls updateTask', () => {
  it('calls updateTask for each accepted suggestion on Apply', async () => {
    mockUpdateTask.mockResolvedValue({} as ReturnType<typeof mockUpdateTask> extends Promise<infer T> ? T : never);

    // Also stub loadBoard since it's called after apply
    useAppStore.setState({
      loadBoard: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    } as unknown as Partial<ReturnType<typeof useAppStore.getState>>);

    openModal([HIGH_BUG, HIGH_FEATURE]);
    render(<TaggerReviewModal />);

    const applyBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button')
    ).find((b) => b.textContent?.includes('Apply selected'));

    expect(applyBtn).toBeTruthy();
    fireEvent.click(applyBtn!);

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(2);
    });

    expect(mockUpdateTask).toHaveBeenCalledWith('space-1', 'task-1', { type: 'bug' });
    expect(mockUpdateTask).toHaveBeenCalledWith('space-1', 'task-2', { type: 'feature' });
  });

  it('does not call updateTask for rejected rows', async () => {
    mockUpdateTask.mockResolvedValue({} as ReturnType<typeof mockUpdateTask> extends Promise<infer T> ? T : never);

    useAppStore.setState({
      loadBoard: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    } as unknown as Partial<ReturnType<typeof useAppStore.getState>>);

    openModal([HIGH_BUG, HIGH_FEATURE]);
    render(<TaggerReviewModal />);

    // Reject the first row
    const toggles = document.body.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    fireEvent.click(toggles[0]);

    const applyBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button')
    ).find((b) => b.textContent?.includes('Apply selected'))!;

    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateTask).toHaveBeenCalledWith('space-1', 'task-2', { type: 'feature' });
    expect(mockUpdateTask).not.toHaveBeenCalledWith('space-1', 'task-1', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// T-011-5: Cancel closes without API calls
// ---------------------------------------------------------------------------

describe('TaggerReviewModal — Cancel', () => {
  it('closes the modal on Cancel without making API calls', () => {
    openModal([HIGH_BUG, HIGH_FEATURE]);
    render(<TaggerReviewModal />);

    // Modal should be open
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    const cancelBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button')
    ).find((b) => b.textContent?.trim() === 'Cancel')!;

    fireEvent.click(cancelBtn);

    expect(mockUpdateTask).not.toHaveBeenCalled();
    // Store should be reset
    expect(useAppStore.getState().taggerModalOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-011-6: Empty suggestions message
// ---------------------------------------------------------------------------

describe('TaggerReviewModal — empty suggestions', () => {
  it('shows a friendly empty state when there are no suggestions', () => {
    openModal([]);
    render(<TaggerReviewModal />);

    expect(document.body).toHaveTextContent('No suggestions');
    // Apply button should not be present (footer hidden)
    const applyBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button')
    ).find((b) => b.textContent?.includes('Apply selected'));

    expect(applyBtn).toBeUndefined();
  });
});
