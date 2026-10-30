import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditConflictDialog } from '../../src/components/modals/EditConflictDialog';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { Task } from '../../src/types';

const TASK = { id: 't1', key: 'WEB-1', title: 'T', type: 'chore', description: 'Start', createdAt: '', updatedAt: '' } as Task;
const conflictError = () => new api.ApiError('Bea changed it', 409, 'EDIT_CONFLICT', { field: 'description', theirs: 'From Bea', by: 'Bea Ruiz', at: new Date().toISOString() });

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    activeSpaceId: 's', tasks: { todo: [TASK] }, detailTask: TASK, editConflict: null, resumedEdit: null,
    showToast: vi.fn(), loadBoard: vi.fn().mockResolvedValue(undefined),
  } as never);
});

async function save() {
  await useAppStore.getState().updateTask('t1', { description: 'Mine', base: { description: 'Start' } });
}

describe('a conflict when saving', () => {
  it('shows both versions instead of an error, and undoes the change on the board', async () => {
    vi.spyOn(api, 'updateTask').mockRejectedValue(conflictError());
    const showToast = vi.fn();
    useAppStore.setState({ showToast } as never);
    render(<EditConflictDialog />);
    await save();
    expect(await screen.findByTestId('conflict-mine')).toHaveTextContent('Mine');
    expect(screen.getByTestId('conflict-theirs')).toHaveTextContent('From Bea');
    expect(screen.getByRole('heading')).toHaveTextContent('Bea Ruiz changed the description while you were editing');
    expect(showToast).not.toHaveBeenCalled();
    expect(useAppStore.getState().tasks.todo[0].description).toBe('Start');
  });

  it('does not put what it compares into the issue', async () => {
    const update = vi.spyOn(api, 'updateTask').mockResolvedValue({ ...TASK, description: 'Mine' });
    await save();
    expect(update).toHaveBeenCalledWith('s', 't1', { description: 'Mine', base: { description: 'Start' } });
    expect(useAppStore.getState().tasks.todo[0]).not.toHaveProperty('base');
  });

  it('other errors are still errors', async () => {
    vi.spyOn(api, 'updateTask').mockRejectedValue(new api.ApiError('Nope', 400, 'VALIDATION_ERROR'));
    const showToast = vi.fn();
    useAppStore.setState({ showToast } as never);
    await save();
    expect(showToast).toHaveBeenCalledWith('Failed to save: Nope', 'error');
    expect(useAppStore.getState().editConflict).toBeNull();
  });

  it('Save mine sends it again, from what is there now', async () => {
    const update = vi.spyOn(api, 'updateTask').mockRejectedValueOnce(conflictError()).mockResolvedValue({ ...TASK, description: 'Mine' });
    render(<EditConflictDialog />);
    await save();
    fireEvent.click(await screen.findByRole('button', { name: 'Save mine' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith('s', 't1', { description: 'Mine', base: { description: 'From Bea' } }));
    expect(useAppStore.getState().editConflict).toBeNull();
  });

  it('Use theirs saves nothing, and goes on from their text', async () => {
    const update = vi.spyOn(api, 'updateTask').mockRejectedValue(conflictError());
    render(<EditConflictDialog />);
    await save();
    fireEvent.click(await screen.findByRole('button', { name: 'Use theirs' }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().resumedEdit).toEqual({ taskId: 't1', field: 'description', text: 'From Bea', base: 'From Bea' });
  });

  it('Keep editing keeps their words, and reopens the issue if it closed', async () => {
    vi.spyOn(api, 'updateTask').mockRejectedValue(conflictError());
    render(<EditConflictDialog />);
    await save();
    useAppStore.setState({ detailTask: null } as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(useAppStore.getState().resumedEdit).toEqual({ taskId: 't1', field: 'description', text: 'Mine', base: 'From Bea' });
    expect(useAppStore.getState().detailTask?.id).toBe('t1');
  });
});
