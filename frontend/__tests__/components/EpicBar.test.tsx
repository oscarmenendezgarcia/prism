/**
 * EpicBar: filters the board to an epic, and opens the space's settings.
 * Runs against the real store, so that the filter is seen to change the filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { EpicBar } from '../../src/components/board/EpicBar';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { BoardEpic } from '../../src/types';

vi.mock('../../src/api/client', () => ({ getSpaces: vi.fn(), getBoard: vi.fn().mockResolvedValue(null) }));

const SPACE = { id: 's1', name: 'Space', createdAt: '', updatedAt: '' };

const epic = (id: string, title = id): BoardEpic => (
  { id, key: id.toUpperCase(), title, statusId: 'todo', category: 'todo', done: 0, total: 0 }
);

function setEpics(epics: BoardEpic[]) {
  useAppStore.setState({ epics });
}

beforeEach(() => {
  useAppStore.setState({ tasks: {}, epics: [], epicFilter: null, spaces: [SPACE], activeSpaceId: 's1', spaceModal: null });
});

const filter = () => screen.getByLabelText('Filter by epic') as HTMLSelectElement;
const options = () => [...filter().options].map((o) => o.textContent);

describe('EpicBar', () => {
  it('has no filter when the board has no epics', () => {
    setEpics([]);
    render(<EpicBar />);
    expect(screen.getByTestId('epic-bar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by epic')).not.toBeInTheDocument();
  });

  it('offers All epics and each epic, sorted, loaded on the board or not', () => {
    setEpics([epic('e1', 'Loop'), epic('e2', 'Auth'), epic('e3', 'Quality')]);
    render(<EpicBar />);
    expect(options()).toEqual(['All epics', 'Auth', 'Loop', 'Quality']);
  });

  it('shows the chosen epic, and marks that a filter is on', () => {
    setEpics([epic('e1'), epic('e2')]);
    const { rerender } = render(<EpicBar />);
    expect(filter().value).toBe('');
    expect(filter()).not.toHaveClass('text-primary');
    act(() => useAppStore.setState({ epicFilter: 'e1' }));
    rerender(<EpicBar />);
    expect(filter().value).toBe('e1');
    expect(filter()).toHaveClass('text-primary');
  });

  it('choosing an epic filters by its id', () => {
    setEpics([epic('e1')]);
    render(<EpicBar />);
    fireEvent.change(filter(), { target: { value: 'e1' } });
    expect(useAppStore.getState().epicFilter).toBe('e1');
  });

  it('choosing All epics clears the filter', () => {
    setEpics([epic('e1')]);
    useAppStore.setState({ epicFilter: 'e1' });
    render(<EpicBar />);
    fireEvent.change(filter(), { target: { value: '' } });
    expect(useAppStore.getState().epicFilter).toBeNull();
  });

  it('asks the server for what is in the epic, and for all of it again', () => {
    setEpics([epic('e1')]);
    render(<EpicBar />);
    fireEvent.change(filter(), { target: { value: 'e1' } });
    expect(vi.mocked(api.getBoard).mock.lastCall?.[1]).toMatchObject({ epic: 'e1' });
    fireEvent.change(filter(), { target: { value: '' } });
    expect(vi.mocked(api.getBoard).mock.lastCall?.[1]).toMatchObject({ epic: null });
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
