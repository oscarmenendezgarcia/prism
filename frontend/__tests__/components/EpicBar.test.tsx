/**
 * EpicBar: filters the board to an epic, and opens the space's settings.
 * Runs against the real store, so that the filter is seen to change the filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { EpicBar } from '../../src/components/board/EpicBar';
import { useAppStore } from '../../src/stores/useAppStore';
import type { Task } from '../../src/types';

vi.mock('../../src/api/client', () => ({ getSpaces: vi.fn(), getTasks: vi.fn() }));

const SPACE = { id: 's1', name: 'Space', createdAt: '', updatedAt: '' };

const task = (id: string, type: Task['type'] = 'feature', title = id): Task => (
  { id, key: id.toUpperCase(), title, type, createdAt: '', updatedAt: '' }
);

function setTasks(tasks: Record<string, Task[]>) {
  useAppStore.setState({ tasks });
}

beforeEach(() => {
  useAppStore.setState({ tasks: {}, epicFilter: null, spaces: [SPACE], activeSpaceId: 's1', spaceModal: null });
});

const filter = () => screen.getByLabelText('Filter by epic') as HTMLSelectElement;
const options = () => [...filter().options].map((o) => o.textContent);

describe('EpicBar', () => {
  it('has no filter when the board has no epics', () => {
    setTasks({ todo: [task('t1')] });
    render(<EpicBar />);
    expect(screen.getByTestId('epic-bar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by epic')).not.toBeInTheDocument();
  });

  it('offers All epics and each epic, sorted across statuses, and no other issue', () => {
    setTasks({ todo: [task('e1', 'epic', 'Loop'), task('t1', 'feature', 'Not an epic')], doing: [task('e2', 'epic', 'Auth')], done: [task('e3', 'epic', 'Quality')] });
    render(<EpicBar />);
    expect(options()).toEqual(['All epics', 'Auth', 'Loop', 'Quality']);
  });

  it('shows the chosen epic, and marks that a filter is on', () => {
    setTasks({ todo: [task('e1', 'epic'), task('e2', 'epic')] });
    const { rerender } = render(<EpicBar />);
    expect(filter().value).toBe('');
    expect(filter()).not.toHaveClass('text-primary');
    act(() => useAppStore.setState({ epicFilter: 'e1' }));
    rerender(<EpicBar />);
    expect(filter().value).toBe('e1');
    expect(filter()).toHaveClass('text-primary');
  });

  it('choosing an epic filters by its id', () => {
    setTasks({ todo: [task('e1', 'epic')] });
    render(<EpicBar />);
    fireEvent.change(filter(), { target: { value: 'e1' } });
    expect(useAppStore.getState().epicFilter).toBe('e1');
  });

  it('choosing All epics clears the filter', () => {
    setTasks({ todo: [task('e1', 'epic')] });
    useAppStore.setState({ epicFilter: 'e1' });
    render(<EpicBar />);
    fireEvent.change(filter(), { target: { value: '' } });
    expect(useAppStore.getState().epicFilter).toBeNull();
  });

  it('Space settings opens the settings of the active space', () => {
    render(<EpicBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Space settings' }));
    expect(useAppStore.getState().spaceModal).toEqual({ open: true, mode: 'rename', space: SPACE });
  });

  it('has no Space settings when no space is loaded', () => {
    useAppStore.setState({ spaces: [] });
    render(<EpicBar />);
    expect(screen.queryByTestId('space-settings-button')).not.toBeInTheDocument();
  });
});
