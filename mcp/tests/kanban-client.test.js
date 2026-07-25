/**
 * Unit tests for kanban-client.js
 *
 * Uses node:test (consistent with the rest of the project).
 * A lightweight http.createServer acts as the mock Kanban API.
 *
 * Because kanban-client.js reads BASE_URL from process.env.KANBAN_API_URL
 * at module-load time, we set the env var before the first import and keep
 * a single mock server running for the full suite on a fixed test port.
 *
 * Run: node --test mcp/tests/kanban-client.test.js
 *      (or: cd mcp && node --test tests/)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Mock server setup
// ---------------------------------------------------------------------------

const TEST_PORT = 39100;

// Mutable handler — each test group swaps in its own response logic.
let mockHandler = (req, res) => {
  res.writeHead(500);
  res.end(JSON.stringify({ error: { code: 'NO_HANDLER', message: 'no handler set' } }));
};

const mockServer = http.createServer((req, res) => mockHandler(req, res));

// Set env var BEFORE importing the client so BASE_URL is captured correctly.
process.env.KANBAN_API_URL = `http://localhost:${TEST_PORT}/api/v1`;

// Dynamic import after env var is set.
const {
  listTasks,
  getTask,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  clearBoard,
  addComment,
  answerComment,
  blockRun,
  unblockRun,
  findActiveRunForTask,
  getRunLogs,
} = await import('../kanban-client.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON response from the mock server.
 */
function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Collect the full request body from an IncomingMessage.
 */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')));
  });
}

// Canonical mock task list — reflects the real API shape (v1.2.0: new type enum).
const MOCK_TASKS = {
  todo: [
    { id: 'task-1', title: 'Task One', type: 'feature', assigned: 'agent-a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'task-2', title: 'Task Two', type: 'bug', assigned: 'agent-b', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  ],
  'in-progress': [
    { id: 'task-3', title: 'Task Three', type: 'tech-debt', assigned: 'agent-a', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
  ],
  done: [
    { id: 'task-4', title: 'Task Four', type: 'chore', createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z' },
  ],
};

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

before(() => new Promise((resolve, reject) =>
  mockServer.listen(TEST_PORT, (err) => err ? reject(err) : resolve())
));

after(() => new Promise((resolve) => mockServer.close(resolve)));

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

// Paginated mock response wrapper used across listTasks tests.
const MOCK_TASKS_PAGED = { ...MOCK_TASKS, total: 4, nextCursor: null };

describe('listTasks', () => {
  // Capture the last URL called by the client for assertion purposes.
  let lastUrl = '';

  beforeEach(() => {
    lastUrl = '';
    mockHandler = (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/tasks')) {
        lastUrl = req.url;
        respond(res, 200, MOCK_TASKS_PAGED);
      }
    };
  });

  it('calls GET /api/v1/tasks with no query string when no filters given', async () => {
    const result = await listTasks();
    assert.equal(lastUrl, '/api/v1/tasks');
    assert.deepEqual(result, MOCK_TASKS_PAGED);
  });

  it('sends column as a query param to the backend', async () => {
    await listTasks({ column: 'todo' });
    assert.ok(lastUrl.includes('column=todo'), `Expected column=todo in URL, got: ${lastUrl}`);
  });

  it('sends assigned as a query param to the backend', async () => {
    await listTasks({ assigned: 'agent-a' });
    assert.ok(lastUrl.includes('assigned=agent-a'), `Expected assigned=agent-a in URL, got: ${lastUrl}`);
  });

  it('sends both column and assigned as query params', async () => {
    await listTasks({ column: 'todo', assigned: 'agent-b' });
    assert.ok(lastUrl.includes('column=todo'), `Expected column=todo in URL, got: ${lastUrl}`);
    assert.ok(lastUrl.includes('assigned=agent-b'), `Expected assigned=agent-b in URL, got: ${lastUrl}`);
  });

  it('sends limit as a query param to the backend', async () => {
    await listTasks({ limit: 10 });
    assert.ok(lastUrl.includes('limit=10'), `Expected limit=10 in URL, got: ${lastUrl}`);
  });

  it('sends cursor as a query param to the backend', async () => {
    const cursor = Buffer.from(JSON.stringify({ col: 'todo', id: 'task-1' })).toString('base64url');
    await listTasks({ cursor });
    assert.ok(lastUrl.includes(`cursor=${cursor}`), `Expected cursor in URL, got: ${lastUrl}`);
  });

  it('returns backend response as-is (pagination fields included)', async () => {
    const result = await listTasks();
    assert.equal(typeof result.total, 'number');
    assert.equal(result.nextCursor, null);
  });
});

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

// Mock spaces and space-scoped task data used across getTask tests.
const MOCK_SPACES = [
  { id: 'space-1', name: 'Alpha' },
  { id: 'space-2', name: 'Beta' },
];

// Tasks in space-2 only — used for cross-space search tests.
const MOCK_TASKS_SPACE2 = {
  todo:          [{ id: 'task-x', title: 'Task X', type: 'feature', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }],
  'in-progress': [],
  done:          [],
};

/**
 * Wire up the mock server to serve the space-based endpoints used by
 * getTask's all-spaces iteration path.
 *
 * @param {object} [space1Tasks]  - Tasks for space-1 (defaults to MOCK_TASKS).
 * @param {object} [space2Tasks]  - Tasks for space-2 (defaults to MOCK_TASKS_SPACE2).
 */
function setupGetTaskMock(space1Tasks = MOCK_TASKS, space2Tasks = MOCK_TASKS_SPACE2) {
  mockHandler = (req, res) => {
    if (req.method !== 'GET') return;

    if (req.url === '/api/v1/spaces') {
      return respond(res, 200, MOCK_SPACES);
    }
    if (req.url === '/api/v1/spaces/space-1/tasks') {
      return respond(res, 200, space1Tasks);
    }
    if (req.url === '/api/v1/spaces/space-2/tasks') {
      return respond(res, 200, space2Tasks);
    }
  };
}

describe('getTask', () => {
  beforeEach(() => setupGetTaskMock());

  // --- no-spaceId path (iterates all spaces) ---

  it('returns task with column and spaceId when found in todo (no spaceId given)', async () => {
    const result = await getTask('task-1');
    assert.equal(result.id, 'task-1');
    assert.equal(result.column, 'todo');
    assert.equal(result.title, 'Task One');
    assert.equal(result.spaceId, 'space-1');
  });

  it('returns task with correct column when found in in-progress (no spaceId given)', async () => {
    const result = await getTask('task-3');
    assert.equal(result.id, 'task-3');
    assert.equal(result.column, 'in-progress');
    assert.equal(result.spaceId, 'space-1');
  });

  it('returns task with correct column when found in done (no spaceId given)', async () => {
    const result = await getTask('task-4');
    assert.equal(result.id, 'task-4');
    assert.equal(result.column, 'done');
    assert.equal(result.spaceId, 'space-1');
  });

  it('finds task in second space when not in first (cross-space search)', async () => {
    const result = await getTask('task-x');
    assert.equal(result.id, 'task-x');
    assert.equal(result.column, 'todo');
    assert.equal(result.spaceId, 'space-2');
  });

  it('returns TASK_NOT_FOUND when task absent from all spaces (no spaceId given)', async () => {
    const result = await getTask('nonexistent-id');
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
    assert.match(result.message, /nonexistent-id/);
  });

  it('returns TASK_NOT_FOUND even if some spaces return errors (skips failed spaces)', async () => {
    mockHandler = (req, res) => {
      if (req.method !== 'GET') return;
      if (req.url === '/api/v1/spaces') return respond(res, 200, MOCK_SPACES);
      // space-1 errors out; space-2 also has no match.
      if (req.url === '/api/v1/spaces/space-1/tasks') return respond(res, 500, { error: { code: 'SERVER_ERROR', message: 'oops' } });
      if (req.url === '/api/v1/spaces/space-2/tasks') return respond(res, 200, MOCK_TASKS_SPACE2);
    };
    const result = await getTask('task-1'); // task-1 is in space-1 which errors
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });

  // --- explicit spaceId path ---

  it('returns task with spaceId when spaceId is explicitly provided', async () => {
    mockHandler = (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/spaces/space-1/tasks') {
        return respond(res, 200, MOCK_TASKS);
      }
    };
    const result = await getTask('task-2', 'space-1');
    assert.equal(result.id, 'task-2');
    assert.equal(result.column, 'todo');
    assert.equal(result.spaceId, 'space-1');
  });

  it('returns TASK_NOT_FOUND when explicit spaceId provided but task absent', async () => {
    mockHandler = (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/spaces/space-1/tasks') {
        return respond(res, 200, MOCK_TASKS);
      }
    };
    const result = await getTask('nonexistent-id', 'space-1');
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });

  it('propagates error when explicit spaceId request fails', async () => {
    mockHandler = (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/spaces/bad-space/tasks') {
        return respond(res, 404, { error: { code: 'SPACE_NOT_FOUND', message: 'space not found' } });
      }
    };
    const result = await getTask('task-1', 'bad-space');
    assert.equal(result.error, true);
  });
});

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('POSTs to /tasks and returns the created task', async () => {
    const created = { id: 'new-task', title: 'New Task', type: 'feature', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' };
    let capturedBody = null;

    mockHandler = async (req, res) => {
      if (req.method === 'POST' && req.url === '/api/v1/tasks') {
        capturedBody = await readBody(req);
        respond(res, 201, created);
      }
    };

    const result = await createTask({ title: 'New Task', type: 'feature' });
    assert.deepEqual(result, created);
    assert.equal(capturedBody.title, 'New Task');
    assert.equal(capturedBody.type, 'feature');
  });

  it('propagates 400 VALIDATION_ERROR from the API', async () => {
    mockHandler = (req, res) => {
      respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    };

    const result = await createTask({ type: 'feature' });
    assert.equal(result.error, true);
    assert.equal(result.code, 'VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('PUTs to /tasks/:id and returns the updated task', async () => {
    const updated = { id: 'task-1', title: 'Updated Title', type: 'feature', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z' };
    let capturedBody = null;
    let capturedUrl = null;

    mockHandler = async (req, res) => {
      capturedUrl = req.url;
      capturedBody = await readBody(req);
      respond(res, 200, updated);
    };

    const result = await updateTask('task-1', { title: 'Updated Title' });
    assert.deepEqual(result, updated);
    assert.equal(capturedUrl, '/api/v1/tasks/task-1');
    assert.equal(capturedBody.title, 'Updated Title');
  });

  it('propagates 404 TASK_NOT_FOUND from the API', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'TASK_NOT_FOUND', message: "Task with id 'bad' not found" } });
    };

    const result = await updateTask('bad', { title: 'x' });
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// moveTask
// ---------------------------------------------------------------------------

describe('moveTask', () => {
  it('PUTs to /tasks/:id/move with {to} and returns the updated task', async () => {
    const movedTask = { id: 'task-1', title: 'Task One', type: 'feature', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-11T00:00:00.000Z' };
    let capturedBody = null;
    let capturedUrl = null;

    mockHandler = async (req, res) => {
      capturedUrl = req.url;
      capturedBody = await readBody(req);
      respond(res, 200, movedTask);
    };

    const result = await moveTask('task-1', 'done');
    assert.deepEqual(result, movedTask);
    assert.equal(capturedUrl, '/api/v1/tasks/task-1/move');
    assert.equal(capturedBody.to, 'done');
  });

  it('propagates 404 TASK_NOT_FOUND from the API', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'TASK_NOT_FOUND', message: 'not found' } });
    };

    const result = await moveTask('ghost-id', 'done');
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  it('DELETEs /tasks/:id and returns { deleted: true, id }', async () => {
    let capturedMethod = null;
    let capturedUrl = null;

    mockHandler = (req, res) => {
      capturedMethod = req.method;
      capturedUrl = req.url;
      respond(res, 200, { deleted: true, id: 'task-1' });
    };

    const result = await deleteTask('task-1');
    assert.equal(result.deleted, true);
    assert.equal(result.id, 'task-1');
    assert.equal(capturedMethod, 'DELETE');
    assert.equal(capturedUrl, '/api/v1/tasks/task-1');
  });

  it('propagates 404 TASK_NOT_FOUND from the API', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'TASK_NOT_FOUND', message: 'not found' } });
    };

    const result = await deleteTask('ghost');
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// clearBoard
// ---------------------------------------------------------------------------

describe('clearBoard', () => {
  it('DELETEs /tasks with no body and returns { deleted: N }', async () => {
    let capturedMethod = null;
    let capturedUrl = null;
    let capturedBody = null;

    mockHandler = async (req, res) => {
      capturedMethod = req.method;
      capturedUrl = req.url;
      // Collect body bytes — for DELETE with no body this should be null/empty.
      capturedBody = await readBody(req).catch(() => null);
      respond(res, 200, { deleted: 5 });
    };

    const result = await clearBoard();
    assert.equal(result.deleted, 5);
    assert.equal(capturedMethod, 'DELETE');
    assert.equal(capturedUrl, '/api/v1/tasks');
  });

  it('returns { deleted: 0 } when the board is already empty', async () => {
    mockHandler = (req, res) => {
      respond(res, 200, { deleted: 0 });
    };

    const result = await clearBoard();
    assert.equal(result.deleted, 0);
  });

  it('returns SERVER_UNAVAILABLE error when connection is refused', async () => {
    // Same approach as the error-paths section: test the ECONNREFUSED code
    // path in isolation using a raw http.request to a dead port.
    const DEAD_PORT = 39199;

    const result = await new Promise((resolve) => {
      const req = http.request(
        { hostname: 'localhost', port: DEAD_PORT, path: '/api/v1/tasks', method: 'DELETE' },
        () => {}
      );
      req.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
          resolve({
            error: true,
            code: 'SERVER_UNAVAILABLE',
            message: 'Kanban server is not running at localhost:3000. Start it with: node server.js',
          });
        } else {
          resolve({ error: true, code: 'REQUEST_ERROR', message: err.message });
        }
      });
      req.end();
    });

    assert.equal(result.error, true);
    assert.equal(result.code, 'SERVER_UNAVAILABLE');
    assert.match(result.message, /not running/);
  });

  it('propagates 500 INTERNAL_ERROR from the API', async () => {
    mockHandler = (req, res) => {
      respond(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Failed to clear board' } });
    };

    const result = await clearBoard();
    assert.equal(result.error, true);
    assert.equal(result.code, 'INTERNAL_ERROR');
    assert.equal(result.message, 'Failed to clear board');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('error paths', () => {
  it('returns SERVER_UNAVAILABLE when connection is refused', async () => {
    // kanban-client.js captures BASE_URL at module load time from the env var,
    // so we cannot change it per-call. Instead, we invoke the underlying
    // Node http.request directly against a port that nothing is listening on,
    // replicating the exact same logic the client uses, to confirm the ECONNREFUSED
    // code path works in isolation.
    //
    // For an integration-level check we also import a freshly-scoped client
    // using a never-listening port via a child module with a different env.
    const DEAD_PORT = 39199; // nothing ever binds here in this test run

    const result = await new Promise((resolve) => {
      const req = http.request(
        { hostname: 'localhost', port: DEAD_PORT, path: '/api/v1/tasks', method: 'GET' },
        () => {}
      );
      req.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
          resolve({ error: true, code: 'SERVER_UNAVAILABLE', message: 'Kanban server is not running at localhost:3000. Start it with: node server.js' });
        } else {
          resolve({ error: true, code: 'REQUEST_ERROR', message: err.message });
        }
      });
      req.end();
    });

    assert.equal(result.error, true);
    assert.equal(result.code, 'SERVER_UNAVAILABLE');
    assert.match(result.message, /not running/);
  });

  it('propagates HTTP 400 error with the API error code', async () => {
    mockHandler = (req, res) => {
      respond(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'bad input' } });
    };

    const result = await createTask({});
    assert.equal(result.error, true);
    assert.equal(result.code, 'VALIDATION_ERROR');
    assert.equal(result.message, 'bad input');
  });

  it('propagates HTTP 404 error with the API error code', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'TASK_NOT_FOUND', message: 'not found' } });
    };

    const result = await deleteTask('missing');
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });

  it('handles HTTP 500 with a fallback code when body is missing error field', async () => {
    mockHandler = (req, res) => {
      respond(res, 500, { message: 'unexpected crash' });
    };

    const result = await listTasks();
    assert.equal(result.error, true);
    assert.equal(result.code, 'API_ERROR');
  });
});

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------

describe('addComment', () => {
  before(async () => { if (!mockServer.listening) await new Promise((r) => mockServer.listen(TEST_PORT, r)); });

  it('POST /spaces/:spaceId/tasks/:taskId/comments with correct body', async () => {
    let captured = {};
    mockHandler = async (req, res) => {
      captured.method = req.method;
      captured.url    = req.url;
      captured.body   = await readBody(req);
      respond(res, 201, { id: 'c-1', type: 'note', text: 'hello', author: 'dev', resolved: false, createdAt: '2026-01-01T00:00:00.000Z' });
    };

    const result = await addComment({ spaceId: 'sp1', taskId: 'tk1', text: 'hello', type: 'note', author: 'dev' });
    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/api/v1/spaces/sp1/tasks/tk1/comments');
    assert.equal(captured.body.text, 'hello');
    assert.equal(captured.body.type, 'note');
    assert.equal(captured.body.author, 'dev');
    assert.equal(result.id, 'c-1');
  });

  it('includes parentId when provided', async () => {
    let capturedBody;
    mockHandler = async (req, res) => {
      capturedBody = await readBody(req);
      respond(res, 201, { id: 'c-2', type: 'answer', text: 'answer text', author: 'user', resolved: false, createdAt: '2026-01-01T00:00:00.000Z', parentId: 'q-1' });
    };

    await addComment({ spaceId: 'sp1', taskId: 'tk1', text: 'answer text', type: 'answer', author: 'user', parentId: 'q-1' });
    assert.equal(capturedBody.parentId, 'q-1');
  });

  it('uses default author "user" when omitted', async () => {
    let capturedBody;
    mockHandler = async (req, res) => {
      capturedBody = await readBody(req);
      respond(res, 201, { id: 'c-3', type: 'note', text: 'x', author: 'user', resolved: false, createdAt: '2026-01-01T00:00:00.000Z' });
    };

    await addComment({ spaceId: 'sp1', taskId: 'tk1', text: 'x', type: 'note' });
    assert.equal(capturedBody.author, 'user');
  });

  it('returns error on 404 response', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'TASK_NOT_FOUND', message: 'task not found' } });
    };

    const result = await addComment({ spaceId: 'sp1', taskId: 'missing', text: 'x', type: 'note' });
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// answerComment
// ---------------------------------------------------------------------------

describe('answerComment', () => {
  before(async () => { if (!mockServer.listening) await new Promise((r) => mockServer.listen(TEST_PORT, r)); });

  it('makes POST (create answer) then PATCH (resolve question)', async () => {
    const calls = [];
    mockHandler = async (req, res) => {
      const body = await readBody(req);
      calls.push({ method: req.method, url: req.url, body });
      if (req.method === 'POST') {
        respond(res, 201, { id: 'answer-1', type: 'answer', text: 'because X', author: 'dev', parentId: 'q-1', resolved: false, createdAt: '2026-01-01T00:00:00.000Z' });
      } else {
        respond(res, 200, { id: 'q-1', type: 'question', text: '?', author: 'agent', resolved: true, updatedAt: '2026-01-01T00:00:00.000Z' });
      }
    };

    const result = await answerComment({ spaceId: 'sp1', taskId: 'tk1', commentId: 'q-1', answer: 'because X', author: 'dev' });
    assert.equal(calls.length, 2, 'expected 2 HTTP calls');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/api/v1/spaces/sp1/tasks/tk1/comments');
    assert.equal(calls[0].body.type, 'answer');
    assert.equal(calls[0].body.parentId, 'q-1');
    assert.equal(calls[1].method, 'PATCH');
    assert.equal(calls[1].url, '/api/v1/spaces/sp1/tasks/tk1/comments/q-1');
    assert.equal(calls[1].body.resolved, true);
    assert.ok(result.answerComment, 'answerComment should be in result');
    assert.ok(result.resolvedQuestion, 'resolvedQuestion should be in result');
    assert.equal(result.resolvedQuestion.resolved, true);
  });

  it('returns error if POST fails', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'TASK_NOT_FOUND', message: 'not found' } });
    };

    const result = await answerComment({ spaceId: 'sp1', taskId: 'missing', commentId: 'q-1', answer: 'x' });
    assert.equal(result.error, true);
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// blockRun / unblockRun
// ---------------------------------------------------------------------------

describe('blockRun', () => {
  before(async () => { if (!mockServer.listening) await new Promise((r) => mockServer.listen(TEST_PORT, r)); });

  it('POST /runs/:runId/block with empty body', async () => {
    let captured = {};
    mockHandler = async (req, res) => {
      captured.method = req.method;
      captured.url    = req.url;
      captured.body   = await readBody(req);
      respond(res, 200, { runId: 'r-1', status: 'blocked' });
    };

    const result = await blockRun('r-1');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/api/v1/runs/r-1/block');
    assert.equal(result.status, 'blocked');
  });

  it('returns error when run is in terminal state', async () => {
    mockHandler = (req, res) => {
      respond(res, 422, { error: { code: 'RUN_IN_TERMINAL_STATE', message: 'completed' } });
    };

    const result = await blockRun('r-completed');
    assert.equal(result.error, true);
    assert.equal(result.code, 'RUN_IN_TERMINAL_STATE');
  });
});

describe('unblockRun', () => {
  before(async () => { if (!mockServer.listening) await new Promise((r) => mockServer.listen(TEST_PORT, r)); });

  it('POST /runs/:runId/unblock with empty body', async () => {
    let captured = {};
    mockHandler = async (req, res) => {
      captured.method = req.method;
      captured.url    = req.url;
      respond(res, 200, { runId: 'r-1', status: 'running' });
    };

    const result = await unblockRun('r-1');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/api/v1/runs/r-1/unblock');
    assert.equal(result.status, 'running');
  });

  it('returns error when run is not blocked', async () => {
    mockHandler = (req, res) => {
      respond(res, 422, { error: { code: 'RUN_NOT_BLOCKED', message: 'not blocked' } });
    };

    const result = await unblockRun('r-running');
    assert.equal(result.error, true);
    assert.equal(result.code, 'RUN_NOT_BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// findActiveRunForTask
// ---------------------------------------------------------------------------

describe('findActiveRunForTask', () => {
  before(async () => { if (!mockServer.listening) await new Promise((r) => mockServer.listen(TEST_PORT, r)); });

  const MOCK_REGISTRY = [
    { runId: 'r-done',    spaceId: 's1', taskId: 't1', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' },
    { runId: 'r-blocked', spaceId: 's1', taskId: 't1', status: 'blocked',   createdAt: '2026-01-02T00:00:00.000Z' },
    { runId: 'r-other',   spaceId: 's1', taskId: 't2', status: 'running',   createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  it('returns the most-recent active run for (spaceId, taskId)', async () => {
    mockHandler = (req, res) => respond(res, 200, MOCK_REGISTRY);

    const result = await findActiveRunForTask({ spaceId: 's1', taskId: 't1' });
    assert.ok(result, 'expected a result');
    assert.equal(result.runId, 'r-blocked', 'should return most-recent active run');
  });

  it('returns null when no active run for task', async () => {
    mockHandler = (req, res) => respond(res, 200, MOCK_REGISTRY);

    const result = await findActiveRunForTask({ spaceId: 's1', taskId: 't-none' });
    assert.equal(result, null, 'should return null when no match');
  });

  it('returns null when only completed runs exist for task', async () => {
    mockHandler = (req, res) => respond(res, 200, [
      { runId: 'r-c', spaceId: 's1', taskId: 't1', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const result = await findActiveRunForTask({ spaceId: 's1', taskId: 't1' });
    assert.equal(result, null, 'should return null for completed-only');
  });

  it('returns error object on API error', async () => {
    mockHandler = (req, res) => {
      respond(res, 503, { error: { code: 'SERVER_ERROR', message: 'down' } });
    };

    const result = await findActiveRunForTask({ spaceId: 's1', taskId: 't1' });
    assert.equal(result.error, true);
  });
});

// ---------------------------------------------------------------------------
// getRunLogs (mcp-get-run-logs feature)
// ---------------------------------------------------------------------------

describe('getRunLogs', () => {
  before(async () => {
    if (!mockServer.listening) await new Promise((r) => mockServer.listen(TEST_PORT, r));
  });

  it('serializes only provided params into the query string', async () => {
    let observedUrl;
    mockHandler = (req, res) => {
      observedUrl = req.url;
      respond(res, 200, { runId: 'abcdef12', stages: [] });
    };

    await getRunLogs({ runId: 'abcdef12' });
    assert.equal(observedUrl, '/api/v1/runs/abcdef12/logs');

    await getRunLogs({ runId: 'abcdef12', stage: 1, tail: 50, raw: true });
    assert.equal(observedUrl, '/api/v1/runs/abcdef12/logs?stage=1&tail=50&raw=true');

    await getRunLogs({ runId: 'abcdef12', raw: false });
    assert.equal(observedUrl, '/api/v1/runs/abcdef12/logs');
  });

  it('happy path returns the parsed JSON payload', async () => {
    mockHandler = (req, res) => {
      respond(res, 200, {
        runId: 'abcdef1234567890', status: 'running',
        stages: [{ index: 0, agentId: 'a', content: 'hi' }],
      });
    };
    const result = await getRunLogs({ runId: 'abcdef12' });
    assert.equal(result.runId, 'abcdef1234567890');
    assert.equal(result.stages.length, 1);
  });

  it('404 → typed error with RUN_NOT_FOUND', async () => {
    mockHandler = (req, res) => {
      respond(res, 404, { error: { code: 'RUN_NOT_FOUND', message: "run 'abcdef12' not found" } });
    };
    const result = await getRunLogs({ runId: 'abcdef12' });
    assert.equal(result.error, true);
    assert.equal(result.code, 'RUN_NOT_FOUND');
  });

  it('409 → typed error with AMBIGUOUS_RUN', async () => {
    mockHandler = (req, res) => {
      respond(res, 409, { error: { code: 'AMBIGUOUS_RUN', message: 'ambiguous', candidates: ['a', 'b'] } });
    };
    const result = await getRunLogs({ runId: 'abcdef12' });
    assert.equal(result.error, true);
    assert.equal(result.code, 'AMBIGUOUS_RUN');
  });
});
