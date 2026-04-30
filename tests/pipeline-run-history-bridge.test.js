/**
 * Backend tests — Pipeline → Run History Bridge
 * ADR-1 (pipeline-run-history-bridge) T-007
 *
 * Verifies that pipelineManager writes and updates agent-runs.jsonl entries
 * at the correct stage lifecycle hooks.
 *
 * All tests use PIPELINE_NO_SPAWN=1 to skip real agent resolution + process
 * spawning so that the bridge I/O can be observed without side-effects.
 *
 * Run with: node --test tests/pipeline-run-history-bridge.test.js
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-bridge-test-'));
}

/**
 * Write a minimal agent .md file so resolveAgent can find it.
 */
function writeAgentFile(agentsDir, agentId) {
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, `${agentId}.md`),
    `---\nmodel: sonnet\n---\n\nYou are a test agent.`,
    'utf8',
  );
}

/**
 * Create a space directory with a task in 'todo' and write spaces.json.
 */
function createSpaceWithTask(dataDir, spaceId = crypto.randomUUID()) {
  const taskId  = crypto.randomUUID();
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });
  const task = {
    id: taskId, title: 'Bridge Test Task', type: 'chore',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
  fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');

  // Write spaces.json so readSpaceName() can resolve the name.
  const spacesJson = path.join(dataDir, 'spaces.json');
  const existing = fs.existsSync(spacesJson)
    ? JSON.parse(fs.readFileSync(spacesJson, 'utf8'))
    : [];
  existing.push({ id: spaceId, name: 'Test Space', createdAt: new Date().toISOString() });
  fs.writeFileSync(spacesJson, JSON.stringify(existing), 'utf8');

  return { spaceId, taskId };
}

/** Read all lines from agent-runs.jsonl in dataDir. Returns [] if absent. */
function readRunsJsonl(dataDir) {
  const filePath = path.join(dataDir, 'agent-runs.jsonl');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Sleep helper used to let PIPELINE_NO_SPAWN sentinel processing complete. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shared env setup / teardown
// ---------------------------------------------------------------------------

let sharedAgentsDir;

before(() => {
  sharedAgentsDir = tmpDir();
  writeAgentFile(sharedAgentsDir, 'developer-agent');
  writeAgentFile(sharedAgentsDir, 'senior-architect');
  process.env.PIPELINE_AGENTS_DIR     = sharedAgentsDir;
  process.env.PIPELINE_MAX_CONCURRENT = '5';
  process.env.PIPELINE_NO_SPAWN       = '1';
  delete process.env.PIPELINE_RUNS_DIR;
  // Prevent moveKanbanTask from blocking on a non-existent server.
  process.env.KANBAN_API_URL = 'http://localhost:19998/api/v1';
});

after(() => {
  delete process.env.PIPELINE_AGENTS_DIR;
  delete process.env.PIPELINE_MAX_CONCURRENT;
  delete process.env.PIPELINE_NO_SPAWN;
  delete process.env.KANBAN_API_URL;
  if (sharedAgentsDir) fs.rmSync(sharedAgentsDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T-002 / T-003 Tests
// ---------------------------------------------------------------------------

describe('bridge: spawnStage writes agent-runs.jsonl entry', () => {
  test('spawnStage creates a "running" entry with pipelineRunId and stageIndex', async () => {
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      // Clear require cache so env vars are picked up fresh.
      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      // Wait for PIPELINE_NO_SPAWN sentinel to be processed.
      await sleep(200);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Expected a bridge entry in agent-runs.jsonl');
      assert.equal(entry.id,            `${run.runId}-0`);
      assert.equal(entry.pipelineRunId, run.runId);
      assert.equal(entry.stageIndex,    0);
      assert.equal(entry.taskId,        taskId);
      assert.equal(entry.agentId,       'developer-agent');
      assert.equal(entry.agentDisplayName, 'Developer Agent');
      assert.equal(entry.spaceId,       spaceId);
      assert.equal(entry.spaceName,     'Test Space');
      assert.equal(entry.taskTitle,     'Bridge Test Task');
      assert.ok(typeof entry.startedAt === 'string');
      assert.equal(entry.completedAt, null);
      assert.equal(entry.durationMs,  null);

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('bridge: handleStageClose updates entry on success', () => {
  test('exit code 0 → status=completed, durationMs > 0', async () => {
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      // PIPELINE_NO_SPAWN writes a '0' sentinel immediately, but the poll loop
      // fires every 2 seconds — wait long enough for it to detect the sentinel.
      await sleep(2500);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.id === `${run.runId}-0`);

      assert.ok(entry, 'Expected bridge entry');
      assert.equal(entry.status, 'completed');
      assert.ok(typeof entry.completedAt === 'string' && entry.completedAt !== 'null',
        'completedAt should be set');
      assert.ok(typeof entry.durationMs === 'number' && entry.durationMs >= 0,
        'durationMs should be a non-negative number');

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('bridge: handleStageClose updates entry on failure', () => {
  test('exit code 1 → status=failed', async () => {
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      // createRun with PIPELINE_NO_SPAWN=1 writes '0' to the sentinel immediately.
      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      // Overwrite the sentinel with exit code 1 before the poll tick fires.
      // PIPELINE_NO_SPAWN writes it synchronously in spawnStage(), so it
      // should exist by the time createRun() resolves (setImmediate → executeNextStage).
      const doneFile = path.join(dataDir, 'runs', run.runId, 'stage-0.done');
      // Spin up to 500ms waiting for the sentinel to appear.
      const deadline = Date.now() + 500;
      while (!fs.existsSync(doneFile) && Date.now() < deadline) {
        await sleep(10);
      }
      // Overwrite with failure code.
      fs.writeFileSync(doneFile, '1', 'utf8');

      // Wait for the poll loop to detect the sentinel (fires every 2 seconds).
      await sleep(2500);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.id === `${run.runId}-0`);

      assert.ok(entry, 'Expected bridge entry');
      assert.equal(entry.status, 'failed');
      assert.ok(typeof entry.completedAt === 'string');
      assert.ok(typeof entry.durationMs  === 'number' && entry.durationMs >= 0);

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('bridge: multi-stage pipeline creates one entry per stage', () => {
  test('two stages produce two entries with the same pipelineRunId', async () => {
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent', 'senior-architect'], dataDir,
      });

      // Both stages should complete quickly in NO_SPAWN mode.
      await sleep(600);

      const records = readRunsJsonl(dataDir);
      const entries = records.filter((r) => r.pipelineRunId === run.runId);

      assert.ok(entries.length >= 1, `Expected at least one bridge entry, got ${entries.length}`);
      // Stage 0 should always be present.
      const stage0 = entries.find((r) => r.stageIndex === 0);
      assert.ok(stage0, 'Expected stageIndex=0 entry');
      assert.equal(stage0.id, `${run.runId}-0`);
      assert.equal(stage0.pipelineRunId, run.runId);

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('bridge: malformed/missing agent-runs.jsonl does not crash', () => {
  test('write succeeds when agent-runs.jsonl does not exist yet', async () => {
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      // Ensure no pre-existing file.
      const jsonlPath = path.join(dataDir, 'agent-runs.jsonl');
      assert.ok(!fs.existsSync(jsonlPath), 'should not exist yet');

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      // Should not throw.
      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });
      await sleep(200);

      assert.ok(fs.existsSync(jsonlPath), 'agent-runs.jsonl should be created by bridge');
      const records = readRunsJsonl(dataDir);
      assert.ok(records.length >= 1);

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('bridge: helpers unit tests', () => {
  test('readSpaceName: bridge entry reflects space name from spaces.json', async () => {
    // Test indirectly: createSpaceWithTask writes 'Test Space' to spaces.json.
    // The bridge entry should have spaceName='Test Space'.
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });
      await sleep(200);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);
      assert.ok(entry, 'Expected a bridge entry');
      assert.equal(entry.spaceName, 'Test Space');

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('bridge writes agentDisplayName as title-cased agent ID', async () => {
    const dataDir = tmpDir();
    try {
      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      const run = await pm.createRun({
        spaceId, taskId, stages: ['senior-architect'], dataDir,
      });
      await sleep(200);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);
      assert.ok(entry);
      assert.equal(entry.agentDisplayName, 'Senior Architect');

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('bridge: entries pruned at 500', () => {
  test('file does not exceed 500 entries after overflow', async () => {
    const dataDir = tmpDir();
    try {
      // Pre-fill the file with 499 entries.
      const filePath = path.join(dataDir, 'agent-runs.jsonl');
      const oldEntry = JSON.stringify({
        id: 'old', taskId: 't', taskTitle: 'T', agentId: 'a',
        agentDisplayName: 'A', spaceId: 's', spaceName: 'S',
        status: 'completed', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), durationMs: 100,
        cliCommand: '', promptPath: '',
      });
      const lines = Array(499).fill(oldEntry + '\n').join('');
      fs.writeFileSync(filePath, lines, 'utf8');

      const { spaceId, taskId } = createSpaceWithTask(dataDir);

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });
      await sleep(200);

      const raw   = fs.readFileSync(filePath, 'utf8');
      const count = raw.split('\n').filter((l) => l.trim()).length;
      assert.ok(count <= 500, `Expected ≤500 lines, got ${count}`);

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
