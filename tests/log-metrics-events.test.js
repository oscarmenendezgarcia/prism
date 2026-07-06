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

describe('projectEvents — final_result is exempt from the since cursor only for livePlainSummary', () => {
  // The plain-text adapter re-derives its single final_result event fresh on
  // every parse (idx always 0) as a still-running stage's log grows. Once a
  // poller has since=1 (having already seen idx 0 once), gating on the cursor
  // would filter it out forever — freezing the summary at its first fetch.
  // parseStageEvents() sets livePlainSummary from the actually-selected
  // adapter (adapter.name === 'plain'), never from the event's own shape —
  // Claude Code's final_result ALSO carries a `summary` (its `result` field),
  // but is a true one-time terminal event and must stay gated like anything
  // else, or a stable/completed log would never converge to "0 new events".
  test('is still returned past its idx (0) when livePlainSummary is true', async () => {
    const { events } = await projectEvents(single({
      kind: 'final_result', t: 42, durationMs: null, numTurns: null, costUsd: null,
      stopReason: null, summary: 'Now at line 42.',
    }), { since: 1, livePlainSummary: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, 'Now at line 42.');
  });

  test('stays gated on since when livePlainSummary is false (Claude Code), even with a summary', () => {
    return projectEvents(single({
      kind: 'final_result', t: 5, durationMs: 30000, numTurns: 4, costUsd: 0.02,
      stopReason: 'end_turn', summary: 'Completed the task successfully.',
    }), { since: 1, livePlainSummary: false }).then(({ events }) => {
      assert.equal(events.length, 0);
    });
  });

  test('other event kinds are still gated on since as before', async () => {
    async function* stream() {
      yield { kind: 'assistant_text', t: 0, bytes: 10, preview: 'first' };
      yield { kind: 'assistant_text', t: 1, bytes: 10, preview: 'second' };
    }
    const { events } = await projectEvents(stream(), { since: 1 });
    assert.equal(events.length, 1);
    assert.equal(events[0].preview, 'second');
  });
});
