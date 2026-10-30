/**
 * Prism MCP Server
 *
 * Exposes the Prism REST API as MCP tools callable by Claude Code
 * and Claude Desktop.
 *
 * ADR-001: stdio transport, HTTP client coupling, official MCP SDK.
 * ADR-1 (Spaces): All 7 existing tools gain an optional spaceId parameter.
 *   4 new tools: kanban_list_spaces, kanban_create_space,
 *                kanban_rename_space, kanban_delete_space.
 * Comments: kanban_add_comment, kanban_answer_comment. An agent that leaves a question
 * and exits waits for the answer, then runs again with it.
 *
 * Transport: StdioServerTransport (Claude Code manages process lifecycle).
 * All logs go to stderr — stdout is reserved for the MCP protocol.
 *
 * Usage: node mcp/mcp-server.js
 * Config: set KANBAN_API_URL env var to override default http://localhost:3000/api/v1
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  updateAttachments,
  moveTask,
  deleteTask,
  clearBoard,
  listSpaces,
  createSpace,
  renameSpace,
  deleteSpace,
  searchTasks,
  addComment,
  answerComment,
} from './kanban-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME    = 'prism';
const SERVER_VERSION = '2.3.0';
const KANBAN_API_URL = process.env.KANBAN_API_URL ?? 'http://localhost:3000/api/v1';

// ---------------------------------------------------------------------------
// Logging helpers (all output to stderr)
// ---------------------------------------------------------------------------

function log(level, message) {
  const ts = new Date().toISOString();
  process.stderr.write(`[MCP] [${ts}] [${level}] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function successResponse(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

function errorResponse(code, message) {
  return {
    content: [{ type: 'text', text: `Error [${code}]: ${message}` }],
    isError: true,
  };
}

/**
 * Wrap a tool handler with timing instrumentation and error routing.
 * @param {string} toolName
 * @param {Function} fn
 * @returns {Function}
 */
function withTiming(toolName, fn) {
  return async (args) => {
    const start = Date.now();
    try {
      const result   = await fn(args);
      const duration = Date.now() - start;
      if (result && result.error) {
        log('INFO', `${toolName} completed in ${duration}ms (error: ${result.code})`);
        return errorResponse(result.code, result.message);
      }
      log('INFO', `${toolName} completed in ${duration}ms`);
      return successResponse(result);
    } catch (err) {
      const duration = Date.now() - start;
      log('ERROR', `${toolName} threw after ${duration}ms: ${err.message}`);
      return errorResponse('INTERNAL_ERROR', err.message);
    }
  };
}

// ---------------------------------------------------------------------------
// Shared parameter schemas — produce JSON Schema $ref via .meta({ id })
// ---------------------------------------------------------------------------

/**
 * Reusable Zod schema for the optional spaceId.
 * The .meta({ id: 'SpaceId' }) annotation causes Zod v4 to emit a $defs entry
 * and a $ref in every tool that uses this schema, satisfying the JSON Schema
 * 2020-12 $ref reuse requirement.
 */
const spaceIdSchema = z
  .string()
  .optional()
  .meta({ id: 'SpaceId' })
  .describe(
    'Optional space ID. When provided, the operation targets that space. ' +
    "When omitted, the legacy default space ('default') is used."
  );

/**
 * Reusable Zod schema for task IDs used across comment tools.
 * Produces $ref: '#/definitions/TaskId' wherever it is referenced.
 */
const taskIdSchema = z
  .string()
  .meta({ id: 'TaskId' })
  .describe('Task ID (UUID).');

/**
 * Required space ID for comment tools (spaceId is mandatory there).
 * Distinct from spaceIdSchema (which is optional) so each $defs entry is correct.
 */
const requiredSpaceIdSchema = z
  .string()
  .meta({ id: 'RequiredSpaceId' })
  .describe('Space ID containing the task.');

/**
 * anyOf filter schema for kanban_list_tasks.
 * Expresses the three valid filter combinations: column only, assigned only,
 * or both column and assigned. The most-specific variant (both) is listed
 * first so Zod picks the right branch when both fields are present.
 */
const listTasksFiltersSchema = z
  .union([
    z.object({
      column:   z.enum(['todo', 'in-progress', 'done']).describe('Column to filter to.'),
      assigned: z.string().describe('Agent name to filter by.'),
    }).describe('Filter by both column and assigned agent.'),
    z.object({
      column: z.enum(['todo', 'in-progress', 'done']).describe('Column to filter to.'),
    }).describe('Filter by column only.'),
    z.object({
      assigned: z.string().describe('Agent name to filter by.'),
    }).describe('Filter by assigned agent only.'),
  ])
  .meta({ id: 'ListTasksFilters' })
  .describe(
    'Filter tasks by column, by assigned agent, or by both. ' +
    'Omit the field entirely to return tasks from all columns / all agents.'
  );

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name:    SERVER_NAME,
  version: SERVER_VERSION,
});

// ---------------------------------------------------------------------------
// Tool: kanban_list_tasks (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_list_tasks',
  'List tasks on the Kanban board with optional filtering and cursor-based pagination. Returns tasks grouped by column plus total count and nextCursor. Pass spaceId to target a specific space.',
  {
    // Legacy flat filter params — kept for backward compatibility.
    // Prefer the structured `filters` field for new callers.
    column: z
      .enum(['todo', 'in-progress', 'done'])
      .optional()
      .describe('Filter to a specific column. Prefer the `filters` field for new callers.'),
    assigned: z
      .string()
      .optional()
      .describe('Filter to tasks assigned to this agent name. Prefer the `filters` field for new callers.'),
    // Structured filter — anyOf(column | assigned | both).
    // When both `filters` and the legacy flat params are provided,
    // the legacy flat params take precedence.
    filters: listTasksFiltersSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum number of tasks to return (1–200). Defaults to 50.'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous nextCursor response value.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_list_tasks', async ({ column, assigned, filters, limit, cursor, spaceId }) => {
    // Legacy flat params take precedence; fall back to structured `filters`.
    const effectiveColumn   = column   ?? filters?.column;
    const effectiveAssigned = assigned ?? filters?.assigned;
    return listTasks({ column: effectiveColumn, assigned: effectiveAssigned, limit, cursor, spaceId });
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_get_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_get_task',
  'Get a single task by its ID. Searches all columns within the specified space. Returns the task with a column field indicating where it was found.',
  {
    id: z.string().describe('The task ID (UUID).'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_get_task', async ({ id, spaceId }) => {
    return getTask(id, spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_create_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_create_task',
  "Create a new task in the 'todo' column. Returns the created task with its generated ID. Pass spaceId to create in a specific space.",
  {
    title: z.string().describe('Task title (max 200 chars).'),
    type:  z.enum(['feature', 'bug', 'tech-debt', 'chore']).describe('Task type.'),
    description: z
      .string()
      .optional()
      .describe('Optional task description (max 1000 chars).'),
    assigned: z
      .string()
      .optional()
      .describe('Optional name to assign the task to.'),
    dependsOn: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Optional task IDs this task depends on. A task with unfinished dependencies is blocked and cannot start a run. Cycles are rejected.'),
    arc: z.string().max(60).optional()
      .describe('Narrative grouping label (e.g. "QOL", "AUTH"). Omit to leave unset.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_create_task', async ({ title, type, description, assigned, arc, dependsOn, spaceId }) => {
    return createTask({
      title, type, description, assigned,
      ...(arc !== undefined && { arc }),
      ...(dependsOn !== undefined && { dependsOn }),
    }, spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_update_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_update_task',
  'Updates fields of an existing task (title, description, assigned, type) and/or attachments. Only provided fields are changed. ' +
  'For attachments, `mode` defaults to `merge` (upserts incoming items by `name` and keeps the rest). ' +
  'Pass `mode:"replace"` to overwrite the entire array; an empty array under `replace` clears all attachments.',
  {
    id:    z.string().describe('The task ID to update.'),
    title: z.string().optional().describe('New title.'),
    type:  z.enum(['feature', 'bug', 'tech-debt', 'chore']).optional().describe('New type.'),
    description: z.string().optional().describe('New description.'),
    assigned:    z.string().optional().describe('New assigned agent.'),
    attachments: z
      .array(
        // oneOf — exactly one attachment type applies.
        z.discriminatedUnion('type', [
          z.object({
            name:    z.string().describe('Attachment file name (e.g. "ADR-1.md").'),
            type:    z.literal('text').describe('Inline text content stored directly in the attachment.'),
            content: z.string().optional().describe('The inline text content.'),
          }).describe('Inline text attachment.'),
          z.object({
            name:    z.string().describe('Attachment file name (e.g. "blueprint.md").'),
            type:    z.literal('file').describe('Reference to an absolute file path on disk.'),
            content: z.string().optional().describe('Absolute path to the file on disk (e.g. "/home/user/docs/ADR.md").'),
          }).describe('File-path attachment (points to a file on disk).'),
          z.object({
            name:    z.string().describe('Attachment display name (e.g. "PR #42").'),
            type:    z.literal('link').describe('External URL (https://...).'),
            content: z.string().optional().describe('The https:// URL.'),
          }).describe('External URL attachment.'),
        ])
      )
      .optional()
      .describe(
        'Replace the task attachments. An empty array clears all attachments.',
      ),
    dependsOn: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Replace the task IDs this task depends on. Pass an empty array to clear them. A task with unfinished dependencies is blocked and cannot start a run. Cycles are rejected.'),
    arc: z.string().max(60).optional()
      .describe('Set or clear the arc. Pass "" (empty string) to clear the arc.'),
    mode: z
      .enum(['merge', 'replace'])
      .optional()
      .describe(
        'Attachment update mode. `merge` (default) upserts incoming attachments by `name` and keeps the rest. ' +
        'Use `replace` to overwrite the whole array (empty array clears all).',
      ),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_update_task', async ({ id, title, type, description, assigned, arc, dependsOn, attachments, mode, spaceId }) => {
    const fields = {};
    if (title       !== undefined) fields.title       = title;
    if (type        !== undefined) fields.type        = type;
    if (description !== undefined) fields.description = description;
    if (assigned    !== undefined) fields.assigned    = assigned;
    if (arc         !== undefined) fields.arc         = arc;
    if (dependsOn  !== undefined) fields.dependsOn  = dependsOn;

    let result;
    if (Object.keys(fields).length > 0) {
      result = await updateTask(id, fields, spaceId);
      if (result && result.error) return result;
    }

    if (attachments !== undefined) {
      result = await updateAttachments(id, attachments, spaceId, mode);
    }

    if (result === undefined) {
      return { error: true, code: 'VALIDATION_ERROR', message: 'At least one field or attachments must be provided.' };
    }

    return result;
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_move_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_move_task',
  'Move a task to a different column (todo, in-progress, or done). Pass spaceId to target a specific space.',
  {
    id: z.string().describe('The task ID to move.'),
    to: z.enum(['todo', 'in-progress', 'done']).describe('Target column.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_move_task', async ({ id, to, spaceId }) => {
    return moveTask(id, to, spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_delete_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_delete_task',
  'Permanently delete a task from any column. Pass spaceId to target a specific space.',
  {
    id: z.string().describe('The task ID to delete.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_delete_task', async ({ id, spaceId }) => {
    return deleteTask(id, spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_clear_board (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_clear_board',
  'Delete all tasks from the board, clearing all columns (todo, in-progress, done) of the specified space. Returns the count of deleted tasks. When spaceId is omitted, clears the default space.',
  {
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_clear_board', async ({ spaceId }) => {
    return clearBoard(spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_list_spaces (new)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_list_spaces',
  'List all spaces (project boards) available in Prism. Returns an array of space objects with id, name, createdAt, and updatedAt.',
  {},
  withTiming('kanban_list_spaces', async () => {
    return listSpaces();
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_create_space (new)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_create_space',
  'Create a new space (project board) with the given name. Space names must be unique (case-insensitive) and between 1 and 100 characters. Optionally set folioBackend to "file" for git-versioned folio storage in the space working directory (requires workingDirectory; defaults to "sqlite").',
  {
    name: z.string().describe('Name for the new space (1-100 characters, must be unique).'),
  },
  withTiming('kanban_create_space', async ({ name }) => {
    return createSpace(name);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_rename_space (new)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_rename_space',
  'Rename an existing space. The new name must be unique (case-insensitive) and between 1 and 100 characters. Optionally update folioBackend (cannot change after folio is activated).',
  {
    id:   z.string().describe('The space ID to rename.'),
    name: z.string().describe('New name for the space.'),
  },
  withTiming('kanban_rename_space', async ({ id, name }) => {
    return renameSpace(id, name);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_delete_space (new)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_delete_space',
  'Permanently delete a space and all its tasks. Cannot delete the last remaining space.',
  {
    id: z.string().describe('The space ID to delete.'),
  },
  withTiming('kanban_delete_space', async ({ id }) => {
    return deleteSpace(id);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_search_tasks (new — cross-space FTS)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_search_tasks',
  'Search tasks by text across all spaces. ' +
  'Matches against task title and description using full-text search (FTS5, BM25 ranking). ' +
  'Returns results with the task object, spaceId, spaceName, and column for each match. ' +
  'Use this instead of iterating kanban_get_task over all spaces when you do not know the spaceId.',
  {
    q: z
      .string()
      .min(1)
      .describe('Search query (matches title and description).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of results to return (1–50). Defaults to 20.'),
  },
  withTiming('kanban_search_tasks', async ({ q, limit }) => {
    return searchTasks({ q, limit });
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_add_comment
// ---------------------------------------------------------------------------

server.tool(
  'kanban_add_comment',
  'Add a comment to a kanban task. ' +
  "An agent that leaves a question and exits waits for the answer, then runs again with it. " +
  'Use kanban_answer_comment to answer a question.',
  {
    spaceId: requiredSpaceIdSchema,
    taskId:  taskIdSchema.describe('Task ID to comment on.'),
    text:    z.string().describe('Comment body (max 5000 characters).'),
    type:    z
      .enum(['note', 'question', 'answer'])
      .describe(
        "'note' — informational; " +
        "'question' — waits for an answer; " +
        "'answer' — reply to a question (use kanban_answer_comment instead).",
      ),
    author: z
      .string()
      .optional()
      .describe("Author name. Defaults to 'user'."),
  },
  withTiming('kanban_add_comment', async ({ spaceId, taskId, text, type, author }) => {
    return addComment({ spaceId, taskId, text, type, author: author ?? 'user' });
  }),
);

// ---------------------------------------------------------------------------
// Tool: kanban_answer_comment
// ---------------------------------------------------------------------------

server.tool(
  'kanban_answer_comment',
  'Answer an open question comment on a kanban task. ' +
  'Creates a new answer comment (parentId = commentId) and marks the question as resolved=true. ' +
  'The agent that asked runs again once no question is open.',
  {
    spaceId:   requiredSpaceIdSchema,
    taskId:    taskIdSchema.describe('Task ID that owns the question comment.'),
    commentId: z.string().describe('ID of the question comment to answer.'),
    answer:    z.string().describe('Answer text (max 5000 characters).'),
    author:    z
      .string()
      .optional()
      .describe("Author name. Defaults to 'user'."),
  },
  withTiming('kanban_answer_comment', async ({ spaceId, taskId, commentId, answer, author }) => {
    return answerComment({ spaceId, taskId, commentId, answer, author: author ?? 'user' });
  }),
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();

log('INFO', `Starting ${SERVER_NAME} v${SERVER_VERSION}`);
log('INFO', `Kanban API URL: ${KANBAN_API_URL}`);
log('INFO', 'Tools registered: kanban_list_tasks, kanban_get_task, kanban_create_task, kanban_update_task, kanban_move_task, kanban_delete_task, kanban_clear_board, kanban_list_spaces, kanban_create_space, kanban_rename_space, kanban_delete_space, kanban_search_tasks, kanban_add_comment, kanban_answer_comment');

await server.connect(transport);
