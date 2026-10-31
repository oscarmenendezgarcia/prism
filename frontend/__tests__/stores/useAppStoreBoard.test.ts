/**
 * The store with only part of the board in the browser: what it asks the server for, what it
 * does with the answer, and how it keeps counts of what it cannot see.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { BoardEpic, Task } from '../../src/types';
import { boardAnswer } from '../helpers/board';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getBoard: vi.fn(),
  createTask: vi.fn(),
  getTaskForPanel: vi.fn(),
  moveTask: vi.fn(),
  reorderTask: vi.fn(),
  updateTask: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  answerQuestion: vi.fn(),
}));
vi.mock('../../src/stores/useTaskRunStore', () => ({
  useTaskRunStore: { getState: () => ({ load: vi.fn() }) },
}));

const card = (id: string, over: Partial<Task> = {}): Task => (
  { id, key: id.toUpperCase(), title: id, type: 'feature', statusId: 'todo', category: 'todo', rank: 1000, createdAt: '', updatedAt: '', ...over }
);
const epic = (id: string): BoardEpic => ({ id, key: id, title: id, statusId: 'todo', category: 'todo', done: 0, total: 0 });
const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];
const lastQuery = () => vi.mocked(api.getBoard).mock.lastCall?.[1];

let counter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  // Each test in a space of its own, which also forgets the ETag of the one before.
  counter += 1;
  useAppStore.setState({
    activeSpaceId: `before-${counter}`,
    spaces: [{ id: 's', name: 'S', statuses: STATUSES, createdAt: '', updatedAt: '' }],
    detailTask: null, detailLoaded: false, isMutating: false, mutatingTaskIds: new Set(),
    showToast: vi.fn(),
  } as never);
  useAppStore.getState().setActiveSpace('s');
  vi.mocked(api.getTaskForPanel).mockResolvedValue(null);
});

describe('a poll', () => {
  it('asks with the version it has', async () => {
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer({ todo: [] }, { etag: '"one"' }));
    await useAppStore.getState().loadBoard();
    expect(lastQuery()?.etag).toBeNull();
    await useAppStore.getState().loadBoard();
    expect(lastQuery()?.etag).toBe('"one"');
  });

  it('on a 304, changes nothing at all', async () => {
    vi.mocked(api.getBoard).mockResolvedValueOnce(boardAnswer({ todo: [card('a')] }, { etag: '"one"', epics: [epic('e')] }));
    await useAppStore.getState().loadBoard();
    const before = useAppStore.getState();
    const listener = vi.fn();
    const unsubscribe = useAppStore.subscribe(listener);
    vi.mocked(api.getBoard).mockResolvedValueOnce(null);
    await useAppStore.getState().loadBoard();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(useAppStore.getState().tasks).toBe(before.tasks);
    expect(useAppStore.getState().epics).toBe(before.epics);
    expect(useAppStore.getState().columnTotals).toBe(before.columnTotals);
    expect(useAppStore.getState().boardVersion).toBe('"one"');
  });

  it('on the same answer again, keeps the same objects', async () => {
    const answer = () => boardAnswer({ todo: [card('a')] }, { etag: '"one"', epics: [epic('e')], totals: { todo: 5 } });
    vi.mocked(api.getBoard).mockResolvedValueOnce(answer());
    await useAppStore.getState().loadBoard();
    const before = useAppStore.getState();
    vi.mocked(api.getBoard).mockResolvedValueOnce(answer());
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().tasks).toBe(before.tasks);
    expect(useAppStore.getState().epics).toBe(before.epics);
    expect(useAppStore.getState().columnTotals).toBe(before.columnTotals);
    expect(useAppStore.getState().columnBounds).toBe(before.columnBounds);
  });

  it('keeps the totals, the epics and where the cards around those loaded are', async () => {
    const answer = boardAnswer({ todo: [card('a')] }, { etag: '"one"', epics: [epic('e')], totals: { todo: 4210 } });
    answer.data.columns.todo.rankAfter = 2000;
    vi.mocked(api.getBoard).mockResolvedValueOnce(answer);
    await useAppStore.getState().loadBoard();
    const state = useAppStore.getState();
    expect(state.tasks.todo.map((t) => t.id)).toEqual(['a']);
    expect(state.columnTotals).toEqual({ todo: 4210 });
    expect(state.epics).toEqual([epic('e')]);
    expect(state.columnBounds.todo.rankAfter).toBe(2000);
  });

  it('a response that was dropped does not count as the version it has', async () => {
    let answer: (v: ReturnType<typeof boardAnswer>) => void = () => {};
    vi.mocked(api.getBoard).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    vi.mocked(api.updateTask).mockResolvedValue(card('a'));
    const poll = useAppStore.getState().loadBoard();
    await useAppStore.getState().updateTask('a', { title: 'x' });
    answer(boardAnswer({ todo: [] }, { etag: '"dropped"' }));
    await poll;
    vi.mocked(api.getBoard).mockResolvedValue(null);
    await useAppStore.getState().loadBoard();
    expect(lastQuery()?.etag).toBeNull();
  });

  it('an answer that comes after a newer one does not replace it', async () => {
    const answers: Array<(v: ReturnType<typeof boardAnswer>) => void> = [];
    vi.mocked(api.getBoard).mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    const first = useAppStore.getState().loadBoard();
    const second = useAppStore.getState().loadBoard();
    answers[1](boardAnswer({ todo: [card('new')] }, { etag: '"new"' }));
    await second;
    answers[0](boardAnswer({ todo: [card('old')] }, { etag: '"old"' }));
    await first;
    expect(useAppStore.getState().tasks.todo[0].id).toBe('new');
    expect(useAppStore.getState().boardVersion).toBe('"new"');
  });
});

describe('Show more', () => {
  beforeEach(async () => {
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer(
      { todo: Array.from({ length: 100 }, (_, i) => card(`a${i}`)), done: Array.from({ length: 50 }, (_, i) => card(`d${i}`)) },
      { etag: '"one"', totals: { todo: 1000, done: 1000 } },
    ));
    await useAppStore.getState().loadBoard();
  });

  it('asks for 100 more of that column, on top of what it has', async () => {
    await useAppStore.getState().showMoreCards('todo');
    expect(lastQuery()?.limits).toEqual({ todo: 200 });
    await useAppStore.getState().showMoreCards('todo');
    expect(lastQuery()?.limits).toEqual({ todo: 300 });
  });

  it('raises from what is loaded for a status named constructor, not from what it inherits', async () => {
    useAppStore.setState({ tasks: JSON.parse('{"constructor":[]}'), columnTotals: JSON.parse('{"constructor":5}') });
    await useAppStore.getState().showMoreCards('constructor');
    expect(Object.entries(lastQuery()?.limits ?? {})).toEqual([['constructor', 100]]);
  });

  it('counts from what a done column shows, which is less', async () => {
    await useAppStore.getState().showMoreCards('done');
    expect(lastQuery()?.limits).toEqual({ done: 150 });
  });

  it('goes on asking for as many, poll after poll', async () => {
    await useAppStore.getState().showMoreCards('todo');
    await useAppStore.getState().loadBoard();
    expect(lastQuery()?.limits).toEqual({ todo: 200 });
  });

  it('never past what the server allows', async () => {
    useAppStore.setState({ columnLimits: { todo: 1950 } });
    await useAppStore.getState().showMoreCards('todo');
    expect(lastQuery()?.limits).toEqual({ todo: 2000 });
  });

  it('starts again on changing space', async () => {
    await useAppStore.getState().showMoreCards('todo');
    useAppStore.getState().setActiveSpace('other');
    expect(useAppStore.getState().columnLimits).toEqual({});
  });

  it('starts again on changing the epic filter', async () => {
    await useAppStore.getState().showMoreCards('todo');
    useAppStore.getState().setFilters({ epic: ['e1'] });
    expect(useAppStore.getState().columnLimits).toEqual({});
    expect(lastQuery()).toMatchObject({ limits: {}, filters: { epic: ['e1'] }, include: [] });
  });

  it('ignores an answer for fewer cards that arrives after', async () => {
    let answer: (v: ReturnType<typeof boardAnswer>) => void = () => {};
    vi.mocked(api.getBoard).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const poll = useAppStore.getState().loadBoard();
    vi.mocked(api.getBoard).mockResolvedValueOnce(boardAnswer({ todo: [card('more')] }, { etag: '"more"' }));
    await useAppStore.getState().showMoreCards('todo');
    answer(boardAnswer({ todo: [card('fewer')] }, { etag: '"fewer"' }));
    await poll;
    expect(useAppStore.getState().tasks.todo[0].id).toBe('more');
  });
});

describe('the epic filter', () => {
  it('is asked of the server, forgetting the version of the other filter', async () => {
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer({ todo: [] }, { etag: '"all"', epics: [epic('e1')] }));
    await useAppStore.getState().loadBoard();
    useAppStore.getState().setFilters({ epic: ['e1'] });
    expect(lastQuery()).toMatchObject({ filters: { epic: ['e1'] }, etag: null });
  });

  it('keeps showing the cards until the new ones arrive, and says what they are of then', async () => {
    vi.mocked(api.getBoard).mockResolvedValueOnce(boardAnswer({ todo: [card('a')] }, { epics: [epic('e1')] }));
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().boardScope).toBe('s|');
    let answer: (v: ReturnType<typeof boardAnswer>) => void = () => {};
    vi.mocked(api.getBoard).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    useAppStore.getState().setFilters({ epic: ['e1'] });
    expect(useAppStore.getState().tasks.todo[0].id).toBe('a');
    expect(useAppStore.getState().boardScope).toBe('s|');
    answer(boardAnswer({ todo: [card('in')] }, { epics: [epic('e1')] }));
    await vi.waitFor(() => expect(useAppStore.getState().boardScope).toBe('s|{"epic":["e1"]}'));
    expect(useAppStore.getState().tasks.todo[0].id).toBe('in');
  });

  it('ignores what was asked before it changed', async () => {
    let answer: (v: ReturnType<typeof boardAnswer>) => void = () => {};
    vi.mocked(api.getBoard).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const poll = useAppStore.getState().loadBoard();
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer({ todo: [card('in')] }, { epics: [epic('e1')] }));
    useAppStore.getState().setFilters({ epic: ['e1'] });
    await vi.waitFor(() => expect(useAppStore.getState().tasks.todo?.[0]?.id).toBe('in'));
    answer(boardAnswer({ todo: [card('all')] }, { epics: [epic('e1')] }));
    await poll;
    expect(useAppStore.getState().tasks.todo[0].id).toBe('in');
  });

  it('goes away with its epic, and the board comes back whole', async () => {
    useAppStore.setState({ filters: { epic: ['gone'] } });
    vi.mocked(api.getBoard).mockResolvedValueOnce(boardAnswer({ todo: [] }, { etag: '"gone"', epics: [] }));
    vi.mocked(api.getBoard).mockResolvedValueOnce(boardAnswer({ todo: [card('a')] }, { etag: '"all"', epics: [] }));
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().filters).toEqual({});
    await vi.waitFor(() => expect(useAppStore.getState().tasks.todo?.[0]?.id).toBe('a'));
    expect(vi.mocked(api.getBoard).mock.lastCall?.[1]).toMatchObject({ filters: {}, etag: null });
  });
});

describe('moving a card', () => {
  it('counts right into a status named constructor, which has no total yet', async () => {
    useAppStore.setState({ tasks: { todo: [card('a')] }, columnTotals: { todo: 1 } });
    vi.mocked(api.moveTask).mockRejectedValue(new Error('No'));
    let during: unknown;
    vi.mocked(api.moveTask).mockImplementation(async () => {
      during = (useAppStore.getState().columnTotals as Record<string, unknown>).constructor;
      throw new Error('No');
    });
    await useAppStore.getState().moveTask('a', 'constructor');
    expect(during).toBe(1);
  });

  beforeEach(() => {
    useAppStore.setState({
      tasks: { todo: [card('a')], done: [card('z', { statusId: 'done', category: 'done', rank: 9000 })] },
      columnTotals: { todo: 500, done: 300 },
    });
    vi.mocked(api.getBoard).mockResolvedValue(null);
  });

  it('counts it on both columns at once', async () => {
    let finish: () => void = () => {};
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({} as never); }));
    const moving = useAppStore.getState().moveTask('a', 'done');
    expect(useAppStore.getState().columnTotals).toEqual({ todo: 499, done: 301 });
    expect(useAppStore.getState().tasks.done.map((t) => t.id)).toEqual(['z', 'a']);
    finish();
    await moving;
  });

  it('counts it back if the server refuses', async () => {
    vi.mocked(api.moveTask).mockRejectedValue(new Error('No'));
    await useAppStore.getState().moveTask('a', 'done');
    expect(useAppStore.getState().columnTotals).toEqual({ todo: 500, done: 300 });
    expect(useAppStore.getState().tasks.todo.map((t) => t.id)).toEqual(['a']);
  });

  it('counts nothing when it stays where it is', async () => {
    vi.mocked(api.moveTask).mockResolvedValue({} as never);
    await useAppStore.getState().moveTask('a', 'todo');
    expect(useAppStore.getState().columnTotals).toEqual({ todo: 500, done: 300 });
  });

  it('moves in the panel an issue whose card is not loaded', async () => {
    const far = card('far');
    useAppStore.setState({ detailTask: far, detailLoaded: true });
    let finish: () => void = () => {};
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({} as never); }));
    const moving = useAppStore.getState().moveTask('far', 'done');
    expect(useAppStore.getState().detailTask).toMatchObject({ statusId: 'done', category: 'done' });
    expect(useAppStore.getState().columnTotals).toEqual({ todo: 500, done: 300 });
    finish();
    await moving;
  });

  it('puts it back in the panel if the server refuses', async () => {
    useAppStore.setState({ detailTask: card('a'), detailLoaded: true });
    vi.mocked(api.moveTask).mockRejectedValue(new Error('No'));
    await useAppStore.getState().moveTask('a', 'done');
    expect(useAppStore.getState().detailTask).toMatchObject({ statusId: 'todo', category: 'todo' });
  });
});

describe('the panel', () => {
  it('gets the whole issue on opening, in place of the card', async () => {
    const short = card('a', { description: 'cut', descriptionTruncated: true });
    vi.mocked(api.getTaskForPanel).mockResolvedValue({ data: card('a', { description: 'cut and the rest' }), etag: '"v"' });
    useAppStore.getState().openDetailPanel(short);
    expect(useAppStore.getState().detailTask).toBe(short);
    expect(useAppStore.getState().detailLoaded).toBe(false);
    await vi.waitFor(() => expect(useAppStore.getState().detailLoaded).toBe(true));
    expect(useAppStore.getState().detailTask?.description).toBe('cut and the rest');
    expect(useAppStore.getState().detailTask).not.toHaveProperty('descriptionTruncated');
  });

  it('forgets what it was loading on closing', async () => {
    let answer: (v: { data: Task; etag: string }) => void = () => {};
    vi.mocked(api.getTaskForPanel).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    useAppStore.getState().openDetailPanel(card('a'));
    useAppStore.getState().closeDetailPanel();
    answer({ data: card('a'), etag: '"v"' });
    await Promise.resolve();
    expect(useAppStore.getState().detailTask).toBeNull();
    expect(useAppStore.getState().detailLoaded).toBe(false);
  });

  it('does not show one issue with what was on its way for another', async () => {
    let answer: (v: { data: Task; etag: string }) => void = () => {};
    vi.mocked(api.getTaskForPanel).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    useAppStore.getState().openDetailPanel(card('a'));
    useAppStore.getState().openDetailPanel(card('b'));
    answer({ data: card('a', { title: 'A in full' }), etag: '"v"' });
    await Promise.resolve();
    expect(useAppStore.getState().detailTask?.id).toBe('b');
  });

  it('asks again on a poll while it has not got it, even with nothing new on the board', async () => {
    vi.mocked(api.getBoard).mockResolvedValue(null);
    useAppStore.setState({ detailTask: card('a'), detailLoaded: false, tasks: { todo: [card('a')] } });
    await useAppStore.getState().loadBoard();
    expect(api.getTaskForPanel).toHaveBeenCalledTimes(1);
  });

  it('asks again on a poll for a card that is not loaded, since the board would not notice', async () => {
    vi.mocked(api.getBoard).mockResolvedValue(null);
    useAppStore.setState({ detailTask: card('far'), detailLoaded: true, tasks: { todo: [card('a')] } });
    await useAppStore.getState().loadBoard();
    expect(api.getTaskForPanel).toHaveBeenCalledTimes(1);
  });

  it('asks nothing on a poll of a loaded card when the board did not change', async () => {
    vi.mocked(api.getBoard).mockResolvedValue(null);
    useAppStore.setState({ detailTask: card('a'), detailLoaded: true, tasks: { todo: [card('a')] } });
    await useAppStore.getState().loadBoard();
    expect(api.getTaskForPanel).not.toHaveBeenCalled();
  });

  it('asks again when the board changed', async () => {
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer({ todo: [card('a')] }, { etag: '"changed"' }));
    useAppStore.setState({ detailTask: card('a'), detailLoaded: true });
    await useAppStore.getState().loadBoard();
    expect(api.getTaskForPanel).toHaveBeenCalledTimes(1);
  });

  it('on a save, keeps what the server works out for the card and the panel', async () => {
    const shown = card('a', {
      epic: { id: 'e', title: 'E' }, parentKey: 'K-1', progress: { done: 1, total: 3 }, pendingQuestions: 2,
      isBlocked: true, blockedByCount: 1,
    });
    useAppStore.setState({ tasks: { todo: [shown] }, detailTask: { ...shown, parent: { id: 'p', title: 'P', type: 'feature' } }, detailLoaded: true });
    vi.mocked(api.updateTask).mockResolvedValue(card('a', { title: 'New', comments: [] }));
    await useAppStore.getState().updateTask('a', { title: 'New' });
    const saved = useAppStore.getState().tasks.todo[0];
    expect(saved).toMatchObject({ title: 'New', epic: { id: 'e', title: 'E' }, parentKey: 'K-1', progress: { done: 1, total: 3 }, pendingQuestions: 2, isBlocked: true });
    expect(saved).not.toHaveProperty('comments');
    expect(useAppStore.getState().detailTask).toMatchObject({ title: 'New', isBlocked: true, parent: { id: 'p' } });
  });

  it('on a change of parent, asks the board what the card now shows', async () => {
    useAppStore.setState({ tasks: { todo: [card('a')] }, detailTask: card('a'), detailLoaded: true });
    vi.mocked(api.updateTask).mockResolvedValue(card('a', { parentId: 'e' }));
    vi.mocked(api.getBoard).mockResolvedValue(null);
    await useAppStore.getState().updateTask('a', { parentId: 'e' });
    expect(api.getBoard).toHaveBeenCalled();
  });

  it('an edit conflict knows the key of an issue with no card', async () => {
    useAppStore.setState({ tasks: { todo: [] }, detailTask: card('far', { key: 'WEB-9' }), detailLoaded: true });
    vi.mocked(api.getBoard).mockResolvedValue(null);
    vi.mocked(api.updateTask).mockRejectedValue(Object.assign(new Error('x'), {
      code: 'EDIT_CONFLICT', details: { field: 'title', theirs: 'Theirs', by: 'Bea', at: null },
    }));
    await useAppStore.getState().updateTask('far', { title: 'Mine', base: { title: 'far' } });
    expect(useAppStore.getState().editConflict?.key).toBe('WEB-9');
    useAppStore.setState({ editConflict: null });
  });

  it('Keep editing opens an issue with no card, which the server still has', async () => {
    useAppStore.setState({
      tasks: { todo: [] }, detailTask: null,
      editConflict: { taskId: 'far', key: 'WEB-9', field: 'title', mine: 'Mine', theirs: 'Theirs', base: 'far', by: null, at: null },
    });
    vi.mocked(api.getTaskForPanel).mockResolvedValue({ data: card('far', { key: 'WEB-9' }), etag: '"v"' });
    useAppStore.getState().resolveConflict('keep-editing');
    await vi.waitFor(() => expect(useAppStore.getState().detailTask?.id).toBe('far'));
    expect(useAppStore.getState().resumedEdit).toMatchObject({ text: 'Mine' });
    useAppStore.setState({ resumedEdit: null });
  });
});

describe('comments', () => {
  const question = { id: 'q', author: 'a', text: 'Which one?', type: 'question' as const, resolved: false, createdAt: '1' };

  beforeEach(() => {
    useAppStore.setState({ tasks: { todo: [card('a')] }, detailTask: card('a', { comments: [] }), detailLoaded: true });
  });

  it('go in the panel, and the card only counts the questions', async () => {
    vi.mocked(api.createComment).mockResolvedValue(question);
    await useAppStore.getState().addComment('a', { author: 'a', text: 'Which one?', type: 'question' });
    expect(useAppStore.getState().detailTask?.comments).toEqual([question]);
    const shown = useAppStore.getState().tasks.todo[0];
    expect(shown.pendingQuestions).toBe(1);
    expect(shown.pendingQuestionText).toBe('Which one?');
    expect(shown).not.toHaveProperty('comments');
  });

  it('resolving a question takes it off the card', async () => {
    useAppStore.setState({ tasks: { todo: [card('a', { pendingQuestions: 1, pendingQuestionText: 'Which one?' })] }, detailTask: card('a', { comments: [question] }) });
    vi.mocked(api.updateComment).mockResolvedValue({ ...question, resolved: true });
    await useAppStore.getState().patchComment('a', 'q', { resolved: true });
    expect(useAppStore.getState().tasks.todo[0].pendingQuestions).toBe(0);
    expect(useAppStore.getState().tasks.todo[0].pendingQuestionText).toBeUndefined();
  });

  it('answering one takes it off the card, and adds the answer in the panel', async () => {
    useAppStore.setState({ tasks: { todo: [card('a', { pendingQuestions: 1 })] }, detailTask: card('a', { comments: [question] }) });
    const answer = { id: 'r', author: 'b', text: 'This one', type: 'answer' as const, parentId: 'q', resolved: false, createdAt: '2' };
    vi.mocked(api.answerQuestion).mockResolvedValue({ question: { ...question, resolved: true }, answer } as never);
    await useAppStore.getState().answerQuestion('a', 'q', 'This one');
    expect(useAppStore.getState().tasks.todo[0].pendingQuestions).toBe(0);
    expect(useAppStore.getState().detailTask?.comments?.map((c) => c.id)).toEqual(['q', 'r']);
  });
});

describe('a write that fails', () => {
  const inSpaceA = () => {
    useAppStore.setState({ tasks: { todo: [card('a', { title: 'Before', rank: 1000 }), card('b', { rank: 2000 })] }, columnTotals: { todo: 2 } });
  };
  /** Have a version of the board, as after any poll. */
  const haveVersion = async () => {
    vi.mocked(api.getBoard).mockResolvedValueOnce(boardAnswer({ todo: [card('a', { title: 'Before', rank: 1000 }), card('b', { rank: 2000 })], done: [] }, { etag: '"one"' }));
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().boardVersion).toBe('"one"');
  };
  const nextPollEtag = async () => {
    vi.mocked(api.getBoard).mockResolvedValue(null);
    await useAppStore.getState().loadBoard();
    return lastQuery()?.etag;
  };
  const inSpaceB = () => {
    useAppStore.getState().setActiveSpace('b-space');
    useAppStore.setState({ tasks: { todo: [card('other')] } });
  };

  it('a save does not bring back the cards of the space it was made in', async () => {
    inSpaceA();
    let fail: (err: Error) => void = () => {};
    vi.mocked(api.updateTask).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const saving = useAppStore.getState().updateTask('a', { title: 'New' });
    inSpaceB();
    const there = useAppStore.getState().tasks;
    fail(new Error('No'));
    await saving;
    expect(useAppStore.getState().tasks).toEqual(there);
    expect(useAppStore.getState().tasks.todo[0].id).toBe('other');
  });

  it('a save rolls back its own card, and leaves what arrived for the others', async () => {
    inSpaceA();
    let fail: (err: Error) => void = () => {};
    vi.mocked(api.updateTask).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const saving = useAppStore.getState().updateTask('a', { title: 'New' });
    expect(useAppStore.getState().tasks.todo[0].title).toBe('New');
    useAppStore.setState({ tasks: { todo: [useAppStore.getState().tasks.todo[0], card('b', { title: 'Changed since', rank: 2000 })] } });
    fail(new Error('No'));
    await saving;
    expect(useAppStore.getState().tasks.todo.map((t) => t.title)).toEqual(['Before', 'Changed since']);
  });

  it.each([
    ['a save', () => { vi.mocked(api.updateTask).mockRejectedValue(new Error('No')); return useAppStore.getState().updateTask('a', { title: 'New' }); }],
    ['a move', () => { vi.mocked(api.moveTask).mockRejectedValue(new Error('No')); return useAppStore.getState().moveTask('a', 'done'); }],
    ['a reorder', () => { vi.mocked(api.reorderTask).mockRejectedValue(new Error('No')); return useAppStore.getState().reorderTask('a', 'todo', 5000); }],
  ])('%s forgets the version of the board, so that the next poll corrects it', async (_name, write) => {
    await haveVersion();
    await write();
    expect(await nextPollEtag()).toBeNull();
  });

  it('a reorder does not bring back the column of the space it was made in', async () => {
    inSpaceA();
    let fail: (err: Error) => void = () => {};
    vi.mocked(api.reorderTask).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const reordering = useAppStore.getState().reorderTask('a', 'todo', 5000);
    inSpaceB();
    fail(new Error('No'));
    await reordering;
    expect(useAppStore.getState().tasks.todo.map((t) => t.id)).toEqual(['other']);
  });

  it('a reorder puts back the rank of its own card only', async () => {
    inSpaceA();
    let fail: (err: Error) => void = () => {};
    vi.mocked(api.reorderTask).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const reordering = useAppStore.getState().reorderTask('a', 'todo', 5000);
    useAppStore.setState({ tasks: { todo: [card('b', { title: 'Changed since', rank: 2000 }), card('a', { title: 'Before', rank: 5000 })] } });
    fail(new Error('No'));
    await reordering;
    expect(useAppStore.getState().tasks.todo.map((t) => `${t.id}:${t.title}`)).toEqual(['a:Before', 'b:Changed since']);
  });
});

describe('a card moved or created where the limit would hide it', () => {
  beforeEach(() => {
    useAppStore.setState({ tasks: { todo: [card('a'), card('b')], done: [] }, columnTotals: { todo: 2, done: 0 } });
    vi.mocked(api.getBoard).mockResolvedValue(null);
    vi.mocked(api.moveTask).mockResolvedValue({} as never);
    vi.mocked(api.reorderTask).mockResolvedValue({} as never);
  });

  it('a moved one is asked for by id on every poll', async () => {
    await useAppStore.getState().moveTask('a', 'done');
    expect(lastQuery()?.include).toEqual(['a']);
    await useAppStore.getState().loadBoard();
    expect(lastQuery()?.include).toEqual(['a']);
  });

  it('so is a created one, by the id the server gave it', async () => {
    vi.mocked(api.createTask).mockResolvedValue(card('new'));
    await useAppStore.getState().createTask({ title: 'T', type: 'chore' });
    expect(lastQuery()?.include).toEqual(['new']);
  });

  it('and one placed by hand, which may land past the end of what is loaded', async () => {
    await useAppStore.getState().reorderTask('a', 'todo', 9000);
    await useAppStore.getState().loadBoard();
    expect(lastQuery()?.include).toEqual(['a']);
  });

  it('keeps the newest 20, without repeating any', async () => {
    for (let i = 0; i < 25; i += 1) useAppStore.getState().keepOnBoard(`c${i}`);
    useAppStore.getState().keepOnBoard('c10');
    const kept = useAppStore.getState().includedIds;
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)).toBe('c10');
    expect(kept).not.toContain('c4');
    expect(new Set(kept).size).toBe(20);
  });

  it('forgets them on changing space', () => {
    useAppStore.getState().keepOnBoard('a');
    useAppStore.getState().setActiveSpace('another');
    expect(useAppStore.getState().includedIds).toEqual([]);
  });

  it('forgets them on changing the epic filter', () => {
    useAppStore.getState().keepOnBoard('a');
    useAppStore.getState().setFilters({ epic: ['e1'] });
    expect(useAppStore.getState().includedIds).toEqual([]);
    expect(lastQuery()?.include).toEqual([]);
  });

  it('does not let an answer from before it was kept replace one from after', async () => {
    let answer: (v: ReturnType<typeof boardAnswer>) => void = () => {};
    vi.mocked(api.getBoard).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const poll = useAppStore.getState().loadBoard();
    useAppStore.getState().keepOnBoard('far');
    answer(boardAnswer({ todo: [card('without')], done: [] }));
    await poll;
    expect(useAppStore.getState().tasks.todo[0].id).toBe('a');
  });
});
