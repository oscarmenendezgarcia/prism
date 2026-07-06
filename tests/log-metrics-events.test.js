/**
 * Unit tests for src/services/logMetrics/events.js — projectEvents().
 *
 * Run with: node --test tests/log-metrics-events.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { projectEvents } = require('../src/services/logMetrics/events');

async function* single(ev) {
  yield ev;
}

describe('projectEvents — final_result summary passthrough', () => {
  test('includes summary when the normalized event has one (plain-text adapter)', async () => {
    const { events } = await projectEvents(single({
      kind: 'final_result', t: 5, durationMs: null, numTurns: null, costUsd: null,
      stopReason: null, summary: 'All 75 tests pass.\nBuild succeeded.',
    }));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'final_result');
    assert.equal(events[0].summary, 'All 75 tests pass.\nBuild succeeded.');
  });

  test('omits summary entirely when the normalized event has none (Claude Code adapter)', async () => {
    const { events } = await projectEvents(single({
      kind: 'final_result', t: 5, durationMs: 30000, numTurns: 4, costUsd: 0.02,
      stopReason: 'end_turn',
    }));
    assert.equal(events.length, 1);
    assert.equal('summary' in events[0], false);
  });

  test('caps summary at 4 KB', async () => {
    const longSummary = 'x'.repeat(10_000);
    const { events } = await projectEvents(single({
      kind: 'final_result', t: 1, durationMs: null, numTurns: null, costUsd: null,
      stopReason: null, summary: longSummary,
    }));
    assert.ok(Buffer.byteLength(events[0].summary, 'utf8') <= 4_000);
  });
});
