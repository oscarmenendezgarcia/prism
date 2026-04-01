/**
 * Prism MCP Server
 *
 * Exposes the Prism REST API as 11 MCP tools callable by Claude Code
 * and Claude Desktop.
 *
 * ADR-001: stdio transport, HTTP client coupling, official MCP SDK.
 * ADR-1 (Spaces): All 7 existing tools gain an optional spaceId parameter.
 *   4 new tools: kanban_list_spaces, kanban_create_space,
 *                kanban_rename_space, kanban_delete_space.
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
  listActivity,
  startPipeline,
  getRunStatus,
} from './kanban-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME    = 'prism';
const SERVER_VERSION = '2.0.0';
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
// Shared optional spaceId parameter schema
// ---------------------------------------------------------------------------

/** Reusable Zod schema fragment for the optional spaceId. */
const spaceIdSchema = z
  .string()
  .optional()
  .describe(
    'Optional space ID. When provided, the operation targets that space. ' +
    "When omitted, the legacy default space ('default') is used."
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
    column: z
      .enum(['todo', 'in-progress', 'done'])
      .optional()
      .describe('Filter to a specific column. Omit to get all columns.'),
    assigned: z
      .string()
      .optional()
      .describe('Filter to tasks assigned to this agent name.'),
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
  withTiming('kanban_list_tasks', async ({ column, assigned, limit, cursor, spaceId }) => {
    return listTasks({ column, assigned, limit, cursor, spaceId });
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
      .describe('Optional agent name to assign the task to.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_create_task', async ({ title, type, description, assigned, spaceId }) => {
    return createTask({ title, type, description, assigned }, spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_update_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_update_task',
  'Update fields of an existing task (title, description, assigned, type) and/or replace its attachments. Only provided fields are changed.',
  {
    id:    z.string().describe('The task ID to update.'),
    title: z.string().optional().describe('New title.'),
    type:  z.enum(['feature', 'bug', 'tech-debt', 'chore']).optional().describe('New type.'),
    description: z.string().optional().describe('New description.'),
    assigned:    z.string().optional().describe('New assigned agent.'),
    attachments: z
      .array(
        z.object({
          name:    z.string().describe('Attachment file name (e.g. "ADR-1.md").'),
          type:    z.enum(['text', 'file']).describe('"text" for inline content, "file" for an absolute path on disk.'),
          content: z.string().optional().describe('Inline text content (type="text") or absolute file path (type="file").'),
        })
      )
      .optional()
      .describe('Replace the task attachments. An empty array clears all attachments.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_update_task', async ({ id, title, type, description, assigned, attachments, spaceId }) => {
    const fields = {};
    if (title       !== undefined) fields.title       = title;
    if (type        !== undefined) fields.type        = type;
    if (description !== undefined) fields.description = description;
    if (assigned    !== undefined) fields.assigned    = assigned;

    let result;
    if (Object.keys(fields).length > 0) {
      result = await updateTask(id, fields, spaceId);
      if (result && result.error) return result;
    }

    if (attachments !== undefined) {
      result = await updateAttachments(id, attachments, spaceId);
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
  'Create a new space (project board) with the given name. Space names must be unique (case-insensitive) and between 1 and 100 characters.',
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
  'Rename an existing space. The new name must be unique (case-insensitive) and between 1 and 100 characters.',
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
// Tool: kanban_list_activity (ADR-1 Activity Feed §T-008)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_list_activity',
  'List recent activity events from the Prism kanban board. Returns task and space mutations (task.created, task.moved, task.updated, task.deleted, space.created, space.renamed, space.deleted, board.cleared) in newest-first order. Optionally filter by space, event type, or date range.',
  {
    spaceId: z
      .string()
      .optional()
      .describe('Filter to a specific space ID. When omitted, returns events across all spaces.'),
    type: z
      .enum([
        'task.created', 'task.moved', 'task.updated', 'task.deleted',
        'space.created', 'space.renamed', 'space.deleted', 'board.cleared',
      ])
      .optional()
      .describe('Filter to a specific event type. Omit to get all event types.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .default(20)
      .describe('Maximum number of events to return (1–200). Defaults to 20.'),
    from: z
      .string()
      .optional()
      .describe('Start of date range (ISO-8601). Defaults to 30 days ago.'),
    to: z
      .string()
      .optional()
      .describe('End of date range (ISO-8601). Defaults to now.'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous nextCursor response value.'),
  },
  withTiming('kanban_list_activity', async ({ spaceId, type, limit, from, to, cursor }) => {
    return listActivity({ spaceId, type, limit: limit ?? 20, from, to, cursor });
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_start_pipeline (new — ADR-1 mcp-start-pipeline)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_start_pipeline',
  'Launch the Prism agent pipeline on a kanban task. ' +
  'The task must be in the "todo" column. Returns a runId immediately — ' +
  'the pipeline executes asynchronously. Poll kanban_get_run_status for progress. ' +
  'Default pipeline: senior-architect → ux-api-designer → developer-agent → qa-engineer-e2e.',
  {
    spaceId: z.string().describe('Space ID containing the task.'),
    taskId:  z.string().describe('ID of a task in the "todo" column.'),
    stages:  z.array(z.string()).optional()
              .describe('Ordered agent IDs to run. Defaults to the standard 4-stage pipeline.'),
  },
  withTiming('kanban_start_pipeline', async ({ spaceId, taskId, stages }) => {
    return startPipeline({ spaceId, taskId, stages });
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_get_run_status (new — ADR-1 mcp-start-pipeline)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_get_run_status',
  'Get the current status of a pipeline run by runId. ' +
  'Returns the full run object including per-stage statuses, currentStage, and overall status. ' +
  'Possible statuses: pending, running, completed, failed, interrupted.',
  {
    runId: z.string().describe('The runId returned by kanban_start_pipeline.'),
  },
  withTiming('kanban_get_run_status', async ({ runId }) => {
    return getRunStatus(runId);
  })
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();

log('INFO', `Starting ${SERVER_NAME} v${SERVER_VERSION}`);
log('INFO', `Kanban API URL: ${KANBAN_API_URL}`);
log('INFO', 'Tools registered: kanban_list_tasks, kanban_get_task, kanban_create_task, kanban_update_task, kanban_move_task, kanban_delete_task, kanban_clear_board, kanban_list_spaces, kanban_create_space, kanban_rename_space, kanban_delete_space, kanban_list_activity, kanban_start_pipeline, kanban_get_run_status');

await server.connect(transport);
