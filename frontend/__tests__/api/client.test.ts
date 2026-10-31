import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBoard, getChildren, getTaskForPanel, getTasksByIds, apiFetch, getSpaces, createSpace, getTasks, createTask, moveTask, deleteTask, getAttachmentContent, createComment, updateComment, answerQuestion } from '../../src/api/client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValue(makeResponse({ id: '1', name: 'Test' }));
    const result = await apiFetch<{ id: string; name: string }>('/spaces');
    expect(result).toEqual({ id: '1', name: 'Test' });
  });

  it('throws Error with message from response body on HTTP error', async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
    );
    await expect(apiFetch('/spaces/bad-id')).rejects.toThrow('Space not found');
  });

  it('falls back to HTTP status in error message if no error.message', async () => {
    mockFetch.mockResolvedValue(makeResponse({ foo: 'bar' }, 500));
    await expect(apiFetch('/spaces')).rejects.toThrow('HTTP 500');
  });

  it('returns null for 204 No Content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject('should not be called'),
    } as unknown as Response);
    const result = await apiFetch('/spaces/id');
    expect(result).toBeNull();
  });

  it('sets Content-Type: application/json header', async () => {
    mockFetch.mockResolvedValue(makeResponse([]));
    await apiFetch('/spaces');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });
});

describe('getSpaces', () => {
  it('calls GET /api/v1/spaces and returns array', async () => {
    const spaces = [{ id: '1', name: 'General', createdAt: '', updatedAt: '' }];
    mockFetch.mockResolvedValue(makeResponse(spaces));
    const result = await getSpaces();
    expect(result).toEqual(spaces);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/spaces', expect.objectContaining({ headers: expect.any(Object) }));
  });
});

describe('createSpace', () => {
  it('calls POST /api/v1/spaces with name', async () => {
    const newSpace = { id: 'new-id', name: 'My Space', createdAt: '', updatedAt: '' };
    mockFetch.mockResolvedValue(makeResponse(newSpace, 201));
    const result = await createSpace('My Space');
    expect(result).toEqual(newSpace);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'My Space' }),
      })
    );
  });
});

describe('getBoard', () => {
  it('asks for the board of the space, and brings its version', async () => {
    const data = { columns: { todo: { tasks: [], total: 0 } }, epics: [] };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ ETag: '"one"' }), json: async () => data });
    await expect(getBoard('space-1')).resolves.toEqual({ data, etag: '"one"' });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/spaces/space-1/board');
  });

  it('asks for the limits and the epic given', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ columns: {}, epics: [] }) });
    await getBoard('space-1', { limits: { todo: 200, done: 150 }, epic: 'e1' });
    const url = new URL(mockFetch.mock.calls[0][0], 'http://x');
    expect(url.searchParams.get('limits')).toBe('todo:200,done:150');
    expect(url.searchParams.get('epic')).toBe('e1');
  });

  it('sends the version it has, and a 304 is null, without reading a body', async () => {
    const json = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 304, headers: new Headers({ ETag: '"one"' }), json });
    await expect(getBoard('space-1', { etag: '"one"' })).resolves.toBeNull();
    expect(mockFetch.mock.calls[0][1].headers['If-None-Match']).toBe('"one"');
    expect(json).not.toHaveBeenCalled();
  });

  it('sends none when it has none', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ columns: {}, epics: [] }) });
    await getBoard('space-1');
    expect(mockFetch.mock.calls[0][1].headers['If-None-Match']).toBeUndefined();
  });
});

describe('getTaskForPanel', () => {
  it('asks for the panel view of the issue', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ ETag: '"v"' }), json: async () => ({ id: 't1' }) });
    await expect(getTaskForPanel('s', 't1')).resolves.toEqual({ data: { id: 't1' }, etag: '"v"' });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/spaces/s/tasks/t1?view=panel');
  });

  it('keeps the code of a 404, which is how a deleted issue is told from a failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers(), json: async () => ({ error: { code: 'TASK_NOT_FOUND', message: 'Gone' } }) });
    await expect(getTaskForPanel('s', 't1')).rejects.toMatchObject({ status: 404, code: 'TASK_NOT_FOUND' });
  });
});

describe('getChildren and getTasksByIds', () => {
  it('ask the tasks route, without touching what it answers otherwise', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ tasks: [], total: 0 }) });
    await getChildren('s', 'p1', 200);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/spaces/s/tasks?parent=p1&limit=200');
    await getTasksByIds('s', ['a', 'b']);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/v1/spaces/s/tasks?ids=a,b');
  });
});

describe('getTasks', () => {
  it('calls GET /api/v1/spaces/:spaceId/tasks', async () => {
    const board = { todo: [], 'in-progress': [], done: [] };
    mockFetch.mockResolvedValue(makeResponse(board));
    const result = await getTasks('space-1');
    expect(result).toEqual(board);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/space-1/tasks',
      expect.any(Object)
    );
  });
});

describe('createTask', () => {
  it('calls POST with payload', async () => {
    const task = { id: 't1', title: 'New', type: 'chore', createdAt: '', updatedAt: '' };
    mockFetch.mockResolvedValue(makeResponse(task, 201));
    const payload = { title: 'New', type: 'chore' as const };
    const result = await createTask('space-1', payload);
    expect(result).toEqual(task);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/space-1/tasks',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) })
    );
  });
});

describe('moveTask', () => {
  it('calls PUT .../move with to column', async () => {
    const moveResp = { task: {}, from: 'todo', to: 'in-progress' };
    mockFetch.mockResolvedValue(makeResponse(moveResp));
    const result = await moveTask('space-1', 'task-1', 'in-progress');
    expect(result).toEqual(moveResp);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/space-1/tasks/task-1/move',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ to: 'in-progress' }) })
    );
  });
});

describe('deleteTask', () => {
  it('calls DELETE with task id', async () => {
    mockFetch.mockResolvedValue(makeResponse({ deleted: true, id: 'task-1' }));
    const result = await deleteTask('space-1', 'task-1');
    expect(result).toEqual({ deleted: true, id: 'task-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/space-1/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('getAttachmentContent', () => {
  it('calls GET .../attachments/:index', async () => {
    const att = { name: 'file.txt', type: 'text', content: 'hello' };
    mockFetch.mockResolvedValue(makeResponse(att));
    const result = await getAttachmentContent('s1', 't1', 0);
    expect(result).toEqual(att);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/s1/tasks/t1/attachments/0',
      expect.any(Object)
    );
  });
});

describe('createComment', () => {
  it('calls POST .../comments with payload and returns Comment', async () => {
    const comment = {
      id: 'c1',
      author: 'developer-agent',
      text: 'Is this the right approach?',
      type: 'question' as const,
      resolved: false,
      createdAt: '2026-04-16T07:00:00.000Z',
    };
    mockFetch.mockResolvedValue(makeResponse(comment, 201));
    const payload = { author: 'developer-agent', text: 'Is this the right approach?', type: 'question' as const };
    const result = await createComment('s1', 't1', payload);
    expect(result).toEqual(comment);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/s1/tasks/t1/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    );
  });

  it('includes optional parentId in payload when provided', async () => {
    const comment = { id: 'c2', author: 'qa-engineer-e2e', text: 'Yes.', type: 'answer' as const, parentId: 'c1', resolved: false, createdAt: '' };
    mockFetch.mockResolvedValue(makeResponse(comment, 201));
    const payload = { author: 'qa-engineer-e2e', text: 'Yes.', type: 'answer' as const, parentId: 'c1' };
    await createComment('s1', 't1', payload);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/s1/tasks/t1/comments',
      expect.objectContaining({ body: JSON.stringify(payload) })
    );
  });
});

describe('updateComment', () => {
  it('calls PATCH .../comments/:commentId with payload and returns updated Comment', async () => {
    const updated = {
      id: 'c1',
      author: 'developer-agent',
      text: 'Is this the right approach?',
      type: 'question' as const,
      resolved: true,
      createdAt: '2026-04-16T07:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    };
    mockFetch.mockResolvedValue(makeResponse(updated));
    const payload = { resolved: true };
    const result = await updateComment('s1', 't1', 'c1', payload);
    expect(result).toEqual(updated);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/s1/tasks/t1/comments/c1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
    );
  });

  it('supports partial updates (text only)', async () => {
    const updated = { id: 'c1', author: 'dev', text: 'Updated text', type: 'note' as const, resolved: false, createdAt: '' };
    mockFetch.mockResolvedValue(makeResponse(updated));
    const payload = { text: 'Updated text' };
    await updateComment('s1', 't1', 'c1', payload);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/spaces/s1/tasks/t1/comments/c1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(payload) })
    );
  });
});

describe('answerQuestion', () => {
  it('POSTs the answer comment then PATCHes the question resolved, returning both', async () => {
    const answer = {
      id: 'a1',
      author: 'user',
      text: 'because X',
      type: 'answer' as const,
      parentId: 'q1',
      resolved: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const question = {
      id: 'q1',
      author: 'developer-agent',
      text: 'why this option?',
      type: 'question' as const,
      resolved: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z',
    };
    mockFetch.mockResolvedValueOnce(makeResponse(answer, 201));
    mockFetch.mockResolvedValueOnce(makeResponse(question));

    const result = await answerQuestion('s1', 't1', 'q1', 'because X');

    expect(result).toEqual({ question, answer });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/spaces/s1/tasks/t1/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ author: 'user', text: 'because X', type: 'answer', parentId: 'q1' }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/spaces/s1/tasks/t1/comments/q1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ resolved: true }) }),
    );
  });

  it('does not mark the question resolved when the answer POST fails', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(
        { error: { code: 'PARENT_COMMENT_NOT_FOUND', message: "Parent comment with id 'nope' not found in this task" } },
        400,
      ),
    );

    await expect(answerQuestion('s1', 't1', 'nope', 'x')).rejects.toThrow('Parent comment');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
