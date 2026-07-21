'use strict';

/**
 * Tests for src/utils/streamJsonNormalizer.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const { normalize } = require('../src/utils/streamJsonNormalizer');

const FIXTURE_STREAM = path.join(__dirname, 'fixtures', 'stage-0-claudecode.log');

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

test('detects stream-json for a fixture starting with {"type":"system"…}', () => {
  const raw    = fs.readFileSync(FIXTURE_STREAM, 'utf8');
  const result = normalize(raw);
  assert.equal(result.format, 'stream-json');
});

test('detects plain-text for opencode-style ANSI-colored output', () => {
  const raw = '\x1b[32m[opencode]\x1b[0m starting build…\ndone.\n';
  const { format, content } = normalize(raw);
  assert.equal(format, 'plain-text');
  // ANSI stripped:
  assert.ok(!/\x1b\[/.test(content));
  assert.ok(content.includes('[opencode]'));
});

test('empty input → plain-text with empty content', () => {
  const r = normalize('');
  assert.equal(r.format, 'plain-text');
  assert.equal(r.content, '');
  assert.equal(r.bytesIn, 0);
});

test('non-JSON first line → plain-text', () => {
  const r = normalize('some log line\nsecond line');
  assert.equal(r.format, 'plain-text');
});

// ---------------------------------------------------------------------------
// Stream-JSON event dispatch
// ---------------------------------------------------------------------------

test('renders system.init as [system] with short session + model', () => {
  const raw = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abc123', model: 'claude-sonnet-4-6' });
  const r = normalize(raw);
  assert.equal(r.format, 'stream-json');
  assert.equal(r.content, '[system] session=sess-abc model=claude-sonnet-4-6');
});

test('renders assistant.thinking as [thinking] with truncation marker on long text', () => {
  const bigText = 'x'.repeat(1200);
  const raw = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking: bigText }] },
  });
  const r = normalize(raw);
  assert.ok(r.content.startsWith('[thinking] '));
  assert.ok(r.content.includes('… (truncated)'));
  // 500-char cap + prefix + marker < 1200 raw
  assert.ok(r.content.length < 1200);
});

test('renders assistant.text verbatim', () => {
  const raw = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Hello world' }] },
  });
  assert.equal(normalize(raw).content, 'Hello world');
});

test('renders tool_use as [tool] name(json-args)', () => {
  const raw = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x' } }] },
  });
  const r = normalize(raw);
  assert.ok(r.content.startsWith('[tool] Read('));
  assert.ok(r.content.includes('file_path'));
});

test('renders user.tool_result as [result] truncated to 200 chars', () => {
  const big = 'y'.repeat(500);
  const raw = JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: big }] }] },
  });
  const r = normalize(raw);
  assert.ok(r.content.startsWith('[result] '));
  assert.ok(r.content.includes('… (truncated)'));
});

test('rate_limit_event is skipped', () => {
  const raw = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'ok' } }),
  ].join('\n');
  const r = normalize(raw);
  assert.equal(r.content, 'hi');
});

test('system events other than init are skipped', () => {
  const raw = [
    JSON.stringify({ type: 'system', subtype: 'thinking_tokens', tokens: 12 }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
  ].join('\n');
  const r = normalize(raw);
  assert.equal(r.content, 'hi');
});

test('malformed JSON line is preserved as [?] <raw> and does not throw', () => {
  const raw = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abcd1234', model: 'x' }),
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]',  // truncated
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }),
  ].join('\n');
  const r = normalize(raw);
  assert.ok(r.content.includes('[?] {"type":"assistant"'));
  assert.ok(r.content.includes('done'));
});

test('result event → [result-final] with truncation', () => {
  const raw = JSON.stringify({ type: 'result', result: 'Completed the task successfully.' });
  const r = normalize(raw);
  assert.equal(r.content, '[result-final] Completed the task successfully.');
});

// ---------------------------------------------------------------------------
// Full fixture
// ---------------------------------------------------------------------------

test('full claude fixture → readable text with expected markers', () => {
  const raw = fs.readFileSync(FIXTURE_STREAM, 'utf8');
  const r = normalize(raw);
  assert.equal(r.format, 'stream-json');
  assert.ok(r.content.includes('[system]'));
  assert.ok(r.content.includes('[tool] Read('));
  assert.ok(r.content.includes('[result] '));
  assert.ok(r.content.includes('[result-final] '));
  assert.ok(!r.content.includes('rate_limit_event')); // rate_limit skipped
});

// ---------------------------------------------------------------------------
// raw + tail + byte cap
// ---------------------------------------------------------------------------

test('raw:true bypasses normalization and returns original bytes (with format detected)', () => {
  const raw = fs.readFileSync(FIXTURE_STREAM, 'utf8');
  const r = normalize(raw, { raw: true });
  assert.equal(r.format, 'stream-json');
  // Raw content still contains the {"type":"system" prefix
  assert.ok(r.content.includes('{"type":"system"'));
});

test('tail:N returns last N \\n-split lines of normalized content', () => {
  const raw = fs.readFileSync(FIXTURE_STREAM, 'utf8');
  const full = normalize(raw);
  const tailed = normalize(raw, { tail: 2 });
  const lines = tailed.content.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(tailed.truncated, full.linesOut > 2);
});

test('tail larger than content leaves content untouched and truncated:false', () => {
  const raw = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'only-line' }] } });
  const r = normalize(raw, { tail: 100 });
  assert.equal(r.content, 'only-line');
  assert.equal(r.truncated, false);
});

test('output over maxBytes is truncated with leading marker and truncated:true', () => {
  // Force a huge normalized output via long assistant text blocks.
  const blocks = [];
  for (let i = 0; i < 200; i++) {
    blocks.push(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'a'.repeat(2000) }] },
    }));
  }
  const raw = blocks.join('\n');
  const r = normalize(raw, { maxBytes: 4096 });
  assert.equal(r.truncated, true);
  assert.ok(r.content.startsWith('… (truncated:'));
  assert.ok(Buffer.byteLength(r.content, 'utf8') <= 4096 + 200); // marker overhead
});

test('bytesIn reflects input byte length regardless of raw flag', () => {
  const raw = 'hello';
  assert.equal(normalize(raw).bytesIn, 5);
  assert.equal(normalize(raw, { raw: true }).bytesIn, 5);
});

test('linesOut counts newline-separated segments of the returned content', () => {
  const r = normalize('a\nb\nc');
  assert.equal(r.linesOut, 3);
});
