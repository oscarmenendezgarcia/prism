'use strict';

/**
 * Harness discovery — GET /api/v1/harnesses
 *
 * Verifies the endpoint reports every known harness with availability,
 * resolved path, model format, and an install link — regardless of which CLIs
 * happen to be installed on the machine running the test.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { handleGetHarnesses } = require('../src/handlers/harnesses');

function makeRes() {
  return {
    _status: 0,
    _body: null,
    writeHead(status) { this._status = status; },
    end(payload) { this._body = payload ? JSON.parse(payload) : null; },
  };
}

describe('GET /api/v1/harnesses', () => {
  it('returns 200 with all four harnesses', () => {
    const res = makeRes();
    handleGetHarnesses({}, res);
    assert.equal(res._status, 200);
    assert.ok(Array.isArray(res._body.harnesses));
    const tools = res._body.harnesses.map((h) => h.cliTool).sort();
    assert.deepEqual(tools, ['claude', 'hermes', 'opencode', 'pi']);
  });

  it('reports a shape per harness (availability, path, model format, install link)', () => {
    const res = makeRes();
    handleGetHarnesses({}, res);
    for (const h of res._body.harnesses) {
      assert.equal(typeof h.available, 'boolean');
      assert.ok(h.path === null || typeof h.path === 'string');
      assert.equal(typeof h.modelFormat, 'string');
      assert.ok(h.modelFormat === 'preset' || h.modelFormat === 'provider/model');
      assert.ok(typeof h.installUrl === 'string' && h.installUrl.startsWith('http'));
      assert.equal(typeof h.cliTool, 'string');
    }
  });

  it('marks each harness available only when its binary resolves', () => {
    const res = makeRes();
    handleGetHarnesses({}, res);
    const claude = res._body.harnesses.find((h) => h.cliTool === 'claude');
    // claude resolves to either an absolute path or the bare fallback name.
    assert.equal(claude.available, typeof claude.path === 'string' && claude.path !== 'claude');
  });
});
