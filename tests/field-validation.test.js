'use strict';

/**
 * Field-validation tests — the invariant the shared-field-validation refactor
 * exists to protect. Blueprint §5.
 *
 *   1. Unit tests for the exported helpers (validateFieldLength +
 *      validateOptionalStringField) — no HTTP, no Store.
 *   2. Create/update parity — for each of title/description/assigned/arc, an
 *      over-limit value must return 400 on BOTH POST and PUT with byte-identical
 *      error.message. This is the regression net: if a future edit touches only
 *      one path, this test fails.
 *   3. Presence-message distinctness — POST {} vs PUT {title:''} must keep
 *      emitting DIFFERENT messages ("is required and ..." vs "must be ...").
 *      Guards against an over-eager unification.
 *
 * Run with:
 *   node --test tests/field-validation.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');

const {
  validateFieldLength,
  validateOptionalStringField,
} = require('../src/handlers/tasks');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const post = (p, path, body) => request(p, 'POST', path, body);
const put  = (p, path, body) => request(p, 'PUT',  path, body);

// ---------------------------------------------------------------------------
// 1. Unit tests — validateFieldLength
// ---------------------------------------------------------------------------

describe('validateFieldLength', () => {
  it('returns null at exactly max', () => {
    assert.equal(validateFieldLength('title', 'a'.repeat(200), 200), null);
  });

  it('returns error at max + 1', () => {
    assert.equal(
      validateFieldLength('title', 'a'.repeat(201), 200),
      'title must not exceed 200 characters',
    );
  });

  it('measures AFTER trim — trailing whitespace does not count', () => {
    assert.equal(
      validateFieldLength('title', 'a'.repeat(200) + '   ', 200),
      null,
    );
  });

  it('embeds the field name and max in the message template', () => {
    assert.equal(
      validateFieldLength('arc', 'x'.repeat(61), 60),
      'arc must not exceed 60 characters',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Unit tests — validateOptionalStringField
// ---------------------------------------------------------------------------

describe('validateOptionalStringField', () => {
  const CASES = [
    ['number',  42],
    ['null',    null],
    ['object',  {}],
    ['array',   []],
    ['boolean', true],
  ];

  for (const [label, value] of CASES) {
    it(`returns type-guard message for ${label}`, () => {
      assert.equal(
        validateOptionalStringField('arc', value, 60),
        'arc must be a string when provided',
      );
    });
  }

  it('delegates length to validateFieldLength for strings', () => {
    assert.equal(validateOptionalStringField('arc', 'x'.repeat(60), 60), null);
    assert.equal(
      validateOptionalStringField('arc', 'x'.repeat(61), 60),
      'arc must not exceed 60 characters',
    );
  });

  it('trims before measuring', () => {
    assert.equal(
      validateOptionalStringField('arc', 'x'.repeat(60) + '   ', 60),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP integration — parity and presence semantics
// ---------------------------------------------------------------------------

// Field name → (max length, over-limit builder).
// title/description/assigned/arc are the four fields covered by the shared
// helpers. Presence semantics for title differ between POST and PUT, but the
// LENGTH message must be identical — that is the invariant under test.
const FIELDS = [
  { name: 'title',       max: 200 },
  { name: 'description', max: 1000 },
  { name: 'assigned',    max: 50 },
  { name: 'arc',         max: 60 },
];

describe('Field-length validation — create/update parity', () => {
  let server, port, spaceCounter = 0;

  before(async () => {
    server = await startTestServer();
    port   = server.port;
  });

  after(async () => {
    await server.close();
  });

  async function createSpace() {
    spaceCounter++;
    const res = await post(port, '/api/v1/spaces', { name: `Parity ${spaceCounter}` });
    assert.equal(res.status, 201, `space create failed: ${JSON.stringify(res.body)}`);
    return res.body.id;
  }

  for (const { name, max } of FIELDS) {
    it(`POST and PUT return the SAME message when '${name}' exceeds ${max} chars`, async () => {
      const spaceId = await createSpace();

      // Seed a valid task so we have something to PUT against.
      const seed = await post(port, `/api/v1/spaces/${spaceId}/tasks`, {
        title: 'Seed', type: 'feature',
      });
      assert.equal(seed.status, 201, `seed failed: ${JSON.stringify(seed.body)}`);
      const taskId = seed.body.id;

      const overLimit = 'x'.repeat(max + 1);

      // Build a valid base payload for POST and inject the over-limit value.
      const postBody = { title: 'Ok Title', type: 'feature', [name]: overLimit };
      const putBody  = { [name]: overLimit };

      const postRes = await post(port, `/api/v1/spaces/${spaceId}/tasks`, postBody);
      const putRes  = await put(port,  `/api/v1/spaces/${spaceId}/tasks/${taskId}`, putBody);

      assert.equal(postRes.status, 400, `POST expected 400, got ${postRes.status}: ${JSON.stringify(postRes.body)}`);
      assert.equal(putRes.status,  400, `PUT expected 400, got ${putRes.status}: ${JSON.stringify(putRes.body)}`);
      assert.equal(postRes.body.error?.code, 'VALIDATION_ERROR');
      assert.equal(putRes.body.error?.code,  'VALIDATION_ERROR');

      const expected = `${name} must not exceed ${max} characters`;
      assert.equal(
        postRes.body.error.message,
        expected,
        `POST message drifted from the shared template for ${name}`,
      );
      assert.equal(
        putRes.body.error.message,
        expected,
        `PUT message drifted from the shared template for ${name}`,
      );
      // The load-bearing assertion — byte-for-byte parity between paths.
      assert.equal(postRes.body.error.message, putRes.body.error.message);
    });
  }

  it('POST and PUT return the SAME type-guard message for non-string optional fields', async () => {
    const spaceId = await createSpace();
    const seed = await post(port, `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Seed', type: 'feature',
    });
    const taskId = seed.body.id;

    for (const name of ['description', 'assigned', 'arc']) {
      const postRes = await post(port, `/api/v1/spaces/${spaceId}/tasks`, {
        title: 'Ok', type: 'feature', [name]: 123,
      });
      const putRes = await put(port, `/api/v1/spaces/${spaceId}/tasks/${taskId}`, {
        [name]: 123,
      });

      const expected = `${name} must be a string when provided`;
      assert.equal(postRes.status, 400);
      assert.equal(putRes.status,  400);
      assert.equal(postRes.body.error.message, expected);
      assert.equal(putRes.body.error.message,  expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Presence messages MUST stay distinct — guards against over-unification.
// ---------------------------------------------------------------------------

describe('Presence semantics stay path-specific', () => {
  let server, port;

  before(async () => {
    server = await startTestServer();
    port   = server.port;
  });

  after(async () => {
    await server.close();
  });

  it("POST with no title says 'is required and ...'", async () => {
    const space = await post(port, '/api/v1/spaces', { name: 'Presence C' });
    const res = await post(port, `/api/v1/spaces/${space.body.id}/tasks`, {
      type: 'feature',
    });
    assert.equal(res.status, 400);
    assert.match(
      res.body.error.message,
      /title is required and must be a non-empty string/,
    );
  });

  it("PUT with empty title says 'must be a non-empty string' (no 'is required')", async () => {
    const space = await post(port, '/api/v1/spaces', { name: 'Presence U' });
    const seed  = await post(port, `/api/v1/spaces/${space.body.id}/tasks`, {
      title: 'Seed', type: 'feature',
    });
    const res = await put(port, `/api/v1/spaces/${space.body.id}/tasks/${seed.body.id}`, {
      title: '   ',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'title must be a non-empty string');
    assert.doesNotMatch(res.body.error.message, /is required/);
  });
});
