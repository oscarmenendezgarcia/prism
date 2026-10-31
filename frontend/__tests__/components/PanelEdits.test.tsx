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
import { boardAnswer } from '../helpers/board';

const TASK = { id: 't1', key: 'WEB-1', title: 'Title', type: 'chore', description: 'Start', statusId: 'todo', category: 'todo', createdAt: '', updatedAt: '' } as Task;

/** The whole issue as the panel's refresh brings it, with the change someone else made. */
const arrives = (over: Partial<Task>) => act(() => {
  useAppStore.setState({ detailTask: { ...useAppStore.getState().detailTask, ...over }, tasks: { todo: [{ ...TASK, ...over }] } } as never);
});

function setup() {
  useAppStore.setState({
    activeSpaceId: 's', tasks: { todo: [TASK] }, detailTask: TASK, detailLoaded: true, editConflict: null, conflictQueue: [], resumedEdit: null,
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
  vi.spyOn(api, 'getTaskForPanel').mockResolvedValue(null);
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
    vi.spyOn(api, 'getBoard').mockImplementation(() => new Promise((resolve) => { answer = resolve as never; }));
    useAppStore.setState({ activeSpaceId: 's', tasks: { todo: [TASK] }, detailTask: null, mutatingTaskIds: new Set(), showToast: vi.fn() } as never);
    const poll = useAppStore.getState().loadBoard();
    await useAppStore.getState().updateTask('t1', { description: 'Mine' });
    answer(boardAnswer({ todo: [TASK] }));
    await poll;
    expect(useAppStore.getState().tasks.todo[0].description).toBe('Mine');
  });
});

describe('a description the board only has the beginning of', () => {
  const FULL = 'x'.repeat(5000);
  const CARD = { ...TASK, description: 'x'.repeat(400), descriptionTruncated: true } as Task;

  function open() {
    useAppStore.setState({
      activeSpaceId: 's', tasks: { todo: [CARD] }, detailTask: null, detailLoaded: false, editConflict: null, conflictQueue: [], resumedEdit: null,
      mutatingTaskIds: new Set(), spaces: [{ id: 's', name: 'S', createdAt: '', updatedAt: '' }],
      showToast: vi.fn(), loadBoard: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<><TaskDetailPanel /><EditConflictDialog /></>);
    act(() => useAppStore.getState().openDetailPanel(CARD));
  }

  /** The whole issue is on its way, and arrives when told to. */
  function whole(issue: Task = { ...TASK, description: FULL }) {
    let arrive: () => void = () => {};
    vi.spyOn(api, 'getTaskForPanel').mockImplementation(() => new Promise((resolve) => {
      arrive = () => resolve({ data: issue, etag: '"v1"' });
    }));
    return async () => {
      arrive();
      await waitFor(() => expect(useAppStore.getState().detailLoaded).toBe(true));
    };
  }

  it('cannot be edited until the whole issue arrives, and says it is loading', async () => {
    const arrive = whole();
    open();
    expect(description().readOnly).toBe(true);
    expect(description()).toHaveAttribute('aria-busy', 'true');
    await arrive();
    expect(description().readOnly).toBe(false);
    expect(description()).toHaveAttribute('aria-busy', 'false');
    expect(description().value).toBe(FULL);
  });

  it('is not saved by leaving the field or closing the panel before it arrives', async () => {
    whole();
    open();
    description().focus();
    fireEvent.blur(description());
    fireEvent.change(description(), { target: { value: 'typed over a read-only field somehow' } });
    fireEvent.blur(description());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(useAppStore.getState().detailTask).toBeNull());
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('is never written back cut short, even by saving something else first', async () => {
    const arrive = whole();
    open();
    fireEvent.change(title(), { target: { value: 'New title' } });
    fireEvent.blur(title());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTask).mock.calls[0][2]).not.toHaveProperty('description');
    await arrive();
    await waitFor(() => expect(description().value).toBe(FULL));
    fireEvent.blur(description());
    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });

  it('a failed save of another field does not bring the short copy back', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: { ...TASK, description: FULL }, etag: '"v1"' });
    open();
    await waitFor(() => expect(description().value).toBe(FULL));
    vi.mocked(api.updateTask).mockRejectedValueOnce(new Error('Network'));
    await act(async () => { await useAppStore.getState().updateTask('t1', { priority: 'high' }); });
    expect(useAppStore.getState().detailTask?.description).toBe(FULL);
    expect(description().value).toBe(FULL);
    fireEvent.blur(description());
    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });

  it('a save that fails while the whole issue is on its way leaves the panel waiting for it', async () => {
    const arrive = whole();
    vi.mocked(api.updateTask).mockRejectedValueOnce(new Error('Network'));
    open();
    await act(async () => { await useAppStore.getState().updateTask('t1', { priority: 'high' }); });
    expect(description().readOnly).toBe(true);
    await arrive();
    expect(description().value).toBe(FULL);
  });

  it('opening the card again does not put the short copy over the whole one', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: { ...TASK, description: FULL }, etag: '"v1"' });
    open();
    await waitFor(() => expect(description().value).toBe(FULL));
    act(() => useAppStore.getState().openDetailPanel(CARD));
    expect(useAppStore.getState().detailTask?.description).toBe(FULL);
    expect(useAppStore.getState().detailLoaded).toBe(true);
    expect(description().value).toBe(FULL);
  });

  it('a board that arrives with the short copy changes nothing in the panel', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: { ...TASK, description: FULL }, etag: '"v1"' });
    open();
    await waitFor(() => expect(description().value).toBe(FULL));
    act(() => useAppStore.setState({ tasks: { todo: [{ ...CARD, updatedAt: 'later' }] } } as never));
    expect(description().value).toBe(FULL);
  });

  it('saving after it arrives sends what was written, from the whole text', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: { ...TASK, description: FULL }, etag: '"v1"' });
    open();
    await waitFor(() => expect(description().value).toBe(FULL));
    fireEvent.change(description(), { target: { value: `${FULL} and more` } });
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({
      description: `${FULL} and more`,
      base: { description: FULL },
    })));
  });

  it('while they type, a refresh of the issue does not touch what they wrote', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: { ...TASK, description: FULL }, etag: '"v1"' });
    open();
    await waitFor(() => expect(description().value).toBe(FULL));
    fireEvent.change(description(), { target: { value: 'Mine' } });
    vi.mocked(api.getTaskForPanel).mockResolvedValue({ data: { ...TASK, description: 'From Bea', updatedAt: 'later' }, etag: '"v2"' });
    await act(async () => { await useAppStore.getState().refreshDetail(); });
    expect(useAppStore.getState().detailTask?.description).toBe('From Bea');
    expect(description().value).toBe('Mine');
    fireEvent.blur(description());
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s', 't1', expect.objectContaining({ description: 'Mine', base: { description: FULL } })));
  });

  it('a save on its way is not undone by a refresh that read before it', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: { ...TASK, description: FULL }, etag: '"v1"' });
    open();
    await waitFor(() => expect(description().value).toBe(FULL));
    let saved: (task: Task) => void = () => {};
    vi.mocked(api.updateTask).mockImplementationOnce(() => new Promise((resolve) => { saved = resolve; }));
    let read: (answer: { data: Task; etag: string }) => void = () => {};
    vi.mocked(api.getTaskForPanel).mockImplementationOnce(() => new Promise((resolve) => { read = resolve; }));
    const refresh = useAppStore.getState().refreshDetail();
    const saving = useAppStore.getState().updateTask('t1', { title: 'Mine' });
    await act(async () => {
      read({ data: { ...TASK, title: 'Before', description: FULL }, etag: '"v0"' });
      await refresh;
    });
    expect(useAppStore.getState().detailTask?.title).toBe('Mine');
    vi.mocked(api.getTaskForPanel).mockResolvedValue({ data: { ...TASK, title: 'Mine', description: FULL }, etag: '"v2"' });
    await act(async () => {
      saved({ ...TASK, title: 'Mine', description: FULL });
      await saving;
    });
    expect(useAppStore.getState().detailTask?.title).toBe('Mine');
  });
});

describe('the panel, for an issue that may not be on the board', () => {
  const statusless = (tasks: Record<string, Task[]>) => ({
    activeSpaceId: 's', tasks, detailTask: null, detailLoaded: false, editConflict: null, conflictQueue: [], resumedEdit: null,
    mutatingTaskIds: new Set(), spaces: [{ id: 's', name: 'S', createdAt: '', updatedAt: '' }],
    showToast: vi.fn(), loadBoard: vi.fn().mockResolvedValue(undefined),
  });

  it('a card that is not loaded is not deleted: the panel stays open', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: TASK, etag: '"v1"' });
    useAppStore.setState(statusless({ todo: [] }) as never);
    render(<TaskDetailPanel />);
    act(() => useAppStore.getState().openDetailPanel(TASK));
    await waitFor(() => expect(useAppStore.getState().detailLoaded).toBe(true));
    await act(async () => { await useAppStore.getState().refreshDetail(); });
    expect(useAppStore.getState().detailTask?.id).toBe('t1');
    expect(useAppStore.getState().showToast).not.toHaveBeenCalled();
  });

  it('a 404 from the refresh says it was deleted, and closes', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({ data: TASK, etag: '"v1"' });
    useAppStore.setState(statusless({ todo: [TASK] }) as never);
    render(<TaskDetailPanel />);
    act(() => useAppStore.getState().openDetailPanel(TASK));
    await waitFor(() => expect(useAppStore.getState().detailLoaded).toBe(true));
    vi.mocked(api.getTaskForPanel).mockRejectedValue(new api.ApiError('Gone', 404, 'TASK_NOT_FOUND'));
    await act(async () => { await useAppStore.getState().refreshDetail(); });
    expect(useAppStore.getState().detailTask).toBeNull();
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith('WEB-1 was deleted', 'info');
  });

  it('any other failure leaves it open and waiting, and the next try gets it', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockRejectedValueOnce(new Error('Network'));
    useAppStore.setState(statusless({ todo: [TASK] }) as never);
    render(<TaskDetailPanel />);
    await act(async () => { useAppStore.getState().openDetailPanel(TASK); });
    expect(useAppStore.getState().detailTask?.id).toBe('t1');
    expect(useAppStore.getState().detailLoaded).toBe(false);
    vi.mocked(api.getTaskForPanel).mockResolvedValue({ data: TASK, etag: '"v1"' });
    await act(async () => { await useAppStore.getState().refreshDetail(); });
    expect(useAppStore.getState().detailLoaded).toBe(true);
  });

  it('comments and attachments come from the whole issue, which the card does not have', async () => {
    vi.spyOn(api, 'getTaskForPanel').mockResolvedValue({
      data: {
        ...TASK,
        comments: [{ id: 'c1', author: 'Bea', text: 'From the whole issue', type: 'note', resolved: false, createdAt: '2026-01-01' }],
        attachments: [{ name: 'notes.txt', type: 'text' }],
      },
      etag: '"v1"',
    });
    useAppStore.setState(statusless({ todo: [TASK] }) as never);
    render(<TaskDetailPanel />);
    act(() => useAppStore.getState().openDetailPanel(TASK));
    expect(await screen.findByText('From the whole issue')).toBeInTheDocument();
    expect(screen.getByTestId('attachments-section')).toBeInTheDocument();
  });
});
