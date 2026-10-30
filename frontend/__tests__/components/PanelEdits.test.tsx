/**
 * What someone is writing in an issue, against what arrives while they do: the real panel and
 * store, with only the server replaced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskDetailPanel } from '../../src/components/board/TaskDetailPanel';
import { EditConflictDialog } from '../../src/components/modals/EditConflictDialog';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { Task } from '../../src/types';

const TASK = { id: 't1', key: 'WEB-1', title: 'Title', type: 'chore', description: 'Start', statusId: 'todo', category: 'todo', createdAt: '', updatedAt: '' } as Task;

const arrives = (over: Partial<Task>) => act(() => {
  useAppStore.setState({ tasks: { todo: [{ ...TASK, ...over }] } } as never);
});

function setup() {
  useAppStore.setState({
    activeSpaceId: 's', tasks: { todo: [TASK] }, detailTask: TASK, editConflict: null, conflictQueue: [], resumedEdit: null,
    mutatingTaskIds: new Set(), spaces: [{ id: 's', name: 'S', createdAt: '', updatedAt: '' }],
    showToast: vi.fn(), loadBoard: vi.fn().mockResolvedValue(undefined),
  } as never);
  render(<><TaskDetailPanel /><EditConflictDialog /></>);
}

const description = () => screen.getByLabelText(/^description$/i) as HTMLTextAreaElement;
const title = () => screen.getByLabelText(/issue title/i) as HTMLTextAreaElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const conflict = (theirs: string) => new api.ApiError('x', 409, 'EDIT_CONFLICT', { field: 'description', theirs, by: 'Bea', at: null });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'updateTask').mockImplementation(async (_s, _t, { base: _b, ...patch }) => ({ ...TASK, ...patch } as Task));
  vi.spyOn(api, 'getUsers').mockResolvedValue([]);
  vi.spyOn(api, 'getTaskRuns').mockResolvedValue({});
});

describe('what arrives while the panel is open', () => {
  it('shows in a field nobody has touched, even with focus in it', () => {
    setup();
    description().focus();
    arrives({ description: 'From Bea', title: 'New title' });
    expect(description().value).toBe('From Bea');
    expect(title().value).toBe('New title');
  });

  it('leaves alone a field with unsaved text, with or without focus', () => {
    setup();
    type(description(), 'Mine');
    arrives({ description: 'From Bea' });
    expect(description().value).toBe('Mine');
    description().blur();
    arrives({ description: 'From Bea again' });
    expect(description().value).toBe('Mine');
  });

  it('then saving tells them, from what the edit began with', async () => {
    setup();
    type(description(), 'Mine');
    arrives({ description: 'From Bea' });
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({ description: 'Mine', base: { description: 'Start' } })));
  });

  it('from what is there now, if it arrived before they typed', async () => {
    setup();
    arrives({ description: 'From Bea' });
    type(description(), 'Mine');
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({ base: { description: 'From Bea' } })));
  });
});

describe('saving', () => {
  it('sends nothing if nothing was written, whatever arrived', () => {
    setup();
    arrives({ description: 'From Bea' });
    fireEvent.focus(description());
    fireEvent.blur(description());
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('going back to the old text or clearing it counts as writing', async () => {
    setup();
    arrives({ description: 'From Bea' });
    type(description(), 'Start');
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({ description: 'Start' })));
    vi.mocked(api.updateTask).mockClear();
    await waitFor(() => expect(useAppStore.getState().tasks.todo[0].description).toBe('Start'));
    type(description(), '');
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({ description: '' })));
  });

  it('a save that fails keeps the text, says so, and can be tried again', async () => {
    const showToast = vi.fn();
    vi.mocked(api.updateTask).mockRejectedValueOnce(new api.ApiError('Too long', 400, 'VALIDATION_ERROR'));
    setup();
    useAppStore.setState({ showToast } as never);
    type(description(), 'Mine');
    fireEvent.blur(description());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save: Too long', 'error'));
    expect(description().value).toBe('Mine');
    expect(useAppStore.getState().tasks.todo[0].description).toBe('Start');
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.updateTask).mock.calls[1][2]).toMatchObject({ base: { description: 'Start' } });
  });

  it('closing saves what a failed save left, wherever the focus is', async () => {
    vi.mocked(api.updateTask).mockRejectedValueOnce(new Error('Network'));
    setup();
    type(description(), 'Mine');
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAppStore.getState().mutatingTaskIds.size).toBe(0));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(2));
  });

  it('after it saves, more typing starts from that', async () => {
    setup();
    type(description(), 'One');
    fireEvent.blur(description());
    await waitFor(() => expect(useAppStore.getState().tasks.todo[0].description).toBe('One'));
    await waitFor(() => expect(useAppStore.getState().mutatingTaskIds.size).toBe(0));
    type(description(), 'Two');
    fireEvent.blur(description());
    await waitFor(() => expect(vi.mocked(api.updateTask).mock.calls[1]?.[2]).toMatchObject({ description: 'Two', base: { description: 'One' } }));
  });
});

describe('after a conflict', () => {
  async function conflictOver() {
    vi.mocked(api.updateTask).mockRejectedValueOnce(conflict('From Bea'));
    setup();
    type(description(), 'Mine');
    fireEvent.blur(description());
    await screen.findByTestId('edit-conflict');
    arrives({ description: 'From Bea' });
    await waitFor(() => expect(useAppStore.getState().mutatingTaskIds.size).toBe(0));
  }

  it('their text stays in the field while they choose', async () => {
    await conflictOver();
    expect(description().value).toBe('Mine');
  });

  it('Keep editing: protected from what arrives, and saving asks again rather than overwrite', async () => {
    await conflictOver();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(useAppStore.getState().resumedEdit).toBeNull());
    arrives({ description: 'From a third' });
    expect(description().value).toBe('Mine');
    vi.mocked(api.updateTask).mockClear();
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({ description: 'Mine', base: { description: 'Start' } })));
  });

  it('Use theirs: their text, with nothing to save', async () => {
    await conflictOver();
    vi.mocked(api.updateTask).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Use theirs' }));
    await waitFor(() => expect(description().value).toBe('From Bea'));
    fireEvent.blur(description());
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('Save mine that fails asks again, and keeps the text', async () => {
    await conflictOver();
    vi.mocked(api.updateTask).mockRejectedValueOnce(new api.ApiError('No', 403, 'FORBIDDEN'));
    fireEvent.click(screen.getByRole('button', { name: 'Save mine' }));
    await waitFor(() => expect(useAppStore.getState().editConflict).not.toBeNull());
    await screen.findByTestId('edit-conflict');
    expect(screen.getByTestId('conflict-mine')).toHaveTextContent('Mine');
  });

  it('a second conflict waits for the first, and none is lost', async () => {
    vi.mocked(api.updateTask)
      .mockRejectedValueOnce(conflict('From Bea'))
      .mockRejectedValueOnce(new api.ApiError('x', 409, 'EDIT_CONFLICT', { field: 'title', theirs: 'Title by Bea', by: 'Bea', at: null }));
    setup();
    await useAppStore.getState().updateTask('t1', { description: 'Mine', base: { description: 'Start' } });
    await useAppStore.getState().updateTask('t1', { title: 'My title', base: { title: 'Title' } });
    expect(useAppStore.getState().editConflict?.field).toBe('description');
    fireEvent.click(await screen.findByRole('button', { name: 'Use theirs' }));
    expect(useAppStore.getState().editConflict?.field).toBe('title');
    expect(useAppStore.getState().editConflict?.mine).toBe('My title');
  });
});

describe('a board read before a save', () => {
  it('does not undo it on the screen when it lands after', async () => {
    let answer: (data: unknown) => void = () => {};
    vi.spyOn(api, 'getTasks').mockImplementation(() => new Promise((resolve) => { answer = resolve as never; }));
    useAppStore.setState({ activeSpaceId: 's', tasks: { todo: [TASK] }, detailTask: null, mutatingTaskIds: new Set(), showToast: vi.fn() } as never);
    const poll = useAppStore.getState().loadBoard();
    await useAppStore.getState().updateTask('t1', { description: 'Mine' });
    answer({ todo: [TASK] });
    await poll;
    expect(useAppStore.getState().tasks.todo[0].description).toBe('Mine');
  });
});
