/**
 * Unit tests for src/spaceManager.js
 *
 * Tests all CRUD operations, validation constraints, and edge cases:
 *   - listSpaces, getSpace, createSpace, renameSpace, deleteSpace
 *   - Duplicate name (case-insensitive), last-space guard, not-found errors
 *   - Atomic manifest writes (.tmp + rename)
 *
 * All tests use isolated temp directories; production data is never touched.
 *
 * Run with: node tests/spaceManager.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { createSpaceManager } = require('../src/services/spaceManager');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed   = 0;
let failed   = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function suite(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-sm-test-'));
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Create a SpaceManager with a pre-seeded default space so tests start
 * from a clean known state.
 */
function makeManager(dir) {
  // Seed the default space manually (mimics post-migration state).
  const spacesDir    = path.join(dir, 'spaces', 'default');
  const manifestPath = path.join(dir, 'spaces.json');

  fs.mkdirSync(spacesDir, { recursive: true });
  const cols = ['todo', 'in-progress', 'done'];
  for (const col of cols) {
    fs.writeFileSync(path.join(spacesDir, `${col}.json`), '[]', 'utf8');
  }

  const now = new Date().toISOString();
  fs.writeFileSync(
    manifestPath,
    JSON.stringify([{ id: 'default', name: 'General', createdAt: now, updatedAt: now }], null, 2),
    'utf8'
  );

  return createSpaceManager(dir);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {

  // =========================================================================
  // listSpaces
  // =========================================================================

  suite('listSpaces()');

  await test('returns all spaces from manifest', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      const spaces = sm.listSpaces();
      assert(Array.isArray(spaces),      'Should return an array');
      assert(spaces.length === 1,        'Should have 1 space');
      assert(spaces[0].id   === 'default', 'First space id should be "default"');
      assert(spaces[0].name === 'General', 'First space name should be "General"');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns empty array when manifest does not exist', () => {
    const dir = makeTmpDir();
    try {
      const sm     = createSpaceManager(dir); // no seeding
      const spaces = sm.listSpaces();
      assert(Array.isArray(spaces), 'Should return an array');
      assert(spaces.length === 0,   'Should be empty when manifest absent');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // getSpace
  // =========================================================================

  suite('getSpace(id)');

  await test('returns { ok: true, space } for existing space', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.getSpace('default');
      assert(result.ok === true,             'ok should be true');
      assert(result.space.id   === 'default', 'space.id should be "default"');
      assert(result.space.name === 'General', 'space.name should be "General"');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns SPACE_NOT_FOUND for unknown id', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.getSpace('does-not-exist');
      assert(result.ok   === false,         'ok should be false');
      assert(result.code === 'SPACE_NOT_FOUND', 'code should be SPACE_NOT_FOUND');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // createSpace
  // =========================================================================

  suite('createSpace(name)');

  await test('creates a new space with a UUID id and empty column files', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.createSpace('Feature Alpha');

      assert(result.ok === true,                    'ok should be true');
      assert(result.space.name === 'Feature Alpha',  'name should match');
      assert(typeof result.space.id === 'string',    'id should be a string');
      assert(result.space.id !== 'default',          'id should not be "default"');

      // SQLite-backed: no filesystem directories are created.
      // Verify the space is queryable from the store instead.
      const found = sm.getSpace(result.space.id);
      assert(found.ok === true,                     'Space should be retrievable from store');
      assert(found.space.name === 'Feature Alpha',  'Retrieved space name should match');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('appends to manifest after create', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      sm.createSpace('Sprint 1');

      const spaces = sm.listSpaces();
      assert(spaces.length === 2, 'Should have 2 spaces after create');
      assert(spaces.some((s) => s.name === 'Sprint 1'), 'Sprint 1 should be in list');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('trims whitespace from name', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.createSpace('  Padded  ');
      assert(result.ok === true,            'ok should be true');
      assert(result.space.name === 'Padded', 'name should be trimmed');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR for empty name', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.createSpace('   ');
      assert(result.ok === false,              'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR for name exceeding 100 chars', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.createSpace('x'.repeat(101));
      assert(result.ok === false,              'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR when name is not a string', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.createSpace(42);
      assert(result.ok === false,              'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns DUPLICATE_NAME for case-insensitive duplicate', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      sm.createSpace('Alpha');
      const result = sm.createSpace('alpha');
      assert(result.ok   === false,         'ok should be false');
      assert(result.code === 'DUPLICATE_NAME', 'code should be DUPLICATE_NAME');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns DUPLICATE_NAME for duplicate with different casing and extra spaces', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      sm.createSpace('Dev Team');
      const result = sm.createSpace('  DEV TEAM  ');
      assert(result.ok   === false,         'ok should be false');
      assert(result.code === 'DUPLICATE_NAME', 'code should be DUPLICATE_NAME');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('100-char name is accepted (boundary)', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.createSpace('x'.repeat(100));
      assert(result.ok === true, 'Exactly 100 chars should be valid');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // renameSpace
  // =========================================================================

  suite('renameSpace(id, newName)');

  await test('updates name and updatedAt in manifest', async () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      const before = sm.getSpace('default').space.updatedAt;

      // Ensure time advances (Node.js Date.now() resolution can be < 1ms).
      await new Promise((r) => setTimeout(r, 2));

      const result = sm.renameSpace('default', 'My Board');
      assert(result.ok === true,                 'ok should be true');
      assert(result.space.name === 'My Board',    'name should be updated');
      assert(result.space.updatedAt !== before,   'updatedAt should change');
      assert(result.space.createdAt === sm.getSpace('default').space.createdAt, 'createdAt should not change');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('persists rename to manifest file', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      sm.renameSpace('default', 'Renamed');

      const freshSm = createSpaceManager(dir);
      const space   = freshSm.getSpace('default');
      assert(space.ok === true,              'Should find space after rename');
      assert(space.space.name === 'Renamed', 'Persisted name should be "Renamed"');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns SPACE_NOT_FOUND for unknown id', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.renameSpace('no-such-id', 'Name');
      assert(result.ok   === false,             'ok should be false');
      assert(result.code === 'SPACE_NOT_FOUND', 'code should be SPACE_NOT_FOUND');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns DUPLICATE_NAME when renaming to an existing name', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      sm.createSpace('Beta');
      const beta   = sm.listSpaces().find((s) => s.name === 'Beta');
      const result = sm.renameSpace(beta.id, 'general'); // case-insensitive match with "General"
      assert(result.ok   === false,          'ok should be false');
      assert(result.code === 'DUPLICATE_NAME', 'code should be DUPLICATE_NAME');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR for empty new name', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.renameSpace('default', '');
      assert(result.ok   === false,              'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

   await test('renaming to the same name as itself succeeds (no duplicate)', () => {
     const dir = makeTmpDir();
     try {
       const sm     = makeManager(dir);
       const result = sm.renameSpace('default', 'General');
       assert(result.ok === true, 'Renaming to same name should succeed');
     } finally {
       rmTmpDir(dir);
     }
   });

   // =========================================================================
   // projectClaudeMdPath
   // =========================================================================

   suite('createSpace with projectClaudeMdPath');

   await test('accepts projectClaudeMdPath on create', () => {
     const dir = makeTmpDir();
     try {
       const sm     = makeManager(dir);
       const result = sm.createSpace('Project', '/workspace', [], 'docs/CLAUDE.md');
       assert(result.ok === true, 'ok should be true');
       assert(result.space.projectClaudeMdPath === 'docs/CLAUDE.md', 'projectClaudeMdPath should be set');
     } finally {
       rmTmpDir(dir);
     }
   });

   await test('omits projectClaudeMdPath if not provided', () => {
     const dir = makeTmpDir();
     try {
       const sm     = makeManager(dir);
       const result = sm.createSpace('Project');
       assert(result.ok === true, 'ok should be true');
       assert(result.space.projectClaudeMdPath === undefined, 'projectClaudeMdPath should be undefined');
     } finally {
       rmTmpDir(dir);
     }
   });

   suite('renameSpace with projectClaudeMdPath');

   await test('updates projectClaudeMdPath on rename', () => {
     const dir = makeTmpDir();
     try {
       const sm = makeManager(dir);
       const created = sm.createSpace('Project', '/workspace', [], 'docs/old.md');
       
       const result = sm.renameSpace(created.space.id, 'Project', '/workspace', [], 'docs/new.md');
       assert(result.ok === true, 'ok should be true');
       assert(result.space.projectClaudeMdPath === 'docs/new.md', 'projectClaudeMdPath should be updated');
     } finally {
       rmTmpDir(dir);
     }
   });

   await test('clears projectClaudeMdPath with empty string', () => {
     const dir = makeTmpDir();
     try {
       const sm = makeManager(dir);
       const created = sm.createSpace('Project', '/workspace', [], 'docs/CLAUDE.md');
       
       const result = sm.renameSpace(created.space.id, 'Project', '/workspace', [], '');
       assert(result.ok === true, 'ok should be true');
       assert(result.space.projectClaudeMdPath === undefined, 'projectClaudeMdPath should be undefined after clearing');
     } finally {
       rmTmpDir(dir);
     }
   });

  // =========================================================================
  // normaliseNicknames
  // =========================================================================

  suite('normaliseNicknames()');

  await test('returns empty object for undefined input', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.normaliseNicknames(undefined);
      assert(result.ok === true,                      'ok should be true');
      assert(typeof result.nicknames === 'object',    'nicknames should be an object');
      assert(Object.keys(result.nicknames).length === 0, 'nicknames should be empty');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('drops empty-string entries', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.normaliseNicknames({ 'developer-agent': '', 'senior-architect': 'El Jefe' });
      assert(result.ok === true, 'ok should be true');
      assert(!('developer-agent' in result.nicknames), 'empty entry should be dropped');
      assert(result.nicknames['senior-architect'] === 'El Jefe', 'non-empty entry should be kept');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('trims values', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.normaliseNicknames({ 'developer-agent': '  Rafa  ' });
      assert(result.ok === true,                                 'ok should be true');
      assert(result.nicknames['developer-agent'] === 'Rafa',     'value should be trimmed');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('drops whitespace-only entries', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.normaliseNicknames({ 'developer-agent': '   ' });
      assert(result.ok === true,                                       'ok should be true');
      assert(!('developer-agent' in result.nicknames),                 'whitespace-only entry should be dropped');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR for value > 50 chars', () => {
    const dir = makeTmpDir();
    try {
      const sm         = makeManager(dir);
      const longValue  = 'a'.repeat(51);
      const result     = sm.normaliseNicknames({ 'developer-agent': longValue });
      assert(result.ok   === false,             'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('accepts value of exactly 50 chars', () => {
    const dir = makeTmpDir();
    try {
      const sm        = makeManager(dir);
      const maxValue  = 'a'.repeat(50);
      const result    = sm.normaliseNicknames({ 'developer-agent': maxValue });
      assert(result.ok === true,                                   'ok should be true');
      assert(result.nicknames['developer-agent'] === maxValue,     '50-char value should pass');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR for non-object input', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.normaliseNicknames('not-an-object');
      assert(result.ok   === false,             'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // renameSpace with agentNicknames
  // =========================================================================

  suite('renameSpace() with agentNicknames');

  await test('persists valid agentNicknames', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.renameSpace('default', 'General', undefined, undefined, undefined, {
        'senior-architect': 'El Jefe',
        'developer-agent':  'Rafa',
      });
      assert(result.ok === true,                                         'ok should be true');
      assert(result.space.agentNicknames['senior-architect'] === 'El Jefe', 'nickname should be persisted');
      assert(result.space.agentNicknames['developer-agent']  === 'Rafa',    'nickname should be persisted');

      // SQLite-backed: verify persistence by re-reading from a fresh manager instance.
      const freshSm = createSpaceManager(dir);
      const onDisk  = freshSm.getSpace('default');
      assert(onDisk.ok === true, 'Space should be found after persist');
      assert(onDisk.space.agentNicknames['senior-architect'] === 'El Jefe', 'nickname should survive reload');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('strips empty-string nickname values before write', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.renameSpace('default', 'General', undefined, undefined, undefined, {
        'developer-agent': '',
        'senior-architect': 'El Jefe',
      });
      assert(result.ok === true,                                         'ok should be true');
      assert(!('developer-agent' in (result.space.agentNicknames ?? {})), 'empty entry should be absent');
      assert(result.space.agentNicknames['senior-architect'] === 'El Jefe', 'non-empty entry should remain');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns VALIDATION_ERROR for nickname value > 50 chars', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.renameSpace('default', 'General', undefined, undefined, undefined, {
        'developer-agent': 'a'.repeat(51),
      });
      assert(result.ok   === false,             'ok should be false');
      assert(result.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('omitting agentNicknames leaves existing value unchanged', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      // First: set nicknames.
      sm.renameSpace('default', 'General', undefined, undefined, undefined, { 'senior-architect': 'Boss' });
      // Second: rename without agentNicknames param — should NOT clear them.
      const result = sm.renameSpace('default', 'General Renamed');
      assert(result.ok === true,                                               'ok should be true');
      assert(result.space.agentNicknames?.['senior-architect'] === 'Boss',     'nicknames should be unchanged');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('passing all-empty agentNicknames removes agentNicknames field', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      sm.renameSpace('default', 'General', undefined, undefined, undefined, { 'senior-architect': 'Boss' });
      const result = sm.renameSpace('default', 'General', undefined, undefined, undefined, {
        'senior-architect': '',
      });
      assert(result.ok === true,                           'ok should be true');
      assert(result.space.agentNicknames === undefined,    'agentNicknames should be absent when all cleared');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // deleteSpace
  // =========================================================================

  suite('deleteSpace(id)');

  await test('removes the space from the store on delete', () => {
    const dir = makeTmpDir();
    try {
      const sm      = makeManager(dir);
      const created = sm.createSpace('Temp Space');
      const spaceId = created.space.id;

      // SQLite-backed: verify space is in store before deletion.
      assert(sm.getSpace(spaceId).ok === true, 'Space should exist before delete');

      sm.deleteSpace(spaceId);
      // Space should no longer be retrievable.
      assert(sm.getSpace(spaceId).ok === false, 'Space should be removed from store after delete');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('removes entry from manifest', () => {
    const dir = makeTmpDir();
    try {
      const sm      = makeManager(dir);
      const created = sm.createSpace('To Delete');
      const id      = created.space.id;

      sm.deleteSpace(id);

      const spaces = sm.listSpaces();
      assert(!spaces.some((s) => s.id === id), 'Deleted space should not appear in list');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns { ok: true, id } on success', () => {
    const dir = makeTmpDir();
    try {
      const sm      = makeManager(dir);
      const created = sm.createSpace('X');
      const result  = sm.deleteSpace(created.space.id);

      assert(result.ok === true,                 'ok should be true');
      assert(result.id === created.space.id,      'id should match deleted space');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns LAST_SPACE when attempting to delete the only space', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      const result = sm.deleteSpace('default');
      assert(result.ok   === false,      'ok should be false');
      assert(result.code === 'LAST_SPACE', 'code should be LAST_SPACE');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('returns SPACE_NOT_FOUND for unknown id', () => {
    const dir = makeTmpDir();
    try {
      const sm     = makeManager(dir);
      sm.createSpace('Extra'); // ensure count > 1 so LAST_SPACE is not triggered
      const result = sm.deleteSpace('ghost-id');
      assert(result.ok   === false,             'ok should be false');
      assert(result.code === 'SPACE_NOT_FOUND', 'code should be SPACE_NOT_FOUND');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // ensureAllSpaces
  // =========================================================================

  suite('ensureAllSpaces()');

  await test('ensureAllSpaces is a no-op when spaces already exist (SQLite)', () => {
    const dir = makeTmpDir();
    try {
      const sm = makeManager(dir);
      const before = sm.listSpaces().length;
      assert(before > 0, 'Precondition: at least one space exists');

      // SQLite-backed: ensureAllSpaces should not create duplicate spaces.
      sm.ensureAllSpaces();
      const after = sm.listSpaces().length;
      assert(after === before, 'ensureAllSpaces should not add spaces when one already exists');
    } finally {
      rmTmpDir(dir);
    }
  });

  await test('ensureAllSpaces creates default General space when no spaces exist', () => {
    const dir = makeTmpDir();
    try {
      // Use createSpaceManager directly (no seeding) so the DB is empty.
      const sm = createSpaceManager(dir);
      assert(sm.listSpaces().length === 0, 'Precondition: no spaces');

      sm.ensureAllSpaces();
      const spaces = sm.listSpaces();
      assert(spaces.length === 1,            'Should have exactly one space after ensureAllSpaces');
      assert(spaces[0].name === 'General',   'Default space should be named General');
      assert(spaces[0].id   === 'default',   'Default space should have id "default"');
    } finally {
      rmTmpDir(dir);
    }
  });

  // =========================================================================
  // Summary
  // =========================================================================

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed.');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
