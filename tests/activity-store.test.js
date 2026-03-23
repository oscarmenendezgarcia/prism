/**
 * Retention cleanup integration test for ActivityStore.
 * ADR-1 (Activity Feed) — T-019 acceptance criteria.
 *
 * Verifies the 30-day file retention policy:
 * - Files dated > 30 days ago are deleted.
 * - Files dated <= 30 days ago are kept.
 * - Non-.jsonl files in the directory are never touched.
 * - cleanup() is idempotent (running twice produces no error).
 *
 * Run with: node tests/activity-store.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createActivityStore } = require('../src/activityStore');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return a YYYY-MM-DD string for a date that is `daysAgo` days before today (UTC).
 * @param {number} daysAgo
 * @returns {string}
 */
function dateStringDaysAgo(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Create a temp directory, run fn(dir) in it, and clean up afterwards.
 * @param {(dir: string) => void | Promise<void>} fn
 */
async function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-store-test-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write a single dummy JSONL line to the given path.
 * @param {string} filePath
 */
function writeStubJsonl(filePath) {
  fs.writeFileSync(filePath, '{"type":"task.created","id":"stub"}\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActivityStore — retention cleanup', () => {
  test('deletes .jsonl file dated 35 days ago', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const old = dateStringDaysAgo(35);
      const oldFile = path.join(activityDir, `${old}.jsonl`);
      writeStubJsonl(oldFile);

      assert.ok(fs.existsSync(oldFile), 'pre-condition: old file should exist');

      store.cleanup();

      assert.ok(!fs.existsSync(oldFile), 'old file should have been deleted');
    });
  });

  test('keeps .jsonl file dated 10 days ago', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const recent = dateStringDaysAgo(10);
      const recentFile = path.join(activityDir, `${recent}.jsonl`);
      writeStubJsonl(recentFile);

      store.cleanup();

      assert.ok(fs.existsSync(recentFile), 'recent file should NOT have been deleted');
    });
  });

  test('keeps .jsonl file dated exactly 30 days ago (boundary — not yet expired)', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const boundary = dateStringDaysAgo(30);
      const boundaryFile = path.join(activityDir, `${boundary}.jsonl`);
      writeStubJsonl(boundaryFile);

      store.cleanup();

      assert.ok(fs.existsSync(boundaryFile), '30-day-old file should NOT be deleted (boundary is inclusive)');
    });
  });

  test('deletes the old file and keeps the recent file when both are present', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const oldDate    = dateStringDaysAgo(35);
      const recentDate = dateStringDaysAgo(5);

      const oldFile    = path.join(activityDir, `${oldDate}.jsonl`);
      const recentFile = path.join(activityDir, `${recentDate}.jsonl`);

      writeStubJsonl(oldFile);
      writeStubJsonl(recentFile);

      store.cleanup();

      assert.ok(!fs.existsSync(oldFile),    'old file (35d) should be deleted');
      assert.ok(fs.existsSync(recentFile),  'recent file (5d) should be kept');
    });
  });

  test('does not delete non-.jsonl files', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const oldDate   = dateStringDaysAgo(40);
      const txtFile   = path.join(activityDir, `${oldDate}.txt`);
      const jsonFile  = path.join(activityDir, `${oldDate}.json`);

      fs.writeFileSync(txtFile,  'some text\n', 'utf8');
      fs.writeFileSync(jsonFile, '{}',          'utf8');

      store.cleanup();

      assert.ok(fs.existsSync(txtFile),  '.txt file should be untouched');
      assert.ok(fs.existsSync(jsonFile), '.json file should be untouched');
    });
  });

  test('does not delete .jsonl files with non-date names', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const oddFile = path.join(activityDir, 'backup.jsonl');
      writeStubJsonl(oddFile);

      store.cleanup();

      assert.ok(fs.existsSync(oddFile), 'non-date-named .jsonl should be untouched');
    });
  });

  test('cleanup is idempotent — running twice does not throw', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      const oldFile = path.join(activityDir, `${dateStringDaysAgo(40)}.jsonl`);
      writeStubJsonl(oldFile);

      store.cleanup();
      // Second call: file already gone, should not throw.
      assert.doesNotThrow(() => store.cleanup());
    });
  });

  test('cleanup returns the number of files deleted', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      writeStubJsonl(path.join(activityDir, `${dateStringDaysAgo(35)}.jsonl`));
      writeStubJsonl(path.join(activityDir, `${dateStringDaysAgo(40)}.jsonl`));
      writeStubJsonl(path.join(activityDir, `${dateStringDaysAgo(5)}.jsonl`));

      const deleted = store.cleanup();
      assert.equal(deleted, 2, 'should have deleted exactly 2 old files');
    });
  });

  test('cleanup on empty directory returns 0 and does not throw', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);
      const deleted = store.cleanup();
      assert.equal(deleted, 0);
    });
  });
});

describe('ActivityStore — append + query (smoke)', () => {
  test('append writes an event that can be queried back', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);
      const event = {
        id:        'smoke-1',
        type:      'task.created',
        spaceId:   'space-smoke',
        timestamp: new Date().toISOString(),
        actor:     'system',
        payload:   { taskId: 'task-1', taskTitle: 'Smoke task' },
      };

      store.append(event);

      const { events, nextCursor } = store.query({ limit: 10 });
      assert.equal(events.length, 1);
      assert.equal(events[0].id, 'smoke-1');
      assert.equal(nextCursor, null);
    });
  });

  test('query with spaceId filter returns only matching events', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      store.append({ id: 'e1', type: 'task.created', spaceId: 'space-A', timestamp: new Date().toISOString(), actor: 'system', payload: {} });
      store.append({ id: 'e2', type: 'task.created', spaceId: 'space-B', timestamp: new Date().toISOString(), actor: 'system', payload: {} });

      const { events } = store.query({ spaceId: 'space-A', limit: 10 });
      assert.equal(events.length, 1);
      assert.equal(events[0].id, 'e1');
    });
  });

  test('query with type filter returns only matching events', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      store.append({ id: 'e1', type: 'task.created', spaceId: 's1', timestamp: new Date().toISOString(), actor: 'system', payload: {} });
      store.append({ id: 'e2', type: 'task.moved',   spaceId: 's1', timestamp: new Date().toISOString(), actor: 'system', payload: {} });

      const { events } = store.query({ type: 'task.moved', limit: 10 });
      assert.equal(events.length, 1);
      assert.equal(events[0].id, 'e2');
    });
  });

  test('malformed JSONL lines are skipped — valid events still returned', async () => {
    await withTmpDir((activityDir) => {
      const store = createActivityStore(activityDir);

      // Write one valid event, then inject a malformed line directly.
      store.append({ id: 'good', type: 'task.created', spaceId: 's1', timestamp: new Date().toISOString(), actor: 'system', payload: {} });

      const today   = new Date().toISOString().slice(0, 10);
      const dayFile = path.join(activityDir, `${today}.jsonl`);
      fs.appendFileSync(dayFile, 'NOT VALID JSON\n', 'utf8');

      // A second valid event after the malformed line.
      store.append({ id: 'also-good', type: 'task.deleted', spaceId: 's1', timestamp: new Date().toISOString(), actor: 'system', payload: {} });

      const { events } = store.query({ limit: 10 });
      const ids = events.map((e) => e.id);
      assert.ok(ids.includes('good'),      'good event should be present');
      assert.ok(ids.includes('also-good'), 'also-good event should be present');
      assert.equal(events.length, 2,       'only 2 valid events should be returned');
    });
  });
});
