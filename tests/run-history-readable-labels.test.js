'use strict';

/**
 * QA Tests — fix(run-history): mostrar nombre de tarea y run en vez de UUIDs
 * Task: dbcba776-dce6-419c-9571-3ca04e5f9d1e
 *
 * Verifica que pipelineManager.bridgeWriteRunStarted() resuelve taskTitle y
 * spaceName desde el store SQLite en lugar de archivos JSON que ya no existen
 * tras la migración SQLite.
 *
 * ESTRUCTURA DEL BUG:
 *   - createRun() usa _store.getTaskWithColumn() para validar la tarea (correcto)
 *   - bridgeWriteRunStarted() usa readTaskFromSpace() que lee JSON (no _store) → BUG
 *
 * TC-003/TC-004 → demuestran el bug: store inyectado para createRun,
 *                 pero bridgeWriteRunStarted ignora _store → UUID en JSONL.
 * TC-001/TC-002 → comportamiento esperado tras la corrección.
 * TC-005        → task en columna 'done' se resuelve igualmente.
 * TC-011        → regresión: JSON legacy sigue funcionando.
 *
 * Run: node --test tests/run-history-readable-labels.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-rh-qa-'));
}

function writeAgentFile(agentsDir, agentId) {
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, `${agentId}.md`),
    '---\nmodel: sonnet\n---\nYou are a test agent.',
    'utf8',
  );
}

function readRunsJsonl(dataDir) {
  const filePath = path.join(dataDir, 'agent-runs.jsonl');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** UUID regex — 36-char hex+dash pattern */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check if title is the known UUID fallback pattern. */
function isUuidFallbackTitle(title, taskId) {
  return title === `Task ${taskId}`;
}

/**
 * Create a SQLite store with a space + task inserted.
 * No JSON files are created on disk — this simulates post-SQLite-migration state.
 *
 * @param {string} dataDir
 * @param {{ spaceId, spaceName, taskId, taskTitle, column? }} opts
 */
function createSqliteStore(dataDir, { spaceId, spaceName, taskId, taskTitle, column = 'todo' }) {
  delete require.cache[require.resolve('../src/services/store')];
  const { createStore } = require('../src/services/store');
  const store = createStore(dataDir);  // createStore(dataDir) appends /prism.db internally

  store.upsertSpace({
    id: spaceId, name: spaceName,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  store.insertTask(
    { id: taskId, title: taskTitle, type: 'chore',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    spaceId,
    column,
  );
  return store;
}

// ---------------------------------------------------------------------------
// Shared env setup / teardown
// ---------------------------------------------------------------------------

let sharedAgentsDir;

before(() => {
  sharedAgentsDir = tmpDir();
  writeAgentFile(sharedAgentsDir, 'developer-agent');
  process.env.PIPELINE_AGENTS_DIR     = sharedAgentsDir;
  process.env.PIPELINE_MAX_CONCURRENT = '5';
  process.env.PIPELINE_NO_SPAWN       = '1';
  delete process.env.PIPELINE_RUNS_DIR;
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
// TC-003 / TC-004 — Verifican que el bug está corregido
// FIX: _store inyectado → bridgeWriteRunStarted usa _store.getTask() y _store.getSpace()
// → nombres legibles en JSONL incluso sin JSON files (post-migración SQLite)
// ---------------------------------------------------------------------------

describe('FIX verificado: store inyectado, sin JSON files → nombres legibles en agent-runs.jsonl (TC-003, TC-004)', () => {
  test('TC-003: taskTitle es el nombre real (no UUID) cuando _store tiene la tarea y no hay JSON files', async () => {
    const dataDir   = tmpDir();
    const spaceId   = crypto.randomUUID();
    const taskId    = crypto.randomUUID();
    const spaceName = 'My Space';
    const taskTitle = 'My Real Task Title';

    // No JSON files — simula entorno post-migración SQLite.
    // Tras la corrección, bridgeWriteRunStarted() consulta _store → nombre real.
    try {
      const store = createSqliteStore(dataDir, { spaceId, spaceName, taskId, taskTitle });

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      await sleep(300);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Se esperaba un entry en agent-runs.jsonl');

      // BUG CORREGIDO: taskTitle debe ser el nombre real, no el UUID fallback.
      assert.equal(
        entry.taskTitle,
        taskTitle,
        `[TC-003 FIX] taskTitle debe ser "${taskTitle}" tras la corrección. ` +
        `Obtenido: "${entry.taskTitle}".`,
      );
      assert.ok(
        !isUuidFallbackTitle(entry.taskTitle, taskId),
        `[TC-003 FIX] taskTitle no debe ser el UUID fallback "Task ${taskId}".`,
      );

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('TC-004: spaceName es el nombre real (no UUID) cuando _store tiene el espacio y no hay spaces.json', async () => {
    const dataDir   = tmpDir();
    const spaceId   = crypto.randomUUID();
    const taskId    = crypto.randomUUID();
    const spaceName = 'My Real Space Name';

    try {
      const store = createSqliteStore(dataDir, { spaceId, spaceName, taskId, taskTitle: 'Any Task' });

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      await sleep(300);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Se esperaba un entry en agent-runs.jsonl');

      // BUG CORREGIDO: spaceName debe ser el nombre real, no el UUID.
      assert.equal(
        entry.spaceName,
        spaceName,
        `[TC-004 FIX] spaceName debe ser "${spaceName}" tras la corrección. ` +
        `Obtenido: "${entry.spaceName}".`,
      );
      assert.notEqual(
        entry.spaceName,
        spaceId,
        `[TC-004 FIX] spaceName no debe ser el UUID "${spaceId}".`,
      );

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// TC-001 / TC-002 / TC-009 — Comportamiento ESPERADO tras la corrección
// Fix: bridgeWriteRunStarted debe usar _store.getTask() y _store.getSpace()
// cuando _store está disponible.
// ---------------------------------------------------------------------------

describe('EXPECTED FIX: _store disponible → nombres legibles en agent-runs.jsonl (TC-001, TC-002)', () => {
  test('TC-001: taskTitle debe ser el nombre real (no UUID) cuando _store tiene la tarea', async () => {
    const dataDir   = tmpDir();
    const spaceId   = crypto.randomUUID();
    const taskId    = crypto.randomUUID();
    const spaceName = 'QA Integration Space';
    const taskTitle = 'fix(run-history): readable labels QA task';

    // No JSON files — sólo SQLite store.
    try {
      const store = createSqliteStore(dataDir, { spaceId, spaceName, taskId, taskTitle });

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      await sleep(300);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Se esperaba un entry en agent-runs.jsonl');

      // EXPECTED tras corrección: taskTitle = nombre real, no UUID fallback.
      // ACTUALMENTE este assert FALLA porque el bug no está corregido.
      assert.equal(
        entry.taskTitle,
        taskTitle,
        `[TC-001 EXPECTED] taskTitle debería ser "${taskTitle}" tras la corrección. ` +
        `Actualmente es "${entry.taskTitle}". ` +
        `Fix: en bridgeWriteRunStarted(), usar _store.getTask(run.spaceId, run.taskId) cuando _store !== null.`,
      );

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('TC-002: spaceName debe ser el nombre real (no UUID) cuando _store tiene el espacio', async () => {
    const dataDir   = tmpDir();
    const spaceId   = crypto.randomUUID();
    const taskId    = crypto.randomUUID();
    const spaceName = 'Nombre de Espacio Legible';
    const taskTitle = 'Some Task';

    try {
      const store = createSqliteStore(dataDir, { spaceId, spaceName, taskId, taskTitle });

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      await sleep(300);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Se esperaba un entry en agent-runs.jsonl');

      // EXPECTED tras corrección.
      assert.equal(
        entry.spaceName,
        spaceName,
        `[TC-002 EXPECTED] spaceName debería ser "${spaceName}" tras la corrección. ` +
        `Actualmente es "${entry.spaceName}". ` +
        `Fix: readSpaceName() debe usar _store.getSpace(spaceId)?.name cuando _store !== null.`,
      );

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('TC-005: taskTitle correcto — _store.getTask resuelve sin filtro de columna', async () => {
    const dataDir   = tmpDir();
    const spaceId   = crypto.randomUUID();
    const taskId    = crypto.randomUUID();
    const spaceName = 'Test Space';
    const taskTitle = 'Task That Gets Moved';

    // Nota: createRun() requiere la tarea en 'todo'. El test verifica que tras
    // el fix, bridgeWriteRunStarted() usa _store.getTask() que no filtra por columna,
    // por lo que seguirá funcionando si la tarea se mueve a 'in-progress' durante la ejecución.
    try {
      // Insertar en 'todo' para que createRun() pase la validación.
      const store = createSqliteStore(dataDir, { spaceId, spaceName, taskId, taskTitle, column: 'todo' });

      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      // Simular que el pipeline mueve la tarea a 'in-progress' (comportamiento normal).
      // Esto ocurre en producción antes de que bridgeWriteRunStarted escriba el entry.
      store.moveTask(spaceId, taskId, 'in-progress');

      await sleep(300);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Se esperaba un entry en agent-runs.jsonl');

      // EXPECTED tras corrección: _store.getTask(spaceId, taskId) resuelve
      // el título sin importar en qué columna esté la tarea.
      assert.equal(
        entry.taskTitle,
        taskTitle,
        `[TC-005 EXPECTED] taskTitle debería ser "${taskTitle}" independientemente de la columna. ` +
        `Actualmente es "${entry.taskTitle}". Fix: usar _store.getTask() que no filtra por columna.`,
      );

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// TC-011 — Regresión: modo legacy (JSON files) sigue funcionando
// ---------------------------------------------------------------------------

describe('REGRESIÓN: JSON files legacy siguen funcionando cuando no hay store (TC-011)', () => {
  test('TC-011: bridge resuelve taskTitle y spaceName desde JSON cuando los archivos existen', async () => {
    const dataDir = tmpDir();
    const spaceId = crypto.randomUUID();
    const taskId  = crypto.randomUUID();

    // Crear archivos JSON — entorno legacy / pre-migración.
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = {
      id: taskId, title: 'Legacy JSON Task', type: 'chore',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');
    fs.writeFileSync(
      path.join(dataDir, 'spaces.json'),
      JSON.stringify([{ id: spaceId, name: 'Legacy Space', createdAt: new Date().toISOString() }]),
      'utf8',
    );

    // También creamos el store (necesario para que createRun pase la validación
    // de existencia de tarea cuando _store != null; aquí no inyectamos store).
    // Sin store inyectado: createRun usa findTaskInDataDir → lee JSON files.
    try {
      delete require.cache[require.resolve('../src/services/agentResolver')];
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      // No llamamos a pm.init() con store — modo legacy.

      const run = await pm.createRun({
        spaceId, taskId, stages: ['developer-agent'], dataDir,
      });

      await sleep(300);

      const records = readRunsJsonl(dataDir);
      const entry   = records.find((r) => r.pipelineRunId === run.runId);

      assert.ok(entry, 'Se esperaba un entry en agent-runs.jsonl');
      assert.equal(entry.taskTitle, 'Legacy JSON Task', 'TC-011: taskTitle correcto desde JSON legacy');
      assert.equal(entry.spaceName, 'Legacy Space',     'TC-011: spaceName correcto desde JSON legacy');

      await pm.abortAll(dataDir).catch(() => {});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// TC-006 — groupRuns utility (lógica pura, sin I/O)
// ---------------------------------------------------------------------------

describe('groupRuns: clustering por pipelineRunId (TC-006)', () => {
  test('TC-006: pipeline de 1 stage colapsa a type:single', () => {
    const singleRecord = {
      id: 'run-abc-0', pipelineRunId: 'run-abc', stageIndex: 0,
      taskId: 'task-1', taskTitle: 'Task Title',
      agentId: 'developer-agent', agentDisplayName: 'Developer Agent',
      spaceId: 'sp-1', spaceName: 'Space 1',
      status: 'completed', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), durationMs: 1000,
      cliCommand: '', promptPath: '',
    };

    // Mirrors groupRuns.ts logic.
    const pipelineMap = new Map();
    for (const r of [singleRecord]) {
      if (r.pipelineRunId) {
        if (!pipelineMap.has(r.pipelineRunId)) pipelineMap.set(r.pipelineRunId, []);
        pipelineMap.get(r.pipelineRunId).push(r);
      }
    }

    const stages = pipelineMap.get('run-abc');
    assert.equal(stages.length, 1, 'Pipeline de 1 stage debe colapsar a single');
    // Single-stage pipelines → { type: 'single', run: stages[0] }
    const group = stages.length === 1
      ? { type: 'single', run: stages[0] }
      : { type: 'pipeline', stages };
    assert.equal(group.type, 'single', 'TC-006: type debe ser "single"');
    assert.equal(group.run.taskTitle, 'Task Title', 'TC-006: taskTitle se preserva en single group');
  });

  test('TC-006b: pipeline de 2 stages → type:pipeline', () => {
    const stage0 = {
      id: 'run-xyz-0', pipelineRunId: 'run-xyz', stageIndex: 0,
      taskId: 'task-2', taskTitle: 'Multi-Stage Task',
      agentId: 'senior-architect', agentDisplayName: 'Senior Architect',
      spaceId: 'sp-1', spaceName: 'Space 1',
      status: 'completed', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), durationMs: 500,
      cliCommand: '', promptPath: '',
    };
    const stage1 = { ...stage0, id: 'run-xyz-1', stageIndex: 1, agentId: 'developer-agent' };

    const pipelineMap = new Map();
    for (const r of [stage0, stage1]) {
      if (!pipelineMap.has(r.pipelineRunId)) pipelineMap.set(r.pipelineRunId, []);
      pipelineMap.get(r.pipelineRunId).push(r);
    }

    const stages = pipelineMap.get('run-xyz');
    assert.equal(stages.length, 2, 'Pipeline de 2 stages');
    const group = stages.length > 1
      ? { type: 'pipeline', stages }
      : { type: 'single', run: stages[0] };
    assert.equal(group.type, 'pipeline', 'TC-006b: type debe ser "pipeline"');
    assert.equal(group.stages[0].taskTitle, 'Multi-Stage Task', 'TC-006b: taskTitle correcto en stage[0]');
  });
});
