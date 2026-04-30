'use strict';

/**
 * Unit tests for src/services/store.js.
 *
 * All tests use an in-memory SQLite DB so they run without touching disk
 * and are fully isolated from each other.
 *
 * Run with: node --test tests/store.test.js
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { createStore } = require('../src/services/store');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpace(overrides = {}) {
  return {
    id:        overrides.id        ?? 'space-1',
    name:      overrides.name      ?? 'Test Space',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id:        overrides.id        ?? 'task-1',
    title:     overrides.title     ?? 'Test Task',
    type:      overrides.type      ?? 'feature',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Space operations
// ---------------------------------------------------------------------------

describe('Store — Space operations', () => {
  let store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  after(() => {
    // nothing to close — in-memory stores are GC'd; close is tested separately
  });

  it('should_return_empty_array_when_no_spaces_exist', () => {
    assert.deepEqual(store.listSpaces(), []);
  });

  it('should_upsert_and_list_a_space', () => {
    const space = makeSpace();
    store.upsertSpace(space);
    const list = store.listSpaces();
    assert.equal(list.length, 1);
    assert.equal(list[0].id,   space.id);
    assert.equal(list[0].name, space.name);
  });

  it('should_get_a_space_by_id', () => {
    const space = makeSpace({ id: 'sp-abc' });
    store.upsertSpace(space);
    const result = store.getSpace('sp-abc');
    assert.equal(result.id,   'sp-abc');
    assert.equal(result.name, space.name);
  });

  it('should_return_null_when_space_not_found', () => {
    assert.equal(store.getSpace('does-not-exist'), null);
  });

  it('should_replace_space_on_upsert_with_same_id', () => {
    store.upsertSpace(makeSpace({ id: 'sp-1', name: 'Original' }));
    store.upsertSpace(makeSpace({ id: 'sp-1', name: 'Updated', updatedAt: '2026-02-01T00:00:00.000Z' }));
    assert.equal(store.getSpace('sp-1').name, 'Updated');
    assert.equal(store.listSpaces().length, 1);
  });

  it('should_delete_a_space', () => {
    store.upsertSpace(makeSpace({ id: 'sp-del' }));
    store.deleteSpace('sp-del');
    assert.equal(store.getSpace('sp-del'), null);
    assert.equal(store.listSpaces().length, 0);
  });

  it('should_preserve_optional_fields_on_upsert', () => {
    const space = makeSpace({
      workingDirectory:   '/some/path',
      pipeline:           ['agent-a', 'agent-b'],
      projectClaudeMdPath: '/path/CLAUDE.md',
      agentNicknames:     { 'agent-a': 'Alice' },
    });
    store.upsertSpace(space);
    const result = store.getSpace(space.id);
    assert.equal(result.workingDirectory,    '/some/path');
    assert.deepEqual(result.pipeline,        ['agent-a', 'agent-b']);
    assert.equal(result.projectClaudeMdPath, '/path/CLAUDE.md');
    assert.deepEqual(result.agentNicknames,  { 'agent-a': 'Alice' });
  });

  it('should_return_undefined_for_absent_optional_fields', () => {
    store.upsertSpace(makeSpace());
    const result = store.getSpace('space-1');
    assert.equal(result.workingDirectory,    undefined);
    assert.equal(result.pipeline,            undefined);
    assert.equal(result.projectClaudeMdPath, undefined);
    assert.equal(result.agentNicknames,      undefined);
  });

  it('should_list_spaces_in_creation_order', () => {
    store.upsertSpace(makeSpace({ id: 's1', createdAt: '2026-01-01T00:00:00.000Z', name: 'A' }));
    store.upsertSpace(makeSpace({ id: 's2', createdAt: '2026-01-02T00:00:00.000Z', name: 'B' }));
    store.upsertSpace(makeSpace({ id: 's3', createdAt: '2026-01-03T00:00:00.000Z', name: 'C' }));
    const ids = store.listSpaces().map((s) => s.id);
    assert.deepEqual(ids, ['s1', 's2', 's3']);
  });
});

// ---------------------------------------------------------------------------
// Task CRUD operations
// ---------------------------------------------------------------------------

describe('Store — Task CRUD', () => {
  let store;

  before(() => {
    store = createStore(':memory:');
    // Insert a space so FK constraint is satisfied.
    store.upsertSpace(makeSpace({ id: 'default' }));
  });

  it('should_return_empty_array_when_no_tasks_in_column', () => {
    assert.deepEqual(store.getTasksByColumn('default', 'todo'), []);
  });

  it('should_insert_and_retrieve_task_by_column', () => {
    const task = makeTask({ id: 'task-c1' });
    store.insertTask(task, 'default', 'todo');
    const result = store.getTasksByColumn('default', 'todo');
    assert.equal(result.length, 1);
    assert.equal(result[0].id,    task.id);
    assert.equal(result[0].title, task.title);
  });

  it('should_get_task_by_id', () => {
    const task = makeTask({ id: 'task-g1' });
    store.insertTask(task, 'default', 'todo');
    const result = store.getTask('default', 'task-g1');
    assert.equal(result.id, 'task-g1');
  });

  it('should_return_null_when_task_not_found', () => {
    assert.equal(store.getTask('default', 'no-such-task'), null);
  });

  it('should_return_null_getTask_for_wrong_spaceId', () => {
    const task = makeTask({ id: 'task-ws1' });
    store.insertTask(task, 'default', 'todo');
    assert.equal(store.getTask('other-space', 'task-ws1'), null);
  });

  it('should_get_all_tasks_for_space_across_columns', () => {
    store.insertTask(makeTask({ id: 'task-a1' }), 'default', 'todo');
    store.insertTask(makeTask({ id: 'task-a2' }), 'default', 'in-progress');
    store.insertTask(makeTask({ id: 'task-a3' }), 'default', 'done');
    const all = store.getAllTasksForSpace('default');
    const ids = all.map((t) => t.id);
    assert.ok(ids.includes('task-a1'));
    assert.ok(ids.includes('task-a2'));
    assert.ok(ids.includes('task-a3'));
  });

  it('should_preserve_optional_task_fields', () => {
    const task = makeTask({
      id:          'task-opt',
      description: 'desc here',
      assigned:    'alice',
      pipeline:    ['stage-1'],
      attachments: [{ name: 'f.txt', type: 'text', content: 'hello' }],
      comments:    [{ id: 'c1', author: 'alice', text: 'hi', type: 'note', needsHuman: false, resolved: false, createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    store.insertTask(task, 'default', 'todo');
    const result = store.getTask('default', 'task-opt');
    assert.equal(result.description, 'desc here');
    assert.equal(result.assigned, 'alice');
    assert.deepEqual(result.pipeline, ['stage-1']);
    assert.equal(result.attachments[0].name, 'f.txt');
    assert.equal(result.comments[0].id, 'c1');
  });

  it('should_update_task_fields_via_patch', () => {
    const task = makeTask({ id: 'task-upd', title: 'Original' });
    store.insertTask(task, 'default', 'todo');
    const updated = store.updateTask('default', 'task-upd', {
      title: 'Updated',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    assert.equal(updated.title,     'Updated');
    assert.equal(updated.updatedAt, '2026-06-01T00:00:00.000Z');
    // Verify persisted
    assert.equal(store.getTask('default', 'task-upd').title, 'Updated');
  });

  it('should_return_null_updateTask_when_not_found', () => {
    const result = store.updateTask('default', 'nonexistent', { title: 'x' });
    assert.equal(result, null);
  });

  it('should_delete_task_and_return_true', () => {
    const task = makeTask({ id: 'task-del' });
    store.insertTask(task, 'default', 'todo');
    const ok = store.deleteTask('default', 'task-del');
    assert.equal(ok, true);
    assert.equal(store.getTask('default', 'task-del'), null);
  });

  it('should_return_false_deleteTask_when_not_found', () => {
    const ok = store.deleteTask('default', 'ghost-task');
    assert.equal(ok, false);
  });

  it('should_clear_all_tasks_in_space_and_return_count', () => {
    // Insert fresh tasks to guarantee count.
    store.upsertSpace(makeSpace({ id: 'space-clear' }));
    store.insertTask(makeTask({ id: 'clr-1' }), 'space-clear', 'todo');
    store.insertTask(makeTask({ id: 'clr-2' }), 'space-clear', 'todo');
    store.insertTask(makeTask({ id: 'clr-3' }), 'space-clear', 'done');
    const count = store.clearSpace('space-clear');
    assert.equal(count, 3);
    assert.deepEqual(store.getAllTasksForSpace('space-clear'), []);
  });
});

// ---------------------------------------------------------------------------
// moveTask — atomicity
// ---------------------------------------------------------------------------

describe('Store — moveTask (atomic)', () => {
  let store;

  before(() => {
    store = createStore(':memory:');
    store.upsertSpace(makeSpace({ id: 'mv-space' }));
  });

  it('should_move_task_to_new_column_atomically', () => {
    const task = makeTask({ id: 'mv-1' });
    store.insertTask(task, 'mv-space', 'todo');

    const moved = store.moveTask('mv-space', 'mv-1', 'in-progress');
    assert.notEqual(moved, null);
    assert.equal(moved.id, 'mv-1');

    // Verify no longer in todo
    const todo = store.getTasksByColumn('mv-space', 'todo');
    assert.equal(todo.find((t) => t.id === 'mv-1'), undefined);

    // Verify present in in-progress
    const inProg = store.getTasksByColumn('mv-space', 'in-progress');
    assert.equal(inProg.length, 1);
    assert.equal(inProg[0].id, 'mv-1');
  });

  it('should_return_null_moveTask_when_task_not_found', () => {
    const result = store.moveTask('mv-space', 'ghost', 'done');
    assert.equal(result, null);
  });

  it('should_update_updatedAt_after_move', () => {
    const task = makeTask({ id: 'mv-2', updatedAt: '2026-01-01T00:00:00.000Z' });
    store.insertTask(task, 'mv-space', 'todo');
    const moved = store.moveTask('mv-space', 'mv-2', 'done');
    assert.notEqual(moved.updatedAt, '2026-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// upsertTask — idempotency (for migration)
// ---------------------------------------------------------------------------

describe('Store — upsertTask (idempotent migration)', () => {
  let store;

  before(() => {
    store = createStore(':memory:');
    store.upsertSpace(makeSpace({ id: 'ug-space' }));
  });

  it('should_insert_task_on_first_upsert', () => {
    const task = makeTask({ id: 'ug-1' });
    store.upsertTask(task, 'ug-space', 'todo');
    assert.equal(store.getTask('ug-space', 'ug-1').title, task.title);
  });

  it('should_not_overwrite_on_second_upsert_with_same_id', () => {
    const task1 = makeTask({ id: 'ug-2', title: 'First' });
    store.upsertTask(task1, 'ug-space', 'todo');
    const task2 = makeTask({ id: 'ug-2', title: 'Second' });
    store.upsertTask(task2, 'ug-space', 'todo');
    // Still "First" — INSERT OR IGNORE
    assert.equal(store.getTask('ug-space', 'ug-2').title, 'First');
  });
});

// ---------------------------------------------------------------------------
// Cascade delete — deleting a space removes its tasks
// ---------------------------------------------------------------------------

describe('Store — cascade delete', () => {
  let store;

  before(() => {
    store = createStore(':memory:');
  });

  it('should_delete_tasks_when_space_is_deleted', () => {
    store.upsertSpace(makeSpace({ id: 'casc-space' }));
    store.insertTask(makeTask({ id: 'casc-t1' }), 'casc-space', 'todo');
    store.insertTask(makeTask({ id: 'casc-t2' }), 'casc-space', 'done');
    store.deleteSpace('casc-space');
    assert.deepEqual(store.getAllTasksForSpace('casc-space'), []);
  });
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

describe('Store — close()', () => {
  it('should_close_without_throwing', () => {
    const store = createStore(':memory:');
    assert.doesNotThrow(() => store.close());
  });
});

// ---------------------------------------------------------------------------
// searchTasks — FTS5 full-text search
// ---------------------------------------------------------------------------

describe('Store — searchTasks (FTS5)', () => {
  let store;

  before(() => {
    store = createStore(':memory:');
    store.upsertSpace(makeSpace({ id: 'fts-space' }));
    store.upsertSpace(makeSpace({ id: 'other-space' }));

    store.insertTask(
      makeTask({ id: 'fts-t1', title: 'Implement authentication flow', description: 'OAuth2 login integration' }),
      'fts-space', 'todo',
    );
    store.insertTask(
      makeTask({ id: 'fts-t2', title: 'Fix database migration bug', description: 'Rollback fails on constraint error' }),
      'fts-space', 'in-progress',
    );
    store.insertTask(
      makeTask({ id: 'fts-t3', title: 'Add search endpoint', description: 'Full-text search using FTS5' }),
      'fts-space', 'done',
    );
    // Task in a different space — must not appear in fts-space results.
    store.insertTask(
      makeTask({ id: 'other-t1', title: 'Implement authentication flow', description: 'Same title different space' }),
      'other-space', 'todo',
    );
  });

  it('should_return_matching_tasks_when_query_matches_title', () => {
    const results = store.searchTasks('fts-space', 'authentication');
    assert.ok(results.length >= 1, 'Expected at least one result');
    const ids = results.map((t) => t.id);
    assert.ok(ids.includes('fts-t1'), 'Expected fts-t1 in results');
  });

  it('should_return_matching_tasks_when_query_matches_description', () => {
    const results = store.searchTasks('fts-space', 'OAuth2');
    assert.ok(results.length >= 1, 'Expected at least one result');
    assert.equal(results[0].id, 'fts-t1');
  });

  it('should_return_empty_array_when_query_is_empty_string', () => {
    const results = store.searchTasks('fts-space', '');
    assert.deepEqual(results, []);
  });

  it('should_return_empty_array_when_query_is_only_whitespace', () => {
    const results = store.searchTasks('fts-space', '   ');
    assert.deepEqual(results, []);
  });

  it('should_not_return_tasks_from_other_spaces', () => {
    const results = store.searchTasks('fts-space', 'authentication');
    const ids = results.map((t) => t.id);
    assert.ok(!ids.includes('other-t1'), 'other-space task must not appear in fts-space results');
  });

  it('should_return_empty_array_when_no_match', () => {
    const results = store.searchTasks('fts-space', 'nonexistentXYZ123');
    assert.deepEqual(results, []);
  });

  it('should_respect_limit_option', () => {
    const results = store.searchTasks('fts-space', 'a', { limit: 1 });
    assert.ok(results.length <= 1, 'Results must not exceed limit');
  });

  it('should_return_empty_array_on_malformed_fts_query', () => {
    // Unmatched quote is a malformed FTS5 expression — should not throw.
    const results = store.searchTasks('fts-space', '"unclosed');
    assert.ok(Array.isArray(results));
    assert.deepEqual(results, []);
  });

  it('should_return_task_objects_in_standard_shape', () => {
    const results = store.searchTasks('fts-space', 'search');
    assert.ok(results.length >= 1);
    const task = results[0];
    assert.ok('id' in task);
    assert.ok('title' in task);
    assert.ok('type' in task);
    assert.ok('createdAt' in task);
    assert.ok('updatedAt' in task);
  });
});

// ---------------------------------------------------------------------------
// rebuildFts — index maintenance
// ---------------------------------------------------------------------------

describe('Store — rebuildFts()', () => {
  it('should_rebuild_fts_index_without_throwing', () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace({ id: 'rebuild-space' }));
    store.insertTask(makeTask({ id: 'rb-t1', title: 'Rebuild test' }), 'rebuild-space', 'todo');
    assert.doesNotThrow(() => store.rebuildFts());
    // After rebuild the task should still be findable.
    const results = store.searchTasks('rebuild-space', 'Rebuild');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'rb-t1');
    store.close();
  });
});
