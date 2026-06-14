/**
 * T-013: DependsOnSection component tests.
 *
 * Tests the add/remove dependency flows, error toasts, empty state,
 * and search behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DependsOnSection } from '../DependsOnSection';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';

// ── Mock API client ───────────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
  updateTask: vi.fn(),
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
  createAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun: vi.fn().mockResolvedValue({}),
  getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  listRuns: vi.fn(),
  getRun: vi.fn(),
}));

const mockUpdateTask = vi.mocked(api.updateTask);
const mockApiFetch   = vi.mocked(api.apiFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPACE_ID = 'space-1';
const TASK_ID  = 'task-a';
const DEP_ID_1 = 'task-b';
const DEP_ID_2 = 'task-c';

function renderSection(props: {
  dependsOn?: string[];
  disabled?: boolean;
  onUpdated?: (deps: string[]) => void;
}) {
  return render(
    <DependsOnSection
      spaceId={SPACE_ID}
      taskId={TASK_ID}
      dependsOn={props.dependsOn ?? []}
      disabled={props.disabled ?? false}
      onUpdated={props.onUpdated ?? vi.fn()}
    />
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  useAppStore.setState({
    spaces: [],
    activeSpaceId: SPACE_ID,
    tasks: {
      todo:          [{ id: DEP_ID_1, title: 'Task B', type: 'feature', createdAt: '', updatedAt: '' }],
      'in-progress': [{ id: DEP_ID_2, title: 'Task C', type: 'bug',     createdAt: '', updatedAt: '' }],
      done:          [],
    },
    detailTask: null,
    isMutating: false,
    toastMessage: null,
  });

  // Default: updateTask succeeds
  mockUpdateTask.mockResolvedValue({
    id: TASK_ID, title: 'Task A', type: 'feature',
    dependsOn: [], createdAt: '', updatedAt: '',
  });

  // Default: apiFetch (search) returns empty results
  mockApiFetch.mockResolvedValue({ results: [], total: 0 });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DependsOnSection — rendering', () => {
  it('should_render_section_with_testid', () => {
    renderSection({});
    expect(screen.getByTestId('depends-on-section')).toBeInTheDocument();
  });

  it('should_show_empty_state_when_no_deps', () => {
    renderSection({ dependsOn: [] });
    expect(screen.getByText('No dependencies')).toBeInTheDocument();
  });

  it('should_render_dep_items_when_deps_present', () => {
    renderSection({ dependsOn: [DEP_ID_1] });
    expect(screen.getByTestId('dep-item')).toBeInTheDocument();
    // Title from store lookup
    expect(screen.getByText('Task B')).toBeInTheDocument();
  });

  it('should_show_column_pill_for_dep', () => {
    renderSection({ dependsOn: [DEP_ID_1] });
    // DEP_ID_1 is in 'todo'
    expect(screen.getByText('todo')).toBeInTheDocument();
  });

  it('should_show_column_pill_for_in_progress_dep', () => {
    renderSection({ dependsOn: [DEP_ID_2] });
    expect(screen.getByText('in progress')).toBeInTheDocument();
  });

  it('should_not_show_add_button_when_disabled', () => {
    renderSection({ disabled: true });
    expect(screen.queryByLabelText('Add dependency')).toBeNull();
  });

  it('should_show_add_button_when_not_disabled', () => {
    renderSection({ disabled: false });
    expect(screen.getByLabelText('Add dependency')).toBeInTheDocument();
  });
});

describe('DependsOnSection — remove flow', () => {
  it('should_call_updateTask_with_filtered_dependsOn_on_remove', async () => {
    const onUpdated = vi.fn();
    mockUpdateTask.mockResolvedValue({
      id: TASK_ID, title: 'Task A', type: 'feature',
      dependsOn: [], createdAt: '', updatedAt: '',
    });

    renderSection({ dependsOn: [DEP_ID_1], onUpdated });

    const removeBtn = screen.getByLabelText(`Remove dependency Task B`);
    await userEvent.click(removeBtn);

    expect(mockUpdateTask).toHaveBeenCalledWith(
      SPACE_ID, TASK_ID, { dependsOn: [] }
    );
  });

  it('should_call_onUpdated_after_successful_remove', async () => {
    const onUpdated = vi.fn();
    renderSection({ dependsOn: [DEP_ID_1, DEP_ID_2], onUpdated });

    const removeBtns = screen.getAllByTestId('remove-dep-btn');
    await userEvent.click(removeBtns[0]);

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith([DEP_ID_2]);
    });
  });
});

describe('DependsOnSection — add flow', () => {
  it('should_open_search_input_on_add_button_click', async () => {
    renderSection({});
    await userEvent.click(screen.getByLabelText('Add dependency'));
    expect(screen.getByTestId('dep-search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search tasks to add as dependency')).toBeInTheDocument();
  });

  it('should_query_api_on_search_input', async () => {
    mockApiFetch.mockResolvedValue({
      results: [{ id: DEP_ID_1, title: 'Task B', type: 'feature', createdAt: '', updatedAt: '' }],
      total: 1,
    });

    renderSection({ dependsOn: [] });
    await userEvent.click(screen.getByLabelText('Add dependency'));

    const input = screen.getByLabelText('Search tasks to add as dependency');
    await userEvent.type(input, 'Task');

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('should_show_search_results_after_typing', async () => {
    mockApiFetch.mockResolvedValue({
      results: [{ id: 'task-x', title: 'Task X', type: 'feature', createdAt: '', updatedAt: '' }],
      total: 1,
    });

    renderSection({ dependsOn: [] });
    await userEvent.click(screen.getByLabelText('Add dependency'));

    const input = screen.getByLabelText('Search tasks to add as dependency');
    fireEvent.change(input, { target: { value: 'Task' } });

    await waitFor(() => {
      expect(screen.queryAllByTestId('search-result-item').length).toBeGreaterThan(0);
    });
  });

  it('should_call_updateTask_with_merged_dependsOn_on_add', async () => {
    const onUpdated = vi.fn();
    mockApiFetch.mockResolvedValue({
      results: [{ id: 'task-x', title: 'Task X', type: 'feature', createdAt: '', updatedAt: '' }],
      total: 1,
    });
    mockUpdateTask.mockResolvedValue({
      id: TASK_ID, title: 'Task A', type: 'feature',
      dependsOn: [DEP_ID_1, 'task-x'], createdAt: '', updatedAt: '',
    });

    renderSection({ dependsOn: [DEP_ID_1], onUpdated });

    await userEvent.click(screen.getByLabelText('Add dependency'));
    const input = screen.getByLabelText('Search tasks to add as dependency');
    fireEvent.change(input, { target: { value: 'Task' } });

    await waitFor(() => {
      expect(screen.queryAllByTestId('search-result-item').length).toBeGreaterThan(0);
    });

    const firstResult = screen.getAllByTestId('search-result-item')[0];
    await userEvent.click(firstResult);

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(
        SPACE_ID, TASK_ID, { dependsOn: [DEP_ID_1, 'task-x'] }
      );
    });
  });

  it('should_close_search_on_escape', async () => {
    renderSection({});
    await userEvent.click(screen.getByLabelText('Add dependency'));
    expect(screen.getByTestId('dep-search')).toBeInTheDocument();

    const input = screen.getByLabelText('Search tasks to add as dependency');
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('dep-search')).toBeNull();
    });
  });
});

describe('DependsOnSection — error handling', () => {
  it('should_show_toast_on_409_CYCLE_DETECTED', async () => {
    mockApiFetch.mockResolvedValue({
      results: [{ id: 'task-x', title: 'Task X', type: 'feature', createdAt: '', updatedAt: '' }],
      total: 1,
    });

    const cycleError = Object.assign(new Error('Cycle detected'), { code: 'CYCLE_DETECTED' });
    mockUpdateTask.mockRejectedValue(cycleError);

    const showToastFn = vi.fn();
    useAppStore.setState({ showToast: showToastFn } as Parameters<typeof useAppStore.setState>[0]);

    renderSection({ dependsOn: [] });
    await userEvent.click(screen.getByLabelText('Add dependency'));

    const input = screen.getByLabelText('Search tasks to add as dependency');
    fireEvent.change(input, { target: { value: 'Task' } });

    await waitFor(() => {
      expect(screen.queryAllByTestId('search-result-item').length).toBeGreaterThan(0);
    });

    const firstResult = screen.getAllByTestId('search-result-item')[0];
    await userEvent.click(firstResult);

    await waitFor(() => {
      expect(showToastFn).toHaveBeenCalledWith(
        expect.stringContaining('circular dependency'),
        'error'
      );
    });
  });

  it('should_show_toast_on_422_DEPENDENCY_NOT_FOUND', async () => {
    mockApiFetch.mockResolvedValue({
      results: [{ id: 'task-gone', title: 'Task Gone', type: 'feature', createdAt: '', updatedAt: '' }],
      total: 1,
    });

    const notFoundError = Object.assign(new Error('Not found'), { code: 'DEPENDENCY_NOT_FOUND' });
    mockUpdateTask.mockRejectedValue(notFoundError);

    const showToastFn = vi.fn();
    useAppStore.setState({ showToast: showToastFn } as Parameters<typeof useAppStore.setState>[0]);

    renderSection({ dependsOn: [] });
    await userEvent.click(screen.getByLabelText('Add dependency'));

    const input = screen.getByLabelText('Search tasks to add as dependency');
    fireEvent.change(input, { target: { value: 'Gone' } });

    await waitFor(() => {
      expect(screen.queryAllByTestId('search-result-item').length).toBeGreaterThan(0);
    });

    const firstResult = screen.getAllByTestId('search-result-item')[0];
    await userEvent.click(firstResult);

    await waitFor(() => {
      expect(showToastFn).toHaveBeenCalledWith(
        expect.stringContaining('not found in this space'),
        'error'
      );
    });
  });
});
