/**
 * EpicBar: filters the board to an epic, and opens the space's settings.
 * Runs against the real store, so that a chip is seen to change the filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('EpicBar', () => {
  it('has no chips when the board has no epics', () => {
    setTasks({ todo: [task('t1')] });
    render(<EpicBar />);
    expect(screen.getByTestId('epic-bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All epics' })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/epic-filter-chip-/)).toHaveLength(0);
  });

  it('shows All epics and a chip for each epic, and none for other issues', () => {
    setTasks({ todo: [task('e1', 'epic', 'Auth'), task('t1', 'feature', 'Not an epic')], done: [task('e2', 'epic', 'Loop')] });
    render(<EpicBar />);
    expect(screen.getByRole('button', { name: 'All epics' })).toBeInTheDocument();
    expect(screen.getByTestId('epic-filter-chip-E1')).toHaveTextContent('Auth');
    expect(screen.getByTestId('epic-filter-chip-E2')).toHaveTextContent('Loop');
    expect(screen.queryByRole('button', { name: 'Not an epic' })).not.toBeInTheDocument();
  });

  it('sorts the chips by title, across statuses', () => {
    setTasks({ todo: [task('e1', 'epic', 'Loop')], doing: [task('e2', 'epic', 'Auth')], done: [task('e3', 'epic', 'Quality')] });
    render(<EpicBar />);
    expect(screen.getAllByTestId(/epic-filter-chip-/).map((c) => c.textContent)).toEqual(['Auth', 'Loop', 'Quality']);
  });

  it('All epics is pressed with no filter', () => {
    setTasks({ todo: [task('e1', 'epic')] });
    render(<EpicBar />);
    expect(screen.getByRole('button', { name: 'All epics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('epic-filter-chip-E1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('the chip of the chosen epic is pressed, and All epics is not', () => {
    setTasks({ todo: [task('e1', 'epic'), task('e2', 'epic')] });
    useAppStore.setState({ epicFilter: 'e1' });
    render(<EpicBar />);
    expect(screen.getByTestId('epic-filter-chip-E1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('epic-filter-chip-E2')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'All epics' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a chip filters by the id of that epic', () => {
    setTasks({ todo: [task('e1', 'epic')] });
    render(<EpicBar />);
    fireEvent.click(screen.getByTestId('epic-filter-chip-E1'));
    expect(useAppStore.getState().epicFilter).toBe('e1');
  });

  it('clicking another chip changes the filter', () => {
    setTasks({ todo: [task('e1', 'epic'), task('e2', 'epic')] });
    useAppStore.setState({ epicFilter: 'e1' });
    render(<EpicBar />);
    fireEvent.click(screen.getByTestId('epic-filter-chip-E2'));
    expect(useAppStore.getState().epicFilter).toBe('e2');
  });

  it('clicking All epics clears the filter', () => {
    setTasks({ todo: [task('e1', 'epic')] });
    useAppStore.setState({ epicFilter: 'e1' });
    render(<EpicBar />);
    fireEvent.click(screen.getByRole('button', { name: 'All epics' }));
    expect(useAppStore.getState().epicFilter).toBeNull();
  });

  it('clicking the chip of the chosen epic turns the filter off', () => {
    setTasks({ todo: [task('e1', 'epic')] });
    useAppStore.setState({ epicFilter: 'e1' });
    render(<EpicBar />);
    fireEvent.click(screen.getByTestId('epic-filter-chip-E1'));
    expect(useAppStore.getState().epicFilter).toBeNull();
  });

  it('Space settings opens the settings of the active space', () => {
    render(<EpicBar />);
    fireEvent.click(screen.getByTestId('space-settings-button'));
    expect(useAppStore.getState().spaceModal).toEqual({ open: true, mode: 'rename', space: SPACE });
  });

  it('has no Space settings when no space is loaded', () => {
    useAppStore.setState({ spaces: [] });
    render(<EpicBar />);
    expect(screen.queryByTestId('space-settings-button')).not.toBeInTheDocument();
  });
});
