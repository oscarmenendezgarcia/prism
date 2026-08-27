/**
 * Tests for JSON Schema 2020-12 constructs in mcp-server.js.
 *
 * Verifies:
 *   - $ref reuse for spaceId / requiredSpaceId / taskId via .meta({ id })
 *   - anyOf/definitions for kanban_list_tasks `filters` field
 *   - oneOf for kanban_update_task attachment items (discriminatedUnion)
 *   - Functional correctness of the new `filters` routing
 *   - Backward compatibility of legacy flat `column` / `assigned` params
 *   - Legacy flat params take precedence over `filters` when both present
 *
 * Port: 3097 (isolated, avoids conflict with mcp-server.test.js on 3099)
 * Run: node --test mcp/tests/mcp-schema-2020-12.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const MCP_SERVER_PATH = join(__dirname, '..', 'mcp-server.js');
const SERVER_JS_PATH = join(PROJECT_ROOT, 'server.js');

const TEST_KANBAN_PORT = 3097;
const MCP_PROTOCOL_VERSION = '2025-11-25';
const TEST_DATA_DIR = join(tmpdir(), `kanban-schema-test-${TEST_KANBAN_PORT}-${Date.now()}`);

// ---------------------------------------------------------------------------
// Infrastructure helpers (same pattern as mcp-server.test.js)
// ---------------------------------------------------------------------------

let kanbanServer;
let mcpProc;
let mcpStdoutBuffer = '';
let pendingResolvers = [];

function startKanbanServer(port) {
  return new Promise((resolve, reject) => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const proc = spawn('node', [SERVER_JS_PATH], {
      env: { ...process.env, PORT: String(port), DATA_DIR: TEST_DATA_DIR, PIPELINE_NO_SPAWN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (data) => {
      if (data.toString().includes('running')) resolve(proc);
    });
    proc.on('error', reject);
    proc.stderr.on('data', () => {});
    setTimeout(() => reject(new Error('Kanban test server did not start in time')), 5000);
  });
}

function spawnMcpServer() {
  return new Promise((resolve, reject) => {
    mcpProc = spawn('node', [MCP_SERVER_PATH], {
      env: { ...process.env, KANBAN_API_URL: `http://localhost:${TEST_KANBAN_PORT}/api/v1` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    mcpProc.stderr.on('data', (data) => {
      if (data.toString().includes('Starting prism')) resolve(mcpProc);
    });
    mcpProc.stdout.on('data', (chunk) => {
      mcpStdoutBuffer += chunk.toString();
      let nl;
      while ((nl = mcpStdoutBuffer.indexOf('\n')) !== -1) {
        const line = mcpStdoutBuffer.slice(0, nl).trim();
        mcpStdoutBuffer = mcpStdoutBuffer.slice(nl + 1);
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (pendingResolvers.length > 0) {
          pendingResolvers.shift().resolve(parsed);
        }
      }
    });
    mcpProc.on('error', reject);
    setTimeout(() => reject(new Error('MCP server did not start in time')), 5000);
  });
}

function rpc(method, params, id = 1) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), 8000);
    pendingResolvers.push({ resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params) {
  mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

async function callTool(name, args, id) {
  return rpc('tools/call', { name, arguments: args }, id);
}

async function initialize() {
  const resp = await rpc('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: { name: 'schema-test-client', version: '1.0.0' },
  });
  assert.ok(resp.result);
  notify('notifications/initialized', {});
  return resp;
}

// Cache the tools list to avoid re-fetching in every test
let toolsCache;
async function getTools() {
  if (!toolsCache) {
    const resp = await rpc('tools/list', {}, 99);
    toolsCache = resp.result.tools;
  }
  return toolsCache;
}
function findTool(tools, name) {
  const t = tools.find((t) => t.name === name);
  assert.ok(t, `tool ${name} not found in tools/list`);
  return t;
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  kanbanServer = await startKanbanServer(TEST_KANBAN_PORT);
  await new Promise((r) => setTimeout(r, 200));
  await spawnMcpServer();
  await initialize();
});

after(() => {
  if (mcpProc && !mcpProc.killed) { mcpProc.stdin.end(); mcpProc.kill('SIGTERM'); }
  if (kanbanServer && !kanbanServer.killed) kanbanServer.kill('SIGTERM');
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// TC-001..004: Schema structure — $ref reuse
// ---------------------------------------------------------------------------

describe('TC-001: kanban_list_tasks — spaceId uses $ref reuse', () => {
  it('spaceId field is a $ref pointing to definitions.SpaceId', async () => {
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_list_tasks');
    const schema = tool.inputSchema;

    assert.ok(schema.properties, 'inputSchema must have properties');
    const spaceIdProp = schema.properties.spaceId;
    assert.ok(spaceIdProp, 'spaceId property must exist');
    // MCP SDK draft-7 target: $ref uses #/definitions/
    assert.ok(
      spaceIdProp.$ref === '#/definitions/SpaceId' || spaceIdProp.$ref === '#/$defs/SpaceId',
      `spaceId.$ref should point to SpaceId definition, got: ${JSON.stringify(spaceIdProp)}`
    );
    // The corresponding definitions entry must exist
    const defs = schema.definitions ?? schema.$defs ?? {};
    assert.ok(defs.SpaceId, 'definitions.SpaceId must be present');
    assert.equal(defs.SpaceId.type, 'string', 'SpaceId definition should be type string');
  });
});

describe('TC-002: kanban_list_tasks — filters uses anyOf via $ref', () => {
  it('filters field is a $ref or allOf($ref) pointing to ListTasksFilters with anyOf', async () => {
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_list_tasks');
    const schema = tool.inputSchema;
    const defs = schema.definitions ?? schema.$defs ?? {};

    const filtersProp = schema.properties.filters;
    assert.ok(filtersProp, 'filters property must exist in kanban_list_tasks schema');

    // Either direct $ref or allOf([$ref]) — both are valid schema representations
    let ref;
    if (filtersProp.$ref) {
      ref = filtersProp.$ref;
    } else if (Array.isArray(filtersProp.allOf) && filtersProp.allOf[0]?.$ref) {
      ref = filtersProp.allOf[0].$ref;
    }
    assert.ok(ref, `filters must use $ref (direct or via allOf), got: ${JSON.stringify(filtersProp)}`);

    // Resolve the $ref
    const defKey = ref.split('/').pop(); // 'ListTasksFilters'
    assert.equal(defKey, 'ListTasksFilters', `$ref should point to ListTasksFilters, got key: ${defKey}`);
    const filtersDef = defs[defKey];
    assert.ok(filtersDef, 'definitions.ListTasksFilters must be present');

    // The definition must use anyOf with exactly 3 variants
    assert.ok(Array.isArray(filtersDef.anyOf), 'ListTasksFilters definition must use anyOf');
    assert.equal(filtersDef.anyOf.length, 3, 'anyOf must have exactly 3 variants (both, column-only, assigned-only)');

    // Verify the 3 variants cover: both fields, column only, assigned only
    const hasColumnAndAssigned = filtersDef.anyOf.some(
      (v) => v.properties?.column && v.properties?.assigned
    );
    const hasColumnOnly = filtersDef.anyOf.some(
      (v) => v.properties?.column && !v.properties?.assigned
    );
    const hasAssignedOnly = filtersDef.anyOf.some(
      (v) => v.properties?.assigned && !v.properties?.column
    );
    assert.ok(hasColumnAndAssigned, 'anyOf must include a both-column-and-assigned variant');
    assert.ok(hasColumnOnly, 'anyOf must include a column-only variant');
    assert.ok(hasAssignedOnly, 'anyOf must include an assigned-only variant');
  });
});

describe('TC-003: kanban_update_task — attachments items use oneOf (discriminatedUnion)', () => {
  it('attachments.items is oneOf with 3 attachment type variants', async () => {
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_update_task');
    const schema = tool.inputSchema;

    const attachmentsProp = schema.properties.attachments;
    assert.ok(attachmentsProp, 'attachments property must exist in kanban_update_task schema');
    assert.equal(attachmentsProp.type, 'array', 'attachments must be type array');
    assert.ok(attachmentsProp.items, 'attachments must have items');

    const items = attachmentsProp.items;
    assert.ok(Array.isArray(items.oneOf), 'attachment items must use oneOf');
    assert.equal(items.oneOf.length, 3, 'oneOf must have exactly 3 variants (text, file, link)');

    // Each variant must have a discriminator type literal
    const typeConsts = items.oneOf.map((v) => v.properties?.type?.const).filter(Boolean);
    assert.deepEqual(
      typeConsts.sort(),
      ['file', 'link', 'text'],
      'oneOf variants must discriminate on type: text, file, link'
    );

    // Each variant must declare "type" as required
    for (const variant of items.oneOf) {
      assert.ok(
        Array.isArray(variant.required) && variant.required.includes('type'),
        `variant with type.const=${variant.properties?.type?.const} must have "type" in required`
      );
    }
  });
});

describe('TC-004: pipeline/comment tools — spaceId/taskId use $ref reuse', () => {
  /**
   * Helper: extract the $ref string from a property that uses either
   *   direct: { "$ref": "..." }
   *   or wrapped: { "description": "...", "allOf": [{ "$ref": "..." }] }
   *
   * The MCP SDK (via z4mini.toJSONSchema with draft-7 target) wraps $ref in
   * allOf when a description annotation is present on a non-optional schema.
   * Both forms are semantically equivalent and valid in JSON Schema 7 / 2020-12.
   */
  function extractRef(prop) {
    if (!prop) return undefined;
    if (prop.$ref) return prop.$ref;
    if (Array.isArray(prop.allOf) && prop.allOf[0]?.$ref) return prop.allOf[0].$ref;
    return undefined;
  }

  it('kanban_start_pipeline spaceId → RequiredSpaceId, taskId → TaskId', async () => {
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_start_pipeline');
    const schema = tool.inputSchema;
    const defs = schema.definitions ?? schema.$defs ?? {};

    const spaceIdRef = extractRef(schema.properties.spaceId);
    const taskIdRef  = extractRef(schema.properties.taskId);

    assert.ok(spaceIdRef, `kanban_start_pipeline.spaceId must use $ref, got: ${JSON.stringify(schema.properties.spaceId)}`);
    assert.ok(spaceIdRef.includes('RequiredSpaceId'), `spaceId must ref RequiredSpaceId, got: ${spaceIdRef}`);

    assert.ok(taskIdRef, `kanban_start_pipeline.taskId must use $ref, got: ${JSON.stringify(schema.properties.taskId)}`);
    assert.ok(taskIdRef.includes('TaskId'), `taskId must ref TaskId, got: ${taskIdRef}`);

    // Both defs must be present
    assert.ok(defs.RequiredSpaceId, 'definitions.RequiredSpaceId must be present');
    assert.ok(defs.TaskId, 'definitions.TaskId must be present');
    assert.equal(defs.RequiredSpaceId.type, 'string');
    assert.equal(defs.TaskId.type, 'string');
  });

  it('kanban_add_comment spaceId → RequiredSpaceId, taskId → TaskId', async () => {
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_add_comment');
    const schema = tool.inputSchema;
    const defs = schema.definitions ?? schema.$defs ?? {};

    const spaceIdRef = extractRef(schema.properties.spaceId);
    const taskIdRef  = extractRef(schema.properties.taskId);

    assert.ok(spaceIdRef?.includes('RequiredSpaceId'), `kanban_add_comment.spaceId must use RequiredSpaceId $ref, got: ${spaceIdRef}`);
    assert.ok(taskIdRef?.includes('TaskId'), `kanban_add_comment.taskId must use TaskId $ref, got: ${taskIdRef}`);
    assert.ok(defs.RequiredSpaceId && defs.TaskId, 'both definitions must be present');
  });

  it('kanban_answer_comment spaceId → RequiredSpaceId, taskId → TaskId', async () => {
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_answer_comment');
    const schema = tool.inputSchema;
    const defs = schema.definitions ?? schema.$defs ?? {};

    const spaceIdRef = extractRef(schema.properties.spaceId);
    const taskIdRef  = extractRef(schema.properties.taskId);

    assert.ok(spaceIdRef?.includes('RequiredSpaceId'), `kanban_answer_comment.spaceId must use RequiredSpaceId $ref, got: ${spaceIdRef}`);
    assert.ok(taskIdRef?.includes('TaskId'), `kanban_answer_comment.taskId must use TaskId $ref, got: ${taskIdRef}`);
    assert.ok(defs.RequiredSpaceId && defs.TaskId, 'both definitions must be present');
  });
});

// ---------------------------------------------------------------------------
// TC-005..007: Functional — structured filters routing
// ---------------------------------------------------------------------------

describe('TC-005..007: kanban_list_tasks structured filters routing', () => {
  let todoId;
  let inProgressId;
  const AGENT = 'schema-test-agent-x9';

  before(async () => {
    // Create one task in todo, one in in-progress
    const r1 = await callTool('kanban_create_task', { title: 'Schema Filters Todo', type: 'chore', assigned: AGENT }, 500);
    todoId = JSON.parse(r1.result.content[0].text).id;

    const r2 = await callTool('kanban_create_task', { title: 'Schema Filters InProgress', type: 'chore', assigned: AGENT }, 501);
    const ipTask = JSON.parse(r2.result.content[0].text);
    inProgressId = ipTask.id;

    await callTool('kanban_move_task', { id: inProgressId, to: 'in-progress' }, 502);
  });

  after(async () => {
    if (todoId)       await callTool('kanban_delete_task', { id: todoId },       599);
    if (inProgressId) await callTool('kanban_delete_task', { id: inProgressId }, 598);
  });

  it('TC-005: filters.column routes to correct column', async () => {
    const resp = await callTool('kanban_list_tasks', { filters: { column: 'todo' } }, 510);
    assert.equal(resp.result.isError, undefined);
    const data = JSON.parse(resp.result.content[0].text);
    // todo column must contain our task
    const found = data.todo?.find((t) => t.id === todoId);
    assert.ok(found, 'filters.column=todo should return the todo task');
    // in-progress should either be absent or empty
    assert.ok(
      !data['in-progress'] || data['in-progress'].length === 0 ||
        !data['in-progress'].find((t) => t.id === inProgressId),
      'filters.column=todo should NOT return in-progress tasks when they exist'
    );
  });

  it('TC-006: filters.assigned routes to correct agent', async () => {
    const resp = await callTool('kanban_list_tasks', { filters: { assigned: AGENT } }, 520);
    assert.equal(resp.result.isError, undefined);
    const data = JSON.parse(resp.result.content[0].text);
    // Both tasks must appear (one todo, one in-progress)
    // Filter out nulls and non-objects; only include items with an id field
    const allTasks = Object.values(data).flat().filter((v) => v !== null && typeof v === 'object' && v.id);
    const ours = allTasks.filter((t) => t.id === todoId || t.id === inProgressId);
    assert.equal(ours.length, 2, 'filters.assigned should return both tasks created for that agent');
    // No task from a different agent must appear
    const foreign = allTasks.filter((t) => t.assigned && t.assigned !== AGENT);
    assert.equal(foreign.length, 0, 'filters.assigned should not return tasks from other agents');
  });

  it('TC-007: filters.column + filters.assigned returns intersection', async () => {
    const resp = await callTool('kanban_list_tasks', { filters: { column: 'in-progress', assigned: AGENT } }, 530);
    assert.equal(resp.result.isError, undefined);
    const data = JSON.parse(resp.result.content[0].text);
    const ipTasks = data['in-progress'] ?? [];
    const found = ipTasks.find((t) => t.id === inProgressId);
    assert.ok(found, 'filters.column=in-progress+assigned should include our in-progress task');
    // The todo task must not appear
    const allTasks = Object.values(data).flat().filter((v) => v !== null && typeof v === 'object' && v.id);
    assert.ok(
      !allTasks.find((t) => t.id === todoId),
      'filters.column=in-progress+assigned should NOT return the todo task'
    );
  });
});

// ---------------------------------------------------------------------------
// TC-008..010: Backward compatibility — legacy flat params
// ---------------------------------------------------------------------------

describe('TC-008..010: legacy flat params backward compatibility', () => {
  let taskId;
  const AGENT = 'legacy-compat-agent-y7';

  before(async () => {
    const r = await callTool('kanban_create_task', { title: 'Legacy Compat Task', type: 'chore', assigned: AGENT }, 600);
    taskId = JSON.parse(r.result.content[0].text).id;
  });

  after(async () => {
    if (taskId) await callTool('kanban_delete_task', { id: taskId }, 699);
  });

  it('TC-008: legacy flat column param still returns correct column', async () => {
    const resp = await callTool('kanban_list_tasks', { column: 'todo' }, 610);
    assert.equal(resp.result.isError, undefined);
    const data = JSON.parse(resp.result.content[0].text);
    assert.ok(data.todo, 'todo column must be present');
    assert.ok(data.todo.find((t) => t.id === taskId), 'legacy column=todo should include the todo task');
  });

  it('TC-009: legacy flat assigned param returns only that agent tasks', async () => {
    const resp = await callTool('kanban_list_tasks', { assigned: AGENT }, 620);
    assert.equal(resp.result.isError, undefined);
    const data = JSON.parse(resp.result.content[0].text);
    const allTasks = Object.values(data).flat().filter((v) => v !== null && typeof v === 'object' && v.id);
    assert.ok(allTasks.find((t) => t.id === taskId), 'legacy assigned should include the created task');
    const foreign = allTasks.filter((t) => t.assigned && t.assigned !== AGENT);
    assert.equal(foreign.length, 0, 'legacy assigned should not return tasks from other agents');
  });

  it('TC-010: legacy flat takes precedence over filters when both provided', async () => {
    // Legacy column=todo should win over filters.column=done
    const resp = await callTool('kanban_list_tasks', { column: 'todo', filters: { column: 'done' } }, 630);
    assert.equal(resp.result.isError, undefined);
    const data = JSON.parse(resp.result.content[0].text);
    // The task is in todo — it must appear if legacy (todo) won
    assert.ok(data.todo?.find((t) => t.id === taskId), 'legacy column=todo should win over filters.column=done');
  });
});

// ---------------------------------------------------------------------------
// TC-011..013: Functional — attachment type discrimination
// ---------------------------------------------------------------------------

describe('TC-011..013: attachment oneOf type discrimination', () => {
  let taskId;

  before(async () => {
    const r = await callTool('kanban_create_task', { title: 'Attachment Discrimination Test', type: 'chore' }, 700);
    taskId = JSON.parse(r.result.content[0].text).id;
  });

  after(async () => {
    if (taskId) await callTool('kanban_delete_task', { id: taskId }, 799);
  });

  it('TC-011: type=text attachment is accepted', async () => {
    const resp = await callTool('kanban_update_task', {
      id: taskId,
      attachments: [{ name: 'note.md', type: 'text', content: 'inline text content' }],
    }, 710);
    assert.equal(resp.result.isError, undefined, 'type=text attachment should not error');
    const task = JSON.parse(resp.result.content[0].text);
    const att = task.attachments?.find((a) => a.name === 'note.md');
    assert.ok(att, 'attachment note.md should be present');
    assert.equal(att.type, 'text');
    // Note: server strips content from text/file attachments in API responses
    // (stripAttachmentContent in handlers/tasks.js — only link type preserves content).
    // We only verify the attachment was stored with the correct type.
  });

  it('TC-012: type=file attachment is accepted', async () => {
    const resp = await callTool('kanban_update_task', {
      id: taskId,
      attachments: [{ name: 'spec.md', type: 'file', content: '/tmp/spec.md' }],
    }, 720);
    assert.equal(resp.result.isError, undefined, 'type=file attachment should not error');
    const task = JSON.parse(resp.result.content[0].text);
    const att = task.attachments?.find((a) => a.name === 'spec.md');
    assert.ok(att, 'attachment spec.md should be present');
    assert.equal(att.type, 'file');
  });

  it('TC-013: type=link attachment is accepted', async () => {
    const resp = await callTool('kanban_update_task', {
      id: taskId,
      attachments: [{ name: 'PR', type: 'link', content: 'https://github.com/example/pr/1' }],
    }, 730);
    assert.equal(resp.result.isError, undefined, 'type=link attachment should not error');
    const task = JSON.parse(resp.result.content[0].text);
    const att = task.attachments?.find((a) => a.name === 'PR');
    assert.ok(att, 'attachment PR should be present');
    assert.equal(att.type, 'link');
  });
});

// ---------------------------------------------------------------------------
// TC-014: Schema completeness — all tools emit a valid inputSchema
// ---------------------------------------------------------------------------

describe('TC-014: all tools have well-formed inputSchema', () => {
  it('every tool in tools/list has an inputSchema object', async () => {
    const tools = await getTools();
    for (const tool of tools) {
      assert.ok(
        tool.inputSchema && typeof tool.inputSchema === 'object',
        `tool ${tool.name} is missing inputSchema`
      );
      assert.ok(
        tool.inputSchema.type === 'object',
        `tool ${tool.name}.inputSchema.type should be 'object', got: ${tool.inputSchema.type}`
      );
      assert.ok(
        tool.inputSchema.properties && typeof tool.inputSchema.properties === 'object',
        `tool ${tool.name}.inputSchema.properties should be an object`
      );
    }
  });

  it('all $ref values in spaceId fields are resolvable within their schema', async () => {
    const tools = await getTools();
    for (const tool of tools) {
      const schema = tool.inputSchema;
      const defs = schema.definitions ?? schema.$defs ?? {};
      const spaceIdProp = schema.properties?.spaceId;
      if (!spaceIdProp?.$ref) continue;

      const defKey = spaceIdProp.$ref.split('/').pop();
      assert.ok(
        defs[defKey],
        `tool ${tool.name}: spaceId $ref '${spaceIdProp.$ref}' is unresolvable — '${defKey}' not in definitions`
      );
    }
  });

  it('kanban_update_task oneOf variants: each variant has name + type in required', async () => {
    // Note: z4mini.toJSONSchema (used by the MCP SDK) does NOT emit
    // additionalProperties: false for discriminated union variants — the variants
    // are permissive objects. This is a known SDK behavior difference from
    // calling z.toJSONSchema() directly (which does add additionalProperties: false).
    // Filed as BUG-001 (Low severity). This test verifies the minimum contract
    // that makes discriminated-union routing unambiguous: the discriminator field
    // ("type") is always in required.
    const tools = await getTools();
    const tool = findTool(tools, 'kanban_update_task');
    const items = tool.inputSchema.properties.attachments.items;
    assert.ok(Array.isArray(items.oneOf));
    for (const variant of items.oneOf) {
      assert.ok(
        Array.isArray(variant.required) && variant.required.includes('type') && variant.required.includes('name'),
        `oneOf variant (type.const=${variant.properties?.type?.const}) must require both "name" and "type"`
      );
    }
  });
});
