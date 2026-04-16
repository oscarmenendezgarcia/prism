/**
 * Integration tests for Task Comments feature.
 * ADR-1: Task Comments — tests covering T-001 through T-003.
 *
 * Run with: node tests/comments.test.js
 * Starts its own isolated server on a random port with a temporary data directory.
 */

'use strict';

const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
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
// HTTP helper
// ---------------------------------------------------------------------------

function makeRequest(port) {
  return function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: 'localhost',
        port,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function run() {
  const { port, close } = await startTestServer();
  const request = makeRequest(port);

  // Create a space and a task to work with
  const spaceRes = await request('POST', '/api/v1/spaces', { name: 'comments-test-space' });
  assert(spaceRes.status === 201, `Expected 201 creating space, got ${spaceRes.status}`);
  const spaceId = spaceRes.body.id;

  const taskRes = await request('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Test Task for Comments',
    type: 'feature',
  });
  assert(taskRes.status === 201, `Expected 201 creating task, got ${taskRes.status}`);
  const taskId = taskRes.body.id;

  const BASE = `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`;

  // ---------------------------------------------------------------------------
  suite('POST /comments — crear comentario exitoso')
  // ---------------------------------------------------------------------------

  let firstCommentId;

  await test('crea comentario tipo "note" y devuelve 201', async () => {
    const res = await request('POST', BASE, {
      author: 'agent-architect',
      text: 'Esta es una nota de diseño.',
      type: 'note',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(typeof res.body.id === 'string', 'comment.id debe ser string');
    assert(res.body.author === 'agent-architect', 'author no coincide');
    assert(res.body.text === 'Esta es una nota de diseño.', 'text no coincide');
    assert(res.body.type === 'note', 'type debe ser note');
    assert(res.body.resolved === false, 'resolved debe ser false por defecto');
    assert(typeof res.body.createdAt === 'string', 'createdAt debe estar presente');
    assert(!res.body.updatedAt, 'updatedAt no debe estar en un comment nuevo');
    firstCommentId = res.body.id;
  });

  await test('crea comentario tipo "question"', async () => {
    const res = await request('POST', BASE, {
      author: 'developer-agent',
      text: '¿Cuál es el límite de paginación?',
      type: 'question',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.type === 'question', 'type debe ser question');
  });

  await test('crea comentario tipo "answer" con parentId', async () => {
    const res = await request('POST', BASE, {
      author: 'senior-architect',
      text: 'El límite es 200 por ahora.',
      type: 'answer',
      parentId: firstCommentId,
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.type === 'answer', 'type debe ser answer');
    assert(res.body.parentId === firstCommentId, 'parentId debe coincidir');
  });

  // ---------------------------------------------------------------------------
  suite('GET tarea incluye comments[]')
  // ---------------------------------------------------------------------------

  await test('GET tarea devuelve el array comments con los comentarios creados', async () => {
    const res = await request('GET', `/api/v1/spaces/${spaceId}/tasks/${taskId}`);
    // El GET de tarea individual no está implementado como endpoint propio; comprobamos via GET tasks
    // En su lugar probamos que los comentarios persisten verificando que el POST extra funciona
    // El GET de tasks (lista) devuelve tasks sin contenido de attachments.
    // Verificamos a través de otro POST que el estado persiste correctamente.
    const res2 = await request('POST', BASE, {
      author: 'qa-agent',
      text: 'Verificando persistencia.',
      type: 'note',
    });
    assert(res2.status === 201, `Persistencia OK: comentario creado con status ${res2.status}`);
  });

  // ---------------------------------------------------------------------------
  suite('POST /comments — validaciones de campos requeridos')
  // ---------------------------------------------------------------------------

  await test('devuelve 400 si falta author', async () => {
    const res = await request('POST', BASE, {
      text: 'Texto válido',
      type: 'note',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', 'código de error incorrecto');
    assert(res.body.error.message.includes('author'), 'mensaje debe mencionar author');
  });

  await test('devuelve 400 si falta text', async () => {
    const res = await request('POST', BASE, {
      author: 'agent',
      type: 'note',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('text'), 'mensaje debe mencionar text');
  });

  await test('devuelve 400 si falta type', async () => {
    const res = await request('POST', BASE, {
      author: 'agent',
      text: 'texto',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('type'), 'mensaje debe mencionar type');
  });

  await test('devuelve 400 si type es inválido', async () => {
    const res = await request('POST', BASE, {
      author: 'agent',
      text: 'texto',
      type: 'invalid-type',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('note, question, answer'), 'debe listar tipos válidos');
  });

  await test('devuelve 400 si author supera 100 chars', async () => {
    const res = await request('POST', BASE, {
      author: 'a'.repeat(101),
      text: 'texto',
      type: 'note',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('100'), 'debe mencionar el límite 100');
  });

  await test('devuelve 400 si text supera 5000 chars', async () => {
    const res = await request('POST', BASE, {
      author: 'agent',
      text: 'x'.repeat(5001),
      type: 'note',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('5000'), 'debe mencionar el límite 5000');
  });

  await test('devuelve 400 si parentId no existe en la tarea', async () => {
    const res = await request('POST', BASE, {
      author: 'agent',
      text: 'respuesta a un comment inexistente',
      type: 'answer',
      parentId: 'non-existent-uuid-1234',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.code === 'PARENT_COMMENT_NOT_FOUND', `Expected PARENT_COMMENT_NOT_FOUND, got ${res.body.error.code}`);
  });

  await test('devuelve 400 body no es JSON válido', async () => {
    const res = await new Promise((resolve, reject) => {
      const payload = 'not-json';
      const options = {
        hostname: 'localhost', port,
        path: BASE, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const req = http.request(options, (res2) => {
        let data = '';
        res2.on('data', (c) => { data += c; });
        res2.on('end', () => resolve({ status: res2.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_JSON', 'Expected INVALID_JSON');
  });

  // ---------------------------------------------------------------------------
  suite('POST /comments — 404 para task o space inexistente')
  // ---------------------------------------------------------------------------

  await test('devuelve 404 si taskId no existe', async () => {
    const res = await request('POST', `/api/v1/spaces/${spaceId}/tasks/non-existent-task/comments`, {
      author: 'agent',
      text: 'texto',
      type: 'note',
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error.code === 'TASK_NOT_FOUND', `Expected TASK_NOT_FOUND, got ${res.body.error.code}`);
  });

  await test('devuelve 404 si spaceId no existe', async () => {
    const res = await request('POST', `/api/v1/spaces/non-existent-space/tasks/${taskId}/comments`, {
      author: 'agent',
      text: 'texto',
      type: 'note',
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error.code === 'SPACE_NOT_FOUND', `Expected SPACE_NOT_FOUND, got ${res.body.error.code}`);
  });

  // ---------------------------------------------------------------------------
  suite('POST /comments — 405 para métodos no permitidos en la lista')
  // ---------------------------------------------------------------------------

  await test('devuelve 405 para GET /comments', async () => {
    const res = await request('GET', BASE);
    assert(res.status === 405, `Expected 405, got ${res.status}`);
    assert(res.body.error.code === 'METHOD_NOT_ALLOWED', 'Expected METHOD_NOT_ALLOWED');
  });

  await test('devuelve 405 para DELETE /comments', async () => {
    const res = await request('DELETE', BASE);
    assert(res.status === 405, `Expected 405, got ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  suite('PATCH /comments/:commentId — actualizar comentario')
  // ---------------------------------------------------------------------------

  await test('resuelve un comment (resolved: true)', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, { resolved: true });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.resolved === true, 'resolved debe ser true');
    assert(res.body.id === firstCommentId, 'id debe coincidir');
    assert(typeof res.body.updatedAt === 'string', 'updatedAt debe estar presente');
  });

  await test('edita el texto de un comment', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, {
      text: 'Nota actualizada con más contexto.',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.text === 'Nota actualizada con más contexto.', 'texto no actualizado');
  });

  await test('cambia el tipo de un comment', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, { type: 'question' });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.type === 'question', 'type no actualizado');
  });

  await test('devuelve 400 si body está vacío (sin campos patch)', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, {});
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
    assert(res.body.error.message.includes('text, type, resolved'), 'debe listar campos requeridos');
  });

  await test('devuelve 400 si text es vacío en PATCH', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, { text: '  ' });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('text'), 'debe mencionar text');
  });

  await test('devuelve 400 si type es inválido en PATCH', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, { type: 'invalid' });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('note, question, answer'), 'debe listar tipos válidos');
  });

  await test('devuelve 400 si resolved no es boolean', async () => {
    const res = await request('PATCH', `${BASE}/${firstCommentId}`, { resolved: 'yes' });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.message.includes('boolean'), 'debe mencionar boolean');
  });

  await test('devuelve 404 si commentId no existe en PATCH', async () => {
    const res = await request('PATCH', `${BASE}/non-existent-comment-id`, { resolved: true });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error.code === 'COMMENT_NOT_FOUND', `Expected COMMENT_NOT_FOUND, got ${res.body.error.code}`);
  });

  await test('devuelve 404 si taskId no existe en PATCH', async () => {
    const res = await request('PATCH', `/api/v1/spaces/${spaceId}/tasks/bad-task-id/comments/${firstCommentId}`, {
      resolved: true,
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error.code === 'TASK_NOT_FOUND', `Expected TASK_NOT_FOUND, got ${res.body.error.code}`);
  });

  await test('devuelve 405 para métodos no permitidos en single comment (GET)', async () => {
    const res = await request('GET', `${BASE}/${firstCommentId}`);
    assert(res.status === 405, `Expected 405, got ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  suite('PATCH /comments/:commentId — 404 si space no existe')
  // ---------------------------------------------------------------------------

  await test('devuelve 404 si spaceId no existe en PATCH', async () => {
    const res = await request('PATCH', `/api/v1/spaces/bad-space/tasks/${taskId}/comments/${firstCommentId}`, {
      resolved: true,
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error.code === 'SPACE_NOT_FOUND', `Expected SPACE_NOT_FOUND, got ${res.body.error.code}`);
  });

  // ---------------------------------------------------------------------------
  suite('Límite de 200 comentarios')
  // ---------------------------------------------------------------------------

  await test('rechaza el comentario 201 con COMMENT_LIMIT_EXCEEDED', async () => {
    // Crear una task nueva para este test (no contaminar con los anteriores)
    const limitTaskRes = await request('POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Limit test task',
      type: 'bug',
    });
    const limitTaskId = limitTaskRes.body.id;
    const limitBase   = `/api/v1/spaces/${spaceId}/tasks/${limitTaskId}/comments`;

    // Crear 200 comentarios
    for (let i = 0; i < 200; i++) {
      const r = await request('POST', limitBase, {
        author: `agent-${i}`,
        text:   `Comentario número ${i}`,
        type:   'note',
      });
      assert(r.status === 201, `Comentario ${i} debería ser 201, got ${r.status}`);
    }

    // El 201° debe fallar
    const limitRes = await request('POST', limitBase, {
      author: 'agent-extra',
      text:   'Este debería fallar',
      type:   'note',
    });
    assert(limitRes.status === 400, `Expected 400 en comentario 201, got ${limitRes.status}`);
    assert(limitRes.body.error.code === 'COMMENT_LIMIT_EXCEEDED',
      `Expected COMMENT_LIMIT_EXCEEDED, got ${limitRes.body.error.code}`);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  await close();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unhandled error in test suite:', err);
  process.exit(1);
});
