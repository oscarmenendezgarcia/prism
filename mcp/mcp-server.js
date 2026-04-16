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
 * task-comments + pipeline-blocked:
 *   2 new tools: kanban_add_comment, kanban_answer_comment.
 *   kanban_add_comment with type='question' automatically blocks the active
 *   pipeline run for the task. kanban_answer_comment resolves the question
 *   and unblocks the pipeline when all questions are answered.
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
  resumePipeline,
  stopPipeline,
  addComment,
  answerComment,
  blockRun,
  unblockRun,
  findActiveRunForTask,
} from './kanban-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME    = 'prism';
const SERVER_VERSION = '2.1.0';
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
    pipeline: z
      .array(z.string())
      .optional()
      .describe('Optional ordered list of agent IDs for this task\'s pipeline. Overrides the space default when set.'),
    spaceId: spaceIdSchema,
  },
  withTiming('kanban_create_task', async ({ title, type, description, assigned, pipeline, spaceId }) => {
    return createTask({ title, type, description, assigned, pipeline }, spaceId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_update_task (updated — optional spaceId)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_update_task',
  'Update fields of an existing task (title, description, assigned, type, pipeline) and/or replace its attachments. Only provided fields are changed.',
  {
    id:    z.string().describe('The task ID to update.'),
    title: z.string().optional().describe('New title.'),
    type:  z.enum(['feature', 'bug', 'tech-debt', 'chore']).optional().describe('New type.'),
    description: z.string().optional().describe('New description.'),
    assigned:    z.string().optional().describe('New assigned agent.'),
    // T-007: per-card pipeline override
    pipeline: z
      .array(z.string())
      .optional()
      .describe(
        'Ordered agent IDs for this task\'s pipeline. ' +
        'Overrides the space-level default when "Run Pipeline" is invoked. ' +
        'Pass an empty array to clear the field and revert to the space default.',
      ),
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
  withTiming('kanban_update_task', async ({ id, title, type, description, assigned, pipeline, attachments, spaceId }) => {
    const fields = {};
    if (title       !== undefined) fields.title       = title;
    if (type        !== undefined) fields.type        = type;
    if (description !== undefined) fields.description = description;
    if (assigned    !== undefined) fields.assigned    = assigned;
    // T-007: forward pipeline (including empty array = clear semantics)
    if (pipeline    !== undefined) fields.pipeline    = pipeline;

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
// Tool: kanban_resume_pipeline
// ---------------------------------------------------------------------------

server.tool(
  'kanban_resume_pipeline',
  'Resume an interrupted or failed pipeline run. ' +
  'Use this when a run was interrupted by a server restart but the current stage actually completed. ' +
  'Pass fromStage (zero-based) to skip to a specific stage, or omit it to resume from the first non-completed stage.',
  {
    runId:     z.string().describe('The runId of the interrupted or failed run.'),
    fromStage: z.number().int().optional()
                .describe('Zero-based index of the stage to resume from. Omit to auto-detect the first non-completed stage.'),
  },
  withTiming('kanban_resume_pipeline', async ({ runId, fromStage }) => {
    return resumePipeline({ runId, fromStage });
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_stop_pipeline
// ---------------------------------------------------------------------------

server.tool(
  'kanban_stop_pipeline',
  'Stop a running pipeline by sending SIGTERM to the active stage process. ' +
  'The run is marked as "interrupted" and its state is preserved — ' +
  'use kanban_resume_pipeline to restart it from where it left off. ' +
  'Returns 422 if the run is already in a terminal state (completed, failed, interrupted).',
  {
    runId: z.string().describe('The runId of the pipeline run to stop.'),
  },
  withTiming('kanban_stop_pipeline', async ({ runId }) => {
    return stopPipeline(runId);
  })
);

// ---------------------------------------------------------------------------
// Tool: kanban_add_comment (task-comments + pipeline-blocked)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_add_comment',
  'Add a comment to a kanban task. ' +
  "When type='question', the active pipeline run for this task is automatically " +
  "blocked so it will not advance to the next stage until the question is answered. " +
  "Use kanban_answer_comment to provide an answer and unblock the pipeline. " +
  "Set targetAgent to route the question to a specific pipeline agent for automatic resolution " +
  "(e.g. 'ux-api-designer' for wireframe questions, 'senior-architect' for ADR questions). " +
  "The agent must be in the task's pipeline; otherwise the question is escalated to a human.",
  {
    spaceId: z.string().describe('Space ID containing the task.'),
    taskId:  z.string().describe('Task ID to comment on.'),
    text:    z.string().describe('Comment body (max 5000 characters).'),
    type:    z
      .enum(['note', 'question', 'answer'])
      .describe(
        "'note' — informational; " +
        "'question' — blocks the active pipeline run until answered; " +
        "'answer' — reply to a question (use kanban_answer_comment instead).",
      ),
    author: z
      .string()
      .optional()
      .describe("Author name. Defaults to 'user'."),
    targetAgent: z
      .string()
      .optional()
      .describe(
        "Agent ID to route this question to (e.g. 'ux-api-designer', 'senior-architect'). " +
        "Only valid for type='question'. The agent must be in the task's pipeline. " +
        "If set, pipelineManager spawns the target agent to answer automatically. " +
        "If the agent cannot resolve it, the question is escalated to a human (needsHuman=true).",
      ),
  },
  withTiming('kanban_add_comment', async ({ spaceId, taskId, text, type, author, targetAgent }) => {
    // 1. Create the comment via REST.
    const comment = await addComment({ spaceId, taskId, text, type, author: author ?? 'user', targetAgent });
    if (comment && comment.error) return comment;

    // 2. When it's a question, find the active run and block it.
    if (type === 'question') {
      const run = await findActiveRunForTask({ spaceId, taskId });
      if (run && !run.error) {
        const blockResult = await blockRun(run.runId);
        const blocked     = !blockResult?.error;
        return { comment, pipelineBlocked: blocked, runId: run.runId };
      }
      // No active run found — comment created, but nothing to block.
      return { comment, pipelineBlocked: false };
    }

    return { comment };
  }),
);

// ---------------------------------------------------------------------------
// Tool: kanban_answer_comment (task-comments + pipeline-blocked)
// ---------------------------------------------------------------------------

server.tool(
  'kanban_answer_comment',
  'Answer an open question comment on a kanban task. ' +
  'Creates a new answer comment (parentId = commentId), marks the question as resolved=true, ' +
  'and unblocks the active pipeline run when no open questions remain.',
  {
    spaceId:   z.string().describe('Space ID containing the task.'),
    taskId:    z.string().describe('Task ID that owns the question comment.'),
    commentId: z.string().describe('ID of the question comment to answer.'),
    answer:    z.string().describe('Answer text (max 5000 characters).'),
    author:    z
      .string()
      .optional()
      .describe("Author name. Defaults to 'user'."),
  },
  withTiming('kanban_answer_comment', async ({ spaceId, taskId, commentId, answer, author }) => {
    // 0. Snapshot run status BEFORE answering. The server-side hook
    //    (unblockRunByComment) fires synchronously during the PATCH that
    //    answerComment issues, so by the time the HTTP response returns the run
    //    status has already transitioned blocked → running. We must capture
    //    wasBlocked now or we will always see status='running' and report
    //    pipelineUnblocked: false even though the pipeline was unblocked.
    const runBefore  = await findActiveRunForTask({ spaceId, taskId });
    const wasBlocked = runBefore && !runBefore.error && runBefore.status === 'blocked';

    // 1. Create answer comment + mark question resolved (atomic pair).
    const result = await answerComment({ spaceId, taskId, commentId, answer, author: author ?? 'user' });
    if (result && result.error) return result;

    // 2. Check whether any question comments are still unresolved.
    const task = await getTask(taskId, spaceId);
    if (task && task.error) {
      // Can't read task — return the answer result without unblocking.
      return { ...result, pipelineUnblocked: false };
    }

    const comments      = Array.isArray(task.comments) ? task.comments : [];
    const openQuestions = comments.filter((c) => c.type === 'question' && !c.resolved);

    if (openQuestions.length === 0) {
      if (wasBlocked) {
        // Server-side hook already unblocked the run during the PATCH above.
        // Report the outcome correctly even though status is now 'running'.
        return { ...result, pipelineUnblocked: true, runId: runBefore.runId };
      }

      // Run was not blocked when we answered — maybe it became blocked after our
      // pre-check. Try an explicit REST unblock as a fallback.
      const run = await findActiveRunForTask({ spaceId, taskId });
      if (run && !run.error && run.status === 'blocked') {
        const unblockResult = await unblockRun(run.runId);
        const unblocked     = !unblockResult?.error;
        return { ...result, pipelineUnblocked: unblocked, runId: run.runId };
      }

      return { ...result, pipelineUnblocked: false, openQuestionsRemaining: 0 };
    }

    return { ...result, pipelineUnblocked: false, openQuestionsRemaining: openQuestions.length };
  }),
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();

log('INFO', `Starting ${SERVER_NAME} v${SERVER_VERSION}`);
log('INFO', `Kanban API URL: ${KANBAN_API_URL}`);
log('INFO', 'Tools registered: kanban_list_tasks, kanban_get_task, kanban_create_task, kanban_update_task, kanban_move_task, kanban_delete_task, kanban_clear_board, kanban_list_spaces, kanban_create_space, kanban_rename_space, kanban_delete_space, kanban_list_activity, kanban_start_pipeline, kanban_get_run_status, kanban_resume_pipeline, kanban_stop_pipeline, kanban_add_comment, kanban_answer_comment');

await server.connect(transport);
