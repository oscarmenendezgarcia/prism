import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, getSpaces, createSpace, getTasks, createTask, moveTask, deleteTask, getAttachmentContent } from '../../src/api/client';

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
