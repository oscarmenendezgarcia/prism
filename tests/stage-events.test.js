/**
 * HTTP integration tests for GET /api/v1/runs/:runId/stages/:stageIndex/events
 * (T-001 QA pass: new endpoint added in pipeline-stage-logs-ui feature)
 *
 * Covers:
 *   - 404: run not found
 *   - 404: stage index out of bounds
 *   - 425: log file not yet created (Too Early)
 *   - 200: response schema (schemaVersion, events, nextSince, complete, stageStatus)
 *   - 200: events from golden fixture — kinds present, ordering, uniqueness
 *   - ?since= cursor: incremental polling semantics
 *   - ?since= invalid (non-integer / negative): 400 INVALID_SINCE
 *
 * Run with: node --test tests/stage-events.test.js
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_LOG = path.join(__dirname, 'fixtures', 'stage-0-claudecode.log');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-events-test-'));
}

function startTestServer() {
  return new Promise((resolve) => {
    const dataDir = tmpDir();
    const { startServer } = require('../server');
    const server = startServer({ port: 0, dataDir, silent: true });
    server.once('listening', () => {
      const port = server.address().port;

      function request(method, urlPath, body) {
        return new Promise((res, rej) => {
          const payload = body !== undefined ? JSON.stringify(body) : undefined;
          const options = {
            hostname: 'localhost', port, path: urlPath, method,
            headers: {
              'Content-Type': 'application/json', 'Connection': 'close',
              ...(payload !== undefined && { 'Content-Length': Buffer.byteLength(payload) }),
            },
          };
          const req = http.request(options, (r) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
              res({ status: r.statusCode, headers: r.headers, body: parsed });
            });
          });
          req.on('error', rej);
          if (payload !== undefined) req.write(payload);
          req.end();
        });
      }

      resolve({
        server,
        baseUrl: `http://localhost:${port}`,
        dataDir,
        port,
        request,
        close: () => new Promise((r) => {
          server.close(r);
          try { server._store && server._store.close(); } catch {}
        }),
      });
    });
  });
}

async function setupSpaceAndTask(ctx) {
  const spaceRes = await ctx.request('POST', '/api/v1/spaces', {
    name: `test-space-${crypto.randomUUID().slice(0, 8)}`,
  });
  const spaceId = spaceRes.body.id;
  const taskRes = await ctx.request('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Test task', type: 'feature',
  });
  return { spaceId, taskId: taskRes.body.id };
}

async function createRun(ctx) {
  const { spaceId, taskId } = await setupSpaceAndTask(ctx);
  const createRes = await ctx.request('POST', '/api/v1/runs', {
    spaceId, taskId, stages: ['developer-agent'],
  });
  assert.equal(createRes.status, 201, `Create run failed: ${JSON.stringify(createRes.body)}`);
  await new Promise((r) => setTimeout(r, 150));
  return createRes.body.runId;
}

function writeFixtureLog(ctx, runId) {
  const { runsDir } = require('../src/services/logMetrics');
  const runPath = path.join(runsDir(ctx.dataDir), runId);
  fs.copyFileSync(FIXTURE_LOG, path.join(runPath, 'stage-0.log'));
}

// ---------------------------------------------------------------------------
// Test suite — error cases (each needs its own run; grouped together)
// ---------------------------------------------------------------------------

describe('HTTP GET /events — error cases', () => {
  let ctx;

  before(async () => {
    process.env.PIPELINE_NO_SPAWN = '1';
    ctx = await startTestServer();
  });

  after(async () => {
    delete process.env.PIPELINE_NO_SPAWN;
    await ctx.close();
  });

  test('404 RUN_NOT_FOUND for unknown runId', async () => {
    const { status, body } = await ctx.request('GET', '/api/v1/runs/nonexistent-id/stages/0/events');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'RUN_NOT_FOUND');
  });

  test('404 STAGE_NOT_FOUND for stageIndex out of bounds', async () => {
    const runId = await createRun(ctx);
    const { status, body } = await ctx.request('GET', `/api/v1/runs/${runId}/stages/99/events`);
    assert.equal(status, 404);
    assert.equal(body.error.code, 'STAGE_NOT_FOUND');
  });

  test('425 LOG_NOT_READY when stage has no log file', async () => {
    const runId = await createRun(ctx);
    const { status, body } = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events`);
    assert.equal(status, 425);
    assert.equal(body.error.code, 'LOG_NOT_READY');
    assert.ok(body.error.suggestion, 'Should include a suggestion in the error body');
  });

  test('400 INVALID_SINCE for non-integer since param', async () => {
    const runId = await createRun(ctx);
    writeFixtureLog(ctx, runId);
    const { status, body } = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events?since=abc`);
    assert.equal(status, 400);
    assert.equal(body.error.code, 'INVALID_SINCE');
  });

  test('400 INVALID_SINCE for negative since param', async () => {
    const runId = await createRun(ctx);
    writeFixtureLog(ctx, runId);
    const { status, body } = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events?since=-1`);
    assert.equal(status, 400);
    assert.equal(body.error.code, 'INVALID_SINCE');
  });
});

// ---------------------------------------------------------------------------
// Test suite — happy path (share a single run with log to stay under limit)
// ---------------------------------------------------------------------------

describe('HTTP GET /events — happy path', () => {
  let ctx;
  let runId;
  let allEventsRes;

  before(async () => {
    process.env.PIPELINE_NO_SPAWN = '1';
    ctx     = await startTestServer();
    runId   = await createRun(ctx);
    writeFixtureLog(ctx, runId);

    // Cache one full fetch for tests that only need to inspect the result.
    allEventsRes = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events`);
    assert.equal(allEventsRes.status, 200, `Setup fetch failed: ${JSON.stringify(allEventsRes.body)}`);
  });

  after(async () => {
    delete process.env.PIPELINE_NO_SPAWN;
    await ctx.close();
  });

  // ── Response schema ────────────────────────────────────────────────────────

  test('response has correct top-level fields', () => {
    const { body } = allEventsRes;
    assert.equal(body.schemaVersion, 1);
    assert.ok(Array.isArray(body.events),      'events must be array');
    assert.equal(typeof body.nextSince,  'number',  'nextSince must be number');
    assert.equal(typeof body.complete,   'boolean', 'complete must be boolean');
    assert.equal(typeof body.stageStatus,'string',  'stageStatus must be string');
  });

  test('Content-Type is application/json', () => {
    const ct = allEventsRes.headers['content-type'] ?? '';
    assert.ok(ct.includes('application/json'), `Expected application/json, got: ${ct}`);
  });

  // ── Event list ─────────────────────────────────────────────────────────────

  test('golden fixture produces at least one event', () => {
    assert.ok(allEventsRes.body.events.length > 0);
  });

  test('all events have idx (number), kind (string), t (number)', () => {
    for (const ev of allEventsRes.body.events) {
      assert.equal(typeof ev.idx,  'number', `idx not number in ${JSON.stringify(ev)}`);
      assert.equal(typeof ev.kind, 'string', `kind not string in ${JSON.stringify(ev)}`);
      assert.equal(typeof ev.t,    'number', `t not number in ${JSON.stringify(ev)}`);
    }
  });

  test('events are ordered by idx ascending', () => {
    const idxValues = allEventsRes.body.events.map((e) => e.idx);
    for (let i = 1; i < idxValues.length; i++) {
      assert.ok(idxValues[i] > idxValues[i - 1],
        `idx not ascending: ${idxValues[i - 1]} then ${idxValues[i]}`);
    }
  });

  test('idx values are unique', () => {
    const events = allEventsRes.body.events;
    const idxSet = new Set(events.map((e) => e.idx));
    assert.equal(idxSet.size, events.length, 'Duplicate idx values found');
  });

  test('first event kind is session_start', () => {
    const first = allEventsRes.body.events[0];
    assert.equal(first.kind, 'session_start', `Expected session_start, got ${first.kind}`);
  });

  test('fixture contains tool_call and tool_result events', () => {
    const kinds = new Set(allEventsRes.body.events.map((e) => e.kind));
    assert.ok(kinds.has('tool_call'),   'Missing tool_call kind');
    assert.ok(kinds.has('tool_result'), 'Missing tool_result kind');
  });

  test('tool_call events have id, name, inputPreview string fields', () => {
    const toolCalls = allEventsRes.body.events.filter((e) => e.kind === 'tool_call');
    assert.ok(toolCalls.length > 0);
    for (const ev of toolCalls) {
      assert.equal(typeof ev.id,           'string');
      assert.equal(typeof ev.name,         'string');
      assert.equal(typeof ev.inputPreview, 'string');
    }
  });

  test('tool_result events have id (string), isError (boolean), bytes (number)', () => {
    const results = allEventsRes.body.events.filter((e) => e.kind === 'tool_result');
    assert.ok(results.length > 0);
    for (const ev of results) {
      assert.equal(typeof ev.id,      'string');
      assert.equal(typeof ev.isError, 'boolean');
      assert.equal(typeof ev.bytes,   'number');
    }
  });

  test('inputPreview is capped at ≤ 200 bytes', () => {
    const toolCalls = allEventsRes.body.events.filter((e) => e.kind === 'tool_call');
    for (const ev of toolCalls) {
      const byteLen = Buffer.byteLength(ev.inputPreview ?? '', 'utf8');
      assert.ok(byteLen <= 200, `inputPreview ${byteLen} bytes > 200 cap`);
    }
  });

  test('complete=true for small golden fixture', () => {
    assert.equal(allEventsRes.body.complete, true);
  });

  test('nextSince >= event count when complete=true', () => {
    const { body } = allEventsRes;
    assert.ok(body.nextSince >= body.events.length,
      `nextSince (${body.nextSince}) < event count (${body.events.length})`);
  });

  // ── ?since= cursor ──────────────────────────────────────────────────────────

  test('?since=0 returns same count as no since param', async () => {
    const res = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events?since=0`);
    assert.equal(res.status, 200);
    assert.equal(res.body.events.length, allEventsRes.body.events.length);
  });

  test('?since=N returns only events with idx >= N', async () => {
    const events = allEventsRes.body.events;
    // Need at least 2 events.
    assert.ok(events.length >= 2, 'Golden fixture needs ≥ 2 events for since test');

    const sinceIdx = events[1].idx;
    const { body } = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events?since=${sinceIdx}`);
    assert.equal(body.events.length, events.length - 1,
      'since=1st-event-idx should drop the first event');
    for (const ev of body.events) {
      assert.ok(ev.idx >= sinceIdx, `idx ${ev.idx} < since ${sinceIdx}`);
    }
  });

  test('?since=<nextSince> returns 0 new events for a stable log', async () => {
    const nextSince = allEventsRes.body.nextSince;
    const { body } = await ctx.request('GET', `/api/v1/runs/${runId}/stages/0/events?since=${nextSince}`);
    assert.equal(body.events.length, 0, 'No new events beyond nextSince for a stable log');
  });
});
