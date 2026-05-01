'use strict';

/**
 * Unit tests for store.searchAllTasks().
 *
 * All tests use an in-memory SQLite DB for full isolation.
 * Run with: node --test tests/store.search.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/services/store');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpace(id, name) {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeTask(id, title, description) {
  return {
    id,
    title,
    type:      'feature',
    description: description || null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchAllTasks — empty/whitespace query', () => {
  let store;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  it('should_return_empty_array_on_empty_string', () => {
    assert.deepEqual(store.searchAllTasks(''), []);
  });

  it('should_return_empty_array_on_whitespace_only', () => {
    assert.deepEqual(store.searchAllTasks('   '), []);
  });

  it('should_return_empty_array_on_null', () => {
    assert.deepEqual(store.searchAllTasks(null), []);
  });
});

describe('searchAllTasks — cross-space search', () => {
  let store;

  beforeEach(() => {
    store = createStore(':memory:');

    // Two spaces with tasks whose titles overlap on "deploy"
    store.upsertSpace(makeSpace('space-a', 'Alpha'));
    store.upsertSpace(makeSpace('space-b', 'Beta'));

    store.insertTask(makeTask('t-a1', 'Deploy to staging', 'Run the deploy pipeline'), 'space-a', 'todo');
    store.insertTask(makeTask('t-a2', 'Fix login bug', 'Users cannot log in'), 'space-a', 'in-progress');
    store.insertTask(makeTask('t-b1', 'Update deploy docs', 'Document deployment steps'), 'space-b', 'done');
    store.insertTask(makeTask('t-b2', 'Design new feature', null), 'space-b', 'todo');
  });

  it('should_return_results_from_both_spaces_matching_deploy', () => {
    const results = store.searchAllTasks('deploy');
    const ids = results.map((r) => r.task.id);

    assert.ok(ids.includes('t-a1'), 'should include t-a1 from space-a');
    assert.ok(ids.includes('t-b1'), 'should include t-b1 from space-b');
    assert.ok(!ids.includes('t-a2'), 'should NOT include t-a2 (no deploy)');
    assert.ok(!ids.includes('t-b2'), 'should NOT include t-b2 (no deploy)');
  });

  it('should_return_correct_spaceId_for_each_result', () => {
    const results = store.searchAllTasks('deploy');

    const resultA = results.find((r) => r.task.id === 't-a1');
    const resultB = results.find((r) => r.task.id === 't-b1');

    assert.equal(resultA.spaceId, 'space-a');
    assert.equal(resultB.spaceId, 'space-b');
  });

  it('should_return_correct_column_for_each_result', () => {
    const results = store.searchAllTasks('deploy');

    const resultA = results.find((r) => r.task.id === 't-a1');
    const resultB = results.find((r) => r.task.id === 't-b1');

    assert.equal(resultA.column, 'todo');
    assert.equal(resultB.column, 'done');
  });

  it('should_return_task_in_same_shape_as_getTask', () => {
    const results = store.searchAllTasks('deploy');
    const result  = results.find((r) => r.task.id === 't-a1');

    assert.ok(result, 'should find t-a1');
    const { task } = result;
    assert.equal(task.id, 't-a1');
    assert.equal(task.title, 'Deploy to staging');
    assert.equal(task.type, 'feature');
    assert.ok('createdAt' in task, 'task should have createdAt');
    assert.ok('updatedAt' in task, 'task should have updatedAt');
  });

  it('should_search_description_field_as_well_as_title', () => {
    // "pipeline" only appears in description of t-a1
    const results = store.searchAllTasks('pipeline');
    const ids = results.map((r) => r.task.id);
    assert.ok(ids.includes('t-a1'), 'should find t-a1 by description match');
  });

  it('should_respect_limit_parameter', () => {
    const results = store.searchAllTasks('deploy', { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('should_default_to_limit_20_when_not_provided', () => {
    // Insert 25 "test" tasks in space-a
    store.upsertSpace(makeSpace('space-c', 'C'));
    for (let i = 0; i < 25; i++) {
      store.insertTask(
        makeTask(`bulk-${i}`, `test task ${i}`, null),
        'space-c',
        'todo'
      );
    }
    const results = store.searchAllTasks('test');
    assert.equal(results.length, 20);
  });

  it('should_return_empty_array_when_no_tasks_match', () => {
    const results = store.searchAllTasks('xyznonexistenttoken123');
    assert.deepEqual(results, []);
  });
});

describe('searchAllTasks — malformed FTS5 query resilience', () => {
  let store;

  beforeEach(() => {
    store = createStore(':memory:');
    store.upsertSpace(makeSpace('space-a', 'Alpha'));
    store.insertTask(makeTask('t1', 'Deploy app', null), 'space-a', 'todo');
  });

  it('should_return_empty_array_on_malformed_fts5_query_without_throwing', () => {
    // Unmatched quote triggers FTS5 syntax error.
    let threw = false;
    let result;
    try {
      result = store.searchAllTasks('"unclosed');
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'searchAllTasks should not throw on malformed query');
    assert.deepEqual(result, []);
  });
});
